/**
 * 검증 에러 코드
 * 기획 문서와 통일된 코드
 * @see docs/PDF_VALIDATION_WBS.md - WBS 1.2
 */
export enum ErrorCode {
  /** 지원하지 않는 파일 형식 */
  UNSUPPORTED_FORMAT = 'UNSUPPORTED_FORMAT',
  /** 손상된 파일 */
  FILE_CORRUPTED = 'FILE_CORRUPTED',
  /** 파일 크기 초과 */
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  /** 페이지 수 오류 (제본 방식에 맞지 않음) */
  PAGE_COUNT_INVALID = 'PAGE_COUNT_INVALID',
  /** 페이지 수 초과 */
  PAGE_COUNT_EXCEEDED = 'PAGE_COUNT_EXCEEDED',
  /** 페이지 사이즈 불일치 */
  SIZE_MISMATCH = 'SIZE_MISMATCH',
  /** 책등 사이즈 불일치 */
  SPINE_SIZE_MISMATCH = 'SPINE_SIZE_MISMATCH',
  /** 사철 제본 규격 오류 (4의 배수 아님) */
  SADDLE_STITCH_INVALID = 'SADDLE_STITCH_INVALID',
  /** 후가공 파일에 CMYK 색상 사용 */
  POST_PROCESS_CMYK = 'POST_PROCESS_CMYK',
  /** 스프레드 사이즈 불일치 */
  SPREAD_SIZE_MISMATCH = 'SPREAD_SIZE_MISMATCH',
}

/**
 * 검증 경고 코드
 * @see docs/PDF_VALIDATION_WBS.md - WBS 1.2
 */
export enum WarningCode {
  /** 페이지 수 불일치 (주문과 다름) */
  PAGE_COUNT_MISMATCH = 'PAGE_COUNT_MISMATCH',
  /** 재단 여백 없음 */
  BLEED_MISSING = 'BLEED_MISSING',
  /** 해상도 낮음 */
  RESOLUTION_LOW = 'RESOLUTION_LOW',
  /**
   * 가로형 페이지 감지 (레거시 — 하위호환 위해 enum 값 유지).
   * 무차별 페이지별 emit 은 제거됨. 신규 동작은
   * MIXED_PAGE_ORIENTATION / ORIENTATION_MISMATCH 로 집계 노출.
   */
  LANDSCAPE_PAGE = 'LANDSCAPE_PAGE',
  /** 페이지 방향 혼재 (세로·가로 섞임, 주문 방향 미지정/auto일 때 1건 집계) */
  MIXED_PAGE_ORIENTATION = 'MIXED_PAGE_ORIENTATION',
  /** 주문 의도 방향과 다른 페이지 존재 (expectedOrientation 명시 시 1건 집계) */
  ORIENTATION_MISMATCH = 'ORIENTATION_MISMATCH',
  /** 책자 총 페이지가 홀수 (보통 짝수면으로 제작 — 확인 권장) */
  ODD_PAGE_COUNT = 'ODD_PAGE_COUNT',
  /** 주문 상품의 최소 페이지수 미만 (데이터 주도 pageCountMin, 비차단 — 고객 선택/확인 유도) */
  PAGE_COUNT_BELOW_MIN = 'PAGE_COUNT_BELOW_MIN',
  /** 사철 제본 중앙부 객체 확인 필요 */
  CENTER_OBJECT_CHECK = 'CENTER_OBJECT_CHECK',
  /** CMYK 구조 감지 (GS 미확정) */
  CMYK_STRUCTURE_DETECTED = 'CMYK_STRUCTURE_DETECTED',
  /** 혼합 PDF (표지+내지 다른 규격) */
  MIXED_PDF = 'MIXED_PDF',
  /** 투명도 감지 */
  TRANSPARENCY_DETECTED = 'TRANSPARENCY_DETECTED',
  /** 오버프린트 감지 */
  OVERPRINT_DETECTED = 'OVERPRINT_DETECTED',
  /** 임베딩되지 않은 폰트 감지 (아웃라인/임베딩 권장) */
  FONT_NOT_EMBEDDED = 'FONT_NOT_EMBEDDED',
  /** 별색(Spot Color) 사용 감지 (주문 전 확인 권장) */
  SPOT_COLOR_DETECTED = 'SPOT_COLOR_DETECTED',
  // ── C-2a: crop mark(재단 기하) 검증 — 전부 비차단 warning, error 승격 금지 ──
  /** 재단 기하(TrimBox) 미선언 — 재단선 확인 불가(정보). cropMarkEnabled opt-in 잡 한정 */
  TRIMBOX_MISSING = 'TRIMBOX_MISSING',
  /** 선언된 TrimBox 크기가 주문 재단 사이즈와 불일치 */
  TRIMBOX_SIZE_MISMATCH = 'TRIMBOX_SIZE_MISMATCH',
  /** TrimBox↔MediaBox/BleedBox 블리드 기하 부정합 (TrimBox 이탈 또는 BleedBox 크기 불일치) */
  TRIMBOX_BLEED_INCONSISTENT = 'TRIMBOX_BLEED_INCONSISTENT',
}

