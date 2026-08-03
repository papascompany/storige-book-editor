# 트랙 C 구현 설계서 — 표지 spread 방향 파생 자동화 + A-3 잔여 2건

> 작성: 2026-07-23 · 상태: **설계(코드 무변경)** · 대상 레포: `/Users/yohan/Developer/Bookmoa Storige editor/storige` (master)
> 정본 노트: `.cursor/plans/TRACK_C_cover_orientation_derive_2026-07-14.md` §3 (spread 기하 파서 → 면 단위 변환 → derive includeCover 확장 → admin UX → 검증)
> 대체 대상: 2026-07-14 B 임시조치(전체비율 근사 주입, templateId `19741bdb`) — spine 1.2mm에서만 우연히 통한 근사를 면 단위 정식 변환으로 교체

---

## 0. 범위·비범위·전제

**범위**
- (트랙 C 본체) `type='spread'` 표지 템플릿의 세로↔가로 파생 자동화: 순수 변환 유틸 + `derive-orientation` `includeCover` 옵션 확장 + admin confirm 모달 확장
- (A-3 잔여 2건) ① 무선제본 spine<3mm 책등 텍스트 경고 토스트 ② 책등 세이프존 inset 가이드

**비범위 (v1 제외)**
- `spine`/`wing`/`cover`/`endpaper` 별도 type 템플릿의 이월(현행 표지는 spread 1장으로 표현 — 별도 type은 계속 skip)
- `conversionMode='flat-spread'` 자동 변환(전폭 PNG 1장 — 면 분할 불가), `'flat-spine'`(§7 오너 결정)
- 객체의 물리 90° 회전(angle+90) 방식 — 내지 파생 승인 정책(위치만 재배치, 크기·각도·스타일 보존)을 면 단위로 준용
- 라이브러리 카테고리 조인(TemplateSetLibraryCategory) 미복사 — 기존 백로그 그대로(이 트랙 무접촉)

**기하 정본 제약(불변식)**
- 총치수·출력치수 산식은 `@storige/types`의 `computeSpreadDimensions` / `computeSpreadOutputDimensions` / `normalizeSpreadSpec` / `roundMm01`만 사용. **인라인 복제 금지.**
- 영역 경계는 신규 types 헬퍼 1개로 단일화하고, `SpreadLayoutEngine.computeLayout`과의 **parity spec**으로 드리프트를 봉쇄(§1-1). mm↔px는 단위 환산(`(mm/25.4)×dpi`)이며 기하 산식이 아님.

---

## 1. ① 면 단위 변환 알고리즘 (핵심)

### 1-1. 신규 기하 헬퍼 — `@storige/types`

`packages/types/src/index.ts` (Spread 공용 계산 함수 섹션, `computeSpreadOutputDimensions` 뒤)에 추가:

```ts
export interface SpreadRegionRangeMm {
  position: SpreadRegionPosition;   // 'back-wing'|'back-cover'|'spine'|'front-cover'|'front-wing'
  x0Mm: number;                     // 콘텐츠(trim) 좌상단 원점 기준 좌측 경계
  x1Mm: number;
  widthMm: number;
}

/** 좌→우 REGION_ORDER 고정, widthMm<=0 영역은 제외(SpreadLayoutEngine.computeLayout §L91 시맨틱 동일). 총폭은 computeSpreadDimensions 위임. */
export function computeSpreadRegionRangesMm(spec: SpreadSpec): SpreadRegionRangeMm[]
```

- 내부 구현: 영역 폭 = spec 필드 직접 참조(`wingEnabled?wingWidthMm:0`, `coverWidthMm`, `spineWidthMm`) + 누적 합. 총폭 검산은 `computeSpreadDimensions(spec).totalWidthMm`와 `roundMm01` 대조(assert).
- **parity spec** (`packages/canvas-core/src/spread/SpreadLayoutEngine.spec.ts` 또는 신규): `computeLayout(spec).regions`(px→mm 역산) vs `computeSpreadRegionRangesMm(spec)` 전 필드 일치 — 표본: wing on/off × spine {0.1, 1.2, 7.5, 30}mm × 세로/가로 판형. `SpreadLayoutEngine`은 **무변경**(리팩터 churn 회피, parity spec이 단일 시맨틱 보증).

### 1-2. 신규 순수 유틸 — `apps/api/src/templates/spread-orientation-derive.util.ts`

`orientation-derive.util.ts`와 동일한 원칙(NestJS/TypeORM/fabric 의존 0, JSON 딥클론, 입력 불변)의 순수 함수:

