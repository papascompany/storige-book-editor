# 캘린더 스킨셋(디자인 일괄변경) 설계 — C10 (2026-10-24)

> **상태: 설계 계약 — 오너 승인 전, 코드 변경 없음.** 계획 [`CALENDAR_EDITOR_FEATURE_PLAN_2026-10-21.md`](./CALENDAR_EDITOR_FEATURE_PLAN_2026-10-21.md) §2 B6 · §3 T6 · 오너 결정 D5(2026-10-24: **관리자가 정의한 스킨 N종 중 고객이 선택**, 고객 자유 일괄변경 아님). 승인 시 W3 T7a(canvas-core·계약)·T7b(editor·admin)로 구현한다.
> 상위 설계: [`PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md`](./PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md) §1 원칙 1~4(데이터 속성 트리거·`EditorMode` 제3값 금지·FROZEN enum 불변·ADDITIVE 한 커밋), [`CALENDAR_EDIT_MODE_DESIGN_2026-10-16.md`](./CALENDAR_EDIT_MODE_DESIGN_2026-10-16.md) §1.2 C10·§3.
> 근거 기준: 코드 `p1-calendar` `b2497a0b`(T3a 연달력 계약 v1.26 포함). 코드가 문서보다 권위다. 참조 편집기는 기능 수준으로만 참고한다(코드·DOM·CSS 미사용).

---

## 0. 결론

1. **스킨 = 기준 세트와 구조가 같은 별도 캘린더 템플릿셋.** 기준 세트의 프로파일 `calendar.skins?: CalendarSkin[]` 이 스킨 세트를 `templateSetId` 로 가리킨다. 스킨 세트에서 쓰는 것은 **캔버스별 템플릿 디자인(canvasData)뿐**이다. 프로파일·판형·도련·출력 설정은 모두 기준 세트 값을 쓴다. 템플릿 조회는 기존 공개 라우트 `GET /template-sets/:id/with-templates` 를 그대로 쓴다(라우트·인증·응답 키 무변경).
2. **세션에는 `metadata.calendar.skinKey?: string` 하나만 추가한다(additive).** 키가 없으면 기본(기준 세트) 디자인이다. 세션의 `templateSetId`, 서버 소유 `metadata.productProfile`, `editor.complete` 봉투, deliverables, 워커 잡은 바꾸지 않는다.
3. **적용 경로는 `TemplatePlugin.replaceTemplate` 이 아니라 "세션 재오픈과 같은 경로"다.** 순서는 다음과 같다.
   - 현재 캔버스 JSON, 직전 디자인 템플릿, 새 스킨 템플릿을 **순수 함수로 병합**한다(canvas-core 신규).
   - 결과를 `ServicePlugin.loadJSON` 으로 다시 싣는다.
   - 재오픈과 같은 후처리(사진틀 재바인딩 → 그리드 재합성 → 권한 적용 → 필수 편집 추적)를 실행한다.
   - 이유: 현 `replaceTemplate` 은 fabric `clone()` 을 속성 목록 없이 호출한다. 그래서 `extensionType`·`extension`·`lockInfo`·`frameRef` 같은 커스텀 속성이 빠진다(§9 R1).
4. **보존 대상**
   - 세션 메타: 시작연월·표기 옵션·기념일·연달력 연도 선택(`yearDeltas`)·날짜 데이터 버전. 세션 메타에 있어 그대로 유지된다.
   - 캔버스: 사진틀에 채운 사진, 고객이 고친 템플릿 문구, 고객이 직접 추가한 요소는 병합 규칙(§3)으로 옮긴다.
   - 불변: 캔버스 수·페이지 라벨·삭제 금지 캔버스는 바꾸지 않는다(캔버스를 추가·삭제하지 않음).
5. **실패하면 26캔버스 전부를 적용 직전 스냅샷으로 되돌린다.** 적용 중에는 자동저장을 보류하고, `skinKey` 는 전부 성공한 뒤에만 기록한다.
6. 노출은 데이터와 플래그로 정한다. 프로파일 `kind='calendar'` 이고 `calendar.skins` 가 1개 이상일 때만 보이며, 킬스위치는 `VITE_ENABLE_CALENDAR_SKINS`(정확히 `'false'` 면 끔)다. `TemplateSetType` 분기는 없다.

---

## 1. 범위 · 비범위

### 1.1 범위(v1)

| 항목 | 내용 |
|---|---|
| 스킨이 바꾸는 것 | 캔버스마다 **템플릿이 배치한 요소 전부**: 배경, 장식·일러스트, 사진틀 배치·모양, 템플릿 문구의 위치·글꼴·색, 날짜 그리드(`calendar-grid`)의 위치·크기·`extension.style`·variant(month/mini/year)·`monthDelta`, 링/재단 오버레이 같은 화면 전용 가이드 |
| 스킨이 보존하는 것(세션 메타) | `metadata.calendar` 의 `startYear/startMonth`·`show`(공휴일·음력·절기·임시공휴일·`yearTitle`)·`anniversaries`(문구·스타일)·`dataVersion`·`yearDeltas` — 메타를 건드리지 않고 그리드만 다시 그린다 |
| 스킨이 보존하는 것(캔버스) | ① 사진틀 채움 사진 ② 고객이 수정한 템플릿 문구(문자열) ③ 고객이 직접 추가한 요소(텍스트·이미지·도형·스티커) — 규칙은 §3 |
| 불변 | 캔버스 수(`pages.count`), 페이지 라벨(`labelRule 'month'`), `protectedIndices`, 프로파일 전체(기준 세트 값), 판형·도련·재단선 설정, 완료 PDF 쪽수·검증 규칙 |
| 고객 UI | 달력 패널의 「디자인」 절: 스킨 카드 선택 → 확인 대화상자(보존·이동·제외 개수) → 적용 → 「적용 취소」 |
| 관리자 UI | 템플릿셋 폼 「상품 프로파일」 패널의 「캘린더 스킨」 절: 스킨 세트 선택·호환 검사·썸네일 미리보기 → 프로파일 JSON `calendar.skins` 갱신 |

