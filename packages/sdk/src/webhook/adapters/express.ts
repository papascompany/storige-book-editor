/**
 * express 어댑터.
 *
 * ## 🎉 raw body 가 필요 없다 — `express.json()` 과 그대로 공존한다
 * 대부분의 웹훅 SDK 는 `HMAC(rawBody)` 를 검증하므로 "JSON 파서보다 먼저
 * raw body 를 보존하라"(`express.raw({type:'application/json'})` + 별도 라우트
 * 분리)를 요구한다. 이건 실수하기 쉽고 앱 전역 미들웨어 순서를 오염시킨다.
 *
 * Storige 서명 data 는 `${t}.${identifier}:${event}:${timestamp}` 조립이라
 * **body 바이트가 서명에 안 들어간다** → 파싱된 `req.body` 만으로 검증이 끝난다.
 * 평범하게 `app.use(express.json())` 를 쓰면 된다.
 *
 * 그 대가는 {@link verifyWebhookSignature} 모듈 상단의 **본문 무결성 한계**다 —
 * 본문 변조는 탐지되지 않으므로 부수효과는 identifier 재조회로 결정하라.
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { createExpressWebhookHandler, InMemoryWebhookDeduper } from '@storige/sdk/webhook';
 *
 * const app = express();
 * app.use(express.json()); // ✅ 일반 파서로 충분
 *
 * app.post('/webhooks/storige', createExpressWebhookHandler({
 *   secret: process.env.STORIGE_WEBHOOK_SECRET!,
 *   deduper: redisDeduper, // 프로덕션은 공유 저장소 기반으로
 *   handler: async (payload, ctx) => {
 *     if (payload.event === 'book.finalization.completed') {
 *       // 본문을 믿지 말고 identifier 로 재조회
 *       const fin = await storige.books.getFinalization(payload.bookUid);
 *       if (fin.status === 'COMPLETED') await markReady(ctx.identifier);
 *     }
 *   },
 * }));
 * ```
 */

import { StorigeUsageError } from '../../index';
import { processWebhookRequest, type WebhookHandlerOptions } from './core';

/** express `Request` 의 최소 구조 — express 를 의존성으로 끌어들이지 않는다 */
export interface ExpressLikeRequest {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

/** express `Response` 의 최소 구조 */
export interface ExpressLikeResponse {
  status(code: number): ExpressLikeResponse;
  json(body: unknown): unknown;
}

/**
 * express 라우트 핸들러 생성.
 *
 * 응답 규약(서버 재시도 동작과 맞물린다):
 *  - 200 `{received:true}`                 처리 완료
 *  - 200 `{received:true,duplicate:true}`  중복 배달 단락(재시도 체인을 끊는다)
 *  - 400 `{error:<사유>}`                   서명 부재/형식 불량/만료/레거시 거부
 *  - 401 `{error:'SIGNATURE_MISMATCH'}`     서명 불일치
 *  - 500 `{error:'HANDLER_FAILED'}`         핸들러 예외 → 서버가 재시도
 *
 * @throws {StorigeUsageError} `req.body` 가 undefined 일 때 —
 *   JSON 파서(`express.json()`)가 마운트되지 않았다는 뜻이다. 조용히 서명
 *   불일치로 떨어뜨리면 원인 추적에 몇 시간이 날아간다.
 */
export function createExpressWebhookHandler(
  options: WebhookHandlerOptions,
): (req: ExpressLikeRequest, res: ExpressLikeResponse) => Promise<void> {
  return async (req, res) => {
    if (req.body === undefined) {
      throw new StorigeUsageError(
        'createExpressWebhookHandler: req.body 가 undefined 입니다 — JSON 파서가 없습니다. ' +
          "app.use(express.json()) 를 마운트하십시오 (raw body 는 필요 없습니다).",
      );
    }
    const outcome = await processWebhookRequest(req.headers, req.body, options);
    res.status(outcome.status).json(outcome.body);
  };
}
