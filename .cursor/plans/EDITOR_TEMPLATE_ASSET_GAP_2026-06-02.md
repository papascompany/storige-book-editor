# 편집기 템플릿·에셋·사진틀·PDF 설계 갭 분석 + 구현방안 (2026-06-02)

> **목적**: "관리자가 판형/에셋(레이아웃·배경·사진틀·텍스트·요소)으로 템플릿셋을 제작 → 고객이 즉시 그 디자인으로 편집 → 화면 그대로 PDF 합성" 요구사항이 코드/문서에 설계·구현돼 있는지 전수 조사하고 갭별 구현방안 제시.
> **조사**: 서브에이전트 5종(템플릿제작·에셋 / 객체잠금 / 사진틀·화질 / PDF첨부·면지·페이지 / WYSIWYG합성) 코드+문서 매핑.

---

## ⏱️ 진행 상태 (2026-06-03 오토파일럿 1차) — ★최우선 참조

| 항목 | 상태 | 커밋 | 검증 |
|---|---|---|---|
| **P0-1** 에셋 단절 해소 | ✅ **완료·배포·검증** | `b04dd39` | API 재배포 후 `/editor-contents/{elements,frames,backgrounds}` 가 library_* 데이터 반환 확인(요소3·프레임2·배경3) |
| **P0-2** PDF 첨부 자동로딩 | 🟡 **API 토대 완료·배포** / 편집기·워커 후속 | `c02a6e6` | content_pdf_mode 컬럼 prod ALTER + 가드 완화 배포, 세션 SELECT 무손상 확인. **편집기 pdfjs 렌더→잠금배경 페이지생성 + 워커 underlay 합성은 미구현(아래 잔여작업)** |
| **P0-3** DPI/화질 | ✅ **완료** | `9eff3ed` | EditorHeader 72→300(프로덕션 embed/스프레드와 통일), 이미지 캡 3508(300DPI A4)로 통일. 빌드 통과 |
| **P1-4** 사진틀 정식화 | ⛔ **미착수(잔여)** | — | 프레임내 이동/줌·핏모드·원본합성은 실시각 QA 필요한 인터랙티브 기능 → 무단 프로덕션 배포 보류 |
| **P1-5** 객체 잠금/삭제불가 | ✅ **완료** | `74a082f`,`615c642` | LockPlugin 배선+setUserRole, del() deleteable/lockInfo 강제, 직렬화, 관리자 삭제잠금 토글 UI. 빌드 통과 |
| **P1-6** 곡선 텍스트 PDF 보존 | ✅ **완료** | `61e3d13` | tspan rotate→path transform 적용. 빌드 통과 |
| **P2-7** 편집가능 면지 | ⛔ **미착수(잔여)** | — | loadTemplateSetEditor 면지 페이지 생성 + 워커 전달 (인터랙티브) |
| **P2-8** WYSIWYG 정밀화 | ⛔ **미착수(잔여)** | — | `_removeSvgBackground` 과삭제·음수오프셋·혼합폰트 등 모두 시각 diff QA 필요 |

### 🔧 P0-2 편집기·워커 잔여 작업 (구체 계획)
1. **편집기 pdfjs 렌더**: `apps/editor` 에 `pdfjs-dist` 추가(네트워크 설치 필요) → `apps/editor/src/utils/pdfToImages.ts` 신설: 업로드 PDF의 각 페이지를 300 DPI 스케일 `page.render`→dataURL 배열. Vite 는 `pdfjs-dist/build/pdf.worker.min.js` 를 `?url` 또는 `new Worker(new URL(...))` 로 번들.
2. **ContentPdfAttachModal**: 모드 선택 UI(replace|underlay) 추가. underlay 선택 시 `applyAttachment` 에서 `contentPdfMode:'underlay'` 함께 PATCH + 렌더된 페이지 dataURL 반환.
3. **페이지 자동생성**: 호출자(EmbeddedEditor/EditorView)에서 PDF 페이지수만큼 `useAppStore.addPage()` → 각 페이지에 PDF 이미지를 `editable:false, selectable:false, deleteable:false, evented:false` 잠금 배경으로 add (P1-5 직렬화로 영속). 
4. **워커 underlay 합성**: 완료 시 합성 단계에서 원본 PDF 페이지를 바닥에 깔고 편집 캔버스 PDF 를 그 위에 overlay 합성(`pdf-lib` page merge). `synthesis.processor.ts` 의 outputMode 에 `underlay` 분기 추가.
5. **검증**: N페이지 내지 PDF 첨부(underlay) → 편집기 N페이지 배경 표시 + 위에 텍스트 추가 → 저장 → PDF 에서 원본 PDF + 편집물 합성 확인.