```ts
export interface SpreadOrientationDeriveResult {
  canvasData: CanvasData;           // 변환본
  spec: SpreadSpec;                 // 파생 spec (normalizeSpreadSpec 통과)
  spreadConfig: SpreadConfig;       // version=SPREAD_CONFIG_VERSION, spec/regions/totals 재계산, conversionMode·regionScope 보존
  widthMm: number;                  // = computeSpreadDimensions(spec').totalWidthMm
  heightMm: number;
  reviewNotes: string[];            // 사람 검수 필요 항목(전폭 자유객체·absolutePositioned clipPath 등)
}

export function transformSpreadCanvasDataOrientation(
  canvasData: CanvasData,
  spreadConfig: SpreadConfig,       // 원본 (spec 필수)
): SpreadOrientationDeriveResult
```

#### (0) 사전 게이트 — 변환 불가 시 throw 아닌 **skip 사유** 반환 대상(§2 서비스에서 수집)

| 조건 | 사유 코드 | 처리 |
|---|---|---|
| `spreadConfig?.spec` 없음 | `SPREAD_SPEC_MISSING` | skip |
| `regionScope === 'inner'` (포토북 내지 2-up) | `SPREAD_INNER_SCOPE` | skip (판형 스왑 시맨틱 상이) |
| `conversionMode === 'flat-spread'` | `FLAT_SPREAD_UNSUPPORTED` | skip (전폭 PNG, 면 분할 불가) |
| `conversionMode === 'flat-spine'` | `FLAT_SPINE_UNSUPPORTED` | v1 skip (§7-2 오너 결정) |

즉 v1 자동 변환 대상 = `regionScope` cover(또는 미존재) ∧ `conversionMode` 'full'(또는 미존재).

#### (1) 파생 spec — 필드별 유도 규칙 (면 단위 W↔H 스왑)

```ts
const spec2 = normalizeSpreadSpec({
  ...spec,
  coverWidthMm:  spec.coverHeightMm,   // ★ 면 단위 스왑 — 판형에서 재계산 금지
  coverHeightMm: spec.coverWidthMm,
});
```

| 필드 | 규칙 | 근거 |
|---|---|---|
| `coverWidthMm` / `coverHeightMm` | **상호 스왑** | 실측 확정: 세로 429.2×301(spine 1.2) → coverW=214, coverH=301 / 가로 603.2×214 → coverW'=301=coverH, coverH'=214=coverW. coverW=214는 판형 210이 아님(+4mm 제작 정본, 판형 비종속) — **반드시 원본 spec 필드 스왑**으로만 유도 |
| `spineWidthMm` | 불변 이월(초기값) | 페이지수·용지 종속 동적값. `validateSpreadAgainstAuthority`도 비교 제외. 편집기 로드 후 `debouncedRecalcSpine`→`resizeSpine`이 SSOT로 재계산(§1-7) |
| `wingEnabled` | 불변 | — |
| `wingWidthMm` | **불변(권장)** — §7-1 오너 결정 | 날개 접힘폭은 물성(용지·제본), 방향 비종속이 자연스러움. 날개 높이는 `coverHeightMm'` 추종으로 자동 |
| `cutSizeMm` / `safeSizeMm` / `dpi` | 불변 | 방향 무관 |
| `caseBind` | 불변 | board×2(폭)·(turnIn+wrap)×2(사방) 스칼라 가산 — 방향 무관. 이월하면 `computeSpreadOutputDimensions(spec')`로 출력 사이즈 정합 자동 |

총치수는 산식 위임: `computeSpreadDimensions(spec2)` (검산: A4하드커버 → 2×301+1.2 = 603.2 × 214 = 실측 일치).

#### (2) 좌표계·경계 준비

- 신·구 영역 경계: `computeSpreadRegionRangesMm(spec)` / `(spec2)` → px 환산(`(mm/25.4)×spec.dpi`, dpi=150 동일).
- 저장 객체 좌표 = **중앙원점 px@150dpi** → 콘텐츠(trim) 좌표: `contentX = sceneX + oldTotalWpx/2`, `contentY = sceneY + oldTotalHpx/2` (`SpreadPlugin.getContentOrigin` 시맨틱, 서버는 스칼라 계산만).
- 서버에는 fabric이 없으므로 bbox는 수학적 산출: `getObjectContentBBox(obj)` 도우미 — `originX/originY`('left'/'top' 기본, 'center' 처리) + `width×scaleX`/`height×scaleY` + `angle≠0`이면 중심 회전 AABB 공식. **중심점(center)** 이 분류·앵커의 기준(엔진 anchor 규약과 동일).

#### (3) 객체 → 면 분류 (정적 1회 분류기)

우선순위 순:

