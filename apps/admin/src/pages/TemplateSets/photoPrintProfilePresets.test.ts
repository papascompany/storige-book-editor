import { describe, it, expect } from 'vitest';
import { EditorMode, validateProductProfile } from '@storige/types';
import {
  PHOTO_PRINT_BACK_TEMPLATE_ID_PLACEHOLDER,
  PHOTO_PRINT_PROFILE_PRESETS,
  PRODUCT_PROFILE_SECTION_HINT_CALENDAR,
  PRODUCT_PROFILE_SECTION_HINT_COMMON,
  PRODUCT_PROFILE_SECTION_HINT_PHOTO_PRINT,
  findPhotoPrintProfilePreset,
  photoPrintPresetApplyHint,
  photoPrintPresetFormValues,
  productProfileSectionHint,
} from './photoPrintProfilePresets';
import { CALENDAR_PROFILE_PRESETS, calendarPresetFormValues } from './calendarProfilePresets';

describe('PHOTO_PRINT_PROFILE_PRESETS — 4종(오너 확정 전 기본값)', () => {
  it('키 4종이 순서대로 있고 중복이 없다', () => {
    expect(PHOTO_PRINT_PROFILE_PRESETS.map((p) => p.key)).toEqual([
      'photo_chem',
      'photo_digital_items',
      'photo_digital_fixedback',
      'photo_digital_sheet',
    ]);
    expect(new Set(PHOTO_PRINT_PROFILE_PRESETS.map((p) => p.key)).size).toBe(4);
  });

  it.each(PHOTO_PRINT_PROFILE_PRESETS.map((p) => [p.key, p] as const))('%s 는 validateProductProfile 오류 0', (_key, preset) => {
    expect(validateProductProfile(preset.profile)).toEqual([]);
    expect(preset.profile.kind).toBe('photo-print');
    expect(preset.profile.editorType).toBe(preset.key);
    expect(preset.profile.pages).toMatchObject({ kind: 'range', labelRule: 'photo' });
    // 판형 = sizes[0](1세션 1사이즈)
    expect(preset.profile.photoPrint?.sizes).toHaveLength(1);
    expect(preset.profile.photoPrint?.sizes[0].widthMm).toBe(preset.width);
    expect(preset.profile.photoPrint?.sizes[0].heightMm).toBe(preset.height);
    // 공통 옵션 정책(첫 원소 = 세션 기본값)
    expect(preset.profile.photoPrint?.options).toEqual({
      border: ['none', 'white'],
      fit: ['paper-full', 'image-full'],
      finish: ['matte', 'glossy'],
      brightnessFix: true,
      dateOverlay: true,
      grayscale: true,
      borderInsetMm: 2,
    });
    expect(preset.profile.photoPrint?.copies).toEqual({ min: 1, max: 99 });
    expect(preset.profile.sheet.backRotation).toBe(0);
    expect(preset.profile.sheet.duplexFlip).toBe('short-edge');
    expect(preset.profile.calendar).toBeUndefined();
  });

  it('photo_chem: chemical·단면 canvas-per-sheet·자유 뒷면·range 1~200 step 1·single-pdf·upload 200/25', () => {
    const p = findPhotoPrintProfilePreset('photo_chem');
    expect(p?.width).toBe(102);
    expect(p?.height).toBe(152);
    expect(p?.profile.pages).toEqual({ kind: 'range', min: 1, max: 200, step: 1, labelRule: 'photo' });
    expect(p?.profile.sheet).toEqual({ faces: 1, canvasLayout: 'canvas-per-sheet', binding: 'none', backRotation: 0, duplexFlip: 'short-edge' });
    expect(p?.profile.photoPrint).toMatchObject({
      process: 'chemical',
      composition: 'per-photo-free-back',
      sizes: [{ code: '4x6', widthMm: 102, heightMm: 152, minDpi: 200 }],
      upload: { maxPhotos: 200, maxMb: 25 },
    });
    expect(p?.profile.photoPrint?.backTemplateId).toBeUndefined();
    expect(p?.profile.output).toEqual({ mode: 'single-pdf' });
  });

  it('digital 3종: 양면 canvas-pair·same-sheet·range 2~400 step 2·sheet-map per-sheet·upload 400/25', () => {
    for (const key of ['photo_digital_items', 'photo_digital_fixedback', 'photo_digital_sheet']) {
      const p = findPhotoPrintProfilePreset(key);
      expect(p, key).toBeDefined();
      expect(p?.profile.pages).toEqual({ kind: 'range', min: 2, max: 400, step: 2, labelRule: 'photo' });
      expect(p?.profile.sheet).toEqual({
        faces: 2,
        canvasLayout: 'canvas-pair',
        binding: 'none',
        pairing: 'same-sheet',
        backRotation: 0,
        duplexFlip: 'short-edge',
      });
      expect(p?.profile.photoPrint?.process).toBe('digital');
      expect(p?.profile.photoPrint?.upload).toEqual({ maxPhotos: 400, maxMb: 25 });
      expect(p?.profile.output).toEqual({ mode: 'sheet-map', sheetFiles: 'per-sheet' });
    }
  });

  it('① 자유 뒷면 / ② 고정 뒷면(backTemplateId 자리표시) / ③ 카드형 90×54 의 composition 과 사이즈', () => {
    const items = findPhotoPrintProfilePreset('photo_digital_items');
    expect(items?.profile.photoPrint?.composition).toBe('per-photo-free-back');
    expect(items?.profile.photoPrint?.backTemplateId).toBeUndefined();
    expect(items?.profile.photoPrint?.sizes[0].code).toBe('4x6');

    const fixed = findPhotoPrintProfilePreset('photo_digital_fixedback');
    expect(fixed?.profile.photoPrint?.composition).toBe('per-photo-fixed-back');
    expect(fixed?.profile.photoPrint?.backTemplateId).toBe(PHOTO_PRINT_BACK_TEMPLATE_ID_PLACEHOLDER);
    expect(fixed?.profile.photoPrint?.sizes[0].code).toBe('4x6');

    const sheet = findPhotoPrintProfilePreset('photo_digital_sheet');
    expect(sheet?.profile.photoPrint?.composition).toBe('sheet-cards');
    expect(sheet?.profile.photoPrint?.backTemplateId).toBeUndefined();
    expect(sheet?.width).toBe(90);
    expect(sheet?.height).toBe(54);
    expect(sheet?.profile.photoPrint?.sizes[0]).toEqual({ code: 'card-90x54', widthMm: 90, heightMm: 54, minDpi: 300 });
  });

  it('② 에서 backTemplateId 자리표시를 지우면 validate 가 거부한다(치환 안내의 근거)', () => {
    const fixed = findPhotoPrintProfilePreset('photo_digital_fixedback');
    const { backTemplateId: _omit, ...photoPrint } = fixed!.profile.photoPrint!;
    expect(validateProductProfile({ ...fixed!.profile, photoPrint })).toContain(
      "photoPrint.composition='per-photo-fixed-back' 은 backTemplateId 가 필요합니다",
    );
  });

  it('findPhotoPrintProfilePreset: 키로 찾고 없으면 undefined', () => {
    expect(findPhotoPrintProfilePreset('photo_digital_sheet')?.width).toBe(90);
    expect(findPhotoPrintProfilePreset('calendar_desk_mini')).toBeUndefined();
    expect(findPhotoPrintProfilePreset('nope')).toBeUndefined();
    expect(findPhotoPrintProfilePreset(undefined)).toBeUndefined();
  });
});

