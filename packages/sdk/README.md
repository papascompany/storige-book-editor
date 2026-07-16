# @storige/sdk

Storige Partner API v1 공식 SDK. **npm 런타임 의존성 0** (표준 런타임 API + Node 빌트인만 사용).

> 상태: `private: true` — 아직 배포 전이다. 서브패스 추가는 additive 로 진행한다.

## 서브패스

| 서브패스 | 내용 | 런타임 |
|---|---|---|
| `@storige/sdk` | 계약 타입·에러(29종)·봉투·상수 | 무관(트리셰이킹 가능) |
| `@storige/sdk/client` | HTTP 클라이언트(`StorigeClient`) | fetch 있는 곳 어디나 |
| `@storige/sdk/webhook` | 웹훅 **수신** — 서명 검증·멱등·어댑터 | **Node 전용**(node:crypto) |

---

## `@storige/sdk/webhook`

### 🚨 먼저 읽을 것 — 본문은 서명되지 않는다

서명 대상은 다음 **4개 값**뿐이다:

```
`${t}.${identifier}:${event}:${timestamp}`
```

즉 **payload 본문 전체는 서명에 포함되지 않는다**(raw body 해시가 아니다).
서명이 `valid` 여도 증명되는 것은 *"이 secret 을 가진 발신자가 이
identifier·event·timestamp 조합을 t 시각에 서명했다"* 뿐이고, 본문의 나머지
필드(`status`·`outputFileUrl`·`outputFileId`·`errorCode`·`pageCount`·`result` …)가
전송 중 변조되지 않았음은 **증명하지 못한다**.

**수신측이 반드시 지킬 것:**

1. **TLS(https) 를 강제하라.** 본문 무결성은 현재 전적으로 전송계층에 의존한다.
2. **부수효과의 권위를 본문에서 취하지 말라.** 결제·발주·상태확정 같은 판단은
   본문 값이 아니라 `identifier`(서명에 포함되므로 신뢰 가능)로 **재조회**해서
   서버가 준 값으로 하라. 본문은 *"뭔가 바뀌었다"* 는 **알림 트리거**로만 쓰는 것이 안전하다.
3. 본문만 믿어도 되는 경우는 그 값이 부수효과를 만들지 않을 때뿐이다(로그·UI 힌트 등).

이는 SDK 의 결함이 아니라 **서버 발신 계약의 현재 형태**다. SDK 는 계약을 소비만
하며 바꾸지 않는다(계약 변경은 발신·수신 동시 배포가 필요한 별도 트랙).

### 🎉 그 대신 — raw body 보존이 필요 없다

서명이 body 해시가 아니라 파싱된 필드 조립이므로, 다른 웹훅 SDK 가 요구하는
*"JSON 파서보다 먼저 raw body 를 보존하라"* 곡예가 **없다**. `express.json()` 을
그대로 쓰고, App Router 에선 `await request.json()` 한 줄이면 된다.

### ⚠️ secret 은 부팅 시 검증하라 — `process.env.X!` 금지

```ts
// ❌ 하지 말 것 — `!` 는 **타입만** 속인다. env 가 없으면 런타임 값은 undefined 다.
secret: process.env.STORIGE_WEBHOOK_SECRET!

// ✅ 부팅 시 1회 검증하고 검증된 값을 넘긴다
const secret = process.env.STORIGE_WEBHOOK_SECRET;
if (!secret) throw new Error('STORIGE_WEBHOOK_SECRET 이 설정되지 않았습니다');
```

SDK 도 **팩토리 호출 시점에** secret(과 `toleranceSec`)을 검증해 `StorigeUsageError` 를
던진다 — 오설정은 첫 웹훅이 아니라 **배포에서** 터지는 편이 낫다. 어댑터가 반환한
핸들러는 그 뒤로 **어떤 경우에도 예외를 밖으로 흘리지 않는다**(500 으로 바꾼다):
express 4 는 async 핸들러의 rejection 을 `next(err)` 로 넘기지 않아 잡히지 않은
rejection 이 곧 **프로세스 종료**이기 때문이다.

### 빠른 시작 — express

