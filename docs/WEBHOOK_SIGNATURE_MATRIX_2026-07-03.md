# 웹훅 서명 3종 대조표 (Phase 0 정본 — 2026-07-03)

> 계획서(PLATFORM_EXPANSION_PLAN §2.3) P0-1 "서명 3중 불일치"의 file:line 실증판.
> **실행형 정본**: `apps/api/src/webhook/webhook-signature-pairwise.spec.ts` — 아래 표의
> 모든 호환/불일치가 green 단언으로 박제돼 있다. 수신부 코드가 바뀌면 spec 스냅샷과 이 표를 함께 갱신.
> 정찰 방식: 4에이전트 병렬(발신부 + 수신부 3종 로컬 레포 직접 열람), 시크릿 값 미포함.

## 1. 발신부 (storige `apps/api/src/webhook/webhook.service.ts`)

| 헤더 | 알고리즘 | 서명 입력 | 인코딩 | 근거 |
|---|---|---|---|---|
| `X-Storige-Signature` (레거시, **항상** 전송) | base64(concat) — 시크릿 불참여(위조 가능) | `${identifier}:${event}:${timestamp}` | UTF-8→base64 단독 | :172-179 |
| `X-Storige-Signature-HMAC` (WH-001, `WEBHOOK_SECRET` 설정 시에만) | HMAC-SHA256 | `${t}.${identifier}:${event}:${timestamp}` (t=발송시각 unix초, payload.timestamp 와 별개) | `t=<unix>,v1=<hex64>` | :187-196 |

- **identifier 규칙**: `'jobId' in payload ? payload.jobId : payload.sessionId` (⚠️ `in` 연산자 — 키 존재 판별)
- timestamp = payload.timestamp(ISO 문자열) 원문. **body 나머지 필드는 서명 미커버**(3필드만).
- 시크릿: 전역 `process.env.WEBHOOK_SECRET` 단일(사이트별 아님 — 크로스테넌트 위조 위험, Phase 2 분리 대상). 미설정 시 HMAC 헤더 자체 생략(silent no-op — 2026-06-23 ⓓ prod 실적발 이력).
- 재시도: 1회, 2초 후, `X-Storige-Retry: 1`. 레거시 서명 불변·**HMAC 은 t 재생성으로 값 변경**.
- 공통 헤더: `X-Storige-Event`. 발송 전 SSRF allowlist 게이트.

## 2. 수신부 3종

| 수신부 | 읽는 헤더 | 검증식 | 실패 시 | 근거 |
|---|---|---|---|---|
| **bookmoa-mobile** | `x-storige-signature` 만 (HMAC 헤더 읽는 코드 **0건**) | secret 미설정: base64(`id:event:ts`) / **설정 시: HMAC-SHA256-base64**(`id:event:ts`) — t= 프리픽스 없음·base64 | **401** + 신선도 ±10분(replay 방어), timingSafeEqual | webhook.js:33-49,128-143 |
| **Sharesnap** | `x-storige-signature` | 순수 base64(`id:event:ts`) — 시크릿 불참여 | **401**. ⚠️ 서명 누락 + `X-Storige-Retry: 1` 이면 **무검증 통과**(구멍) | storigeServer.ts:382-400 + webhook/route.ts |
| **MD2Books** | (서명 안 읽음) | **미검증** — jobId(UUID) 추출 후 `GET /worker-jobs/external/:id` 재조회로 권위 대체(trust-but-verify). body status/result 무시 | 서명 무관 통과. 방어=UUID 형식+60/min 리밋+미상 jobId 무음 200+재조회 | api.v1.webhooks.storige.ts:27-94 |

- 수신부 identifier 규칙: 셋 다 `payload.jobId ?? payload.sessionId` (⚠️ `??` — nullish 판별. 발신부 `in` 과 다름)

## 3. 페어와이즈 매트릭스 (현행)

| 발신 → 수신 | bookmoa(현행: secret 미설정) | bookmoa(secret 설정 시) | Sharesnap | MD2Books |
|---|---|---|---|---|
| 레거시 base64 | ✅ 통과 | ❌ **전량 401** | ✅ 통과 | ✅ (미검증) |
| WH-001 HMAC 헤더 | (안 읽음) | (안 읽음 — 코드 0건) | (안 읽음) | (안 읽음) |

**⇒ 동결 계약 기준선 = 레거시 base64 v1** (모두 통과시키는 유일 형식). WH-001 HMAC 은 소비자 0의 순수 additive.

## 4. 확정 사실 & 함정 (v2 opt-in 설계 구속)

1. **"시크릿만 맞추면 된다"는 오답** — bookmoa 가 `STORIGE_WEBHOOK_SECRET` 를 설정하는 순간, 기대 형식(HMAC-base64, t 없음)이 발신 어느 헤더와도 불일치 → 웹훅 전량 401. **opt-in 은 수신부를 발신 hex/`t=` 형식으로 재작성 선행 필수**.
2. **identifier 연산자 불일치** (`in` vs `??`): payload 에 `jobId: null` 로 키가 존재하면 발신은 `"null:…"` 서명, 수신은 sessionId 로 계산 → 불일치. **발신부는 jobId 를 null 로 스탬프 금지(키 생략)** — 현행 페이로드 빌더는 준수 중이나 신규 이벤트 추가 시 함정.
3. **Sharesnap 재시도 우회 구멍**: 서명 헤더를 빼고 `X-Storige-Retry: 1` 만 붙이면 무검증 통과. bookmoa 는 C-2 에서 동일 구멍 제거됨(문서 AGENTS.md 는 stale). Sharesnap 측 수정 권고(파트너 안내 대상).
4. **MD2Books 는 서명 강화의 영향권 밖** — 어떤 서명 변경에도 파손되지 않음(재조회 아키텍처). v2 롤아웃 순서에서 자유도 최고.
5. HMAC 재시도 시 t 재계산 — 수신측이 (미래에) t 신선도 창을 두면 재시도 자연 통과. 레거시 서명은 재시도에도 불변.
6. bookmoa 신선도 검사(±10분)는 **레거시 경로에도 이미 활성** — 발신 payload.timestamp 가 10분 이상 지연 발송되면 401(큐 적체 시 주의).

## 5. v2 opt-in 게이트 (계획서 §2.3 재확인)

- `sites.webhookSecret`/`webhookVersion` additive 마이그레이션 → 파트너별 opt-in. **일괄 전환 금지**.
- opt-in 조건: ① 수신부를 발신 WH-001 형식(`t=,v1=hex`, `X-Storige-Signature-HMAC`, 입력 `${t}.${id}:${event}:${ts}`)으로 재작성 ② 본 페어와이즈 spec 에 해당 수신부 스냅샷 갱신 후 green ③ 사이트별 secret(전역 금지).
- 전역 WEBHOOK_SECRET 로 2개 이상 파트너 동시 HMAC 활성 금지(크로스테넌트 위조).
