# Phase 2 — PHP 회귀 보호 체크리스트 (2026-05-16)

> **목적**: Phase 1-1 (sites 마이그레이션) + Phase 1-2 (CORS/CSP/Webhook 동적 정책) 변경 후
> 운영 중인 bookmoa PHP 가 **기존 `STORIGE_API_KEY` / 기존 코드 변경 없이** 정상 동작함을 보장.
>
> **전제**: Phase 0 결정사항(`PHASE_0_CONTRACT_DECISIONS_2026-05-16.md`) 모두 반영됨.

---

## 1. 자동 회귀 테스트 스크립트

### 사용법
```bash
# 1) 환경 변수 준비
export API_URL="https://api.papascompany.co.kr/api"
export API_KEY="sk-storige-..."   # 기존 PHP 가 쓰던 키와 동일해야 함
export EDITOR_URL="https://editor.papascompany.co.kr"

# 2) 실행
./scripts/test-php-regression-phase2.sh

# 3) (옵션) check-mergeable 까지 검증
export TEST_EDIT_SESSION_ID="<운영 DB 의 실제 session UUID>"
export TEST_COVER_FILE_ID="<운영 cover file UUID>"
export TEST_CONTENT_FILE_ID="<운영 content file UUID>"
./scripts/test-php-regression-phase2.sh
```

### 검증 항목
| # | 항목 | 기대값 |
|---|---|---|
| 1 | `POST /auth/shop-session` | HTTP 200, `success: true`, `accessToken` 발급, `expiresIn: 3600` |
| 2 | `GET /product-template-sets/by-product?sortcode=&stanSeqno=` | HTTP 200 (또는 404 — 데이터 없음), `templateSets` 배열 |
| 3 | snake_case URL 진입 (Editor) | A-2 호환 레이어 — SPA HEAD 200 양쪽 통과 |
| 4 | CORS preflight (`*.papascompany.co.kr`) | `access-control-allow-origin` 헤더 정적 패턴 매칭 |
| 5 | `POST /worker-jobs/check-mergeable/external` | HTTP 2xx, `mergeable` boolean (UUID 제공 시) |
| 6 | webhook host 검증 | 간접 — Pilot 운영에서 실데이터 검증 |

---

## 2. 수동 회귀 시나리오 (배포 직후)

### 2-1. PHP 측 환경 변경 없음 확인
PHP 운영 코드 / `.env` / nginx 설정에 변경이 0 인지 사전 점검:
```bash
ssh deploy@158.247.235.202 'cd ~/storige && git status'   # 운영 컨테이너 측 — 본 레포 변경
# bookmoa 측은 PHP 팀에서 별도로 "코드 변경 없음" 회신 확인
```

### 2-2. shop-session 실호출 (PHP 실서버에서)
PHP 팀에 다음 curl 검증 요청:
```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $STORIGE_API_KEY" \
  -d '{"memberSeqno":12345,"memberId":"test@bookmoa.co.kr","memberName":"테스트"}' \
  https://api.papascompany.co.kr/api/auth/shop-session
```
**기대**: HTTP 200 + `{"success":true,"accessToken":"...","expiresIn":3600,"member":{...}}`

### 2-3. 합성 전 사전 점검 — check-mergeable
실제 운영 중인 편집 세션 ID 1건을 골라:
```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $STORIGE_API_KEY" \
  -d '{
    "editSessionId": "<UUID>",
    "coverFileId": "<UUID>",
    "contentFileId": "<UUID>",
    "spineWidth": 5.5
  }' \
  https://api.papascompany.co.kr/api/worker-jobs/check-mergeable/external
```
**기대**: HTTP 2xx + `{"mergeable":true|false,"issues":[...]}`

### 2-4. 합성 잡 실제 발사 (Pilot 환경에서만)
> 운영 큐 오염 방지를 위해 **스테이징 또는 별도 사이트 컨텍스트**에서만 수행.

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $STAGING_API_KEY" \
  -d '{
    "coverFileId": "<UUID>",
    "contentFileId": "<UUID>",
    "spineWidth": 5.5,
    "bindingType": "perfect",
    "outputFormat": "merged",
    "orderId": "regression-test-999999",
    "callbackUrl": "https://bookmoa.com/storige/proc/synthesis_callback.php"
  }' \
  https://api.papascompany.co.kr/api/worker-jobs/synthesize/external