1. `id === 'workspace'` → 특수 처리(§1-5).
2. **canvas_data top-level `clipPath`** → workspace와 동기 재계산(§1-5). 
3. `REGENERATED_GUIDE_IDS`(cut-border/safe-zone-border/crop-marks/center-guideline-h·v) 또는 `meta.system ∈ {'spreadGuide','dimensionLabel'}` → **drop** (로드 시 WorkspacePlugin/SpreadPlugin이 재생성. 정상 저장물엔 미직렬화 — 레거시/IDML 잔재 방어. B 조치에서 수동 이월했던 가이드 2·라벨 3은 정식 경로에선 재생성에 위임).
4. 일반 객체 → 면 분류:
   - **1차 bbox 면적비**: 콘텐츠 bbox vs 각 old 영역 교차면적비 ≥ **0.9** → 해당 면 소속 (resolveRegionRef PROMOTE 시맨틱 준용 — 단, 파생은 정적 1회 변환이므로 히스테리시스(0.7 유지) 불필요·미적용을 명시. canvas-core 로직 복제가 아니라 의도적으로 단순화한 별개 분류기).
   - **2차 중심점 x-range**: 1차 미달 시 중심 x가 속한 영역(`resolveRegionAtX` 시맨틱) → 소속.
   - **3차 자유객체**: 영역 밖(이론상 없음) → 전체 기준 처리(§1-4-c).
   - `meta.regionRef`는 **힌트로만**: 실측 분류와 일치하면 그대로, 불일치하면 실측 우선(SpreadPlugin 자가치유 L602-625 전례 — meta 오염 방어).

#### (4) 면 로컬 좌표 변환 — "세로↔가로 회전 규칙"

정책: **내지 파생과 동일한 "위치만 재배치"를 면 단위로 적용.** 크기(width/height/scaleX/Y)·회전(angle)·styles·잠금류·requiredEdit·id·z순서(배열 순서) 전부 보존. 면 자체가 W↔H 스왑되므로 객체는 면-로컬 정규화 좌표를 보존한 채 평행이동한다.

**(a) cover·wing 소속 객체** (position 동일 면으로 사상: back-cover→back-cover …):

```
xNorm = clamp((centerX_content − oldFace.x0px) / oldFace.widthPx, −1.0, 2.0)   // ANCHOR_NORM 준용
yNorm = clamp(centerY_content / oldTotalHpx, −1.0, 2.0)
newCenterX_content = newFace.x0px + xNorm × newFace.widthPx
newCenterY_content = yNorm × newTotalHpx
Δ = (newCenter_scene − oldCenter_scene)   →   left += Δx, top += Δy   // 크기 불변 → origin 오프셋·angle 보존
```

**(b) spine 소속 객체**: spine 폭 불변이므로 x는 새 spine 면 내 동일 xNorm(경계 x0만 이동: wing+214 → wing+301), y는 (a)와 동일한 yNorm 재배치(301→214). 텍스트 크기 무변경 — 세로쓰기 제목이 새 높이를 넘치면 편집기 `checkSpineOverflow`가 경고(자동 축소 없음, 초안 검수에서 사람이 조정. §7-5).

**(c) 자유객체(전폭 배경 등)**: 전체 축별 비율 중심 재배치(내지 정책 동일: `center × newTotal/oldTotal`), 크기 보존. 전폭 요소는 가로 총폭(429.2→603.2)을 크기 보존으로는 못 덮음 → `reviewNotes`에 `FULL_WIDTH_OBJECT_REVIEW` 수집(스트레치 자동화 금지 — 이미지 왜곡).

**(d) meta 갱신**: 변환 후 `meta.regionRef` = 분류 결과, `anchor` = 새 면 기준 region norm(자유객체는 canvas 절대좌표) **명시 갱신**. 로드 직후 `resizeSpine`(spine 재계산)에서 즉시 정확한 재배치가 되도록. (편집기 자가치유가 있어 미갱신도 동작은 하나, stale meta를 남기지 않는다.)

#### (5) workspace rect · clipPath — 클립 정책

- `id='workspace'` rect: **drop 금지**(실객체 — 파란 배경 = workspace fill, B 교훈 그대로). 내지 util의 "정확 스왑 시 유효치수 교환"은 표지엔 **적용 불가**(전체가 W↔H 스왑이 아님) → **spec 기반 결정론 재계산**: `newEffW/H = mmToPx(newTotalMm + 2×cutSizeMm)`, `left/top = −newEff/2`(중앙원점 대칭), `scaleX/Y=1` 정규화, fill 등 스타일 보존. (WorkspacePlugin.afterLoad가 로드된 workspace를 그대로 canvas.clipPath로 사용 — 재생성 안 함.)
- top-level `clipPath`(ServicePlugin `extendFabricOption` 직렬화): 존재 시 workspace와 **동일 기하로 동기 재계산**(B 교훈: "배경+clipPath 한 세트"). 
- 객체별 `clipPath`: 객체 상대 좌표이므로 평행이동(Δ)에 그대로 유효 — **무변경 보존**. 단 `absolutePositioned: true` clipPath 감지 시 좌표 불변으로는 어긋남 → 변환하지 않고 `reviewNotes`에 `ABSOLUTE_CLIPPATH_REVIEW` 수집(현행 표지 데이터에 사례 없음, 방어).
- top-level `width/height`: `computeSpreadDimensions(spec2)` totals(mm) 기록 — 판형 메타로만 취급(loadJSON은 ServicePlugin이 delete, `reference_loadjson_dimension_trap` 방어 기존재).

