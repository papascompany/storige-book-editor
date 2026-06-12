# HANDOFF — sharesnap × Storige 편집기 연동 지시문

> **작성**: 2026-06-12 (storige 세션)
> **대상**: sharesnap 프로젝트 작업 세션 (다른 레포/세션)
> **짝 문서(storige 레포)**:
> - `docs/BOOKMOA_INTEGRATION_GUIDE.md` — 원조 연동 가이드 (PHP 기준이지만 API 계약 동일)
> - `docs/SYSTEM_INTEGRATION_OVERVIEW.md` — 시스템 전체 구성 (v2.6)
> - `.cursor/plans/HANDOFF_StorigeEditorHost_iframe_overlay_2026-05-31.md` — bookmoa-mobile 호스트 측 iframe 계약 (sharesnap이 가장 가깝게 따라할 모델)
> - `.cursor/plans/HANDOFF_Storige_postMessage_standardize_2026-06-01.md` — postMessage 규약 상세

---

## 0. TL;DR

sharesnap이 bookmoa처럼 Storige 편집기를 쓰려면:

1. **(storige 측, 5분)** Admin > Sites 에서 "sharesnap" 사이트 등록 → `editorAuthCode`(API 키) 자동 발급, 도메인 allowlist 설정.
2. **(sharesnap 측)** 백엔드가 `POST /auth/shop-session`(X-API-Key)으로 JWT 발급 → 프론트가 `https://editor.papascompany.co.kr/embed?...` iframe 오픈 → `editor.complete` postMessage 수신 → 백엔드가 합성 트리거/웹훅 수신 → PDF 다운로드.

**Storige 코드 변경 0** (멀티사이트 구조 이미 가동 중 — bookmoa·점보카드가 같은 방식). 신규 상품이 필요하면 Admin에서 템플릿셋/상품 등록만 추가.

---

## 1. 아키텍처 (현행, bookmoa 모델 그대로)

```
┌──────────────────────────── sharesnap ────────────────────────────┐
│  프론트 (고객 브라우저)                백엔드 (서버)                  │
│  ┌──────────────────────┐         ┌──────────────────────────┐    │
│  │ iframe               │         │ 1. shop-session JWT 발급  │    │
│  │  /embed?token=...    │         │ 2. 합성 잡 트리거          │    │
│  │  postMessage 수신     │         │ 3. 웹훅 수신(선택)         │    │
│  └──────────────────────┘         │ 4. 결과 PDF 다운로드       │    │
│            │                      └──────────────────────────┘    │
└────────────┼──────────────────────────────┼───────────────────────┘
             │ iframe (브라우저)              │ X-API-Key (서버 간)
             ▼                              ▼
   editor.papascompany.co.kr      api.papascompany.co.kr/api
   (Vercel, /embed 라우트)         (VPS NestJS + Worker/큐)
```

- **인증 2층**: 서버 간 = `X-API-Key`(사이트별 `editorAuthCode`), 브라우저 = shop-session JWT(`token` 파라미터).
- **사이트(테넌트) 격리**: `sites` 테이블 1 row = 1 외부 서비스. CORS / iframe CSP(frame-ancestors) / 웹훅 SSRF allowlist / JWT의 `siteId` 모두 이 row 기준.
- **편집기 진입은 반드시 `/embed` 라우트** (`/` 는 레거시 — 완료 메시지 미발신).

---

## 2. Storige 측 대응 (우리가 할 일)

