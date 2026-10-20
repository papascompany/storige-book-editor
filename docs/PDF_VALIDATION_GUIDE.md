# PDF 검증 시스템 운영 가이드

> **Shopify 상품 검증 계획 (2026-10-15)**: 현재 validator의 실행 규칙은 이 문서를 따릅니다. Shopify 주문용 표지/내지·최종 output 검증, policy/coverage, 수정 후 재검증, 불변 manifest/보존 조건은 [새 개발 정본 §8](./SHOPIFY_ORCHESTRATION_DEVELOPMENT_GUIDE_2026-10-15.md)을 추가 구현합니다. 작업 `COMPLETED`나 기존 Book `FINALIZED`만으로 Shopify 상품의 기술 검수 통과를 판정하지 않습니다. 기존 검증 severity·파트너 응답 계약을 전역 변경하는 계획은 아닙니다.

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

## 검증 항목 한눈에 (실행 순서) — 2026-06-04 코드 기준 (2026-10-17 낱장·프로파일 규칙 반영)

> 코드: `apps/worker/src/services/pdf-validator.service.ts` `validate()`. **에러 ≥1 → `isValid=false`(차단)**, 경고는 통과·표시. `apps/worker/src/dto/validation-result.dto.ts` / `config/validation.config.ts`.

| # | 검증 항목 | 종류 | 코드 | 조건 / 임계값 | 적용 대상 | 자동수정 |
|---|---|---|---|---|---|---|
| 1 | 파일 크기 | 🔴에러(즉시중단) | `FILE_TOO_LARGE` | > **`WORKER_MAX_FILE_SIZE`**(실배포 2GB) | 전체 | ✕ |
| 2 | 파일 무결성 | 🔴에러(즉시중단) | `FILE_CORRUPTED` | PDF 로드 실패(손상) | 전체 | ✕ |
| 3 | 페이지수 초과 | 🔴에러 | `PAGE_COUNT_EXCEEDED` | > **1000p**(`DEFAULT_MAX_PAGES`) | 전체 | ✕ |
| 4 | 제본 규격(페이지수) | 🔴에러 | `PAGE_COUNT_INVALID` | 무선(perfect)·내지 4배수 아님 | 내지 | addBlankPages |
| 4b | 낱장 정확 쪽수(2026-10-17) | 🔴에러 | `PAGE_COUNT_INVALID` | `orderOptions.productKind='sheet'`: 실제 ≠ `pages`(정확 비교) · `pageStep>1` 이면 배수 위반도 — 이후 cover 1·2·4 규칙·content 제본 규칙·⑤ 미실행(§낱장 분류 검증) | cover·content 슬롯 무관 | ✕(`autoFixable=false`) |
| 5 | 주문 페이지수 일치 | 🟡경고 | `PAGE_COUNT_MISMATCH` | 실제 ≠ 주문 `pages` | 전체 | addBlankPages |
| 6 | 판형(사이즈) | 🔴에러 | `SIZE_MISMATCH` | 주문 `size`와 ±**1mm** 초과(재단 포함/불포함 모두 비교) — 기준값 규격은 하단 **§내지 판형 규격표(2026-07-14)** 참조. 내지는 MediaBox 불일치 시 명시 TrimBox 로 재판정(**§재단선 포함 PDF — TrimBox 기준 판형 판정(2026-09-30)**) | 전체 | fixMethod=resizeWithPadding — **실행기 미제공**. `WORKER_WIRED_FIXABLE_GATING=true` 시 autoFixable=false(기본 OFF=레거시 true) |
| 7 | 재단 여백(bleed) | 🟡경고 | `BLEED_MISSING` | 재단 여백 없음 | 전체 | fixMethod=extendBleed — **실행기 배선(2026-07-13)**: `POST /worker-jobs/fix-bleed`(하단 §도련 자동 삽입). 게이팅 ON/OFF 무관 autoFixable=true |
| 8 | 책등(spine) | 🔴에러 | `SPINE_SIZE_MISMATCH` | 표지 폭 **또는** 높이가 기대치와 허용오차(기본 ±**2mm**) 초과. 무선 등: 폭 `W×2 + spine + 날개×2 + bleed×2`, 높이 `H + bleed×2`. **양장(`hardcover`) = 싸바리 전개**: 폭 `(W+8)×2 + spine + 40`, 높이 `(H+8) + 40`(도련 별도 가산 없음). spine 은 `spineWidthMm`(서버 재계산값 포함) → `paperThickness`+`pages` 폴백 — 하단 **§표지 책등·전개 크기 검증(양장 싸바리 포함)** | **표지**(`coverLayout≠'separate'`) + spine 기대치 있을 때 | fixMethod=adjustSpine — **실행기 미제공**. 게이팅 ON 시 autoFixable=false(기본 OFF=레거시 true) |
| 8b | 책등 정보 미해석 | 🟡경고 | `SPINE_PARAMS_UNRESOLVED` | 무선·양장 표지인데 spine 기대치 없음 → 표지 크기 검사 **생략** 고지(비차단). `details.reason` = `UNMAPPED_PAPER`·`V1_FALLBACK`·`HARDCOVER_PAGE_RULE`·`NO_SPINE_PARAMS` | **표지**(`perfect`·`hardcover`, `coverLayout≠'separate'`) | ✕ |
| 9 | 가로형 페이지 | 🟡경고 | `LANDSCAPE_PAGE` | 가로 방향 페이지 감지 | 전체 | ✕ |
| 10 | 사철 제본 규격 | 🔴에러 | `SADDLE_STITCH_INVALID` | 사철(saddle)·4배수 아님 | 내지(saddle) | addBlankPages |
| 10b | 사철 중앙부 객체 | 🟡경고 | `CENTER_OBJECT_CHECK` | 중앙 걸침 객체 확인 필요 | 내지(saddle) | ✕ |
| 11 | 혼합/펼침면 감지 | 🟡경고 | `MIXED_PDF` | 표지+내지 다른 규격/스프레드 감지 | 전체 | ✕ |
| 12 | CMYK(후가공) | 🔴에러 | `POST_PROCESS_CMYK` | 후가공 파일에 CMYK — **`orderOptions.postProcessColorRule='spot-only'` 일 때만**(2026-10-17 v1.21, 미전송·`'any'` = 오류·경고 없음) | 후가공 | ✕ |
| 12b | CMYK(일반) | 🟡경고 | `CMYK_STRUCTURE_DETECTED` | 일반 파일 CMYK 감지 | 전체 | ✕ |
| 13 | 별색(Spot) | ⚪정보 | (코드 없음) | 감지 → metadata만 | 전체 | — |
| 14 | 투명도 | 🟡경고 | `TRANSPARENCY_DETECTED` | 투명 효과 포함 | 전체 | ✕ |
| 14b | 오버프린트 | 🟡경고 | `OVERPRINT_DETECTED` | 오버프린트 설정 포함 | 전체 | ✕ |
| 15 | 이미지 해상도 | 🟡경고 | `RESOLUTION_LOW` | 이미지 < **150 DPI**(권장 300) | 전체 | ✕ |
| 15b | 폰트 임베딩 | 🟡경고 | `FONT_NOT_EMBEDDED` | 미임베딩 폰트 ≥1(poppler `pdffonts` 우선, 실패 시 정규식 폴백) | 전체 | ✕ |
| 16 | 재단선 기하(TrimBox) | 🟡경고 | `TRIMBOX_MISSING` | PDF 에 TrimBox 미명시(재단 위치 기계 확정 불가) | crop-mark opt-in 셋 | ✕ |
| 16b | TrimBox 크기 | 🟡경고 | `TRIMBOX_SIZE_MISMATCH` | TrimBox ≠ 주문 재단 사이즈 ±tolerance | crop-mark opt-in 셋 | ✕ |
| 16c | TrimBox/Bleed 정합 | 🟡경고 | `TRIMBOX_BLEED_INCONSISTENT` | TrimBox⊄MediaBox 또는 BleedBox ≠ trim+bleed×2 | crop-mark opt-in 셋 | ✕ |

