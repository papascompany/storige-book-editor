# PDF 검증 시스템 운영 가이드

## 개요

이 문서는 Storige Worker의 PDF 검증 기능에 대한 운영 가이드입니다.

---

## 면책 조항

> **중요**: 본 자동 검수 시스템은 기술적 검증을 보조하는 도구입니다.

| 구분 | 설명 |
|------|------|
| **자동 검수 범위** | PDF 구조, 색상 모드, 페이지 규격, 제본 규칙 등 기술적 항목 |
| **자동 검수 한계** | 디자인 품질, 색상 정확도, 최종 인쇄물 품질 보장 불가 |
| **최종 책임** | 인쇄소 QC 및 고객 최종 확인 |

### 고객 안내 문구 (권장)

```
본 검수 시스템은 기술적 규격 검증을 자동화한 것으로,
실제 인쇄 품질을 보장하지 않습니다.
최종 확인은 인쇄소 담당자가 진행합니다.
```

---

## 검증 항목 한눈에 (실행 순서) — 2026-06-04 코드 기준

> 코드: `apps/worker/src/services/pdf-validator.service.ts` `validate()`. **에러 ≥1 → `isValid=false`(차단)**, 경고는 통과·표시. `apps/worker/src/dto/validation-result.dto.ts` / `config/validation.config.ts`.

| # | 검증 항목 | 종류 | 코드 | 조건 / 임계값 | 적용 대상 | 자동수정 |
|---|---|---|---|---|---|---|
| 1 | 파일 크기 | 🔴에러(즉시중단) | `FILE_TOO_LARGE` | > **`WORKER_MAX_FILE_SIZE`**(실배포 2GB) | 전체 | ✕ |
| 2 | 파일 무결성 | 🔴에러(즉시중단) | `FILE_CORRUPTED` | PDF 로드 실패(손상) | 전체 | ✕ |
| 3 | 페이지수 초과 | 🔴에러 | `PAGE_COUNT_EXCEEDED` | > **1000p**(`DEFAULT_MAX_PAGES`) | 전체 | ✕ |
| 4 | 제본 규격(페이지수) | 🔴에러 | `PAGE_COUNT_INVALID` | 무선(perfect)·내지 4배수 아님 | 내지 | addBlankPages |
| 5 | 주문 페이지수 일치 | 🟡경고 | `PAGE_COUNT_MISMATCH` | 실제 ≠ 주문 `pages` | 전체 | addBlankPages |
| 6 | 판형(사이즈) | 🔴에러 | `SIZE_MISMATCH` | 주문 `size`와 ±**1mm** 초과(재단 포함/불포함 모두 비교) — 기준값 규격은 하단 **§내지 판형 규격표(2026-07-14)** 참조. 내지는 MediaBox 불일치 시 명시 TrimBox 로 재판정(**§재단선 포함 PDF — TrimBox 기준 판형 판정(2026-09-30)**) | 전체 | fixMethod=resizeWithPadding — **실행기 미제공**. `WORKER_WIRED_FIXABLE_GATING=true` 시 autoFixable=false(기본 OFF=레거시 true) |
| 7 | 재단 여백(bleed) | 🟡경고 | `BLEED_MISSING` | 재단 여백 없음 | 전체 | fixMethod=extendBleed — **실행기 배선(2026-07-13)**: `POST /worker-jobs/fix-bleed`(하단 §도련 자동 삽입). 게이팅 ON/OFF 무관 autoFixable=true |
| 8 | 책등(spine) | 🔴에러 | `SPINE_SIZE_MISMATCH` | 표지 폭 **또는** 높이가 기대치와 허용오차(기본 ±**2mm**) 초과. 무선 등: 폭 `W×2 + spine + 날개×2 + bleed×2`, 높이 `H + bleed×2`. **양장(`hardcover`) = 싸바리 전개**: 폭 `(W+8)×2 + spine + 40`, 높이 `(H+8) + 40`(도련 별도 가산 없음). spine 은 `spineWidthMm`(서버 재계산값 포함) → `paperThickness`+`pages` 폴백 — 하단 **§표지 책등·전개 크기 검증(양장 싸바리 포함)** | **표지**(`coverLayout≠'separate'`) + spine 기대치 있을 때 | fixMethod=adjustSpine — **실행기 미제공**. 게이팅 ON 시 autoFixable=false(기본 OFF=레거시 true) |
| 8b | 책등 정보 미해석 | 🟡경고 | `SPINE_PARAMS_UNRESOLVED` | 무선·양장 표지인데 spine 기대치 없음 → 표지 크기 검사 **생략** 고지(비차단). `details.reason` = `UNMAPPED_PAPER`·`V1_FALLBACK`·`HARDCOVER_PAGE_RULE`·`NO_SPINE_PARAMS` | **표지**(`perfect`·`hardcover`, `coverLayout≠'separate'`) | ✕ |
| 9 | 가로형 페이지 | 🟡경고 | `LANDSCAPE_PAGE` | 가로 방향 페이지 감지 | 전체 | ✕ |
| 10 | 사철 제본 규격 | 🔴에러 | `SADDLE_STITCH_INVALID` | 사철(saddle)·4배수 아님 | 내지(saddle) | addBlankPages |
| 10b | 사철 중앙부 객체 | 🟡경고 | `CENTER_OBJECT_CHECK` | 중앙 걸침 객체 확인 필요 | 내지(saddle) | ✕ |
| 11 | 혼합/펼침면 감지 | 🟡경고 | `MIXED_PDF` | 표지+내지 다른 규격/스프레드 감지 | 전체 | ✕ |
| 12 | CMYK(후가공) | 🔴에러 | `POST_PROCESS_CMYK` | 후가공 파일에 CMYK(별색만 허용) | 후가공 | ✕ |
| 12b | CMYK(일반) | 🟡경고 | `CMYK_STRUCTURE_DETECTED` | 일반 파일 CMYK 감지 | 전체 | ✕ |
| 13 | 별색(Spot) | ⚪정보 | (코드 없음) | 감지 → metadata만 | 전체 | — |
| 14 | 투명도 | 🟡경고 | `TRANSPARENCY_DETECTED` | 투명 효과 포함 | 전체 | ✕ |
| 14b | 오버프린트 | 🟡경고 | `OVERPRINT_DETECTED` | 오버프린트 설정 포함 | 전체 | ✕ |
| 15 | 이미지 해상도 | 🟡경고 | `RESOLUTION_LOW` | 이미지 < **150 DPI**(권장 300) | 전체 | ✕ |
| 16 | 재단선 기하(TrimBox) | 🟡경고 | `TRIMBOX_MISSING` | PDF 에 TrimBox 미명시(재단 위치 기계 확정 불가) | crop-mark opt-in 셋 | ✕ |
| 16b | TrimBox 크기 | 🟡경고 | `TRIMBOX_SIZE_MISMATCH` | TrimBox ≠ 주문 재단 사이즈 ±tolerance | crop-mark opt-in 셋 | ✕ |
| 16c | TrimBox/Bleed 정합 | 🟡경고 | `TRIMBOX_BLEED_INCONSISTENT` | TrimBox⊄MediaBox 또는 BleedBox ≠ trim+bleed×2 | crop-mark opt-in 셋 | ✕ |

**조건부 실행**: ⑧책등=`fileType==='cover'` + `coverLayout≠'separate'` 일 때 — spine 기대치가 있으면 펼침 크기 검사(이때 ⑥판형·⑦재단 여백 검사는 생략), `perfect`·`hardcover` 인데 기대치가 없으면 ⑧b 경고만, 그 밖(중철·스프링 + `spineWidthMm`·`paperThickness` 모두 미전달)은 ⑥판형·⑦재단 여백 검사, ⑩사철=`binding==='saddle'`일 때만, ⑫후가공CMYK=`fileType==='post_process'`일 때만, ⑯재단선 기하=**templateSet `cropMarkEnabled` opt-in + 워커 env `WORKER_CROP_MARK_VALIDATION`(2026-07-06 프로덕션 ON) 이중 게이트**일 때만.