```ts
import express from 'express';
import { createExpressWebhookHandler } from '@storige/sdk/webhook';

const secret = process.env.STORIGE_WEBHOOK_SECRET;
if (!secret) throw new Error('STORIGE_WEBHOOK_SECRET 이 설정되지 않았습니다');

const app = express();
app.use(express.json()); // ✅ 일반 파서로 충분 (raw body 불요)

app.post('/webhooks/storige', createExpressWebhookHandler({
  secret,
  deduper: redisDeduper, // 아래 "멱등" 참조 — 강력 권장
  handler: async (payload, ctx) => {
    if (payload.event === 'book.finalization.completed') {
      // 본문(status 등)을 믿지 말고 identifier 로 재조회해서 확정한다
      const fin = await storige.books.getFinalization(payload.bookUid);
      if (fin.status === 'COMPLETED') await markReady(ctx.identifier);
    }
  },
}));
```

### 빠른 시작 — Next.js App Router

```ts
// app/api/webhooks/storige/route.ts
import { createNextWebhookRoute } from '@storige/sdk/webhook';

export const runtime = 'nodejs'; // node:crypto 사용 — Edge 런타임 불가

const secret = process.env.STORIGE_WEBHOOK_SECRET;
if (!secret) throw new Error('STORIGE_WEBHOOK_SECRET 이 설정되지 않았습니다');

export const POST = createNextWebhookRoute({
  secret,
  deduper: redisDeduper,
  handler: async (payload, ctx) => { /* ... */ },
});
```

표준 `Request`/`Response` 만 쓰므로 Remix action·Hono·SvelteKit 등에도 그대로 꽂힌다.
프레임워크가 다르면 `processWebhookRequest` 로 직접 배선하면 된다 —
단 그때는 **호출측이 try/catch 로 감싸야 한다**(오설정은 거부가 아니라 예외다).

### 응답 규약 (서버 재시도 동작과 맞물린다)

| 상태 | 본문 | 의미 |
|---|---|---|
| 200 | `{received:true}` | 처리 완료 |
| 200 | `{received:true,duplicate:true}` | 중복 배달 단락 — 200 이어야 재시도 체인이 끊긴다 |
| 400 | `{error:'INVALID_JSON'}` | 본문이 JSON 이 아님(next 어댑터) |
| 400 | `{error:<사유>}` | 서명 부재·형식불량·만료·레거시 거부 |
| 401 | `{error:'SIGNATURE_MISMATCH'}` | 서명 불일치 |
| 500 | `{error:'HANDLER_FAILED'}` | 핸들러 예외 → 서버가 재시도 |
| 500 | `{error:'ADAPTER_MISCONFIGURED'}` | **수신측 설정 오류** — 가장 흔한 원인은 `express.json()` 미마운트(`req.body === undefined`) |
| 500 | `{error:'ADAPTER_ERROR'}` | 예상 못 한 예외 — 어댑터가 삼켜 프로세스를 지킨 것 |

`ADAPTER_*` 는 5xx 라 서버가 재시도한다 → 설정을 고치면 재시도가 통과한다(유실 없음).
`GET /api/v1/webhooks/deliveries` 의 `lastResponse` 에서 이 코드를 그대로 볼 수 있다.

### 멱등 — 선택이 아니라 필수

서버는 같은 delivery 를 **최대 4회** 보낸다: 인라인 최초 1회 + 큐 재시도 3회(1분/5분/30분).
여기에 수동 재발송이 더해질 수 있다. 재시도는 **payload 바이트가 불변**이고 서명만
새 `t` 로 재계산되므로, *"서명이 유효하다"* 만으로는 첫 배달인지 4번째인지 알 수 없다.

판별 키는 **`X-Storige-Delivery`(`whd_...`)** 다.

```ts
import type { WebhookDeduper } from '@storige/sdk/webhook';

const redisDeduper: WebhookDeduper = {
  // ⚠️ claim 은 반드시 원자적 check-and-set (NX). "조회 후 저장" 2단계는 경합에서 깨진다.
  async claim(uid) {
    return (await redis.set(`storige:whd:${uid}`, '1', 'EX', 86400, 'NX')) === 'OK';
  },
  // release 를 구현하면 at-least-once (핸들러 실패 시 재시도가 다시 처리).
  // 생략하면 at-most-once — 핸들러가 한 번 실패하면 그 이벤트는 영구 유실된다.
  async release(uid) { await redis.del(`storige:whd:${uid}`); },
};
```

