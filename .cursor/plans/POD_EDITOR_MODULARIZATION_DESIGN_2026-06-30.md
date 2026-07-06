# POD 편집기 모듈화·지연로딩 아키텍처 설계 (CTO 정본)

> 작성 2026-06-30. 생성 방식: 19-에이전트 워크플로(코드베이스 6영역 해부 + 외부편집기 4트랙 조사 + 설계안 3종 경합 + 적대검증 3렌즈 + 수정).
> 질문 출처: 오너 — "상품/기능별 모듈화 + 필요한 기능만 로딩 구조로 확장하고 싶은데, 전부 뜯어고치는 작업이 되는 건 아닌가?"

---

## 0. 한 줄 결론

**전면 재작성 아니다. 그러나 "지금 당장 프레임워크를 짓는 것"도 답이 아니다.**
실측 결과 진짜 비용/효과가 갈리는 지점은 둘로 쪼개진다:

- **트랙 A(지금, 1~2주, 저위험)** — 무거운 라이브러리 3개(jspdf/svg2pdf 793KB·jsbarcode+qr·paper.js)를 `dynamic import`로 지연로딩 + warmupOpenCv 부채 수정. **Registry/Manifest 프레임워크 없이** 기존 `createCanvas` 구조 그대로, import 경계만 분리. 번들 목표의 ~90%를 여기서 회수.
- **트랙 B(보류, 4번째 상품 착수 시)** — Capability Registry + Product Profile 매니페스트 프레임워크. **카드/캘린더/포스터 등 실제 신상품이 추가될 때** 정당화됨. 현재는 상품 조건분기가 단 3개(spread/ruler/image)뿐이라 ROI 미달.

> 핵심: 오너의 우려("전부 뜯어고치기")는 **트랙 B를 지금 하지 않음**으로써 해소된다. 산업 표준 방향(데이터 주도 상품설정 + capability 지연로딩)은 옳지만, **타이밍을 보수적으로** 잡는 게 CTO 판단이다.

---

## 1. 외부 편집기 조사 — 우리 방향이 산업 표준인가? (그렇다)

| 분류 | 대표 | 모듈화 메커니즘 | 우리에 적용 |
|---|---|---|---|
| 범용 디자인 | **Polotno**(Fabric 기반), Canva, VistaCreate | 헤드리스 코어 + sections/panels 플러그인, 디자인타입별 도구셋 데이터 선언 | 우리 canvas-core 플러그인 시스템이 이미 동형 씨앗 |
| 사진 상품 | Mixbook, Shutterfly, Cewe | 상품별 surface/spread 모델 + 테마/템플릿 데이터, auto-fill | 포토북 spread 모델 이미 보유. surface 추상화는 카드 추가 시 |
| **POD 임베드 SaaS** | **Customer's Canvas**(Aurigma), **Zakeke**, Printess, Kickflip | ⭐ **product definition/config = 선언적 JSON**. 한 코어가 config 받아 런타임 기능셋 조립. 고객사별 차별화=데이터 | **우리와 가장 직접적 비교군.** Product Profile 매니페스트의 직접 모델 |
| 프론트엔드 패턴 | VS Code extension, Module Federation, strangler-fig | activationEvents(`when` 술어 + lazy load), 점진 추출 | Registry `when`/`load` 모델 차용. **Module Federation은 우리 규모에 과 → 미채택** |

**결론**: "상품 차이는 데이터로, 코어는 상품 무지, 무거운 기능은 지연로딩" 방향은 Customer's Canvas·Zakeke·VS Code·Polotno가 전부 쓰는 검증된 패턴이다. 방향은 옳다. 쟁점은 **언제 어디까지 짓느냐**다.

---

## 2. 적대검증이 코드로 잡아낸 사실 정정 (원안 → 정정)

워크플로 원안의 주장 4건이 실제 코드와 어긋나 정정됨. **이 정정들이 설계의 핵심 가치다.**

