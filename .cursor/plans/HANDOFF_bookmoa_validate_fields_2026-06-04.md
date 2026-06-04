# HANDOFF — bookmoa: PDF 검증 요청에 책등(spine)·날개(wing) 필드 추가 (2026-06-04)

> 대상: **bookmoa**(주문화면에서 고객이 표지/내지 PDF 첨부 → 워커 검증을 트리거하는 프런트/어댑터).
> Storige 워커 검증이 **책등 정합 + 날개 반영**을 지원하도록 배포 완료(2026-06-04, 하위호환). **발효하려면 bookmoa 가 검증 요청 payload 에 아래 3필드를 실어 보내야** 한다. (미전달 시 기존 동작 그대로 — 회귀 없음.)

---

## 1. 무엇을 바꾸나 (한 줄)

검증 작업 생성 요청(`POST /api/worker-jobs/validate` 또는 `/validate/external`, 또는 bookmoa 어댑터가 이를 호출하는 곳)의 **`orderOptions` 객체에 `spineWidthMm`, `wingEnabled`, `wingWidthMm` 3필드를 추가**한다.

### 기존 → 변경
```jsonc
// 기존
"orderOptions": {
  "size": { "width": 214, "height": 301 },   // 단면(한쪽) 판형 mm
  "pages": 96,                                 // 내지 페이지수
  "binding": "perfect",
  "bleed": 3,
  "paperThickness": 0.1
}

// 변경 (3필드 추가)
"orderOptions": {
  "size": { "width": 214, "height": 301 },
  "pages": 96,
  "binding": "perfect",
  "bleed": 3,
  "paperThickness": 0.1,
  "spineWidthMm": 4.8,        // ✅ 신규 — 책등 폭(mm). /products/spine/calculate 결과값
  "wingEnabled": true,        // ✅ 신규 — 날개 상품 여부
  "wingWidthMm": 50           // ✅ 신규 — 날개 한쪽 폭(mm)
}
```

---

## 2. 각 값 어디서 받아오나

### ① `spineWidthMm` (책등 폭) — **표지(cover) 검증에만 의미**
- 출처: **`POST /api/products/spine/calculate`** 응답의 `spineWidth` 를 그대로 사용(권위 공식 = `(pageCount/2)×종이두께 + 제본마진` — 마진 포함이라 가장 정확).
- 요청 바디:
  ```jsonc
  POST /api/products/spine/calculate
  { "pageCount": 96, "paperType": "<용지코드>", "bindingType": "<제본코드>" }
  // (대안) 두께/마진을 직접 알면: { "pageCount":96, "customPaperThickness":0.1, "customBindingMargin":0.5 }
  ```
- 응답: `{ "spineWidth": 4.8, "paperThickness": 0.1, "bindingMargin": 0.5, "formula": "(96/2)×0.1+0.5=4.80mm", "warnings": [...] }` → `spineWidth` 를 `orderOptions.spineWidthMm` 로.
- 주의: 무선(perfect) 제본에만 책등이 존재. 사철(saddle)/스프링은 책등 없음 → `spineWidthMm` 0 또는 미전달.
- 내지(content) 검증 요청엔 불필요(표지 총너비 검증에만 사용됨).

### ② `wingEnabled` / `wingWidthMm` (날개/flap) — **표지(cover) 검증에만 의미**
- 출처: 해당 상품의 **날개 스펙**.
  - Storige 템플릿셋 기준: spread 템플릿의 `spreadConfig.spec.wingEnabled` / `spreadConfig.spec.wingWidthMm`.
    (템플릿셋 상세 조회로 얻거나, 상품-템플릿셋 매핑 시 캐싱.)
  - 또는 bookmoa 자체 상품 옵션에 날개 폭이 있으면 그 값(한쪽 mm). (예: 기존 `wingFront`/`wingBack` 파라미터 → `wingWidthMm = wingFront`, 좌우 동일 가정.)
- 날개 없는 상품: `wingEnabled:false`(또는 미전달). `wingWidthMm` 0.

---

## 3. 워커가 하는 검증 (참고 — 이미 배포됨)

표지(cover) 파일의 **전체 너비**를 다음과 비교(허용 ±2mm):
```
표지 기대 전체너비(mm)
  = size.width × 2                         (앞표지 + 뒤표지)
  + (spineWidthMm ?? paperThickness×pages/2)   (책등; spineWidthMm 있으면 그 값 우선)
  + (wingEnabled ? wingWidthMm × 2 : 0)        (날개 양쪽)
  + bleed × 2                                  (재단 여백)
```
- `spineWidthMm` 미전달 → `paperThickness` 로 fallback 재계산(레거시, 마진 미포함 → 마진 큰 제본은 오차 가능).
- `wingEnabled` 미전달/false → 날개 0 (기존 동작) → **날개 상품은 정상 표지도 거부될 수 있으니 반드시 전달**.

---

## 4. 체크리스트 (bookmoa)

- [ ] 표지(cover) 검증 요청 시 `spineWidthMm` 포함 — 값은 `/products/spine/calculate` 의 `spineWidth`(무선 제본만; 사철/스프링은 0/생략).
- [ ] 날개 상품일 때 `wingEnabled:true` + `wingWidthMm`(한쪽 mm) 포함.
- [ ] 내지(content) 검증 요청엔 위 필드 불필요(있어도 무시됨).
- [ ] 미전달 시 회귀 없음(기존 동작) — 점진 적용 가능.
- [ ] (검증) 날개 표지 1건을 첨부 → 기대 전체너비 = `단면×2 + 책등 + 날개×2 + bleed×2` 와 PDF 실제 너비가 일치하면 `SPINE_SIZE_MISMATCH` 없이 통과.

---

## 5. 참고 (Storige 측, 이미 배포됨)
- 검증 입력 DTO: `apps/api/src/worker-jobs/dto/worker-job.dto.ts` (`orderOptions.spineWidthMm?/wingEnabled?/wingWidthMm?`).
- 검증 로직: `apps/worker/src/services/pdf-validator.service.ts` `validateSpine()`.
- 책등 계산 API: `POST /api/products/spine/calculate` (`apps/api/src/products/spine.*`).
- 검증 항목/코드 전체: `docs/PDF_VALIDATION_GUIDE.md`.
- 커밋 `ed9cacd` (API+워커 재배포 완료, DB 마이그레이션 없음).
