# 작업지시문 — 책등(세네카) 계산 로직을 Storige 편집기·워커에 반영 (2026-07-21)

> **수신**: `bookmoa storige editor` 세션 (Storige 편집기 + 검증 워커 담당)
> **발신**: bookmoa-mobile CTO 세션 — 오픈 QA **R-44** (원장 `docs/LAUNCH-QA-LEDGER-2026-06-30.md`)
> **목적**: 북모아 레거시 사이트가 안내용으로 쓰던 책등 계산 로직 2종(양장/무선)을 **정밀 실측·이식 완료**했다.
> 동일 공식을 ① **편집기 표지 가변책등 템플릿** ② **워커 표지 PDF 검증**에 반영해 달라.
> **bookmoa 측 참조 구현(SSOT)**: `src/lib/spine-calc.js` + 골든 테스트 `src/lib/spine-calc.test.js`(vitest 14케이스, 원본 계산기 0오차).

---

## 1. 공식 (정확 사양 — 라이브 소스 실측 2026-07-21)

### 1-A. 무선 제본 (perfect) — 출처: youshindang.com/assets/calc/calc.asp `calseneka()`

```
eff_pages = (pages % 2 == 1) ? pages + 1 : pages     // 홀수 페이지 +1 보정
spine_mm  = round(eff_pages × t_page × 100) / 100     // 소수 2자리 반올림 (내림/올림 아님)
```

- `t_page` = **페이지당** 두께(mm/페이지). 표는 §2.
- 예: 200p 미색모조 80g(0.048) → **9.6mm** · 201p → 202p 보정 → **9.7mm** · 16p → 0.768 → **0.77mm**
- 표지 펼침(재단 기준, 도련 별도): `W_spread = W×2 + spine_mm`, `H_spread = H`

### 1-B. 양장 제본 (hardcover) — 출처: mybookmake.com/app/cal_01.php `bookCalculate()`

```
// 유효성: pages ≥ 12 그리고 pages % 4 == 0
page_block = ceil( toFixed3(pages / 2 × t_sheet) )    // 내지뭉치: 낱장수×장당두께 → 3자리 고정 후 "올림(정수 mm)"
spine_mm   = max( 4 + page_block, 8 )                 // 마닐라 합지 4mm 가산, 최소 8mm
```

- `t_sheet` = **장당** 두께(mm/장 — 낱장수 = 페이지/2). 표는 §2. ⚠️ 무선 표와 단위가 다름(약 2배).
- `toFixed3 후 ceil`은 원본 규칙 — float 잔차가 정수 경계에서 ceil을 한 단계 올리는 오류 방지.
- 표지(싸바리) 전개 규격(재단 W×H 기준):
```
cover_w  = W + 8                       // 원본 식: W - 3 + 11 (보드·경첩 보정 합산)
cover_h  = H + 8
total_w  = cover_w × 2 + spine_mm + 40 // 싸바리 감싸기 여분 좌우 20mm
total_h  = cover_h + 40                // 상하 20mm
```
- 검증 골든값(원본 렌더 실측): 210×297·40p·아르떼130(0.191) → cover 218×305 · spine **8** · 전개 **484×345**

## 2. 지종 두께표

### 무선(mm/페이지) — youshindang 원본. ⚠️ '백모조 180g'은 원본 0.010이 **명백한 오타**라 0.100으로 정정 이식함.

| 지종 | t | 지종 | t | 지종 | t |
|---|---|---|---|---|---|
| 백모조 70g | 0.043 | 스노우지 100g | 0.045 | 뉴플러스백색 100g | 0.051 |
| 백모조 80g | 0.048 | 스노우지 120g | 0.058 | 뉴플러스미색 100g | 0.051 |
| 백모조 100g | 0.058 | 스노우지 150g | 0.070 | 랑데뷰화이트 105g | 0.074 |
| 백모조 120g | 0.069 | 스노우지 180g | 0.090 | 랑데뷰화이트 130g | 0.090 |
| 백모조 150g | 0.084 | 스노우지 200g | 0.103 | 랑데뷰화이트 160g | 0.110 |
| 백모조 180g | **0.100**(정정) | 아트지 100g | 0.040 | 랑데뷰화이트 190g | 0.130 |
| 미색모조 70g | 0.043 | 아트지 120g | 0.048 | 랑데뷰네추럴 105g | 0.074 |
| 미색모조 80g | 0.048 | 아트지 150g | 0.060 | 랑데뷰네추럴 130g | 0.090 |
| 미색모조 100g | 0.058 | 아트지 180g | 0.078 | 랑데뷰네추럴 160g | 0.110 |
| | | 아트지 200g | 0.094 | 랑데뷰네추럴 190g | 0.130 |

### 양장(mm/장) — mybookmake 원본 35종: `src/lib/spine-calc.js`의 `HARDCOVER_PAPERS` 참조
(아르떼 130~230 / 미색·백색모조 70~180 / 아트 무림·한국 80~300 / 스노우 무림 80~300 — 표가 길어 코드 참조로 갈음. 예: 미색모조80=0.095, 아르떼130=0.191)

