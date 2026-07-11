# PDF 검증 API 레퍼런스

## 개요

이 문서는 Storige Worker의 PDF 검증 서비스 API를 설명합니다.

---

## 검증 요청

### 메서드

```typescript
PdfValidatorService.validate(fileUrl: string, options: ValidationOptions): Promise<ValidationResultDto>
```

### 파라미터

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `fileUrl` | `string` | ✅ | PDF 파일 경로 또는 URL |
| `options` | `ValidationOptions` | ✅ | 검증 옵션 |

---

## ValidationOptions

검증에 필요한 주문 정보와 설정을 정의합니다.

```typescript
interface ValidationOptions {
  fileType: 'cover' | 'content';
  orderOptions: {
    size: { width: number; height: number };  // mm
    pages: number;
    binding: 'perfect' | 'saddle' | 'spring';
    bleed: number;  // mm
    paperThickness?: number;  // mm
  };
  maxFileSize?: number;   // bytes (기본: 100MB)
  maxPages?: number;      // 기본: 1000
}
```

### 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `fileType` | `'cover' \| 'content'` | 표지 또는 내지 |
| `orderOptions.size` | `{width, height}` | 판형 크기 (mm) |
| `orderOptions.pages` | `number` | 주문 페이지 수 |
| `orderOptions.binding` | `string` | 제본 방식 |
| `orderOptions.bleed` | `number` | 재단 여백 (mm) |
| `orderOptions.paperThickness` | `number?` | 종이 두께 (mm, 책등 계산용) |
| `maxFileSize` | `number?` | 최대 파일 크기 (bytes) |
| `maxPages` | `number?` | 최대 허용 페이지 수 |

### 제본 방식

| 값 | 설명 | 페이지 규칙 |
|----|------|------------|
| `perfect` | 무선 제본 | 4의 배수 |
| `saddle` | 사철 제본 | 4의 배수, 최대 64페이지 |
| `spring` | 스프링 제본 | 제한 없음 |

---

## ValidationResultDto

검증 결과를 반환합니다.

```typescript
interface ValidationResultDto {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  metadata: PdfMetadata;
}
```

### 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `isValid` | `boolean` | 검증 통과 여부 (에러 0개면 true) |
| `errors` | `ValidationError[]` | 에러 목록 (차단) |
| `warnings` | `ValidationWarning[]` | 경고 목록 (통과, 주의) |
| `metadata` | `PdfMetadata` | PDF 메타데이터 |

---

## ErrorCode (에러 코드)

에러가 발생하면 `isValid: false`가 되며, 접수가 차단됩니다.

| 코드 | 설명 | autoFixable |
|------|------|-------------|
| `UNSUPPORTED_FORMAT` | 지원하지 않는 파일 형식 | ❌ |
| `FILE_CORRUPTED` | 손상된 파일 | ❌ |
| `FILE_TOO_LARGE` | 파일 크기 초과 (100MB) | ❌ |
| `PAGE_COUNT_INVALID` | 페이지 수 오류 (제본 규칙 위반) | ✅ |
| `PAGE_COUNT_EXCEEDED` | 페이지 수 초과 | ❌ |
| `SIZE_MISMATCH` | 페이지 사이즈 불일치 | ✅ → ❌* |
| `SPINE_SIZE_MISMATCH` | 책등 사이즈 불일치 | ✅ → ❌* |
| `SADDLE_STITCH_INVALID` | 사철 제본 규격 오류 (4의 배수 아님) | ✅ |
| `POST_PROCESS_CMYK` | 후가공 파일에 CMYK 색상 사용 | ❌ |
| `SPREAD_SIZE_MISMATCH` | 스프레드 사이즈 불일치 | ❌ |