#### (6) spreadConfig 파생

```
spreadConfig' = {
  version: SPREAD_CONFIG_VERSION,           // 2
  spec: spec2,
  regions: <spec2 기준 재계산>,              // computeSpreadRegionRangesMm + px 환산 + label 고정 매핑(뒤날개/뒤표지/책등/앞표지/앞날개)
  totalWidthMm/totalHeightMm: computeSpreadDimensions(spec2),
  conversionMode: 보존, regionScope: 보존,
}
```
현행 derive의 `spreadConfig: tpl.spreadConfig` 원본 무변환 복사(service L786)는 **spread 브랜치에서 이 파생본으로 대체**(page 경로에는 spreadConfig가 null이라 기존 라인 무해·무변경). regions label 문자열은 parity spec(§5-2)으로 `getRegionLabel`과 드리프트 방어.

#### (7) 책등 폭 재계산 반영 — 이 유틸의 책임 경계

파생 산출물의 `spineWidthMm`는 **초기값일 뿐**이다. 실주문 SSOT는 편집 세션의 `debouncedRecalcSpine → spineCalculator → SpreadPlugin.resizeSpine → updateSpreadSpineWidth` 흐름이며, 파생 템플릿을 로드한 세션에서도 동일하게 자동 재계산된다. 워커 검증은 `validateSpreadAgainstAuthority`가 coverW/H·wing만 비교(spine·총폭 의도적 제외)하므로 파생 초기값과 실주문 spine이 달라도 정합 문제 없음. **유틸은 spine 재계산을 시도하지 않는다**(spine-calc 호출은 세션 컨텍스트(페이지수·용지)가 필요 — 템플릿 파생 시점엔 미존재).

### 1-3. B 임시조치 대비 — 무엇이 정확해지는가

| 항목 | B(전체비율 rW=1.4054, rH=0.7110) | 면 단위 정식 |
|---|---|---|
| 면 경계 | spine 1.2mm라 오차가 작아 우연히 통과. spine 30mm면 앞/뒤표지 객체가 경계에서 수 mm~cm 이탈 | 면별 xNorm 보존 — spine 폭과 무관하게 경계 정확 |
| spine 객체 | 전체비율로 x 스케일 → spine 상대 위치 붕괴 가능 | spine 내 xNorm 보존 + 폭 불변 |
| 치수라벨/가이드 | 수동 이월 + 라벨 텍스트 수동 보정(214→301) | drop → SpreadPlugin 재생성(항상 정확) |
| 크기 | (B도 위치만이었나 무관하게) 근사 | 크기·각도·styles 전부 보존, 위치만 |

---

## 2. ② derive-orientation `includeCover` 확장 — 기본 off, page 경로 무접촉

### 2-1. API 계약

- **DTO 신규**: `apps/api/src/templates/dto/derive-orientation.dto.ts` — `class DeriveOrientationDto { @IsOptional() @IsBoolean() includeCover?: boolean }`. 바디 없는 기존 호출(admin 구버전·spec)과 호환: `@Body() dto?: DeriveOrientationDto` — 빈 바디 허용(`forbidNonWhitelisted`는 알 수 없는 키만 거부하므로 무바디 OK).
- **컨트롤러** (`template-sets.controller.ts:186`): `deriveOrientation(@Param('id') id, @Body() dto)` → `service.deriveOrientation(id, { includeCover: dto?.includeCover === true })`. ApiOperation summary에 includeCover 문구 추가. 응답 코드 불변(201/400/404/409).
- **응답 additive 확장**: `{ success, data: TemplateSet, meta?: { coverDerived: number, coverSkipped: Array<{ templateId, reason }> , coverReviewNotes: string[] } }` — `includeCover` 미지정/false면 meta 자체 생략(byte-호환).

### 2-2. 서비스 분기 — page 블록 byte-무변경

`template-sets.service.ts:753~` 트랜잭션 루프의 유일 분기(L758)를 다음 구조로. **기존 page 블록 코드는 1자도 건드리지 않는다**:

```ts
for (const ref of refs) {
  const tpl = byId.get(ref.templateId);
  if (!tpl) continue;

  // [신규] 표지 spread — includeCover 명시 시에만 (기본 off = 현행과 동일 거동)
  if (tpl.type === 'spread' && includeCover) {
    const gate = evaluateSpreadDeriveGate(tpl);          // §1-2 (0) 게이트
    if (!gate.ok) { coverSkipped.push({ templateId: tpl.id, reason: gate.reason }); continue; }
    const r = transformSpreadCanvasDataOrientation(tpl.canvasData, tpl.spreadConfig);
    const newTemplate = this.templateRepository.create({
      id: uuidv4(),
      name: withOrientationSuffix(tpl.name, suffix),
      thumbnailUrl: null,                                 // 방향 오도 방지 (page와 동일)
      type: 'spread',
      width: r.widthMm, height: r.heightMm,               // spread 총치수(mm)
      canvasData: r.canvasData,
      spreadConfig: r.spreadConfig,                       // ★ 원본 복사 아님 — 파생본
      editCode: null, templateCode: null,                 // unique 복제 금지 (page와 동일)
      isActive: true, editable/deleteable/categoryId/createdBy/siteId: 이월,
      isDeleted: false,
    });
    await manager.save(Template, newTemplate);
    newRefs.push({ templateId: newTemplate.id, required: ref.required });
    coverReviewNotes.push(...r.reviewNotes.map(n => `${tpl.id}: ${n}`));
    continue;
  }

  if (tpl.type !== 'page') continue;   // 기존 라인 — spine/wing/cover/endpaper 계속 skip
  /* ...기존 page 블록 그대로... */
}
```

- 게이트 skip은 **404 중단이 아님**(참조 무결성 검사와 다름) — 표지만 빠진 초안 생성 + meta로 안내. 이유: 표지 변환 불가(flat-spread 등)가 내지 파생 전체를 막을 이유가 없고, 현행(표지 항상 미이월)보다 항상 같거나 나음.
- 주석 갱신: L714-716 "spread류는 이월하지 않음" → "includeCover 시 spread(full)만 면 단위 변환 이월, flat-*/inner/spec 없음은 skip" 로 정정.
- `validateBookModeTemplates`는 DTO 경로 전용이라 기존과 동일하게 미적용 — includeCover=true면 오히려 SPREAD 포함 초안으로 시작(더 완전).
- 마이그레이션 **없음**(JSON 컬럼·기존 스키마 그대로) → 배포는 API 재배포만.

---

## 3. ③ admin confirm 모달 확장

`apps/admin/src/pages/TemplateSets/OrientationPairSection.tsx`:

1. **`handleDeriveClick`(L141-167)**: `Modal.confirm` content는 1회 정적 렌더이므로 **클로저 변수 + uncontrolled Checkbox** 최소 diff:
   ```tsx
   let includeCover = false;
   Modal.confirm({ ..., content: (
     <ul>…기존 4개 li…</ul>
     + <Checkbox onChange={(e) => { includeCover = e.target.checked; }}>
         표지(스프레드)도 면 단위 자동 변환으로 이월 (실험적)
       </Checkbox>
   ), onOk: () => deriveMutation.mutateAsync({ includeCover }) });
   ```
2. **문구**: 기존 li "표지류(스프레드·책등·날개·면지)는 이월되지 않습니다" 유지하되 "(아래 체크 시 스프레드는 자동 변환 이월)"로 보강 + 초안 경고 강화 li 1개: "표지 자동 변환본은 **반드시 검수** 필요 — 책등 세로 텍스트 넘침, 전폭 배경, flat 변환 템플릿(자동 제외됨)을 확인하세요."
3. **mutation** (L118-139): `mutationFn: (opts: { includeCover: boolean }) => templateSetsApi.deriveOrientation(templateSetId, opts)`. `onSuccess(created)`에서 응답 `meta.coverSkipped`/`coverReviewNotes`가 있으면 `message.warning`으로 사유 병기(예: "표지 1건은 flat-spread라 이월되지 않았습니다").
4. **api client** (`apps/admin/src/api/template-sets.ts:163-167`): `deriveOrientation(id, opts?: { includeCover?: boolean })` — POST 바디 `{ includeCover: !!opts?.includeCover }`. 응답 타입에 optional `meta` 추가.
5. 데이터 소스·invalidate 정책(`['template-sets']` 단일화, 부모 폼 쿼리 미무효화) 무변경.

---

## 4. ④ A-3 잔여 2건 — 최소 diff (정찰 ⑥ 제안 채택·확정)

### 4-1. 기능 ① — 무선제본 spine<3mm 책등 텍스트 경고 (canvas-core 무변경, editor 전용)