1. **"코어 0줄 변경"은 거짓** → `ServicePlugin.ts:15`의 `imagePlugin`은 non-null 타입인데 `createCanvas.ts:245`가 null을 주입(TS 우회 사고). `ServicePlugin.ts:2257`이 null 가드 없이 호출. 더 결정적으로 **`HistoryPlugin.ts:192`(foundation·always-eager)가 `getPlugin('ImageProcessingPlugin')`을 호출** → 사용자가 클리핑을 한 번도 안 열고 undo만 해도 image를 찾는다. ⇒ 불변식을 **"코어 공개 API 0 변경"**으로 정직 재정의. ServicePlugin 시그니처 `ImageProcessingPlugin | null` 정직화 + 전 사용처 null 가드 + History→Image deps 명시를 **P0.5 비파괴 선행작업**으로 분리.

2. **"매니페스트 `enabled:false` = 번들 제외"는 거짓** → `ImageProcessingPlugin.ts:2`의 `import * as d3`, `SmartCodePlugin.ts:4/6`의 jsbarcode/qr는 **static import**라 매니페스트 플래그와 무관하게 번들에 잔존. ⇒ 번들 절감은 오직 **static import 경계 절단**(dynamic import + stub)으로만 달성. `enabled:false`는 "런타임 미마운트"로 의미 한정.

3. **photobook 출력계약 오류** → 원안 `pdfOutputMode:'duplex-split'`은 `synthesis.processor.ts:125`의 카드/명함용(set_N.pdf 2p 세트)이라는 정정은 유효. 단 **이 문서의 재정정("실경로=`mode:'spread'`+`content-only`")도 오류였음이 2026-07-06 Track 1 정찰에서 확정**: ① `mode:'spread'` 워커 핸들러(`handleSpreadSynthesis`)는 존재하나 잡 생성자 `createSpreadSynthesisJob`(worker-jobs.service.ts:1061)을 호출하는 controller 라우트가 없어 **HTTP 로 도달 불가한 레거시(v2.5)**(DTO 주석의 `POST /worker-jobs/spread-synthesize` 는 미배선), ② `content-only` 는 compose-mixed 전용 outputMode(레더커버 분기)로 spread 경로와 무관. ⇒ **포토북/스프레드 실 LIVE 경로 = `POST /worker-jobs/compose-mixed` → 세션 metadata.spread 존재 시 `outputMode='separate'` 강제(cover.pdf+content.pdf 2파일, worker-jobs.service.ts:606-624 P0-3)**. photobook 프로파일은 `composeOutputMode:'separate'`(compose-mixed) 기준으로 설계할 것 — 이 문서를 근거로 `mode:'spread'` 에 배선하면 도달 불가 경로가 된다.

4. **"OpenCV 45MB 절감"은 신규 이득 아님** → OpenCV 10MB·ONNX·background-removal wasm은 **이미** `getCv()`/`getBackgroundRemoval()` dynamic import로 lazy이고 Vite가 청크 분리 완료. ⇒ 실제 남은 신규 레버는 jspdf 793KB + jsbarcode/qr + paper.js뿐. **아키텍처 확정 전 `rollup-plugin-visualizer`로 gzip 전송 기준 절감 KB를 정량화**해 ROI부터 확인.

---

## 3. 권고 — 2트랙 분리

### 트랙 A (지금 착수, 권고) — "무아키텍처" 번들 최적화
- **선행(0.5일)**: `rollup-plugin-visualizer` 1회 → gzip 절감 KB 실측. ROI 정당화.
- **작업(1~2주)**:
  1. `ServicePlugin`의 jspdf/svg2pdf(793KB)를 **finish 시 dynamic import**(thin wrapper, 인스턴스는 eager 유지).
  2. `SmartCodePlugin`의 jsbarcode/qr **static import + eager `new`(line 118/125) 절단** → 패널 진입 시 dynamic import.
  3. paper.js(Effect/Accessory) 2차 후보.
  4. **warmupOpenCv 미호출 부채 진단·수정**(2026-05-04부터 메뉴 클릭 차단 — 독립 버그, lazy 타이밍과 동일 근원 가능성).
- **게이트**: book/leaflet/photobook PDF qpdf 구조 + 픽셀 diff 0(또는 오너 승인 허용임계). 워커 도달값 스냅샷 일치.
- **위험**: PDF는 파트너 출력계약 심장 → byte-identical 재검증 비용 실재(과거 jspdf 4.x promote 별 사이클 선례). **단일 atomic 롤백** 보장(editor는 Vercel CLI 수동배포).
- **Registry/Manifest 프레임워크 불필요.** 기존 `if(spread)`/`enabledMenus`/`spreadConfig` 유지.

