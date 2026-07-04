# 편집기 저장/불러오기 구조 + 사이즈 변경→가격 재계산 갭 — 조사 보고·작업 지시문 (2026-07-04)

> 조사: 4에이전트 병렬(버튼·스토리지 / git 고고학 / storige 사이즈 전파 / bookmoa-mobile 가격 흐름), file:line 전수.
> bookmoa-mobile 레포: `/Users/yohan/Developer/claude/bookmoa-mobile` (Vite+React SPA + Vercel serverless `api/*.js`).

## 1. '불러오기'는 어느 스토리지인가 — 판정

| 동작 | 스토리지 | 경로 |
|---|---|---|
| **불러오기** (헤더 FolderOpen 버튼 → WorkspaceModal) | **서버 DB `file_edit_sessions`** | `GET /edit-sessions/my?summary=1` → `status !== 'complete'`(draft/editing)만 최신순 표시 → 선택 시 `core.loadFromJSON(canvasData)` (WorkspaceModal.tsx:30-31) |
| **중간 저장** (자동저장 + '내 작업에 저장'=saveNow) | **서버 DB 동일 테이블** | `PATCH /edit-sessions/:id {canvasData, status:'editing'}` (useEmbedAutoSave.ts:206-210) |
| 중간 저장 **실패 시 폴백** | localStorage `storige_embed_session_backup` | 임시 보관·복구 제안(restoreDecision). 서버 저장 아님을 UI 문구로 구분 (useEmbedAutoSave.ts:18,102,408) |
| 게스트 | 서버 DB (guest 라우트) | `PATCH /edit-sessions/guest/:id?guestToken=…` — PDF 미생성, canvasData만 |

즉 **불러오기와 중간 저장은 같은 서버 레코드(edit_sessions.status='editing')를 쓰고-읽는 대칭 쌍**이고, localStorage는 네트워크 실패 대비 임시 백업일 뿐이다.

## 2. 초기 버전 '저장 2종' 고고학 — 이유 확정

- **실체**: 최초 EditorHeader(커밋 2fa70a9 생성, 27828af 실배선) 우측에 [인쇄미리보기][PDF저장][**내 작업에 저장**(Upload)] | [**불러오기**(당시 Save 아이콘!)][**편집완료**(Check)]가 나란히 있었다. 실제 드롭다운/서브메뉴 코드는 어느 버전에도 없음 — '최외곽 저장+하위 저장/불러오기' 기억은 이 인접 버튼 묶음(+불러오기가 Save 아이콘을 달았던 아이러니)의 회상으로 판정.
- **저장이 2종이었던 근본 이유 = 저장 대상 테이블이 2개**:
  1. `editor_designs` — 사용자 개인 **작품 라이브러리**('내 작업에 저장', useWorkSave→designsApi, 썸네일+스토리지 URL)
  2. `edit_sessions` — **주문에 묶인 편집 세션 상태머신**('내 작업에 저장'=status:'editing' 임시저장 vs '편집완료'=complete 확정저장). 커밋 27828af가 status enum에 'editing'을 추가하며 임시/완료 이원화 확립.
- **정리 경위**: 65460bf(Feb 23)에서 bookmoa 임베드 운영상 불필요한 3버튼(미리보기/PDF저장/내작업저장) 숨김 → 현재 가시 버튼은 [불러오기][편집완료](+3D 미리보기·레이어·도움말)뿐. '저장' 개념은 Cmd/Ctrl+S 단일 진입점으로 수렴해 role별 자동 분기(고객→handleFinish / admin standalone→editor_designs / admin 템플릿셋→templates PATCH). pre-monorepo 구 에디터 유산(useWorkSave의 3갈래: designs/localStorage tempWork/서버 로드)이 원류.

## 3. 사이즈 선택 기능 — 현황과 갭 (심각)

**용도**: EditorHeader 중앙 '작업 사이즈' Popover(프리셋 8종+mm 직접입력 10~1500mm, EditorHeader.tsx:678-758)는 본래 자유편집/일반작업용 범용 컨트롤. 그런데 **embed 고객에게도 게이트 없이 노출**된다(유일한 가림 = `hidden md:inline-flex` — 데스크톱 md+ 한정. 모바일 임베드에선 안 보임).

**갭 체인 (규격을 바꾸면 일어나는 일)**:
1. `applySize` → zustand settings + WorkspacePlugin.setOptions만 — **시각 리사이즈뿐, 세션/API 무접촉** (EditorHeader.tsx:537)
2. setOptions는 object:modified를 emit하지 않아 **autosave dirty조차 안 섬** (WorkspacePlugin.ts:512)
3. 세션 `metadata.size`/`orderOptions`는 **생성 시 1회 스냅샷 고정** (embed.tsx:619-648) — 갱신 경로 없음
4. `editor.complete` payload(EditorResult)에 **width/height 필드 자체가 없음** (embed.tsx:1185-1203). pageCount는 있으나 pages.initial/final은 options 하드코딩
5. 가격은 편집기에 없음(파트너 계산, embed.tsx:198 주석) — 규격 가변 가격 데이터가 애초에 안 나감
6. 워커 검증은 metadata.size/templateSet 권위 — 바뀐 규격의 PDF는 오히려 **SIZE_MISMATCH 실패 소지** (pdf-validator.service.ts:788)
7. bookmoa-mobile: `handleCompletePayload`가 **pageCount조차 추출 안 함**(sessionId/fileId/썸네일만, StorigeEditorHost.jsx:64-72). 가격은 처음부터 끝까지 selPages(최초 선택 옵션) 기준 — 클라 재계산·서버 권위 재계산(recompute.js)·웹훅 어디에도 편집 산출물↔옵션 정합 게이트 없음. specChanged 가드는 '고객 옵션 재선택'만 감지.

