# CONTRACT_FREEZE.md — Storige 플랫폼 계약 표면 동결 (v1.1)

> 작성 2026-07-03 · 근거: Phase 0 정찰 5팀(서명·재검증·보안·계약열거·구현준비) + 적대검증 2렌즈(계약 완전성·diff 회귀) 실코드 대조.
> **무중단 원칙 절대**: 파트너 4종(bookmoa-mobile / Sharesnap / 100p_books / MD2Books)이 오늘 프로덕션에서 의존하는 표면은 시맨틱 변경·제거를 금지한다. 위반 변경은 Review Gate에서 오너 승인 없이 착수 금지.
> **v1.1 변경**: 적대검증(FAIL, P0×3)이 잡은 누락 보강 — 업로드 표면 6종+크기 경계, frame-ancestors(死코드 오판정 → FROZEN 격상), 업로드 응답 shape·NOT_S3·content-type 화이트리스트, 100p 재분류.

## 0. 동결 규약 (Freeze Discipline)

| 분류 | 정의 | 허용 | 조건 |
|---|---|---|---|
| **FROZEN** | 파트너가 실제로 읽는 기존 필드·헤더·응답 키·이벤트명·서명식·경계값 | 시맨틱 변경·제거·이름변경 **금지** | 예외 없음. 변경 필요 시 신규 버전 표면 opt-in 신설 |
| **ADDITIVE** | 기존 표면을 깨지 않고 새 필드/헤더 **추가만** | 조건부 허용 | ① 기존 소비자가 무시해도 동작 불변 증명 ② **contract test 동일 커밋 동시 갱신** ③ 문서 갱신 |
| **MODIFY-TARGET** | 계약 표면이나 보안/버그로 수정 필요 + 소비처 0건 근거 | 오너 승인 + 파트너 4종 grep 확인 후 | thumbnail 유일(§5) |

기존 필드의 enum 확장·null 허용 변경도 시맨틱 변경으로 간주해 FROZEN 취급.

---

## 1. 파트너별 의존 표면

### 1-A. 웹훅 수신 (발신부 = `apps/api/src/webhook/webhook.service.ts`)

| 표면 | bookmoa-mobile | Sharesnap | 100p_books | MD2Books | 분류 |
|---|---|---|---|---|---|
| 웹훅 수신 | O `api/storige/webhook.js` | O `storigeServer.ts` | **X(미사용)** | O(재조회형) | — |
| `X-Storige-Signature` (base64 `id:event:ts`) | 읽음(필수) webhook.js:34 | 읽음 storigeServer.ts:386 | — | 미참조 | **FROZEN** |
| `X-Storige-Event` | 발신 유지 | | — | | FROZEN |
| `X-Storige-Signature-HMAC` (hex `t=,v1=`) | 미읽음 | 미구현 | — | 미참조 | **ADDITIVE**(발신 중, 수신 강제 금지) |
| `X-Storige-Retry: 1` | 무시(서명 필수) | 읽음(retry면 서명 누락 허용) storigeServer.ts:390 | — | 무관 | FROZEN |
| identifier = `jobId ?? sessionId` | 준수 webhook.js:37 | 준수 storigeServer.ts:395 | — | jobId 재조회 | FROZEN |
| 이벤트 7종 (`validation.completed/fixable/failed`, `synthesis.completed/failed`, `session.validated/failed`) | 분기 소비 | 분기 소비 | — | status 재조회 | **FROZEN** |
| replay 신선도 (payload.timestamp ±10분, WH-002) | 검증 webhook.js:134 | — | — | 무관 | FROZEN(발신 timestamp 유지) |

**서명 동결 결론**: 오늘 3개 수신부를 모두 통과시키는 **유일한 서명식 = base64(`identifier:event:timestamp`)**. 이것을 **v1 계약 기준선**으로 동결(webhookVersion=1 기본). HMAC 헤더는 순수 additive이므로 발신 유지하되 **수신 검증 강제 금지**. (§3 서명 대조표 상세)

