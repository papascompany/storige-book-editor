# RESUME PROMPT — Storige (2026-06-05 인수인계)

> 새 세션 시작 시 **이 파일 먼저 읽기**. 프로토콜: `CLAUDE.local.md` → 최신 RESUME_PROMPT → `git log --oneline -15`.
> 응답 한국어. 커밋 끝에 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
> 운영: master push → editor/admin **자동배포(Vercel)**. **API·worker 는 수동배포**(`ssh deploy@158.247.235.202 'cd ~/storige && git pull origin master && docker compose up -d --build api worker'`). 프로덕션 고객 실사용 중 — 빌드/테스트 후 진행.

---

## 0. 이번 사이클(2026-06-04~05) 완료·배포 내역 (전부 라이브)

| 영역 | 커밋 | 상태 |
|---|---|---|
| 편집완료 PDF 프리즈 **하드닝+Sentry 단계계측** (finishMark/withWatchdog) | `19158f8` | ✅ editor 배포. **프리즈 핫스팟 정밀특정은 Sentry 데이터 대기** |
| 임베드 **뒤로가기 데이터 무결성 가드**(useEmbedBackGuard) | `256b517` | ✅ |
| **호스트 연동 핸드셰이크**(host→editor: getState/saveNow/setBackGuard, editor.state/saved) | `d964f73` | ✅ 라이브 e2e 검증. bookmoa 가이드 `HANDOFF_bookmoa_back_navigation_2026-06-04.md` |
| PDF 첨부 검증 **책등(spine) 정합 + 날개(wing)** (orderOptions spineWidthMm/wingEnabled/wingWidthMm, 하위호환) | `ed9cacd` | ✅ api+worker 재배포. **bookmoa 액션 대기**(아래 §1) |
| 검증 **병렬화**(Promise.all) + 폰트 **음수캐시** + 타입오류 1건 수정 | `bb73a86` | ✅ |
| 글리프 검증 **폰트당1회·병렬** + 워커 검증 **동시성 3**(`VALIDATION_CONCURRENCY`) | `2e27dae` | ✅ worker 재배포 |
| 문서: `EDITOR.md` §16/§17/§17.1/§18, `PDF_VALIDATION_GUIDE.md`, `SYSTEM_INTEGRATION_OVERVIEW.html/.md ⑥⑦`, INDEX, bookmoa 핸드오프 2종 | `91bd46e`/`13c8b8d`/`c62e945`/`34131b5`/`d588939` | ✅ |

전체 워크스페이스 타입체크 = 오류 0(수정 후). 테스트: canvas-core 214, 워커 validator 27 + processor 6 통과.

## 1. 다음 작업 후보 (우선순위)

### 🟡 bookmoa 측 액션 대기 (Storige 변경 불필요)
- 검증 요청에 `spineWidthMm`(=`/products/spine/calculate` 의 `spineWidth`)·`wingEnabled`/`wingWidthMm` 전달해야 책등/날개 검증 발효. 호출 위치: bookmoa `StorigeFileUploadPanel.startValidation()` → 어댑터 `api/storige/validate.js` → `/worker-jobs/validate/external`. 지시문: `HANDOFF_bookmoa_validate_fields_2026-06-04.md`.
- bookmoa 뒤로가기 호스트 핸드셰이크 적용(Tier A) — `HANDOFF_bookmoa_back_navigation_2026-06-04.md`.

### 🔴 보류 — 데이터/계측 선행 필요
- **스프레드 편집완료 PDF 프리즈 근본수정(Patch C/D)**: 로컬 재현 불가(환경/스케일). **Patch B(19158f8)의 Sentry `[finish] …` 단계 마커**가 다음 프로덕션 실패에서 핫스팟을 알려줌 → 그 데이터로 ① 풋프린트 축소(메모리면 캔버스 dispose/opencv 언로드) 또는 ② 워커 서버사이드 생성(Puppeteer) 중 선택. 설계: `SPREAD_PDF_FREEZE_FINDINGS_2026-06-03.md`.
- **woff2ToTtf 404 + `library_fonts` 0행**: 폰트 시딩(제품 결정)과 함께 진행해야 PDF 텍스트 아웃라인화 동작. (현재 catch 처리·회귀 없음)

### 🟢 갭 잔여(미착수) — `EDITOR_TEMPLATE_ASSET_GAP_2026-06-02.md`
- P0-2 편집기 pdfjs 파이프라인 / P1-4 사진틀 / P2 면지·WYSIWYG.

## 2. 운영 핵심 (상세 CLAUDE.local.md)
- editor: Vercel `storige-editor` 자동배포. editor `vercel.json` 이 types→canvas-core→editor 순 빌드 → canvas-core 변경도 반영됨.
- api/worker: 수동 `docker compose up -d --build api worker`. prod `synchronize:false` → 엔티티 컬럼 추가 시 prod ALTER 선행(이번 검증 변경은 JSON 큐 페이로드라 DB 변경 없었음).
- QA 토큰: `POST /api/auth/shop-session` (X-API-Key=STORIGE_API_KEY). QA 세션은 `UPDATE … SET deleted_at=NOW()` soft-delete.
- 검증 동시성 운영 튜닝: worker `.env` 에 `VALIDATION_CONCURRENCY`(기본 3) 추가 가능.
- dev 재현 하니스(미커밋): `apps/editor/repro.html`/`repro-cover.tsx`/`__repro_cover.json`. 프로덕션 편집기 framing 은 CSP frame-ancestors(`*.papascompany.co.kr/*.bookmoa.co.kr/*.vercel.app`)만 허용(localhost 불가).

## 3. 핵심 파일 빠른참조
- 임베드/핸드셰이크/뒤로가기: `apps/editor/src/embed.tsx`, `hooks/useEmbedBackGuard.ts`.
- PDF 생성/글리프/음수캐시: `packages/canvas-core/src/plugins/ServicePlugin.ts`, `FontPlugin.ts`.
- 검증: `apps/worker/src/services/pdf-validator.service.ts`, `processors/validation.processor.ts`, `apps/api/src/worker-jobs/`.
- 책등 계산: `apps/api/src/products/spine.service.ts` (`/products/spine/calculate`).
- 문서 인덱스: `docs/INDEX.md`, `docs/EDITOR.md`(§18 최신), `docs/PDF_VALIDATION_GUIDE.md`.