/**
 * 검증 에러 정보
 */
export interface ValidationError {
  /** 에러 코드 */
  code: ErrorCode;
  /** 사용자 표시 메시지 */
  message: string;
  /** 상세 정보 (유연한 구조) */
  details: Record<string, any>;
  /** 자동 수정 가능 여부 */
  autoFixable: boolean;
  /** 수정 방법 */
  fixMethod?: 'addBlankPages' | 'extendBleed' | 'adjustSpine' | 'resizeWithPadding';
}

/**
 * 검증 경고 정보
 */
export interface ValidationWarning {
  /** 경고 코드 */
  code: WarningCode;
  /** 사용자 표시 메시지 */
  message: string;
  /** 상세 정보 */
  details?: any;
  /** 자동 수정 가능 여부 */
  autoFixable: boolean;
  /** 수정 방법 */
  fixMethod?: string;
}

/**
 * PDF 메타데이터
 */
export interface PdfMetadata {
  /** 페이지 수 */
  pageCount: number;
  /** 페이지 크기 (mm) */
  pageSize: {
    width: number;
    height: number;
  };
  /** 재단 여백 포함 여부 */
  hasBleed: boolean;
  /** 재단 여백 크기 (mm) */
  bleedSize?: number;
  /** 책등 크기 (mm) */
  spineSize?: number;
  /** 해상도 (DPI) */
  resolution?: number;
  /** 컬러 모드 */
  colorMode?: string;
  /** 스프레드 감지 정보 */
  spreadInfo?: {
    /** 스프레드 형식 여부 */
    isSpread: boolean;
    /** 감지 점수 (0-100) */
    score: number;
    /** 신뢰도 */
    confidence: 'high' | 'medium' | 'low';
    /** 감지된 PDF 타입 */
    detectedType: 'single' | 'spread' | 'mixed';
  };
  /** 별색 포함 여부 */
  hasSpotColors?: boolean;
  /** 별색 이름 목록 */
  spotColors?: string[];
  /** 투명도 포함 여부 */
  hasTransparency?: boolean;
  /** 오버프린트 포함 여부 */
  hasOverprint?: boolean;
  /** 이미지 개수 */
  imageCount?: number;
  /** 감지된 폰트 수 */
  fontCount?: number;
  /** 임베딩되지 않은 폰트 존재 여부 */
  hasUnembeddedFonts?: boolean;
  /** 임베딩되지 않은 폰트 이름 목록 */
  unembeddedFonts?: string[];
  /** C-2a: 첫 페이지 TrimBox 크기(mm, 소수1자리) — TrimBox 명시 선언 시에만 기록 */
  trimBox?: { width: number; height: number };
  /** C-2a: 재단 기하(TrimBox) 명시 선언 여부 — crop mark 검증 수행 시에만 기록 */
  hasCropMarkGeometry?: boolean;
}

/**
 * 검증 결과 DTO
 */
export interface ValidationResultDto {
  /** 검증 통과 여부 */
  isValid: boolean;
  /** 에러 목록 */
  errors: ValidationError[];
  /** 경고 목록 */
  warnings: ValidationWarning[];
  /** PDF 메타데이터 */
  metadata: PdfMetadata;
}

/**
 * 검증 옵션
 */