```
**기대**: HTTP 201 + `{"id":"...","status":"PENDING",...}` (Phase 0 D-8: 클라이언트는 2xx 전체 성공 처리)

### 2-5. webhook 수신 확인
PHP 측 `synthesis_callback.php` 로그에서 다음 확인:
- 수신 헤더 `X-Storige-Event: synthesis.completed`
- 수신 헤더 `X-Storige-Signature: <base64 string>` ← Phase 0 D-3 (HMAC 아님)
- (재시도 발생 시) `X-Storige-Retry: 1` 단, `X-Storige-Signature` 헤더 누락 — Phase 0 D-4

---

## 3. Phase 1 변경이 회귀를 일으킬 수 있는 지점

### 3-1. CORS callback 변경 (main.ts)
- **변경 전**: 정적 origin 리스트만 검사
- **변경 후**: 정적 검사 통과 후, 실패하면 `sitesService.isOriginAllowed()` 동적 검사
- **회귀 위험**: 운영 정적 origin 들이 우선 매칭되므로 PHP 측 영향 0. 단 신규 외부 사이트 추가 시 sites 등록 필요.
- **검증**: 스크립트 4항목 `admin.papascompany.co.kr` preflight 통과 확인.

### 3-2. webhook host 검증 변경 (webhook.service.ts)
- **변경 전**: env `WEBHOOK_ALLOWED_HOSTS` 만 검사
- **변경 후**: env 매칭 실패 시 `sitesService.isWebhookHostAllowed()` 폴백
- **회귀 위험**: 기존 `bookmoa.com` 은 env 기본값에 포함되어 있어 영향 0.
- **검증**: PHP 측 synthesis_callback.php 가 정상 호출되는지 Pilot 단계에서 확인.

### 3-3. sites 테이블 컬럼 추가 (마이그레이션)
- 컬럼은 모두 nullable 또는 default 값 — 기존 row 동작 변경 없음.
- TypeORM synchronize=true (dev) / `20260516_add_sites_external_domain_policy.sql` (prod)
- **롤백 SQL** 마이그레이션 파일 상단 주석 참조.

### 3-4. Editor postMessage / parentOrigin 추가 (A-1)
- `parentOrigin` 옵션은 추가 — 미제공 시 postMessage 비활성화, **콜백 함수는 그대로 동작**.
- 기존 PHP 의 `window.StorigeEditor.create({...})` 호출에 `parentOrigin` 없어도 무해.
- **회귀 위험**: 0.

### 3-5. EditorView snake/camel 호환 (A-2)
- 기존 PHP URL 은 snake_case → 호환 레이어가 camelCase 로 변환해 동일 동작.
- 기존 camelCase URL 도 동일 동작.
- **회귀 위험**: 0 (둘 다 명시된 경우만 camelCase 우선 + 콘솔 경고).

---

## 4. 운영 배포 시점 점검

배포 직후 다음 순서로 5분 안에 확인:

```bash
# 1) API health
curl -s https://api.papascompany.co.kr/api/health | python3 -m json.tool

# 2) 회귀 스크립트 실행
API_URL="https://api.papascompany.co.kr/api" \
  API_KEY="<운영 KEY>" \
  ./scripts/test-php-regression-phase2.sh

# 3) 워커 큐 상태 (배포 직후 미처리 잡 누적 없는지)
ssh deploy@158.247.235.202 \
  'docker exec storige-redis redis-cli LLEN bull:pdf-synthesis:wait && \
   docker exec storige-redis redis-cli LLEN bull:pdf-validation:wait'

# 4) API 로그 (CORS blocked / webhook blocked 패턴 발생 여부)
ssh deploy@158.247.235.202 \
  'docker logs --tail 200 storige-api | grep -iE "CORS blocked|webhook.*blocked|sites-based"'
```

**fail 기준**:
- 회귀 스크립트 FAIL ≥ 1 → 즉시 롤백 후 원인 분석
- `CORS blocked` 로그가 PHP 측 origin 으로 출력 → sites 등록 누락
- `webhook.*blocked` 로그가 `bookmoa.com` host 로 출력 → env / sites 등록 누락

---

## 5. 통과 후 다음 단계

본 체크리스트가 PASS 면:
1. **`bookmoa_platform_plan_20260516.md` Phase 3** (bookmoa-mobile 서버 어댑터) 시작 가능
2. Phase 0 D-4 (webhook 재시도 서명 헤더 누락) 핫픽스 — 별도 PR
3. `/worker-jobs/:id/output` 보안 강화 (D-11) — 별도 보안 리뷰

---

## 6. 산출물 정리

| 파일 | 용도 |
|---|---|
| `scripts/test-php-regression-phase2.sh` | 자동 회귀 테스트 (실행 가능) |
| `docs/PHASE_2_PHP_REGRESSION_CHECKLIST_2026-05-16.md` | 본 문서 — 수동 시나리오 + 회귀 위험 매핑 |
| `docs/PHASE_0_CONTRACT_DECISIONS_2026-05-16.md` | Phase 0 결정 + 코드 현황 (선행) |
| `apps/api/migrations/20260516_add_sites_external_domain_policy.sql` | Phase 1-1 운영 DB 적용 SQL |