### 1.2 비범위(v1)

- 고객이 요소를 자유롭게 일괄 변경하는 기능(그리드 스타일·폰트·색 고객 편집 — D1 결정으로 고객 UI 없음 유지).
- 페이지마다 다른 스킨을 섞는 것(스킨은 세션 전체에 하나).
- 런처·호스트가 처음 열 스킨을 지정하는 것(`launch` 의 `calendar.skinKey`) — 필요해지면 additive 로 추가한다.
- 스킨별 가격·상품 코드 차등, deliverables·`editor.complete` 에 `skinKey` 싣기 — 오너 질문 Q4.
- 사진인화(`kind='photo-print'`)·낱장 세트의 스킨 — `calendar` 블록에만 정의한다.
- 기존 `AppTemplateSwap`(페이지별 템플릿 교체)의 속성 손실 수정 — 후속 항목(§9 R1).
- 가변 달 수(C9, B8 보류).

---

## 2. 데이터 스키마

### 2.1 저장 위치 비교 — 채택: 안 B

| 안 | 내용 | 판정 |
|---|---|---|
| A. 프로파일에 템플릿 id 슬롯 | `calendar.skins[].slots {cover[], monthFaces[], epilogue[]}`(admin `CalendarTemplateSlots` 와 같은 모양) | 기각. 편집기는 비로그인 상태에서 템플릿을 받아야 하는데 `GET /templates/:id` 는 공개 라우트가 아니다. 그러려면 동결 라우트 with-templates 응답에 키를 더하거나 새 라우트가 필요하다. 진입할 때마다 스킨 템플릿까지 받으면 부트스트랩 응답도 커진다 |
| **B. 별도 캘린더 템플릿셋 참조** | `calendar.skins[] {key, label, templateSetId, thumbnailUrl?}`. 스킨 세트는 일반 캘린더 세트로 만들고, 편집기는 고객이 고를 때만 with-templates 로 받는다 | **채택.** API·라우트 코드 변경 없음(types+DTO 만). 관리자는 기존 세트·템플릿 편집 흐름과 템플릿 복제(`templates.service.ts` `copy` — canvasData 를 그대로 복사해 객체 id 유지)를 그대로 쓴다. 구조 정합은 편집기 런타임 검사 + 관리자 저장 전 검사로 막는다 |
| C. 같은 세트 `templates` refs 에 스킨 행 추가 | refs 의미(캔버스 순서 = 시드)를 바꾼다 | 기각 — 고정 캔버스 수 검사(`useEditorContents.ts` fixed 분기)와 충돌 |
| D. 새 테이블 | 마이그레이션·API·권한 신설 | 기각 — 범위 과다 |

`AppTemplateSwap.tsx:109-113` 에서 다시 쓰는 것은 **"템플릿 교체 직후 그리드 재합성"이라는 원칙(`rehydrateCalendarGrids`)**뿐이다. 교체 자체(`TemplatePlugin.replaceTemplate`)는 쓰지 않는다(§9 R1).

### 2.2 타입(`packages/types/src/product-profile.ts`, additive)

```ts
/** 스킨 정의(관리자). 스킨 세트에서는 캔버스별 템플릿 canvasData 만 소비한다. */
export interface CalendarSkin {
  /** 세션 기록 키. /^[a-z0-9][a-z0-9_-]{0,31}$/, 프로파일 안에서 유일, 'default' 금지(기본 디자인 = 키 없음) */
  key: string;
  /** 고객 카드 이름 1~40자(trim 후 비어 있지 않음) */
  label: string;
  /** 스킨 템플릿셋 id(비어 있지 않은 문자열 ≤64, 프로파일 안에서 유일) */
  templateSetId: string;
  /** 카드 썸네일(선택). 관리자 UI 가 스킨 세트 썸네일로 자동 채움 */
  thumbnailUrl?: string;
}

export const CALENDAR_SKIN_MAX = 10;

export interface CalendarProfile {
  // … 기존 키 불변 …
  /** v1.(N) additive. 생략·빈 배열 = 스킨 기능 없음(현행 동작) */
  skins?: CalendarSkin[];
}

export interface CalendarSessionMeta {
  // … 기존 키 불변 …
  /** v1.(N) additive. 고객이 적용한 스킨 key. 생략 = 기준 세트 디자인 */
  skinKey?: string;
}
```

`validateProductProfile` 규칙(API DTO·admin·편집기 공용):
- `skins` 가 있으면 배열이고 길이는 1~`CALENDAR_SKIN_MAX` 다.
- 각 원소는 객체이며 허용 키는 위 4개뿐이다.
- `key` 는 형식에 맞고 유일하며 `'default'` 가 아니어야 한다.
- `label` 은 1~40자다.
- `templateSetId` 는 유일하다.
- `thumbnailUrl` 은 생략하거나 1~2048자 문자열이다.
- 키를 생략하면 오류는 0건이다. 기존 프로파일 검증 결과는 그대로 유지된다.

구조 호환 판정 `checkCalendarSkinCompatibility(base, skin): string[]` 은 같은 파일의 순수 함수로 둔다. admin 과 편집기가 함께 쓰며, 오류가 1건이라도 있으면 그 스킨은 쓸 수 없다.