- **상수**: `SPINE_TEXT_MIN_WIDTH_MM = 3` — `apps/editor/src/hooks/useCoverRegion.ts` 상단(신규, 기존 상수 없음 grep 확인됨). 근거값 3mm는 §7-6 오너/제작 확인 대상(기본 3으로 착수).
- **신규 훅** `useSpineNarrowTextWarningToast(editor, ready)` — `useCoverRegion.ts` L215 이후, 기존 3훅 패턴(showToast + 2000ms 쿨다운) 준용:
  - 트리거 (a): `editor.on('spineWidthChange', payload)` — **현재 미소비 이벤트**(SpreadPlugin.ts:529, 구독자 0건) 활용. `payload.newSpineWidth < 3` && 게이트 통과 && spine에 텍스트 객체 존재(`canvas.getObjects()` 중 `meta?.regionRef==='spine'` && type∈{'text','i-text','textbox'}) 시 발화.
  - 트리거 (b): `canvas.on('object:added' | 'object:modified')` — target이 텍스트 계열 && `meta?.regionRef==='spine'`(useSpreadAutoAnchor가 add 직후 보장) && 현재 spineWidthMm < 3.
  - 게이트: `useSettingsStore.getState().spineConfig.bindingType === 'perfect'`(무선 — bindingType은 editor에만 존재, canvas-core 무지) && spineWidthMm 소스 = `spreadConfig.spec.spineWidthMm`(updateSpreadSpineWidth가 갱신) 또는 payload.
  - 문구(기존 spreadSpineOverflow "책등 폭(Xmm)이 좁아 …침범"과 구분 — dup 가드는 동일 문구만 방어): `"무선제본 책등 폭이 X.Xmm로 3mm 미만입니다 — 책등 글자는 접힘·재단 편차로 표지면에 걸릴 수 있어 권장하지 않습니다."` `showToast(msg, 'warning', 5000)`.
- **마운트**: `apps/editor/src/views/EditorView.tsx:551` 인근 1줄(기존 4훅 나열부).

### 4-2. 기능 ② — 책등 세이프존 inset 가이드 (SpreadPlugin 메서드 1 + 호출 2줄)

- **신규 메서드** `renderSpineSafeInset(layout)` — `packages/canvas-core/src/plugins/SpreadPlugin.ts` renderBleedBorder(L923) 뒤, 동 패턴 준용:
  - `spine = layout.regions.find(r => r.position === 'spine')`; `insetPx = (currentSpec.safeSizeMm / 25.4) * currentSpec.dpi`(resizeSpine이 WorkspacePlugin에 넘기는 동일 값).
  - `fabric.Line` 세로선 2개: `x = origin.x + spine.x + insetPx` / `origin.x + spine.x + spine.width − insetPx`, y = `origin.y` ~ `origin.y + totalHeightPx`(중앙원점 규약 — getContentOrigin).
  - 스타일: WorkspacePlugin safe-zone-border 계열(점선·safe 색) 준용, `excludeFromExport: true`, `selectable/evented: false`, `meta.system = 'spreadGuide'`.
  - 가드: `safeSizeMm <= 0 ‖ dpi <= 0 ‖ !spine ‖ spine.width <= 2 × insetPx` → 미표시(bleed 전례 L885-893).
  - 생성물을 `this.guideLines`에 push(initInner 거터 전례 L305) → `clearGuides`/`destroyed`/`afterLoad→init()` 정리·복구가 기존 인프라로 자동 커버, 신규 clear 메서드 불필요.
- **호출 2줄**: `init()` L254(renderBleedBorder 다음) + `resizeSpine` L504.
- 함정 확인(정찰 ⑥ 그대로): inner 모드는 init()이 initInner로 조기 return이라 무접촉 / flat-spread는 init()을 타므로 고정 책등 기준 정상 표시 / SafeZoneWarningPlugin 판정은 meta.system 체크(L127)로 자동 제외.
- 플래그: 기존 가이드류와 동일하게 무플래그(화면 전용·저장/PDF 원천 제외 — excludeFromExport).

---

## 5. ⑤ 검증 게이트

