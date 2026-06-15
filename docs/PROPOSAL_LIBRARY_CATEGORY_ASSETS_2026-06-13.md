# 라이브러리 카테고리 에셋 로딩 + 기본 폴백 + 편집기 UX 통합 설계 제안서

- 작성일: 2026-06-13
- 대상 레포: `storige-book-editor` (master)
- 범위: 고객 편집기(요소/프레임/배경) 에셋 패널의 "빈 로딩" 버그 수정 + 템플릿셋↔카테고리 큐레이션 모델 정합 + 기본(default) 폴백 보장 + 미리캔버스/캔바식 편집기·관리자 UX
- 성격: **설계 문서** (코드 수정 없음). 본 문서는 P0 핫픽스부터 P3 UX까지 단계적 구현 순서를 제시한다.

> 입력: 3개 독립 조사(버그 진단 / 데이터 모델 / UX 리서치). 본 설계는 그 결과를 종합하되, 핵심 좌표(파일:라인)는 코드베이스 라이브 검증을 거쳤다.

---

## 0. 핵심 요약 (TL;DR)

라이브러리 에셋 패널이 통째로 비는 현상의 **근본 원인은 보안 5커밋 회귀가 아니다**(라이브로 배제). 실제 원인은 2건의 장기 잠복 버그다.

1. **(P0, 지배적) role 대소문자 불일치** — shop-session JWT가 `role: 'customer'`(소문자)를 발급하는데, 편집기 `useIsCustomer`는 `=== 'CUSTOMER'`(대문자)로 비교 → 항상 `false` → 패널 fetch·렌더 자체가 차단되어 "추천 콘텐츠가 없습니다"조차 안 뜨는 완전 공백.
2. **(P0, 부차) 상대경로 URL 호스트 미prefix** — API는 `imageUrl: '/storage/...'`(상대경로)을 반환하는데, 패널 `<img>`와 캔버스 배치(`addAssetToCanvas`)가 그대로 사용 → Vercel 편집기 origin에서 404. 이미 정답 패턴(`resolveThumbnailUrl`)이 같은 코드베이스에 존재한다.

데이터·카테고리 인프라는 **대부분 정상 배선**(element/frame/background 3종은 큐레이션·전역폴백까지 작동). 남은 데이터 공백은 (a) admin 클립아트/배경 폼이 FK `categoryId` 대신 레거시 자유텍스트 `category`만 세팅 → 큐레이션 ON 시 필터아웃, (b) 폰트 카테고리 컬럼 부재다.

권장 순서: **P0 버그 2건 즉시 수정 → P1 빈 화면 절대금지(default 폴백) → P2 카테고리 바인딩 정합(admin categoryId) → P3 캔바/미리캔버스식 UX**.

---

## 1. P0 — '빈 로딩' 즉시 수정안 (회귀 아님 / 잠복 버그)

### 1.0 회귀 배제 근거 (보안 5커밋 무관)

- 보안 5커밋(`55a8304`/`4701994`/`32b5d2c`/`23c4beb`/`4c06584`) 어디에도 에셋 GET 라우트 변경 없음. `editor-contents.controller.ts` 마지막 변경은 `2fa70a9`(보안 커밋 외).
- `4701994`가 `library.controller.ts`에 추가한 `@Throttle(15/min)`은 `woff2ToTtf` 한정. 전역 `ThrottlerGuard`는 300/min/IP로 에셋 요청량을 넘지 않음.
- 결론: **SEC 회귀 아님.** 아래 2건은 보안 커밋 이전부터 존재한 잠복 버그.

### 1.1 [P0-A · 지배적] role 대소문자 불일치 → 패널 완전 공백

**증상**: shop-session(외부 쇼핑몰)으로 진입한 고객 편집기에서 요소/프레임/배경 패널이 통째로 비어 있음(추천 섹션 자체가 렌더 안 됨).

**원인 체인 (검증됨)**:

| # | 위치 | 사실 |
|---|------|------|
| 발급 | `apps/api/src/auth/auth.service.ts:125` | shop-session payload `role: 'customer'` (소문자 하드코딩, 커밋 `30dda76`) |
| 정의 | `packages/types/src/index.ts:14` | `UserRole.CUSTOMER = 'CUSTOMER'` (대문자) — 같은 파일 line 68은 대문자를 쓰지만 shop 경로만 소문자 |
| 응답 | 라이브 `POST /auth/me` (customer 토큰) | HTTP 200, `{"role":"customer",...}` |
| 수신 | `apps/editor/src/api/auth.ts` `getMe()` → `useAuthStore.checkAuth` | `me.role = 'customer'` 그대로 저장(정규화 없음) |
| 차단 | `apps/editor/src/stores/useAuthStore.ts:127` | `useIsCustomer = me?.role === 'CUSTOMER'` → `'customer' === 'CUSTOMER'` = **false** |
| 결과 | `AppElement.tsx:81` `if (!isCustomer) return` (fetch 차단) + `AppElement.tsx:175` `{isCustomer && (...)}` (섹션 은폐) / `AppBackground.tsx:112`,`:491` 동일 | 패널 통째 공백 |

> 라이브 검증: editor 어디에도 role 대소문자 정규화 없음(`useAuthStore.ts:126-127`이 유일한 role 비교, `.toUpperCase()` 부재). `/embed`(EmbedView) 경로도 동일 store를 쓰므로 **일반·embed 경로 모두** 동일 증상.

**권장 수정 (이중 방어, 둘 다 적용 권장)**:

- **수정 1 (편집기 정규화 — 즉효·무중단, 1순위)**: `apps/editor/src/stores/useAuthStore.ts:127`
  - `me?.role === 'CUSTOMER'` → 대소문자 무시 비교로 변경.
  - 예: 셀렉터에서 `(state.me?.role ?? '').toUpperCase() === 'CUSTOMER'`. 동일하게 line 126 `useIsAdmin`도 `.toUpperCase()` 적용해 일관화(현재 `'ADMIN'`/`'SUPER_ADMIN'` 비교도 대문자 가정).
  - 더 견고한 대안: `checkAuth`에서 `me` 저장 직전 `me.role = String(me.role).toUpperCase()`로 정규화(한 곳에서 차단). 이 경우 role을 사용하는 모든 셀렉터가 자동 보정됨.
  - **Vercel 자동 배포**(master push) → API 무중단. **이 한 줄이 P0의 90%를 해소.**

- **수정 2 (API 발급 정합 — 근본, 2순위)**: `apps/api/src/auth/auth.service.ts:125`
  - `role: 'customer'` → `role: UserRole.CUSTOMER`(='CUSTOMER')로 통일.
  - ⚠️ **호환성 주의**: 외부(PHP/bookmoa-mobile/JumboCard/ShareSnap/100p)가 이 토큰의 `role` 소문자값에 의존하지 않는지 확인 필요. 의존 시 깨질 수 있으므로, **수정 1을 먼저 배포**해 증상을 해소한 뒤 수정 2는 외부 영향 점검 후 별도 진행. 수정 1이 있으면 수정 2 없이도 편집기는 정상 동작.
  - API는 VPS 수동 배포(`docker compose up -d --build api`)이므로 단독으로 먼저 배포하지 말 것(수정 1 우선).

### 1.2 [P0-B · 부차] 상대경로 URL 호스트 미prefix → 썸네일·캔버스 404

**증상**: P0-A 해소 후에도, 에셋 썸네일이 깨지고(빈 이미지) 캔버스에 얹어도 로드 실패.

**원인 체인 (검증됨)**:

| 위치 | 사실 |
|------|------|
| `apps/api/src/editor-contents/editor-contents.service.ts:65` | `mapLibraryRow`가 `imageUrl: row.fileUrl`(='`/storage/library/...`' 상대경로) 반환 |
| `apps/editor/src/tools/AppElement.tsx:235,244-245` | `const imageUrl = (content).imageUrl ...` → `<img src={imageUrl}>` 원본 그대로 |
| `apps/editor/src/tools/AppBackground.tsx:538,547-548` | 동일 패턴 |
| `apps/editor/src/hooks/useEditorContents.ts:218-247` | `addAssetToCanvas(url)`가 raw url을 `core.loadSVGFromURL`(231)/`core.imageFromURL`(247)에 그대로 전달 → 썸네일뿐 아니라 **캔버스 배치도** 실패 |

> 라이브 실측: `api.papascompany.co.kr/storage/library/clipart/star-icon.svg` = 200, editor host(`editor.papascompany.co.kr/storage/...`) = 404. 정답 패턴은 같은 레포에 이미 존재: `HistoryPanel.tsx:17-23 resolveThumbnailUrl`, `fontManager.ts:27`, `api/storage.ts:4 API_BASE_URL`. 이 패널들만 누락.

**권장 수정 (공유 헬퍼 1개로 일원화)**:

1. **공유 헬퍼 추출**: `HistoryPanel.tsx:17` `resolveThumbnailUrl`를 `apps/editor/src/utils/url.ts`(신규) 또는 `api/storage.ts`로 끌어올려 `resolveAssetUrl(url)` 단일 함수로 export. 로직 동일: `http(s)://`면 그대로, 아니면 `VITE_API_BASE_URL` prefix.
2. **썸네일 적용**: `AppElement.tsx:245` / `AppBackground.tsx:548` 의 `src={imageUrl}` → `src={resolveAssetUrl(imageUrl)}`. (`AppFrame.tsx`의 동일 렌더 지점도 함께 점검 — 같은 누락 가능성)
3. **캔버스 배치 적용 (핵심)**: `useEditorContents.ts:218` `addAssetToCanvas` 진입부에서 `const resolved = resolveAssetUrl(url)`로 정규화 후 `loadSVGFromURL`/`imageFromURL`에 `resolved` 전달. 이렇게 하면 `safeGetImageUrl`/`safeGetDesignUrl`(76,82) 경로와 무관하게 모든 캔버스 배치가 보정됨.
4. **(선택, 서버측 대안)** `mapLibraryRow:65`에서 절대 URL을 내려보내는 방법도 가능하나, 편집기 origin이 여럿(일반/embed/외부)일 수 있어 **클라이언트 prefix가 더 안전**. 서버는 상대경로 유지 권장.

> 두 P0 모두 적용 후: customer 토큰 진입 → 패널 렌더(`isCustomer=true`) → fetch 200 → 썸네일·캔버스 절대 URL → 정상 표시.

---

## 2. 카테고리 바인딩 모델 (스키마 + 기본 폴백 규칙)

### 2.1 기존 인프라 재활용 — `TemplateSetLibraryCategory` 그대로 사용

조사 결과 **새 스키마 불필요**. 다음이 이미 배포·작동:

- 조인 테이블 `template_set_library_categories` (마이그레이션 `20260609_add_template_set_library_categories.sql`): `template_set_id` + `library_category_id`, `uk_tslc` unique, `idx_tslc_set`. delete-then-insert 전량교체(`template-sets.service.ts:47-55`).
- 규약(엔티티 주석 line15-19, 서비스 line104): **연결 0개 = 전역(전체 노출), 1개 이상 = 그 카테고리만.** ← 이것이 곧 "기본 폴백" 1차 안전망.
- `TemplateSet.libraryCategoryIds`는 transient 필드(`template-set.entity.ts:180-183`), create/update/findOne 시 조인 테이블에서 populate. DTO·`packages/types` 반영됨.
- 카테고리 엔티티 `LibraryCategory`: `name`/`type`(`'background'|'shape'|'frame'|'clipart'|'font'`)/`parentId`(self-tree)/`sortOrder`/`isActive` (`category.entity.ts:14,21-34`).

