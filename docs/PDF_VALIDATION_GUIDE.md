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
| 6 | 판형(사이즈) | 🔴에러 | `SIZE_MISMATCH` | 주문 `size`와 ±**1mm** 초과(재단 포함/불포함 모두 비교) | 전체 | resizeWithPadding |
| 7 | 재단 여백(bleed) | 🟡경고 | `BLEED_MISSING` | 재단 여백 없음 | 전체 | extendBleed |
| 8 | 책등(spine) | 🔴에러 | `SPINE_SIZE_MISMATCH` | 표지 총너비 ≠ `size.w×2 + spine + bleed×2` ±**2mm** (spine=`paperThickness×pages/2` **재계산**) | **표지** + `paperThickness` 있을 때만 | adjustSpine |
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

**조건부 실행**: ⑧책등=`fileType==='cover'` + `paperThickness` 존재 시만, ⑩사철=`binding==='saddle'`일 때만, ⑫후가공CMYK=`fileType==='post_process'`일 때만.

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
    "binding": "perfect | saddle | spring",
    "bleed": 3,
    "paperThickness": 0.1,                       // 책등 fallback 계산용(spineWidthMm 없을 때)
    "spineWidthMm": 1.0,                          // ✅ (선택·권장) /products/spine/calculate 권위 책등폭. 있으면 워커가 직접 사용(bindingMargin 포함)
    "wingEnabled": false,                         // ✅ (선택) 날개 사용 여부
    "wingWidthMm": 0                              // ✅ (선택) 날개 한쪽 폭(mm) — 표지 총너비에 ×2 가산
  },
  "callbackUrl": "..."
}
```

기대 스펙은 **프런트가 `orderOptions`에 실어 보냄**(서버가 주문에서 자동 도출하지 않음).

---

## 책등·날개 검증 개선 (2026-06-04 적용)

> 코드: `apps/worker/src/services/pdf-validator.service.ts` `validateSpine()` + `worker-job.dto.ts`. **하위호환**(신규 필드 미전달 시 기존 동작 유지 — 회귀 없음). 적용: 워커+API 재배포.

| 항목 | 이전 | 현재 |
|---|---|---|
| **책등(spine)** | `paperThickness×(pages/2)` 로만 재계산 → 권위 공식의 `bindingMargin` 누락 | `spineWidthMm` 전달 시 **그 값을 직접 사용**(margin 포함). 미전달 시 기존 fallback |
| **날개(wing)** | 검증식에 wing 없음 → 정상 날개 표지 거부 위험 | `wingEnabled`+`wingWidthMm` 전달 시 표지 기대너비 = `size.w×2 + spine + **wingWidthMm×2** + bleed×2` |

표지 총너비 검증식(현재):
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

---

## 페이지수 자동 보정 (fix-pagecount) — 계약 확정, 구현 중

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

| 코드 | 수정 방법 | 설명 |
|------|----------|------|
| `PAGE_COUNT_INVALID` | `addBlankPages` | 빈 페이지 추가로 4의 배수 맞춤 |
| `SIZE_MISMATCH` | `resizeWithPadding` | 패딩 추가로 크기 조정 |
| `SPINE_SIZE_MISMATCH` | `adjustSpine` | 책등 크기 자동 조정 |

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
FROM node:20-alpine

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
