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
 * export const POST = createNextWebhookRoute({
 *   secret: process.env.STORIGE_WEBHOOK_SECRET!,
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

import { processWebhookRequest, type WebhookHandlerOptions } from './core';

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
 */
export function createNextWebhookRoute(
  options: WebhookHandlerOptions,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse(400, { error: 'INVALID_JSON' });
    }
    const outcome = await processWebhookRequest(request.headers, payload, options);
    return jsonResponse(outcome.status, outcome.body);
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