> ⑯ 파트너 표시 안내: 항상 🟡경고(주문 차단 없음). 편집기 산출 PDF 는 TrimBox 를 넣지 않으므로 opt-in 셋에서 `TRIMBOX_MISSING` 이 관찰될 수 있으며, 이는 "고객 업로드 원고의 재단 정보 확인" 용도다. 고객 노출 문구는 "재단선 정보가 없어 인쇄소 확인이 필요할 수 있습니다" 수준을 권장.

---

## 검증 요청 계약 (validate 입력)

`POST /api/worker-jobs/validate(/external)` — `apps/api/src/worker-jobs/dto/worker-job.dto.ts` `CreateValidationJobDto`.

```jsonc
{
  "fileId | fileUrl": "...",
  "fileType": "cover | content | post_process",
  "orderOptions": {
    "size": { "width": 210, "height": 297 },   // ✅ 판형 mm — 검증됨
    "pages": 96,                                 // ✅ 페이지수 — 검증됨
    "binding": "perfect | saddle | spiral | spring | hardcover",  // spring = 레거시 표기
    "bleed": 3,
    "paperThickness": 0.1,                       // 책등 fallback 계산용(spineWidthMm 없을 때)
    "spineWidthMm": 1.0,                          // ✅ (선택·권장) /products/spine/calculate 권위 책등폭. 있으면 워커가 직접 사용(bindingMargin 포함)
    "paperType": "미색모조80",                    // ✅ (선택) 내지 지종. 표지+perfect/hardcover 이고 지종이 v2 로 해석되면 서버 재계산값으로 spineWidthMm 을 덮어씀(조건은 §표지 책등·전개 크기 검증)
    "wingEnabled": false,                         // ✅ (선택) 날개 사용 여부
    "wingWidthMm": 0                              // ✅ (선택) 날개 한쪽 폭(mm) — 표지 총너비에 ×2 가산
  },
  "callbackUrl": "..."
}
```

기대 스펙은 **프런트가 `orderOptions`에 실어 보냄**(서버가 주문에서 자동 도출하지 않음).

---

## 내지 판형 규격표 (2026-07-14)

> 오너 확정 스펙(2026-07-14). `orderOptions.size` = **재단 사이즈(mm)**, 작업 사이즈 = 재단 + 사방 3mm(bleed). 세로형 기준 표기.

| 판형 | 재단 (W×H mm) | 작업 (+사방 3mm) |
|---|---|---|
| A4 | 210×297 | 216×303 |
| A5 | 148×210 | 154×216 |
| B5 | 182×257 | 188×263 |
| 46배판 | 188×257 | 194×263 |
| 16절 | 190×260 | 196×266 |
| B6 | 128×182 | 134×188 |
| 정사각 | 210×210 | 216×216 |
| 비규격 | 고객 입력값 그대로 | 입력값 + 사방 3mm |

**각주**:
- **가로형/세로형**: 방향(W↔H 스왑)만 다르고 동일 기준(예: 가로 A4 재단 = 297×210). 판형 자체는 위 표 하나로 갈음.
- **검증 기준값 = bookmoa 전달값**(`orderOptions.size`). 서버가 주문에서 자동 도출하지 않음(기존 계약 유지). 세션 검증 경로에서 미전달 시 templateSet 판형 폴백(C+ G2).
- **스왑 정규화 서버 가드(2026-07-14)**: 세션 검증 잡 생성 시(`edit-sessions` `createValidationJobs`) 전달 `size`가 templateSet(오리엔트된 판형 권위)과 **정확히 W↔H 스왑 관계**(각 축 오차 <0.01mm·양쪽 비정사각)이면 templateSet 방향으로 정규화한다(미오리엔트 전달 이력 R-13 대응). 스왑이 아닌 불일치·정사각·templateSet 부재는 전달값 원본 보존. 워커 `validatePageSize` 는 축별 엄격 비교 무수정(스왑 허용 없음 — 방향 오업로드 마스킹·fix-bleed 축소 사고 방지). 아울러 비정사각 templateSet 세션에는 `expectedOrientation` 을 주입해 방향 불일치가 `ORIENTATION_MISMATCH` 경고(비차단)로 안내된다.
- **오차 허용**: 기존 체계 그대로(기본 ±1mm, crop-mark opt-in 셋은 `sizeToleranceMm`) — 본 규격표는 기준값 정의이며 허용오차 체계를 바꾸지 않는다.

---

## 재단선 포함 PDF — TrimBox 기준 판형 판정 (2026-09-30)

> 코드: 커밋 `539987a`(X1). 판정 `apps/worker/src/services/pdf-validator.service.ts` `applyTrimBoxSizeBasis()` → 공용 순수 함수 `apps/worker/src/utils/trimbox-normalize.ts` `evaluateTrimSizeBasis()`(표준 pdf-lib·경량 qpdf 경로가 같은 함수로 판정). 크롭 정규화 `normalizeTrimBoxFile()`/`normalizeTrimBoxPdfDoc()`. 잡 주문 재단·도련 해석 `trimCropContextFromJob()`, API 도출 `apps/api/src/worker-jobs/content-trim.ts`(2026-10-03). 킬스위치 `config/validation.config.ts` `isTrimBoxSizeCheckEnabled()`.
>
> 재단선·slug 영역까지 페이지(MediaBox)로 내보낸 내지 PDF(예: MediaBox 236×323 안에 TrimBox 210×297)는 종전에 MediaBox 크기로만 판정돼 `SIZE_MISMATCH` 로 거부됐다. 이 절의 규칙은 그런 파일을 PDF 에 **명시된 TrimBox(재단 크기)** 기준으로 다시 판정한다. 이 판정 규칙은 MediaBox 판정으로 통과하는 파일의 판정 결과를 바꾸지 않는다. 합성·변환·채움 산출 크기는 아래 '합성·변환 입력의 재단선 영역 크롭 정규화'(주문 재단·도련을 아는 경로는 2026-10-03)를 따른다.

### 적용 범위와 평가 순서

- **내지(`fileType === 'content'`)만** 대상이다. 표지(`cover`)·후가공(`post_process`)은 적용하지 않는다(결과 종전과 동일).
- 기존 MediaBox 판정(`validatePageSize`)이 **`SIZE_MISMATCH` 를 냈을 때만** 재판정한다. MediaBox 판정을 통과한 파일은 박스 추출도 하지 않는다(결과 불변). MediaBox 만 있는 PDF 는 판정이 바뀌지 않는다.

### 통과 조건 (전부 충족해야 통과 — 페이지 혼합 불허)

모든 페이지가 다음을 만족해야 한다. 하나라도 어긋나면 적용하지 않고 `SIZE_MISMATCH` 를 유지한다.

1. **명시 TrimBox** 가 있다(TrimBox 없는 페이지가 한 장이라도 있으면 불통과. 폴백으로 CropBox/MediaBox 를 TrimBox 로 간주하지 않는다).
2. TrimBox 가로·세로가 각각 **10mm 이상**이다(미만은 비정상 박스로 보고 미적용).
3. `/UserUnit` 이 1 이다(≠1 미적용).
4. `/Rotate` 가 90·270 이 아니다(0·180 만 적용 — 기존 MediaBox 판정과 같은 비회전 좌표계).
5. TrimBox ⊂ MediaBox(±허용오차).
6. TrimBox ≈ 기대 재단(`orderOptions.trimSize ?? size`) ±허용오차(`sizeToleranceMm ?? 1mm`). **가로·세로 스왑은 허용하지 않는다**(가로 TrimBox 297×210 + 세로 주문 = 불통과).
7. TrimBox 를 사방 대칭으로 주문 도련 `B = max(orderOptions.bleed ?? 3, orderOptions.bleedMm ?? 0)` 만큼 확장한 박스가 MediaBox 안에 들어간다(변환 목표 크기를 원본 안에서 확보할 수 있어야 함).
8. 박스를 신뢰할 수 있다 — 비정형 박스(ArtBox 포함) 또는 경량 경로의 박스 비신뢰(pdfinfo 폴백·간접참조 미해석), 박스 목록 페이지 수 ≠ 문서 페이지 수이면 미적용.