**상품→카테고리 직접 참조는 없음**(상품은 `product_template_sets`로 템플릿셋에만 매핑, 카테고리는 항상 템플릿셋 경유). 이 구조 유지 권장 — 상품군 큐레이션은 "상품 → 템플릿셋 → 카테고리" 경로로 충분.

### 2.2 데이터 공백 2건 (P2에서 정합)

| 공백 | 사실 | 영향 |
|------|------|------|
| ① 클립아트/배경 admin 폼이 FK 미세팅 | `ClipartList.tsx`·`BackgroundList.tsx`가 자유텍스트 `category`만 전송, `categoryId` 절대 미세팅(라이브 grep: ClipartList `categoryId` 0건). 반면 `ShapeList.tsx:40,109,118,136`·`FrameList.tsx`는 `LibraryCategory` Select로 `categoryId` 정상 세팅 | 템플릿셋에 큐레이션을 켜면 클립아트·배경은 `category_id IN (...)` 필터에서 **전부 누락**(전역에서만 보임) |
| ② 폰트 카테고리 컬럼 부재 | `font.entity.ts`에 `category` 0건. `LibraryCategoryType`에 `'font'`는 정의되어 있으나 엔티티에 FK 없음 | 폰트 큐레이션 불가(스키마 자체 부재) |

> 추가 메모: `background.entity.ts:27-31`·`clipart.entity.ts:27-31`은 레거시 `category`(varchar)와 FK `category_id`가 **병존**. shape/frame은 `categoryId`만. 도형(shape)은 편집기에 노출 패널이 없어 큐레이션 무의미(P3에서 패널 추가 여부 결정).

### 2.3 기본(default) 카테고리 폴백 규칙 — **절대 빈 화면 금지**

3단 폴백(위에서부터 우선):

1. **큐레이션 매치**: `templateSetId` 연결 카테고리(`getCuratedCategoryIds`)에 속한 에셋. (현행)
2. **전역 폴백(=연결 0개)**: 연결이 없으면 `curatedIds=null` → 필터 미적용 = 전 카테고리 노출. (현행, `editor-contents.service.ts:104`)
3. **default 카테고리 폴백(신규 — P1)**: 연결이 1개 이상인데 **결과가 0건**이거나(데이터 공백 ① 같은 상황), 또는 default를 항상 섞고 싶을 때 → `LibraryCategory.isDefault`(신규 boolean) 또는 예약 카테고리명(`'기본'`)의 에셋을 **항상 병합 노출**.
   - 스키마: `library_categories`에 `is_default BOOLEAN DEFAULT 0` 추가(타입별 최대 1개 권장, admin에서 토글). 또는 서버에서 "큐레이션 결과 total=0이면 전역으로 자동 강등(fallback to global)" 로직만으로도 빈 화면을 막을 수 있음(스키마 무변경 안).
   - **권장 최소안(스키마 무변경)**: `findFromLibrary`에서 큐레이션 필터 적용 후 `total===0`이면 필터를 제거하고 1회 재조회(전역 강등). 이것만으로 "빈 화면 절대금지"를 보장하며 P1에서 즉시 가능.
   - **권장 확장안(스키마 변경, P2)**: `is_default` 카테고리를 큐레이션 집합에 항상 union → 브랜드 무관 공용 에셋(기본 도형·기본 배경)을 늘 노출.

---

## 3. 편집기 로드 흐름 (일반·/embed 공통)

현행 배선(element/frame/background 한정)은 이미 완전:

```
session → useEditorStore.templateSetId (useEditorStore.ts:110, session.templateSetId)
  → AppElement/AppFrame/AppBackground 가 contentsApi.get*({ templateSetId })
      (AppElement.tsx:61/87, AppFrame.tsx, AppBackground.tsx:95~)
  → GET /editor-contents/* (QueryEditorContentDto.templateSetId)
  → EditorContentsService.findFromLibrary
      → getCuratedCategoryIds(templateSetId)  // 화이트리스트
      → null → 전역 / 배열 → c.category_id IN (...)  (service.ts:102-107)
  → mapLibraryRow → imageUrl(상대경로) 반환
  → [P0-B 적용] resolveAssetUrl 로 절대화 → <img> / 캔버스
```

