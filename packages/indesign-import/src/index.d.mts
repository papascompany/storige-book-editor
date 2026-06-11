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

export interface FabricObjectLike {
  type: string;
  left: number;
  top: number;
  width?: number;
  height?: number;
  angle?: number;
  fill?: string;
  cmykFill?: number[];
  stroke?: string;
  strokeWidth?: number;
  path?: string;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  isUserAdded?: boolean;
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

export function convertPsdToTemplate(
  buffer: ArrayBuffer | Uint8Array,
  opts?: { name?: string; pageType?: 'page' | 'cover'; previewWidth?: number }
): Promise<{ result: SinglePageResult; dto: SinglePageDto; previewSvg: string }>;

export interface IdmlDoc {
  pages: { self: string; name: string; widthPt: number; heightPt: number; leftSpreadPt: number; topSpreadPt: number }[];
  items: unknown[];
  colors: Map<string, { space: string; value: number[]; hex: string | null }>;
  fonts: string[];
  bleedPt: number | null;
}

export function parseIdml(buffer: ArrayBuffer | Uint8Array): Promise<IdmlDoc>;
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
  }
): Promise<{ result: SpreadTemplateResult; dto: DraftTemplateDto; previewSvg: string }>;

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