### 결과

**통과 시**
- `SIZE_MISMATCH` 가 제거되고 **경고 `TRIMBOX_SIZE_BASIS`**(비차단, `autoFixable=false`)가 추가된다. 메시지: "재단 크기(TrimBox) 기준으로 판형을 확인했습니다. 원본 파일에는 재단선·여백 영역이 포함되어 있습니다."
  - `details = { sizeBasis: 'trimBox', trimBox: { width, height }, mediaBox: { width, height } }` — mm(소수 1자리), 1쪽 기준.
- `metadata.trimBox = { width, height }`(1쪽 TrimBox, mm) 가 기록된다(기존 optional 필드).
- **도련 판정**: `metadata.bleedSize` = 전 페이지·전 변의 (명시 BleedBox(MediaBox 로 clip) − TrimBox) **최소값**(mm, 소수 1자리). BleedBox 명시가 없는 페이지가 하나라도 있으면 **0**. `metadata.hasBleed` = 원값 도련 ≥ 주문 도련(`bleed ?? 3`) − 허용오차/2.
  - `hasBleed=false` 이면 기존 `validateBleed` 가 종전과 같은 **`BLEED_MISSING`** 경고를 내며, 이때 `details.actual = metadata.bleedSize` 다(종전 경로는 bleedSize 를 쓰지 않으므로 0 그대로).
- 워커 로그: `[TRIMBOX_SIZE_BASIS] media=WxH trim=WxH effBleed=… hasBleed=… pages=N/N`.

**불통과 시**
- `SIZE_MISMATCH` 의 `message`·`details.actual` 은 원문 그대로 유지된다.
- 1쪽에 명시 TrimBox 가 있고 MediaBox 보다 (어느 축이든 허용오차 초과) 작으면 `details.trimBox = { width, height }`(mm) 만 **추가**된다(additive). TrimBox 부재·MediaBox 와 같은 TrimBox 는 결과 무변경.
- 워커 로그: `[TRIMBOX_SIZE_BASIS] rejected reason=… page=…`(사유 예: `noTrimBox`·`trimSizeMismatch`·`rotated`·`userUnit`·`targetOutsideMedia`·`pageCountMismatch`).

### 합성·변환 입력의 재단선 영역 크롭 정규화

- **원본 불변**: 스토리지 원본 파일에는 쓰지 않는다. 합성·변환이 내려받은 **임시 사본**(또는 메모리 사본)에서만 페이지 MediaBox·CropBox 를 "TrimBox 를 사방 대칭 확장한 박스"로 재설정한다. TrimBox 는 유지하고, BleedBox·ArtBox 가 목표 밖이면 목표로 잘라 맞춘다(원점 이동 없음). 적용 후 박스를 재검사하며, qpdf 적용 실패 시 소형 파일은 pdf-lib 로 재시도하고 대형 파일(`LARGE_FILE_THRESHOLD` 초과)은 재단선이 남은 산출물을 내지 않도록 잡을 실패 처리한다(아래 '주문 재단·도련을 아는 경로'의 대형 파일 항목은 예외).
- **변환(작업 크기를 아는 경로)** — `pdf-conversion` 에 `editSize` 가 있는 잡(fix-bleed 등): 목표 = TrimBox + 축별 `(editSize − TrimBox)/2`(대칭 ±허용오차, 0~5mm)로 **작업 크기에 정확히 맞춘다**. 그 결과 `resolveMode` 가 비율 축소(`innerfit`) 대신 `passthrough` 를 고른다. 이미 작업 크기(±max(1mm, `sizeToleranceMm`))인 파일은 크롭하지 않고 종전 경로를 탄다.
- **합성·채움(주문 재단·도련을 아는 경로, 2026-10-03)** — API 가 잡에 주문 재단·도련(`contentTrim`)을 실은 경우의 **내지** 입력(표지·면지 제외).
  - 대상: `editSessionId` 세션에 템플릿셋이 있는 merge 합성(`synthesize/external`·staff 합성 `POST /worker-jobs/synthesize`·편집기 export), books 확정 합성(bookSpec), compose-mixed 자동조립(`assembleFromSession`)·관리자 합성, 첨부 내지 쪽수 채움(attach-page-pad 가 만드는 fix-pagecount 잡).
  - 값: 재단 = 템플릿셋 `width×height`(books 는 bookSpec `innerTrimWidthMm×innerTrimHeightMm`), 도련 **B = 템플릿셋 `bleedMm`**(books 는 bookSpec `bleedMm`), 0~5mm. 허용오차 = 템플릿셋 출처는 **1mm**(템플릿셋 `sizeToleranceMm` 은 쓰지 않음), bookSpec 출처는 `sizeToleranceMm`(0~5mm 밖이면 1mm).
  - 크롭: 공통 기하 조건(명시 TrimBox ⊂ MediaBox·비회전·`/UserUnit` 1·10mm 이상·박스 신뢰)을 만족하고 TrimBox ≈ 주문 재단(±허용오차, 가로·세로 스왑 불허)이면, slug 증거(BleedBox)를 요구하지 않고 TrimBox 를 사방 B 만큼 대칭 확장한 박스(TrimBox + 도련×2 ≈ 주문 작업사이즈)로 크롭한다. 예: 재단 210×297·B 3mm → MediaBox 236×323 재단선 파일, 사방 4mm·BleedBox 없음(218×305), 도련 5mm(220×307) 모두 **216×303**.
  - 크롭하지 않음(원본 박스 그대로): MediaBox 가 이미 목표 크기(±허용오차)인 파일, TrimBox 가 없거나 주문 재단과 다른 파일, 목표가 MediaBox 를 벗어나는 파일. 편집기 산출 내지는 산출이 바뀌지 않는다(재단선 영역이 없는 재단 크기, 또는 이미 작업사이즈).
  - 값이 실리지 않으면 아래 '모르는 경로'를 탄다: 세션 없음·세션에 템플릿셋이 없음, 내지 펼침면 세트(템플릿 `spreadConfig.regionScope = 'inner'`), books 확정의 bookSpec 미연결·조회 결과 없음, 조회 실패·범위 밖 값(재단 10mm 미만, 도련 0~5mm 밖). API 는 이때 키 없이 잡을 그대로 만들고, 워커는 형식이 맞지 않는 값을 무시한다.
  - `pdf-conversion` 잡에 `editSize` 가 함께 있으면 위 '변환' 경로가 우선한다.
  - 대형 파일(`LARGE_FILE_THRESHOLD` 초과)에서 qpdf 적용이 실패하면, 모르는 경로 규칙으로는 크롭할 페이지가 없는 입력(slug 증거 없음 등)은 입력 그대로 진행하고(warn), 그 밖의 입력은 잡을 실패 처리한다.
  - 같은 값이 잡 `options.contentTrim` 에도 기록된다(추적용).
