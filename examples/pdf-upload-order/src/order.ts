/**
 * PDF_UPLOAD 전 여정 — 이 파일 하나가 주문 흐름 전체다.
 *
 *   ① ping            키 인증 확인(v1 은 무인증 라우트 0)
 *   ② book-specs      판형 확인 + calculated-size 로 **PDF 를 몇 mm 로 만들지** 확정
 *   ③ books.create    DRAFT 도서 생성(creationType='PDF_UPLOAD')
 *   ④ 자산 투입       표지/내지 PDF — fileId 참조(권장) 또는 멀티파트
 *   ⑤ finalization    최종화 착수(검증 → 합성)
 *   ⑥ 완료 대기       웹훅(권장) 또는 폴링
 *   ⑦ GET /pdf        최종 PDF 스트림 수령
 *
 * 흐름을 한눈에 보이게 두려고 일부러 추상화하지 않았다 — 그대로 복사해서
 * 파트너 코드의 주문 서비스에 붙여 넣을 수 있는 형태다.
 */

import { ErrorCode, StorigeApiError } from '@storige/sdk';
import type { BookFinalizationView, BookSpecView, BookView } from '@storige/sdk';
import type { AssetInput, RawStream, StorigeClient } from '@storige/sdk/client';

export interface OrderInput {
  /** 미지정 시 활성 판형 목록의 첫 항목을 쓴다(데모 편의 — 운영에선 명시하라) */
  bookSpecUid: string | undefined;
  pageCount: number;
  partnerRef: string;
  title?: string | undefined;
  cover: AssetInput;
  contents: AssetInput;
  /** true 면 폴링을 건너뛴다 — 완료 통지는 웹훅으로 받는다(examples/webhook-receiver) */
  skipPolling: boolean;
}

export type OrderOutcome =
  | { kind: 'finalizing'; book: BookView; finalization: BookFinalizationView }
  | { kind: 'completed'; book: BookView; finalization: BookFinalizationView; pdf: RawStream }
  | { kind: 'failed'; book: BookView; finalization: BookFinalizationView };

export type Logger = (message: string) => void;