**개선 후 목표 흐름**:

1. `templateSetId` 도출(현행). embed/일반 동일 store → **분기 불필요**.
2. 카테고리 화이트리스트 조회(현행) → **default union/강등 폴백 추가**(§2.3).
3. fetch 게이트를 `isCustomer`(P0-A 정규화)로 정상 통과.
4. 응답 URL을 `resolveAssetUrl`로 절대화(P0-B) → 썸네일·캔버스 양쪽.
5. (P3) 카테고리 칩/탭으로 화이트리스트 내 하위 카테고리 필터 — 검색·태그칩과 병존.

> embed 특이사항: `embed.tsx`/`EmbedView.tsx`도 동일 `useAuthStore`·동일 패널 컴포넌트 사용 → P0/P1 수정이 자동으로 embed에 적용됨. 별도 코드 불필요. 단 embed는 외부 origin iframe이므로 `VITE_API_BASE_URL`이 절대 URL(api.papascompany.co.kr)로 주입돼 있는지 빌드 ENV만 확인.

---

## 4. 편집기 UI/UX (미리캔버스 / 캔바 적용)

### 4.1 현황 정합

우리 편집기 패널(`AppElement` 등)은 이미 **검색바 + 태그칩 + 추천 콘텐츠 섹션 + 더보기 + templateSetId 큐레이션**을 보유 → 캔바/미리캔버스 구조와 정합. 격차는 (a) 검색 결과 필터(색상/방향) 부재, (b) 빈 상태 폴백을 default 에셋으로 채우는 보장, (c) IMAGE/BACKGROUND/FRAME 패널 간 칩·검색 일관성, (d) 모바일 drawer.

### 4.2 데스크톱 좌측 레일 패널 와이어프레임 (텍스트)

```
┌─ [요소] 패널 (280px) ─────────────────────────┐
│ ┌─────────────────────────────────────────┐ │
│ │ 🔍  요소 검색…                      [필터▾]│ │  ← 검색바 + (P3)필터 버튼
│ └─────────────────────────────────────────┘ │
│ [전체][도형][아이콘][라인][장식]  →가로스크롤  │  ← 카테고리 칩(화이트리스트 from templateSet)
│ #인기  #심플  #손그림  #기하학           →      │  ← 태그칩(현행)
│ ─────────────────────────────────────────── │
│ 추천 콘텐츠                          [더보기>] │  ← 섹션 헤더(현행 AppSection)
│ ┌────┐┌────┐┌────┐                           │
│ │ ▢ ││ ▢ ││ ▢ │  ← 썸네일 그리드(resolveAssetUrl)│
│ └────┘└────┘└────┘   호버=확대 미리보기        │
│ ┌────┐┌────┐┌────┐   클릭/더블클릭=캔버스 추가   │
│ │ ▢ ││ ▢ ││ ▢ │   드래그=위치지정 배치         │
│ └────┘└────┘└────┘                           │
│  … (lazy-load: 스크롤 하단 도달 시 다음 page) │
│                                              │
│ [빈 상태일 때] → "추천 콘텐츠가 없습니다" 금지.│
│   default 카테고리 에셋으로 그리드 채움(§2.3)  │
└──────────────────────────────────────────────┘
```

캔바/미리캔버스 차용 포인트(출처는 UX 리서치 findings):

- **검색 전에도 기본 노출**(빈 화면 방지): 캔바 "Browse categories → See all", 미리캔버스 "검색바 밑 태그 칩". → 우리는 추천 섹션 + default 폴백으로 충족.
- **추가 상호작용 양립**: 클릭(더블클릭) 추가 + 드래그앤드롭 배치. 현행 `addContentToCanvas`(클릭)는 있음 → (P3) 드래그 핸들러 추가 검토.
- **호버=미리보기, 클릭=고정(pin)**: 데스크톱 레일 패턴.
- **검색 결과 필터(P3)**: 색상/방향/무료유료. 우리 데이터엔 색상 메타가 약하므로 우선 **태그 기반 필터**로 시작, 색상은 후순위.
- **일관성**: 요소/배경/프레임 패널 모두 동일한 "칩+검색+추천+더보기" 레이아웃으로 통일.