### 트랙 B (보류 — 4번째 상품 실착수 트리거) — Capability Registry + Product Profile
아래 §4 목표 아키텍처. **카드/캘린더/포스터 등 BOOK/LEAFLET/PHOTOBOOK과 면(surface) 모델이 다른 신상품이 실재할 때** 착수. 그 전엔 평면 if문으로 충분.

---

## 4. 목표 아키텍처 (트랙 B — 미래 착수 시 정본)

> over-engineering 비판 수용으로 **위상정렬·cascade 3단 머지·@술어 문자열 인터프리터 제거**. 평면·타입안전·grep가능 유지.

### 레이어
- **L0 Headless Core** (`packages/canvas-core`) — Editor, PluginBase, 28플러그인, SpreadLayoutEngine. **공개 API 불변.** 비파괴 내부수정 2건만 P0.5에서 격리(ServicePlugin null 정직화, `Editor.useAsync(capId)` 신설).
- **L1 Capability Registry** (`apps/editor/src/capabilities/registry.ts`) — `{ id, layer, deps, order, when:(ctx)=>boolean, load | loadAsync }`. **위상정렬 없음** — `order`는 손정렬 배열(`createCanvas.ts:281-314` 순서 1:1 박제), `deps`는 문서·검증용.
- **L2 Profile Resolver** (`resolveProfile.ts`) — **평면** `PRODUCT_PROFILES: Record<TemplateSetType, ProductProfile>` + `SITE_OVERRIDES` 얕은 1단 `Object.assign`. cascade 상속 체인 폐기. 미선언 = `DEFAULT_PROFILE`.
- **L3 Boot Orchestrator** (`createCanvas.ts` initPlugins) — 28회 명시 `use()`를 `resolveProfile → order 정렬 → when 필터 → use()` 순회로 치환. **외부 시그니처 불변, 내부만.**
- **L4 Capability 코드** — heavy는 명시 entrypoint(⚠️ canvas-core가 현재 `.` 단일 진입점 + 광역 배럴 `index.ts:34-53`이라 exports map 신설 + admin/preview 영향조사 + 트리셰이킹 회귀 = **P3b 별 사이클**).

### capability 5계층 (28플러그인 재분류, 코드 그대로 메타데이터만 부여)
- **foundation** (eager, 항상): Workspace·Object·Lock·Frame·Controls·Group·**History(deps:image — line 192)**·Copy·Align·Dragging·PointerShiftGuard·Font
- **interaction** (eager 기본, 프로파일로 제외): Filter·Effect·Accessory·Template
- **product** (조건부 eager, **코드 술어 유지**): Spread(`when: spreadConfig.spec || isInnerSpread`)·Ruler(`ENABLE_RULER`)·PhotoFrameSwap
- **output** (request-time): ServicePlugin(deps:image, static import 절단 필요)·Preview(CMYK)
- **heavy** (on-demand loadAsync): ImageProcessing(+d3 static import 절단)·SmartCode(jsbarcode/qr 절단)·AiPanel

### Product Profile 매니페스트 (평면·타입안전)
```ts
type ProductProfile = {
  profileId: string
  product: { templateSetType: TemplateSetType; editorMode: 'single'|'book'; pageRules?: {...} }
  capabilities: Partial<Record<CapId, { enabled: boolean; load?: 'eager'|'on-demand'; trigger?: string; options?: any }>>
  menus?: { whitelist: string[] }
  output: { workerMode: 'split'|'duplex-split'|'spread'|'compose-mixed'; composeOutputMode: 'separate'|'content-only'|'single'; colorMode?: string; bleedMm?: number; cropMark?: boolean }
  assets?: { libraryCategoryIds: string[]; fontSubset?: string[] }
}
const SITE_OVERRIDES: Record<string /*siteId*/, Partial<ProductProfile>>  // 얕은 머지
```

