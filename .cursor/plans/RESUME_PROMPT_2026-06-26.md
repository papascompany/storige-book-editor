# RESUME PROMPT — 2026-06-26

> 이전 세션의 "지금 작업 중" 정본 포인터. 새 세션은 이 파일 + `CLAUDE.local.md` + `git log --oneline -15` 먼저 확인.
> 직전 정본: `RESUME_PROMPT_2026-06-23.md`(전체 감사 P0/P1/R4). 본 세션 = **두 트랙 병행**:
> ① 포토북(Photobook) TemplateSetType  ② bookmoa 고객 PDF 검증 연동(데이터주도 페이지수 + fix-pagecount).

---

## 0. ⚠️ 경로 (가장 먼저)
- 레포: https://github.com/papascompany/storige-book-editor (PUBLIC, master)
- 로컬: `/Users/yohan/Developer/Bookmoa Storige editor/storige`
- 배포: **editor/admin = Vercel(master push 자동)** · **api/worker = VPS 수동**(`ssh deploy@158.247.235.202`, `cd ~/storige && git pull && docker compose up -d --build api worker` + ⚠️ api 재배포 시 `docker compose restart nginx`(502 방지) — [[feedback_api_redeploy_nginx]])
- 타입빌드 선행: `pnpm --filter @storige/types build`

---

## 1. 현재 배포 상태 (전부 LIVE·정상)
| 서비스 | 상태 |
|---|---|
| **editor** (Vercel 자동) | 포토북 펼침면 2-up 렌더 + 콘텐츠 생성 트리거 LIVE(`fde9e3b`·`cc73cc1`). 공유 UX(z-order·삭제모달·레이어DnD) LIVE. |
| **admin** (Vercel 자동) | 포토북 내지 펼침면 등록 폼(regionScope cover/inner) LIVE. |
| **api/worker** (VPS 수동) | 데이터주도 페이지수 검증(`6d0cb76`) + **fix-pagecount 엔드포인트**(`972e2b1`) LIVE. `WORKER_MAX_FILE_SIZE=2GB`. |
- 헬스 확인됨: API 200 · `POST /worker-jobs/fix-pagecount/external` 401(라우트 LIVE) · worker "Nest application successfully started".

---

## 2. 직전 세션 완료 내역 (커밋 396ac7f → 77e161c)

### 트랙 A — 포토북 TemplateSetType (신규 상품)
**정본**: `.cursor/plans/PHOTOBOOK_TEMPLATE_DESIGN_2026-06-23.md` · `PHASE1_CHECKPOINT_2026-06-23.md` · 스킬 `.claude/skills/photobook-template/SKILL.md` · 메모리 [[project_photobook_template]].
- **핵심 원칙**(절대 위반 금지): 공통 편집기 UX(에셋/객체컨트롤/레이어/삭제/모바일)는 **상품 비종속 공유 계층** — `TemplateSetType` 게이팅 0건. 포토북 고유=펼침면표지+싸바리·펼침면내지·자동배치·가격·래스터뷰어 5영역뿐.
- Phase 1(공유 S1/S3 + 포토북 P1~P4) · Phase 2(EXIF 자동편집 `a0d5f0a`) · Phase 3(자동배치 엔진·3겹가이드 `68cfc7b`·`6c35c96`) · 가격연동(`dcc0a07`, +🔴 차단 DTO버그 `@IsEnum(['book','leaflet'])` 수정).
- **O-2 펼침면 2-up 내지 (이번 세션 핵심)**:
  - 모델토대(`5e426af`): types `SpreadInnerSpec`/`SpreadInnerLayout`/`SpreadPairMeta` + `SpreadConfig.regionScope/innerSpec`(additive) + canvas-core `computeInnerSpreadLayout`(순수, trim=pageW*2×pageH, 거터 중앙).
  - 에디터 렌더(`eb77f0b`): SpreadPlugin `initInner`(거터 제본선+밴드+좌우 라벨+bleed) · `photobookSpread.ts` 순수헬퍼 · createCanvas/addPage 배선 · PageNavigation 페어라벨. **한 캔버스=한 펼침면 ⇒ 좌/우 페어 구조적 무결**(재정렬해도 안 깨짐).
  - 콘텐츠 트리거(`fde9e3b`): `loadSpreadModeEditor` 가 `spreadTemplate.spreadConfig.regionScope==='inner'` 감지 → N펼침면 캔버스 생성(물리 pageCount→spreadCount=ceil/2) · `TemplateEditorView` admin URL spec inner 파싱→템플릿 저장 · embed pageCount=캔버스×2 · admin 등록폼. **게이트=regionScope:'inner', 표지/BOOK/LEAFLET/bookmoa byte-identical(diff검증).**
  - 브라우저 검증(`cc73cc1`): preview 도구로 `/template?mode=spread&spec={regionScope:inner}` 로딩 → 2-up 거터/좌우라벨 정상렌더 시각확인. cover 동일 dispose 에러 = dev StrictMode 아티팩트(회귀 아님). 헤더 치수표기 폴리시.
