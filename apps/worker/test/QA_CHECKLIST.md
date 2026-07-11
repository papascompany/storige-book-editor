# PDF 검증 기능 QA 체크리스트

## WBS 5.4: QA 체크리스트

작성일: 2025-12-23
버전: 1.1 (업데이트)

---

## 테스트 환경 정보

| 항목 | 값 |
|------|-----|
| Node.js | v18.20.5+ |
| pnpm | 9.15.0+ |
| Ghostscript | 9.22+ |
| OS | macOS / Linux (Docker) |

---

## 1. 기능별 테스트 결과

### 1.1 기본 검증 기능 (RGB)

| 테스트 케이스 | 픽스처 파일 | 예상 결과 | 실제 결과 | 상태 |
|--------------|------------|----------|----------|------|
| A4 단면 정상 | `rgb/success-a4-single.pdf` | ✅ 통과 | 통과 | ✅ |
| A4 8페이지 정상 | `rgb/success-a4-8pages.pdf` | ✅ 통과 (8p) | 통과 | ✅ |
| A4 재단여백 포함 | `rgb/success-a4-with-bleed.pdf` | ✅ 통과 (216x303) | 통과 | ✅ |
| B5 단면 정상 | `rgb/success-b5-single.pdf` | ✅ 통과 | 통과 | ✅ |
| 가로형 페이지 감지 | `rgb/fail-mixed-orientation.pdf` | ⚠️ LANDSCAPE_PAGE 경고 | 경고 발생 | ✅ |
| 잘못된 크기 (A5) | `rgb/fail-wrong-size-a5.pdf` | ❌ SIZE_MISMATCH 오류 | 오류 발생 | ✅ |
| 재단여백 없음 | `rgb/fail-no-bleed.pdf` | ⚠️ BLEED_MISSING 경고 | 경고 발생 | ✅ |

### 1.2 사철 제본 검증

#### 성공 케이스 (4의 배수)

| 테스트 케이스 | 픽스처 파일 | 예상 결과 | 실제 결과 | 상태 |
|--------------|------------|----------|----------|------|
| 4페이지 (최소) | `saddle-stitch/success-4-pages.pdf` | ✅ 통과 | 통과 | ✅ |
| 8페이지 | `saddle-stitch/success-8-pages.pdf` | ✅ 통과 | 통과 | ✅ |
| 16페이지 | `saddle-stitch/success-16-pages.pdf` | ✅ 통과 | 통과 | ✅ |
| 32페이지 | `saddle-stitch/success-32-pages.pdf` | ✅ 통과 | 통과 | ✅ |
| 48페이지 | `saddle-stitch/success-48-pages.pdf` | ✅ 통과 | 통과 | ✅ |
| 64페이지 (최대) | `saddle-stitch/success-64-pages.pdf` | ✅ 통과 | 통과 | ✅ |

#### 실패 케이스 (4의 배수 아님)

| 테스트 케이스 | 픽스처 파일 | 예상 결과 | 실제 결과 | 상태 |
|--------------|------------|----------|----------|------|
| 1페이지 | `saddle-stitch/fail-1-page.pdf` | ❌ SADDLE_STITCH_INVALID | 오류 발생 | ✅ |
| 3페이지 | `saddle-stitch/fail-3-pages.pdf` | ❌ SADDLE_STITCH_INVALID | 오류 발생 | ✅ |
| 5페이지 | `saddle-stitch/fail-5-pages.pdf` | ❌ SADDLE_STITCH_INVALID | 오류 발생 | ✅ |
| 7페이지 | `saddle-stitch/fail-7-pages.pdf` | ❌ SADDLE_STITCH_INVALID | 오류 발생 | ✅ |
| 13페이지 | `saddle-stitch/fail-13-pages.pdf` | ❌ SADDLE_STITCH_INVALID | 오류 발생 | ✅ |
| 17페이지 | `saddle-stitch/fail-17-pages.pdf` | ❌ SADDLE_STITCH_INVALID | 오류 발생 | ✅ |
| 25페이지 | `saddle-stitch/fail-25-pages.pdf` | ❌ SADDLE_STITCH_INVALID | 오류 발생 | ✅ |

#### 실패 케이스 (64페이지 초과)

