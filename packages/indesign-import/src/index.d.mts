// @storige/indesign-import 타입 선언 (수작성). 런타임은 src/index.mjs.

export interface SpreadSpecLike {
  coverWidthMm: number;
  coverHeightMm: number;
  spineWidthMm: number;
  wingEnabled: boolean;
  wingWidthMm: number;
  cutSizeMm: number;
  safeSizeMm: number;
}

/** fabric Gradient 직렬화 colorStop (cmyk 등 추가 키는 fabric 이 보존 — slice) */
export interface GradientColorStopLike {
  offset: number;
  color: string;
  opacity?: number;
  cmyk?: number[];
  [key: string]: unknown;
}

/** fabric 5.5 Gradient 직렬화 plain object — Object._initGradient 로 자동 부활 */
export interface GradientFillLike {
  type: 'linear' | 'radial';
  coords: { x1: number; y1: number; x2: number; y2: number; r1?: number; r2?: number };
  colorStops: GradientColorStopLike[];
  gradientUnits: 'pixels';
  offsetX: number;
  offsetY: number;
}

export interface FabricObjectLike {
  type: string;
  left: number;
  top: number;
  width?: number;
  height?: number;
  angle?: number;
  fill?: string | GradientFillLike;
  cmykFill?: number[];
  stroke?: string;
  strokeWidth?: number;
  /** Oval=타원 반경(width/2), Rectangle=라운드 코너 반경(A6, 균일 RoundedCorner) — fabric native 키(왕복 안전) */
  rx?: number;
  ry?: number;
  path?: string;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  isUserAdded?: boolean;
  /** image 객체 CORS 로드 모드 — 변환기는 'anonymous' 명시(편집기 캔버스 taint 방어). */
  crossOrigin?: 'anonymous' | 'use-credentials' | '' | null;
  meta?: { regionRef: string | null; anchor: unknown };
  _idml?: { self: string; srcType: string; points: number };
  [key: string]: unknown;
}

export interface DraftTemplateDto {
  name: string;
  type: 'spread';
  width: number;
  height: number;
  canvasData: {
    version: string;
    width: number;
    height: number;
    objects: FabricObjectLike[];
  };
  spreadConfig: {
    version: number;
    spec: SpreadSpecLike;
    regions: { kind: string; x: number; width: number }[];
    totalWidthMm: number;
    totalHeightMm: number;
    /** 변환 모드 스탬프: vector='full', hybrid='flat-spread', flat-spine='flat-spine'. 미존재 시 'full'. */
    conversionMode?: 'full' | 'flat-spread' | 'flat-spine';
  };
}

export interface SpreadTemplateResult {
  spec: SpreadSpecLike;
  regionsMm: { kind: string; xMm: number; widthMm: number }[];
  totalWidthMm: number;
  objects: FabricObjectLike[];
  fonts: string[];
  warnings: string[];
  draftTemplateDto: DraftTemplateDto;
}

export interface SinglePageDto {
  name: string;
  type: 'page' | 'cover';
  width: number;
  height: number;
  canvasData: {
    version: string;
    width: number;
    height: number;
    objects: FabricObjectLike[];
  };
}

export interface SinglePageResult {
  draftTemplateDto: SinglePageDto;
  widthMm: number;
  heightMm: number;
  textCount: number;
  rasterCount: number;
  warnings: string[];
  fonts: string[];
}

/** 동반 업로드 이미지: Link 파일명(NFC, 대소문자 무시 매칭) → dataURL. Map 또는 plain object. */
export type LinkedImages = Map<string, string> | Record<string, string>;

export function convertPsdToTemplate(
  buffer: ArrayBuffer | Uint8Array,
  opts?: {
    name?: string;
    pageType?: 'page' | 'cover';
    previewWidth?: number;
    /** IDML 과의 시그니처 통일용 — PSD 는 픽셀 내장이라 현재 미소비(무해). */
    linkedImages?: LinkedImages;
  }
): Promise<{ result: SinglePageResult; dto: SinglePageDto; previewSvg: string }>;

/** parseGradients 스톱 항목 — StopColor 참조 해석 결과(미해석 시 color null + unknown) */
export interface GradientStopDef {
  offset: number;
  color: string | null;
  midpoint: number;
  stopColorId: string | null;
  cmyk?: number[];
  isSpot?: boolean;
  spotName?: string;
  isPaper?: boolean;
  isNone?: boolean;
  unknown?: string;
}

/** Graphic.xml 의 그라디언트 정의 */
export interface GradientDef {
  self: string;
  type: 'linear' | 'radial';
  name: string | null;
  stops: GradientStopDef[];
}