**조건부 실행**: ⑧책등=`fileType==='cover'` + `coverLayout≠'separate'` 일 때 — spine 기대치가 있으면 펼침 크기 검사(이때 ⑥판형·⑦재단 여백 검사는 생략), `perfect`·`hardcover` 인데 기대치가 없으면 ⑧b 경고만, 그 밖(중철·스프링 + `spineWidthMm`·`paperThickness` 모두 미전달)은 ⑥판형·⑦재단 여백 검사, ⑩사철=`binding==='saddle'`일 때만, ⑫후가공CMYK=`fileType==='post_process'`일 때만, ⑯재단선 기하=**templateSet `cropMarkEnabled` opt-in + 워커 env `WORKER_CROP_MARK_VALIDATION`(2026-07-06 프로덕션 ON) 이중 게이트**일 때만. **2026-10-17 추가(운영 반영)**: `orderOptions.productKind='sheet'` 면 ④·⑤와 cover 1·2·4 규칙 대신 ④b 정확 쪽수 검사만 수행한다(§낱장 분류 검증). `fileType='cover'` + `orderOptions.coverSpine='none'` 이면 binding 과 무관하게 ⑧·⑧b 를 생략하고 ⑥·⑦ 단일 판형·재단 여백 검사를 수행한다(§프로파일 세트(캘린더) 검증). ⑫후가공 CMYK 는 `postProcessColorRule='spot-only'` 일 때만 오류다.

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
    "wingWidthMm": 0,                             // ✅ (선택) 날개 한쪽 폭(mm) — 표지 총너비에 ×2 가산
    "productKind": "sheet",                       // ✅ (선택, 2026-10-17 v1.21) 'sheet' = 슬롯 무관 정확 쪽수 검사(§낱장 분류 검증). 'book'·미전송 = 종전
    "pageStep": 2,                                // ✅ (선택) 낱장 증감 단위 — productKind='sheet' 에서 >1 이면 배수 검사. 1 이하·미전송 = 배수 검사 없음
    "postProcessColorRule": "any",                // ✅ (선택) 'spot-only' 일 때만 후가공 파일 CMYK 를 POST_PROCESS_CMYK 오류로. 미전송·'any' = 오류 없음
    "coverSpine": "none"                          // ✅ (선택, v1.22 보강) cover 슬롯 책등 없음 → validateSpine 생략·단일 판형 검사(§프로파일 세트(캘린더) 검증). 미전송·그 외 값 = 종전
  },
  "callbackUrl": "..."
}
```

기대 스펙은 **프런트가 `orderOptions`에 실어 보냄**(서버가 주문에서 자동 도출하지 않음). 단, 편집 완료 세션의 검증 잡은 서버가 `productKind`·`pageStep`·`coverSpine` 과 프로파일 기대 쪽수를 파생해 싣는다(파트너 설정 불요 — 아래 두 절). DTO: api `apps/api/src/worker-jobs/dto/worker-job.dto.ts`, worker `apps/worker/src/dto/validation-result.dto.ts`.

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
- `orderOptions.coverSpine='none'`(2026-10-17 v1.22 보강, 운영 반영 2026-10-18) 표지도 이 절을 적용하지 않는다 — binding(`perfect`·`hardcover` 기본값 포함)과 무관하게 단일 판형·재단 여백 검사로 가고, `validateSpine`(`SPINE_SIZE_MISMATCH`·`SPINE_PARAMS_UNRESOLVED`·`metadata.spineSize`)과 서버 spine 주입(`injectServerSpine`, `worker-jobs.service.ts:950`)을 모두 생략한다. 편집 완료 세션은 템플릿셋에 `productProfile` 이 있을 때만 서버가 파생한다(§프로파일 세트(캘린더) 검증).
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

## 낱장 분류 검증 — `productKind='sheet'` (2026-10-17 운영 반영, CONTRACT_FREEZE v1.21)

> 코드: 워커 `apps/worker/src/services/pdf-validator.service.ts` `validatePageCount()` sheet 분기(`:1054` 부터 return 까지) · 후가공 색 규칙 `applyDetectionWarnings()`(`:439-453`, 경량 경로 `:2318-2321`) · DTO `apps/worker/src/dto/validation-result.dto.ts`(`productKind`·`pageStep`·`coverSpine`·`postProcessColorRule`). api 서버 파생 `apps/api/src/edit-sessions/sheet-validation-rules.ts` `deriveSheetValidationRules()`·`deriveLegacySheetRules()`(`:100-153`) · 주입 `edit-sessions.service.ts` `createValidationJobs`(`:2375-2394`) · 킬스위치 `apps/api/src/config/feature-flags.ts` `isEditorSheetValidationRulesOn()`(`:246-257`). 운영 배포 2026-10-17 04:30Z(master `19f1ce7c`, DEPLOYMENT 「낱장 N장 PDF · duplex-split 쪽수 원천 · 낱장 분류 검증 배포」). 설계: `docs/PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md` §6.2.

배경: 편집기 낱장 세션(단면 1·양면 2·N장)은 cover 슬롯 파일로 검증되는데, 종전 cover 규칙은 1·2·4쪽을 모두 통과시켜 단면 상품에 2쪽 PDF 가 들어와도 잡히지 않았다. 오너 분류(2026-10-17): 낱장은 파일 슬롯과 무관하게 **정확히 세션 기록 쪽수**여야 하고 빈 쪽 추가는 정답이 아니다(`autoFixable=false`).

### 워커 판정 (`orderOptions.productKind === 'sheet'`)

- `pages > 0` 이고 실제 쪽수 ≠ `pages` → 🔴 `PAGE_COUNT_INVALID`(`autoFixable=false`, `details={ expected, actual, productKind:'sheet' }`, 메시지 `낱장 상품은 정확히 N쪽이어야 합니다. (현재: M페이지)`).
- `pageStep > 1` 이고 실제 쪽수가 그 배수가 아니면 → 🔴 `PAGE_COUNT_INVALID`(`details={ expected: 올림배수, actual, pageStep }`). 두 조건은 독립이라 함께 날 수 있다.
- 그 뒤 즉시 return — cover 1·2·4 규칙, content 제본·데이터 주도 규칙(`pageMultiple` 등), ⑤ `PAGE_COUNT_MISMATCH` 경고는 실행하지 않는다. 글로벌 상한 ③ `PAGE_COUNT_EXCEEDED`(1000p)는 이 분기 앞에서 그대로 적용된다.
- `productKind` 미전송·`'book'` = 종전 경로 byte-identical. 사철 ⑩은 `fileType!=='cover'` 에만 돌므로 낱장 cover 잡과 무관.

### 서버 파생 (편집 완료 세션 — 파트너 설정 불요)

`deriveLegacySheetRules()` 가 **모두** 만족할 때만 cover·content 두 검증 잡의 `orderOptions` 에 `productKind:'sheet'`(+`pageStep`)을 싣는다:

- 세션 `mode` 가 SPREAD 아님 · `metadata.spread` 없음 · 내지 펼침면 레이아웃(`resolveInnerSpreadContentSizeMm().kind`) 이 `'none'`
- 템플릿셋 `editorMode === 'single'`
- 템플릿 타입 목록 조회 성공(실패 = null → 레거시)이고 `spine`·`wing`·`spread` 가 없음 · 비어 있지 않음 · 전부 `cover` 가 아님(표지 전용 single 세트 = 책 표지 편집이지 낱장이 아님 — 2026-10-17 운영 실측 보완)
- `pageStep` = 세션 `metadata.orderOptions.pageStep`(호스트 주문값) → 템플릿셋 `pageStep` 순, 정수 >1 일 때만 키 존재

`pages` 는 세션 기록 쪽수(종전과 같음, `resolveSessionPageCount`). 프로파일 세트는 아래 절처럼 `expectedPages` 로 덮어쓴다. 로그 `[validation-jobs] session <id> 낱장 분류 규칙: productKind=sheet pageStep=<값|-> pages=<기대>` — 낱장이 아니면 줄 없음. 2026-10-06 N-API-3b 가 content 잡에 `pageMultiple` 을 실어도 워커 sheet 분기가 먼저 return 하므로 공존 무해.

### 후가공 파일 색 규칙 `postProcessColorRule`

- `fileType='post_process'` + CMYK 감지 시 종전에는 무조건 🔴 `POST_PROCESS_CMYK` 였다. 2026-10-17 부터 **`orderOptions.postProcessColorRule === 'spot-only'` 일 때만** 오류이고, 미전송·`'any'` 면 오류도 경고도 없다 — 후가공 파일은 편집기 산출물이 아니라 고객 업로드·관리자 작업 파일이며 선·라운드·면적·투명 객체가 정상 입력이다(설계안 §6.2 오너 정정). 일반 파일의 `CMYK_STRUCTURE_DETECTED` 경고 경로는 무접촉. 근거: 운영 `post_process` 잡 0건(2026-10-17 04:06Z 실측).

### 킬스위치 `EDITOR_SHEET_VALIDATION_RULES` (api)

- 기본 ON. 앞뒤 공백·대소문자를 무시하고 `off` 일 때만 OFF(`isEditorSheetValidationRulesOnRaw`), 호출 시점마다 env 를 읽는다. OFF 면 서버가 `productKind`·`pageStep`·`coverSpine`·프로파일 `expectedPages` 덮어쓰기를 모두 싣지 않아 종전 cover 1·2·4 규칙으로 돌아간다(워커 분기는 키가 없으면 자동 비활성).
- docker-compose api 매핑 `${EDITOR_SHEET_VALIDATION_RULES:-on}`, `[FLAGS] api` 줄 15번째 키(운영 `FLAGS_EXPECTED_API` 에 `EDITOR_SHEET_VALIDATION_RULES=true`). 끄기: `.env` `EDITOR_SHEET_VALIDATION_RULES=off` → `docker compose up -d api` → nginx 재시작.
- 배포 시 운영 실측(2026-10-17 04:06Z): single 세트 세션 90일 0건 · duplex-split 세트 0 · post_process 잡 0 → 영향 세션 없음.

---

## 프로파일 세트(캘린더) 검증 — 기대 쪽수 권위·`coverSpine='none'`·완료 PDF 경고 0 (2026-10-18 운영 반영, CONTRACT_FREEZE v1.22)

> 코드: api `sheet-validation-rules.ts` `resolveSessionProductProfile()`(`:77-98`)·`deriveSheetValidationRules()`(`:100-129`) · 잡 생성 `edit-sessions.service.ts:2375-2394` · spine 주입 생략 `apps/api/src/worker-jobs/worker-jobs.service.ts` `injectServerSpine()`(`:950`) / 워커 `pdf-validator.service.ts` 게이트 `coverSpineAuthoritative`(`:202-207`, 경량 경로 `:834-839`) · `validateBleed` 게이트(`:244`, `:875`) · `validateSpine` 게이트(`:252-257`, `:879-884`) · `isCoverSpineNone()`(`:1738`). 운영 반영: master `af900212`(2026-10-18 00:48 KST, DEPLOYMENT 「P1 캘린더 운영 반영 절차」). 결정·실측 근거: 비공개 노트 `_private_notes/wave12/P1_CALENDAR_DECISIONS_2026-10-17.md`, 등록 규칙 `docs/템플릿등록 매뉴얼.md` 부록 D.

템플릿셋 `productProfile`(JSON, NULL 기본 — 기존 세트 전부 NULL)이 있는 세트는 위 낱장 판정이 선 경우에 한해 두 가지를 더 싣는다. 프로파일 NULL 세트는 잡 `orderOptions` 가 바이트 동일하다.

### 1) 기대 쪽수 권위 = 템플릿셋 프로파일 `pages.count`

- `resolveSessionProductProfile()`: **템플릿셋 `productProfile` 이 권위**(관리자 선언). 세션 스냅샷 `metadata.productProfile` 은 클라이언트가 쓰는 자유형 metadata 라 기대 쪽수의 근거로 쓰지 않고, 템플릿셋에 프로파일이 없을 때만(세트 변경·삭제 뒤 재합성) 쓴다. 둘 다 있고 `editorType` 이 다르면 경고 1줄 뒤 템플릿셋 값.
- `pages.kind='fixed'` 이면 `expectedPages = pages.count`(캘린더 26 = 표지 1 + 12개월×2면 + 에필로그 1) → 호출부가 cover·content 두 잡의 **`orderOptions.pages` 를 그 값으로 덮어쓴다**(워커 DTO 에 새 키 없음, 로그 끝 `(pages 출처: productProfile pages.count)`). `pageStep` = `sheet.faces===2` 면 2, 아니면 `pages.step`(>1), 아니면 종전 산출.
- 낱장 판정 자체는 프로파일과 무관하다 — `kind='calendar'` 인데 낱장 판정이 null 이면 warn 1줄 + 종전 규칙(프로파일 미적용).
- 결과: 캘린더 완료 PDF(26쪽 단일, cover 슬롯)는 `productKind='sheet'`·`pages 26`·`pageStep 2` 로 정확 비교된다(매뉴얼 부록 D-6). 호스트 `pageCount` 는 무시된다(프로파일 고정 26).

### 2) `orderOptions.coverSpine='none'` — cover 슬롯 책등 없음 (v1.22 보강)

- 프로파일이 non-null 인 세트에서만 서버가 cover·content 잡 options 에 `coverSpine:'none'` 을 싣는다(`sheet-validation-rules.ts:127`). 파트너 직접 전송도 허용되나 현재 0건.
- 워커(`fileType==='cover'` 일 때만 의미, content 에 실려 와도 무영향):
  - `coverSpineAuthoritative` 게이트가 binding(`perfect`·`hardcover` 기본값 포함)·spine 기대치와 무관하게 false → **`validatePageSize`(⑥ 단일 판형, 내지 TrimBox 재판정 포함)·`validateBleed`(⑦)를 수행**한다.
  - **`validateSpine` 생략** → `SPINE_SIZE_MISMATCH`·`SPINE_PARAMS_UNRESOLVED`·`metadata.spineSize` 가 나오지 않는다.
  - 경량 검증(`WORKER_LIGHTWEIGHT_VALIDATION=true`) 경로도 같은 게이트.
- api `injectServerSpine()` 도 `coverSpine==='none'` 이면 early return — `spineWidthMm` 재계산·덮어쓰기·`spineUnresolvedReason` 기록 없음.
- 미전송·무효값(`'none'` 외) = 종전 binding 기준 경로 byte-identical(CONTRACT_FREEZE v1.22 보강 행).

### 3) 캘린더 완료 PDF 경고 0 조건 (2026-10-17 로컬 실측 → 2026-10-18 운영 반영)

종전(2026-10-17 17:45 KST 로컬 실측, `a98d0219` 기준) 캘린더 26쪽 PDF 는 `isValid:true` 로 통과했지만 경고 3종이 붙었고, `coverSpine='none'` 적용 뒤에는 `validateBleed` 가 실행되면서 `BLEED_MISSING` 1건이 새로 나타났다(19:28 KST 실측). 원인과 해소(커밋 `af900212`):

| 경고 | 종전 원인 | 해소 |
|---|---|---|
| `SPINE_PARAMS_UNRESOLVED` | cover 슬롯 잡 1개 + `binding` 기본 `'perfect'` → `isCoverSpreadBinding` 게이트 → `validatePageSize`/`validateBleed` 스킵 + `validateSpine` 기대치 없음 → 경고(낱장 cover 슬롯의 기존 공백) | `coverSpine='none'`(위 2) — spine 게이트 우회, `validateSpine` 생략 |
| `TRANSPARENCY_DETECTED` | (a) 편집기 워크스페이스 `fill:'transparent'` → svg2pdf `/ca 0`(공통 경로, NULL 세트도 동일) (b) 폰트 라이브러리에 템플릿 폰트가 없어 텍스트가 래스터 폴백 → 알파 PNG `/SMask`(307건), 캘린더 그리드 bounds rect `fill:'transparent'` 도 `/ca 0` 원천 | canvas-core `PdfExportOptions{omitUnusedFonts, excludeWorkspaceFromExport, neutralizeTransparentFills}` — 편집기가 **프로파일 세트 완료 PDF 에만** 전달(`resolveProfilePdfExportOptions`; NULL 세트는 종전 positional 호출·바이트 동일), CalendarPlugin 그리드 경계 `fill:''`. 운영 폰트 라이브러리에 템플릿 폰트(`본고딕(Noto Sans) Regular`)가 있어야 텍스트가 벡터화된다 — 없으면 래스터 폴백으로 다시 `TRANSPARENCY_DETECTED` |
| `FONT_NOT_EMBEDDED` | jsPDF 표준 14폰트 리소스 선언·미사용(BT/Tf 0건) | jsPDF `putOnlyUsedFonts`(위 `omitUnusedFonts`) → `pdffonts` 빈 목록 |
| `BLEED_MISSING` | 편집기 PDF 에 도련이 붙는 유일한 경로가 템플릿셋 cropMark 게이트(ON: trim+`bleedMm`×2·TrimBox/BleedBox/마커, OFF: trim·박스 없음)인데 캘린더 세트는 OFF → 재단 크기 PDF → `hasBleed=false`. 호스트는 `/embed` 로 bleed 를 보낼 수 없고 api 는 `bleed: metadata.bleed ?? 3` → 항상 3 | **도련 정책 A**(오너 결정 2026-10-17; B 판형=재단+도련, C 프로파일 `bleed:0` 은 기각): 판형은 재단(달력 면) 그대로, 세트 `cropMarkEnabled=true`·`bleedMm=3` → 완료 PDF 가 재단+6mm·TrimBox 3mm 안쪽·코너 마커(책자와 같은 게이트) → 워커 `validatePageSize` 가 재단+도련×2(작업사이즈)로 매칭해 `metadata.hasBleed=true`·`bleedSize=3`. 코드 무변경(세트 값만) — 등록 스크립트·admin 캘린더 프리셋·매뉴얼 부록 D-2 에 반영 |

- 워커 투명도 검출의 성격(`apps/worker/src/utils/ghostscript.ts` `detectTransparencyAndOverprint()` `:905-995`; 경량 경로 `streaming-pdf-scan.ts` `finalizeTransparency()` 도 같음): **파일 전체 바이트를 latin1 문자열로 정규식 스캔**(`/ca`·`/CA` < 0.999, `/SMask`(None 제외), `/BM`(Normal 제외)) 첫 히트에서 판정하고, `details.pages` 는 **`[{ page: 1, … }]` 로 고정**(`:973` "단순화: 전체 PDF 기준")이다 — 경고 문구의 "1쪽" 은 실제 위치가 아니라 산출물이며 쪽별 위치 정보가 아니다.
- 재실측(2026-10-17 20:28 KST, 결정 A 적용, 탁상 라지 265×190): 완료 PDF 26쪽 768.19×555.59pt(271×196mm)·TrimBox 3mm 안쪽·BleedBox=MediaBox, `pdffonts` 0, `/ca`·`/CA`·`/SMask`·`/BM` 0 → 워커 `isValid:true, warnings:[]`, `metadata.hasBleed true`·`bleedSize 3`·`fontCount 0`·`hasTransparency false`. 임포지션 변환 잡은 `contentPdfFileId` 게이트(고객 업로드 내지 전용)라 미발행 — VALIDATE 1건만. 완료 PDF 생성은 벡터화로 약 25~35초(래스터 폴백 때 11초).
- 운영 상태: `af900212` 반영 완료(api `1f175ce9a99b`·worker `df1f28f153ac`, `[FLAGS-CHECK] api ok n=15`). **운영 샘플 세트 7종 등록은 미실행(오너 보류)** — 운영 템플릿셋에 프로파일 non-null 행 0 이므로 이 절의 경로를 타는 운영 세션은 아직 없다. 운영 폰트 라이브러리의 `본고딕(Noto Sans) Regular` 존재 여부는 등록 뒤 확인 항목.

---

## 사진인화(photo-print) 세트 검증 — cover 슬롯 규칙 재사용·검증 잡 `bleed` 기본값 0 (2026-10-20, 브랜치 `p1-calendar-2026-10-17` 전용 — master 미병합·운영 미반영·미커밋, CONTRACT_FREEZE v1.25)

> 코드(브랜치 HEAD `9be4c37c` 위 미커밋 작업 트리): 프로파일 정본 `packages/types/src/product-profile.ts` `validatePhotoPrintBlock()`(`:545`, pages 결합 `:617-626`·process 결합 `:628-651`) · api `apps/api/src/edit-sessions/sheet-validation-rules.ts` `deriveSheetValidationRules()`(`:101-130` — `expectedPages` `:114-115`, `pageStep` `:116-121`, `coverSpine:'none'` `:128`) · 잡 생성 `edit-sessions.service.ts` `resolveDefaultBleedMm()`(`:150-157`)·`orderOptions.bleed` 주입(`:2384`)·낱장 규칙 주입(`:2544-2561`) · admin 프리셋 `apps/admin/src/pages/TemplateSets/photoPrintProfilePresets.ts` `photoPrintPresetFormValues()`(`:154-171`, `cropMarkEnabled`/`bleedMm` `:169-170`) · 편집기 완료 PDF `apps/editor/src/embed.tsx`(재단선 게이트 `:2757-2764`, 전 캔버스 선택 `:2942`, export 옵션 `:2957`) · canvas-core `packages/canvas-core/src/plugins/pdfPageGeometry.ts`(`:76-85`)·`ServicePlugin.ts`(TrimBox/BleedBox `:1419-1503`) · 워커 `pdf-validator.service.ts` `validatePageSize()`(`:1229`, `bleed` `:1238`, `hasBleed` `:1290-1291`)·`validateBleed()`(`:1315-1317`) — **워커 코드 무변경**. 테스트: `sheet-validation-rules.spec.ts` '사진인화 프로파일'(`:289-365`) · `edit-sessions.service.spec.ts` 'createValidationJobs — D9 도련 기본값'(`:2312-2414`) · 워커 `pdf-validator.service.spec.ts` "coverSpine='none'"(`:1145` 부터). 계약: CONTRACT_FREEZE v1.25 §1-D 「검증 잡 `orderOptions.bleed`」 행. 프리셋 수치(판형 4x6 102×152·card 90×54, chemical 도련 0, 업로드 한도 등)는 **오너 확정 전 기본값**(프리셋 파일 머리말 주석).

> ⚠️ 이 절의 동작은 커밋되지 않은 작업 트리에만 있고 **운영 워커·api 는 `af900212`** 다. 운영 템플릿셋에 프로파일 non-null 행이 0(2026-10-18 실측, 위 절)이고 사진인화 세트도 없으므로 운영 세션에 영향 없음. 마이그레이션·새 env·`[FLAGS]` 키 없음. 운영 샘플 세트 등록·배포는 오너 승인 후.

사진인화 세트(템플릿셋 `productProfile.kind='photo-print'`, `photoPrint.process` chemical=인화·digital=인쇄 ①②③)는 캘린더와 같은 낱장·프로파일 검증 경로를 그대로 탄다. 검증 규칙(워커·`deriveSheetValidationRules`)은 바꾸지 않았고, 더한 것은 **검증 잡 `orderOptions.bleed` 기본값**(아래 3) 하나다.

### 1) cover 슬롯 잡 `orderOptions` (낱장 판정이 선 경우 — single 세트·spine/wing/spread 없음)

- `productKind:'sheet'`·`coverSpine:'none'` — 캘린더와 동일(`sheet-validation-rules.ts:123-129`). 워커는 cover 1·2·4 규칙·`validateSpine` 을 건너뛰고 ④b 정확 쪽수 + ⑥ 단일 판형 + ⑦ 재단 여백 검사를 한다(§프로파일 세트(캘린더) 검증 2). 단일 PDF 는 cover 슬롯 잡으로 검증된다(아래 4) 실측 잡의 `coverSpine 'none'`).
- `pages` = 세션 기록 쪽수(`resolveSessionPageCount` = 캔버스 수). photo-print 프로파일은 `pages.kind='range'` 만 허용하고 `fixed`·`protectedIndices` 는 거부되므로(`product-profile.ts:620-625`) 캘린더의 `expectedPages` 덮어쓰기(`pages.count`)는 일어나지 않는다(`sheet-validation-rules.ts:114-115`).
- `pageStep` — chemical(`sheet.faces 1`, 캔버스 1장 = 사진 1장): 키 없음(프로파일 `pages.step 1`·템플릿셋 `pageStep 1` → `stepOver1` 미충족). digital(`faces 2`, 캔버스 [앞, 뒤] 쌍 = 사진 1장): **2** — `faces===2` 가 호스트 `metadata.orderOptions.pageStep` 보다 우선(`sheet-validation-rules.ts:116-121`, spec (h-2)). 홀수 쪽 PDF 는 ④b `PAGE_COUNT_INVALID`. 프로파일 정본도 digital 은 `pages.step 2`·`min/max` 짝수를 강제한다(`product-profile.ts:647-651`).
- `size` = 세션 `metadata.size` → 템플릿셋 판형(프리셋 4x6 102×152 / card 90×54)·`binding` 기본 `'perfect'`·방향 정규화·`expectedOrientation` 은 종전 그대로.

### 2) 완료 PDF 기하 (편집기 — 코드 무변경, 프리셋 값만)

단일 모드 전 캔버스를 한 PDF 로 낸다(`selectSingleModePdfCanvases`, `embed.tsx:2942`): chemical N쪽(사진 N장), digital 2N쪽(앞·뒤 교대, 사진 N장).

| 프리셋 | 템플릿셋 `cropMarkEnabled` / `bleedMm` | 완료 PDF 페이지 | 워커 판형 매칭 |
|---|---|---|---|
| `photo_chem`(chemical) | `false` / `0` | 재단 크기(102×152), TrimBox·BleedBox·마커 없음(`pdfPageGeometry.ts:76` `useEditSize=false`) | `validatePageSize` 재단 크기 매칭. ⑯ TrimBox 검사는 opt-in 세트가 아니라 미실행 |
| `photo_digital_*`(digital ①②③) | `true` / `3`(캘린더 정책 A 준용) | 재단+6mm(4x6 → 108×158, card → 96×60)·TrimBox 사방 3mm 안쪽·BleedBox=MediaBox·코너 마커(책자·캘린더와 같은 게이트, `pdfPageGeometry.ts:76-85`·`ServicePlugin.ts:1419-1503`) | api 가 cropMark 게이트로 `bleedMm 3`·`cropMarkEnabled`·`trimSize`·`workSize` 를 주입 → 작업사이즈 매칭·`hasBleed true`·`bleedSize 3`, ⑯ TrimBox 검사 수행 |

- 프로파일 세트 export 옵션 3종(`omitUnusedFonts`·`excludeWorkspaceFromExport`·`neutralizeTransparentFills`)은 `resolveProfilePdfExportOptions` 가 프로파일 non-null 이면 kind 와 무관하게 켠다(`apps/editor/src/utils/productProfile.ts:140-145`) — 캘린더 경고 0 조건(위 절 3) 표)이 그대로 적용된다.
- 사진은 래스터 이미지로 들어간다(아래 4) 실측 `resolution 299`). 흑백(Grayscale 필터)·유테·이미지풀을 적용한 사진을 포함한 chemical 완료 PDF 가 `hasTransparency false`·`unembeddedFonts 0` 이었다(아래 4)). 촬영일 텍스트(`date-overlay`)는 샘플 템플릿 폰트 `본고딕(Noto Sans) Regular`(`scripts/register-photo-print-samples.mjs:51`)라 캘린더와 같이 폰트 라이브러리에 그 폰트가 있어야 벡터화된다 — 없으면 래스터 폴백으로 `TRANSPARENCY_DETECTED`(위 절 3) 표의 (b)).

### 3) 검증 잡 `orderOptions.bleed` 기본값 — `resolveDefaultBleedMm()` (D9, 신규)

종전 `bleed: session.metadata?.bleed ?? 3`(항상 3)이 chemical 완료 PDF(재단 크기, 도련 없음)에 `BLEED_MISSING(expected 3, actual 0)` 경고를 붙였다(2026-10-19 로컬 실측, 아래 4). 세션 `metadata.bleed` 명시값은 종전처럼 우선하고(`??`), 없을 때만 `resolveDefaultBleedMm(session, templateSet)`(`edit-sessions.service.ts:150-157`, 주입 `:2384`):

| 템플릿셋 | `bleed` |
|---|---|
| 템플릿셋 없음(`templateSetId` 없음·조회 실패) | 3(종전) |
| `cropMarkEnabled===true` 이고 `bleedMm≠0` — 정책 A 세트(캘린더·digital 프리셋) | 3(종전; `bleedMm`·`trimSize`·`workSize` 주입도 종전 게이트 그대로) |
| 그 밖(`cropMarkEnabled` false 또는 `bleedMm 0`)이고 프로파일 non-null(`resolveSessionProductProfile` — 템플릿셋 → 세션 스냅샷) | **0** |
| 그 밖이고 프로파일 NULL·무효(`version 99` 등) | 3(종전 — 현행 전 세트 바이트 동일) |

- 워커 영향: `bleed 0` 이면 `validatePageSize` 에서 재단+0 = 재단 크기가 "도련 포함 크기" 로도 일치해 `metadata.hasBleed=true`·`bleedSize 0`(`pdf-validator.service.ts:1290-1291`)이고, `validateBleed` 는 `expectedBleed > 0` 이 아니라 `BLEED_MISSING` 을 내지 않는다(`:1315-1317`). 두 가드 모두 종전 코드(도련 0 상품 — R2 — 과 같은 경로).
- `bleed` 기본값은 `orderOptions` 생성 시점에 정해져 킬스위치 `EDITOR_SHEET_VALIDATION_RULES` 와 무관하다(`:2384` 가 `:2544` 낱장 규칙 주입 블록 밖·앞). `resolveDefaultBleedMm` 은 편집 완료 세션 경로(`createValidationJobs`)에서만 쓰이며 파트너 직접 `validate(/external)` 호출은 영향 없음.
- 단위 테스트(`edit-sessions.service.spec.ts:2312-2414`): chemical(`cropMarkEnabled false`·`bleedMm 0`) → 0 · `cropMarkEnabled true`·`bleedMm 0` → 0 · `metadata.bleed 2` 명시 → 2 · digital(정책 A) → 3 + `bleedMm 3`·`cropMarkEnabled true` 주입 · 프로파일 NULL·템플릿셋 없음·조회 실패·무효 프로파일 → 3.

### 4) 로컬 실측 (2026-10-19, `photo_chem` 세트 — D9 수정 전 코드)

- 3캔버스(사진 3장, 사진 2 = 매수 3·유테·이미지풀·흑백·촬영일) 편집 완료 → `files/upload` 201·`PATCH …/complete` 200·`metadata.items` 3건(완전형 12필드).
- 검증 잡(cover 슬롯): `COMPLETED`·`isValid true`·`errors 0`·`pageCount 3`·`orderOptions { size 102×152, pages 3, binding perfect, bleed 3, productKind 'sheet', coverSpine 'none' }`(`pageStep` 없음)·`hasTransparency false`·`unembeddedFonts 0`·`resolution 299`. 경고 **`BLEED_MISSING` 1건**(expected 3·actual 0) — 위 3) 원인.
- D9 수정 후 **기대**: 같은 세션 `orderOptions.bleed 0` → `isValid true, warnings: []`·`hasBleed true`·`bleedSize 0`. **수정 후 재실측(2026-10-20 14:00 KST)**: digital ①(`photo_digital_items`, 정책 A, 4캔버스) 완료 검증 잡 `ae35895d` → `isValid true, warnings: []`. chemical 경고 0·digital ②③ 완료·홀수 쪽 거부는 아직 미재실측(위 기대값 유지).

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

## 합성 잡 — 워커 파일 메타 조회·duplex-split 회차 키·`sheet-map` 모드 (2026-10-18~19, 브랜치 `p1-calendar-2026-10-17` 전용 — master 미병합·운영 미반영)

> 코드(브랜치 `9be4c37c`): 워커 `apps/worker/src/processors/synthesis.processor.ts` — `FileRecord`(`:136-146`)·mode 분기(`:184-205`)·`handleSheetMapSynthesis()`(`:1812-2098`)·`getFileById()`(`:2210-2225`) · 입력 검증 `apps/worker/src/processors/sheet-map-input.ts` `assertSheetMapJobInput()`(`:37-110`) / api `apps/api/src/edit-sessions/edit-sessions.service.ts` — request_id 헬퍼(`:143-157`)·완료 회차 +1(`:1595-1596`)·`applyPdfOutputMode()` sheet-map 분기(`:1817-1849`)·duplex-split 분기(`:1853-1886`)·파트너 v1 재합성 `requestDuplexSplitResynthesis()`(`:1950-1976`)·`requestSheetMapResynthesis()`(`:1980-2032`)·`prepareResynthesis()`(`:2037-2064`) · 시트 맵 `edit-sessions/sheet-map.ts` `buildSheetMap()`·`assertSheetMapCoversPages()` · 잡 생성 `worker-jobs/worker-jobs.service.ts` `createSheetMapJob()`(`:2926-3066`) · 킬스위치 `config/feature-flags.ts` `isSheetMapOutputEnabled()`(`:281-291`). 계약: CONTRACT_FREEZE v1.23(§1-B `GET /files/:id/external` 행, §1-D 런처 3라우트·웹훅 `revision`)·v1.24(§1-B `sheet-map` 행). 배포 절차(준비·미실행): DEPLOYMENT 「P2-b 런처(파트너 v1 `sessions`)·합성 파일 메타 조회 배포 절차」「P2-c 시트 맵 출력(worker `sheet-map` 모드) 배포 절차」. 계획·결함 기록: `docs/P2_PRODUCT_MODE_PLAN_2026-10-18.md` §1·§7.

> ⚠️ 이 절의 동작은 커밋 `f43cb99e`(P2-a/b)·`9be4c37c`(P2-c)에만 있고 **운영 워커·api 는 `af900212`** 다. 운영 반영 전까지 운영의 합성 잡은 종전 동작(합성 입력 오류·재시도 규칙 등 CONTRACT_FREEZE v1.10/v1.11)을 따른다.

### 운영 실측 (2026-10-18, 읽기 전용)

- 운영 `SYNTHESIZE` 잡 **12건 전부 `options.mode` NULL**(merge 경로) — `split`·`duplex-split`·`spread` 분기는 운영에서 한 번도 실행되지 않았다. 따라서 아래 결함 2건은 운영에 노출된 적이 없다(CONTRACT_FREEZE v1.23 §1-B 행·P2 계획 §7).
- 운영 템플릿셋 `pdf_output_mode` 는 `duplex-merged` 50건뿐 — **`duplex-split` 세트 0건·세션 0건**(2026-10-18 03:40 KST). 프로파일 `output.mode='sheet-map'` 세트도 아직 없다. 배포 직후 새로 생기는 잡·웹훅은 없고, duplex-split·sheet-map 세트를 만들기 시작하면 완료마다 `synthesis.*` 웹훅이 처음 나간다(파트너 통지 항목).

### 1) 워커 파일 메타 조회 — `GET /files/:id/external` + `api://<fileId>` 다운로드 (P2-b, 결함 수정)