> \* **C+ 게이팅 (2026-07-11, `WORKER_WIRED_FIXABLE_GATING` 기본 OFF)**: ON 이면
> 실행기가 배선된 fixMethod(`addBlankPages` 뿐)에만 `autoFixable=true` 가 부여된다.
> `SIZE_MISMATCH`·`SPINE_SIZE_MISMATCH`·(경고)`BLEED_MISSING` 은 실행기 미제공이라
> ON 시 `autoFixable=false`(fixMethod 필드는 유지). 상세: PDF_VALIDATION_GUIDE.md
> "자동 수정 가능 에러" 절.

### 자동 수정 방법 (fixMethod)

| 수정 방법 | 실행기 | 설명 |
|----------|------|------|
| `addBlankPages` | ✅ LIVE (`POST /worker-jobs/fix-pagecount(/external)`) | 빈 페이지 추가 |
| `extendBleed` | ❌ 미제공 | 재단 여백 확장 (계획) |
| `adjustSpine` | ❌ 미제공 | 책등 크기 조정 (자동화 비대상) |
| `resizeWithPadding` | ❌ 미제공 | 패딩으로 크기 조정 (계획) |

---

## WarningCode (경고 코드)

경고는 `isValid`에 영향을 주지 않습니다. 인쇄 품질에 영향을 줄 수 있어 주의가 필요합니다.

| 코드 | 설명 |
|------|------|
| `PAGE_COUNT_MISMATCH` | 페이지 수 불일치 (주문과 다름) |
| `BLEED_MISSING` | 재단 여백 없음 |
| `RESOLUTION_LOW` | 해상도 낮음 (300DPI 미만) |
| `LANDSCAPE_PAGE` | 가로형 페이지 감지 |
| `CENTER_OBJECT_CHECK` | 사철 제본 중앙부 객체 확인 필요 |
| `CMYK_STRUCTURE_DETECTED` | CMYK 색상 모드 감지 |
| `MIXED_PDF` | 혼합 PDF (표지+내지 다른 규격) |
| `TRANSPARENCY_DETECTED` | 투명도 효과 감지 |
| `OVERPRINT_DETECTED` | 오버프린트 설정 감지 |

---

## PdfMetadata

PDF에서 추출한 메타데이터입니다.

```typescript
interface PdfMetadata {
  pageCount: number;
  pageSize: { width: number; height: number };  // mm
  hasBleed: boolean;
  bleedSize?: number;     // mm
  spineSize?: number;     // mm
  resolution?: number;    // DPI
  colorMode?: string;     // 'RGB' | 'CMYK' | 'GRAY' | 'MIXED'
  spreadInfo?: {
    isSpread: boolean;
    score: number;        // 0-100
    confidence: 'high' | 'medium' | 'low';
    detectedType: 'single' | 'spread' | 'mixed';
  };
}
```

### 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `pageCount` | `number` | 페이지 수 |
| `pageSize` | `{width, height}` | 첫 페이지 크기 (mm) |
| `hasBleed` | `boolean` | 재단 여백 포함 여부 |
| `bleedSize` | `number?` | 재단 여백 크기 (mm) |
| `spineSize` | `number?` | 책등 크기 (mm, 표지용) |
| `resolution` | `number?` | 해상도 (DPI) |
| `colorMode` | `string?` | 색상 모드 |
| `spreadInfo` | `object?` | 스프레드 감지 정보 |

---

## 스프레드 감지

### SpreadDetectionResult

```typescript
interface SpreadDetectionResult {
  isSpread: boolean;
  score: number;         // 0-100
  confidence: 'high' | 'medium' | 'low';
  detectedType: 'single' | 'spread' | 'mixed';
  pageGroups?: PageGroup[];
  warnings: string[];
}
```

### 점수 계산

| 조건 | 점수 |
|------|------|
| 규격 일치 (너비 = 단면 × 2) | +60 |
| 높이 일치 | +20 |
| 비율 > 1.25 | +15 |
| 페이지 일관성 (표준편차 < 1mm) | +10 |

- **70점 이상**: 스프레드로 판정
- **80점 이상**: 신뢰도 high
- **60-79점**: 신뢰도 medium
- **60점 미만**: 신뢰도 low

