/**
 * express 앱 조립 — 이 파일이 통합의 전부다.
 *
 * ## 🎉 raw body 보존 곡예가 필요 없다
 * 대부분의 웹훅 SDK 는 `HMAC(rawBody)` 를 검증하므로 "JSON 파서보다 먼저 raw body 를
 * 보존하라"(`express.raw()` + 라우트 분리)를 요구한다. Storige 서명 data 는
 * `${t}.${identifier}:${event}:${timestamp}` **조립**이라 body 바이트가 서명에
 * 들어가지 않는다 → 평범하게 `app.use(express.json())` 를 쓰면 된다.
 *
 * 그 대가는 본문 무결성이다(handler.ts 상단 ① 참조).
 *
 * ## 부팅 시점에 터진다
 * `createExpressWebhookHandler(...)` 는 **팩토리 호출 시점**에 secret/toleranceSec 을
 * 검증하고 `StorigeUsageError` 를 던진다. 오설정은 첫 웹훅이 아니라 **배포에서**
 * 터지는 편이 낫다 — 런타임까지 미루면 오설정이 원격 요청으로 트리거되는 실패
 * 경로가 되고, 파트너는 "웹훅이 안 온다"만 보게 된다.
 */

import express from 'express';
import type { Express } from 'express';
import {
  createExpressWebhookHandler,
  InMemoryWebhookDeduper,
  type WebhookDeduper,
  type WebhookHandler,
} from '@storige/sdk/webhook';

export interface AppOptions {
  /** v2: 웹훅 config 발급 시 1회 노출된 whsec_... / v1: 서버 WEBHOOK_SECRET 공유값 */
  secret: string;
  handler: WebhookHandler;
  /**
   * 중복 배달 단락기.
   *
   * ⚠️ 기본값 `InMemoryWebhookDeduper` 는 **참조/개발용**이다. 프로덕션 부적합:
   *    ① 다중 인스턴스에서 무력(프로세스별 Map) ② 재시작 시 망각
   *    ③ 개수 상한 초과 시 오래된 uid 폐기.
   *    운영은 Redis(`SET NX EX`) 나 DB(uid UNIQUE) 기반으로 **주입**하라.
   */
  deduper?: WebhookDeduper | undefined;
  /** replay 창(초) — 기본 300. 좁힐수록 캡처 서명의 재생 가능 시간이 준다 */
  toleranceSec?: number | undefined;
  /** 웹훅 경로 — 웹훅 config 에 등록한 URL 과 맞춰라 */
  path?: string | undefined;
  /** JSON 파서 마운트 여부 — 테스트에서 오설정을 재현할 때만 false */
  mountJsonParser?: boolean;
}

export function createApp(options: AppOptions): Express {
  const app = express();

  // ✅ 일반 파서로 충분하다(raw body 불요). 이걸 빠뜨리면 SDK 가 401 로 오해시키지
  //    않고 500 ADAPTER_MISCONFIGURED 로 알려 준다 — 5xx 라 서버가 재시도하므로
  //    파서를 붙이면 재시도가 통과한다(유실 없음).
  if (options.mountJsonParser !== false) {
    app.use(express.json());
  }

  app.post(
    options.path ?? '/webhooks/storige',
    createExpressWebhookHandler({
      secret: options.secret,
      handler: options.handler,
      deduper: options.deduper ?? new InMemoryWebhookDeduper(),
      ...(options.toleranceSec !== undefined ? { toleranceSec: options.toleranceSec } : {}),
      // 핸들러 예외 관측 — 여기서 던져도 무시된다(관측 실패가 응답을 바꾸면 안 된다)
      onError: (error, ctx) => {
        console.error(`[webhook] 핸들러 실패 event=${ctx.event} id=${ctx.identifier}`, error);
      },
    }),
  );

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}