| # | 작업 | 위치 | 상태 |
|---|------|------|------|
| S1 | Admin > Sites 에 "sharesnap" 등록 (`POST /sites` — name, domain) → `editorAuthCode`/`workerAuthCode` 자동 생성 | https://admin.papascompany.co.kr > 기본설정(Sites) | ⬜ 도메인 확정 대기 |
| S2 | `allowedOrigins` 에 sharesnap 도메인(들) 추가 — CORS 허용 | 같은 화면 | ⬜ |
| S3 | `frameAncestors` 에 sharesnap 도메인 추가 — iframe 임베드 CSP 허용 | 같은 화면 | ⬜ |
| S4 | `uploadCallbackUrl` 설정(웹훅 push 원하면) + `returnUrlBase`(보관함 URL) | 같은 화면 | ⬜ 선택 |
| S5 | 발급된 `editorAuthCode` 를 sharesnap 팀에 안전 채널로 전달 (절대 커밋/로그 금지) | — | ⬜ |
| S6 | sharesnap 상품용 **템플릿셋/상품 등록** (기존 북 템플릿 재사용이면 생략) | Admin > 템플릿셋/상품 | ⬜ 상품 정의 대기 |
| S7 | 연동 스모크 테스트 (shop-session → /embed 오픈 → 완료 → 합성 → 다운로드 E2E) | — | ⬜ S1~S5 후 |

> S1 등록 시 인증코드는 `sk-storige-<48hex>` 형식으로 자동 생성. 재발급은 `PATCH /sites/:id/regenerate`.
> **bookmoa 키 공유 금지** — 반드시 sharesnap 전용 site row + 전용 키. (사이트별 정책·웹훅·통계 격리)

---

## 3. sharesnap 세션 지시문 (구현 작업)

### 3.1 사전 정보 (storige 운영자에게 받기)

```
STORIGE_API_URL    = https://api.papascompany.co.kr/api
STORIGE_EDITOR_URL = https://editor.papascompany.co.kr
STORIGE_API_KEY    = (S5에서 전달받은 sharesnap 전용 editorAuthCode — 서버 환경변수로만 보관)
templateSetId      = (S6에서 등록된 상품별 템플릿셋 ID)
```

### 3.2 백엔드 — 편집기 토큰 발급 API

고객이 "편집하기"를 누르면 sharesnap 백엔드가 Storige에 JWT를 요청한다.

```
POST {STORIGE_API_URL}/auth/shop-session
Headers: X-API-Key: {STORIGE_API_KEY}, Content-Type: application/json
Body:
{
  "memberSeqno": 123,            // ⚠️ 필수, 로그인 회원의 고유번호(정수, 0/누락이면 400 MEMBER_REQUIRED)
  "memberId": "user@sharesnap.com",
  "memberName": "홍길동",
  "orderSeqno": 45678            // 권장 — 주문 컨텍스트가 명확하면 전달(권한 검증 강화)
}
→ 200 { success, accessToken, refreshToken, expiresIn, member }
```

- `memberSeqno` 는 **sharesnap 자체 회원번호** 체계 사용 (Storige가 사이트별로 격리 저장).
- `accessToken` 만료 1h. 장시간 편집 대비 `refreshToken` 을 iframe URL에 함께 전달하면 편집기가 사일런트 리프레시 함.
- 이 호출은 **반드시 서버에서** — API 키를 브라우저에 노출 금지.

### 3.3 프론트 — iframe 임베드

```html
<!-- 신규 편집 -->
<iframe src="https://editor.papascompany.co.kr/embed
  ?templateSetId={tsId}
  &token={accessToken}
  &refreshToken={refreshToken}
  &orderSeqno={주문번호}
  &parentOrigin={encodeURIComponent(location.origin)}
  &pageCount=&paperType=&bindingType=        // 상품옵션(선택)
  &quantity=&title=                           // 주문 메타 스냅샷(선택)
" allow="clipboard-write" style="..."></iframe>

<!-- 재편집 (장바구니/주문내역 '수정') -->
/embed?sessionId={저장해둔 sessionId}&token={accessToken}&parentOrigin=...
```

- 파라미터는 camelCase/snake_case 양쪽 허용.
- `parentOrigin` **반드시 전달** — 미전달 시 postMessage가 `'*'` 로 발신돼 보안상 비권장.

### 3.4 프론트 — postMessage 수신 (정식 엔벨로프 사용)

신규 연동이므로 레거시(`storige:*`)가 아닌 **정식 엔벨로프만** 수신한다:

```js
window.addEventListener('message', (e) => {
  if (e.origin !== 'https://editor.papascompany.co.kr') return
  const msg = e.data
  if (msg?.source !== 'storige-editor') return
  switch (msg.event) {
    case 'editor.ready':    /* 로딩 스피너 제거 */ break
    case 'editor.save':     /* 중간저장 알림(선택) */ break
    case 'editor.complete':
      // msg.payload: { sessionId, orderSeqno, status, completedAt, files: { coverFileId, contentFileId } }
      // ① sessionId 를 주문/장바구니에 저장 (재편집 키)
      // ② 백엔드에 완료 통지 → 합성 트리거(3.5)
      break
    case 'editor.cancel':   /* iframe 닫기 */ break
    case 'editor.needAuth': /* 게스트 폴백 상태 — 로그인 유도 */ break
    case 'editor.error':    /* 에러 표시 */ break
  }
})
```

### 3.5 백엔드 — 주문 확정 시 PDF 합성 트리거

```
POST {STORIGE_API_URL}/worker-jobs/compose-mixed
Headers: X-API-Key: {STORIGE_API_KEY}
Body: { "editSessionId": "{sessionId}", "orderSeqno": 45678, ... }
```

- 합성 완료는 ① 폴링 `GET /worker-jobs/{jobId}` 또는 ② 웹훅(S4 설정 시, 아래 3.6).
- **스프레드(펼침면) 책 상품은 서버가 분리 2파일을 강제** → 결과가 `cover.pdf` + `content.pdf`. 단일 파일 가정 금지.
- 내지 PDF 표시전용(underlay) 세션은 내지 인쇄 = **고객이 첨부한 원본 PDF 그대로** (편집 내용 미반영) — 상품 정책에 반영할 것.

### 3.6 백엔드 — 웹훅 수신 (선택)

S4에서 `uploadCallbackUrl` 을 설정하면 합성 완료 시 Storige가 push:

```
POST {sharesnap의 uploadCallbackUrl}
Headers: X-Storige-Event: <event>, X-Storige-Signature: <서명>
Body: { event, ... }   // 10s 타임아웃, 실패 시 1회 재시도(X-Storige-Retry: 1)
```

- 수신부는 **2xx 빠른 응답** 후 비동기 처리 권장.
- 콜백 호스트는 Storige 측 allowlist(S2 도메인) 검증을 통과해야 함 — 도메인 변경 시 storige 운영자에게 통보.

### 3.7 백엔드 — 결과 PDF 다운로드

```
GET {STORIGE_API_URL}/files/{fileId}/download/external
Headers: X-API-Key: {STORIGE_API_KEY}
```

- ⚠️ 구 `/files/:id/download` (Public) 아님 — 2026-05-03 보안 패치 이후 `/external` + X-API-Key 가 정식 경로.
- `fileId`/`sessionId` 를 고객 브라우저에 불필요하게 노출하지 말 것.

### 3.8 구현 체크리스트 (sharesnap 세션용)

- [ ] 서버: shop-session 프록시 엔드포인트 (3.2) — API 키는 서버 env
- [ ] 프론트: 편집기 오픈 UI + iframe 마운트 (3.3)
- [ ] 프론트: 정식 엔벨로프 수신 핸들러 (3.4) — `e.origin` 검증 필수
- [ ] 데이터: `sessionId` 저장 스키마 (주문/장바구니 라인 단위) + "수정" 버튼 → `/embed?sessionId=`
- [ ] 서버: 주문 확정 → compose-mixed 트리거 (3.5)
- [ ] 서버: 웹훅 수신 또는 잡 폴링 (3.6)
- [ ] 서버: PDF 다운로드/보관 (3.7)
- [ ] E2E: 신규편집 → 완료 → 재편집 → 주문 → 합성 → 다운로드 전체 1회

---

## 4. bookmoa 연동과 다른 점 / 주의