- `InMemoryWebhookDeduper` 는 **참조/개발용**이다. 프로덕션 부적합: ① 다중 인스턴스에서
  무력(프로세스별 Map) ② 재시작 시 망각 ③ 개수 상한 초과 시 오래된 uid 폐기.
- ⚠️ **`jobId` 로 dedupe 하지 말 것.** 한 job 이 `validation.completed` → `synthesis.completed`
  를 각각 발신하므로 jobId 기준 단락은 정상 이벤트를 삼킨다. uid 는 배달 1건에 1:1 이다.

#### 🚨 멱등은 **신뢰성 통제이지 인증 통제가 아니다**

`X-Storige-Delivery`(dedupe 키)는 **서명 밖**이다 — 서명 data 는
`${t}.${identifier}:${event}:${timestamp}` 뿐이라, identifier 가 jobId/sessionId 로
정해지는 페이로드에서는 uid 가 서명에 **들어가지 않는다**. 그런데 단락은 그 헤더값을
직독한다.

→ 유효 서명 1건을 캡처한 공격자는 **uid 헤더만 바꿔** 같은 서명을 replay 창(기본 300초)
안에서 **반복 재생**할 수 있다(단락은 uid 가 다르니 안 걸리고, 서명은 uid 를 안 덮으니
그대로 유효하다).

**부작용이 있는 핸들러는 자체 도메인 멱등을 병행하라** — 주문 uid·(jobId, event) 조합 등
**본인 도메인 키**로 "이미 처리했는가"를 판정하고, 상태 전이는 조건부 갱신(CAS)으로 하라.
SDK 의 uid 단락은 그 위에 얹는 1차 필터(서버 재시도 접기)다. replay 창을 좁힐수록
재생 가능 시간이 준다.

### `t` vs `timestamp` — 다른 값이다

| | 위치 | 의미 | 재시도 시 |
|---|---|---|---|
| `t` | 서명 헤더 안 | **서명 시각**(unix 초) | **매번 갱신** |
| `timestamp` | payload 본문 | **이벤트 시각**(ISO 8601) | 불변 |

replay 창은 반드시 헤더의 `t` 로 판정해야 한다(SDK 기본 ±300초).
⚠️ **`payload.timestamp` 에 신선도 게이트를 걸면 정상 재시도가 거부된다** — 재시도 체인이
1분/5분/30분이라 마지막 재시도의 `payload.timestamp` 는 30분 넘게 과거다.

### 레거시 base64 서명은 기본 거부된다

`X-Storige-Signature`(레거시)는 **시크릿이 참여하지 않는다** — `base64(identifier:event:timestamp)`
라 누구나 계산할 수 있다 = **위조 가능**(발신 실코드 주석도 "보안 검증용으로 신뢰 금지"를 명시).

HMAC 헤더 없이 이것만 오면 SDK 는 `INSECURE_LEGACY_SIGNATURE` 로 **거부**한다.
`allowInsecureLegacy: true` 로만 통과시킬 수 있고, 통과 결과엔 `insecureLegacy: true` 가 실린다.

올바른 해법은 이 옵션이 아니라 **서버측 secret 설정**으로 HMAC 헤더를 받는 것이다
(v2 사이트별 웹훅 config 권장 / v1 은 전역 `WEBHOOK_SECRET`).

### 이벤트

구독 9종 + `webhook.test`(구독 무관 발송). `event` 로 판별하는 discriminated union 을 제공한다.

```
validation.completed | validation.fixable | validation.failed
synthesis.completed  | synthesis.failed
session.validated    | session.failed
book.finalization.completed | book.finalization.failed
```

카탈로그는 **additive 로만 자란다**(기존 이벤트명 삭제/의미변경 없음) → 수신측은
**모르는 이벤트를 만나도 크래시하지 말고 무시**해야 한다.

`book.finalization.completed` 의 `validationSkipped: true` 는 대조 판형 부재로 워커 검증을
**건너뛰고** 최종화됐다는 뜻이다 — 미검증 FINALIZED 이므로 파트너 자체 게이팅이 필요하다.