| 테스트 케이스 | 픽스처 파일 | 예상 결과 | 실제 결과 | 상태 |
|--------------|------------|----------|----------|------|
| 68페이지 | `saddle-stitch/fail-68-pages.pdf` | ❌ PAGE_COUNT_EXCEEDED | 오류 발생 | ✅ |
| 72페이지 | `saddle-stitch/fail-72-pages.pdf` | ❌ PAGE_COUNT_EXCEEDED | 오류 발생 | ✅ |
| 100페이지 | `saddle-stitch/fail-100-pages.pdf` | ❌ PAGE_COUNT_EXCEEDED | 오류 발생 | ✅ |

#### 복합 오류 케이스

| 테스트 케이스 | 픽스처 파일 | 예상 결과 | 실제 결과 | 상태 |
|--------------|------------|----------|----------|------|
| 65페이지 (둘 다 위반) | `saddle-stitch/fail-65-pages.pdf` | ❌ 두 오류 모두 | 두 오류 발생 | ✅ |

### 1.3 스프레드(펼침면) 감지

#### 성공 케이스

| 테스트 케이스 | 픽스처 파일 | 예상 결과 | 실제 결과 | 상태 |
|--------------|------------|----------|----------|------|
| A4 스프레드 10개 | `spread/success-a4-spread-10.pdf` | 10p (432x303) | 감지됨 | ✅ |
| A4 스프레드 20개 | `spread/success-a4-spread-20.pdf` | 20p (432x303) | 감지됨 | ✅ |
| A4 스프레드 5개 | `spread/success-a4-spread-5.pdf` | 5p (432x303) | 감지됨 | ✅ |
| B5 스프레드 10개 | `spread/success-b5-spread-10.pdf` | 10p (376x263) | 감지됨 | ✅ |
| 사철 스프레드 8개 | `spread/success-saddle-spread-8.pdf` | 8p | 감지됨 | ✅ |

#### 경고 케이스 (혼합 PDF)

| 테스트 케이스 | 픽스처 파일 | 예상 결과 | 실제 결과 | 상태 |
|--------------|------------|----------|----------|------|
| 표지 단면 + 내지 펼침 | `spread/warn-mixed-cover-content.pdf` | ⚠️ MIXED_PDF 경고 | 경고 발생 | ✅ |
| 첫/마지막 단면 | `spread/warn-mixed-first-last-single.pdf` | ⚠️ MIXED_PDF 경고 | 경고 발생 | ✅ |

#### 실패 케이스

| 테스트 케이스 | 픽스처 파일 | 예상 결과 | 실제 결과 | 상태 |
|--------------|------------|----------|----------|------|
| 단면 주문에 펼침 파일 | `spread/fail-spread-for-single-order.pdf` | ❌ SIZE_MISMATCH | 오류 발생 | ✅ |
| 잘못된 너비 | `spread/fail-wrong-width-spread.pdf` | ❌ 검증 실패 | 실패 | ✅ |
| 잘못된 높이 | `spread/fail-wrong-height-spread.pdf` | ❌ 검증 실패 | 실패 | ✅ |
| 너무 작은 크기 (A5) | `spread/fail-too-small-spread.pdf` | ❌ SIZE_MISMATCH | 오류 발생 | ✅ |
| 펼침 주문에 단면 파일 | `spread/fail-single-for-spread-order.pdf` | ❌ SIZE_MISMATCH | 오류 발생 | ✅ |
| 불규칙한 페이지 크기 | `spread/fail-irregular-sizes.pdf` | ❌ 오류/경고 | 발생 | ✅ |

### 1.4 CMYK 감지

| 테스트 케이스 | 픽스처 파일 | 예상 결과 | 실제 결과 | 상태 |
|--------------|------------|----------|----------|------|
| RGB 전용 파일 | `cmyk/success-rgb-only.pdf` | ✅ 통과 | 통과 | ✅ |
| CMYK 시그니처 감지 | `cmyk/fail-cmyk-for-postprocess.pdf` | CMYK 구조 감지 | 감지됨 | ✅ |

### 1.5 별색(Spot Color) 감지