### 🔧 P1-4 / P2-7 / P2-8 보류 사유 + 진입점
- 공통: 모두 **캔버스 렌더링/사용자 인터랙션 결과를 실측 비교(QA)** 해야 안전. 프로덕션 편집기는 bookmoa 고객이 실사용 중이라 미검증 렌더/인터랙션 코드 자동배포는 회귀(주문 불가/출력 손상) 리스크.
- **P1-4 진입점**: `apps/editor/src/stores/useImageStore.ts:416-647`(프레임 채우기), `controls/`(핏 토글 패널 신설), `ServicePlugin`(원본해상도 합성, P0-3 캡 상향과 연계). 핵심: `extensionType:'photo-frame'` + `fitMode:cover|contain`(scaleX=scaleY 왜곡 제거) + 더블클릭 프레임내 이동/휠줌 + `frameId/fitMode/cropX/cropY` 직렬화.
- **P2-7 진입점**: `useEditorContents.ts loadTemplateSetEditor` 에 endpaper 분기 — `frontEditable` 시 `TemplateType.ENDPAPER` 편집 페이지 생성, 완료 시 `composeFrontEndpaperUrls` 로 워커 전달.
- **P2-8 진입점**: `ServicePlugin._removeSvgBackground`(id 기반으로 워크스페이스 마커만 제거하도록 한정, 단 워크스페이스 배경 누출 회귀 주의 → 시각 QA 필수), 음수오프셋 클램프, `svgTextToPath` 혼합폰트 tspan별 폰트.

> **다음 세션 권장**: 위 잔여작업은 로컬에서 `pnpm install pdfjs-dist` 후 편집기 dev 서버 + 실 PDF/이미지로 시각 검증하며 진행. 본 1차 오토파일럿은 **백엔드·로직·빌드검증 가능 항목(P0-1·P0-3·P1-5·P1-6·P0-2 API)** 을 안전 완료.

---

## 0. 종합 판정 (요구사항 × 상태)

| # | 요구사항 | 상태 | 핵심 갭 |
|---|---|---|---|
| 1 | 관리자 판형 설정 + 캔버스 배치 + 저장 → 고객 템플릿 | ✅ **구현** | 없음 (Template/TemplateSet PATCH + 복원 양방향 완성) |
| 2 | 텍스트/이미지/배경/도형 에셋 | ✅ **구현** | 없음 |
| 3 | 템플릿셋 로딩 즉시 디자인으로 편집 시작 | ✅ **구현** | 없음 (`loadTemplateSetEditor`) |
| 4 | 페이지 추가/삭제 | ✅ **구현** | 없음 (min/max·deleteable·required + 책등 재계산) |
| 5 | **레이아웃 프리셋/클립아트/사진틀 에셋 라이브러리** | ❌ **단절** | admin `library_*` ↔ editor `editor_contents` 테이블 미연결 + 등록 POST 부재 → **admin 에셋이 고객 편집기에 안 보임** |
| 6 | **객체 이동불가/삭제불가** | ⚠️ **부분/미강제** | 이동잠금 일부만, 삭제잠금 전무, LockPlugin 미배선, 관리자 지정 UI 없음 |
| 7 | **사진틀(액자) + 이너/아웃터핏 + 프레임내 이동/줌/크롭** | ⚠️ **테스트수준** | 전용 프레임 타입·핏 모드·프레임내 편집 UI 미구현 |
| 8 | **내지 PDF 첨부 → 각 페이지 자동 로딩** | ❌ **미구현** | 파일 참조만 저장, 첨부=편집차단. PDF→페이지 렌더 파이프라인 전무 |
| 9 | 표지 PDF 표시 위 편집 | ❌ **미구현** | 고객 표지 PDF 입력 경로 없음 |
| 10 | 편집가능 면지(면지부터 편집) | ⚠️ **부분** | admin설정+워커합본만, 편집기 면지 캔버스 미생성 |
| 11 | **편집화면 = 출력PDF (WYSIWYG)** | ⚠️ **위험** | DPI 72 하드코딩, 이미지 300DPI 미달 다운스케일, 곡선텍스트 직선화 |
| 12 | **PDF 합성 시 원본 이미지 화질 보존** | ❌ **손실** | `_processSvgImages` 인쇄 직전 강제 다운스케일/재인코딩 |