---

## CMYK 2단계 검증

### ColorModeResult

```typescript
interface ColorModeResult {
  colorMode: 'CMYK' | 'RGB' | 'GRAY' | 'MIXED' | 'UNKNOWN';
  confidence: 'high' | 'medium' | 'low';
  cmykStructure: CmykStructureResult;
  inkCoverage?: InkCoverageResult;
  warnings: string[];
}
```

### 검증 프로세스

```
┌─────────────────────┐
│ 1차: 구조적 감지     │
│ (PDF 바이너리 검색) │
└─────────┬───────────┘
          │
    ┌─────▼─────┐
    │ CMYK 구조  │
    │   있음?   │
    └─────┬─────┘
          │
    Yes   │   No
    ┌─────▼─────┐  ┌───────────┐
    │ 2차: GS    │  │ RGB 확정   │
    │  inkcov   │  │ (신뢰도 중) │
    └─────┬─────┘  └───────────┘
          │
    ┌─────▼─────┐
    │ 결과 확정  │
    │ (신뢰도 고) │
    └───────────┘
```

### CmykStructureResult

```typescript
interface CmykStructureResult {
  hasCmykSignature: boolean;
  suspectedCmyk: boolean;
  signatures: string[];  // ['DeviceCMYK', 'CMYK_ICC_Profile', ...]
}
```

### InkCoverageResult

```typescript
interface InkCoverageResult {
  pages: InkCoveragePageResult[];
  totalCmykUsage: boolean;
  colorMode: 'CMYK' | 'RGB' | 'GRAY' | 'MIXED';
}

interface InkCoveragePageResult {
  page: number;
  cyan: number;     // 0-1
  magenta: number;  // 0-1
  yellow: number;   // 0-1
  black: number;    // 0-1
  hasCmykUsage: boolean;
}
```

---

## 별색 감지

### SpotColorResult

```typescript
interface SpotColorResult {
  hasSpotColors: boolean;
  spotColorNames: string[];
  pages: { page: number; colors: string[] }[];
}
```

### 감지 시그니처

| 시그니처 | 설명 |
|----------|------|
| `/Separation` | 별색 정의 |
| `/DeviceN` | 다중 색상 (별색 포함) |

---

## 투명도/오버프린트 감지

### TransparencyResult

```typescript
interface TransparencyResult {
  hasTransparency: boolean;
  hasOverprint: boolean;
  pages: { page: number; transparency: boolean; overprint: boolean }[];
}
```

### 감지 시그니처

| 시그니처 | 설명 |
|----------|------|
| `/ca` | 채우기 투명도 |
| `/CA` | 선 투명도 |
| `/BM` | 블렌드 모드 |
| `/OP`, `/op` | 오버프린트 |

---

## 이미지 해상도 감지

PDF 내 이미지의 유효 해상도(Effective DPI)를 분석하여 인쇄 품질 문제를 사전에 감지합니다.

### ImageResolutionResult

```typescript
interface ImageResolutionResult {
  /** 감지된 이미지 수 */
  imageCount: number;
  /** 저해상도 이미지 존재 여부 */
  hasLowResolution: boolean;
  /** 최소 해상도 (DPI) */
  minResolution: number;
  /** 평균 해상도 (DPI) */
  avgResolution: number;
  /** 저해상도 이미지 목록 */
  lowResImages: ImageInfo[];
  /** 모든 이미지 정보 */
  images: ImageInfo[];
}
```

### ImageInfo

```typescript
interface ImageInfo {
  /** 이미지 인덱스 */
  index: number;
  /** 이미지 픽셀 너비 */
  pixelWidth: number;
  /** 이미지 픽셀 높이 */
  pixelHeight: number;
  /** 페이지에서 표시되는 너비 (mm) */
  displayWidthMm: number;
  /** 페이지에서 표시되는 높이 (mm) */
  displayHeightMm: number;
  /** 수평 유효 해상도 (DPI) */
  effectiveDpiX: number;
  /** 수직 유효 해상도 (DPI) */
  effectiveDpiY: number;
  /** 최소 유효 해상도 (DPI) */
  minEffectiveDpi: number;
}
```