| 테스트 케이스 | 픽스처 파일 | 예상 결과 | 실제 결과 | 상태 |
|--------------|------------|----------|----------|------|
| 별색 전용 | `spot-color/success-spot-only.pdf` | 별색 감지 (PANTONE, CutContour, Crease) | 3개 감지 | ✅ |
| CMYK + 별색 혼합 | `spot-color/warn-cmyk-spot-mixed.pdf` | 별색 + CMYK 감지 | 감지됨 | ✅ |

### 1.6 투명도/오버프린트 감지

| 테스트 케이스 | 픽스처 파일 | 예상 결과 | 실제 결과 | 상태 |
|--------------|------------|----------|----------|------|
| 투명도 없음 | `transparency/success-no-transparency.pdf` | ✅ 통과 | 통과 | ✅ |
| 투명도 포함 | `transparency/warn-with-transparency.pdf` | ⚠️ TRANSPARENCY_DETECTED 경고 | 경고 발생 | ✅ |
| 오버프린트 포함 | `transparency/warn-with-overprint.pdf` | ⚠️ OVERPRINT_DETECTED 경고 | 경고 발생 | ✅ |
| 투명도 + 오버프린트 | `transparency/warn-both-trans-overprint.pdf` | ⚠️ 두 경고 모두 | 경고 발생 | ✅ |

---

## 2. 운영 정책 확인

### 2.1 에러 vs 경고 분류

| 항목 | 처리 | 확인 |
|------|------|------|
| 후가공 파일 + CMYK | ❌ 오류 (POST_PROCESS_CMYK) | ✅ |
| 사철 4의 배수 아님 | ❌ 오류 (SADDLE_STITCH_INVALID) | ✅ |
| 사철 64페이지 초과 | ❌ 오류 (PAGE_COUNT_EXCEEDED) | ✅ |
| 파일 용량 초과 | ❌ 오류 (FILE_TOO_LARGE) | ✅ |
| 사이즈 불일치 | ❌ 오류 (SIZE_MISMATCH) | ✅ |
| 가로형 페이지 | ⚠️ 경고 (LANDSCAPE_PAGE) | ✅ |
| 투명도 감지 | ⚠️ 경고 (TRANSPARENCY_DETECTED) | ✅ |
| 오버프린트 감지 | ⚠️ 경고 (OVERPRINT_DETECTED) | ✅ |
| 혼합 PDF | ⚠️ 경고 (MIXED_PDF) | ✅ |
| 사철 중앙부 객체 | ⚠️ 경고 (CENTER_OBJECT_CHECK) | ✅ |
| 재단여백 없음 | ⚠️ 경고 (BLEED_MISSING) | ✅ |

### 2.2 자동 수정 가능 항목

> **C+ 게이팅 (2026-07-11)**: 아래 autoFixable 기대값은 킬스위치
> `WORKER_WIRED_FIXABLE_GATING` 상태에 따라 다르다 — **기본 OFF = 레거시(true)**,
> ON 이면 실행기가 배선된 addBlankPages 만 true(나머지는 false, fixMethod 는 유지).
> ON 상태로 QA 시 extendBleed/adjustSpine/resizeWithPadding 행의 false 는 **의도된 동작**이다.

| 항목 | autoFixable (OFF 기본 / ON) | fixMethod | 실행기 | 확인 |
|------|------------|-----------|------|------|
| 사철 페이지 수 불일치 | true / true | addBlankPages | ✅ fix-pagecount LIVE | ✅ |
| 재단 여백 부족 | true / **false** | extendBleed | ❌ 미제공 | ✅ |
| 책등 크기 불일치 | true / **false** | adjustSpine | ❌ 미제공(자동화 비대상) | ⏳ |
| 페이지 크기 불일치 | true / **false** | resizeWithPadding | ❌ 미제공 | ⏳ |

---

## 3. 성능 테스트 결과

### 3.1 Ghostscript 타임아웃

| 항목 | 설정값 | 확인 |
|------|-------|------|
| GS_TIMEOUT | 5000ms (5초) | ✅ |
| GS_MAX_PAGES | 50페이지 | ✅ |
| GS_CONCURRENCY | 2 | ✅ |

### 3.2 대형 파일 처리

| 파일 크기 | 처리 방식 | 확인 |
|----------|----------|------|
| < 50MB | 전체 분석 | ✅ |
| 50-100MB | 구조 기반 분석 | ⏳ |
| > 100MB | 오류 반환 | ⏳ |