| 항목 | bookmoa (레거시 누적) | sharesnap (신규 권장) |
|---|---|---|
| postMessage | 레거시 `storige:*` + 정식 dual 수신 | **정식 엔벨로프만** (`editor.*`) |
| PDF 다운로드 | 구 Public 경로에서 마이그레이션 중 | 처음부터 `/external` + X-API-Key |
| API 키 | .env API_KEYS 시드 시절 키 | Sites 등록으로 발급된 전용 키 |
| 편집기 로드 | PHP IIFE 번들 + /embed 혼용 | **`/embed` iframe 단일** (IIFE 번들 불필요) |

공통 함정:
- `memberSeqno` 누락/0 → 400 MEMBER_REQUIRED (게스트 폴백으로 열리긴 하나 완료 시 `editor.needAuth` 로그인 유도 — 정석은 회원 토큰).
- 합성 결과 2파일(cover+content) 가능성 항상 처리.
- 도메인 추가/변경(스테이징 포함) 시 storige Sites 의 `allowedOrigins`/`frameAncestors` 동기화 필요 — 안 하면 CORS/CSP로 무음 차단.

---

## 5. 미확정 항목 (sharesnap 측이 storige 운영자에게 회신)

1. **도메인**: 운영/스테이징 origin 목록 (S2·S3에 등록할 값)
2. **상품 구성**: 어떤 인쇄 상품? (포토북/카드/낱장 등 — S6 템플릿셋 등록 범위 결정)
3. **웹훅 사용 여부**: push 받을 endpoint URL (S4) vs 폴링만
4. **회원 체계**: memberSeqno 로 쓸 고유번호 필드 확정

---

## 6. ShareSnap 평가서 검증 결과 (2026-06-12 추가)

ShareSnap 세션의 `docs/storige-integration-assessment.md` 평가서를 storige 코드 기준으로 전수 검증했다. **주장 전부 사실 확인**:

| 평가서 주장 | 검증 | 근거 |
|---|---|---|
| 외부 사진 주입 인터페이스 없음 | ✅ 사실 | `useImageStore.ts` — 이미지 패널은 `selectFiles`/`File` 로컬 업로드 전용. URL 주입 표면 없음 |
| 캔버스 핀치줌 미구현 | ✅ 사실 | `docs/MOBILE_TOUCH_UI.md` §개선과제 — "캔버스 자체 핀치-투-줌 제스처 미구현" 명시 |
| PDF 1차 생성이 브라우저 실행 | ✅ 사실 | `useWorkSave.completeSpreadWork` → `saveMultiPagePDFAsBlob`(클라 300dpi) → 업로드. 워커는 합성/검증만 |
| CSP frame-ancestors 개발 허용 | ✅ 사실 | `apps/editor/vercel.json` — `localhost:3000`, `*.vercel.app` 포함 |
| Fabric 5.5.2 + 커스텀 속성 다수 → 직접 JSON 조작 불가 | ✅ 타당 | `storige_session_id` 참조 모델 권장 동의 (fabric_data 직저장 금지) |

**완화 사실 1건**: "사진 주입" 갭은 평가보다 작다 — 캔버스 코어에 `imageFromURL` + 잠금배경 배치 인프라가 이미 가동 중(내지 PDF 가이드가 이 경로 사용). 신규 개발은 **노출 표면(API/패널 탭)** 이지 렌더링 엔진이 아니다.

### 6.1 Storige 측 신규 개발 항목 (§2 표에 추가)

