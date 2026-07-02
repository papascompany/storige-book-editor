# RESUME PROMPT — 2026-07-02

> 이전 세션의 "지금 작업 중" 정본 포인터. 새 세션은 이 파일 + `CLAUDE.local.md` + `git log --oneline -15` 먼저 확인.
> 직전 정본: `RESUME_PROMPT_2026-06-26.md`(포토북 O-2 + bookmoa 검증연동/fix-pagecount).
> **본 세션 = 코드 변경 0인 감사·설계 세션.** ① POD 편집기 **모듈화(트랙 A/B) 착수 준비** ② **3영역 현황 감사**(워커 파일검증 / 편집기 라이브러리 리소스 관리 / 템플릿모드 속성·컨트롤). 적대검증으로 사실 3건 정정.
> 모듈화 설계 정본: `.cursor/plans/POD_EDITOR_MODULARIZATION_DESIGN_2026-06-30.md`(19-에이전트 워크플로 산출, CTO 정본).

---

## 0. ⚠️ 경로 (가장 먼저)
- 레포: https://github.com/papascompany/storige-book-editor (PUBLIC, master)
- 로컬: `/Users/yohan/Developer/Bookmoa Storige editor/storige`
- 배포: **editor/admin = Vercel(master push 자동)** · **api/worker = VPS 수동**(`ssh deploy@158.247.235.202`, `cd ~/storige && git pull && docker compose up -d --build api worker` + ⚠️ api 재배포 시 `docker compose restart nginx`(502 방지) — [[feedback_api_redeploy_nginx]])
  - ⚠️ **editor(Vercel)의 git 웹훅 미발화 이슈 이력** → editor는 향후 **Vercel CLI 수동배포** 전제([[project_large_file_2gb_track_b]]). 모듈화 트랙 A(번들 변경)는 이 수동배포 = **단일 atomic 롤백** 보장에 유리.
- 타입빌드 선행: `pnpm --filter @storige/types build`

---

## 1. 현재 배포 상태 (전부 LIVE·정상 — 본 세션은 코드 무변경)
| 서비스 | 상태 |
|---|---|
| **editor** (Vercel 자동) | 포토북 펼침면 2-up 렌더 + 공유 UX(z-order·삭제모달·레이어DnD·사진틀 스왑) LIVE. |
| **admin** (Vercel 자동) | 포토북 내지 펼침면 등록 폼(regionScope cover/inner) LIVE. |
| **api/worker** (VPS 수동) | 데이터주도 페이지수 검증(`6d0cb76`) + fix-pagecount 엔드포인트(`972e2b1`) LIVE. `WORKER_MAX_FILE_SIZE=2GB`. |

- **⚠️ 06-26 핸드오프 이후 master에 추가된 커밋 2건(그 문서에 미반영)**:
  - `1278990` feat(editor): STALE-CLOSURE-001 — 게스트 complete 시 `editor.complete`에 needsAuth/guestToken 인라인 포함
  - `082dba1` feat(api): WH-005 웹훅 orders 식별자 정규화 — orderSeqno DTO + 웹훅 payload sessionId/orderSeqno 보강
- 워킹트리: master, clean (본 세션 산출물 = 이 RESUME + 모듈화 설계문서만).

---

## 2. 본 세션에서 한 일 (감사·설계 — 커밋 없음)

### 2.1 3영역 현황 인벤토리 (병렬 탐색 3에이전트 + 적대검증 워크플로 4에이전트)