describe('photoPrintPresetFormValues — 프리셋 적용 폼 값', () => {
  it('chemical: 단일·양면 원파일·내지 추가 가능·[1,200]·step 1·재단선 끔·도련 0·JSON textarea', () => {
    const preset = findPhotoPrintProfilePreset('photo_chem')!;
    const values = photoPrintPresetFormValues(preset);
    expect(values).toMatchObject({
      width: 102,
      height: 152,
      editorMode: EditorMode.SINGLE,
      pdfOutputMode: 'duplex-merged',
      canAddPage: true,
      pageCountMin: 1,
      pageCountMax: 200,
      pageStep: 1,
      cropMarkEnabled: false,
      bleedMm: 0,
    });
    expect(values.productProfileJson).toContain('"editorType": "photo_chem"');
    expect(JSON.parse(values.productProfileJson)).toEqual(preset.profile);
  });

  it.each(['photo_digital_items', 'photo_digital_fixedback', 'photo_digital_sheet'])(
    '%s: 내지 추가 가능·[2,400]·step 2·재단선 켬·도련 3mm(캘린더 정책 A 준용)',
    (key) => {
      const preset = findPhotoPrintProfilePreset(key)!;
      const values = photoPrintPresetFormValues(preset);
      expect(values).toMatchObject({
        width: preset.width,
        height: preset.height,
        editorMode: EditorMode.SINGLE,
        pdfOutputMode: 'duplex-merged',
        canAddPage: true,
        pageCountMin: 2,
        pageCountMax: 400,
        pageStep: 2,
        cropMarkEnabled: true,
        bleedMm: 3,
      });
      expect(JSON.parse(values.productProfileJson)).toEqual(preset.profile);
    },
  );

  it('폼 값 JSON 을 다시 파싱해도 validateProductProfile 오류 0', () => {
    for (const preset of PHOTO_PRINT_PROFILE_PRESETS) {
      expect(validateProductProfile(JSON.parse(photoPrintPresetFormValues(preset).productProfileJson))).toEqual([]);
    }
  });
});