- **합성(기대 크기를 모르는 경로)** — 주문 재단·도련이 실리지 않은 잡의 **내지** 입력(표지·면지 제외): `editSessionId` 없는 merge 합성(books 확정은 bookSpec 값이 실리지 않은 경우만), compose-mixed 수동 경로, spread 합성, 내지 펼침면 세트·템플릿셋이 없는 세션의 합성, `editSize`·주문 재단 없는 fix-pagecount(직접 호출). 아래를 **모두** 만족할 때만 크롭한다.
  - MediaBox − TrimBox 여백이 사방 **5mm 이상**이고 균등(±허용오차)
  - 명시 BleedBox 가 있고 TrimBox 를 감싸며, MediaBox − BleedBox 여백도 사방 **5mm 이상**(선언 도련 **바깥**의 slug 만 인정 — 도련 5mm 이상 정상 파일, MediaBox=BleedBox=작업사이즈인 편집기 산출물은 크롭하지 않음)
  - 도련 = `min(명시 BleedBox 최소 여백, 3mm)` 로 TrimBox 를 대칭 확장한 박스로 크롭
  - **BleedBox 가 없으면 크롭하지 않는다**(도련과 slug 를 구분할 수 없음 — 원본 박스·TrimBox 그대로 보존).
- **fix-pagecount 백지**: 이번 잡에서 정규화가 적용된 파일만, 추가되는 백지를 첫 페이지와 같은 좌표계(MediaBox 원점 포함)로 만들고 TrimBox·BleedBox·CropBox 를 같은 좌표로 복제한다(재검증 시 페이지별 박스 유무가 섞이지 않게). 정규화되지 않은 파일은 종전 백지 경로 그대로.
- 워커 로그:
  - `[TRIMBOX_NORMALIZE] <convert:jobId|compose:jobId|merge:jobId|spread> pages=… cropped=… source=<editSize|orderBleed|declaredBleedBox> bleed=XxY target=WxHmm (…)`. 크롭할 페이지가 없고 목표가 MediaBox 밖인 페이지가 있으면 `… skip pages=… <사유>=<쪽수>,…`(warn). 아는 경로에서 재단 크기 입력(MediaBox ≈ TrimBox)만 그 사유에 해당하면 debug 로만 남는다.
  - `[TRIMBOX_CTX] <merge:jobId|compose:jobId|convert:jobId> source=<templateSet|bookSpec> trim=WxH bleed=B tol=T` — 잡에 주문 재단·도련이 실려 아는 경로가 될 때 1줄. 형식이 맞지 않으면 `[TRIMBOX_CTX] <태그> ignored reason=<notObject|trimInvalid|bleedInvalid|tolInvalid|sourceInvalid|parseError>`(warn) 뒤 모르는 경로. 값이 없는 잡은 줄이 없다.
- API 로그: `[content-trim] attach route=<synthesize|compose-mixed|attach-page-pad|finalization> source=… trim=WxH bleed=B`. 값을 싣지 않으면 `[content-trim] skip route=… reason=<no-session|no-template-set|no-book-spec|inner-spread|invalid|lookup-error>[ err=<오류 이름>]`(warn, 세션·템플릿셋·bookSpec id 미기록 — `err` 는 조회 예외일 때만). 도출 대상이 아닌 잡(`editSessionId` 없는 합성(books 확정 제외), bookSpec 미연결 books 확정 등)은 줄이 없다.

### 알려진 한계

- **판정 통과 조건에 합성 산출 크기 일치는 없다.** 주문 재단·도련이 실리는 합성·채움(위 아는 경로)은 판정을 통과한 재단선 포함 내지를 주문 작업사이즈(TrimBox + 도련×2 — TrimBox 는 주문 재단 ±허용오차)로 산출한다. 주문 재단·도련이 실리지 않는 합성(위 모르는 경로)은 판정을 통과한 파일도 **선언 도련(≤3mm) 크롭** 또는 (BleedBox 부재·slug 증거 부족 시) **원본 박스 그대로** 나갈 수 있어 주문 작업사이즈와 다를 수 있다(예: 사방 4mm·BleedBox 없음 → 원본 218×305 그대로). 아는 경로에서도 TrimBox 가 주문 재단과 아는 경로 허용오차(위 '값' 항목 — 템플릿셋 출처 1mm)를 넘게 다른 파일(판정 허용오차 `sizeToleranceMm` 이 그보다 커서 판정은 통과한 경우)과 목표(TrimBox + 도련×2)가 MediaBox 를 벗어나는 파일은 원본 박스 그대로 산출된다. 어느 경우든 TrimBox 선언은 보존되며, 크롭 시 TrimBox 가 페이지 중앙에 오도록 대칭 확장한다.
- **원본 파일은 재단선 영역을 포함한 그대로** 보존된다(다운로드 시 원본 그대로).
- 표지·썸네일·조판 미리보기에는 적용하지 않는다.

### 킬스위치 `WORKER_TRIMBOX_SIZE_CHECK`

- **코드 기본 ON.** 값이 `false`·`0`·`off`·`no`(앞뒤 공백·대소문자 무시)일 때만 OFF 다. 미설정·빈 문자열·그 밖의 값은 ON.
- 한 플래그가 **판정과 크롭 정규화를 함께** 게이트한다(반쪽 상태 없음). OFF 이면 둘 다 종전 동작.
- OFF 이면 합성·채움 잡에 실린 주문 재단·도련(`contentTrim`)도 함께 꺼진다 — 워커가 값을 읽지 않는다(`[TRIMBOX_CTX]` 줄 없음). API 는 플래그와 무관하게 값을 싣는다.
- `docker-compose.yml` worker 매핑은 `WORKER_TRIMBOX_SIZE_CHECK=${WORKER_TRIMBOX_SIZE_CHECK:-true}` 다. 다른 플래그처럼 `:-false` 로 바꾸면 조용히 OFF 되고, 매핑을 빼면 `.env` 로 끌 수 없다.
- 끄기: `.env` 에 `WORKER_TRIMBOX_SIZE_CHECK=false` 후 worker 컨테이너 재생성.
- 확인: worker 기동 로그 `[FLAGS] worker … WORKER_TRIMBOX_SIZE_CHECK=true|false`.

### 운영 실측 사례 (2026-09-30)

- MediaBox 236×323 · TrimBox 210×297(사방 13mm 재단선 여백) 내지 파일 **2건**: 종전 `SIZE_MISMATCH` 거부 → `TRIMBOX_SIZE_BASIS` 경고와 함께 **통과로 전환**(선언 도련이 주문 도련보다 부족하면 `BLEED_MISSING` 경고가 함께 붙는다).
- 286×286 파일(명시 TrimBox 가 재단 크기를 가리키지 않음): **거부 유지**(`SIZE_MISMATCH`, 결과가 킬스위치 OFF 와 동일).

---

## 책등·날개 검증 개선 (2026-06-04 적용)

> 코드: `apps/worker/src/services/pdf-validator.service.ts` `validateSpine()` + `worker-job.dto.ts`. **하위호환**(신규 필드 미전달 시 기존 동작 유지 — 회귀 없음). 적용: 워커+API 재배포.

| 항목 | 이전 | 현재 |
|---|---|---|
| **책등(spine)** | `paperThickness×(pages/2)` 로만 재계산 → 권위 공식의 `bindingMargin` 누락 | `spineWidthMm` 전달 시 **그 값을 직접 사용**(margin 포함). 미전달 시 기존 fallback |
| **날개(wing)** | 검증식에 wing 없음 → 정상 날개 표지 거부 위험 | `wingEnabled`+`wingWidthMm` 전달 시 표지 기대너비 = `size.w×2 + spine + **wingWidthMm×2** + bleed×2` |

표지 총너비 검증식(무선 등, 2026-06-04 기준 — 양장 싸바리 전개·높이 축·서버 재계산은 아래 **§표지 책등·전개 크기 검증**):
```
expectedTotalWidth = size.width×2 + (spineWidthMm ?? paperThickness×pages/2)
                     + (wingEnabled ? wingWidthMm×2 : 0) + bleed×2   (허용 ±2mm)
```