#### A. 워커 파일 검증 (`apps/worker`)
- **정본 파일**: `services/pdf-validator.service.ts` · `processors/validation.processor.ts` · `config/validation.config.ts`. 진입 = Bull 큐 `pdf-validation` → `validate-pdf`(동시성 env `VALIDATION_CONCURRENCY` 기본3) → `COMPLETED|FIXABLE|FAILED` API 콜백.
- **✅ ACTIVE — primary 검증 15종 전부 배선·도달**(`validate()` + `validateLightweight()` 미러): 파일크기(`MAX_FILE_SIZE` 100MB, env `WORKER_MAX_FILE_SIZE`) · PDF파싱/손상 · 0페이지가드(P0-4) · 페이지수(데이터주도 pageMultiple/Max/Min + 레거시 binding 이중경로) · 판형치수 · 블리드 · **책등(cover 한정)** · 방향(WBS2.1 집계) · **사철(saddle 한정 4배수·≤64p)** · 스프레드감지(점수제 임계70) · CMYK(2단계 구조regex→GS inkcov, 50MB↓·GS있을때만) · 별색 · 투명/오버프린트 · 해상도(`MIN_ACCEPTABLE_DPI` 150) · 폰트임베딩(safe fallback).
- **결과 스키마** `dto/validation-result.dto.ts`: `{ isValid, errors[], warnings[], metadata }`. `autoFixable` + `fixMethod`(addBlankPages/resizeWithPadding/extendBleed/adjustSpine).
- **대용량(2GB)**: `validateLightweight()`(스트림DL→qpdf메타→8MB청크스캔) env `WORKER_LIGHTWEIGHT_VALIDATION`. 파리티 테스트 `lightweight-parity.spec.ts`. SSRF 가드 `assertSafeDownloadUrl()`.
- **🔴 DEAD/PARTIAL (적대검증 CONFIRMED)**:
  - **Crop marks = DEAD** — `cropMarkEnabled` 옵션 수신만, 검증 로직 소비 0(validation.processor.ts:39 주석 "P1 수신만, 사용 P4"). placeholder.
  - **`DEFAULT_BLEED_MM(3)/DEFAULT_SIZE_TOLERANCE_MM(0.2)/DEFAULT_CROP_MARK_ENABLED`(validation.config.ts:69/71/73) = 전부 export-only, 소비처 0.** 검증기는 자체 로컬 `const DEFAULT_BLEED=3`(pdf-validator.service.ts:38) + `?? 1`/`?? 0.2` fallback 사용.
- **⚠️ 적대검증으로 정정된 STALE 주석 (다음 세션 주의 — 코드 주석 믿지 말 것)**:
  - **`sizeToleranceMm` 는 실제 배선·소비됨** (validatePageSize pdf-validator.service.ts:793 `?? 1`, 컨버터 resolveMode :377 / applyImpositionMode :420 `?? 0.2`). DTO/processor의 "P4 미구현" 주석은 **stale·부정확**. override 는 이미 존중됨(기본값만 상수).
  - **lightweight-synthesis 는 config export 아니라 런타임 게이트로 배선됨** (synthesis.processor.ts:203/:932/:1218 → `composeMixedLightweight` 상수메모리 경로 · pdf-synthesizer.service.ts:642/:740/:820 · pdf-converter.service.ts:112→:365 · pdf-page-renderer.service.ts:97). 남은 건 **프로덕션 env `WORKER_LIGHTWEIGHT_SYNTHESIS` ON 여부**(배포 결정)뿐, 코드 부재 아님.

#### B. 편집기 라이브러리 리소스 관리 (`packages/canvas-core`, `apps/editor`)
- **🔴 5개 무거운 라이브러리 = 현재 master에서 전부 STATIC import (트랙 A 미실행 = 기준선, 적대검증 CONFIRMED)**:
  | 라이브러리 | 위치 | 용도 |
  |---|---|---|
  | jspdf + svg2pdf | `ServicePlugin.ts:5-6` | 멀티페이지 PDF·재단선·박스주입 (~793KB) |
  | jsbarcode | `SmartCodePlugin.ts:4` | 바코드 (`JsBarcode(...)` :118) |
  | qr-code-styling | `SmartCodePlugin.ts:6` | 스타일 QR (`new QRCodeStyling` :125) |
  | pdf-lib | `utils/save.ts:3` | 다중 Blob PDF 병합 |
  | paper | `AccessoryPlugin.ts:5` | SVG path→paper union (`paper.setup` :346) |
  - 이미 지연로딩된 것(참고, 손댈 필요 X): opentype.js·fabric(factory)·OpenCV·ONNX·background-removal = dynamic import + `vite.config.ts` optimizeDeps.exclude + manualChunks(`vendor-pdf/codes/fabric/opencv/onnx`).