- **검증**: canvas-core 324/324 · editor tsc0+vite+182/182.

### 트랙 B — bookmoa 고객 PDF 검증 연동
**정본**: `.cursor/plans/RESPONSE_storige_validation_bypass_review_2026-06-25.md` ~ `RESPONSE5_pagecount_fix_endpoint_2026-06-25.md`(5종) · `docs/PLATFORM_INTEGRATION_GUIDE.md`(§2.4~2.6) · `docs/PDF_VALIDATION_GUIDE.md` · 메모리 [[project_pdf_upload_validation]].
- **검증우회 교차검증**(`1be3461`): bookmoa `skipFileValidation`(프론트 게이트만) = worker 계약 무위배·타사이트 무영향 확정. retention=`expires_at` 전용(검증상태 무관, NULL=영구), 합성=명시만, 검증결과 후속 자동동작 0.
- **실배포 확인**: `WORKER_MAX_FILE_SIZE=2GB`(env, 코드폴백 100MB 오버라이드) · sites.retention_days 전부 NULL(영구).
- **데이터주도 페이지수 검증**(`6d0cb76`, LIVE): `orderOptions.pageMultiple/pageCountMax/pageCountMin`(optional) → worker가 binding 하드코딩 대신 값으로 검증. 배수위반→`PAGE_COUNT_INVALID`(autoFix addBlankPages)·상한→`PAGE_COUNT_EXCEEDED`·하한→신규 `PAGE_COUNT_BELOW_MIN`(경고). 미전송=레거시 byte-identical.
- **binding canonical 교차검증**(RESPONSE3/4): 페이지수는 데이터주도(binding 무의존)지만 **스파인계산(binding_types DB code 4종 perfect/saddle/spiral/hardcover, 없으면 404) + 합성기**는 binding 문자열 사용 → 파트너는 **canonical 4종으로 매핑**(A안). bookmoa 적용·검증완료(`5bcaae4`): 무선/PUR→perfect·중철/계단식→saddle·양장/반양장→hardcover·스프링→spiral.
- **fix-pagecount 엔드포인트**(`972e2b1`·`77e161c`, LIVE): d1 빈페이지 실행기. **기존 변환(pdf-conversion `addPages` + `registerExternalFile`) 재사용**. worker `ConversionOptions.padToMultiple`(targetPages=ceil(현재/배수)*배수). api `POST /worker-jobs/fix-pagecount(+/external)` `{fileId,targetMultiple}`→비동기 jobId, 폴링 `GET /worker-jobs/external/:id`→`outputFileId`(원본 보존·site/order 승계·멱등). worker 380/380·api 206/206.

---

## 3. 🚦 다음 세션 우선 처리