### ⚠️ 프런트(주문화면/bookmoa) 액션 필요
개선이 **실제로 동작하려면 프런트가 검증 요청에 새 필드를 실어 보내야** 한다:
- **`spineWidthMm`**: `/products/spine/calculate` 응답의 `spineWidth` 를 그대로 전달(가장 정확).
- **`wingEnabled`/`wingWidthMm`**: 날개 상품일 때 전달(템플릿 `spreadConfig.spec.wingEnabled/wingWidthMm` 기준).
- 미전달 시 = 기존 동작(책등 fallback 재계산, 날개 미고려) → 회귀는 없으나 날개 상품 오검출은 그대로 남음.

미사용 코드(참고): `UNSUPPORTED_FORMAT`, `SPREAD_SIZE_MISMATCH`는 enum 정의만 있고 push 안 됨(스프레드는 `MIXED_PDF` 경고로 처리).

---

## 표지 책등·전개 크기 검증 (양장 싸바리 포함)

> 코드: 서버 재계산 `apps/api/src/worker-jobs/worker-jobs.service.ts` `injectServerSpine()` · 책등 산식 `apps/api/src/products/spine.service.ts` · 워커 판정 `apps/worker/src/services/pdf-validator.service.ts` `resolveExpectedSpine()`·`validateSpine()` · 공용 산식 `packages/types/src/spine-calc.ts`(`calcHardcoverSpine`·`hardcoverCoverSpreadFromSpine`) · 허용오차 `apps/worker/src/config/validation.config.ts`.
>
> 양장 표지 PDF 의 규격은 **고객 업로드 검증 규격(아래 싸바리 전개)** 이 기준이다. 양장 표지 템플릿도 이 규격으로 만든다.

### 1) 책등 폭 결정 (우선순위)

1. **서버 재계산** — 검증 잡 생성 시 API 가 수행한다. 조건: `fileType='cover'`, `coverLayout≠'separate'`, `binding` 이 `perfect`·`hardcover`, `paperType` 과 `pages`(≥1) 모두 있음. 지종이 v2 두께로 해석되면 그 값으로 `spineWidthMm` 을 **덮어쓴다**(보낸 값은 `clientSpineWidthMm` 로 보존, `spineSource='server'`). v1 폴백·지종 미해석이면 보낸 `spineWidthMm` 을 유지하고, 보낸 값도 없으면 미해석 사유(`V1_FALLBACK`·`UNMAPPED_PAPER`)를 기록한다. 업로드 검증(`validate`·`validate/external`)·편집 세션 검증·books 확정 검증 잡이 모두 같은 경로를 탄다.
   - 양장 v2 산식: `책등 = max(4 + ceil(pages/2 × 장당두께), 8)` mm(합지 4mm·최소 8mm, 정수 mm). 서버 재계산은 12쪽 미만·4의 배수 아님이어도 값을 낸다(비차단).
   - 무선 v2 산식은 페이지당 두께표 기준(`calcPerfectSpine`).
2. **워커 기대 책등** — `spineWidthMm`(0 이상 숫자, 소수 2자리 반올림)을 그대로 쓴다. 없으면 `paperThickness`+`pages`(≥1) 폴백:
   - 양장: `calcHardcoverSpine` — 위 양장 산식(`paperThickness` = 장당 두께). **12쪽 이상·4의 배수일 때만** 값이 나오고, 아니면 기대치 없음(`HARDCOVER_PAGE_RULE`).
   - 그 외: `paperThickness × pages/2`(소수 1자리, 제본 여유분 없음).
3. 둘 다 없으면 기대치 없음.

### 2) 기대 크기

| 제본 | 기대 폭 | 기대 높이 | 비고 |
|---|---|---|---|
| `hardcover`(양장) | `(W+8)×2 + spine + 40` | `(H+8) + 40` | 싸바리 전개(앞·뒤표지 각 W+8 · H+8, 감싸기 여분 40). **도련(`bleed`)·날개는 가산하지 않음** |
| 그 외(무선 등) | `W×2 + spine + 날개×2 + bleed×2` | `H + bleed×2` | 날개는 `wingEnabled` + `wingWidthMm>0` 일 때만. `bleed` 미전달 시 기본 3mm |

- `W×H` = `orderOptions.size`(재단 사이즈).
- 예: 양장 210×297, 책등 8mm → **484×345mm**(앞·뒤표지 218×305).
- 폭·높이 **각각** 허용오차와 비교한다. 하나라도 넘으면 `SPINE_SIZE_MISMATCH`(🔴차단).

### 3) 허용오차

`orderOptions.spineToleranceMm`(0 초과) → 워커 env `SPINE_TOLERANCE_MM_HARDCOVER`(양장)·`SPINE_TOLERANCE_MM_PERFECT`(그 외) → 기본 **2mm**. 결과값은 `SPINE_TOLERANCE_MM_MAX`(기본 5mm)로 상한 제한한다.

### 4) 결과

- **불일치** `SPINE_SIZE_MISMATCH`: 메시지 `표지 크기가 {싸바리 전개|책등|책등·날개} 규격과 맞지 않습니다. (예상: W×Hmm, 현재: W×Hmm)`. `details` = `expectedMm`·`actualMm`·`axis`(`width`|`height`, 폭 우선)·`toleranceMm` + `expected{ totalWidth, totalHeight, spine, spineSource('server'|'provided'|'recalculated'), wingTotal, layout('hardcover-wrap'|'perfect-spread') }`·`actual{ totalWidth, totalHeight }`. `fixMethod='adjustSpine'`(실행기 없음).
- **기대치 없음** `SPINE_PARAMS_UNRESOLVED`(🟡비차단, `perfect`·`hardcover` 표지만): 메시지 `책등 두께 정보가 없어 표지 규격 검증을 생략했습니다.`(지종이 있으면 `(지종: …)` 추가). `details = { paperType, binding, reason }`, `reason` = 서버 기록 사유(`UNMAPPED_PAPER`·`V1_FALLBACK`) → 양장 + `paperThickness` 있음 + 쪽수 규칙(12쪽 이상·4의 배수) 위반 `HARDCOVER_PAGE_RULE` → 지종만 있음 `UNMAPPED_PAPER` → 그 밖 `NO_SPINE_PARAMS` 순.
- 기대치가 있으면 `metadata.spineSize` 에 적용 책등(mm)이 기록된다.
- `perfect`·`hardcover` 표지(또는 기대 책등이 있는 표지)는 단일 판형(`SIZE_MISMATCH`)·재단 여백(`BLEED_MISSING`) 검사를 하지 않는다 — 전개 크기 검사가 대신한다.
- `coverLayout='separate'`(앞·뒤 낱장) 표지는 이 절을 적용하지 않고 단일 판형 검사를 한다.
- 편집 세션 완료 검증에서 **양장 싸바리 템플릿셋으로 편집한 표지**(2026-10-06 — 연동 가이드 3.1 「양장 싸바리 템플릿셋 표지」): 편집기가 싸바리 전개 표지(`metadata.coverOutput.layout:'hardcover-wrap'`)를 기록했고 ① 기록 판형(`trimWidthMm`·`trimHeightMm`) = 세션 템플릿셋 판형 ② 표지 한 면(`metadata.spread.spec`) = 판형 + 8mm ③ 기록 출력 크기 = 위 싸바리 전개식이 모두 맞으면(각 ±0.5mm), 서버가 제본 `hardcover`·판형 `W×H`·적용 책등·도련 0 으로 위 싸바리 전개 검사(허용 ±2mm)를 연결한다. 벗어나면 표지 검증 잡이 `SPINE_SIZE_MISMATCH`(`details.expected.layout:'hardcover-wrap'`)로 `FAILED` 가 되고, 세션 상태와 `session.*` 는 바뀌지 않는다. 주문 제본(`metadata.orderOptions.bindingType`)이 `hardcover` 이거나 없을 때 적용하며(인식 5종 `perfect`·`saddle`·`spring`·`spiral`·`hardcover` 밖의 값은 없음으로 처리), `perfect`·`saddle`·`spring`·`spiral` 이면 표지 크기 검사를 생략한다. ①~③ 중 하나라도 맞지 않으면 아래 그 밖의 양장 편집기 표지와 같다.
- 그 밖의 **양장 편집기 표지**(스프레드 스냅샷이 있는 세션)는 서버가 책등 기하(`metadata.spread`·`coverOutput`)를 연결하지 않는다(`HARDCOVER_GEOMETRY_UNVERIFIED`). 표지는 세션 기본 옵션(`metadata.binding`·`metadata.paperThickness`)으로 검사하며, 세션 metadata 에 두께가 없으면 크기 검사가 생략되고 `SPINE_PARAMS_UNRESOLVED` 경고만 남는다. 고객 업로드 양장 표지는 위 규칙으로 검사한다.