- **✅ dispose 골격 견고 (CONFIRMED)**: `Editor.dispose()`(Editor.ts:69-112)가 플러그인 `dispose()`+`destroyed()` 둘 다 호출(try/catch) → hotkeys unbind(:92-99) → contextMenu dispose(:103-104) → state reset(:106-111). ServicePlugin `_performMemoryCleanup()`(:2827-2848) passive100ms/aggressive200ms+`window.gc()`, tempCanvas.dispose(:1552/:1792/:1854).
- **🟡 실제 누수 2건 (적대검증 CONFIRMED — 수정 후보)**:
  - **AccessoryPlugin 리스너 누적**: `bindObject()`가 `canvas.on('object:moving', ...)`(AccessoryPlugin.ts:217/:309) **익명 클로저**로 등록 → 참조 미저장 → `destroyed()`(:482-486)는 `mouse:down/up`만 off, `object:moving` off 전무. bindObject 는 afterLoad(:431)·afterSave(:464)에서도 호출 → **로드/저장·페이지 재구성마다 리스너 순증**.
  - **paper 전역상태 미정리**: `paper.setup()`(:346)만 하고 `paper.project.clear()`/`paperPath.remove()` 없음. drawMergedWorkspace 가 endDrag(:495-503)마다 재호출 → 전역 paper 상태 무한 재설정.

#### C. 템플릿 모드 속성 정의 + 편집기 컨트롤 (`packages/types`, `canvas-core`, `apps/editor`)
- **✅ 타입 정의 완비 (CONFIRMED)**:
  - `TemplateSetType`(types/index.ts:95) = `book|leaflet|photobook`.
  - `SpreadConversionMode`(types/index.ts:1549) = `full|flat-spread|flat-spine`, `SpreadConfig.conversionMode`(:1563). SpreadPlugin 저장(:75/:106) + **분기 실증**: `flat-spread` 면 resizeSpine no-op 조기반환(SpreadPlugin.ts:442-447), inner/regionScope 가드(:434-437).
  - 포토북 내지 2-up: `regionScope:'cover'|'inner'` + `innerSpec`(O-2, additive). `SpreadObjectMeta.flatArtwork`('spine'|'back'|'front').
- **✅ 객체 직렬화 화이트리스트** `extendFabricOption`(canvas.ts:94-163): id·extensionType·styles·fillImage·frameRef·lockInfo·deleteable·movable·meta·effects·cmykFill/Stroke·lockLayerOrder·parentLayerId 등. `ensureTextStyles()`(canvas.ts:303)는 toObject/toJSON 전 필수(과거 무한로딩 방어 — [[reference_fabric_styles_trap]]).
- **✅ 권한 모델(기본 permissive)**: `lockInfo`(LockPlugin.ts:23, level user|designer|admin|system) · `deleteable`/`movable` → `applyObjectPermissions()`(비-editMode 강제) · editMode(admin) 전 락 우회.
- **✅ 컨트롤 = 상품 타입 게이팅 0건 (CONFIRMED — 포토북 원칙 준수)**: ControlBar.tsx에 TemplateSetType 참조 0. z-order(ObjectPlugin up/down)·del(requestDeleteSelection→del)·duplicate·align(AlignPlugin)·lock(LockPlugin ⌘L)·group(GroupPlugin ⌘⌫)·사진틀조정(FrameInteractionPlugin)·hotkey 전부 공유 플러그인. 존재하는 분기는 **editMode(admin/customer)** 와 **SelectionType(single/group/multi)** 뿐. isPhotobookInner/isBookMode 분기는 spread·layout·workflow 계산용이지 컨트롤 on/off 아님.
- **⚠️ 사진틀 스왑 — 메모리 vs 탐색보고 모순 해소 (적대검증 PARTIAL)**:
  - **스왑 구현·커밋됨** (`e094e3e`, useImageStore.ts:790-818): 채워진 액자 **클릭(mousedown)** → 파일선택 → 새 이미지 먼저 로드(취소/실패 시 기존 유지) → 기존 fillImage 제거 → `fillImageIntoFrame` 재사용. 주석 "드롭 오버라이드 스왑(포토북 고유)".
  - **단, 전용 툴바 '교체' 버튼 없음, 드래그드롭 아님.** 트리거 = 액자 클릭. 채워진 액자는 hover 오버레이('이미지 채우기')가 **빈 액자에만** 표시(useImageStore.ts:739-740 isFilled early-return) → **발견성 낮음(UX 갭)**.
  - 런타임 경로는 `extensionType==='frame'` 전체 적용 → **코드상 전 상품 공유**(포토북 전용은 설계 의도 라벨일 뿐, 타입가드 아님).