**구현됨(1~4)**: 핵심 골격(관리자 제작→고객 편집→저장/복원)은 동작. **결함(5~12)**: 에셋 공급·사진틀·PDF첨부 자동로딩·인쇄 화질이 미흡.

---

## 1. 🔴 P0 — 에셋 라이브러리 테이블 단절 (요구 #5)

### 현황
- **editor가 읽는 곳**: `editor_contents` 테이블(type: template/frame/image/background/element). 컨트롤러는 GET/PUT만, **POST(생성) 없음** (`apps/api/src/editor-contents/editor-contents.controller.ts`). `docker/mysql/init.sql:408` 테이블만 생성, **seed INSERT 없음**.
- **admin이 쓰는 곳**: 별도 테이블 `library_frames`/`library_cliparts`/`library_backgrounds`/`library_shapes`/`library_fonts` — admin Library 페이지가 full CRUD (`apps/api/src/library/`, `apps/admin/src/pages/Library/`).
- → **admin Library에 클립아트/사진틀/배경을 등록해도 editor 패널(`AppElement`/`AppFrame`/`AppBackground`)에 안 나타날 가능성**. 두 시스템이 연결돼 있지 않음.

### 구현방안 (택1)
- **(권장) 단일화**: `library_*`를 정본으로, `editor-contents.service.findByType`를 `library_*` 조회로 재배선(또는 union). editor 패널 API(`contentsApi.getElements/getFrames/...`)가 `library_*`를 바라보게.
- **(대안) 동기화**: admin Library CRUD 시 `editor_contents`에 upsert 동기(type 매핑: clipart→element, frame→frame, background→background).
- **검증**: admin에서 클립아트 1건 등록 → 고객 편집기 "요소" 패널에 즉시 노출되는지.

---

## 2. 🔴 P0 — 내지 PDF 첨부 → 각 페이지 자동 로딩 (요구 #8·#9)

### 현황
- `ContentPdfAttachModal`은 PDF를 업로드+검증 후 **`contentPdfFileId`만 저장**. **PDF를 페이지 이미지로 변환·캔버스 로딩하는 코드 전무.**
- 오히려 첨부 시 **편집 차단**: API `PDF_ATTACHED_EXCLUSIVE` 가드(`edit-sessions.service.ts:251`)가 첨부된 세션의 canvasData 수정을 400 거부. = "PDF냐 편집이냐" 택일 모델 → **"PDF 표시 후 그 위 편집" 요구와 충돌**.
- PDF→이미지 렌더 파이프라인 없음(편집기 pdfjs 미설치, 워커 Ghostscript는 1페이지 미리보기 전용).
- 고객 표지 PDF 업로드 경로 없음(`coverPdfFileId`는 편집기 export 산출물).

### 구현방안
1. **PDF→페이지 렌더**: 편집기에 `pdfjs-dist` 추가 → 업로드 직후 각 페이지 `page.render` → dataURL. (대안: 워커 Ghostscript `pdfToImage`를 전 페이지로 확장.)
2. **페이지 자동 생성**: PDF 페이지수만큼 `useAppStore.addPage()` 반복 → 각 페이지에 해당 PDF 이미지를 **잠금 배경**(`editable:false, selectable:false, deleteable:false`)으로 배치.
3. **모드 분리**: `contentPdfMode: 'replace'(PDF만) | 'underlay'(PDF 배경+편집)` 플래그 도입 → underlay 모드는 `PDF_ATTACHED_EXCLUSIVE` 완화하여 canvasData 저장 허용.
4. **표지**: 동일 파이프라인을 cover 페이지에 적용 + 고객 표지 PDF 업로드 버튼 추가.
- **검증**: N페이지 내지 PDF 첨부 → 편집기에 N개 페이지가 배경으로 표시 + 그 위 텍스트/요소 추가 가능.

---

## 3. 🔴 P0 — PDF 출력 화질 + DPI 정합 (요구 #11·#12)

### 현황
- **DPI 불일치**: 메인 "PDF 저장"(`EditorHeader.tsx:247`)이 **DPI 72 하드코딩**(`// TODO`), embed/스프레드는 300. px-unit 캔버스에서 물리 크기가 어긋날 수 있음.
- **이미지 강제 다운스케일**: `ServicePlugin._processSvgImages`가 인쇄 직전 JPEG 2048px+q0.8, PNG 1280~1536px로 축소(브라우저 callstack 회피 목적). 300DPI A4(≈2480px) 미달 → 인쇄 부적합 화질. 원본은 `_element`에 보존되나 PDF 진입 직전 손실.
- **곡선 텍스트 직선화**: `svgTextToPath.ts`가 단일 baseline에서 글자 재생성 → `obj.path`/`segmentsInfo` 무시 → 곡선 텍스트가 PDF에서 펴질 위험.

