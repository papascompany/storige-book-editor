/**
 * Next.js App Router 어댑터 (Route Handler).
 *
 * ## 🎉 `request.text()` 보존 곡예가 필요 없다
 * 다른 웹훅 SDK 는 raw body 해시를 검증하므로 App Router 에서
 * `const raw = await req.text()` 로 원문을 잡아 두고 따로 파싱해야 한다
 * (그리고 Pages Router 라면 `bodyParser: false` 까지). Storige 서명은 body
 * 해시가 아니라 필드 조립이라 **`await request.json()` 하나면 끝난다**.
 *
 * 그 대가는 {@link verifyWebhookSignature} 모듈 상단의 **본문 무결성 한계**다 —
 * 본문 변조는 탐지되지 않으므로 부수효과는 identifier 재조회로 결정하라.
 *
 * ## 런타임
 * `@storige/sdk/webhook` 은 node:crypto 를 쓰므로 **Node 런타임**이 필요하다.
 * Edge 런타임에서는 동작하지 않는다:
 * ```ts
 * export const runtime = 'nodejs'; // 기본값이지만 명시해 두면 안전하다
 * ```
 *
 * @example app/api/webhooks/storige/route.ts
 * ```ts
 * import { createNextWebhookRoute } from '@storige/sdk/webhook';
 *
 * export const runtime = 'nodejs';
 *
 * // 부팅 시 env 검증 — `process.env.X!` 는 타입만 만족시킬 뿐 런타임 undefined 를
 * // 막지 못한다. 검증된 값을 넘겨라(SDK 도 팩토리에서 한 번 더 막는다).
 * const secret = process.env.STORIGE_WEBHOOK_SECRET;
 * if (!secret) throw new Error('STORIGE_WEBHOOK_SECRET 이 설정되지 않았습니다');
 *
 * export const POST = createNextWebhookRoute({
 *   secret,
 *   deduper: redisDeduper,
 *   handler: async (payload, ctx) => {
 *     if (payload.event === 'synthesis.completed') {
 *       // 본문(outputFileUrl)은 서명 밖 — identifier 로 재조회해서 확정하라
 *       await enqueueDownload(ctx.identifier);
 *     }
 *   },
 * });
 * ```
 */

import {
  adapterFailureOutcome,
  assertWebhookHandlerOptions,
  processWebhookRequest,
  type WebhookHandlerOptions,
} from './core';

/**
 * Next.js App Router `POST` Route Handler 생성.
 *
 * 표준 `Request`/`Response` 만 쓰므로 동일 시그니처를 가진 다른 fetch 기반
 * 프레임워크(Remix action, Hono, SvelteKit 등)에도 그대로 꽂힌다.
 *
 * 응답 규약:
 *  - 200 `{received:true}`                 처리 완료
 *  - 200 `{received:true,duplicate:true}`  중복 배달 단락
 *  - 400 `{error:'INVALID_JSON'}`          본문이 JSON 이 아님
 *  - 400 `{error:<사유>}`                   서명 부재/형식 불량/만료/레거시 거부
 *  - 401 `{error:'SIGNATURE_MISMATCH'}`     서명 불일치
 *  - 500 `{error:'HANDLER_FAILED'}`         핸들러 예외 → 서버가 재시도
 *  - 500 `{error:'ADAPTER_MISCONFIGURED'}`  수신측 설정 오류(StorigeUsageError)
 *  - 500 `{error:'ADAPTER_ERROR'}`          예상 못 한 예외
 *
 * ## 반환된 라우트는 절대 reject 하지 않는다
 * Next.js 자체는 라우트 예외를 500 으로 바꿔 주지만, 이 팩토리는 같은 시그니처로
 * Remix·Hono·SvelteKit 등에도 꽂히므로 **프레임워크의 관용에 기대지 않는다**
 * (express 어댑터와 동일한 계약 — 그쪽은 reject 가 곧 프로세스 종료다).
 *
 * @throws {StorigeUsageError} **팩토리 호출 시점**(모듈 로드) — secret 이
 *   비문자열/빈 문자열이거나 toleranceSec 이 NaN 일 때. route.ts 는 모듈 로드 시
 *   평가되므로 오설정이면 라우트가 **부팅에 실패한다**(의도된 조기 발견).
 */
export function createNextWebhookRoute(
  options: WebhookHandlerOptions,
): (request: Request) => Promise<Response> {
  // 부팅 시점 검증 — 오설정은 여기서 터진다(런타임 원격 트리거로 미루지 않는다)
  assertWebhookHandlerOptions(options, 'createNextWebhookRoute');

  return async (request) => {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse(400, { error: 'INVALID_JSON' });
    }
    try {
      const outcome = await processWebhookRequest(request.headers, payload, options);
      return jsonResponse(outcome.status, outcome.body);
    } catch (error) {
      const outcome = adapterFailureOutcome(error);
      return jsonResponse(outcome.status, outcome.body);
    }
  };
}

/**
 * Response.json() 은 런타임에 따라 없을 수 있어(Node 18 초기) 직접 조립한다 —
 * 의존성 0 원칙과 폭넓은 런타임 호환을 함께 지킨다.
 */
function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
