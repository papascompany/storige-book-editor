# quickstart — 웹훅 수신 서버

Storige 가 보내는 웹훅을 **안전하게 받는** express 서버. 서명 검증 · 중복 배달 단락 ·
이벤트 분기를 `@storige/sdk/webhook` 어댑터로 처리한다.

주 이벤트는 `book.finalization.completed` / `.failed` — 최종화 완료 통지의 **정본 경로**다
(폴링은 백스톱).

## 무엇을 증명하는가

`src/verify.ts` 는 실제 express 서버를 임시 포트로 띄우고 **테스트 secret 으로 서명을 직접
만들어** HTTP 로 던진다. 발신 서버 없이 수신 배선 전체가 진짜로 도는지 확인한다(`pnpm verify`).

| | 시나리오 | 기대 |
|---|---|---|
| ① | 정상 서명 | `200 {received:true}` + 핸들러 1회 실행 |
| ② | 위조 서명(secret 모름) | `401 {error:'SIGNATURE_MISMATCH'}` + 핸들러 **미실행** |
| ③ | 같은 delivery uid 재배달 | `200 {received:true,duplicate:true}` + 핸들러 **미실행** |
| ③' | **캡처한 서명을 그대로 재사용**하고 uid 헤더만 교체 (`synthesis.completed` = jobId 로 서명되는 페이로드) | `200` — SDK 단락 **통과**(핸들러 재진입)하지만 **도메인 멱등이 부수효과를 1회로 묶는다** |
| ③'' | 같은 조작을 `book.finalization.completed` 에 시도 | `401 {error:'SIGNATURE_MISMATCH'}` — **이 이벤트는 uid 가 서명 안에 있어 공격이 성립하지 않는다** |
| ④ | secret 미설정/빈값 · `toleranceSec: NaN` | 팩토리가 던져 **부팅 실패** |
| ⑤ | `express.json()` 누락 | `500 {error:'ADAPTER_MISCONFIGURED'}` (401 로 위장하지 않는다) |
| ⑥ | replay 창 밖의 `t` | `400 {error:'TIMESTAMP_OUT_OF_TOLERANCE'}` |

③'의 공격자 모델은 **secret 을 모른다**는 것이다. 그래서 재생 시 서명을 다시 만들지
않고 캡처한 문자열을 그대로 재사용한다 — 재서명하는 시연은 시크릿 보유자만 가능하므로
아무것도 증명하지 못한다.

> ⚠️ **라이브 스모크는 아직 돌리지 않았다.** 위 표는 전부 로컬 E2E(임시 포트 + 자체 생성
> 서명) 결과다. 실 Storige 발신 서버를 대상으로 한 수신 검증은 파트너 환경에서 별도로
> 해야 한다(특히 `t` 시계 오차, 프록시의 헤더 대소문자·중복 처리, 본문 인코딩).

## 전제

- Node **≥ 22.18** (빌드 없이 `.ts` 실행 — Node 내장 타입 스트리핑)
- 서명 secret
  - **v2**(사이트별 opt-in): 웹훅 config 생성/회전 응답에 **1회만** 노출되는 `whsec_...`.
    재조회 불가 — 받은 즉시 보관하라.
  - **v1**(레거시 전역): 서버 `WEBHOOK_SECRET` 과 공유한 값.
    ⚠️ **동등한 선택지가 아니다** — v1 발신은 `X-Storige-Delivery` 를 보내지 않아
    SDK 중복 단락이 통째로 비활성이다(§③ 말미 참조). 신규 연동은 v2 를 쓰라.
- HTTPS. 본문 무결성은 현재 전적으로 전송계층에 의존한다(아래 참조).

## `@storige/sdk` 참조 방식

SDK 는 아직 **npm 미배포**(`private: true`)라 모노레포 내부에서 `workspace:*` 로 참조한다.
배포 후에는 `npm i @storige/sdk` 로 바꾸면 되고 **코드는 그대로**다(오너 결정 D-10b 대기).
`@storige/sdk/webhook` 은 `node:crypto` 를 쓰므로 **Node 전용**이다(Edge 런타임 불가).

## 실행