### 구현방안
1. **DPI 단일화(P0)**: `EditorHeader.tsx` 72 하드코딩 → 300(또는 설정값). 생성 함수 기본 DPI 상수 통일. 검증: PDF mediabox(mm)=printSize, content 중앙 정위치.
2. **이미지 상한 동적화(P0)**: 1280/1536/2048 고정 캡 → `목표mm × 300/25.4` 기반 상한 또는 인쇄모드 캡 제거. JPEG 무조건 재인코딩 폐지. **(권장)** 편집기는 좌표/clip 메타+원본 이미지 URL만 넘기고 **워커(pdf-lib+Sharp)가 원본 해상도로 합성** → 화질 손실 0.
3. **곡선 텍스트 보존(P1)**: `convertTextToPath` 전 `obj.path != null` 분기 — fabric toSVG 곡선 결과 사용 또는 segmentsInfo로 per-glyph transform 적용.
- **검증**: 편집화면 스크린샷 ↔ 생성 PDF 페이지 픽셀 diff + 워커 validation `RESOLUTION_LOW` 0건.

---

## 4. 🟡 P1 — 사진틀(액자) 정식화 (요구 #3·#7)

### 현황
- 두 갈래 공존: (A) clipPath 기반 "모양틀 SVG(테스트용)"(`useImageStore.ts:416-647`), (B) clipPath 없는 일반 이미지(`useEditorContents.ts:1673`). 전용 `FramePlugin` 없음.
- `innerFit`/`outerFit`/`fitMode`/`cropX` 전부 코드 0건. 프레임 내부 이동/줌/크롭 UI 없음. (A)는 폭 기준 1회 스케일만 → 종횡비 왜곡.
- `fillImage`/`accessory`/`clipPath`는 직렬화 보존됨(`canvas.ts:117`).

### 구현방안
1. **`extensionType:'photo-frame'` 전용 타입**: 표시용 PNG/SVG 테두리 + 안쪽 모양 `clipPath`(절대좌표) placeholder. 관리자 업로드(300DPI PNG + 마스크 영역) 정식 폼 신설(현 "테스트용" 버튼 교체).
2. **핏 모드 + 프레임내 편집**: `fitMode: cover(아웃터)|contain(이너)`, scaleX=scaleY로 왜곡 제거. 더블클릭 → 프레임 고정 + 내부 이미지만 이동/휠줌(크롭). controls 패널에 핏 토글/리셋.
3. **원본 화질 합성**: 프레임 내 이미지는 **fabric 네이티브 cropX/cropY** 또는 clipPath + `frameId/fitMode` 직렬화. PDF 합성 시 §3의 원본해상도 경로 사용.
- **검증**: 사진 프레임 삽입→이동/줌→저장→PDF에서 동일 크롭+원본화질.

---

## 5. 🟡 P1 — 객체 이동불가/삭제불가 (요구 #6)

### 현황
- **삭제 잠금 전무**: `ObjectPlugin.del()`이 `lid`만 막고 `deleteable/isLocked` 미검사 → 잠긴 객체도 삭제됨.
- **이동 잠금 부분**: 템플릿 SVG 요소에 `lockMovement+selectable:false` 적용되나, 완성도 높은 **`LockPlugin`이 미등록**(`createCanvas.ts` 등록 목록에 없음, `setUserRole` 호출 0건).
- 객체 단위 `deleteable` 플래그 없음(페이지 레벨만). `lockInfo` 직렬화 안 됨. 관리자 지정 UI 없음.
- 설계 의도는 `EDITOR.md:209-217`에 명시(고객/디자이너/관리자 권한) — LockPlugin과 1:1 대응하나 배선만 안 됨.

### 구현방안
1. **LockPlugin 배선**: `createCanvas.ts` 등록 + 진입 시 `setUserRole(editMode?'admin':'user')`. `lockInfo`(또는 isLocked/lockLevel)를 `extendFabricOption` 직렬화에 추가. 구버전 저장 경로(`useWorkSave/useTemplateSave`)를 `extendFabricOption`으로 통일(잠금 속성 유실 방지).
2. **삭제 강제**: `ObjectPlugin.del()` 시작부에서 `deleteable===false` 또는 현재 role로 unlock 불가한 잠금 객체를 제외(휴지통/Delete 단축키 모두 이 경로).
3. **관리자 지정 UI**: `editMode`에서만 노출되는 "이동잠금/삭제잠금" 토글(SidePanel/우클릭 메뉴) + 컨텍스트 메뉴 동적 비활성화.
- **검증**: 관리자가 객체 잠금→저장→고객 진입 시 그 객체 이동·삭제 불가.