| 검사 | 기준 |
|---|---|
| 스킨 세트 프로파일 | `kind='calendar'` |
| 레이아웃·캔버스 구성 | `calendar.layout`·`coverCanvases`·`canvasesPerMonth`·`epilogueCanvases`·`pages.count` 가 기준과 같음 |
| 판형 | 세트 `width/height` 가 기준과 같음(mm) |
| 템플릿 수 | with-templates 의 `templateDetails.length === pages.count`(누락 참조 없음) |
| 테넌트 | 스킨 세트 `siteId` 가 기준 세트와 같거나 `null`(공유) |
| 자기 참조 | `templateSetId ≠ 기준 세트 id` |
| 사진틀 수 | Q2 결정에 따름. 권고 (a)는 캔버스마다 `extensionType 'frame'` 수가 기준과 같아야 함 |

### 2.3 API DTO(`apps/api/src/templates/dto/product-profile.dto.ts`)

`CalendarProfileDto.skins?: CalendarSkinDto[]`(`@IsOptional @IsArray @ValidateNested @Type`) 와 `CalendarSkinDto` 4필드를 둔다. DTO 가 whitelist + forbidNonWhitelisted 이므로 types 만 바꾸면 admin 저장이 400 이 된다. 그래서 types·DTO(+spec)·CONTRACT 행을 **한 커밋**에 넣는다(T3a v1.26 선례). 서버는 스킨 세트가 실제로 있는지 조회하지 않는다. 편집기 런타임 검사와 관리자 저장 전 검사가 그 역할을 맡는다.

### 2.4 불변 확인

- **프로파일 NULL 세트**: 코드 경로가 `isCalendarProfile(profile)` 에서 바로 끝난다. payload 키 집합 불변(`calendarSessionMetadataFields` 는 `{}`).
- **기존 캘린더 세트**: `calendar.skins` 가 없으므로 UI 비노출, `metadata.calendar` 키 집합 불변, 프로파일 검증 결과 diff 0(프리셋 7종·샘플 스크립트 프로파일 픽스처로 고정).
- **`metadata.productProfile`**: 서버 소유다(서버가 템플릿셋 현재값으로 다시 기록). 스냅샷에 `skins` 가 따라 들어가는 것은 ADDITIVE 범위다.

---

## 3. 적용 알고리즘

### 3.1 용어

- `cur[i]`: 캔버스 i 의 현재 JSON(`toJSON(core.extendFabricOption)`).
- `from[i]`: 캔버스 i 가 지금 따르는 템플릿 canvasData. `skinKey` 가 없으면 기준 세트 `linkedPrintTemplates[i]`, 있으면 그 스킨 세트 `templateDetails[i]`. 해당 스킨이 삭제됐다면 "알 수 없음"이다.
- `to[i]`: 새로 고른 스킨 세트 `templateDetails[i]`. "기본 디자인"을 고르면 기준 세트 템플릿이다.

### 3.2 순서(편집기 `calendarSkinApply.ts`)

1. **사전 조건**
   - 프로파일이 캘린더이고 `skins` 에 해당 key 가 있으며 플래그가 켜져 있어야 한다.
   - 스킨 세트를 with-templates 로 받고(메모리 캐시) `checkCalendarSkinCompatibility` 를 통과해야 한다.
   - 하나라도 실패하면 적용하지 않고 이유를 표시한다.
2. **미리 계산**: 26캔버스 모두에 `mergeSkinCanvas(cur, from, to, { dryRun: true })` 를 실행해 보고 합계(보존·이동·재맞춤·제외 개수)를 구한다. 이 값을 확인 대화상자에 보여 준다.
3. **확인 뒤 실행** — 아래 전체를 `runWithAutosaveSuspended` 로 감싸고, 편집기 `longTask` 오버레이로 입력과 완료 버튼을 막는다.
   1. 적용 직전 기존 저장 경로로 1회 저장한다(실패하면 중단).
   2. 스냅샷 `before[i] = cur[i]` 를 26캔버스 모두 뜬다.
   3. 캔버스마다 순서대로:
      - `offHistory`.
      - `mergeSkinCanvas` 결과를 `ServicePlugin.loadJSON` 으로 싣는다(8초 가드 — 재오픈 경로와 같음).
      - 재오픈과 같은 후처리: `setCoords` → `rebindFrameInteractivity` → `rehydrateCalendarGrids(ed, cvs, i)` → `applyCustomerLocks` → `trackRequiredEdits`.
      - 재맞춤 큐의 사진을 기존 `fillImageIntoFrame` 으로 채운다.
      - `clearHistory()` → `onHistory`.
   4. **사후 검증**: `allCanvas.length`·`pages.length`·`pages[i].id`·라벨이 적용 전과 같은지 확인한다.
   5. 모두 통과하면 `useCalendarStore.setSkinKey(key | undefined)` → `markDirty()` 를 1회 실행한다.
4. **실패하면**(병합 예외·loadJSON 실패·가드 시간 초과·사후 검증 불일치)
   - 손댄 캔버스를 `before[i]` 로 같은 경로를 거쳐 되돌린다.
   - `skinKey` 와 dirty 는 바꾸지 않고 오류를 안내한다.
   - 롤백까지 실패하면 "새로고침 필요"를 안내하고 보류 상태에서 바로 새로고침한다. 서버본은 3-① 에서 저장한 적용 직전 상태다.
5. **「적용 취소」**: 적용 뒤 어떤 캔버스에서도 객체 추가·수정·삭제 이벤트가 없는 동안에만 보인다. `before[]` 를 같은 경로로 복원하고 `skinKey` 를 이전 값으로 돌린다. 그 이후에는 고객이 이전 스킨 카드를 다시 고르면 되고, 이때는 같은 병합 규칙으로 다시 적용된다(바이트 단위 원복은 아님).

### 3.3 병합 규칙(canvas-core 순수 함수 `mergeSkinCanvas`)

입력은 JSON 이고 fabric 에 의존하지 않으며 입력을 변경하지 않는다. 출력은 `{ json, refills[], report }` 다.