- 종전: `split`·`duplex-split`·`spread` 핸들러의 `getFileById()` 가 **JWT 전용 `GET /files/:id`** 를 `X-API-Key` 로 호출 → 항상 401 → 잡이 `INTERNAL_ERROR` 로 실패하는 결함(운영 미실행이라 미노출). 응답의 `filePath` 를 직접 열었다.
- 현재(`f43cb99e`): 메타는 `GET /files/:id/external`(`@Public`+`ApiKeyGuard`, 사이트 대조는 `download/external` 과 동일 — 타 사이트 404·NULL 레거시 허용·워커 role 바이패스, 응답 shape 는 기존 `GET /files/:id` DTO)로 읽고, 워커가 쓰는 필드는 `id`·`metadata.generatedBy`·`metadata.editSessionId` 뿐이다(`FileRecord`). 바이트는 **항상 `api://<fileId>`**(`GET /files/:id/download/external` 스트리밍, local/s3 라우팅은 API 담당 — SEC-008 로 DTO 에 `filePath` 없음)로 받는다. 404 → `FILE_NOT_FOUND`(비재시도), 조회 타임아웃 30초.
- 편집기 산출물 검증(`generatedBy==='editor'` 아니면 `PDF_NOT_FROM_EDITOR`, `editSessionId===sessionId` 아니면 `SESSION_FILE_MISMATCH`)은 세 분기와 `sheet-map` 이 동일 계약.

