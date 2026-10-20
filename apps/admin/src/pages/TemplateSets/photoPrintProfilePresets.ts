/**
 * 사진인화 상품 프리셋 4종 (P2-d, 2026-10-19) — 템플릿셋 폼 "사진인화 프리셋 적용" 용.
 *
 * ※ 오너 확정 전 기본값: 사이즈(4x6 102×152mm·카드 90×54mm·minDpi), 업로드 한도(maxPhotos/maxMb), 유테 폭(borderInsetMm 2),
 *    매수 범위(1~99), 도련 정책(digital = 캘린더 정책 A 준용 재단선+3mm, chemical = 미니랩 풀블리드 가정 0mm)은
 *    설계 §13·P2 계획의 openDecisions 항목이다. 프로파일 값이므로 확정 후 이 파일의 수치만 바꾸면 된다.
 *
 * - photo_chem            : 인화(chemical) — 단면 1캔버스/장, 자유 뒷면 없음, 단일 PDF
 * - photo_digital_items   : 인쇄 ① — 양면(canvas-pair, same-sheet), 자유 뒷면, sheet-map per-sheet
 * - photo_digital_fixedback: 인쇄 ② — 위와 같되 뒷면 고정(backTemplateId 필수 — 적용 뒤 JSON 에서 템플릿 id 로 치환)
 * - photo_digital_sheet   : 인쇄 ③ — 카드형(sheet-cards), 앞/뒤 1쌍 = 1장
 * 동작 분기는 editorType 이 아니라 프로파일 필드(pages·sheet·photoPrint·output)로만 한다.
 */
import {
  EditorMode,
  type PhotoPrintProfile,
  type PhotoPrintSize,
  type ProductPageStep,
  type ProductProfile,
} from '@storige/types';

export interface PhotoPrintProfilePreset {
  key: string;
  label: string;
  /** 판형 mm(= sizes[0].widthMm/heightMm) */
  width: number;
  height: number;
  profile: ProductProfile;
}

/**
 * ② 고정 뒷면 프리셋의 backTemplateId 자리표시. validate 는 비어 있지 않은 문자열만 요구하므로 통과하지만,
 * 운영자는 적용 뒤 JSON 에서 실제 뒷면 템플릿 id(템플릿셋 refs[1] 과 같은 id)로 바꿔야 한다.
 */
export const PHOTO_PRINT_BACK_TEMPLATE_ID_PLACEHOLDER = 'REPLACE_WITH_BACK_TEMPLATE_ID';

/** 오너 확정 전 기본 사이즈 — chemical/①/② 4x6, ③ 카드형 90×54 */
const SIZE_4X6: PhotoPrintSize = { code: '4x6', widthMm: 102, heightMm: 152, minDpi: 200 };
const SIZE_CARD: PhotoPrintSize = { code: 'card-90x54', widthMm: 90, heightMm: 54, minDpi: 300 };

/** 옵션 허용 어휘(첫 원소 = 세션 기본값) + 보조 옵션 제공 여부 — 오너 확정 전 기본값 */
const DEFAULT_OPTIONS: PhotoPrintProfile['options'] = {
  border: ['none', 'white'],
  fit: ['paper-full', 'image-full'],
  finish: ['matte', 'glossy'],
  brightnessFix: true,
  dateOverlay: true,
  grayscale: true,
  borderInsetMm: 2,
};
const DEFAULT_COPIES: PhotoPrintProfile['copies'] = { min: 1, max: 99 };

function chemicalProfile(editorType: string, size: PhotoPrintSize): ProductProfile {
  return {
    version: 1,
    kind: 'photo-print',
    editorType,
    pages: { kind: 'range', min: 1, max: 200, step: 1, labelRule: 'photo' },
    sheet: { faces: 1, canvasLayout: 'canvas-per-sheet', binding: 'none', backRotation: 0, duplexFlip: 'short-edge' },
    photoPrint: {
      process: 'chemical',
      composition: 'per-photo-free-back',
      sizes: [size],
      options: { ...DEFAULT_OPTIONS },
      copies: { ...DEFAULT_COPIES },
      upload: { maxPhotos: 200, maxMb: 25 },
    },
    output: { mode: 'single-pdf' },
  };
}