**결론**: 고객이 데스크톱 embed에서 규격을 바꾸면 — 가격 불변 + 주문 옵션 불변 + 검증은 templateSet 기준 → 인쇄사고 또는 검증실패. 페이지 증감도 가격에 미반영(포토북 pageCount 연동 계약은 편집기→payload까지만 존재, 소비처 부재).

## 4. UI/UX 개선 방향 (권장안)

**원칙: 주문 컨텍스트(embed)에서 규격의 권위 = 상품 옵션. 편집기는 규격을 '표시'하되 임의 변경시키지 않는다.**

- **A안(즉시, 권장)**: embed 주문 컨텍스트에서 사이즈 Popover를 **읽기전용 라벨**로 강등(클릭 시 "규격 변경은 상품 옵션에서 해주세요" 안내). editMode(관리자)·standalone(자유편집)에서만 편집 가능 유지.
- **B안(중기, 계약 확장)**: 파트너가 허용 규격 목록을 options로 주입 → Popover가 '옵션 변경 요청' UI로 전환 → 선택 시 `editor.sizeChangeRequested` postMessage → 파트너가 가격 재계산·옵션 재확정 후 세션 재주입. (지금은 A안 선행)
- **pageCount(포토북 페이지 가변)**: 이미 payload에 실려 나감 — bookmoa-mobile이 소비해 `base + max(0, pageCount−includedPages) × perPageUnit` 재계산 + 장바구니 담기 전 고객 고지("페이지 N장 추가로 금액이 변경되었습니다").
- **최종 방어선**: 결제 시점 서버 권위 재계산에서 편집 산출 페이지수 vs cfg.pages **fail-closed 정합 게이트**.

## 5. 작업 지시문 ① — storige (이 세션)

> 전제: 공유 UX 상품 비종속, default-permissive, editor.complete 계약은 additive 확장만(기존 파트너 무파괴).

- **S1. 사이즈 Popover 게이팅** — EditorHeader.tsx:678-758. 주문 컨텍스트 판정(= embed 진입 && orderSeqno/세션 존재, EditorHeader에 prop 또는 store로 전달)이면 Popover를 읽기전용 라벨+안내 토스트로 강등. editMode/standalone은 현행 유지. 회귀 테스트: embed 렌더에서 사이즈 입력 UI 부재 단언.
- **S2. editor.complete payload 확장(additive)** — EditorResult에 `size:{width,height,unit:'mm'}`(currentSettings.size 실값)와 `pages.final` 실값(라이브 캔버스 기준) 추가. 정식 envelope·legacy storige:completed 양쪽. PLATFORM_INTEGRATION_GUIDE.md 계약 표 갱신.
- **S3. 세션 metadata 정합(선택·후속)** — 규격이 (관리자/standalone에서) 바뀐 채 저장될 때 autosave에 `metadata.size` 동봉 검토. ⚠️ WorkspacePlugin.setOptions에 이벤트 emit 추가는 히스토리 오염 리스크 — dirty 트리거는 saveToServer 직전 currentSettings 비교 방식 권장.
- **S4. (버그 예방) SIZE_MISMATCH 사전 차단** — S1 적용 시 자연 해소되나, S1 예외 경로(EditorView product-based customSize URL)는 product.allowCustomSize=true 상품 한정임을 문서에 명시.

## 6. 작업 지시문 ② — bookmoa-mobile 세션 (레포: /Users/yohan/Developer/claude/bookmoa-mobile)

- **B1. complete payload 소비** — `src/components/StorigeEditorHost.jsx` handleCompletePayload(:64-72)에서 `pageCount`(+향후 `size`) 추출해 onComplete 결과에 포함. storige:completed/editor.complete 양형식.
- **B2. 가격 재계산 + 고객 고지** — `src/components/StorigeFileUploadPanel.jsx` onComplete(:535)·onChange(:153)로 pageCount 상위 전파 → `src/pages/ProdConfigure.jsx`(:579 quote, :786 handleAdd)에서 `pageCount !== selPages`면 selPages 갱신+quote 재계산+고지 모달(또는 옵션 재선택 유도). cfg.pages에 편집 산출값 저장.
- **B3. 장바구니 재계산 소스 확장** — `src/lib/cart-pricing.js` recalcCartItem(:55-110): item.storige.totalPages 존재 시 pages 소스로 우선 사용.
- **B4. 결제 서버 정합 게이트(fail-closed)** — `api/_lib/recompute.js`(:41-79): storige.totalPages vs cfg.pages 불일치 시 결제 거부+재확인 유도. (웹훅 totalPages는 p4-orders vestigial — orders 테이블 권위로 배선할 것, webhook.js:117-147 참조)
- **B5. 재편집 경로 동일 반영** — `src/pages/Orders.jsx` onComplete(:479): 재편집 산출 pageCount로 cfg.pages/quote 갱신(운영 정책상 금액 변경 허용 여부는 오너 결정 — 발주 후 동결 설계(editLock)와 연계).
- **선행 의존**: B1은 현행 payload의 pageCount만으로 착수 가능. size 반영은 storige S2 배포 후.

## 7. 오너 결정 대기
1. A안(embed 사이즈 잠금) 즉시 적용 승인 여부 — 데스크톱 embed에서 기능이 사라지는 가시 변화.
2. B5 재편집 금액 변경 정책(자동 재계산 vs 재편집 시 페이지 증감 차단) — 발주 후 동결(editLock) 설계와 함께.
3. B안(옵션 변경 요청 postMessage 계약) 착수 시점.