### 1-B. HTTP API — 다운로드/삭제/검증 (`apps/api`)

| 표면 | 파트너 | 분류 | 근거 |
|---|---|---|---|
| `POST /files/upload/external` (ApiKey+site, multer **100MB**) | 4종 소형 업로드 | FROZEN | files.controller.ts:293, multer 캡 :247/:324 |
| `GET /files/:id/download/external` (ApiKey+site, 무소유검증 특성) | 다운로드 정본 | FROZEN | files.controller.ts:517 |
| `DELETE /files/:id/external` (ApiKey+site, 404=성공) | 파일 정리 | FROZEN | :607, 실구현·활성 |
| `POST /files/:id/expiry/external` (ApiKey+site) | 만료 예약 | FROZEN | :629 → setExpiry(id,parsed,site):655 |
| `GET /files/:id/raw` (@Public+Throttle120, **image 화이트리스트만**) | 이미지 서빙 | FROZEN | PDF/svg 404 배제(권한경계) |
| 검증 result shape `{ isValid, errors, warnings, metadata }` | worker 산출 | FROZEN | **`issues` 아님**. 파트너 기대(100p=issues/MD2=errors) 매핑 어댑터 필요 여부 [미확인] |
| 파일 응답 DTO 키 `id` · `status:'ready'` · `mimeType` | 100p(client.ts:249/253 `json.id`), bookmoa | **FROZEN** | 최상위 `id` 키 하드의존 — 이름변경 시 업로드→검증→주문 전체 파손 |

### 1-C. ★HTTP API — 대용량 업로드 표면 (적대검증 P0 보강 — 파트너 최대 의존)

> **100p_books와 bookmoa는 대용량 PDF(≤2GB 표지/내지)를 이 경로에 필수 의존.** v1.0에서 통째로 누락됐던 최대 표면군.