export async function runPdfUploadOrder(
  client: StorigeClient,
  input: OrderInput,
  log: Logger = console.log,
): Promise<OrderOutcome> {
  // ── ① 키 인증 확인 ────────────────────────────────────────────────────
  // v1 은 무인증 라우트가 0이라 ping 도 키를 요구한다 → 온보딩 스모크로 쓴다.
  const ping = await client.ping();
  log(`① ping ok — serverTime=${ping.serverTime}`);

  // ── ② 판형 확인 ──────────────────────────────────────────────────────
  const spec = await resolveBookSpec(client, input.bookSpecUid, log);

  // pageMin/pageMax/pageIncrement 는 판형이 정한다. 위반은 422 다 —
  // 최종화까지 가서 실패하지 말고 여기서 먼저 걸러라.
  if (!isPageCountAllowed(spec, input.pageCount)) {
    throw new Error(
      `pageCount=${input.pageCount} 는 판형 '${spec.name}' 규칙 위반입니다 ` +
        `(min=${spec.pageMin}, max=${spec.pageMax}, increment=${spec.pageIncrement})`,
    );
  }

  // calculated-size 가 알려주는 mm 대로 PDF 를 만들면 워커 사이즈 검증을
  // ±sizeToleranceMm 안에서 통과한다. 표지 펼침면(앞+책등+뒤) 폭도 여기서 나온다.
  try {
    const size = await client.bookSpecs.calculatedSize(spec.uid, input.pageCount);
    log(
      `② 내지 작업 크기 ${size.inner.workWidthMm}×${size.inner.workHeightMm}mm ` +
        `(재단 ${size.inner.trimWidthMm}×${size.inner.trimHeightMm}, 도련 ${size.bleedMm}mm)`,
    );
    if (size.cover !== null && size.spine !== null) {
      log(
        `   표지 펼침면 ${size.cover.workWidthMm}×${size.cover.workHeightMm}mm ` +
          `(책등 ${size.spine.widthMm}mm — ${size.spine.formula})`,
      );
    } else {
      // 책등 계수 미구성 판형 — 표지 크기를 서버가 산출하지 못한다.
      log(`   ⚠️ 책등/표지 산출 불가: ${size.warnings.map((w) => w.code).join(', ')}`);
    }
  } catch (error) {
    // 실패 경로 시연 ①: 422 ERR_PAGE_COUNT_OUT_OF_RANGE.
    // 분기는 **errorCode 로만** 한다 — message 문자열은 예고 없이 개선된다.
    if (isApiError(error, ErrorCode.ERR_PAGE_COUNT_OUT_OF_RANGE)) {
      throw new Error(
        `pageCount=${input.pageCount} 가 판형 허용 범위를 벗어났습니다(서버 422). ` +
          `min=${spec.pageMin} max=${spec.pageMax} increment=${spec.pageIncrement}`,
      );
    }
    throw error;
  }

  // ── ③ DRAFT 도서 생성 ────────────────────────────────────────────────
  // JSON 본문이라 SDK 가 Idempotency-Key 를 자동 부여한다 → 네트워크 재시도가
  // 도서를 중복 생성하지 않는다.
  const book = await client.books.create({
    creationType: 'PDF_UPLOAD',
    bookSpecUid: spec.uid,
    pageCount: input.pageCount,
    partnerRef: input.partnerRef,
    ...(input.title !== undefined ? { title: input.title } : {}),
  });
  log(`③ 도서 생성 ${book.uid} (env=${book.env}, status=${book.status})`);

  // ── ④ 자산 투입 ──────────────────────────────────────────────────────
  // fileId 참조가 권장 경로다. 멀티파트는 서버 멱등 해시가 파일 내용을 반영하지
  // 못해 SDK 가 Idempotency-Key 를 **자동 부여하지 않는다**(README §멱등 참조).
  const cover = await client.books.uploadPdfCover(book.uid, input.cover, multipartOptions(input.cover, book.uid, 'cover'));
  log(`④ 표지 자산 ${cover.assetType} (fileId=${cover.fileId}, status=${cover.status})`);

  const contents = await client.books.uploadPdfContents(book.uid, input.contents, multipartOptions(input.contents, book.uid, 'contents'));
  log(`④ 내지 자산 ${contents.assetType} (fileId=${contents.fileId}, status=${contents.status})`);

  // ── ⑤ 최종화 착수 ────────────────────────────────────────────────────
  let finalization: BookFinalizationView;
  try {
    finalization = await client.books.startFinalization(book.uid);
    log(`⑤ 최종화 착수 ${finalization.uid} (attempt=${finalization.attempt})`);
  } catch (error) {
    // 실패 경로 시연 ②: 409 ERR_FINALIZATION_IN_PROGRESS.
    // 이미 돌고 있다는 뜻이므로 **에러가 아니라 정상 분기**로 다뤄야 한다 —
    // 여기서 던지면 사용자에게 "주문 실패"를 보여 주고 실제로는 성공한다.
    if (isApiError(error, ErrorCode.ERR_FINALIZATION_IN_PROGRESS)) {
      finalization = await client.books.getFinalization(book.uid);
      log(`⑤ 최종화가 이미 진행 중 — 기존 attempt ${finalization.attempt} 에 합류`);
    } else if (isApiError(error, ErrorCode.ERR_ASSETS_INCOMPLETE)) {
      throw new Error('최종화에 필요한 자산이 누락됐습니다(표지/내지 확인)');
    } else if (isApiError(error, ErrorCode.ERR_PAGE_COUNT_OUT_OF_RANGE)) {
      throw new Error('내지 PDF 의 실측 페이지 수가 판형 허용 범위를 벗어났습니다');
    } else {
      throw error;
    }
  }

  // ── ⑥ 완료 대기 ──────────────────────────────────────────────────────
  // 정본 알림 경로는 **웹훅**(book.finalization.completed/failed)이다.
  // 폴링은 웹훅 유실·지연에 대비한 백스톱으로 쓰는 것이 맞다.
  if (input.skipPolling) {
    log('⑥ 폴링 생략 — 완료 통지는 웹훅으로 받는다(examples/webhook-receiver)');
    return { kind: 'finalizing', book, finalization };
  }

  const settled = await client.books.waitForFinalization(book.uid, {
    onPoll: (view) => log(`   … status=${view.status}`),
  });

  if (settled.status === 'FAILED') {
    // FAILED 는 예외가 아니라 **값으로** 온다 — errorCode 로 분기하는 것이 계약이다.
    log(`⑥ 최종화 실패 errorCode=${settled.errorCode}`);
    log(`   상세: ${JSON.stringify(settled.errorDetail)}`);
    return { kind: 'failed', book, finalization: settled };
  }

  log(`⑥ 최종화 완료 pageCount=${settled.pageCount} outputFileId=${settled.outputFileId}`);
  if (settled.validationSkipped) {
    // 대조 판형이 없으면 워커 구조 검증을 **건너뛰고** 최종화된다.
    // 미검증 FINALIZED 이므로 파트너가 자체 게이팅해야 한다.
    log('   ⚠️ validationSkipped=true — 워커 검증 없이 최종화됨. 자체 검수 게이트를 태우십시오');
  }

  // ── ⑦ 최종 PDF 수령 ──────────────────────────────────────────────────
  // 이 라우트만 봉투가 없다 — 성공하면 application/pdf 스트림이 그대로 온다.
  // 스트림은 호출측이 소비/해제할 책임이 있다(상수 메모리 유지).
  const pdf = await client.books.downloadPdf(book.uid);
  log(`⑦ PDF 스트림 수신 contentType=${pdf.contentType} bytes=${pdf.contentLength ?? '미상'}`);

  return { kind: 'completed', book, finalization: settled, pdf };
}