### 4.3 모바일 임베드 대응

- 현행: 280px 사이드 오버레이. 캔바식 **하단 drawer**(plus 버튼 → 탭 달린 접이식 drawer, 캔버스 선택 시 자동 숨김)가 터치에 더 적합.
- 권장: embed/coarse-pointer 환경에서 패널을 하단 시트로 전환. 칩은 가로스크롤 유지. `isCoarsePointer`(이미 `AppElement.tsx:139`에서 사용 중)로 분기.
- lazy-load·썸네일 절대화는 모바일에서 더 중요(대역폭).

---

## 5. admin 관리 UI

### 5.1 카테고리 CRUD (신규 또는 보강)

- `LibraryCategory` 관리 화면: `name`/`type`(background|shape|frame|clipart|font)/`parentId`(트리)/`sortOrder`/`isActive` (+P2 `isDefault`).
- type별 트리 뷰 + 정렬 + 활성 토글. 기존 admin Library 페이지 하위에 "카테고리" 탭 추가.

### 5.2 에셋 ↔ 카테고리 분류 (P2 핵심 — 데이터 단절 해소)

- **`ClipartList.tsx`·`BackgroundList.tsx` 폼에 `LibraryCategory` Select 추가** — `ShapeList.tsx:40,109,118,136`·`FrameList.tsx`의 패턴을 그대로 복제:
  - `useState selectedCategoryId`, 업로드/수정 mutation에 `categoryId` 포함.
  - 레거시 자유텍스트 `category`는 호환을 위해 당분간 병존 가능하나, **큐레이션 기준은 `categoryId`** 임을 명확히(표시는 categoryId 우선).
- (선택) 기존 레거시 `category` 문자열 → `categoryId` 매핑 백필 스크립트(1회성, §6 마이그레이션).

### 5.3 템플릿셋 ↔ 카테고리 연결

- 이미 존재: `TemplateSetForm.tsx`의 카테고리 멀티셀렉트(마이그레이션 주석에 언급, `template-sets.service.ts`가 populate/upsert). 동작 확인 후 UX만 보강(타입별 그룹핑, "연결 0개 = 전역" 안내 문구, default 카테고리 표시).

---

## 6. 마이그레이션 / 배포 순서

> ⚠️ prod `synchronize: off` + `forbidNonWhitelisted`. admin(Vercel 자동) ≠ API(VPS 수동). 스키마 변경 시 **마이그레이션 직접 실행 후 API 재배포** 순서 엄수(메모리: `feedback_schema_change_deploy`). API만 recreate 시 nginx 502 주의 → 필요 시 nginx도 재시작(`feedback_api_redeploy_nginx`).

### 단계적 구현/배포 순서

**P0 — 버그 핫픽스 (스키마 무변경, 당일)**
1. 수정 1: `useAuthStore.ts:127`(+126) role 대소문자 정규화 → master push → **Vercel 자동 배포(editor)**. 무중단. 즉시 검증.
2. 수정(P0-B): `resolveAssetUrl` 헬퍼 추출 + `AppElement/AppBackground(/AppFrame)` 썸네일 + `useEditorContents.addAssetToCanvas` 적용 → master push → Vercel 자동.
3. (선택, 외부 영향 점검 후) 수정 2: `auth.service.ts:125` `role: UserRole.CUSTOMER` → **API VPS 수동 배포** `docker compose up -d --build api` (+필요 시 nginx 재시작). 수정 1이 이미 있으므로 비긴급.