**파트너별 (5사이트, 코드분기 0):**
- `bookmoa.book` (BOOK): editorMode=book, spread{conversionMode:full, regionScope:cover}, output{compose-mixed, separate}
- `photobook.default` (PHOTOBOOK): spread{flat-spread, regionScope:inner}, photoFrameSwap, **output{`spread`, content-only}** (← duplex-split 정정), menus={text,image,frame,background,layer,template}
- `ShareSnap`/`frameshop`: photobook base + SITE_OVERRIDE{image:false, smartCode:false, menus=[photos,frame,text], theme}
- `100p_books`/`printcard`: 최소셋(output.service만, menus=[]), printcard는 workerMode:duplex-split
- `md2books`: BOOK + book모드, image:false. ⚠️ 하네스 PUBLIC 자동 push → **프로파일 시크릿 절대 미포함**

### 워커 출력 (whatNotToTouch 1순위)
프로파일 output은 워커 도달값을 **동일 값 재포장**만. `synthesis.processor.ts` mode 분기·composeOutputMode·OutputFile 스키마·파일명·경로 **1바이트 불변**. OutputModeStrategy factory 등 워커 리팩토링은 **사진인화 POD 실착수 시 별 워커 사이클**(선언만 두는 함정 방지).

---

## 5. 마이그레이션 로드맵 (트랙 B 착수 시)

| Phase | 내용 | 공수 | 위험 | 게이트 |
|---|---|---|---|---|
| **P0** | Capability 인벤토리 + 평면 PRODUCT_PROFILES (코드 미참조) | 3~4일 | 무 | 빌드 해시 불변 |
| **P0.5** | ⚠️비파괴 코어 정합 — ServicePlugin null 정직화·History→image deps·useAsync 신설 | 1주 | 중 | null no-op·undo 가드 픽셀 diff 0 |
| **P1** | Registry + 평면 resolveProfile, initPlugins 데이터화 | 2~2.5주 | 중상 | 최종 마운트 집합 동일 + **워커 도달값 JSON diff 0** + 픽셀 diff 0 (BOOK/LEAFLET/PHOTOBOOK×spread 매트릭스) |
| **P2** | 첫 heavy lazy(ImageProcessing) + warmupOpenCv 진단(blocker) | 2주 | 높음 | 배경제거 픽셀 diff 0 + undo·캔버스전환 레이스 스모크 |
| **P3a** | jspdf/jsbarcode dynamic import (= 트랙 A) | 2.5~3주 | 높음 | book/leaflet/photobook byte-identical |
| **P3b** | OutputContract 타입 + canvas-core 배럴 해체 packaging | 2~3주 | 중상 | admin·preview·editor 3소비자 빌드 그린 |
| **P4** | 포토북 프로파일 활성 + Site 격리(분리검증) | 3주 | 중상 | 4상품 DEFAULT byte-identical + output→worker 매핑표 + **사이트 격리 회귀 스위트(보안)** |

> 시금석: 어느 phase에서 중단해도 프로덕션 정상, 빅뱅 컷오버 없음.

**선행 인프라(1주, quickWin 아님)**: byte-identical 골든파리티 하네스 — 4상품 EditSession을 worker synthesis 통과시켜 PDF/PNG SHA256 고정. worker 로컬 재현(GS/qpdf/fonts/플래그) 필요. **부실하면 전 게이트 무력화** → 가장 먼저.

---

## 6. 오너 결정 대기

1. ⭐ **트랙 A만 먼저 vs 트랙 B 프레임워크 착수** — visualizer 정량화 후 결정. **CTO 권고: A 먼저 출하, B는 4번째 상품(카드/캘린더) 실착수 시.**
2. ⚠️ **photobook 출력계약 'spread' 정정 확인** — 워커 담당이 포토북 실경로 `spread`+content-only 맞는지 확인. **진행 중 포토북 작업에 영향.**
3. ⚠️ **byte-identical 게이트 엄격도** — 픽셀 diff 0 절대기준 vs 허용임계(과거 jspdf 4.x '이미지 무압축' 선례와 모순). 정당한 출력개선마다 골든 갱신 마찰 발생.
4. **골든파리티 하네스 1주 선투자** 여부.
5. **Module Federation 미채택 유지** — 단일 React/Vercel/소규모팀에 과. 외부 파트너 자가배포 요구 실재 시 그 한 축만 iframe+postMessage로 보강.
6. **bookmoa PHP 보류** = DEFAULT 경로 라이브 확증 불가 → 골든 EditSession 회귀로만 검증.