---

## 데이터 주도 페이지수 검증 (2026-06-25 적용)

> 코드: `apps/worker` (커밋 `6d0cb76`, 배포완료). **하위호환**(신규 필드 미전달 시 기존 binding 폴백 — byte-identical, 회귀 없음).

페이지수 규칙을 `binding` 문자열 하드코딩 대신 **주문 데이터(`orderOptions`)로 직접 주입**한다. 신규 필드 3종은 **전부 선택(optional)** 이며, 하나라도 전송되면 워커가 그 값으로 페이지수를 검증한다. 셋 다 미전송이면 기존 `binding` 폴백 동작.

### 신규 `orderOptions` 필드

| 필드 | 의미 | 위반 시 |
|---|---|---|
| `pageMultiple` | 페이지수가 이 값의 **배수**여야 함 | `PAGE_COUNT_INVALID` 🔴에러 — `autoFixable=true`, `fixMethod='addBlankPages'`, `details={ expected: 올림배수, actual, pageMultiple }` |
| `pageCountMax` | **상한** 페이지수 | `PAGE_COUNT_EXCEEDED` 🔴에러 |
| `pageCountMin` | **하한** 페이지수 | `PAGE_COUNT_BELOW_MIN` 🟡경고(신규·비차단) — `details={ min, actual }` |

- **미전송 폴백(레거시 binding)**: `perfect`/`saddle` → 4배수 검사(`%4`), `saddle` → ≤64p, `spring` → 홀수 페이지 경고. 데이터 주도 필드를 보내면 이 폴백 대신 전송값으로 검증한다(둘은 병행이 아닌 택일).
- **글로벌 안전상한 1000p**(`options.maxPages`)는 위 규칙과 **별개로 항상 유지**된다.
- **파일크기 상한**은 `WORKER_MAX_FILE_SIZE`(실배포 2GB)로 별개 관리(위 §파일 크기 참조).

### binding 어휘 = canonical 4종

책등(spine) 계산은 `binding_types` DB를 `code`로 조회한다. canonical `code`는 4종(`perfect` / `saddle` / `spiral` / `hardcover`)이며, 매칭되는 code가 없으면 404. 합성기(synthesis)도 `perfect`/`saddle`/`hardcover`만 인지하고 그 외는 일반 병합 처리한다.

따라서 파트너는 워커로 보내는 `binding`을 **canonical 4종으로 매핑**하고, 페이지 규칙 자체는 `binding` 문자열이 아니라 위 `pageMultiple`/`pageCountMax`/`pageCountMin` 값으로 구분해야 한다(문자열 무의존).

**bookmoa 확정 매핑** (bookmoa 라벨 구분은 bookmoa 주문기록 측에 유지):

| canonical `code` | bookmoa 라벨 | `pageMultiple` | `pageCountMax` | `pageCountMin` |
|---|---|---|---|---|
| `perfect` | 무선 / 무선날개 / PUR | 2 | 1000 | 8 |
| `saddle` | 중철 / 계단식중철 | 4 | 64 | 8 |
| `hardcover` | 양장 / 반양장 | 4 | 1000 | 8 |
| `spiral` | 스프링(PP제외/포함) / 벽걸이 / 양장스프링 | 2 | 500 | 8 |

> **편집 완료 내지 검증 잡(2026-10-06)**: 편집기에서 만든 내지의 완료 검증 잡은 서버가 이 데이터 주도 필드를 채운다 — `pageMultiple` = 편집기 쪽 단위(세션 `pageStep` → 템플릿셋 쪽 단위)를 PDF 쪽 단위로 환산한 값(내지 펼침면 세트는 ÷2, 펼침 단위), 중철은 4의 배수·`pageCountMax` 64(호스트 값 우선, 펼침면 세트는 ÷2). 쪽 단위가 없는 낱장 세트는 필드를 싣지 않아 위 레거시 제본 규칙으로 판정한다. 규칙 자체(데이터 주도 경로)는 바뀌지 않는다.

---

## 페이지수 자동 보정 (fix-pagecount) — ✅ 배포 완료(2026-06-25 LIVE)

> 배수위반(`PAGE_COUNT_INVALID`, FIXABLE)을 빈 페이지 추가로 보정하는 경로. 기존 변환(`pdf-conversion`) 파이프라인 재사용(`addPages` + `registerExternalFile`).

### 엔드포인트

| 엔드포인트 | 인증 |
|---|---|
| `POST /worker-jobs/fix-pagecount` | 내부 `RolesGuard` |
| `POST /worker-jobs/fix-pagecount/external` | 외부 `@Public` + `ApiKeyGuard` + `CurrentSite` |

**Body**: `{ fileId, targetMultiple }`

### 비동기 흐름

1. 호출 → `WorkerJob`(`jobId`) 즉시 반환.
2. 호출측은 `GET /worker-jobs/:id` 폴링 → `status` `COMPLETED` + `outputFileId`(=빈 페이지가 추가된 **새 `fileId`**).
3. **원본 `fileId`는 보존**된다.

### 동작

```
원본 PDF 로드
→ targetPages = ceil(현재페이지수 / targetMultiple) * targetMultiple
→ 첫 페이지 크기의 백지를 (targetPages − 현재페이지수)장 맨 뒤에 추가
→ 새 파일 저장 → 새 fileId 등록(원본 site/order 승계)
```

### d1(파트너) 연동 흐름

1. 검증 결과가 **FIXABLE**(배수위반)로 반환.
2. 파트너 모달: "N페이지로 빈페이지 추가할까요? Y/N".
3. **Y** → `fix-pagecount` 호출 → 반환 `outputFileId`로 주문 진행.
4. **N** → 호출하지 않음(재업로드 유도, 자동 수정 없음).

---

## 도련 자동 삽입 (fix-bleed) — 2026-07-13 배선

> 재단 여백 없음(`BLEED_MISSING`, 경고·비차단)을 자동 보정하는 경로. 고객이 **재단 사이즈**
> (=templateSet 판형, 예 297×210)로 업로드한 PDF 를 **작업 사이즈**(판형 + 사방 `bleedMm`×2,
> 예 303×216)로 변환한다 — 콘텐츠 **무스케일 중앙 배치**(사방 정확히 `bleedMm` 확장).
> 기존 변환(`pdf-conversion`) 임포지션 부품 재사용(`resolveMode`/`applyImpositionMode('center')` — 워커 무수정).

### 엔드포인트

| 엔드포인트 | 인증 |
|---|---|
| `POST /worker-jobs/fix-bleed` | `@Public` (게스트 편집기 모달 — render-pages 전례) |

**Body**: `{ fileId, templateSetId }` — ⚠️ 사이즈는 클라이언트가 보내지 않는다. 서버가
`templateSetId` 로 판형(width/height)+`bleedMm`+`sizeToleranceMm` 을 권위 산출(임의 사이즈 입력 차단).

**에러**: templateSet 미존재/비PDF/작업사이즈 무효 = `400`(`TEMPLATE_SET_NOT_FOUND`/`FILE_NOT_PDF`/`INVALID_WORK_SIZE`), 파일 미존재 = `404`.

### 비동기 흐름