**P1 — 빈 화면 절대금지 (스키마 무변경, 단기)**
4. `findFromLibrary`에 "큐레이션 결과 total=0 → 전역 강등 재조회" 폴백 추가 → API 빌드·배포.
5. 편집기 빈 상태 텍스트("…없습니다")를 default 그리드로 대체.

**P2 — 카테고리 바인딩 정합 (스키마 변경, 중기)**
6. (스키마) `library_categories.is_default BOOLEAN DEFAULT 0` 추가 마이그레이션 작성(파일명 규약: `apps/api/migrations/YYYYMMDD_add_library_category_is_default.sql`, `20260609_...` 헤더 주석 양식 따름). (선택) `library_fonts.category_id` 추가로 폰트 큐레이션 활성화.
7. 마이그레이션을 **prod DB에 직접 실행**(synchronize off) → 이후 API 재배포(VPS) → nginx 점검.
8. admin: `ClipartList`/`BackgroundList`에 categoryId Select 추가(Vercel 자동). 레거시 category→categoryId 백필 1회성 스크립트(선택).
9. default union 로직을 `getCuratedCategoryIds`/`findFromLibrary`에 반영.

**P3 — UX (대부분 프론트, 스키마 무변경, 점진)**
10. 카테고리 칩 탭(화이트리스트 기반) + 패널 일관화 + lazy-load 보강.
11. 드래그앤드롭 배치, 호버 미리보기, 검색 결과 필터(태그 우선, 색상 후순위).
12. 모바일/embed 하단 drawer 전환.

---

## 7. 검증 체크리스트

- [ ] P0-A: customer 토큰으로 `/embed` 진입 → 요소/배경/프레임 패널 렌더(`isCustomer=true`), fetch 200.
- [ ] P0-B: 썸네일 절대 URL(`api.papascompany.co.kr/storage/...` 200), 캔버스 배치 SVG/IMG 로드 성공.
- [ ] P1: 큐레이션 켜진 템플릿셋에서 결과 0건이어도 빈 화면 없음(전역/ default 폴백).
- [ ] P2: admin에서 클립아트/배경에 categoryId 지정 → 해당 템플릿셋 큐레이션에 정상 노출.
- [ ] 회귀: 일반 경로(비-shop) 고객·전역 노출 케이스 정상.

---

## 부록 A — P0 버그 수정 지점 (파일:라인) 요약

| ID | 수정 파일 | 라인 | 변경 요지 |
|----|-----------|------|-----------|
| P0-A 수정1 | `apps/editor/src/stores/useAuthStore.ts` | 127 (및 126) | role 비교를 대소문자 무시로 (`.toUpperCase() === 'CUSTOMER'`) 또는 `checkAuth`에서 `me.role` 정규화 |
| P0-A 수정2 | `apps/api/src/auth/auth.service.ts` | 125 | `role: 'customer'` → `role: UserRole.CUSTOMER` (외부 호환 점검 후) |
| P0-B 헬퍼 | `apps/editor/src/components/editor/HistoryPanel.tsx` → 공유 추출 | 17-23 | `resolveThumbnailUrl` → `utils/url.ts resolveAssetUrl`로 승격·export |
| P0-B 썸네일 | `apps/editor/src/tools/AppElement.tsx` | 245 | `src={imageUrl}` → `src={resolveAssetUrl(imageUrl)}` |
| P0-B 썸네일 | `apps/editor/src/tools/AppBackground.tsx` | 548 | 동일 (+ `AppFrame.tsx` 동일 지점 점검) |
| P0-B 캔버스 | `apps/editor/src/hooks/useEditorContents.ts` | 218-247 | `addAssetToCanvas` 진입부에서 `resolveAssetUrl(url)` 후 `loadSVGFromURL`(231)/`imageFromURL`(247)에 전달 |

참고(서버 URL 원천): `apps/api/src/editor-contents/editor-contents.service.ts:65` `mapLibraryRow` `imageUrl: row.fileUrl`(상대경로) — 서버는 상대경로 유지, 클라이언트 prefix 권장.