| 현재 객체 분류 | 판정 | 처리 |
|---|---|---|
| `workspace` | id | 현재 캔버스 것을 유지한다(도련 반영 크기 그대로, 리사이즈 불필요) |
| 템플릿 유래 요소 | top-level `id ∈ ids(from)` | 버리고 `to` 의 요소로 바꾼다. 아래 3개는 예외 |
| ㄴ 날짜 그리드 `calendar-grid` | 〃 | 버린다(`to` 의 그리드 사용, 내용은 세션 메타로 다시 그림) |
| ㄴ 템플릿 문구(text/i-text/textbox) | `text ≠ from` 의 같은 id `text` | **문자열만** `to` 의 같은 id 텍스트로 옮긴다(위치·글꼴은 스킨 것, Q3). `requiredEditTouched` 도 함께 옮긴다. 같은 id 가 없으면 "제외"로 보고한다. `from` 이 알 수 없음이면 옮기지 않고 보고한다 |
| ㄴ 사진틀 `extensionType 'frame'` | 〃 | 아래 "채움 사진" 규칙 |
| 채움 사진 | `frameRef` 또는 `parentLayerId` 가 템플릿 사진틀 id | 대상 틀: ① `to` 의 같은 id 틀, ② 없으면 읽는 순서(중심 top→left) k번째 틀끼리 짝지음. 대상 틀의 기하(left·top·width·height·scale·angle, 오차 0.5px)가 같으면 **사진 JSON 을 그대로 유지**(이동·확대·자르기 보존)하고 링크만 대상 id 로 고친다. 다르면 사진 JSON 을 빼고 `refills` 에 `{frameId, src, extension}` 을 넣는다(적용 후 `fillImageIntoFrame` 이 다시 맞추며 자르기는 초기화 — 보고에 표시). 대상 틀이 없으면 Q2 정책 |
| 고객 추가 요소 | 위 어디에도 속하지 않음 | 원래 순서대로 맨 위에 그대로 둔다. 같은 id 가 `to` 에 있으면 새 uuid 로 바꾸고 참조(`frameRef`/`parentLayerId`)도 고친다 |
| 날짜 그리드 extension | — | 템플릿 소유다(`monthOffset`·`monthDelta`·`yearDelta` 기본값·`style`·`variant` 모두 스킨 값). 고객 선택(시작연월·`yearDeltas`·표기)은 세션 메타라 그대로 적용된다 |

- 순서: `to` 의 객체 순서를 따른다. 그대로 유지한 채움 사진은 원래 대상 틀과의 앞뒤 관계를 따라 끼워 넣고, 고객 추가 요소는 맨 위에 둔다.
- 템플릿 유래 요소를 고객이 옮기거나 크기를 바꾼 것(잠금이 허용한 경우)은 보존하지 않는다. 확인 대화상자에 그렇게 안내한다.

### 3.4 성능·메모리

- 비교 실측(§8 계획 T1a·T1b): 세션 진입 4.0~6.1s(wall2·desk_large 등 cold 아님), 첫 진입 15.8s. JS heap 피크는 완료 PDF 생성 시 368~563MB. canvasData 는 0.84~1.96MB(사진 13장, storage URL).
- **목표**
  - 26캔버스 적용 시간 ≤ 10s(사진 없음) · ≤ 15s(사진 13장, 로컬 dev).
  - heap 피크 ≤ 완료 PDF 생성 피크.
  - 스냅샷 보유량 ≈ canvasData 1벌(「적용 취소」가 사라지거나 새 적용을 할 때 해제).
- 캔버스는 순서대로 적용한다. 측정값이 목표를 넘으면 동시 4개까지 허용한다(T7b 판단, 실측 첨부).
- 스킨 세트 조회는 기존 with-templates 그대로라 응답에 ref 개수만큼 canvasData 가 반복된다(기준 세트 진입과 같은 크기). 카드 목록은 프로파일 값만으로 그리고, 조회는 카드를 누를 때 1회만 한다.
- 위험: 캘린더 세트에서 사진틀 클릭 채움은 아직 base64 data URL 이다(계획 B11). 이 경우 canvasData 와 스냅샷이 커진다. B11(D11 승인)을 T7b e2e 보다 먼저 반영하는 것을 권고한다.

---

## 4. UI

### 4.1 고객 — 달력 패널 「디자인」 절

- **위치**: `CalendarPanel` 의 시작연월·표기 옵션 절 아래에 신규 `CalendarSkinSection` 을 둔다(달력 메뉴 = `CALENDAR`).
- **노출 조건**: 캘린더 프로파일 + `calendar.skins` 1개 이상 + `VITE_ENABLE_CALENDAR_SKINS !== 'false'`. editMode(관리자 템플릿 편집)에서는 숨긴다.
- **카드**: "기본 디자인"(기준 세트, 썸네일은 첫 연결 템플릿) + 스킨 N개(`label`·`thumbnailUrl`, 없으면 "미리보기 없음"). 현재 `skinKey` 카드를 강조한다. 삭제된 스킨 key 면 강조 없이 "현재: 목록에 없는 디자인"을 표시한다.
- **확인 대화상자**: "디자인을 「{label}」로 바꿉니다. 사진 N장·기념일 M건·직접 추가한 요소 K개는 유지됩니다. 수정한 문구 X건은 새 디자인 자리로 옮깁니다. 새 디자인에 자리가 없는 문구 Y건·사진 Z장은 빠집니다(사진은 '내 업로드'에 남음). 디자인 요소의 위치 변경은 새 디자인으로 바뀝니다." 0건인 항목은 생략한다.
- **진행·결과**: 기존 longTask 오버레이 → 완료 토스트 + 「적용 취소」 버튼(§3.2-5).
- **호환 실패 스킨**: 카드를 비활성으로 두고 툴팁에 사유를 보여 준다.
- **페이지별 템플릿 교체 메뉴**(Q5 권고 (a)): `calendar.skins` 가 있는 세트에서는 툴바 「템플릿」 메뉴를 숨긴다. 스킨이 없는 세트는 현행 그대로다.
- 컴포넌트는 편집기 기존 UI 컴포넌트(`@/components/ui/*`)로 만든다.