1. 호출 → `WorkerJob`(`jobId`) 즉시 반환.
2. 호출측은 `GET /worker-jobs/:id` 폴링 → `status` `COMPLETED` + `outputFileId`(=도련이 삽입된 **새 `fileId`**).
3. **원본 `fileId`는 보존**된다. 잡에 `editSessionId` 는 주입되지 않는다(세션 상태 무영향).

### 동작 (워커 resolveMode 자체결정)

```
editSize = { templateSet.width + bleedMm*2, templateSet.height + bleedMm*2 }
실측 = editSize (±tol)  → passthrough (이미 작업 사이즈 — 무가공)
실측 < editSize          → center     (무스케일 중앙 배치 = 사방 bleedMm 확장) ← 주 경로
실측 > editSize          → innerfit   (비율유지 다운스케일 + 중앙)
```

---

## 에러 코드 (차단)

에러가 발생하면 접수가 차단되며, 고객은 파일을 수정 후 재업로드해야 합니다.

| 코드 | 설명 | 원인 | 해결 방법 |
|------|------|------|----------|
| `UNSUPPORTED_FORMAT` | 지원하지 않는 파일 형식 | PDF가 아니거나 손상된 헤더 | PDF 형식으로 저장 |
| `FILE_CORRUPTED` | 손상된 파일 | 파일 업로드 중 손상 또는 잘못된 PDF | 파일 재생성 |
| `FILE_TOO_LARGE` | 파일 크기 초과 | `WORKER_MAX_FILE_SIZE`(실배포 2GB) 초과 | 이미지 해상도 줄이기, 압축 |
| `PAGE_COUNT_INVALID` | 페이지 수 오류 | 제본 방식에 맞지 않는 페이지 수 | 4의 배수로 조정 (사철) |
| `PAGE_COUNT_EXCEEDED` | 페이지 수 초과 | 사철 64페이지 초과 등 | 무선 제본으로 변경 |
| `SIZE_MISMATCH` | 페이지 사이즈 불일치 | 주문 규격과 PDF 크기 다름 | PDF 크기 조정 |
| `SPINE_SIZE_MISMATCH` | 책등 사이즈 불일치 | 표지 너비가 맞지 않음 | 책등 포함 표지 재생성 |
| `SADDLE_STITCH_INVALID` | 사철 제본 규격 오류 | 페이지 수가 4의 배수 아님 | 빈 페이지 추가 |
| `POST_PROCESS_CMYK` | 후가공 파일 CMYK 사용 | 후가공 파일에 CMYK 색상 | 별색(Spot Color)만 사용 |
| `SPREAD_SIZE_MISMATCH` | 스프레드 사이즈 불일치 | 펼침면 크기가 맞지 않음 | 정확한 크기로 조정 |

### 자동 수정 가능 에러

> **C+ 게이팅 (2026-07-11, 킬스위치 `WORKER_WIRED_FIXABLE_GATING` 기본 OFF)**:
> ON 이면 `autoFixable=true` 는 실행기가 실제 배선된 fixMethod(`WIRED_FIX_METHODS`,
> 현재 `addBlankPages`·`extendBleed`(2026-07-13 배선))에만 부여된다. 실행기 없는 fixMethod 는 `autoFixable=false` 로
> 발행되며(fixMethod 필드는 의도 메타데이터로 유지), 미배선 에러가 **하나라도 포함된** 잡은
> `FIXABLE` 이 아니라 `FAILED` 로 판정된다(단독뿐 아니라 배선 에러와 혼재해도 FAILED —
> `errors.every(autoFixable)` 파생). 기본 OFF 상태는 레거시와 byte-identical.
> **세션(생성 PDF) 경로는 예외적으로 보존**: 잡 status 는 FAILED 로 정직화되어도
> 세션 상태 전이·웹훅 이벤트(session.validated/failed)는 게이팅 ON/OFF 무관 종전과
> 동일하다(G2b — 전에러 fixMethod 보유 VALIDATE 잡의 FIXABLE 동등 처리).
> ⚠️ ON 전환 선결 게이트: ①editor 첨부 모달 A4 하드코드 [해소 2026-07-11, trimSize 주입]
> ②세션 검증 경로 flip [해소 2026-07-11, G2a size 폴백+G2b 동등 처리] ③bookmoa 사전 고지 [잔여]
> — `.cursor/plans/NOTICE_bookmoa_autofixable_gating_2026-07-11.md` 참조.

| 코드 | 수정 방법 | autoFixable (게이팅 ON 기준) | 설명 |
|------|----------|------|------|
| `PAGE_COUNT_INVALID` | `addBlankPages` | ✅ true | 빈 페이지 추가로 배수 맞춤 — `POST /worker-jobs/fix-pagecount(/external)` 로 실행 (LIVE) |
| `SADDLE_STITCH_INVALID` | `addBlankPages` | ✅ true | 동일 실행기 (사철 4배수) |
| `SIZE_MISMATCH` | `resizeWithPadding` | ❌ false (OFF 시 true) | **실행기 미제공** — 패딩 리사이즈는 블리드 백지/크롭 손실 리스크로 미리보기·동의 UX 와 함께 별도 구현 예정 |
| `SPINE_SIZE_MISMATCH` | `adjustSpine` | ❌ false (OFF 시 true) | **실행기 미제공** — 표지 아트워크 재배치는 자동화 비대상(수동 재작업 영역) |
| (경고) `BLEED_MISSING` | `extendBleed` | ✅ true | 재단→작업 사이즈 무스케일 중앙 배치 — `POST /worker-jobs/fix-bleed` 로 실행 (2026-07-13 배선, §도련 자동 삽입) |

---

## 경고 코드 (주의)

경고는 접수를 차단하지 않지만, 인쇄 품질에 영향을 줄 수 있습니다.

| 코드 | 설명 | 원인 | 권장 조치 |
|------|------|------|----------|
| `PAGE_COUNT_MISMATCH` | 페이지 수 불일치 | 주문한 페이지 수와 PDF가 다름 | 고객 확인 요청 |
| `PAGE_COUNT_BELOW_MIN` | 페이지 수 하한 미만 (2026-06-25 신규) | 실제 페이지 수 < `orderOptions.pageCountMin` | 고객 확인 요청 (비차단, `details={ min, actual }`) |
| `BLEED_MISSING` | 재단 여백 없음 | 3mm 여백이 없음 | 여백 추가 권장 |
| `RESOLUTION_LOW` | 해상도 낮음 | 150DPI 미만 이미지 존재 | 고해상도 이미지 사용 (300DPI 권장) |
| `LANDSCAPE_PAGE` | 가로형 페이지 | 세로형 대신 가로형 | 의도 확인 |
| `CENTER_OBJECT_CHECK` | 중앙부 객체 확인 | 사철 제본 접지 부분 | 중요 내용 배치 확인 |
| `CMYK_STRUCTURE_DETECTED` | CMYK 구조 감지 | CMYK 색상 공간 사용 | RGB 변환 권장 (웹 용도) |
| `MIXED_PDF` | 혼합 PDF | 표지+내지 다른 규격 | 분리 업로드 권장 |
| `TRANSPARENCY_DETECTED` | 투명도 감지 | 투명 효과 사용 | 평면화(Flatten) 권장 |
| `OVERPRINT_DETECTED` | 오버프린트 감지 | 오버프린트 설정 | 인쇄 결과 확인 |
| `TRIMBOX_SIZE_BASIS` | 재단 크기(TrimBox) 기준 판형 확인 (2026-09-30 신규) | 재단선 포함 내지 PDF 가 MediaBox 대신 명시 TrimBox 로 판형 통과 | 조치 불요 (비차단 정보성, `details={ sizeBasis:'trimBox', trimBox, mediaBox }` mm — §재단선 포함 PDF) |

---

## 제본 방식별 규칙

### 무선 제본 (Perfect Binding)

