---
name: photobook-template
description: Storige 포토북(Photobook) TemplateSetType 작업 가이드 — 펼침면 표지(싸바리/하드커버)·펼침면 내지·사진틀(photo frame) 중심 편집·사진 자동편집(EXIF)·레이어 패널·페이지 가변+장바구니 가격연동·300dpi 펼침면 래스터/72dpi 썸네일 뷰어. 포토북·photobook·사진앨범·화보집·양장/하드커버·싸바리·펼침면(facing/spread)·사진틀/프레임·자동배치/오토북·EXIF 정렬·레이어 z-order·페이지 DnD·펼침면 래스터·뷰어를 만지는 작업이면 명시적으로 '포토북'이라 안 해도 반드시 이 스킬을 사용. TemplateSetType 에 신규 타입을 추가하거나 BOOK/LEAFLET 과 다른 펼침면·사진중심 편집 동작을 설계/구현할 때도 사용.
---

# 포토북(Photobook) 템플릿 스킬

Storige `TemplateSetType` 에 추가되는 **포토북** 타입(펼침면 표지+내지, 사진틀 중심, 자동편집, 가변 페이지) 작업의 가이드. 기존 BOOK/LEAFLET 과 구조가 다르므로 "무엇을 재사용하고 무엇이 진짜 신규인지"를 정확히 분별하는 것이 핵심이다.

## 언제 사용