### 4.2 관리자 — 템플릿셋 폼 「상품 프로파일」 패널

- **위치**: `TemplateSetForm.tsx` 의 「상품 프로파일」 패널에서 `productProfileJson` 입력 아래에 신규 `CalendarSkinsSection` 1개를 마운트한다. 「기본 정보」 패널의 **규격 카드(`data-testid="spec-card"`) 블록과 다른 패널은 건드리지 않는다.**
- **노출 조건**: 입력 중인 프로파일 JSON 이 `kind='calendar'` 로 파싱될 때.
- **기능**
  - 스킨 목록(key·label·세트명·썸네일) 추가·수정·삭제·순서 변경 → 결과를 `productProfileJson` 의 `calendar.skins` 에 써 넣는다. 저장 필드는 프로파일 JSON 하나뿐이다(새 폼 필드·컬럼 없음).
  - 스킨 세트 선택: 기존 `templateSetsApi.getAll` 결과 중 `checkCalendarSkinCompatibility` 를 통과하는 세트만 고를 수 있다(불통과 세트는 사유를 표시).
  - 미리보기: 선택한 스킨 세트의 고유 템플릿 썸네일 줄(표지·월 면·에필로그)과 호환 검사 결과. `thumbnailUrl` 은 세트 썸네일로 자동 채운다.
- **제작 안내**(화면 문구): 기준 세트를 템플릿 복제로 만들고 디자인을 고친다. 복제는 객체 id 를 유지하므로 문구·사진틀이 같은 자리로 옮겨진다. 스킨 세트는 일반 캘린더 세트이므로 기존 편집 경로로 디자인하고 확인한다.

---

## 5. CONTRACT_FREEZE 영향(ADDITIVE, 번호 미정)

현재 등재는 v1.26이고 T4가 v1.27 예정이다. 이 개정 번호는 병합 순서대로 메인이 붙인다.

**행 초안 (개정 문단)**

> **v1.(N) 개정 (YYYY-MM-DD, 오너 결정 D5)**: §1-D **ADDITIVE** 2건 — 캘린더 스킨셋(설계 C10).
> ① 템플릿셋 응답 `templateSet.productProfile.calendar` 선택 키 `skins?: Array<{key, label, templateSetId, thumbnailUrl?}>`(1~10개, key `/^[a-z0-9][a-z0-9_-]{0,31}$/` 유일·`'default'` 금지, `templateSetId` 유일). 관리자가 정의한 디자인 묶음이며, 각 원소는 기준 세트와 구조(레이아웃·캔버스 구성·판형)가 같은 캘린더 템플릿셋을 가리킨다. 편집기는 그 세트의 캔버스별 템플릿 디자인만 쓴다. 생략 = 스킨 기능 없음(현행).
> ② 편집 세션 자유형 `metadata.calendar` 의 편집기 기록 키 `skinKey?: string`(고객이 적용한 스킨, 생략 = 기준 디자인).
> 두 표면 모두 미전송 = 현행 동작이다. 프로파일 NULL 세트·`skins` 없는 캘린더 세트의 응답·세션 metadata·검증 잡 옵션은 바이트 동일하다.
> 불변: 라우트·메서드·`@Public`, `GET /template-sets/:id/with-templates` 응답 최상위 키, `editor.complete`·레거시 `storige:completed` 봉투(`product` 키 내용 포함), deliverables(`calendar {startYm, dataVersion}`), 워커 잡 옵션, `metadata.productProfile` 서버 소유, `TemplateSetType`·`EditorMode`·`PdfOutputMode`·`OutputFile.type` 열거형.

**표 갱신**: 기존 행 "편집 세션 `metadata.productProfile`… `metadata.calendar`…"에 `skinKey?` (v1.(N)), 행 "`GET /template-sets/:id/with-templates`… 응답 `templateSet.productProfile`"에 `calendar.skins?` (v1.(N))를 덧붙인다. `contract-freeze.spec.ts` 의 라우트 행은 바꾸지 않는다(v1.26 선례). 파트너 통합 가이드 문구는 운영 반영 시점에 메인이 갱신한다(v1.26 선례 — worktree 단계 미갱신).

**금지 확인**
- `TemplateSetType` 으로 분기하지 않는다(판정 = `productProfile.kind==='calendar'` + `calendar.skins`).
- `EditorMode` 에 제3값을 넣지 않는다(single 경로 그대로).
- 세션 `templateSetId` 를 바꾸지 않는다(스킨 세트로 세션을 옮기지 않음).

---

## 6. 킬스위치 · 롤백

| 수단 | 효과 | 저장본 |
|---|---|---|
| `VITE_ENABLE_CALENDAR_SKINS='false'`(정확 일치, 빌드 시점 변수 — editor 재배포 필요, 기존 `VITE_ENABLE_CALENDAR` 와 같은 관례) | 「디자인」 절 숨김·적용 불가. 「템플릿」 메뉴 숨김 규칙(Q5)도 해제해 현행으로 돌아감 | 이미 적용된 디자인은 canvasData 에 남는다. `skinKey` 는 읽기·쓰기를 그대로 통과해 보존된다(`readCalendarSessionMeta`·`calendarSessionMetadataFields` 는 플래그와 무관) |
| `VITE_ENABLE_CALENDAR='false'` | 달력 메뉴 전체 숨김(T1a 리허설 동작) — 스킨 절도 함께 사라짐 | 위와 같음 |
| 데이터: 기준 세트 프로파일에서 `calendar.skins` 제거(admin) | 해당 세트에서 즉시 비노출(재배포 불필요) | 기존 세션 디자인 유지, `skinKey` 는 남아도 무해 |
| 코드 되돌리기 | T7b → T7a 역순 revert | 프로파일에 `skins` 가 있는 세트가 있으면 API 를 먼저 되돌리지 말 것: 구 DTO 는 그 세트 저장을 400 으로 거부한다(조회는 영향 없음). 순서: `skins` 제거 → API revert |