---

## `@storige/sdk/client` — 알아 둘 함정

- **멀티파트 업로드에 `Idempotency-Key` 를 자동 부여하지 않는다.** 서버 `request_hash` 가
  파일 내용을 반영하지 못해(멀티파트에서 `req.body` 가 비어 hash 가 상수) 같은 키로 다른
  파일을 올리면 **조용한 파일 유실**이 난다. 명시 제공 시 SDK 가 파일 해시를 합성해
  키를 내용 주소화한다. `fileId` 참조(JSON) 경로가 **권장 경로**다.
- **사진(photo) 자산은 멀티파트로 직접 못 올린다** — 직접 업로드 허용 MIME 이 PDF 단독이라
  이미지를 멀티파트로 보내면 415 다. 사실상 `fileId` 참조 전용이다.
- 서버는 `X-RateLimit-*` 잔량 헤더를 보내지 않는다 → 선제 회피 불가. SDK 는 429 를 받은 뒤
  `Retry-After` 를 준수하는 **반응형** 대응만 한다.
- **`options.headers` 에 SDK 예약 헤더를 넣으면 `StorigeUsageError`** (대소문자 무관):
  `Authorization`·`Accept`·`User-Agent`·`Content-Type`·`Idempotency-Key`. 조용히 무시하지
  않는 이유 — 실 fetch 는 같은 이름의 헤더를 **덮어쓰지 않고 결합**하므로
  (`Authorization: Bearer 사용자값, Bearer SDK키`) 그냥 뒀다면 원인 모를 401 이 된다.
  인증은 `apiKey`, UA 는 `userAgent`, 멱등키는 `options.idempotencyKey` 로 넘겨라
  (멱등키는 그래야 길이 검증·멀티파트 내용 주소화를 거친다). 추적 헤더
  (`X-Request-Id`·`traceparent`) 등은 자유롭게 쓸 수 있다.

## 개발

```bash
pnpm --filter @storige/sdk build      # tsup — cjs + esm + dts
pnpm --filter @storige/sdk test       # vitest
pnpm --filter @storige/sdk typecheck
pnpm --filter @storige/sdk lint
```

계약 타입은 서버 `@storige/types` 를 **런타임 의존하지 않고 자체 재선언**한다(그 패키지는
private 내부 도메인 모델이라 통째 배포 불가). 드리프트 감시는 **대상마다 강도가 다르다** —
"전부 자동 감시된다"고 믿으면 안 된다:

| 대상 | 감시 방식 | 서버가 바꾸면? |
|---|---|---|
| v1 에러 코드·봉투·상수 | `types-parity.spec.ts` — `@storige/types` 를 **실제 import** 해 상호 할당 | ✅ 자동 red |
| 웹훅 페이로드 3종(validation·synthesis·book.finalization) | `webhook-events.spec.ts` — 서버 타입 **실제 import** 후 구조 등가성 | ✅ 자동 red |
| 웹훅 **이벤트 카탈로그**(9종) | `webhook-events.spec.ts` — **값 스냅샷 대조**. 정본이 `apps/api/.../webhook-v2.constants.ts` 에 있어 import 경로가 없다 | ⚠️ **자동 감지 불가** — 서버가 이벤트를 추가해도 green(수기 추종 필요) |
| `SessionWebhookPayload` | 정본이 `apps/api/.../webhook.service.ts` 에 있어 import 불가 — **수기 대조** | ⚠️ 자동 감지 불가 |
| 웹훅 서명 규약 | `webhook-signature.spec.ts` — 발신부 **스냅샷 레플리카**와 페어와이즈 | ⚠️ 레플리카 수기 갱신 |

⚠️ 표의 두 번째 그룹은 **서버 상수가 `packages/types` 가 아니라 `apps/api` 에 있어서**
생긴 한계다(진짜 교차대조로 승격하려면 서버측 상수 이동이 필요 = 별도 트랙).

웹훅 서명 페어와이즈의 서버측 대칭 파일은 `apps/api/src/webhook/webhook-signature-pairwise.spec.ts`
다 — 한쪽은 발신부를, 다른 쪽은 수신부를 스냅샷 레플리카로 박제해 서로를 대조한다.