### A. 포토북 잔여 (트랙 A 이어가기)
1. **출력 펼침면 좌우분할(O-4)** + 300dpi 래스터 — content.pdf 2배폭 페이지를 좌/우 print-ready로(워커 layout 메타 주입). **워커 작업, 오너 결정 O-4 게이트.**
2. **per-region 편집경계·침범 크롭·파노라마**(§6) — 2-up 모델 위에 좌/우면 편집경계.
3. **자동배치 UI 프레임 배선** — `photoPlacement.ts autofillPhotosIntoFrames` → `AppImage` 호출처 연결(엔진은 구현됨, 배선만).
4. **실 photobook 템플릿셋 E2E** — admin 등록→편집기 N펼침면 렌더 육안(현재 TemplateEditorView inner만 시각확인).
5. **오너 결정 대기**: O-1 싸바리 정밀geometry · O-3 가격계산주체(파트너 확정) · O-7 페이지 swap/insert · O-8 잠금 default · O-9 저해상도 임계.

### B. bookmoa 연동 잔여 (트랙 B — 양측 계약 LIVE)
1. **bookmoa 프론트 d1 모달 / d2 토스트 구현 대기** — Storige 측 전부 LIVE. bookmoa가 검증 FIXABLE→모달 Y→`fix-pagecount` 호출+폴링→`outputFileId` 주문 / 하한경고 토스트만 구현하면 E2E 완결. (bookmoa 세션 작업.)
2. **ZIP 접수** — z1~z3 합의(presigned 직결·500MB·passthrough·attachment 가드). 업로드 MIME 현재 PDF전용 → **bookmoa P1 착수 신호 시** Storige가 presigned 화이트리스트에 `application/zip` 추가 + 다운로드 attachment 가드(게이트 뒤). 정본 RESPONSE/§5.

### C. 오너 게이트 (외부 조율·위험 — 비긴급)
- bookmoa PHP 키 cutover ⏸️보류(구키 1391c5b4 PUBLIC노출 active 수용) · git history force-push(P0-2) · admin AUTH stage1b 프론트 쿠키전환 · Bull attempts>1.

---

## 4. 작업 방식 메모 (이번 세션 패턴)
- **오케스트레이션(Workflow) + 적대검증 필수**: 에이전트 요약·주장을 절대 신뢰하지 말고 **실제 diff·코드·실측으로 검증**. 이번 세션 적대검증 적발 사례:
  - 🔴 포토북 차단 DTO `@IsEnum(['book','leaflet'])`(3곳) → photobook reject. · 🔴 INV3 "DTO strip" 과대주장 → ValidationPipe 실증으로 반증(중첩 innerSpec 보존). · 🔴 bookmoa `spring`≠DB `spiral`·`sewing`≠`hardcover` 명명충돌. · 🔴 `validateSaddleStitch` 자체 `%4`가 데이터주도와 충돌(게이트 추가).
- **재구현 회피**: 신규 작성 전 grep/file:line으로 기존 자산 확인(fix-pagecount = 기존 addPages+registerExternalFile 재사용).
- **커밋→검증→배포** 패턴. byte-identical 게이트(regionScope:'inner' / 데이터주도 필드 미전송 / type photobook)로 기존 상품 무영향 보장 후 배포.
- **bookmoa 교차검증 = 문서 회신**(`.cursor/plans/RESPONSE*_2026-06-25.md`) → 오너가 bookmoa 세션에 전달·크로스체크.
- 스킬: 포토북 작업 시 `photobook-template` 스킬 필수. 편집기 작업 `fabric-editor`/`editor-object-editing`.

---

## 5. 빠른 헬스체크 (세션 시작 시)
```bash
ssh-add -l 2>&1 | head -1                                   # SSH 키(없으면 ssh-add ~/.ssh/id_ed25519)
git -C "/Users/yohan/Developer/Bookmoa Storige editor/storige" log --oneline -15
curl -s -o /dev/null -w "api %{http_code}\n" https://api.papascompany.co.kr/api/health
curl -s -o /dev/null -w "editor %{http_code}\n" https://editor.papascompany.co.kr/
curl -s -o /dev/null -w "fix-pagecount route %{http_code}\n" -X POST https://api.papascompany.co.kr/api/worker-jobs/fix-pagecount/external -H "Content-Type: application/json" -d '{}'   # 401=LIVE
```