| # | 게이트 | 내용 · 통과 기준 |
|---|---|---|
| G-1 | **순수 util 왕복 spec** (`apps/api/src/templates/spread-orientation-derive.spec.ts`) | 픽스처 2종: (a) 세로 A4하드커버 표지 실덤프 `__fixtures__/canvasdata_cover_d765713a.json`(prod 덤프 스크럽 — MA-348 전례), (b) 합성 픽스처 spine 30mm + wing 활성(=B 근사가 실패하는 형상). 세로→가로→세로 왕복 후: 전 객체 중심 오차 <0.01px · 크기/각도/styles/z순서/requiredEdit 불변 · **소속 면 보존**(변환 후 재분류 = 원 분류) · workspace/clipPath 유효치수 결정론 일치 · 입력 불변 · flat-spread/inner/spec없음 skip 사유 케이스 |
| G-2 | **기하 parity spec** | `computeSpreadRegionRangesMm` vs `SpreadLayoutEngine.computeLayout` regions(px→mm) 전 표본 오차 0 + regions label 문자열 일치 — types↔canvas-core 드리프트 봉쇄 |
| G-3 | **기존 경로 무회귀** | `template-sets.pairing.spec.ts` 기존 케이스(파생 5 포함) **무변경 통과** + 신규: includeCover 미지정 = spread 미이월(현행 동일) / includeCover=true = spread 이월+spreadConfig 파생본 검증 / skip 시 meta.coverSkipped |
| G-4 | **골든 PDF 파리티** (`scripts/pdf-golden` 하네스) | 왕복 항등 게이트: 세로 원본 PDF vs (세로→가로→세로 왕복 파생본) PDF **픽셀 diff 0**. + 가로 파생본 단독: MediaBox = `computeSpreadOutputDimensions(spec')` 기대치(caseBind 세션) / `computeSpreadDimensions` 폴백 일치 |
| G-5 | **에디터 로드 스모크** | 가로 파생본을 /template·/embed에서 로드 — loadJSON 치수오염·skipOffscreen 소실 없음(트랩 2종 재발 확인), spine 재계산(resizeSpine) 후 면 경계 유지, 파란 배경(workspace fill)+clipPath 정상 |
| G-6 | **B 임시조치 데이터 대조** | `19741bdb`(B 주입 가로본) vs d765713a에서의 정식 파생본: 제목/저자명 i-text 2객체 최종 scene 좌표 비교. 기대 오차 상한을 산식으로 문서화(전체비율 근사와 면단위의 차이는 spine·면경계 항 — spine 1.2mm 형상에서 ≲1mm 수준이어야 정상). 대조표 산출 + 오너 육안 확인 후 교체 여부 결정(§7-4) |
| G-7 | 빌드·정적 게이트 | `pnpm --filter @storige/types build` 선행 → api/editor/admin/canvas-core 빌드·lint 0 err · 기존 spec 전량 green |

---

## 6. ⑥ 커밋 단위 실행 순서

파생 트랙(C-c1~4)과 A-3(C-c5~6)은 **독립 — 개별 롤백 가능**. 순서는 의존성 순.

| 커밋 | 내용 | 게이트 |
|---|---|---|
| C-c1 | types: `computeSpreadRegionRangesMm` + 단위 spec + canvas-core parity spec (G-2) | types 선빌드 후 전 패키지 빌드 |
| C-c2 | api: `spread-orientation-derive.util.ts` + 픽스처 + G-1 spec (서비스 미접속 — 순수 함수만) | G-1 |
| C-c3 | api: `deriveOrientation` includeCover 분기 + DTO + 컨트롤러 + G-3 spec 확장 | G-3 (기존 케이스 무변경 통과가 머지 조건) |
| C-c4 | admin: 모달 Checkbox + mutation/클라이언트 + meta 안내 | admin 빌드 + 수동 확인(체크 off 기본) |
| C-c5 | canvas-core: `renderSpineSafeInset` + 호출 2줄 (A-3 ②) | 에디터 수동 확인(표지/포토북내지/flat-spread 3형상) |
| C-c6 | editor: `useSpineNarrowTextWarningToast` + 상수 + 마운트 (A-3 ①) | spine 2mm 형상에서 토스트 발화·쿨다운 확인 |
| C-c7 | 검증 라운드: G-4/G-5/G-6 실행 + 결과 기록, RESUME_PROMPT 갱신 | 전 게이트 green |

**배포 순서·함정**: ① API = VPS 수동(`docker compose up -d --build api`, 마이그레이션 없음 — 502 함정 비해당이나 nginx 재시작 관례 준수) ② admin = master push Vercel 자동(ignoreCommand 견고화 확인) ③ **editor/canvas-core = Vercel CLI 수동 배포**(git 웹훅 미발화 기존 함정 — A-3 포함 커밋 push 후 반드시 CLI 배포) ④ types 변경이 섞이므로 로컬·CI 모두 `pnpm --filter @storige/types build` 선행.

**19741bdb 교체(운영)**: includeCover derive는 "새 세트 생성" 경로라 기존 가로 세트에는 못 쓴다(409 + 세트 신설 시맨틱). 교체는 **별도 1회 백필 스크립트**(d765713a에 util 직접 적용 → 19741bdb template row의 canvasData/spreadConfig/width/height UPDATE, 실행 전 현행본 백업·롤백 JSON 기록) — G-6 대조·오너 승인 후 실행(§7-4).

---

## 7. ⑦ 리스크·오너 결정 필요 항목