```bash
pnpm --filter @storige/sdk build                          # 0) SDK 빌드
pnpm --filter @storige/example-webhook-receiver verify     # 1) E2E 검증(외부 의존 0)
cp .env.example .env && node --env-file=.env src/server.ts # 2) 수신 서버 기동
```

---

## 🚨 ① secret 은 **부팅 시** 검증하라 — `process.env.X!` 금지

```ts
// ❌ 절대 금지 — `!` 는 **타입만** 속인다. env 가 없으면 런타임 값은 undefined 다.
createExpressWebhookHandler({ secret: process.env.STORIGE_WEBHOOK_SECRET!, ... })

// ✅ 부팅 시 1회 검증하고 검증된 값을 넘긴다 (src/env.ts)
const secret = process.env.STORIGE_WEBHOOK_SECRET;
if (!secret) throw new Error('STORIGE_WEBHOOK_SECRET 이 설정되지 않았습니다');
```

`!` 로 넘기면 배포는 성공한 것처럼 보이고, 파트너 눈에는 **"웹훅이 안 온다"** 로만 보인다.
SDK 도 같은 이유로 **팩토리 호출 시점**(모듈 로드 = 부팅)에 secret 과 `toleranceSec` 을 검증해
`StorigeUsageError` 를 던진다 — 오설정은 첫 웹훅이 아니라 **배포에서** 터지는 편이 낫다.

`toleranceSec` 도 같다: `Number(process.env.X)` 가 `NaN` 이 되면 `NaN > 0` 이 false 라
**replay 보호가 침묵으로 꺼진다**(10년 전 캡처 서명도 통과). 그래서 NaN 도 던진다.
검사를 의도적으로 끄려면 `0` 을 **명시**하라.

## 🚨 ② 본문은 서명되지 않는다 — 부수효과의 근거를 본문에서 취하지 마라

서명 대상은 다음 **4개 값뿐**이다.

```
`${t}.${identifier}:${event}:${timestamp}`
```

즉 `status` · `outputFileId` · `errorCode` · `pageCount` · `result` 같은 나머지 본문 필드는
**서명 밖**이라 전송 중 변조돼도 탐지되지 않는다(raw body 해시가 아니다).

- ✅ **TLS(https)를 강제하라.** 본문 무결성은 현재 전적으로 전송계층에 의존한다.
- ✅ 결제·발주·상태확정 같은 판단은 **재조회**해서 서버가 준 값으로 하라.
  `src/handler.ts` 가 `books.getFinalization(bookUid)` 로 되묻는 이유다.
- ✅ 본문만 믿어도 되는 경우는 그 값이 부수효과를 만들지 않을 때뿐이다(로그·UI 힌트).

이는 SDK 결함이 아니라 **서버 발신 계약의 현재 형태**다.

### 🎉 그 대신 raw body 보존이 필요 없다

서명이 body 해시가 아니라 파싱된 필드 조립이므로, 다른 웹훅 SDK 가 요구하는
*"JSON 파서보다 먼저 raw body 를 보존하라"* 곡예가 **없다**. `app.use(express.json())` 하나면
된다. 빠뜨리면 401 로 오해시키지 않고 `500 ADAPTER_MISCONFIGURED` 로 알려 준다(⑤).

## 🚨 ③ 멱등은 **신뢰성** 통제이지 **인증** 통제가 아니다

서버는 같은 delivery 를 **최대 4회** 보낸다(인라인 1회 + 큐 재시도 1분/5분/30분).
여기에 수동 재발송이 더해질 수 있다. 재시도는 payload 바이트가 불변이고 서명만 새 `t` 로
재계산되므로, *"서명이 유효하다"* 만으로는 첫 배달인지 4번째인지 알 수 없다.

판별 키는 **`X-Storige-Delivery`(`whd_...`)** 이고 SDK 의 `deduper` 가 이걸로 단락한다.
**그러나 그 헤더는 서명 밖이다.** 다만 그 결과는 이벤트마다 다르다 — 서명 identifier 가
무엇으로 정해지느냐에 달렸다(v2 규칙: `jobId ?? sessionId ?? delivery uid`).