배포 순서: API(DTO) → admin/editor. 구 편집기 번들이 캐시에 남아 있으면 `skins` 를 무시하므로 UI 가 없다. 구 번들이 스킨 세션을 1회 저장하면 `skinKey` 가 빠질 수 있다(§9 R4).

---

## 7. 테스트 계획

기준선 대비 신규 실패 0(계획 §7 Node 버전 규칙: canvas-core 는 node@24, sqlite 스위트는 node@22).

### 7.1 T7a

| 파일 | it(요지) |
|---|---|
| `apps/api/src/templates/product-profile.spec.ts` | `skins` 생략 시 기존 결과 동일 · 유효 1·10개 통과 · 11개 거부 · key 형식·중복·`'default'` 거부 · label 빈 값·41자 거부 · `templateSetId` 빈 값·중복 거부 · 미지 하위 키 거부 · `thumbnailUrl` 형식 · `checkCalendarSkinCompatibility`(레이아웃·캔버스 구성·`pages.count`·판형·템플릿 수·siteId·자기 참조 각 1) |
| `apps/api/src/templates/dto/product-profile.dto.spec.ts` | `skins` 포함 프로파일이 whitelist 를 통과(400 아님) · `skins[]` 미지 키는 400 |
| `packages/canvas-core/src/calendar/skin.test.ts`(신규) | 템플릿만 있는 캔버스 → `to` + 현재 workspace · 같은 id·같은 기하 사진 유지(링크 그대로) · id 가 달라 순서로 짝지은 사진의 `frameRef`/`parentLayerId` 수정 · 기하가 다르면 `refills` 큐 · 대상 틀 없음 → Q2 정책·보고 · 고친 문구는 옮기고 안 고친 문구는 안 옮김 · `from` 알 수 없음이면 문구 안 옮김 · 고객 추가 요소 보존 + id 충돌 재발급 · 옛 그리드 제거·새 그리드만 · dryRun 보고 = 실제 보고 · 입력 불변(얕은·깊은 동결) |
| `packages/canvas-core/src/plugins/TemplatePlugin.test.ts` | (D3/T5 가 `cut-guide` 제거로 결정한 경우만) 템플릿 요소 id 목록 기대값 1건 |
| 회귀 | 캘린더 프리셋 7종·샘플 프로파일 픽스처 `validateProductProfile` diff 0 · sdk `types-parity` 통과 · canvas-core·api 전체 신규 실패 0 |

### 7.2 T7b

| 파일 | it(요지) |
|---|---|
| `apps/editor/src/utils/calendarSkinApply.test.ts`(신규) | 비캘린더·NULL 프로파일 no-op · 플래그 off no-op · 호환 실패 시 미적용 · 성공 시 `skinKey` 기록 + `markDirty` 1회 + 자동저장 보류 안에서 실행 · 캔버스마다 `rehydrateCalendarGrids` 와 `clearHistory` 호출 · k번째 loadJSON 실패 → 전 캔버스 스냅샷과 같음 + `skinKey` 불변 · 사후 검증(캔버스 수·라벨·`pages[i].id`) · 「적용 취소」 복원 · 편집 이벤트 뒤 취소 무효 · "기본 디자인" 선택 시 `skinKey` 제거 |
| `apps/editor/src/utils/calendarRehydrateAll.test.ts` | `readCalendarSessionMeta` 가 유효 `skinKey` 를 보존하고 무효 값(형식·길이)은 버림 · `calendarSessionMetadataFields` 는 키가 있을 때만 싣고 스킨 없는 세션은 키 집합 불변 |
| `apps/editor/src/stores/useCalendarStore.test.ts` | `setSkinKey` 설정·해제 · `restore` 왕복 |
| `apps/editor/src/components/calendar/CalendarSkinSection.test.tsx`(신규) | `skins` 없음·플래그 off·editMode 에서 숨김 · 카드 렌더·현재 강조·삭제된 key 표시 · 클릭 → 대화상자 개수 문구 · 취소 시 무동작 · 확인 시 적용 호출 · 호환 실패 카드 비활성 |
| `apps/editor/src/components/editor/ToolBar.calendarSkins.test.tsx`(신규, Q5 (a)일 때) | `skins` 있는 세트는 「템플릿」 숨김 · 없는 세트·NULL 세트는 현행 |
| `apps/admin/src/pages/TemplateSets/calendarSkins.test.ts`(신규) | JSON 읽기·쓰기 왕복(다른 키 보존) · 호환 필터 · 썸네일 자동 채움 |
| `apps/admin/src/pages/TemplateSets/CalendarSkinsSection.test.tsx`(신규) | 캘린더 JSON 에서만 노출 · 추가·삭제·순서 → JSON 반영 · 불통과 세트 선택 불가 · 기존 TemplateSetForm 테스트 회귀 0 |
| e2e(T1a 절차, 로컬) | ① desk_large 기준 + 스킨 1종(템플릿 복제로 제작). 런처 세션에서 사진 13장 자동편집, 시작 2027-03, 기념일 2건, 표지 문구 수정, 스티커 1개 → 스킨 적용 → 26캔버스·라벨·사진 13·기념일·문구·스티커 확인 → 저장·재오픈 동일 → 완료 PDF 26쪽·워커 `warnings []` ② 적용 시간·heap 피크 기록 ③ 「적용 취소」 ④ `VITE_ENABLE_CALENDAR_SKINS=false` 로 재오픈 시 디자인·`skinKey` 보존(자동저장 1회 뒤 서버 metadata 확인) ⑤ wall-2(상단/하단)에서 1회 반복 |