| # | 작업 | 설계 방향 | 추정 |
|---|------|----------|------|
| D1 | **외부 사진 주입** | ① 세션 `metadata.externalPhotos: [{url, name, thumbnailUrl?}]` — 호스트 서버가 세션 생성 시(또는 PATCH) 주입 ② 편집기 이미지 패널에 "공유방 사진" 탭 — 목록 렌더 + 탭하면 `imageFromURL` 로 캔버스 추가 ③ (선택) postMessage `host.addImages` 명령. CORS: 사진 호스트(Supabase Storage)가 editor origin 허용 필요 | 3~5일 |
| D1-UX | **UI 방식 (2026-06-12 검토, CTO 확인 대기)** | **A안 = 공유방 갤러리(파일브라우저) 탭 권장.** 근거: ⓐ 공유방 사진은 **타 참여자가 올린 것** — 고객 기기 갤러리에 없어 로컬 업로드(B안)로는 기능 자체가 성립 안 함 ⓑ 기존 모바일 4MB 가드가 원본 카메라 사진(HEIC/JPEG 3~12MB) 다수 차단 — B안과 정면 충돌 ⓒ 재업로드 데이터 비용·중복 저장 0. **B안(로컬 업로드)은 기존 패널이 이미 제공** — "내 업로드" 탭으로 병존(신규 개발 0, 공유방에 없는 사진 추가용 보조). UX 디테일: 탭=즉시 캔버스 추가(현행 '나의 콘텐츠'와 동일 1-tap), 사용됨 체크 뱃지(포토북 '안 쓴 사진' 파악 핵심), 정렬 칩(시간순/올린사람/안 쓴 사진), 썸네일 lazy-load. **인쇄해상도 정책**: ShareSnap이 공유방 업로드 시점에 인쇄용 리사이즈본(긴변 3000~4000px, JPEG ~2-3MB) 사전 생성해 `url`로 제공, `thumbnailUrl`은 ~300px — 모바일 메모리와 300dpi 인쇄품질 양립의 유일한 안전 경로 | (D1에 포함) |
| D2 | **캔버스 핀치-투-줌** | Fabric `touch:gesture` 또는 pointer events 2지 추적 → `canvas.zoomToPoint`. 기존 `touch-action: none` 기반이라 충돌 없음. WorkspacePlugin 줌 API 재사용 | 3~5일 |
| D3 | **사진+코멘트 자동배치** (협의) | 표준 계약 밖. 권장: 템플릿에 이미지 프레임(placeholder) N개 정의 → `externalPhotos` 순서대로 자동 채움 + 코멘트는 텍스트 placeholder. D1 완료 후 별도 스코프 | 미정 (결정 ②) |

### 6.2 리스크 대응 방침

1. **브라우저 PDF 생성 타임아웃(24p/180초 실측)**: 단기 = sharesnap 포토북 `pageCountRange` 상한 정책(모바일 기준 ≤24~32p 권장, 기존 제본별 페이지 가드 A13 인프라 재사용). 장기 = 워커 서버렌더(GS 래스터 인프라 존재하나 별도 프로젝트, 합성 아닌 1차 생성까지 워커 이관은 대규모).
2. **표지 모델**: storige 책 상품의 네이티브 모델 = 스프레드(뒤표지+책등+앞표지 단일 캔버스, 책등 가변폭). ShareSnap이 이를 수용하는 것을 강력 권장 — 분리 모델 신규 개발은 무결성 체인(metadata.spread ↔ cover.pdf MediaBox 검증) 전체를 재설계해야 함.

### 6.3 ShareSnap 어댑터 계층 (평가서 동의 + 보강)

- `photobook_pages.fabric_data` 직저장 ❌ → **`storige_session_id` 참조 모델** ✅ (§3.4의 sessionId 저장과 동일)
- `/api/storige/*` 서버 어댑터: API Key 서버 전용 (§3.2와 동일)
- **Supabase UUID ↔ memberSeqno 매핑**: shop-session의 `memberSeqno`는 정수 필수. 권장 = sharesnap DB에 `users.storige_member_no BIGINT` (시퀀스/IDENTITY) 컬럼 추가, UUID당 1회 발급·영구 고정. 해시 변환은 충돌 위험으로 비권장.
- 사진 URL 수명: `externalPhotos` URL은 편집기가 로드 시점에 fetch — **만료되는 signed URL 금지**, public bucket 또는 장수명 URL 사용. 재편집 시에도 같은 URL로 다시 로드됨을 유의.
