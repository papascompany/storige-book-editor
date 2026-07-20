/**
 * 실행 진입점.
 *
 *   cp .env.example .env
 *   node --env-file=.env src/server.ts
 *
 * 서명 검증 없이 동작을 보고 싶으면 `node src/verify.ts` 가 서버를 띄우고
 * 정상/위조/중복 서명을 직접 만들어 던진다(외부 의존 0).
 */

import { StorigeClient } from '@storige/sdk/client';

import { createApp } from './app.ts';
import { loadEnv } from './env.ts';
import { createStorigeWebhookHandler, InMemoryDomainIdempotency } from './handler.ts';

// 부팅 시 env 검증 — 여기서 던지면 프로세스가 뜨지 않는다(의도된 동작)
const env = loadEnv();

// 본문을 믿지 않고 재조회할 클라이언트(선택). 운영에서는 반드시 설정하라.
const client =
  env.apiKey !== undefined && env.baseUrl !== undefined
    ? new StorigeClient({
        apiKey: env.apiKey,
        baseUrl: env.baseUrl,
        userAgent: 'storige-example-webhook-receiver/0.0.0',
      })
    : undefined;

const app = createApp({
  secret: env.webhookSecret,
  toleranceSec: env.toleranceSec,
  path: env.path,
  // ⚠️ 데모용. 운영은 Redis/DB 기반 deduper 를 주입하라(app.ts 주석 참조).
  deduper: undefined,
  handler: createStorigeWebhookHandler({
    processed: new InMemoryDomainIdempotency(),
    client,
  }),
});

app.listen(env.port, () => {
  console.log(`웹훅 수신  http://localhost:${env.port}${env.path}`);
  console.log(`replay 창  ±${env.toleranceSec}초`);
  console.log(`본문 재조회 ${client === undefined ? '꺼짐(STORIGE_API_KEY 미설정)' : '켜짐'}`);
});