---

## 8. 소유권 분할 · 순서

| 트랙 | 배타 소유 파일 | 금지 | 의존 |
|---|---|---|---|
| **T7a canvas-core·계약** (`o5-implementer`) | `packages/types/src/product-profile.ts`(`CalendarSkin`·`skins?`·`skinKey?`·검증·`checkCalendarSkinCompatibility`), `apps/api/src/templates/dto/product-profile.dto.ts`(+`.dto.spec.ts`), `apps/api/src/templates/product-profile.spec.ts`, `docs/CONTRACT_FREEZE.md`(ADDITIVE 행) — **여기까지 한 커밋**; 이어서 `packages/canvas-core/src/calendar/skin.ts`(+`skin.test.ts`, 신규), `packages/canvas-core/src/index.ts`(export 줄), `packages/canvas-core/src/plugins/TemplatePlugin.ts`(+test — **D3/T5 결정 시 `cut-guide` 1줄 제거만**, 그 밖 무변경) | editor·admin 전부, `calendar/core.ts`·`calendar/types.ts`·`CalendarPlugin.ts`, `utils/canvas.ts` | T6 승인·D5·Q1~Q3 답, T4 종료(같은 types·DTO·CONTRACT·`index.ts` 를 W2 에서 소유) |
| **T7b editor+admin** (`o5-implementer`, T7a 와 다른 에이전트) | editor: `apps/editor/src/utils/calendarSkinApply.ts`(+test, 신규), `apps/editor/src/components/calendar/CalendarSkinSection.tsx`(+test, 신규), `apps/editor/src/components/calendar/CalendarPanel.tsx`(절 마운트 1곳), `apps/editor/src/stores/useCalendarStore.ts`(+test), `apps/editor/src/utils/calendarRehydrateAll.ts`(+test, `skinKey` 읽기·쓰기만), `apps/editor/src/hooks/useEditorContents.ts`(**`applyCustomerLocks` 에 `export` 추가만**), `apps/editor/src/components/editor/ToolBar.tsx`(+신규 test, Q5 (a)일 때 메뉴 게이트만), `apps/editor/.env.example`(1줄) · admin: `apps/admin/src/pages/TemplateSets/CalendarSkinsSection.tsx`(+test, 신규), `apps/admin/src/pages/TemplateSets/calendarSkins.ts`(+test, 신규), `apps/admin/src/pages/TemplateSets/TemplateSetForm.tsx`(**「상품 프로파일」 패널 안 import·마운트만**) | `TemplateSetForm.tsx` 「기본 정보」 패널의 규격 카드 블록(`data-testid="spec-card"`)·다른 패널, `calendarProfilePresets.ts`·`register-calendar-samples.mjs`(T5), `packages/*`, `apps/api/*`, `AppTemplateSwap.tsx`(**이 설계에서는 수정 안 함** — 계획의 잠정 소유 해제) | T7a 병합, T3b(`components/calendar/*`) · T4r(`CalendarPanel.tsx`) · T5 종료, (권고) B11 |

순서: W3 에서 T4r ∥ T5 ∥ T7a(계약 커밋 → 병합 함수) → T7b → R 통합 검토. 세션 metadata·계약 표면을 만지므로 테넌트 검사·입력 상한도 함께 검토한다.

---

## 9. 위험

| # | 위험 | 대응 |
|---|---|---|
| R1 | `TemplatePlugin.replaceTemplate`/`ungroupItems` 는 `obj.clone(cb)` 를 속성 목록 없이 호출한다(fabric 5.5.2 `clone` = `toObject(propertiesToInclude)`). 그래서 `extensionType`·`extension`·`lockInfo`·`frameRef` 가 빠지고, `isUserAdded` 는 직렬화 목록에 없어 재오픈 뒤 사진틀·템플릿 문구를 사용자 요소로 오인한다. 이 경로로 스킨을 적용하면 그리드 재합성 실패·사진틀 중복이 예상된다(정적 판독, 런타임 미검증) | 스킨은 이 경로를 쓰지 않는다(§3). T7a 첫 작업으로 이 손실을 재현하는 특성 테스트를 `skin.test.ts` 옆에 두고, 결과를 R 검토에 첨부한다. 기존 `AppTemplateSwap` 의 같은 위험은 후속 항목으로 보고만 한다 |
| R2 | 스킨 템플릿을 복제가 아닌 새 제작으로 만들면 id 가 달라 문구를 옮기지 못한다 | 사진틀은 순서로 짝짓는 폴백이 있다. 관리자 UI 에 제작 안내와 미리보기 개수(옮김·제외)를 표시한다 |
| R3 | 26캔버스 다시 싣기 시간·메모리 | §3.4 목표·실측 필수. 순서 적용, 스냅샷 1벌, B11 선행 권고 |
| R4 | 구 편집기 번들이 저장하면 `skinKey` 가 빠질 수 있다 → 다음 적용 때 `from` 을 기준 세트로 잘못 잡아 스킨 기본 문구를 "고객 수정"으로 옮길 수 있다 | 기간이 짧은 저위험 항목. 데이터 노출은 editor 반영 뒤에만 한다(스킨 세트 등록은 editor Vercel Ready 뒤) |
| R5 | 공개 with-templates 는 `isDeleted` 만 확인하므로, 관리자가 다른 사이트 세트를 참조할 수 있다 | 편집기·admin 호환 검사에 siteId 일치(또는 공유 null)를 넣는다. R 검토 항목 |
| R6 | 스킨 세트가 상품 목록·매핑에 일반 세트로 보인다 | 스킨 세트는 그 자체로 정상 캘린더 세트라 오매핑돼도 동작한다. 운영 관례(이름 접두·비활성 저장 가능 — with-templates 는 `isActive` 를 보지 않음)는 admin 안내 문구로만 둔다 |
| R7 | 적용 중 완료·이탈 | longTask 오버레이로 완료 버튼을 막는다. 이탈 경고는 B10(D9) 범위 |
| R8 | 기준 정보 불명(스킨 삭제·R4) | 문구는 옮기지 않고 대화상자에 표시한다. 사진·고객 요소 보존은 영향 없음 |