| 이벤트 | 서명 identifier | uid 가 서명에? | 캡처한 서명 + uid 교체 재생 |
|---|---|---|---|
| `validation.*` · `synthesis.*` · `session.*` | `jobId` / `sessionId` | **밖** | **성립한다** → 200 (③') |
| `book.finalization.*` | jobId/sessionId 부재 → **delivery uid** | **안** | 성립하지 않는다 → 401 (③'') |

즉 유효 서명 1건을 캡처한 공격자는 jobId 계열 이벤트에 한해 **재서명 없이 uid 헤더만
바꿔** replay 창(기본 300초) 안에서 반복 재생할 수 있다.

→ **부작용이 있는 핸들러는 자체 도메인 멱등을 병행하라.** (이벤트별로 켜고 끄지 말고
전부에 걸어라 — 어느 쪽인지 매번 따지는 코드가 훨씬 더 잘 틀린다)

```ts
// src/handler.ts — 본인 도메인 키로 한 번 더 막는다
if (!(await processed.claim(`${payload.event}:${payload.finalizationUid}`))) return;
```

`verify.ts` ③' 이 정확히 이 상황을 재현한다: `synthesis.completed` 서명을 **한 글자도
바꾸지 않고** uid 헤더만 갈아끼운 재생은 SDK 단락을 **통과해서** 핸들러가 다시 불리지만,
도메인 멱등이 부수효과를 **1회로** 묶는다. 상태 전이는 조건부 갱신(CAS, 예:
`WHERE status='PENDING'`)으로 하라. replay 창을 좁힐수록 재생 가능 시간이 준다.

### ⚠️ v1 발신에는 `X-Storige-Delivery` 가 아예 없다 → SDK 단락이 통째로 꺼진다

레거시 전역 secret(v1) 경로는 이 헤더를 **보내지 않는다**(서버측 불변식 테스트로 고정돼
있다). SDK 어댑터는 uid 가 없으면 `canDedupe = false` 로 단락을 건너뛰므로, **4회 재시도가
전부 핸들러에 도달**한다. v1 을 쓰는 동안 중복 방어는 위 도메인 멱등 **하나뿐**이다.

→ 가능하면 **v2(사이트별 secret)로 옮겨라.** 위 §전제에서 v1 을 동등한 선택지처럼
적어 뒀지만, dedupe 관점에서 둘은 동등하지 않다.

### ⚠️ `jobId` 로 dedupe 하지 마라

한 job 이 `validation.completed` → `synthesis.completed` 를 **각각** 발신하므로 jobId 기준
단락은 정상 이벤트를 삼킨다. uid 는 배달 1건에 1:1 이다.

### ⚠️ `InMemoryWebhookDeduper` 는 데모용이다

프로덕션 부적합 — ① 다중 인스턴스에서 무력(프로세스별 Map) ② 재시작 시 망각
③ 개수 상한 초과 시 오래된 uid 폐기. 운영은 **공유 저장소**로 주입하라.

```ts
const redisDeduper: WebhookDeduper = {
  // ⚠️ claim 은 반드시 원자적 check-and-set(NX). "조회 후 저장" 2단계는 경합에서 깨진다.
  async claim(uid) {
    return (await redis.set(`storige:whd:${uid}`, '1', 'EX', 86400, 'NX')) === 'OK';
  },
  // release 를 구현하면 at-least-once(핸들러 실패 시 재시도가 다시 처리).
  // 생략하면 at-most-once — 핸들러가 한 번 실패하면 그 이벤트는 영구 유실된다.
  async release(uid) { await redis.del(`storige:whd:${uid}`); },
};
```

`src/handler.ts` 의 `InMemoryDomainIdempotency` 도 같다 — 운영은 **DB 유니크 제약**이나
Redis `SET NX` 로 바꿔라.

## `t` vs `timestamp` — 다른 값이다

| | 위치 | 의미 | 재시도 시 |
|---|---|---|---|
| `t` | 서명 헤더 안 | **서명 시각**(unix 초) | **매번 갱신** |
| `timestamp` | payload 본문 | **이벤트 시각**(ISO 8601) | 불변 |

replay 창은 반드시 헤더 `t` 로 판정한다(SDK 기본 ±300초).
⚠️ **`payload.timestamp` 에 신선도 게이트를 걸면 정상 재시도가 거부된다** — 재시도 체인이
1분/5분/30분이라 마지막 재시도의 `payload.timestamp` 는 30분 넘게 과거다.

## 응답 규약 (서버 재시도 동작과 맞물린다)

| 상태 | 본문 | 의미 |
|---|---|---|
| 200 | `{received:true}` | 처리 완료 |
| 200 | `{received:true,duplicate:true}` | 중복 배달 단락 — **200 이어야** 재시도 체인이 끊긴다 |
| 400 | `{error:<사유>}` | 서명 부재·형식불량·만료·레거시 거부 |
| 401 | `{error:'SIGNATURE_MISMATCH'}` | 서명 불일치 |
| 500 | `{error:'HANDLER_FAILED'}` | 핸들러 예외 → 서버가 재시도 |
| 500 | `{error:'ADAPTER_MISCONFIGURED'}` | **수신측 설정 오류** — 가장 흔한 원인은 `express.json()` 미마운트 |
| 500 | `{error:'ADAPTER_ERROR'}` | 예상 못 한 예외 — 어댑터가 삼켜 프로세스를 지킨 것 |

`ADAPTER_*` 는 5xx 라 서버가 재시도한다 → 설정을 고치면 재시도가 통과한다(유실 없음).
이 코드는 `GET /api/v1/webhooks/deliveries` 의 `lastResponse` 에서 그대로 볼 수 있다.

> 어댑터가 반환한 핸들러는 **어떤 경우에도 예외를 밖으로 흘리지 않는다**. express 4 는
> async 핸들러의 rejection 을 `next(err)` 로 넘기지 않아 잡히지 않은 rejection 이 곧
> **프로세스 종료**이기 때문이다(= 원격 트리거 가능한 DoS).

## 이벤트 카탈로그

구독 9종 + `webhook.test`(구독 무관 발송).

```
validation.completed | validation.fixable | validation.failed
synthesis.completed  | synthesis.failed
session.validated    | session.failed
book.finalization.completed | book.finalization.failed
```

카탈로그는 **additive 로만** 자란다(기존 이벤트명 삭제/의미변경 없음).
→ **모르는 이벤트에서 던지지 마라.** 던지면 500 → 서버가 4회 재시도하고 EXHAUSTED 로 남는다.
`src/handler.ts` 의 `default` 는 로그만 남기고 지나간다.

`book.finalization.completed` 의 `validationSkipped: true` 는 대조 판형 부재로 워커 검증을
**건너뛰고** 최종화됐다는 뜻이다 — 미검증 FINALIZED 이므로 자동 발주로 흘리지 말고 자체
검수 게이트를 태워라(이 예제가 그렇게 분기한다).

## 레거시 base64 서명은 기본 거부된다

`X-Storige-Signature`(레거시)는 **시크릿이 참여하지 않는다** — `base64(identifier:event:timestamp)`
라 누구나 계산할 수 있다 = **위조 가능**. HMAC 헤더 없이 이것만 오면 SDK 는
`INSECURE_LEGACY_SIGNATURE` 로 거부한다. `allowInsecureLegacy: true` 로만 통과시킬 수 있고,
그 경우 `ctx.insecureLegacy === true` 가 실린다(이 예제는 그때 부수효과를 건너뛴다).

올바른 해법은 이 옵션이 아니라 **서버측 secret 설정**으로 HMAC 헤더를 받는 것이다.

## 파일

| 파일 | 역할 |
|---|---|
| `src/env.ts` | env 파싱·검증 **부팅 시 1회**. `process.env.X!` 안티패턴 금지 |
| `src/app.ts` | express 조립 — `createExpressWebhookHandler` 배선(팩토리가 부팅 시 검증) |
| `src/handler.ts` | 이벤트 분기 + **재조회** + **도메인 멱등** |
| `src/server.ts` | env → 앱 → listen |
| `src/verify.ts` | E2E — 서명을 직접 만들어 위 ①~⑥ 단언 |