### 2.2 모듈화 설계 요약 (POD_EDITOR_MODULARIZATION_DESIGN_2026-06-30.md)
- **결론 = 전면 재작성 아님. 2트랙 분리.**
- **트랙 A (지금 착수 권고, 1~2주, 저위험) — "무아키텍처" 번들 최적화**: 위 5개 라이브러리를 dynamic import 로 경계 절단. Registry/Manifest 프레임워크 **없이** 기존 `createCanvas` 구조 유지. 번들 목표의 ~90% 회수.
- **트랙 B (보류 — 4번째 상품 카드/캘린더/포스터 실착수 시 트리거)**: Capability Registry + Product Profile 매니페스트. 현재 상품 조건분기가 3개(spread/ruler/image)뿐 → ROI 미달. P0~P4 로드맵은 설계문서 §4~5.
- **⚠️ 적대검증이 잡은 설계 정정(설계문서 §2)**: "코어 0줄 변경" 거짓(ServicePlugin.imagePlugin null 주입 사고 + History→Image deps) → **P0.5 비파괴 선행** 필요 · "enabled:false=번들제외" 거짓(static import라 무관) · photobook 출력계약은 `duplex-split` 아니라 **`mode:'spread'`+content-only**(워커 담당 확인 게이트) · OpenCV 45MB는 이미 lazy(신규이득 아님).

---

## 3. 🚦 다음 세션 우선 처리

### A. ⭐ 모듈화 트랙 A 착수 (오너 권고 = A 먼저 출하)
설계문서 §3·§6.5 순서. **작은 PR 여러 개(②→①→④→③) 빠르게 머지, 장기 브랜치 금지.**
0. **선행(0.5일)**: `rollup-plugin-visualizer` 1회 → gzip 전송 기준 절감 KB 실측(ROI 정당화).
1. **② SmartCodePlugin** — jsbarcode/qr **static import + eager `new`(:118/:125) 절단** → 패널 진입 시 dynamic import. (`barcode()`/`qrcode()` 이미 `public async` → 호출처 무변경)
2. **① ServicePlugin** — jspdf/svg2pdf(793KB) **finish 시 dynamic import**(thin wrapper, 인스턴스 eager 유지). (`saveMultiPagePDF` 이미 async → 호출처 무변경)
3. **④ save.ts + index.ts 배럴** — pdf-lib dynamic 화.
4. **③ AccessoryPlugin** — paper dynamic 화. ⚠️ **`svgPathArrayToPaperPath`는 현재 동기 헬퍼 → 비동기화 시 호출처 await 필요. paper 코드 신규는 async 가정.**
5. **warmupOpenCv 미호출 부채 진단·수정**(2026-05-04부터 메뉴 클릭 차단 독립버그, lazy 타이밍과 동일근원 가능성).
- **게이트**: book/leaflet/photobook PDF qpdf 구조 + **픽셀 diff 0**(또는 오너 승인 허용임계). editor = Vercel CLI 수동배포 = 단일 atomic 롤백.
- **P0.5 비파괴 선행(트랙 B로 갈 경우 필수, 트랙 A만이면 선택)**: ServicePlugin `ImageProcessingPlugin | null` 시그니처 정직화 + 전 사용처 null 가드 + History→Image deps 명시.

### B. 세 감사 영역 손댈 후보 (모듈화와 별개, 병행 가능)
1. **[워커]** Crop marks 실배선(P4 대기, 현 DEAD) · `DEFAULT_*` 3상수 실소비 연결 · lightweight-synthesis **프로덕션 env ON 검토**(코드는 이미 배선). ⚠️ stale 주석("P4 미구현") 정리.
2. **[편집기 누수]** AccessoryPlugin `object:moving` 익명 리스너 → 명명 핸들러로 저장 후 `destroyed()`에서 off + paper 전역상태 정리(`paper.project.clear()`). **워커와 무관, 트랙 A ③(paper)와 같은 파일 → 조율.**
3. **[템플릿 UX]** 사진틀 스왑 **발견성 개선**(채워진 액자에도 hover 오버레이/교체 아이콘). 기능은 이미 동작.