---

## 10. 오너 질문

| # | 질문 | 선택지 | 권고 |
|---|---|---|---|
| Q1 | 스킨에 들어가는 요소 | (a) 템플릿 전체(배경·장식·사진틀 배치·문구 스타일·그리드 위치·스타일) (b) 레이아웃은 고정, 배경·그리드 스타일·색만 | **(a)** — 기존 "캔버스별 템플릿" 단위와 일치하고 관리자 제작 흐름이 그대로다. (b)는 요소별 스타일 덮어쓰기 엔진이 별도로 필요하다 |
| Q2 | 스킨의 사진틀 수·배치가 기준과 다를 때 고객 사진 | (a) 면별 사진틀 수가 같은 스킨만 등록·사용 가능(사진 손실 없음) (b) 허용하되 자리 없는 사진은 캔버스에서 빠지고 '내 업로드'에만 남음(대화상자에 개수) (c) 자리 없는 사진을 같은 위치에 일반 이미지로 남김 | **(a)** — 고객 사진을 잃지 않는다. 디자인 자유도가 더 필요해지면 (b)로 넓힌다 |
| Q3 | 고객이 고친 템플릿 문구(예: 표지 제목)·디자인 요소 위치 | (a) 문자열만 새 스킨 자리로 옮기고 글꼴·위치는 스킨 것 (b) 문자열 + 글꼴·색 유지 (c) 옮기지 않음(경고 후 스킨 기본값) | **(a)** — 스킨의 디자인 의도와 고객 입력을 함께 지킨다 |
| Q4 | 가격·주문 영향 | (a) 스킨은 같은 상품·같은 가격, 세션 `metadata.calendar.skinKey` 만 기록(호스트 무시 가능) (b) 스킨별 가격 차등 — `skinKey` 를 완료 payload·deliverables 로 내보내는 별도 계약 필요 | **(a)** — 가격은 호스트 책임(상위 설계 원칙 5) |
| Q5 | 스킨이 있는 세트의 페이지별 「템플릿」 교체 메뉴 | (a) 숨김(디자인 혼합·월 면에 표지 템플릿 적용 방지) (b) 유지 | **(a)** — 스킨 없는 세트는 현행 유지 |

---

## 11. 근거(file:line)

- `packages/canvas-core/src/plugins/TemplatePlugin.ts:136-160·:193-224·:677` — 사용자 요소 보존·교체·평탄화에서 `clone(cb)` 를 속성 목록 없이 호출, `:23-49` 템플릿 요소 판정 목록(`'calendar-grid'`·`'ring-overlay'`·`'cut-guide'`)
- fabric 5.5.2 `Object#clone` — `toObject(propertiesToInclude)` 후 `fromObject`(설치본 `dist/fabric.js:16090-16098`)
- `packages/canvas-core/src/utils/canvas.ts:94-182` — `extendFabricOption`(`frameRef`·`extension`·`lockInfo`·`meta` 포함, `isUserAdded` 없음)
- `apps/editor/src/tools/AppTemplateSwap.tsx:85-124·:130-146` — 라이브 교체 = `replaceTemplate` + `rehydrateCalendarGrids`(:109-113), 서버 교체 실패 무시
- `apps/editor/src/hooks/useEditorContents.ts:483-536` — 세션 복원 후처리 순서, `:79-88` `applyCustomerLocks`(비공개), `:1067-1076` 연결 템플릿 적재
- `apps/api/src/templates/template-sets.controller.ts:92-99`(with-templates `@Public`), `template-sets.service.ts:227-231·:248-279`(`isDeleted` 만 확인·ref 순서대로 정렬·중복 포함)
- `apps/admin/src/pages/TemplateSets/calendarProfilePresets.ts:106-139`, `scripts/register-calendar-samples.mjs:191-202` — 템플릿 4종 × 26 ref 구조
- `packages/types/src/product-profile.ts:168-188·:303-317` — `CalendarProfile`·`CalendarSessionMeta`(v1.26 `yearPolicy`·`yearDeltas`)
- `apps/editor/src/utils/calendarRehydrateAll.ts:81-121·:156-161` — 메타를 알려진 키로만 다시 만들고(새 키는 추가해야 보존), PATCH 동봉
- `apps/api/src/edit-sessions/edit-sessions.service.ts:190·:283-321` — `productProfile` 서버 소유·재기록, `apps/api/src/templates/templates.service.ts:429-470` — 템플릿 복제가 canvasData 를 그대로 복사(id 유지)
- `apps/editor/src/utils/autosaveSuspend.ts:41`, `packages/canvas-core/src/utils/history.ts:727`, `apps/editor/src/utils/createCanvas.ts:54` — 자동저장 보류·히스토리 비우기·킬스위치 관례
- `apps/admin/src/pages/TemplateSets/TemplateSetForm.tsx:1080-1277`(규격 카드) · `:1803-1880`(「상품 프로파일」 패널)