export interface ValidationOptions {
  /** 파일 타입 (cover: 표지, content: 내지, post_process: 후가공) */
  fileType: 'cover' | 'content' | 'post_process';
  /** 주문 옵션 */
  orderOptions: {
    /** 판형 크기 (mm) */
    size: {
      width: number;
      height: number;
    };
    /** 주문 페이지 수 */
    pages: number;
    /** 제본 방식 */
    binding: 'perfect' | 'saddle' | 'spring';
    /** 재단 여백 (mm) */
    bleed: number;
    /** 종이 두께 (mm, 책등 계산 fallback용) */
    paperThickness?: number;
    /**
     * 책등 폭 (mm) — 프런트가 /products/spine/calculate 로 계산한 권위 값.
     * 제공 시 표지 책등 검증이 이 값을 직접 사용(bindingMargin 포함). 미제공 시 paperThickness 로 fallback 재계산.
     */
    spineWidthMm?: number;
    /** 날개(wing/flap) 사용 여부 — 표지 총너비 = ... + (wingEnabled ? wingWidthMm×2 : 0) */
    wingEnabled?: boolean;
    /** 날개 한쪽 폭 (mm) */
    wingWidthMm?: number;
    /**
     * 사방(per-edge) 블리드 mm — 상품별 설정값(P1). P4: validatePageSize 가
     * 작업사이즈 비교 시 사용(workSize 미제공 시 trim + bleedMm*2 로 파생).
     */
    bleedMm?: number;
    /** 재단선 마커 표기 ON/OFF (P1). */
    cropMarkEnabled?: boolean;
    /**
     * 고객 업로드 PDF 사이즈 검증 허용오차(mm) — P4 validatePageSize tolerance.
     * 미제공 시 1mm(현행 기본) 유지. ⚠️ 0.2mm 로 좁히지 말 것(단계 인하는 별도).
     */
    sizeToleranceMm?: number;
    /** 재단(완성) 사이즈(mm) — P1. 미제공 시 size 를 재단으로 간주. */
    trimSize?: { width: number; height: number };
    /** 작업 사이즈(재단 + bleedMm*2, mm) — P1. validatePageSize 매칭 케이스에 사용. */
    workSize?: { width: number; height: number };
    /**
     * 주문 의도 페이지 방향 (R3). 'portrait'/'landscape' 명시 시 그와 다른 페이지를
     * ORIENTATION_MISMATCH 로 1건 집계. 미제공/'auto' 면 혼재일 때만
     * MIXED_PAGE_ORIENTATION 으로 1건 집계(단일 방향이면 경고 없음 — 가로책 오탐 해소).
     */
    expectedOrientation?: 'portrait' | 'landscape' | 'auto';
    /**
     * 내지 페이지수 배수(데이터 주도 계약, 2026-06-25). 제공 시 worker 가 binding 하드코딩 대신
     * `actual % pageMultiple !== 0` → PAGE_COUNT_INVALID(에러·자동수정 addBlankPages)로 검증.
     * 미제공 시 binding 기반 레거시 분기로 폴백(byte-identical). 파트너가 제본별 값 전달(무선=2/양장=4/중철=4/스프링=8 등).
     */
    pageMultiple?: number;
    /** 제본별 페이지수 상한(예 중철 64). 제공 시 `actual > max` → PAGE_COUNT_EXCEEDED(에러). 미제공 시 레거시(saddle 64) 폴백. */
    pageCountMax?: number;
    /** 제본별 페이지수 하한(예 무선 32). 제공 시 `actual < min` → PAGE_COUNT_BELOW_MIN(경고·비차단, 고객 선택). 미제공 시 미검사. */
    pageCountMin?: number;
  };
  /** 최대 허용 파일 크기 (bytes) */
  maxFileSize?: number;
  /** 최대 허용 페이지 수 */
  maxPages?: number;
}

// ============================================================
// 스프레드(펼침면) 감지 관련 타입
// @see docs/PDF_VALIDATION_WBS.md - WBS 1.2
// ============================================================

/**
 * 페이지 그룹 정보 (혼합 PDF용)
 */
export interface PageGroup {
  /** 시작 페이지 인덱스 */
  startIndex: number;
  /** 종료 페이지 인덱스 */
  endIndex: number;
  /** 그룹 타입 */
  type: 'single' | 'spread';
  /** 페이지 너비 (mm) */
  widthMm: number;
  /** 페이지 높이 (mm) */
  heightMm: number;
}

/**
 * 스프레드 감지 결과
 */
export interface SpreadDetectionResult {
  /** 스프레드 형식 여부 */
  isSpread: boolean;
  /** 감지 점수 (0-100) */
  score: number;
  /** 신뢰도 */
  confidence: 'high' | 'medium' | 'low';
  /** 감지된 PDF 타입 */
  detectedType: 'single' | 'spread' | 'mixed';
  /** 페이지 그룹 (혼합 PDF용) */
  pageGroups?: PageGroup[];
  /** 경고 메시지 */
  warnings: string[];
}