export interface IdmlDoc {
  pages: { self: string; name: string; widthPt: number; heightPt: number; leftSpreadPt: number; topSpreadPt: number }[];
  items: unknown[];
  colors: Map<string, { space: string; value: number[]; hex: string | null }>;
  gradients: Map<string, GradientDef>;
  fonts: string[];
  bleedPt: number | null;
}

export function parseIdml(buffer: ArrayBuffer | Uint8Array): Promise<IdmlDoc>;
/** Resources/Graphic.xml 문자열 → 그라디언트 정의 Map (스톱 색 참조는 같은 XML 의 색 정의로 hex 화) */
export function parseGradients(xml: string): Map<string, GradientDef>;
export function toSpreadTemplate(
  doc: IdmlDoc,
  opts?: { name?: string; dpi?: number }
): SpreadTemplateResult;
export function buildPreviewSvg(dto: DraftTemplateDto, opts?: { width?: number }): string;
export function colorToHex(space: string, value: number[]): string | null;
export function convertIdmlToTemplate(
  buffer: ArrayBuffer | Uint8Array,
  opts?: {
    name?: string;
    dpi?: number;
    previewWidth?: number;
    mode?: 'vector' | 'hybrid' | 'flat-spine';
    rasterDpi?: number;
    /**
     * placed 이미지 복원(A5): IDML Link 파일명과 매칭되는 동반 업로드 이미지.
     * 매칭 프레임은 회색 플레이스홀더 대신 실제 image 객체(크롭 베이크 PNG)로 치환되고
     * (FULL=편집 가능, FLAT=래스터 베이크), 미제공/미매칭은 기존 플레이스홀더+경고 유지.
     */
    linkedImages?: LinkedImages;
  }
): Promise<{
  result: SpreadTemplateResult & { placedApplied: PlacedAppliedSummary };
  dto: DraftTemplateDto;
  previewSvg: string;
}>;

/** applyPlacedImages 적용 요약 — convertIdmlToTemplate 의 result 에 항상 부가된다(미제공 시 matched 0/failed []). */
export interface PlacedAppliedSummary {
  matched: number;
  failed: { fileName: string; reason: string }[];
}

/**
 * toSpreadTemplate 결과의 meta.placed 디스크립터를 동반 업로드 이미지로 치환(인덱스/z-order
 * 보존). linkedImages 미제공 시 디스크립터만 제거(기존 출력과 동일 — 하위호환).
 */
export function applyPlacedImages(
  result: SpreadTemplateResult,
  linkedImages?: LinkedImages | null
): Promise<SpreadTemplateResult & { placedApplied: PlacedAppliedSummary }>;

/**
 * dataURL 이미지에서 정규화 크롭(GraphicBounds 0..1)을 잘라 PNG 베이크.
 * flipX/flipY 는 픽셀 미러로 베이크. 브라우저=canvas, Node=sharp(dual-env).
 */
export function bakeCroppedImage(
  dataUrl: string,
  cropNorm: { x: number; y: number; w: number; h: number },
  opts?: { flipX?: boolean; flipY?: boolean }
): Promise<{ dataUrl: string; widthPx: number; heightPx: number }>;

/**
 * 디자인 패키지 zip 해제(A5) — 순수 IDML(designmap.xml)과 패키지 zip(*.idml + Links 이미지)
 * 판별. 이미지 엔트리는 파일명(NFC) → dataURL Map, 브라우저 디코드 불가 형식은 skipped.
 */
export function extractDesignPackage(buffer: ArrayBuffer | Uint8Array): Promise<{
  kind: 'idml' | 'package';
  idmlBuffer: ArrayBuffer | Uint8Array | null;
  linkedImages: Map<string, string>;
  skipped: string[];
}>;

/** flat-spine 모드 크롭 지오메트리(순수 함수). 경계 px 합 = 전폭 px 보장, spine 은 책등 중심 3배폭. */
export function computeFlatSpineCrops(
  spec: SpreadSpecLike,
  opts?: { dpi?: number }
): {
  dpi: number;
  fullWidthPx: number;
  fullHeightPx: number;
  totalWidthMm: number;
  spineLeftPx: number;
  spineRightPx: number;
  spineCenterMm: number;
  back: { left: number; width: number; centerPx: number };
  front: { left: number; width: number; centerPx: number };
  spine: { left: number; width: number; centerPx: number };
};

export declare const units: typeof import('./geometry/units.mjs');
export declare const regions: typeof import('./geometry/regions.mjs');