function digitalProfile(
  editorType: string,
  size: PhotoPrintSize,
  composition: PhotoPrintProfile['composition'],
  backTemplateId?: string,
): ProductProfile {
  return {
    version: 1,
    kind: 'photo-print',
    editorType,
    pages: { kind: 'range', min: 2, max: 400, step: 2, labelRule: 'photo' },
    sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'none', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
    photoPrint: {
      process: 'digital',
      composition,
      sizes: [size],
      options: { ...DEFAULT_OPTIONS },
      copies: { ...DEFAULT_COPIES },
      ...(backTemplateId !== undefined ? { backTemplateId } : {}),
      upload: { maxPhotos: 400, maxMb: 25 },
    },
    output: { mode: 'sheet-map', sheetFiles: 'per-sheet' },
  };
}

export const PHOTO_PRINT_PROFILE_PRESETS: readonly PhotoPrintProfilePreset[] = [
  {
    key: 'photo_chem',
    label: '사진인화 — 인화(미니랩) 4x6 (102×152)',
    width: SIZE_4X6.widthMm,
    height: SIZE_4X6.heightMm,
    profile: chemicalProfile('photo_chem', SIZE_4X6),
  },
  {
    key: 'photo_digital_items',
    label: '사진인화 — 인쇄 ① 자유 뒷면 4x6 (102×152)',
    width: SIZE_4X6.widthMm,
    height: SIZE_4X6.heightMm,
    profile: digitalProfile('photo_digital_items', SIZE_4X6, 'per-photo-free-back'),
  },
  {
    key: 'photo_digital_fixedback',
    label: '사진인화 — 인쇄 ② 고정 뒷면 4x6 (102×152)',
    width: SIZE_4X6.widthMm,
    height: SIZE_4X6.heightMm,
    profile: digitalProfile('photo_digital_fixedback', SIZE_4X6, 'per-photo-fixed-back', PHOTO_PRINT_BACK_TEMPLATE_ID_PLACEHOLDER),
  },
  {
    key: 'photo_digital_sheet',
    label: '사진인화 — 인쇄 ③ 카드형 (90×54)',
    width: SIZE_CARD.widthMm,
    height: SIZE_CARD.heightMm,
    profile: digitalProfile('photo_digital_sheet', SIZE_CARD, 'sheet-cards'),
  },
];

export function findPhotoPrintProfilePreset(key: string | undefined): PhotoPrintProfilePreset | undefined {
  return PHOTO_PRINT_PROFILE_PRESETS.find((p) => p.key === key);
}

/**
 * 프리셋 적용 시 채울 템플릿셋 폼 필드 값(TemplateSetForm 의 Form 필드명 기준).
 * - 단일 모드·양면 원파일·내지 추가 가능·페이지 범위 = pages.min/max·증감 단위 = pages.step(digital 2 / chemical 1)·JSON textarea.
 * - 도련: digital 은 캘린더 정책 A 준용(재단선 마커 + 3mm), chemical 은 미니랩 풀블리드 가정(마커 없음 + 0mm) — 오너 확정 전.
 * 순수 함수 — 폼 컴포넌트 테스트 없이 값 계약을 고정한다.
 */
export interface PhotoPrintPresetFormValues {
  width: number;
  height: number;
  editorMode: EditorMode;
  pdfOutputMode: 'duplex-merged';
  canAddPage: true;
  pageCountMin: number;
  pageCountMax: number;
  pageStep: ProductPageStep;
  productProfileJson: string;
  cropMarkEnabled: boolean;
  bleedMm: number;
}

type PhotoPrintPresetFormValuesSource = Pick<PhotoPrintProfilePreset, 'width' | 'height' | 'profile'>;