describe('photoPrintPresetApplyHint — ② 만 backTemplateId 치환 안내', () => {
  it('고정 뒷면은 자리표시 문자열을 포함한 안내, 나머지는 null', () => {
    const hint = photoPrintPresetApplyHint(findPhotoPrintProfilePreset('photo_digital_fixedback')!);
    expect(hint).toContain('backTemplateId');
    expect(hint).toContain(PHOTO_PRINT_BACK_TEMPLATE_ID_PLACEHOLDER);
    expect(photoPrintPresetApplyHint(findPhotoPrintProfilePreset('photo_chem')!)).toBeNull();
    expect(photoPrintPresetApplyHint(findPhotoPrintProfilePreset('photo_digital_items')!)).toBeNull();
    expect(photoPrintPresetApplyHint(findPhotoPrintProfilePreset('photo_digital_sheet')!)).toBeNull();
    expect(photoPrintPresetApplyHint({ profile: CALENDAR_PROFILE_PRESETS[0].profile })).toBeNull();
  });
});

describe('productProfileSectionHint — 상품 프로파일 섹션 안내(D7, kind 중립)', () => {
  it('미선택: 공통 안내 — 캘린더 전용 문구(페이지 수 26·내지 추가 불가)가 없다', () => {
    const hint = productProfileSectionHint({ calendar: false, photoPrint: false });
    expect(hint).toBe(PRODUCT_PROFILE_SECTION_HINT_COMMON);
    expect(hint).not.toContain('페이지 수 26');
    expect(hint).not.toContain('내지 추가 불가');
    expect(hint).not.toContain('캘린더');
    expect(hint).not.toContain('사진인화');
    expect(hint).toContain('비워 두면 프로파일 없음(기존 동작)');
  });

  it('캘린더만 선택: P1 캘린더 안내(페이지 수 26·내지 추가 불가)를 그대로 유지', () => {
    const hint = productProfileSectionHint({ calendar: true, photoPrint: false });
    expect(hint).toBe(PRODUCT_PROFILE_SECTION_HINT_CALENDAR);
    expect(hint).toContain('내지 추가 불가');
    expect(hint).toContain('페이지 수 26');
    expect(hint).toContain('비워 두면 프로파일 없음(기존 동작)');
  });

  it('사진인화만 선택: 페이지 범위·증감 단위·내지 추가 가능·도련 안내(캘린더 문구 없음)', () => {
    const hint = productProfileSectionHint({ calendar: false, photoPrint: true });
    expect(hint).toBe(PRODUCT_PROFILE_SECTION_HINT_PHOTO_PRINT);
    expect(hint).toContain('내지 추가 가능');
    expect(hint).toContain('페이지 범위');
    expect(hint).toContain('증감 단위');
    expect(hint).toContain('도련');
    expect(hint).not.toContain('페이지 수 26');
    expect(hint).not.toContain('내지 추가 불가');
    expect(hint).toContain('비워 두면 프로파일 없음(기존 동작)');
  });

  it('둘 다 선택(적용 버튼 둘 다 활성): 공통 안내', () => {
    expect(productProfileSectionHint({ calendar: true, photoPrint: true })).toBe(PRODUCT_PROFILE_SECTION_HINT_COMMON);
  });
});

describe('캘린더 프리셋 불변(사진인화 추가가 캘린더 값에 영향 없음)', () => {
  it('캘린더 7종은 여전히 validate 오류 0·[26,26]·pageStep 없음·canAddPage false', () => {
    expect(CALENDAR_PROFILE_PRESETS).toHaveLength(7);
    for (const preset of CALENDAR_PROFILE_PRESETS) {
      expect(validateProductProfile(preset.profile)).toEqual([]);
      expect(preset.profile.kind).toBe('calendar');
      expect(calendarPresetFormValues(preset)).toMatchObject({
        canAddPage: false,
        pageCountMin: 26,
        pageCountMax: 26,
        pageStep: undefined,
        cropMarkEnabled: true,
        bleedMm: 3,
      });
    }
    // 키 집합이 서로 겹치지 않는다
    const calendarKeys = new Set(CALENDAR_PROFILE_PRESETS.map((p) => p.key));
    expect(PHOTO_PRINT_PROFILE_PRESETS.some((p) => calendarKeys.has(p.key))).toBe(false);
  });
});
