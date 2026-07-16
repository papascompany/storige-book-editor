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
 * // 부팅 시 env 검증 — `process.env.X!` 는 타입만 만족시킬 뿐 런타임 undefined 를
 * // 막지 못한다. 검증된 값을 넘겨라(SDK 도 팩토리에서 한 번 더 막는다).
 * const secret = process.env.STORIGE_WEBHOOK_SECRET;
 * if (!secret) throw new Error('STORIGE_WEBHOOK_SECRET 이 설정되지 않았습니다');
 *
 * const app = express();
 * app.use(express.json()); // ✅ 일반 파서로 충분
 *
 * app.post('/webhooks/storige', createExpressWebhookHandler({
 *   secret,
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
import {
  adapterFailureOutcome,
  assertWebhookHandlerOptions,
  processWebhookRequest,
  type WebhookHandlerOptions,
  type WebhookProcessOutcome,
} from './core';

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
 *  - 500 `{error:'ADAPTER_MISCONFIGURED'}`  수신측 설정 오류 → **아래 참조**
 *  - 500 `{error:'ADAPTER_ERROR'}`          예상 못 한 예외(프로세스는 살린다)
 *
 * ## 🚨 반환된 핸들러는 절대 reject 하지 않는다 (express 4 필수 성질)
 * express 4 는 async 핸들러의 rejection 을 **next(err) 로 넘기지 않는다** —
 * 잡히지 않은 rejection 은 Node 15+ 기본 정책상 **프로세스를 죽인다**. 즉 이
 * 핸들러가 던지는 순간 그것은 원격 트리거 가능한 DoS 가 된다(실증: secret 미주입
 * 상태에서 아무 값이나 담은 HMAC 헤더 1개로 서버 다운 — 유효 서명 불요).
 * 그래서 모든 경로를 try/catch 로 감싸 **반드시 응답으로 바꾼다**.
 *
 * `ADAPTER_MISCONFIGURED` 를 보면 수신측 설정을 의심하라 — 가장 흔한 원인은
 * `express.json()` 미마운트(`req.body === undefined`)다. 5xx 라 서버가 재시도하므로
 * 파서를 붙이면 재시도가 통과한다(유실 없음).
 *
 * @throws {StorigeUsageError} **팩토리 호출 시점**(부팅) — secret 이 비문자열/빈
 *   문자열이거나 toleranceSec 이 NaN 일 때. 오설정은 첫 웹훅이 아니라 배포에서
 *   터지는 편이 낫다({@link assertWebhookHandlerOptions}).
 */
export function createExpressWebhookHandler(
  options: WebhookHandlerOptions,
): (req: ExpressLikeRequest, res: ExpressLikeResponse) => Promise<void> {
  // 부팅 시점 검증 — 오설정은 여기서 터진다(런타임 원격 트리거로 미루지 않는다)
  assertWebhookHandlerOptions(options, 'createExpressWebhookHandler');

  return async (req, res) => {
    let outcome: WebhookProcessOutcome;
    try {
      if (req.body === undefined) {
        // 파서 누락. 조용히 서명 불일치(401)로 떨어뜨리면 원인 추적에 몇 시간이
        // 날아가므로 전용 사유 코드로 구분한다 — 단, 던져서 프로세스를 죽이지는
        // 않는다(아래 catch 가 500 ADAPTER_MISCONFIGURED 로 바꾼다).
        throw new StorigeUsageError(
          'createExpressWebhookHandler: req.body 가 undefined 입니다 — JSON 파서가 없습니다. ' +
            'app.use(express.json()) 를 마운트하십시오 (raw body 는 필요 없습니다).',
        );
      }
      outcome = await processWebhookRequest(req.headers, req.body, options);
    } catch (error) {
      outcome = adapterFailureOutcome(error);
    }

    try {
      res.status(outcome.status).json(outcome.body);
    } catch {
      // 응답 기록 자체가 실패하면(이미 응답됨 등) 할 수 있는 게 없다. 여기서
      // 던지면 위 try/catch 를 벗어나 프로세스가 죽으므로 삼킨다 — 이 함수의
      // 계약은 "무슨 일이 있어도 reject 하지 않는다"다.
    }
  };
}