### 2) 편집 완료 자동 `duplex-split` 잡 — request_id 회차 키 (P2-b, 결함 수정)

- 종전: `applyPdfOutputMode()` 가 `duplex-split-<세션uuid>-<파일uuid>`(86자)를 `worker_jobs.request_id VARCHAR(36)` 에 넣어 strict 모드에서 "Data too long" → 잡 생성이 조용히 실패(완료는 유지, best-effort 경로). 즉 편집기 세션에서 duplex-split 잡은 만들어진 적이 없다(v1.21 기대 쪽수 수정과 별개의 두 번째 원인).
- 현재: 편집 완료 `complete()` 가 세션 `metadata.revision` 을 **완료할 때마다 +1**(`nextSessionRevision`; 런처 세션은 launch 시 0 시작) 한 뒤 그 회차로 `duplex-split-r<revision>`(`duplexSplitRevisionRequestId`, ≤36자)을 쓴다. 멱등 유일성은 UNIQUE `(session_id, pdf_file_id, request_id)` — 재완료 = 새 회차 잡. 고정 태그는 FAILED 잡에도 멱등 히트해 재완료로 복구할 수 없어 보안 리뷰(2026-10-18 #6)로 회차 키를 채택했다(상수 `DUPLEX_SPLIT_AUTO_REQUEST_ID='duplex-split'` 은 export 만 남고 완료 경로는 쓰지 않는다 — CONTRACT_FREEZE v1.23 §1-B 행의 '고정 태그' 서술은 그 전 상태). 잡 `siteId` = 세션 사이트(검증 잡과 같은 규칙).
- 홀수 쪽수면 잡 미생성·완료 유지(v1.21 `resolveSessionPageCount`). `metadata.launch`·`revision`·`production` 은 서버 소유 키 — 편집기·호스트 PATCH 가 보내도 무시(`SESSION_METADATA_SERVER_OWNED_KEYS`).

### 3) 파트너 v1 재합성 — `POST /api/v1/sessions/:id/synthesize` (P2-b/c)

- 사이트 editor 키 전용(워커 키 403). 세션이 그 사이트·env 가 아니면 404(존재 은닉). 편집 완료 전·`coverFileId` 없음 → 409 `ERR_SESSION_NOT_COMPLETE`. 최신 합성 잡이 PENDING/PROCESSING 이면 새 잡 없이 그 `jobId`·현재 `revision` 반환.
- `prepareResynthesis()` 가 `metadata.revision` 을 +1 저장한 뒤 그 회차로 잡을 만든다(잡 생성이 실패해도 회차는 올라가 있음 — 잡 없는 회차 허용). 템플릿셋 프로파일 `output.mode==='sheet-map'` → `sheet-map-r<revision>` sheet-map 잡, `pdfOutputMode='duplex-split'` → `duplex-split-r<revision>` duplex-split 잡, 그 밖 → 422 `ERR_OUTPUT_MODE_UNSUPPORTED`. 두 모드는 같은 회차 카운터·다른 접두사라 `(session_id, pdf_file_id, request_id)` 멱등 인덱스에서 충돌하지 않는다.
- 응답 `{jobId, revision}`. 이 잡의 `synthesis.completed`·`synthesis.failed` 웹훅 본문에만 선택 키 `revision` 이 있다(그 밖의 합성 잡 — 편집 완료 자동 합성 포함 — 은 키 자체 없음). deliverables `revision`·`sheets?`(sheet-map 잡일 때만)·`files[].copies?/label?` 과 대조용.

### 4) 워커 합성 mode `sheet-map` (P2-c)

잡 options `{ mode:'sheet-map', totalExpectedPages, sheets: SheetSpec[], output:'per-sheet'|'merged-duplex', duplexFlip:'short-edge'|'long-edge', revision? }`. 시트 맵(`SheetSpec { index, front:{page, rotate?:0|180}, back:{…}|null, role?:'post-process', copies?, label? }`)은 **api 가 단독 권위**로 만들고(`buildSheetMap(profile, pageCount)` — same-sheet·offset-next·canvas-per-sheet, `protectedIndices` 선행/후행 단면, `center-punch` 는 same-sheet 만), 워커는 매핑을 그대로 따르며 불변식만 재검증한다. 편집기·세션 metadata 가 보낸 시트 값은 쓰지 않는다.

처리 순서(duplex-split 과 공통 머신 — 상태 전이·temp·파일 조회·`WORKER_LIGHTWEIGHT_SYNTHESIS` ON/OFF 다운로드·쪽수 검증·실패 정리):

1. **입력 검증(다운로드 전, 비재시도)** `assertSheetMapJobInput`: `sheets` 비어 있음 / `output`·`duplexFlip` 허용값 밖 / `rotate` 가 0·180 밖 → `INVALID_OUTPUT_OPTIONS`; `index` ≠ 순번 / `page` 범위 밖·중복 / `back` 이 면 참조도 `null` 도 아님 / 참조 페이지 합 ≠ `totalExpectedPages` → `PAGE_COUNT_MISMATCH`. 둘 다 `synthesis-retry` 의 비재시도 입력 오류(첫 시도에 `FAILED`, v1.10/v1.11 규칙 — 새 코드 없음).
2. 파일 메타 조회·편집기 산출물·세션 일치 검증(위 1) → `api://` 다운로드 → 실제 쪽수 ≠ `totalExpectedPages` 면 `PAGE_COUNT_MISMATCH`(`details={ expected, got }`).
3. 시트 루프 — 면 추출·회전: `rotate=180` 면은 추출본 페이지의 `/Rotate` 에 **상대 +180**(ON: qpdf `--rotate=+180:<면>`, OFF: pdf-lib `setRotation(현재+180)`; 두 경로 골든 동일). 운영 기본은 `backRotation 0`·`duplexFlip 'short-edge'`(오너 결정 §13-2) — 180 은 코드 경로·골든만.
   - `per-sheet`: 시트마다 `set_<index>.pdf`(1~2쪽, `OutputFile.type:'set'`, `setIndex = sheet.index`).
   - `merged-duplex`: 인쇄 시트(`role` 없음)를 `[front, back]` 순으로 한 파일 `sheets_duplex.pdf`(`type:'pages'`, `outputFiles[0]`·`outputFileUrl`)에 합친다. **`back` 이 없는 시트는 front 와 같은 MediaBox 의 빈 면을 삽입**해 양면 정렬을 유지한다(합본 쪽수 = 인쇄 시트 수 × 2, 불일치 시 `SPLIT_VERIFICATION_FAILED`). `role:'post-process'` 시트는 출력 모드와 무관하게 **항상 별도 `set_<index>.pdf`**.
   - 시트당 면 수(단면 1 / 양면 2) 불일치 → `SPLIT_VERIFICATION_FAILED`. 빈 면·post-process 별도 파일 처리는 오너 확인 권장 항목(P2 계획 §1).
4. 완료: `result = { success, outputFileUrl, outputFiles, totalPages, sheetMap:{ output, duplexFlip, sheets } }` — `sheetMap` echo 는 매니페스트·잡 `result` 전용이며 웹훅 `synthesis.*` 본문(`outputFiles`)·`OutputFile.type` 값·admin 잡 라벨·기존 5 mode(split·duplex-split·spread·compose-mixed·merge) 골든은 불변. 멱등 가드(완료 마커)·`settleFailedAttempt` 는 다른 mode 와 같다.

### 5) api 발행 조건 — 편집 완료 `applyPdfOutputMode()`

- 비스프레드 세션에서 템플릿셋 조회 뒤, **킬스위치 `SHEET_MAP_OUTPUT_ENABLED`**(api, 기본 ON, `off` 일 때만 OFF, 호출 시점마다 env, `[FLAGS] api` 17번째 키)가 ON 이고 `resolveSessionProductProfile()`(템플릿셋 우선 → 세션 스냅샷) 결과가 `output.mode==='sheet-map'` 이면 **`pdfOutputMode` 값과 무관하게(duplex-split 보다 우선)** `buildSheetMap(profile, resolveSessionPageCount(session))` → `createSheetMapJob({ output: profile.output.sheetFiles ?? 'per-sheet', duplexFlip: profile.sheet.duplexFlip, requestId: 'sheet-map-r<revision>', siteId: 세션 사이트, revision })`. 로그 `[pdfOutputMode] Created sheet-map job <id> for session <id> (… pdfOutputMode='<값>' 무시)`.
- OFF 이거나 프로파일이 sheet-map 이 아니면 종전 분기 폴스루(`single`·`duplex-merged` = 잡 없음, `duplex-split` = 위 2). `coverFileId` 부재·매핑 실패(`SheetMapError`)·잡 생성 실패는 경고만 남기고 완료는 유지(best-effort, 종전과 같음).
- `createSheetMapJob()`: 멱등(같은 `(sessionId, pdfFileId, requestId)` 반환) → 편집기 산출물·세션 일치 검증(`PDF_NOT_FROM_EDITOR`·`SESSION_FILE_MISMATCH` 400) → `totalExpectedPages = resolveSessionPageCount(session)`(0 이면 422 `EMPTY_SESSION_PAGES`) → `assertSheetMapCoversPages` → `WorkerJob(SYNTHESIZE, options{mode:'sheet-map', …})` → 합성 큐(`SYNTHESIS_QUEUE_RETRY_OPTS`, 재시도 규칙 종전).
- 배포 순서는 **worker 먼저** — 미배포 워커가 `sheet-map` 잡을 받으면 알 수 없는 mode 로 merge 경로에 떨어진다. 롤백: `.env` `SHEET_MAP_OUTPUT_ENABLED=off` → `docker compose up -d api` → nginx 재시작(발행 중지, duplex-split 폴스루) → 큐 `bull:pdf-synthesis:wait` 0 확인 뒤 worker 롤백 태그.
- 로컬 e2e(2026-10-19 00:03 KST, 탁상 베이직 프로파일 `output.mode='sheet-map'`/per-sheet): 완료 → `Created sheet-map job … sheets=13, output=per-sheet, pdfOutputMode='duplex-split' 무시` → 13 `set_<i>.pdf`(각 2쪽 216×156mm) → deliverables `ready`·`sheets` 13 → synthesize 201(r2) → `sheetFiles='merged-duplex'` 로 재합성 201(r3) → `sheets_duplex.pdf` 26쪽. 로컬 워커는 `OUTPUTS_PATH` 미설정 시 도커 기본 `/app/...` 로 mkdir ENOENT — worker-local 실행 구성에 `OUTPUTS_PATH` 를 주입한다(DEPLOYMENT 「5. 로컬 기동 시 알아둘 점」의 worker 환경 파일 항목과 함께).

---

## 에러 코드 (차단)

에러가 발생하면 접수가 차단되며, 고객은 파일을 수정 후 재업로드해야 합니다.

| 코드 | 설명 | 원인 | 해결 방법 |
|------|------|------|----------|
| `UNSUPPORTED_FORMAT` | 지원하지 않는 파일 형식 | PDF가 아니거나 손상된 헤더 | PDF 형식으로 저장 |
| `FILE_CORRUPTED` | 손상된 파일 | 파일 업로드 중 손상 또는 잘못된 PDF | 파일 재생성 |
| `FILE_TOO_LARGE` | 파일 크기 초과 | `WORKER_MAX_FILE_SIZE`(실배포 2GB) 초과 | 이미지 해상도 줄이기, 압축 |
| `PAGE_COUNT_INVALID` | 페이지 수 오류 | 제본 방식에 맞지 않는 페이지 수 · **낱장(`productKind='sheet'`)은 세션 기록 쪽수와 다름 또는 `pageStep` 배수 아님(2026-10-17, `autoFixable=false`)** | 4의 배수로 조정 (사철) · 낱장은 정확한 쪽수로 재생성(빈 쪽 추가 아님) |
| `PAGE_COUNT_EXCEEDED` | 페이지 수 초과 | 사철 64페이지 초과 등 | 무선 제본으로 변경 |
| `SIZE_MISMATCH` | 페이지 사이즈 불일치 | 주문 규격과 PDF 크기 다름 | PDF 크기 조정 |
| `SPINE_SIZE_MISMATCH` | 책등 사이즈 불일치 | 표지 너비가 맞지 않음 | 책등 포함 표지 재생성 |
| `SADDLE_STITCH_INVALID` | 사철 제본 규격 오류 | 페이지 수가 4의 배수 아님 | 빈 페이지 추가 |
| `POST_PROCESS_CMYK` | 후가공 파일 CMYK 사용 | 후가공 파일에 CMYK 색상 — **`postProcessColorRule='spot-only'` 지정 잡에만**(2026-10-17 v1.21, 기본 해제) | 별색(Spot Color)만 사용 |
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
| `TRANSPARENCY_DETECTED` | 투명도 감지 | 투명 효과 사용 — 파일 전체 정규식 스캔(`/ca`·`/CA`<1·`/SMask`·`/BM`), `details.pages` 는 `[{page:1}]` 고정(위치 정보 아님) | 평면화(Flatten) 권장. 편집기 산출물의 원인·해소는 §프로파일 세트(캘린더) 검증 3) |
| `OVERPRINT_DETECTED` | 오버프린트 감지 | 오버프린트 설정 | 인쇄 결과 확인 |
| `FONT_NOT_EMBEDDED` | 폰트 미임베딩 | 임베딩되지 않은 폰트 ≥1(poppler `pdffonts` 우선, 정규식 폴백; `details={ unembeddedFonts, fontCount }`) | 아웃라인 처리 또는 임베딩(서브셋 포함) 후 재업로드 |
| `SPINE_PARAMS_UNRESOLVED` | 책등 정보 미해석 | 무선·양장 표지인데 spine 기대치 없음(`details.reason`) — `coverSpine='none'`·`coverLayout='separate'` 표지에는 나오지 않음 | 지종·`spineWidthMm` 전달 (§표지 책등·전개 크기 검증) |
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