---

## 6. 🟢 P2 — 편집가능 면지 + WYSIWYG 정밀화 (요구 #10·#11)

### 면지 (#10)
- 현재 편집기는 `endpaperConfig`를 안내 텍스트로만 표시, 면지 캔버스 미생성.
- **구현방안**: `loadTemplateSetEditor`에 endpaper 처리 추가 — `frontEditable=true`면 `frontCount`만큼 `TemplateType.ENDPAPER` 편집 페이지를 cover와 page 사이에 생성, 편집 결과를 완료 시 `composeFrontEndpaperUrls`로 워커에 전달(워커 빈페이지 로직 그대로 활용).

### WYSIWYG 잔여 위험 (#11)
- 음수 오프셋 클램프(블리드 트림 좌표로 교체), `_removeSvgBackground` 과삭제(workspace/배경 마커만 한정), 혼합 폰트 path화(tspan별 폰트), embed `window.confirm` 대체(콜백 주입), 효과/칼선 페이지가 content PDF에 섞일 때 워커 합성 페이지 정합.

---

## 7. 권장 로드맵

| 우선순위 | 작업 | 영향 |
|---|---|---|
| **P0-1** | 에셋 테이블 단절 해소(library↔editor_contents) | admin 에셋이 고객에게 안 보이는 치명 결함 |
| **P0-2** | 내지 PDF 첨부 → 페이지 자동 로딩(+표지) | 핵심 고객 시나리오 미동작 |
| **P0-3** | DPI 72→300 통일 + 이미지 원본화질 합성 | 인쇄물 품질 직결 |
| **P1-4** | 사진틀 정식화(프레임+핏+프레임내 편집) | 사용자 명시 핵심 기능 |
| **P1-5** | 객체 잠금/삭제불가(LockPlugin 배선+UI) | 템플릿 보호 |
| **P1-6** | 곡선 텍스트 PDF 보존 | 원형 텍스트 인쇄 정확도 |
| **P2-7** | 편집가능 면지 캔버스 | 면지 편집 상품 |
| **P2-8** | WYSIWYG 정밀화(오프셋/배경/폰트/효과정합) | 출력 정확도 보강 |

> ⚠️ P0-1(에셋 단절)·P0-3(이미지 화질)은 다른 곳의 검증 결과와 별개로 **편집/합성 산출물의 실제 품질**에 직결되므로, bookmoa E2E와 무관하게 우선 확인·수정 권장.

---

## 8. 근거 파일 (빠른참조)
- 템플릿/에셋: `apps/api/src/templates/entities/*`, `apps/api/src/editor-contents/`, `apps/api/src/library/`, `apps/editor/src/tools/{AppFrame,AppElement,AppTemplate}.tsx`, `apps/editor/src/hooks/useEditorContents.ts`, `useTemplateSetSave.ts`, `docker/mysql/init.sql:408`
- 잠금: `packages/canvas-core/src/plugins/{LockPlugin,ObjectPlugin,TemplatePlugin}.ts`, `apps/editor/src/utils/createCanvas.ts`, `packages/canvas-core/src/utils/canvas.ts:94-144`, `docs/EDITOR.md:209-217`
- 사진틀/화질: `apps/editor/src/stores/useImageStore.ts:416-647`, `packages/canvas-core/src/plugins/ServicePlugin.ts:65-174,500~,2034-2250`, `canvas.ts:246-291`
- PDF첨부/면지/페이지: `apps/editor/src/components/editor/ContentPdfAttachModal.tsx`, `apps/api/src/edit-sessions/edit-sessions.service.ts:249-256`, `apps/worker/src/utils/ghostscript.ts:146`, `apps/editor/src/stores/useEditorStore.ts:280-326`
- WYSIWYG: `ServicePlugin.ts`(생성/이미지/배경/폴백), `converters/svgTextToPath.ts`(곡선 미보존), `FontPlugin.ts:336-405`, `EditorHeader.tsx:247`(DPI 72), `apps/worker/src/processors/synthesis.processor.ts:119-286`