## 3. 현재 계약 상태 (bookmoa 측에서 이미 확인한 것)

1. **워커 검증 경로**: bookmoa `api/storige/validate.js`가 표지(cover)+무선/양장이면 Storige **`/products/spine/calculate`**(`{pageCount, paperType, bindingType}`)를 호출해 `orderOptions.spineWidthMm`을 보강 후 `/worker-jobs/validate/external`에 전달한다. 클라가 `spineWidthMm`을 직접 주면 그 값 우선.
2. **합성 경로**: `api/storige/synthesize.js`(compose-mixed)는 `spineWidth` 필수 입력.
3. **binding 코드**: bookmoa는 canonical 코드(`perfect`/`saddle`/`spiral`/`hardcover`) 전송(2026-06-25 정합).
4. bookmoa 주문화면에 위 공식 그대로의 **고객용 책등 계산기 모달 2종** 탑재 완료(R-44) — 고객이 보는 값과 편집기/워커 값이 일치해야 한다.

## 4. 요청 작업

### A. 편집기 — 표지편집 가변책등 템플릿
1. **책등 폭 가변화**: 표지 templateSet 캔버스가 `spine_mm`에 따라 가변 — 무선: `W×2 + spine`(+도련), 양장: §1-B 전개 규격(협의 §5-3 선행).
2. **spine 산출 입력**: `pageCount + paperType`으로 §1 공식 서버 산출(또는 embed 파라미터 `spineWidthMm` 직접 수신 — 어느 쪽을 정본으로 할지 회신).
3. **책등 가이드 표시**: 책등 영역 경계·세이프존 가이드 + 책등 폭이 얇을 때(무선 3mm 미만 제안) 책등 텍스트 배치 경고.
4. **페이지수 변경 재편집**: 재진입 시 spine 재계산 → 캔버스 리플로우 정책(책등 중앙 앵커 유지 등) 정의.

### B. 워커 — 표지 PDF 검증
1. **기대 폭 검증**: 표지 PDF 기대 전체폭 = `W×2 + spine`(+도련×2, 날개 상품은 날개 폭) ± **허용오차(제안 ±1.0mm — 회신 요청)**.
2. **서버 재계산 원칙**: 클라 전달 `spineWidthMm`을 신뢰하지 말고 `pageCount/paperType`으로 §1 공식 재산출·대조(가격 recompute와 동일한 fail-closed 철학).
3. **결함 리포트**: 불일치 시 `SPINE_MISMATCH { expectedMm, actualMm, toleranceMm }` 형태 제안 — bookmoa `PdfValidationModal`이 표시 가능한 계약(R-24 `details.pages` 정규화 선례 참고).
4. `/products/spine/calculate`가 **§1 공식·§2 두께표와 일치하는지 확인**하고, 다르면 갱신(현재 무엇을 쓰는지 회신).

### C. 회신 요청 (질문)
1. `/products/spine/calculate`의 **현재 공식·paperType 코드표** (bookmoa `productMeta.innerPaper` 한글 지종명과의 매핑 SSOT를 어디에 둘지).
2. 양장 표지 산출물 정의 — **싸바리 전개 인쇄물**(§1-B 전개 규격)인지, 재킷/커버지 별도인지. 이에 따라 A-1·B-1의 양장 기대 규격이 달라짐.
3. 허용오차 정책(무선/양장 각각) 및 spine 소수 처리(무선 0.77mm 같은 소수 유지 여부 — bookmoa는 소수 2자리 유지).
4. 가로형(landscape) templateSet(R-13)과 가변책등의 상호작용 — 가로형도 W↔H 스왑 후 동일 공식 적용으로 충분한지.

## 5. 수용 기준 (AC)

| # | 시나리오 | 기대 결과 |
|---|---|---|
| 1 | 무선 200p 미색모조 80g | spine **9.6mm**, 표지 기대폭 W×2+9.6(+도련) |
| 2 | 무선 201p 동일 지종 | 202p 보정 → **9.7mm** |
| 3 | 무선 16p 동일 지종 | **0.77mm** (소수 유지 — 반올림 정수화 금지) |
| 4 | 양장 200p 미색모조80(0.095/장) | spine **14mm** (합지4+내지10) |
| 5 | 양장 40p 아르떼130 · 210×297 | spine **8mm**(최소), 전개 **484×345** |
| 6 | 표지 PDF 폭이 기대폭±오차 밖 | `SPINE_MISMATCH` 결함 리포트(통과 금지) |
| 7 | 편집기 표지 템플릿 | pageCount/지종 변경 시 책등 폭 가변 + 가이드 표시 |

— 이상. 회신은 §4-C 4항목 기준으로 부탁드립니다. bookmoa 측 참조 구현·테스트는 커밋 참조(R-44).