- `TemplateSetType` enum 에 타입 추가/분기, 포토북 템플릿셋 등록·검증
- 펼침면(facing/spread) 표지 또는 내지, 책등(spine)/날개(wing)/**싸바리**(하드커버 보드 wrap) 작업
- 사진틀(photo frame)·프레임 내부 사진 컨트롤(줌/팬/회전/스왑/빈틀삭제)
- 사진 **자동편집/자동배치**(날짜순·파일명순·장소별·랜덤), **EXIF**(촬영일시/GPS) 정렬
- 레이어 패널 z-order, 그룹/다중선택, 페이지 네비 썸네일 **DnD 재정렬**
- 가변 페이지 + 페이지당 단가 → **장바구니 가격 연동**(pageCount emit)
- 저장 시 **300dpi 펼침면 래스터** + **72dpi jpg 페이지 썸네일** + **뷰어/미리보기**(파트너 동일)
- 트리거 키워드: "포토북", "photobook", "사진앨범", "화보집", "양장", "하드커버", "싸바리", "펼침면", "facing", "spread 내지", "사진틀", "photo frame", "자동편집", "오토북", "자동배치", "EXIF", "레이어 패널", "z-order", "페이지 DnD", "펼침면 래스터", "플립북 뷰어"

## 📐 정본 설계서 (먼저 읽어라)

심층 설계·근거·file:line 매핑·오너결정·구현 Phase 는 정본 설계서에 있다. **작업 전 반드시 통독**:

> `.cursor/plans/PHOTOBOOK_TEMPLATE_DESIGN_2026-06-23.md`

이 SKILL.md 는 그 설계서의 운영 요약 + 함정 체크리스트다. 상세(데이터모델 코드·싸바리 geometry·자동편집 알고리즘·외부 편집기 벤치마크)는 설계서 §2~§11 을 본다.

## 핵심: 포토북이 BOOK/LEAFLET 과 다른 6축

현행 `TemplateSetType`(`packages/types/src/index.ts:94`)은 `BOOK`/`LEAFLET` 2종이고 내지는 **단면 1p** 캔버스다. 포토북은 다음이 다르다:

| 축 | BOOK/LEAFLET | PHOTOBOOK |
|---|---|---|
| 표지 | 무선/중철 스프레드 | **싸바리(하드커버 보드 wrap)** 포함 |
| 내지 단위 | 단면 1p | **펼침면(2-up facing)** + 거터 |
| 콘텐츠 | 텍스트/도형 자유 | **사진틀 중심**(1프레임=1사진 마스킹) |
| 시작점 | 빈 캔버스 | **자동편집(autofill)** 90% 완성본 |
| 페이지/가격 | 고정 메타 | **가변 + 페이지수→단가→장바구니** |
| 저장 | 벡터 PDF | + **300dpi 펼침면 래스터** + 72dpi jpg 썸네일 + 뷰어 |

> **위 6축만 포토북 고유다.** 에셋 라이브러리·객체 선택/이동/리사이즈·레이어/z-order·그룹·복사/삭제·정렬·삭제경고·모바일 터치 등 **그 외 모든 편집 UX 는 상품 비종속 플랫폼 공유 계층**([[fabric-editor]]/[[editor-object-editing]] 소유)이며 포토북에서 재정의·중복 구현하지 않는다. 이 공유 컨트롤들은 **`TemplateSetType` 으로 게이팅되지 않는다**(코드 확인: 객체 컨트롤 레이어 전체에서 `TemplateSetType` 참조 0건). 공유 계층 개선이 필요하면 **전 상품(BOOK/LEAFLET/카드) 회귀를 전제로** 별도 진행한다. 단 **per-set `enabledMenus` 도구 화이트리스트(`TemplateSet` 인스턴스 단위, 타입 아님)와 `editMode`·env 게이팅은 그대로 유지된다** — "공유=타입 비종속"일 뿐 "모든 도구를 항상 노출"이 아니다. 이하 §편집기 컨트롤 표의 공유 항목은 모두 이 원칙을 따른다.

## ⚠️ 함정: "신규로 보이지만 이미 존재한다" (적대검증으로 적발)

신규 구현에 착수하기 전, **반드시 기존 자산을 file:line 으로 확인**하라. 아래는 "당연히 신규일 것"이라 오판하기 쉬우나 **이미 production-grade 로 존재**하는 것들이다(과대 산정/중복 구현 방지):

- **`TemplateSet.editorMode` 컬럼은 실재한다** — `template-set.entity.ts:83-84`(`editor_mode` varchar, default 'single'). "컬럼 부재" 라는 직관은 **틀렸다**. PHOTOBOOK 은 `editorMode='book'` 지정만 하면 됨. **마이그레이션 불필요**(`type` 컬럼도 `varchar(20)` 라 enum 문자열 추가만으로 동작 — `template-set.entity.ts:42-47`).
- **페이지 DnD 커버 잠금은 이미 구현** — `BookNavigation.tsx:363` `draggable={dragEnabled && !m.isCover}`. 신규 아님. **펼침면 페어 무결성**만 진짜 신규.
- **싸바리는 MVP 우회로가 존재** — `coverEditable=false` + `coverPreviewImage`(`template-set.entity.ts:121-129`)로 양장 표지를 미리보기+별도 PDF 인쇄로 출고 가능. **정밀 geometry(`caseBind`) 없이도 MVP 출고**. 전면 신규 서브시스템으로 과대산정 금지.
- **최소페이지 가드 인프라 존재** — `BINDING_CONSTRAINTS` minPages/maxPages/pageMultiple 경고(`index.ts:1048-1109`) 재사용.
- **사진틀·마스킹·그룹·레이어 로직 존재** — `FrameInteractionPlugin.ts`·`ObjectPlugin`·`GroupPlugin.ts`·`CopyPlugin.ts`. 단 **소유 주체를 구분**하라: 사진틀·마스킹은 포토북 고유 동작 보강(블록 B), **그룹·레이어·z-order·삭제는 공유 계층**이라 포토북에서 보강 시 **전 상품 회귀** — 반드시 공유 PR 로 분리(블록 A).

> 원칙: **신규 작성 전 grep + file:line 확인**. 설계서 §2 매핑표(S=6 재사용·M=4·L=3)와 §2 "🔧 적대검증 정정 사항" 표가 근거.

## 진짜 신규 5영역 (여기에 노력 집중)

1. **싸바리 정밀 geometry**(조건부 L, O-1) — MVP 는 우회. 정밀=`SpreadSpec.caseBind`(boardThickness/turnIn/wrap) 추가.
2. **펼침면 내지 2-up**(L, O-2) — 좌면+거터+우면 모델. 좌표=중앙원점@150dpi 규약 유지([[reference_coordinate_convention]]).
3. **사진 자동배치 엔진**(L, O-5) — EXIF 정렬 + aspect-ratio 매칭, 결과=**편집가능 시드**(immutable 아님).
4. **페이지 가격연동**(M) — `pricing` JSON 메타 + 실시간 pageCount emit(계산 주체=파트너 장바구니).
5. **페이지별 래스터/뷰어**(L, O-4) — 300dpi 펼침면 PNG + 72dpi jpg 루프 + 플립북 뷰어.

## 편집기 컨트롤 — 공유 계층(위임) vs 포토북 고유(보강)

> ⚠️ 아래 두 블록을 혼동하지 마라. **블록 A 는 플랫폼 공유 계층**이라 포토북에서 신규/중복 구현 금지이며, 여기서 "보강"하면 **BOOK/LEAFLET/카드 전 상품에 동일 적용 + 전 상품 회귀**가 따른다. **블록 B 만 포토북 스킬이 소유**한다. 판별 규칙: **"진짜 신규 5영역"에 없으면 공유 계층 작업**이다.

### 블록 A — 플랫폼 공유 계층 (포토북에서 신규/중복 구현 금지)

| 컨트롤 | 공유 소유 위치 | 필요한 "보강"(=공유 컴포넌트 개선, 전 상품 적용) |
|---|---|---|
| 레이어 패널 | `SidePanel.tsx`(목록·lock·visible·rename) | drag-handle DnD 배선(`SidePanel.tsx:279-281` onDragStart 부재) + 툴바 z-order 4버튼 → BOOK/LEAFLET 동시 혜택 |
| z-order 로직 | `ObjectPlugin.up/upTop/down/downTop`(`:121/154/186/219`, 로직 完) | UI 호출처만 배선(현재 호출 0건). **포토북 고유 추가 없음** |
| 그룹/다중선택/정렬 | `GroupPlugin.ts`·ActiveSelection·`CopyPlugin.ts`·`AlignPlugin` | 없음(그대로 재사용) |
| 삭제 + 삭제경고 | `ObjectPlugin.del`(`:272`, 즉시 실행·경고 없음) | 삭제 전 확인 모달. ⚠️ **모달은 editor 앱(`ControlBar`/단축키 핸들러)에만** 두고 `ObjectPlugin.del` 자체는 불변(canvas-core 변경 시 ShareSnap/100p/MD2Books 외부 임베더 회귀) |
| 잠금/권한 | `applyObjectPermissions`(default-permissive, PERM-1) | per-template default 파라미터(O-8)는 **공유 권한 시스템 설정값**으로(포토북 전용 잠금 로직 금지) |
| 페이지 DnD(커버 잠금) | `BookNavigation.tsx:363` `draggable={dragEnabled && !m.isCover}` | 없음(기존). 펼침면 페어 무결성만 블록 B |
| 모바일 터치 | `ControlsPlugin` + `useIsCoarsePointer` 훅(공유) | 없음. 포토북 펼침면이라고 터치 코드 분기 금지. 터치 타깃 ≥44px·핀치줌은 공유 규약 |

> ⚠️ 블록 A 고정 규칙: 위 "보강"은 공유 컴포넌트 개선이라 전 상품 적용된다. **포토북 PR 로 다루지 말고 공유 계층 PR 로 분리**하고 **전 상품 회귀**(BOOK/LEAFLET 편집 라운드트립)를 함께 검증하라. 구현 가드 3건: ⓡ삭제경고는 editor 앱에만(del 불변) · ⓡ레이어 목록 인덱스↔z-index 변환을 단일 진실원으로 · ⓡz-order 버튼 노출도 기존 `enabledMenus`/`editMode` 게이팅 존중.

### 블록 B — 포토북 고유 (포토북 스킬 소유)

| 컨트롤 | 코어(공유 플러그인) | 포토북 고유 보강 |
|---|---|---|
| 사진틀 | `FrameInteractionPlugin.ts`·`useImageStore.ts`(makeFrameInteractive)·inverted clipPath·PNG 평탄화(`f77cc10`) — **코어는 공유** | 드롭 스왑·빈틀삭제 API·fill/fit 토글·smart-crop 앵커·**빈틀 무경고 삭제 분기** |
| 사진 in 프레임 | clipPath 마스킹·ShareSnap 핀치줌(D2 `cd8bff6`) — **코어는 공유** | 더블클릭 내부 줌/팬·회전 |
| 페이지 DnD(펼침면 페어) | `BookNavigation.tsx:286/363`·`computeInnerReorder:409` — **코어는 공유** | **펼침면 페어 단위 무결성**만 신규(커버 잠금은 기존 `:363`) |
| 자동편집 | `useExternalPhotosStore.ts`(입력)↔배치API(출력) | autofill 엔진(§자동편집): 정렬→aspect매칭→슬롯채움, 편집가능 시드 |

> 그리드/콜라주는 포토북 고유(autofill 직결)이나, **일반 객체 정렬/분배는 공유 `AlignPlugin`** 이므로 그리드 스냅과 별개로 공유 정렬 컴포넌트를 재사용한다.

## 편집영역/안전선 (스펙 핵심)

- **3겹 가이드**: bleed(빨강)/trim(검정)/safety(점선), **화면에만** 표시. 베이스=`WorkspacePlugin` cutBorder/safeBorder + `SystemObjectType:'safeBorder'`.
- **표지 per-region 편집경계**(정밀화): 앞커버/책등(제목)/뒷커버를 **개별 region** 으로 나눠 각 region 편집경계를 admin 이 지정 → 편집은 region 내부로 **클램프**. 베이스=`SpreadLayoutEngine` `REGION_ORDER` + region 별 `editBounds` 메타 신규.
- **침범 처리**: 디폴트=경고 표시 + 침범 유효 유지(비차단). **침범불가 세팅 시**=안전선 밖 편집화면에서 가림(clip) + **결과 파일에서 그 지점 기준 바깥 크롭**.

## 데이터모델 변경 (요약 — 상세는 설계서 §3)

- `TemplateSetType.PHOTOBOOK='photobook'` 추가(types + 엔티티 enum). **마이그레이션 불필요**(varchar).
- `SpreadSpec` optional 확장: `caseBind?`(싸바리)·`bleed?`(비대칭)·`gutterMm?`. 기존 BOOK 비파괴. `SpreadConfig.version` 1→2 + `SPINE_FORMULA_VERSION` bump.
- `TemplateSet.pricing?`(JSON 컬럼 1개, additive nullable=비파괴): includedPages/minPages/pageStep/perPageUnit.
- 펼침면 내지: `spreadPair:{left,right}` 메타. `conversionMode` 의 optional-JSON 패턴 차용.

## 저장/렌더 — 출력 계약 정합 (놓치기 쉬움)

- spread 책은 서버가 **`outputMode='separate'` 강제 → cover.pdf + content.pdf 2파일**(`docs/PLATFORM_INTEGRATION_GUIDE.md:477`). 포토북 펼침면 출력도 이 계약과 정합해야 함 — 파노라마 좌우분할/거터 침범 결과가 content.pdf 페이지 경계와 맞는지 검증.
- 300dpi 펼침면 래스터: 유일 선례=`packages/indesign-import/src/raster/rasterize.mjs:116`(sharp dpi 300). 벡터 PDF 는 텍스트 품질 위해 유지하고, **RIP 가 래스터를 요구할 때만**(O-4) worker 합성 경로로.
- 썸네일: 페이지별 72dpi jpg 루프는 `ScreenshotPlugin.generateThumbnail`(`:106`) 재사용. **뷰어 썸네일 = 파트너 emit 썸네일 = 동일 산출물**(중복 렌더 금지).

## 자동편집 EXIF — 순서 제약 (버그 유발 지점)

sharp `.rotate()`(EXIF orientation 보정)는 **메타데이터를 strip 할 수 있다**. 따라서 파이프 순서를 지켜라:

```
원본 수신 → exifr 파싱(DateTimeOriginal/GPS/orientation 저장) → sharp.rotate() → 저장
```

`.rotate()` 이후에 EXIF 를 읽으면 촬영일시/GPS 가 사라져 날짜순/장소별 정렬이 깨진다.

**현 구조에선 이 제약이 자동 충족된다** (2026-07-06 실측 정정 — 이전 "exifr 미도입" 표기는 stale):
- `storage.service.ts` 의 `.rotate()` 는 `generateThumbnail` 내부에서 **썸네일 사본**에만 적용되고 원본 파일은 불변 → 원본 URL 의 EXIF 보존.
- EXIF 파서 `exifr`(^7.1.3)는 **도입 완료** — `apps/editor/src/utils/photoAutofill.ts` 의 `parsePhotoExif`/`enrichPhotosWithExif`(dynamic import, 번들 분리). 외부주입은 원본 URL 페치로, '내 업로드'는 업로드 시점 **원본 File** 파싱으로 어느 쪽도 rotate 경로를 타지 않는다.
- 자동배치 엔진/UI 도 구현 완료: 정렬 모델 `photoAutofill.ts`(a0d5f0a) + 배치 엔진 `photoPlacement.ts` + `AppImage.tsx` '사진 자동편집'(68cfc7b). 입력은 외부주입 ∪ '내 업로드'(`useImageStore.uploadedPhotoMeta`, Track 2 2026-07-06) — 노출 조건은 **'빈 frame 존재' 런타임 판정**(TemplateSetType 게이팅 금지).

정렬 폴백 체인: DateTaken → DateAdded → FileName.
⚠️ **혼합 입력 시 `uploadedAt`(DateAdded) 시맨틱 차이**: 외부주입 `ExternalPhoto.uploadedAt` = 호스트 서비스 업로드 시각, '내 업로드' `uploadedPhotoMeta.uploadedAt` = `file.lastModified`(기기 파일 수정시각). 기준 시계가 다르므로 혼합 정렬 시 인지할 것(takenAt 이 있으면 우선돼 대부분 무영향 — `photoPlacement.ts` `UploadedPhotoMeta` 주석 참조). '내 업로드' 메타의 url 은 **storage 업로드 결과 URL**이어야 한다(objectURL 은 세션 휘발 — 저장/재편집 기준 붕괴).

## 구현 단계 (Phase) — 설계서 §11-2

- **Phase 0**: 발주 스펙 14항목 원문 재대조(설계서 §2 — 2026-06-23 대조 완료, 정합 확인됨).
- **Phase 1-공유 (공유 계층 트랙 — 전 상품 적용·회귀검증 포함, 포토북 릴리스와 독립 머지):** 툴바 z-order 4버튼(`ObjectPlugin` 로직 재사용) / 객체 삭제경고 모달(`ControlBar`+단축키 경로, del 불변) / 레이어 패널 DnD 배선(`SidePanel.tsx`). **DoD: BOOK/LEAFLET/카드 편집 라운드트립 회귀 통과 + 기존 셋 도구 노출 정책 불변.**
- **Phase 1-포토북 (포토북 config 트랙, 공유와 병렬 가능=타입 직교):** PHOTOBOOK enum + 폼 분기(varchar=마이그레이션 불필요) / 페이지별 72dpi jpg 썸네일(기존 png 루프에 **포맷 파라미터 추가**=비파괴) / 사진틀 드롭스왑+빈틀삭제(빈틀 무경고=고유) / 싸바리 MVP(`coverEditable=false`).
- **Phase 2 (M)**: EXIF(exifr)+업로드 순서 정리 / pricing emit / 3겹 가이드+저해상도 경고+per-region 편집경계 / 펼침면 페어 무결성.
- **Phase 3 (L, 오너 게이트 후)**: 자동배치 엔진(O-5) / 펼침면 2-up 내지(O-2) / 플립북 뷰어+(필요시)300dpi 래스터(O-4) / 싸바리 정밀 geometry(O-1).

## 오너 결정 게이트 (착수 전 확인)

설계서 §11-1 의 O-1~O-10. 특히 **L 서브시스템(자동배치·펼침면내지·래스터/뷰어·싸바리정밀)은 O-1/O-2/O-4/O-5 결정 통과 후** 착수. 가격 계산 주체(O-3)·저해상도 임계(O-9)도 선결.

## 변경 시 검증

- 타입/엔티티 변경: `pnpm --filter @storige/types build` **선행** 후 api/editor 빌드.
- 편집기 변경: [[fabric-editor]] 스킬의 "변경 시 반드시 실행하는 검증" 따름(canvas-core 테스트 + editor 빌드 + 저장/복원 라운드트립).
- 출력 변경: spread=separate 계약(`PLATFORM_INTEGRATION_GUIDE.md:477`) 회귀 없는지 골든 검증.
- 마이그레이션이 필요한 변경(`pricing` 컬럼 등)은 [[feedback_schema_change_deploy]](마이그레이션 직접실행 후 API 재배포 순서) 준수.

## 관련 스킬

- [[fabric-editor]] — 캔버스/플러그인/좌표/저장 파이프라인 (포토북 편집기 코어)
- [[editor-object-editing]] — 객체 추가/선택/편집·모바일 크래시·백업복원
- [[platform-integration]] — 임베드·shop-session·compose-mixed·웹훅·파트너 미리보기
- [[card-imposition]] — 양면 조판(낱장 카드/명함, 포토북과 별개)