| # | 항목 | 권장안 | 성격 |
|---|---|---|---|
| 7-1 | **wingWidthMm 파생 규칙** — 불변 vs coverW 비례 | **불변**(날개 접힘폭은 물성·방향 비종속). 현 A4하드커버 세트는 wing 미사용이라 v1 블로킹 아님 | 오너 결정(비블로킹) |
| 7-2 | **flat-spine 자동 변환 지원** — spine PNG는 canvas anchor(scene x=0)·3배폭 크롭이라 특수취급 필요 | v1 **skip**(사유 회신) — 수요 발생 시 후속 | 오너 결정(비블로킹) |
| 7-3 | **d765713a IDML 잔재 5객체**(일반객체로 유입된 책등 가이드 2·치수라벨 3) — 파생 시 일반 객체로 이월되며 라벨 텍스트가 스테일해짐(meta.system 없어 drop 규칙 미적용) | 파생 전 원본에서 잔재 정리(권장) 또는 id/텍스트 패턴 보조 감지 규칙 추가(위험 — 오탐). **원본 정리 권장** | 오너 결정 |
| 7-4 | **19741bdb B 주입본 교체** 시점·방법(§6 백필 스크립트) — 현재 오너 육안 검증 통과 상태라 교체는 개선이지 긴급 아님 | G-6 대조 결과 확인 후 교체. 교체 전 롤백 JSON(`{"version":"5.3.0","objects":[],...}` 아닌 **현행 B본 전체**) 보관 | 오너 승인 게이트 |
| 7-5 | **책등 세로 텍스트 넘침**(coverH 301→214 축소) — 자동 축소 없음(정책 일관: 크기 보존) | 초안 검수 + 편집기 checkSpineOverflow 경고 의존. admin 모달 경고 문구에 명시(§3-2) | 정책 확인 |
| 7-6 | **SPINE_TEXT_MIN_WIDTH_MM=3 근거** — 제작(bookmoa) 정본 미확인. R-44 spine 트랙 휴면 항목(미회신 caliper)과 연동 확인 | 기본 3mm 착수, bookmoa 회신 시 상수 1곳 수정 | 제작 확인(비블로킹) |
| 7-7 | 전폭 배경/자유객체 — 스트레치 자동화 금지, reviewNotes 경고만 | 검수 항목 문서화(admin meta 안내 §2-1) | 리스크 수용 |
| 7-8 | 파생 초안의 라이브러리 카테고리 조인 미복사 — 기존 백로그와 동일(표지 이월돼도 에셋 패널 카테고리는 수동) | 범위 외 유지, 백로그 항목에 표지 케이스 병기 | 백로그 |
| 7-9 | admin Modal.confirm 클로저-변수 Checkbox — 리렌더 없는 정적 content 전제(antd confirm 특성). controlled Modal 전환은 diff 증가 | 클로저 방식 채택 + 주석으로 전제 명시 | 구현 노트 |

---

## 부록 A. 변경 파일 목록(예정)

| 파일 | 변경 |
|---|---|
| `packages/types/src/index.ts` | `computeSpreadRegionRangesMm` + 타입 (additive) |
| `packages/canvas-core/src/spread/SpreadLayoutEngine.spec.ts`(신규 또는 기존) | G-2 parity spec |
| `apps/api/src/templates/spread-orientation-derive.util.ts` (신규) | 면 단위 변환 순수 유틸 |
| `apps/api/src/templates/spread-orientation-derive.spec.ts` + `__fixtures__/canvasdata_cover_d765713a.json` (신규) | G-1 |
| `apps/api/src/templates/dto/derive-orientation.dto.ts` (신규) | includeCover DTO |
| `apps/api/src/templates/template-sets.controller.ts` | derive 라우트 @Body 추가 (L186) |
| `apps/api/src/templates/template-sets.service.ts` | 트랜잭션 루프 spread 브랜치 (L753-758 구간, page 블록 무접촉) |
| `apps/api/src/templates/template-sets.pairing.spec.ts` | G-3 케이스 추가 |
| `apps/admin/src/pages/TemplateSets/OrientationPairSection.tsx` | 모달 Checkbox·문구·mutation (L118-167) |
| `apps/admin/src/api/template-sets.ts` | deriveOrientation 바디·meta 타입 (L163-167) |
| `packages/canvas-core/src/plugins/SpreadPlugin.ts` | `renderSpineSafeInset` + 호출 2줄 (L254·L504·L923 뒤) |
| `apps/editor/src/hooks/useCoverRegion.ts` | `useSpineNarrowTextWarningToast` + 상수 (L215 이후) |
| `apps/editor/src/views/EditorView.tsx` | 훅 마운트 1줄 (L551 인근) |

마이그레이션: **없음**. 신규 ENV/플래그: **없음**(includeCover는 요청 파라미터가 킬스위치, admin 기본 unchecked).