> **2026-10-17 변경(v1.21, 운영 반영)**: 아래 표의 CMYK 불허(`POST_PROCESS_CMYK`)는 `orderOptions.postProcessColorRule='spot-only'` 를 지정한 잡에만 적용된다. 미전송·`'any'`(기본) 면 후가공 파일의 CMYK 는 오류도 경고도 내지 않는다 — 후가공 파일은 고객 업로드·관리자 작업 파일이며 선·라운드·면적·투명 객체가 정상 입력이다(§낱장 분류 검증).

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

## 변경 이력

| 일자 | 내용 | 운영 반영 |
|---|---|---|
| 2026-10-17 | 낱장 분류 검증 — `orderOptions.productKind='sheet'`·`pageStep`·`postProcessColorRule`(ADDITIVE), 낱장 정확 쪽수 `PAGE_COUNT_INVALID`·후가공 CMYK 오류 기본 해제(MODIFY-TARGET), 킬스위치 `EDITOR_SHEET_VALIDATION_RULES`, duplex-split 잡 기대 쪽수 원천 `resolveSessionPageCount` — CONTRACT_FREEZE v1.21 | **완료**(2026-10-17 04:30Z, master `19f1ce7c`) |
| 2026-10-17 | 프로파일 세트 기대 쪽수 권위(`expectedPages` = 템플릿셋 `pages.count`)·`coverSpine='none'`(v1.22 보강)·캘린더 완료 PDF 경고 0(canvas-core export 옵션 3종·도련 정책 A) — 커밋 `af900212` | **완료**(2026-10-18 00:48 KST, master `af900212`; 운영 샘플 세트 등록은 오너 보류) |
| 2026-10-18 | 워커 합성 파일 메타 조회 `GET /files/:id/external` + `api://` 다운로드(종전 JWT 전용 라우트 401 결함), 편집 완료 duplex-split 잡 request_id 회차 키 `duplex-split-r<revision>`(종전 86자 > VARCHAR(36) 결함), 파트너 v1 `POST /api/v1/sessions/:id/synthesize` 재합성·웹훅 `revision` — 커밋 `f43cb99e`, CONTRACT_FREEZE v1.23. 운영 실측: SYNTHESIZE 잡 12건 전부 mode NULL·duplex-split 세트 0 | **미반영**(브랜치 `p1-calendar-2026-10-17`, master 미병합) |
| 2026-10-19 | worker 합성 mode `sheet-map`(per-sheet `set_<i>.pdf` / merged-duplex `sheets_duplex.pdf`·빈 면 삽입·post-process 별도 파일·회전 상대 +180·`result.sheetMap`·입력 오류 `INVALID_OUTPUT_OPTIONS`/`PAGE_COUNT_MISMATCH` 비재시도), api 발행 조건(프로파일 `output.mode==='sheet-map'` 이 duplex-split 보다 우선, 킬스위치 `SHEET_MAP_OUTPUT_ENABLED`) — 커밋 `9be4c37c`, CONTRACT_FREEZE v1.24 | **미반영**(같은 브랜치, 배포 시 worker 먼저) |
| 2026-10-19 | 이 문서: 위 항목 반영 — §낱장 분류 검증·§프로파일 세트(캘린더) 검증·§합성 잡 절 신설, 한눈에 표(4b·12·15b·조건부 실행)·validate 입력 계약·표지 책등 절·에러/경고 코드 표·후가공 색상 규칙 갱신 | — |
| 2026-10-20 | 사진인화(photo-print) 세트 검증 — cover 슬롯 `productKind 'sheet'`·`coverSpine 'none'`·`pages` 세션 쪽수·chemical `pageStep` 없음/digital 2(v1.21·v1.22 규칙 그대로, 워커 무변경), 검증 잡 `orderOptions.bleed` 기본값 `resolveDefaultBleedMm`(재단선 없는 프로파일 세트 0 — chemical 완료 PDF `BLEED_MISSING` 오탐 제거, D9) — CONTRACT_FREEZE v1.25. 로컬 실측(2026-10-19, 수정 전) chemical 3쪽 `isValid true`·errors 0·경고 `BLEED_MISSING` 1 → 수정 후 digital ① 재실측 `warnings: []`·chemical 은 기대 0(미재실측) | **미반영**(브랜치 `p1-calendar-2026-10-17`, 미커밋·master 미병합; 운영 샘플 세트 등록은 오너 보류) |
| 2026-10-20 | 이 문서: §사진인화(photo-print) 세트 검증 절 신설 + 변경 이력 | — |

---

## 참고 문서

- [PDF 검증 기능 확장 검토서](./PDF_VALIDATION_REVIEW.md)
- [PDF 검증 WBS](./PDF_VALIDATION_WBS.md)
- [QA 체크리스트](../apps/worker/test/QA_CHECKLIST.md)