export function photoPrintPresetFormValues(preset: PhotoPrintPresetFormValuesSource): PhotoPrintPresetFormValues {
  const { profile } = preset;
  const isDigital = profile.photoPrint?.process === 'digital';
  return {
    width: preset.width,
    height: preset.height,
    editorMode: EditorMode.SINGLE,
    pdfOutputMode: 'duplex-merged',
    canAddPage: true,
    pageCountMin: profile.pages.min ?? 1,
    pageCountMax: profile.pages.max ?? 1,
    pageStep: profile.pages.step ?? (isDigital ? 2 : 1),
    productProfileJson: JSON.stringify(profile, null, 2),
    // 도련 정책: digital 은 캘린더 정책 A(재단선 마커 + 3mm — 편집기 PDF 재단+6mm·TrimBox, 워커 작업사이즈 판정),
    // chemical 은 미니랩 풀블리드 가정(마커 없음·0mm). 오너 확정 전 기본값.
    cropMarkEnabled: isDigital,
    bleedMm: isDigital ? 3 : 0,
  };
}

/**
 * 템플릿셋 폼 "상품 프로파일" 섹션 안내 문구 (D7, 2026-10-19) — kind 중립.
 * 캘린더 프리셋만 선택돼 있으면 P1 캘린더 안내(페이지 수 26·내지 추가 불가)를 그대로, 사진인화 프리셋만 선택돼 있으면 사진인화 안내
 * (페이지 범위·증감 단위·내지 추가 가능·도련 digital 3mm/chemical 0mm)를, 그 외(미선택·둘 다 선택)는 공통 안내를 돌려준다.
 * 순수 함수 — 폼 컴포넌트 테스트 없이 문구 계약을 고정한다.
 */
export interface ProductProfilePresetSelection {
  calendar: boolean;
  photoPrint: boolean;
}

export const PRODUCT_PROFILE_SECTION_HINT_COMMON =
  '프리셋을 적용하면 판형(가로·세로)·에디터 모드(단일)·PDF 생성 방식(양면 원파일)·페이지 설정·재단선/도련이 함께 설정되고 아래 JSON 이 채워집니다. ' +
  '비워 두면 프로파일 없음(기존 동작)입니다.';
export const PRODUCT_PROFILE_SECTION_HINT_CALENDAR =
  '프리셋을 적용하면 판형(가로·세로)·에디터 모드(단일)·PDF 생성 방식(양면 원파일)·내지 추가 불가·페이지 수 26 이 함께 설정되고 아래 JSON 이 채워집니다. ' +
  '비워 두면 프로파일 없음(기존 동작)입니다.';
export const PRODUCT_PROFILE_SECTION_HINT_PHOTO_PRINT =
  '프리셋을 적용하면 판형(가로·세로)·에디터 모드(단일)·PDF 생성 방식(양면 원파일)·내지 추가 가능·페이지 범위·증감 단위·' +
  '재단선/도련(인쇄 3mm · 인화 0mm, 오너 확정 전 기본값)이 함께 설정되고 아래 JSON 이 채워집니다. 비워 두면 프로파일 없음(기존 동작)입니다.';

export function productProfileSectionHint(selection: ProductProfilePresetSelection): string {
  if (selection.calendar && !selection.photoPrint) return PRODUCT_PROFILE_SECTION_HINT_CALENDAR;
  if (selection.photoPrint && !selection.calendar) return PRODUCT_PROFILE_SECTION_HINT_PHOTO_PRINT;
  return PRODUCT_PROFILE_SECTION_HINT_COMMON;
}

/**
 * 프리셋 적용 뒤 운영자에게 보여 줄 안내 — ② 고정 뒷면은 backTemplateId 자리표시를 실제 템플릿 id 로 치환해야 한다.
 * 그 외 프리셋은 null(공통 성공 메시지만).
 */
export function photoPrintPresetApplyHint(preset: Pick<PhotoPrintProfilePreset, 'profile'>): string | null {
  const photo = preset.profile.photoPrint;
  if (!photo || photo.composition !== 'per-photo-fixed-back') return null;
  return `고정 뒷면 프리셋입니다. 아래 JSON 의 photoPrint.backTemplateId("${PHOTO_PRINT_BACK_TEMPLATE_ID_PLACEHOLDER}") 를 뒷면 템플릿 id(연결 템플릿 2번째와 같은 id)로 바꿔 저장하세요.`;
}