// ============================================================
// CMYK 감지 관련 타입
// @see docs/PDF_VALIDATION_WBS.md - WBS 1.2
// ============================================================

/**
 * 1차 구조적 CMYK 감지 결과
 */
export interface CmykStructureResult {
  /** CMYK 시그니처 존재 여부 */
  hasCmykSignature: boolean;
  /** CMYK 의심 여부 (DeviceCMYK, ICC Profile, CMYK Image) */
  suspectedCmyk: boolean;
  /** 감지된 시그니처 목록 */
  signatures: string[];
}

/**
 * Ghostscript inkcov 분석 결과 (페이지별)
 */
export interface InkCoveragePageResult {
  /** 페이지 번호 */
  page: number;
  /** Cyan 사용량 (0-1) */
  cyan: number;
  /** Magenta 사용량 (0-1) */
  magenta: number;
  /** Yellow 사용량 (0-1) */
  yellow: number;
  /** Black(K) 사용량 (0-1) */
  black: number;
  /** CMY 색상 사용 여부 (K 제외) */
  hasCmykUsage: boolean;
}

/**
 * Ghostscript inkcov 분석 결과
 */
export interface InkCoverageResult {
  /** 페이지별 잉크 커버리지 */
  pages: InkCoveragePageResult[];
  /** 전체 CMYK 사용 여부 */
  totalCmykUsage: boolean;
  /** 감지된 컬러 모드 */
  colorMode: 'CMYK' | 'RGB' | 'GRAY' | 'MIXED';
}

/**
 * 통합 컬러 모드 감지 결과
 */
export interface ColorModeResult {
  /** 최종 컬러 모드 */
  colorMode: 'CMYK' | 'RGB' | 'GRAY' | 'MIXED' | 'UNKNOWN';
  /** 신뢰도 */
  confidence: 'high' | 'medium' | 'low';
  /** 1차 구조적 감지 결과 */
  cmykStructure: CmykStructureResult;
  /** 2차 GS inkcov 결과 (선택적) */
  inkCoverage?: InkCoverageResult;
  /** 경고 메시지 */
  warnings: string[];
}

// ============================================================
// 별색/투명도/오버프린트 감지 관련 타입
// @see docs/PDF_VALIDATION_WBS.md - WBS 1.2
// ============================================================

/**
 * 별색(Spot Color) 감지 결과
 */
export interface SpotColorResult {
  /** 별색 존재 여부 */
  hasSpotColors: boolean;
  /** 별색 이름 목록 */
  spotColorNames: string[];
  /** 페이지별 별색 정보 */
  pages: { page: number; colors: string[] }[];
}

/**
 * 투명도/오버프린트 감지 결과
 */
export interface TransparencyResult {
  /** 투명도 사용 여부 */
  hasTransparency: boolean;
  /** 오버프린트 사용 여부 */
  hasOverprint: boolean;
  /** 페이지별 정보 */
  pages: { page: number; transparency: boolean; overprint: boolean }[];
}

// ============================================================
// 해상도 감지 관련 타입
// ============================================================

/**
 * 이미지 정보
 */
export interface ImageInfo {
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

/**
 * 해상도 감지 결과
 */
export interface ImageResolutionResult {
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

// ============================================================
// 폰트 감지 관련 타입
// ============================================================

/**
 * 폰트 정보
 */
export interface FontInfo {
  /** 폰트 이름 */
  name: string;
  /** 폰트 타입 (TrueType, Type1, CID, OpenType 등) */
  type: string;
  /** 임베딩 여부 */
  embedded: boolean;
  /** 서브셋 여부 */
  subset: boolean;
  /** 인코딩 */
  encoding?: string;
}

/**
 * 폰트 감지 결과
 */
export interface FontDetectionResult {
  /** 감지된 폰트 수 */
  fontCount: number;
  /** 사용된 폰트 목록 */
  fonts: FontInfo[];
  /** 임베딩되지 않은 폰트 존재 여부 */
  hasUnembeddedFonts: boolean;
  /** 임베딩되지 않은 폰트 목록 */
  unembeddedFonts: string[];
  /** 모든 폰트 임베딩 여부 */
  allFontsEmbedded: boolean;
}