| 표면 | 파트너 | 분류 | 근거 |
|---|---|---|---|
| `POST /files/presigned-upload-public` (@Public, uploadToken) | 100p(client.ts:281/375), bookmoa(presignedUpload.js:9) | **FROZEN(@Public 무인증)** | R2 직결 ≤2GB. 인증 강제 시 파손 |
| `POST /files/multipart/init` (@Public) | 100p(client.ts:309) | FROZEN | 응답 `{ fileId, uploadUrl, uploadToken }` 3키 필수 의존 (client.ts:340, presignedUpload.js:93) |
| `POST /files/multipart/sign` (@Public) | 100p | FROZEN | part ETag=MD5 |
| `POST /files/multipart/complete` (@Public) | 100p, bookmoa | FROZEN | 응답 최상위 `id` 키 필수 |
| `POST /files/multipart/abort` (@Public) | 100p(고아 abort) | FROZEN | |
| `POST /files/:id/complete` (@Public, 단품) | 업로드 확정 | FROZEN | files.controller.ts:132-214 라우트군 |
| **업로드 크기 경계** | | **FROZEN(경계값)** | multer **100MB**(:247/:324) · 100p **90MB 라우팅 임계**(client.ts:65-66, ≤90MB→multipart / >90MB→presigned) · presigned **2GB** · nginx `client_max_body_size **100M**`(docker/nginx/nginx.conf:56) |
| **`503 + 본문 `STORIGE_NOT_S3`** 폴백 계약 | 100p(client.ts:328 `body.includes('STORIGE_NOT_S3')`) | **FROZEN(에러코드 문자열)** | driver=local 판별→multipart 폴백 트리거 |
| **`ALLOWED_CONTENT_TYPES`** (pdf/jpeg/png/webp/gif, **svg 제외**) | presigned 업로드 | **FROZEN(enum)** | presigned-upload.service.ts:24-31. 축소는 파트너 파손 |

> ⚠️ **크기 경계 상충 확정**: nginx 100M ↔ bookmoa 2GB 클라 캡은 실측 상충. 대용량은 **반드시 presigned 직결 R2 경로**(nginx 우회)여야 동작. PrintCard 대용량 오프로드 설계 시 이 사실 전제.

### 1-D. 임베드/게스트 표면

| 표면 | 파트너 | 분류 | 근거 |
|---|---|---|---|
| `/embed` URL 파라미터 12종(camel/snake 겸용) | bookmoa/Sharesnap iframe | FROZEN | getParamCompat |
| postMessage 엔벨로프 v1 `{source:'storige-editor', version:'1', event, payload, timestamp}` | 임베드 2종 | FROZEN | editor.ready/save/complete/cancel/error/needAuth/state/saved |
| editor.complete payload (files 중첩 + needsAuth/guestToken 인라인) | bookmoa | FROZEN | STALE-CLOSURE-001 |
| `editor.pricingChange` 신규 이벤트 `{sessionId, pageCount, pricing?, coverType?}` (2026-07-06, D-3) | 포토북 호스트(opt-in) | **ADDITIVE** | needAuth 선례의 신규 이벤트명 추가 — 수신부 event 스위치는 미지 이벤트 무시(파트너 4종 영향 0). 발신은 pricing 설정 셋+회원 세션만. 기존 8종 payload 불변 |
| 레거시 `storige:*` dual-emit | bookmoa | FROZEN(하위호환) | parentOrigin 미지정 시 targetOrigin='*' — 신규 연동 혼입 금지 |
| shop-session 응답 shape (accessToken/refreshToken/expiresIn/member) | 임베드 2종 | FROZEN | |
| `POST /worker-jobs/compose-mixed` (@Public, 게스트) | 게스트 편집 | FROZEN(게스트 UX) | siteId=dto.siteId‖null (NULL 격리 결함 §4.3) |
| `POST /worker-jobs/render-pages` (@Public, 게스트) | 게스트 편집 | FROZEN(게스트 UX) | 동일 NULL 결함 |
| `POST /worker-jobs/fix-bleed` (@Public, 게스트) — **ADDITIVE 2026-07-13 신설** | 게스트 편집(BLEED_MISSING extendBleed 실행기) | ADDITIVE→FROZEN(게스트 UX) | body=`{fileId,templateSetId}` 뿐 — editSize 는 서버가 templateSet 권위 산출(임의 사이즈 차단). 잡 siteId=원본 파일 승계‖null. 폴링 `GET /worker-jobs/:id`→`outputFileId`. contract-freeze.spec 동시 등재 |
| 조회: `/edit-sessions/external?orderSeqno=`, `/edit-sessions/my`, `guest/migrate`, `spine/calculate`, `template-sets/:id/with-templates` | 4종 혼용 | FROZEN | 응답 `{data:[{files}]}` shape 포함 |

### 1-E. ★인프라/보안 계약 (적대검증 P0 정정)

| 표면 | 상태 | 분류 | 근거 |
|---|---|---|---|
| **frame-ancestors 허용 도메인** | **라이브 발신 중**(死코드 아님 — v1.0 오판정 정정) | **FROZEN(운영 데이터)** | `apps/editor/vercel.json:28/41` CSP 헤더: `papascompany.co.kr` · `bookmoa.co.kr` · `bookmoa.com` · `bookmoa.net` · `mybookmake.com`(+`*.` 서브) · `*.vercel.app` · localhost. **도메인 제거 = iframe 즉시 차단(무중단 위반)**. 추가는 ADDITIVE |
| `X-Storige-Signature-HMAC`(WH-001) | 발신부 additive 발신(WEBHOOK_SECRET 설정 시) | ADDITIVE | 발신 형식 **hex + `t=<unix>,v1=<hex>` + data 앞 `t.` prefix** 정본 |
| `site.frameAncestors` **DB 필드** | 死코드(getAllFrameAncestors 호출처 0) | 非계약 | 런타임 CSP 주입 신설 시 활성화 후보(Phase 3). 현재 실효 표면은 vercel.json |
| Sharesnap SSRF allowlist | sites 테이블 도메인 allowlist | FROZEN(운영 데이터) | base64 서명 약함을 보완. 언블록은 ops 런북 |
| WEBHOOK_SECRET 상태 | CLAUDE.local.md §5 "no-op"은 **stale** — d441802 이후 사용, 2026-06-23 주입 수정으로 활성 | 운영 비밀 | 회전 시 v2 opt-in 사이트 발생 후 서명 파손 위험 |

### 1-F. WH-005 발신 페이로드 additive 필드
| 필드 | 분류 | 비고 |
|---|---|---|
| `jobId` / `event` / `timestamp` | FROZEN | 서명식·replay 구성 |
| `sessionId` / `orderSeqno` | ADDITIVE(WH-005) | 기존 수신부 무시해도 무해 |
| `fileType?:'cover'\|'content'` | ADDITIVE | session 이벤트, webhook.service.ts:14. 발신 페이로드 전체 스냅샷 골든 고정 권고 |

---

## 2. Phase 0 골든 계약 테스트 대상
발신부 `generateSignature`/`buildHeaders` 시그니처, §1-B/1-C HTTP 표면(요청 DTO·응답 키·경계값·NOT_S3/503), 이벤트 7종, WH-005 필드셋을 골든으로 고정. 기존 `webhook.service.spec.ts`(2.7KB) 커버리지 정독 후 확장. **files 모듈은 현재 .spec.ts 0건** — thumbnail/findExpired 변경의 회귀 그물이 없으므로 신규 spec이 병합 전제.

---

## 3. 서명 3종 대조 요약
| 항목 | 발신부 | bookmoa-mobile | Sharesnap | MD2Books | 100p |
|---|---|---|---|---|---|
| 읽는 헤더 | (발신) X-Storige-Signature + (opt)HMAC | x-storige-signature | x-storige-signature | (서명 미검증) | 미사용 |
| 레거시 서명식 | base64(`id:event:ts`) 항상 | base64 기대 | base64 기대 | 재조회 대체 | — |
| HMAC | hex, `t=,v1=`, data `t.` prefix (secret 시) | base64, prefix 없음 | 없음 | 없음 | — |
| 발신 base64와 일치 | (기준) | ✅ | ✅ | N/A(재조회) | N/A |
| 발신 HMAC와 일치 | (기준) | ❌ 형식 상이 | ❌ 미구현 | ❌ 미검증 | N/A |

**결론**: v1 = base64 동결. HMAC additive 유지. v2 opt-in 시 **bookmoa 수신부를 발신부 형식(hex/`t=`)으로 재작성 선행 필수** — "시크릿만 맞추면 된다"는 오답(형식 자체 불일치).

## 4. 알려진 결함 (오너 결정)
- **4.1** 발신부 HMAC ↔ bookmoa HMAC 경로 형식 불일치 — v2 opt-in 전 bookmoa 수신부 재작성.
- **4.2** Sharesnap retry 서명 누락 허용 vs bookmoa 필수 — 발신부 재시도 서명 포함을 계약 동결로 고정.
- **4.3** NULL-siteId 파일은 `assertSiteAccess`(files.service.ts:333) 무조건 통과 → 테넌트 격리 불가. compose-mixed/render-pages 게스트가 NULL 스탬프. NULL 거부 강화는 레거시 회귀 → 이원 정책(기존 의존분 화이트리스트 + 신규 site 스탬프) 오너 결정.

## 5. thumbnail = MODIFY-TARGET
`GET /files/:id/thumbnail`(files.controller.ts:662) = @Public 무인증 + Throttle 없음 + PDF 전용. raw가 404로 막은 민감 PDF를 UUID만으로 첫 페이지 유출. **소비처 0건 확정**(로컬 editor/admin/api + 파트너 4종 레포 전수 grep, GET /files/:id/thumbnail 호출 0). 수정안은 §Review Gate / code_changes 참조.

## 6. 대상 외 (웹훅 서명 계약 한정)
- **100p_books**: 웹훅 **서명 계약** 대상 외(라우트 부재). ⚠️ 단 **HTTP API(§1-B/1-C)의 최대·최중량 소비자**(client.ts 22KB 전량 연동) — 계약 영향 분석에서 배제 금지.