---

## 4. 에러/경고 메시지 검토

### 4.1 에러 메시지

| 코드 | 메시지 | 검토 |
|------|--------|------|
| UNSUPPORTED_FORMAT | 지원하지 않는 파일 형식입니다 | ✅ |
| FILE_CORRUPTED | 파일 처리 중 오류가 발생했습니다 | ✅ |
| FILE_TOO_LARGE | 파일 크기가 XXX MB를 초과합니다 | ✅ |
| PAGE_COUNT_INVALID | 페이지 수가 올바르지 않습니다 | ✅ |
| PAGE_COUNT_EXCEEDED | 최대 페이지 수를 초과했습니다 | ✅ |
| SIZE_MISMATCH | 페이지 크기가 주문 규격과 일치하지 않습니다 | ✅ |
| SADDLE_STITCH_INVALID | 사철 제본은 페이지 수가 4의 배수여야 합니다 | ✅ |
| POST_PROCESS_CMYK | 후가공 파일에 CMYK 색상이 사용되었습니다 | ✅ |

### 4.2 경고 메시지

| 코드 | 메시지 | 검토 |
|------|--------|------|
| LANDSCAPE_PAGE | X페이지가 가로형입니다 | ✅ |
| CENTER_OBJECT_CHECK | 중앙부 객체 배치를 확인해주세요 | ✅ |
| TRANSPARENCY_DETECTED | 투명도 효과가 포함되어 있습니다 | ✅ |
| OVERPRINT_DETECTED | 오버프린트 설정이 포함되어 있습니다 | ✅ |
| MIXED_PDF | 표지/내지 혼합 PDF로 감지되었습니다 | ✅ |
| BLEED_MISSING | 재단 여백이 부족합니다 | ✅ |

---

## 5. 테스트 커버리지

| 구분 | 테스트 수 | 통과 | 커버리지 |
|------|----------|------|---------:|
| 단위 테스트 (pdf-validator.service) | 27 | 27 | 100% |
| 단위 테스트 (ghostscript) | 22 | 22 | 100% |
| 통합 테스트 (e2e) | 45 | 45 | 100% |
| 기타 (processor) | 3 | 3 | 100% |
| **총합** | **97** | **97** | **100%** |

---

## 6. 테스트 픽스처 요약

### RGB (7개 파일)
- 성공: 4개 (a4-single, a4-8pages, a4-with-bleed, b5-single)
- 실패: 3개 (mixed-orientation, wrong-size-a5, no-bleed)

### 사철 제본 (17개 파일)
- 성공: 6개 (4, 8, 16, 32, 48, 64 pages)
- 실패 (4의 배수 아님): 7개 (1, 3, 5, 7, 13, 17, 25 pages)
- 실패 (64페이지 초과): 3개 (68, 72, 100 pages)
- 실패 (복합): 1개 (65 pages)

### 스프레드 (13개 파일)
- 성공: 5개 (A4 5/10/20, B5 10, saddle 8)
- 경고: 2개 (mixed-cover-content, mixed-first-last-single)
- 실패: 6개 (spread-for-single, wrong-width, wrong-height, too-small, single-for-spread, irregular)

### CMYK (2개 파일)
- 성공: 1개 (rgb-only)
- 실패: 1개 (cmyk-for-postprocess)

### 별색 (2개 파일)
- 성공: 1개 (spot-only)
- 경고: 1개 (cmyk-spot-mixed)

### 투명도/오버프린트 (4개 파일)
- 성공: 1개 (no-transparency)
- 경고: 3개 (with-transparency, with-overprint, both-trans-overprint)

---

## 7. 미완료 항목

| 항목 | 상태 | 비고 |
|------|------|------|
| 대형 PDF (100MB+) 테스트 | ⏳ | Git LFS 필요 |
| 실제 CMYK PDF 테스트 | ⏳ | Adobe 도구 필요 |
| Ghostscript 미설치 환경 테스트 | ⏳ | Docker 환경 확인 필요 |

---

## 승인

| 역할 | 이름 | 날짜 | 서명 |
|------|------|------|------|
| 개발자 | - | 2025-12-23 | ✅ |
| QA | - | - | ⏳ |
| PM | - | - | ⏳ |
