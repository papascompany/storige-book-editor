/**
 * 세션 승격 — **서버측 전용**. 이 파일의 코드는 브라우저에 절대 내려가지 않는다.
 *
 *   ① books.create({ creationType:'EDITOR_SESSION', sessionId })
 *      완료 세션의 산출 PDF 가 자동으로 pdf_contents 자산에 연결된 DRAFT 도서가 생긴다
 *      (PDF_UPLOAD 와 달리 **수동 자산 투입이 없다**).
 *   ② finalization 착수
 *   ③ 완료 통지는 웹훅(book.finalization.*) — examples/webhook-receiver
 *
 * ## 🖨️ 판형(`bookSpecUid`)을 안 붙이면 검증이 통째로 생략된다 (D-9)
 * 대조 판형이 없으면 서버는 워커 구조 검증을 **건너뛰고** 최종화한다 =
 * 미검증 FINALIZED. 인쇄 사고에 직결되므로 `PromoteInput.bookSpecUid` 를 넘기고,
 * 못 넘긴 경우 `PromoteResult.willSkipValidation` 으로 발주 게이트를 걸어라.
 *
 * ## 서버가 승격을 거부하는 3가지 (전부 값 그대로 노출하지 말고 로그로만 남겨라)
 *  - 404 `ERR_NOT_FOUND`            세션 없음 / **다른 테넌트 세션** / **NULL-site 세션**
 *  - 409 `ERR_SESSION_NOT_PROMOTABLE` 세션이 complete 가 아님 / 산출 PDF 없음
 *  - 400 `ERR_VALIDATION_FAILED`     sessionId 누락
 *
 * 404 가 세 경우를 **한 코드로 뭉뚱그리는 것은 의도적**이다(존재 은닉 = IDOR 방지).
 * 즉 "남의 세션인지 없는 세션인지" 파트너는 구분할 수 없다.
 */

import { ErrorCode, StorigeApiError } from '@storige/sdk';
import type { BookFinalizationView, BookView } from '@storige/sdk';
import type { StorigeClient } from '@storige/sdk/client';

export interface PromoteInput {
  /** 편집기가 `editor.complete` 로 알려 준 세션 id */
  sessionId: string;
  /** 파트너측 주문 참조(자유) */
  partnerRef: string;
  title?: string | undefined;
  /**
   * 🖨️ **판형 참조 `bs_...`. 넘기지 않으면 인쇄 검증이 통째로 생략된다(D-9).**
   *
   * 서버는 대조 판형(book_spec)이 없으면 워커 구조 검증을 **건너뛰고** 최종화하고,
   * 결과 웹훅에 `validationSkipped: true` 를 실어 준다. 그 도서는 재단·페이지수·
   * 여백이 한 번도 대조되지 않은 **미검증 FINALIZED** 이며, 그대로 발주하면 인쇄
   * 사고가 그대로 나간다.
   *
   * 생략은 "판형이 아직 없어서 일단 만들어 본다"는 개발 단계에서만 정당하다.
   * 운영 주문 경로에서는 **반드시** 넘겨라 — 못 넘긴다면 그건 판형 데이터가 아직
   * 없다는 뜻이고, 그 상태로 발주하면 안 된다는 신호다.
   */
  bookSpecUid?: string | undefined;
  /**
   * 페이지 수. 생략하면 서버가 최종화 시점에 확정한다. `bookSpecUid` 와 함께
   * 넘겨야 "몇 페이지짜리 판형인가"까지 대조된다.
   */
  pageCount?: number | undefined;
}

export interface PromoteResult {
  book: BookView;
  finalization: BookFinalizationView;
  /**
   * 🖨️ true = 판형 미연결로 **검증 없이** 최종화될 도서다(위 `bookSpecUid` 참조).
   * 호출측이 자동 발주 게이트에서 이 값을 반드시 확인하라 — 웹훅
   * `validationSkipped: true` 를 기다리지 않고 승격 시점에 이미 알 수 있다.
   */
  willSkipValidation: boolean;
}

/** 승격 거부 — HTTP 로 돌려줄 상태코드를 함께 들고 있다 */
export class PromoteRejected extends Error {
  readonly status: number;
  readonly reason: string;

  constructor(status: number, reason: string, message: string) {
    super(message);
    this.name = 'PromoteRejected';
    this.status = status;
    this.reason = reason;
  }
}

export async function promoteSession(
  client: StorigeClient,
  input: PromoteInput,
): Promise<PromoteResult> {
  // ── ① 승격 ────────────────────────────────────────────────────────────
  let book: BookView;
  try {
    book = await client.books.create({
      creationType: 'EDITOR_SESSION',
      sessionId: input.sessionId,
      partnerRef: input.partnerRef,
      ...(input.title !== undefined ? { title: input.title } : {}),
      // 🖨️ 판형을 여기서 붙이지 않으면 이 도서는 미검증으로 최종화된다(D-9)
      ...(input.bookSpecUid !== undefined ? { bookSpecUid: input.bookSpecUid } : {}),
      ...(input.pageCount !== undefined ? { pageCount: input.pageCount } : {}),
    });
  } catch (error) {
    if (error instanceof StorigeApiError) {
      if (error.errorCode === ErrorCode.ERR_NOT_FOUND) {
        throw new PromoteRejected(
          404,
          'SESSION_NOT_FOUND',
          '세션을 찾을 수 없습니다 — 없거나, 다른 테넌트이거나, 소유 사이트가 없는(게스트) 세션입니다',
        );
      }
      if (error.errorCode === ErrorCode.ERR_SESSION_NOT_PROMOTABLE) {
        // errors[] 에 SESSION_NOT_COMPLETE / SESSION_OUTPUT_MISSING 등 세부 코드가 온다
        const detail = error.errors.map((e) => e.code).join(',');
        throw new PromoteRejected(
          409,
          detail === '' ? 'SESSION_NOT_PROMOTABLE' : detail,
          '세션이 아직 승격 가능한 상태가 아닙니다(편집 완료·합성 산출 확인)',
        );
      }
    }
    throw error;
  }

  // ── ② 최종화 착수 ────────────────────────────────────────────────────
  let finalization: BookFinalizationView;
  try {
    finalization = await client.books.startFinalization(book.uid);
  } catch (error) {
    // 이미 진행 중이면 기존 attempt 에 합류한다(실패가 아니다)
    if (
      error instanceof StorigeApiError &&
      error.errorCode === ErrorCode.ERR_FINALIZATION_IN_PROGRESS
    ) {
      finalization = await client.books.getFinalization(book.uid);
    } else {
      throw error;
    }
  }

  // 🖨️ 판형이 붙지 않았다면 이 도서는 **검증 없이** 최종화된다. 웹훅의
  //    validationSkipped 를 기다리지 말고 지금 알려 준다(발주 게이트가 여기서 걸린다).
  return { book, finalization, willSkipValidation: book.bookSpecUid === null };
}