### 해상도 기준

| 항목 | 값 | 설명 |
|------|-----|------|
| `RECOMMENDED_DPI` | 300 | 인쇄 품질 권장 해상도 |
| `MIN_ACCEPTABLE_DPI` | 150 | 최소 허용 해상도 (이 값 미만 시 경고) |

### DPI 계산 공식

```
Effective DPI = (픽셀 크기 × 25.4) / 표시 크기(mm)
```

예: 2480×3508 픽셀 이미지가 A4(210×297mm)에 표시되는 경우
- DPI X = (2480 × 25.4) / 210 ≈ 300 DPI
- DPI Y = (3508 × 25.4) / 297 ≈ 300 DPI

### RESOLUTION_LOW 경고 예시

```json
{
  "code": "RESOLUTION_LOW",
  "message": "2개의 이미지가 권장 해상도(300DPI) 미만입니다. 인쇄 품질이 저하될 수 있습니다.",
  "details": {
    "minResolution": 72,
    "avgResolution": 120,
    "recommendedDpi": 300,
    "lowResImages": [
      {
        "index": 1,
        "pixelSize": "800x600",
        "effectiveDpi": 72
      },
      {
        "index": 3,
        "pixelSize": "1024x768",
        "effectiveDpi": 96
      }
    ]
  },
  "autoFixable": false
}
```

---

## 사용 예시

### 기본 검증

```typescript
const result = await pdfValidatorService.validate(
  'storage/uploads/12345.pdf',
  {
    fileType: 'content',
    orderOptions: {
      size: { width: 210, height: 297 },  // A4
      pages: 20,
      binding: 'perfect',
      bleed: 3,
    },
  }
);

if (result.isValid) {
  console.log('검증 통과');
} else {
  console.log('에러:', result.errors);
}
```

### 표지 검증 (책등 포함)

```typescript
const result = await pdfValidatorService.validate(
  'storage/uploads/cover.pdf',
  {
    fileType: 'cover',
    orderOptions: {
      size: { width: 210, height: 297 },
      pages: 100,            // 내지 페이지 수
      binding: 'perfect',
      bleed: 3,
      paperThickness: 0.1,   // 종이 두께 (mm)
    },
  }
);

console.log('책등 크기:', result.metadata.spineSize, 'mm');
```

### 사철 제본 검증

```typescript
const result = await pdfValidatorService.validate(
  'storage/uploads/booklet.pdf',
  {
    fileType: 'content',
    orderOptions: {
      size: { width: 210, height: 297 },
      pages: 16,
      binding: 'saddle',
      bleed: 3,
    },
  }
);

// 중앙부 경고 확인
const centerWarning = result.warnings.find(
  w => w.code === 'CENTER_OBJECT_CHECK'
);
```

### 스프레드 검증

```typescript
const result = await pdfValidatorService.validate(
  'storage/uploads/spread.pdf',
  {
    fileType: 'content',
    orderOptions: {
      size: { width: 216, height: 303 },  // 단면 크기
      pages: 20,                          // 스프레드 10페이지 = 단면 20페이지
      binding: 'perfect',
      bleed: 3,
    },
  }
);

if (result.metadata.spreadInfo?.isSpread) {
  console.log('스프레드 감지됨');
  console.log('점수:', result.metadata.spreadInfo.score);
  console.log('신뢰도:', result.metadata.spreadInfo.confidence);
}
```

---

## 참고 문서

- [운영 가이드](./PDF_VALIDATION_GUIDE.md)
- [기능 검토서](./PDF_VALIDATION_REVIEW.md)
- [WBS](./PDF_VALIDATION_WBS.md)