| 항목 | 규칙 |
|------|------|
| 페이지 수 | 4의 배수 필수 |
| 최대 페이지 | 제한 없음 |
| 책등 | 페이지 수 × 종이 두께 |

### 사철 제본 (Saddle Stitch)

| 항목 | 규칙 |
|------|------|
| 페이지 수 | 4의 배수 필수 |
| 최대 페이지 | 64페이지 |
| 책등 | 없음 |

### 스프링 제본 (Spring)

| 항목 | 규칙 |
|------|------|
| 페이지 수 | 제한 없음 |
| 최대 페이지 | 제한 없음 |
| 책등 | 없음 |

---

## 스프레드(펼침면) 감지

스프레드 형식은 페이지 너비가 단면의 2배인 PDF입니다.

### 감지 기준 (점수 기반)

| 조건 | 점수 |
|------|------|
| 규격 기반 (너비 = 단면 × 2) | +60점 |
| 높이 일치 | +20점 |
| 비율 > 1.25 | +15점 |
| 페이지 일관성 (표준편차 < 1mm) | +10점 |

- **70점 이상**: 스프레드로 판정
- **신뢰도**: 80점 이상 high, 60점 이상 medium, 그 외 low

### 혼합 PDF 처리

표지(단면)와 내지(펼침면)가 혼합된 경우:
- `MIXED_PDF` 경고 발생
- 페이지 그룹 정보 제공

---

## 색상 모드 감지

### 2단계 검증 프로세스

1. **1차 구조적 감지** (빠름)
   - PDF 바이트에서 `/DeviceCMYK`, `/ICCBased /N 4` 검색
   - CMYK 구조가 없으면 RGB로 확정

2. **2차 Ghostscript inkcov** (정확함)
   - 1차에서 CMYK 구조 감지 시 실행
   - 실제 잉크 사용량 분석
   - CMY > 0.001 이면 CMYK 사용으로 판정

### 후가공 파일 색상 규칙

| 허용 여부 | 색상 모드 | 설명 |
|----------|----------|------|
| ✅ 허용 | Spot Color (별색) | 칼선, 박 등 후가공 전용 |
| ❌ 불허 | CMYK | 인쇄색과 혼동 위험 |
| ❌ 불허 | K (Black) 단독 | 칼선 오인 가능 |

---

## 이미지 해상도 감지

PDF 내 이미지의 유효 해상도(Effective DPI)를 분석하여 인쇄 품질 문제를 사전에 감지합니다.

### 해상도 기준

| 항목 | 값 | 설명 |
|------|-----|------|
| 권장 해상도 | 300 DPI | 인쇄 품질 권장 |
| 최소 허용 해상도 | 150 DPI | 이 값 미만 시 `RESOLUTION_LOW` 경고 |

### DPI 계산 방식

**유효 해상도(Effective DPI)** = 이미지가 PDF 페이지에서 실제로 표시되는 해상도

```
Effective DPI = (이미지 픽셀 크기 × 25.4) / 페이지에서 표시되는 크기(mm)
```

**예시**:
- 원본 이미지: 2480×3508 픽셀
- 표시 크기: A4 (210×297mm)
- 유효 해상도: 약 300 DPI ✅

- 원본 이미지: 800×600 픽셀
- 표시 크기: A4 (210×297mm)
- 유효 해상도: 약 97 DPI ❌ (경고 발생)

### 경고 대응

| 유효 해상도 | 인쇄 품질 | 권장 조치 |
|------------|----------|----------|
| 300+ DPI | 최상 | 그대로 진행 |
| 200-299 DPI | 양호 | 경고 없음, 진행 가능 |
| 150-199 DPI | 보통 | 경고 없음, 품질 저하 가능 |
| 72-149 DPI | 낮음 | `RESOLUTION_LOW` 경고, 고해상도 이미지 권장 |
| 72 미만 DPI | 매우 낮음 | `RESOLUTION_LOW` 경고, 이미지 교체 필요 |

### 제한 사항

- 50×50 픽셀 미만의 작은 이미지(아이콘 등)는 분석에서 제외
- 이미지 표시 크기는 페이지 크기 기준으로 추정 (transform matrix 미파싱)
- 중복 이미지(동일 크기)는 한 번만 계산

---

## Ghostscript 리소스 관리

### 설정 값

| 항목 | 기본값 | 설명 |
|------|--------|------|
| `GS_TIMEOUT` | 5000ms | 실행 타임아웃 |
| `GS_MAX_PAGES` | 50 | inkcov 최대 페이지 |
| `GS_CONCURRENCY` | 2 | 동시 실행 제한 |
| `LARGE_FILE_THRESHOLD` | 50MB | 대형 파일 기준 |

### 폴백 정책

| 상황 | 처리 |
|------|------|
| CMYK 구조 없음 | GS 생략, RGB 확정 |
| GS 성공 | GS 결과 사용 (신뢰도 high) |
| GS 실패/타임아웃 | 구조 기반 추정 (신뢰도 low), 경고 추가 |

### 모니터링 포인트

```bash
# Ghostscript 프로세스 확인
ps aux | grep gs

# 메모리 사용량 확인
docker stats storige-worker-1

# Bull Queue 모니터링
redis-cli LLEN bull:validation:active
redis-cli LLEN bull:validation:waiting
```

---

## 환경 변수

```env
# Worker 설정
WORKER_STORAGE_PATH=../api        # 스토리지 경로
API_BASE_URL=http://localhost:4000  # API 서버 주소

# Bull Queue 설정
REDIS_HOST=localhost
REDIS_PORT=6379

# 검증 설정
WORKER_MAX_FILE_SIZE=2147483648    # 2GB (실배포 파일크기 상한)
GS_TIMEOUT=5000                   # 5초
GS_MAX_PAGES=50
```

---

## Bull Queue 설정

### concurrency 설정

```typescript
// validation.processor.ts
@Processor('validation')
export class ValidationProcessor {
  constructor(
    @InjectQueue('validation') private queue: Queue,
  ) {
    // concurrency: 동시 처리 작업 수
    this.queue.process(2, this.process.bind(this));
  }
}
```

### 권장 설정

| 환경 | concurrency | 이유 |
|------|-------------|------|
| 개발 | 1 | 디버깅 용이 |
| 스테이징 | 2 | GS 리소스 보호 |
| 프로덕션 | 2~4 | 서버 사양에 따라 조정 |

---

## Docker 배포

### Ghostscript 확인

```dockerfile
# Dockerfile.worker
FROM node:24-alpine

# Ghostscript 설치
RUN apk add --no-cache ghostscript

# 버전 확인
RUN gs --version
```

### 확인 명령

```bash
# 컨테이너 내 GS 확인
docker exec storige-worker-1 gs --version

# 기능 테스트
docker exec storige-worker-1 gs -q -dNODISPLAY -c "(Hello) print quit"
```

---

## 트러블슈팅

### GS 타임아웃 발생

```
원인: 대형 파일 또는 복잡한 PDF
해결:
1. GS_TIMEOUT 증가 (최대 30초)
2. 파일 크기 제한 강화
3. 대형 파일은 구조 기반만 사용
```

### CMYK 오탐지

```
원인: ICC 프로파일이 포함된 RGB 파일
해결:
1. 2차 inkcov 분석으로 확인
2. CMY 사용량이 0이면 RGB로 판정
```

### 메모리 부족

```
원인: 동시 처리 작업 과다
해결:
1. concurrency 감소 (2 → 1)
2. 대형 파일 GS 분석 생략
3. 컨테이너 메모리 증가
```

---

## 참고 문서

- [PDF 검증 기능 확장 검토서](./PDF_VALIDATION_REVIEW.md)
- [PDF 검증 WBS](./PDF_VALIDATION_WBS.md)
- [QA 체크리스트](../apps/worker/test/QA_CHECKLIST.md)