// ── 헬퍼 ────────────────────────────────────────────────────────────────

/** 지정 판형을 쓰거나, 미지정이면 활성 목록의 첫 항목(데모용) */
async function resolveBookSpec(
  client: StorigeClient,
  uid: string | undefined,
  log: Logger,
): Promise<BookSpecView> {
  if (uid !== undefined) {
    const spec = await client.bookSpecs.get(uid);
    log(`② 판형 ${spec.uid} — ${spec.name}`);
    return spec;
  }
  // isActive 미지정 = 활성 판형만(외부 대면 기본)
  const page = await client.bookSpecs.list({ limit: 20 });
  const first = page.items[0];
  if (first === undefined) {
    throw new Error('사용할 수 있는 활성 판형이 없습니다 — STORIGE_BOOK_SPEC_UID 를 지정하십시오');
  }
  log(`② 판형 자동 선택 ${first.uid} — ${first.name} (총 ${page.pagination.total}종)`);
  return first;
}

function isPageCountAllowed(spec: BookSpecView, pageCount: number): boolean {
  if (pageCount < spec.pageMin || pageCount > spec.pageMax) return false;
  if (spec.pageIncrement <= 0) return true;
  return (pageCount - spec.pageMin) % spec.pageIncrement === 0;
}

/**
 * 멀티파트일 때만 멱등키를 **명시** 제공한다.
 *
 * 서버 `request_hash` 는 멀티파트에서 `req.body` 가 비어 상수가 된다 → 같은 키로
 * 다른 파일을 올리면 조용한 파일 유실이 난다. 그래서 SDK 는 멀티파트에 키를
 * 자동 부여하지 않는다. 명시 제공하면 SDK 가 **파일 해시를 합성**해 키를 내용
 * 주소화하므로 그 함정이 사라진다(다른 파일 = 다른 키).
 *
 * fileId 참조 경로는 본문이 JSON 이라 자동 부여가 정상 작동한다 → 아무것도 안 한다.
 */
function multipartOptions(
  input: AssetInput,
  bookUid: string,
  slot: 'cover' | 'contents',
): { idempotencyKey: string } | undefined {
  if (input.fileId !== undefined) return undefined;
  return { idempotencyKey: `${bookUid}:${slot}` };
}

/** errorCode 기반 판별 — message 파싱 금지(§3.2) */
function isApiError(error: unknown, code: string): boolean {
  return error instanceof StorigeApiError && error.errorCode === code;
}
