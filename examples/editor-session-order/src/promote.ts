/**
 * 세션 승격 — **서버측 전용**. 이 파일의 코드는 브라우저에 절대 내려가지 않는다.
 *
 *   ① books.create({ creationType:'EDITOR_SESSION', sessionId })
 *      완료 세션의 산출 PDF 가 자동으로 pdf_contents 자산에 연결된 DRAFT 도서가 생긴다
 *      (PDF_UPLOAD 와 달리 **수동 자산 투입이 없다**).
 *   ② finalization 착수
 *   ③ 완료 통지는 웹훅(book.finalization.*) — examples/webhook-receiver
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
}

export interface PromoteResult {
  book: BookView;
  finalization: BookFinalizationView;
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

  return { book, finalization };
}