### C. 병행 in-flight (본 세션 무관 — 잃지 말 것)
- **포토북 O-2 잔여**: O-4(출력 펼침면 좌우분할+300dpi 래스터, 워커·오너게이트) · per-region 편집경계/파노라마 · 자동배치 UI 프레임 배선 · 실 템플릿셋 E2E. 정본 [[project_photobook_template]] · `PHOTOBOOK_TEMPLATE_DESIGN_2026-06-23.md`. **편집기 공유 UX = TemplateSetType 게이팅 0건 원칙(위반 금지).**
- **bookmoa 검증연동**: Storige 측 전부 LIVE. bookmoa 프론트 d1 모달/d2 토스트 구현 대기(bookmoa 세션). [[project_pdf_upload_validation]].
- **오너 게이트(비긴급)**: bookmoa PHP 키 cutover ⏸️보류 · git history force-push · admin AUTH stage1b 프론트 쿠키전환 · Bull attempts>1.

---

## 4. 작업 방식 메모 (트랙 A 병행 조율 규칙 — 설계문서 §6.5 정본)

- **워커 작업은 트랙 A와 완전 분리, 충돌 0** — worker에 jspdf/jsbarcode/paper/svg2pdf/canvas-core 의존 전무(자체 pdf-lib/Sharp/GS 스택). 완전 병행 가능.
- **편집기 병행 안전 규칙 2가지**:
  1. **🔴 static import 재유입 금지(가장 미묘)** — jspdf·jsbarcode·qr-code-styling·paper·pdf-lib 를 **새로 `import X from 'x'`(static) 하면 트랙 A 절감이 조용히 무효화**(번들 재유입). 이 5개는 **"dynamic import만"** 규칙. 특히 새 플러그인이 PDF/바코드/효과 기능 추가 시.
  2. **paper 코드는 async 가정** — `svgPathArrayToPaperPath` 비동기화 대비.
- **충돌면 = 4파일뿐**: `SmartCodePlugin.ts`·`ServicePlugin.ts`·`save.ts`(+`index.ts` 배럴)·`AccessoryPlugin.ts` + `apps/editor/vite.config.ts`. 이 파일 만질 때만 시간 분리/조율. 새 플러그인 추가·객체편집·모바일 UX·일반 fabric 작업은 다른 파일이라 안전.
- **byte-identical 골든 공유** — 트랙 A가 PDF 출력 골든(픽셀 diff 0) 세팅 시, 다른 세션의 PDF 관련 변경도 같은 게이트 통과. 의도적 출력 변경은 트랙 A와 조율(골든 갱신).
- **적대검증 우선** — 본 세션도 서브에이전트 초기보고 3건이 실코드와 어긋나 워크플로 적대검증으로 정정(sizeTolerance·lightweight-synthesis 배선됨 / 사진틀 스왑 모순 해소). **코드 주석·에이전트 요약을 file:line 직접확인 없이 핸드오프에 박지 말 것.**
- **절대 불변(whatStaysShared)**: canvas-core 공개 API · 28플러그인 외부동작 · 워커 출력 파이프라인 · 웹훅/HMAC/멱등가드 · 좌표규약(중앙원점@150dpi) · fabric 5.5.2 핀 · embed postMessage 엔벨로프+dual-emit · Site 인증 · 멀티테넌시 인프라.

---

## 5. 빠른 헬스체크 (세션 시작 시)
```bash
# 0) SSH 에이전트
ssh-add -l 2>&1 | head -1   # "no identities" → ssh-add ~/.ssh/id_ed25519
# 1) 최신 핸드오프 + 커밋
ls -t .cursor/plans/RESUME_PROMPT_*.md | head -1
git log --oneline -15 && git status
# 2) 모듈화 설계 정본
sed -n '1,20p' .cursor/plans/POD_EDITOR_MODULARIZATION_DESIGN_2026-06-30.md
# 3) 5개 라이브러리 static import 잔존 확인(트랙 A 진행 판단)
grep -n "from 'jspdf'\|from 'svg2pdf.js'" packages/canvas-core/src/plugins/ServicePlugin.ts
grep -n "from 'jsbarcode'\|from 'qr-code-styling'" packages/canvas-core/src/plugins/SmartCodePlugin.ts
grep -n "from 'pdf-lib'" packages/canvas-core/src/utils/save.ts
grep -n "from 'paper'" packages/canvas-core/src/plugins/AccessoryPlugin.ts
# 4) API 헬스(외부)
curl -s https://api.papascompany.co.kr/api/health | python3 -m json.tool
```