---

## 6.5 트랙 A 병행 작업 주의사항 (다른 세션 조율) — 2026-06-30 측정 확정

**측정 확정 사실:**
- **워커 영향 0** — `apps/worker/src`·`apps/worker/package.json`에 jspdf/jsbarcode/paper/svg2pdf/canvas-core 의존 **전무**. 워커는 자체 PDF 스택(pdf-lib/Sharp/Ghostscript). **워커 기능 작업은 트랙 A와 완전 분리, 충돌 0.**
- **편집기 런타임 동작 = byte-identical** — 트랙 A는 *언제 로드되나*만 바꾸고 *무엇을 하나*는 불변. 출력물·기능 동일. 유일한 가시 변화 = "첫 사용 시 짧은 청크 다운로드"(바코드 첫 추가·PDF 첫 내보내기). 일회성·캐시 후 소멸. 기존 사용자 워크플로/주문/합성 무영향.

**트랙 A가 실제로 만지는 파일 (충돌면 = 이것뿐):**
- `packages/canvas-core/src/plugins/SmartCodePlugin.ts` (② jsbarcode/qr)
- `packages/canvas-core/src/plugins/ServicePlugin.ts` (① jspdf/svg2pdf)
- `packages/canvas-core/src/utils/save.ts` + `index.ts` 배럴 (④ pdf-lib)
- `packages/canvas-core/src/plugins/AccessoryPlugin.ts` (③ paper)
- `apps/editor/vite.config.ts` (manualChunks)
- ⚠️ `createCanvas.ts` 등록부(281-314)·다른 플러그인·API·워커는 **안 만짐**(등록순서 변경은 트랙 B 영역).

**다른 세션이 편집기 작업 시 주의 (4가지):**
1. **async 경계 전파** — ① `saveMultiPagePDF`는 이미 `async`라 호출처 무변경(안전). ② `barcode()`/`qrcode()`도 이미 `public async`(안전). ③ `svgPathArrayToPaperPath`는 **현재 동기 헬퍼** → 비동기화 시 호출처 await 필요. **paper 관련 코드 신규 작성 시 async 가정.**
2. **static import 재유입 금지(가장 미묘)** — jspdf·jsbarcode·qr-code-styling·paper·pdf-lib를 **새로 static import 하면 트랙 A 절감이 조용히 무효화**(번들 재유입). 이 5개는 **"dynamic import만"** 규칙. 특히 새 플러그인이 PDF/바코드/효과 기능 추가 시.
3. **같은 4파일 동시 편집** — 새 플러그인 추가(`editor.use`)·객체편집·모바일 UX·일반 fabric 작업은 대부분 다른 파일이라 안전. 단 PDF출력/바코드/효과·액세서리/저장 로직을 만지면 = 같은 파일 → 조율.
4. **byte-identical 골든 공유** — 트랙 A가 PDF 출력 골든을 세팅하면, 다른 세션의 PDF 관련 변경도 같은 게이트 통과(정당한 출력 변경이면 골든 갱신). 출력 동작을 의도적으로 바꾸는 작업은 트랙 A와 골든 충돌 → 조율.

**권장 운영:** 트랙 A는 작은 PR 여러 개(②→①→④→③) 빠르게 머지, 장기 브랜치 금지(canvas-core 충돌 최소화). 워커 작업은 완전 병행. 편집기 작업은 위 4파일만 피하면 병행 안전.

---

## 7. 절대 불변 (whatStaysShared)
canvas-core 공개 API · 28플러그인 외부 동작 · foundation 11종 · 워커 출력 파이프라인 · 파트너 웹훅/HMAC/멱등가드 · 좌표 규약(중앙원점@150dpi) · fabric 5.5.2 핀 · embed postMessage 엔벨로프+dual-emit · Site 인증(@CurrentSite/ApiKeyStrategy) · 멀티테넌시 인프라(applySiteScope, library 카테고리 큐레이션).
