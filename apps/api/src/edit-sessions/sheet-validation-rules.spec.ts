import { deriveSheetValidationRules, SheetValidationRulesInput } from './sheet-validation-rules';
import { SessionMode } from './entities/edit-session.entity';
import type { ProductProfile } from '@storige/types';

/**
 * 2026-10-17(낱장 분류 검증) — 편집 완료 낱장 세션의 검증 잡 분류(순수 함수).
 * 기준: 비스프레드 + spread 메타 없음 + 내지 펼침면 없음 + editorMode 'single' + spine/wing/spread 템플릿 없음.
 */
describe('deriveSheetValidationRules', () => {
  const base = (over: Partial<SheetValidationRulesInput> = {}): SheetValidationRulesInput => ({
    session: { mode: SessionMode.BOTH, metadata: { pages: 2 } } as SheetValidationRulesInput['session'],
    templateSet: { editorMode: 'single', pageStep: null },
    templateTypes: ['page', 'page'],
    innerLayoutKind: 'none',
    ...over,
  });

  it('낱장 single 세트(page 템플릿만) → productKind sheet, pageStep 없음', () => {
    expect(deriveSheetValidationRules(base())).toEqual({ productKind: 'sheet' });
  });

  it('cover + page 혼합(낱장 앞표지/내지) → sheet', () => {
    expect(deriveSheetValidationRules(base({ templateTypes: ['cover', 'page'] }))).toEqual({ productKind: 'sheet' });
  });

  // 2026-10-17 운영 실측 보완: 표지 전용 single 세트(ShareSnap H/C)는 책 표지 편집 → 낱장 아님
  it.each([
    ['cover 1개', ['cover']],
    ['cover 2개', ['cover', 'cover']],
  ])('templateTypes 가 전부 cover(%s) → null (표지 전용 세트)', (_name, templateTypes) => {
    expect(deriveSheetValidationRules(base({ templateTypes }))).toBeNull();
  });

  it('templateTypes 빈 배열(템플릿 없는 세트) → null (판정 근거 없음)', () => {
    expect(deriveSheetValidationRules(base({ templateTypes: [] }))).toBeNull();
  });

  it('spread 메타(편집기 책 세션) → null', () => {
    const input = base({
      session: { mode: SessionMode.BOTH, metadata: { spread: { spec: {} } } } as SheetValidationRulesInput['session'],
    });
    expect(deriveSheetValidationRules(input)).toBeNull();
  });

  it('session.mode SPREAD → null', () => {
    const input = base({
      session: { mode: SessionMode.SPREAD, metadata: {} } as SheetValidationRulesInput['session'],
    });
    expect(deriveSheetValidationRules(input)).toBeNull();
  });

  it.each([['inner-spread'], ['unknown']])('innerLayoutKind %p → null', (kind) => {
    expect(deriveSheetValidationRules(base({ innerLayoutKind: kind }))).toBeNull();
  });

  it.each([
    ['book', { editorMode: 'book', pageStep: null }],
    ['미설정', { pageStep: null }],
    ['templateSet null(조회 실패)', null],
  ])('editorMode %s → null', (_name, templateSet) => {
    expect(deriveSheetValidationRules(base({ templateSet }))).toBeNull();
  });

  it.each([
    ['spine', ['cover', 'spine', 'cover']],
    ['wing', ['wing', 'cover', 'wing']],
    ['spread', ['spread']],
  ])('templateTypes 에 %s 포함 → null (편집기 MIXED_SIZE 가드와 동일)', (_name, templateTypes) => {
    expect(deriveSheetValidationRules(base({ templateTypes }))).toBeNull();
  });

  it('templateTypes null(조회 실패) → null (레거시)', () => {
    expect(deriveSheetValidationRules(base({ templateTypes: null }))).toBeNull();
  });

  describe('pageStep 우선순위', () => {
    const withHost = (pageStep: unknown): SheetValidationRulesInput['session'] =>
      ({ mode: SessionMode.BOTH, metadata: { orderOptions: { pageStep } } }) as SheetValidationRulesInput['session'];

    it('orderOptions 2 > templateSet 4 → 2', () => {
      const input = base({ session: withHost(2), templateSet: { editorMode: 'single', pageStep: 4 } });
      expect(deriveSheetValidationRules(input)).toEqual({ productKind: 'sheet', pageStep: 2 });
    });

    it('orderOptions 없음 → templateSet 4', () => {
      const input = base({ templateSet: { editorMode: 'single', pageStep: 4 } });
      expect(deriveSheetValidationRules(input)).toEqual({ productKind: 'sheet', pageStep: 4 });
    });

    it.each([[1], [0], [-2], [1.5], ['abc'], [null]])(
      'orderOptions %p (1 이하·비정수) 는 무시 → templateSet 4',
      (hostStep) => {
        const input = base({ session: withHost(hostStep), templateSet: { editorMode: 'single', pageStep: 4 } });
        expect(deriveSheetValidationRules(input)).toEqual({ productKind: 'sheet', pageStep: 4 });
      },
    );

    it('orderOptions 1 + templateSet 1 → pageStep 키 없음', () => {
      const input = base({ session: withHost(1), templateSet: { editorMode: 'single', pageStep: 1 } });
      expect(deriveSheetValidationRules(input)).toEqual({ productKind: 'sheet' });
    });

    it("숫자 문자열 '2' 도 단위로 해석(편집기 normalizePageStep 과 동일)", () => {
      const input = base({ session: withHost('2') });
      expect(deriveSheetValidationRules(input)).toEqual({ productKind: 'sheet', pageStep: 2 });
    });
  });
  // ── 2026-10-17 P1-e: 상품 프로파일(캘린더) — 고정 캔버스 수 → expectedPages, 양면 → pageStep 2 ──
  describe('상품 프로파일(productProfile)', () => {
    /** 오너 확정 탁상 캘린더: 표지 1 + 12개월×2 + 에필로그 1 = 26 캔버스(13장 양면) */
    const calendarProfile = (over: Partial<ProductProfile> = {}): ProductProfile => ({
      version: 1,
      kind: 'calendar',
      editorType: 'calendar_desk',
      pages: { kind: 'fixed', count: 26, labelRule: 'month' },
      sheet: {
        faces: 2,
        canvasLayout: 'canvas-pair',
        binding: 'top-ring',
        pairing: 'same-sheet',
        backRotation: 0,
        duplexFlip: 'short-edge',
      },
      calendar: {
        layout: 'desk',
        monthCount: 12,
        coverCanvases: 1,
        canvasesPerMonth: 2,
        epilogueCanvases: 1,
        allowedRange: { from: '2026-01', to: '2030-12' },
        weekStart: 0,
        show: { holidays: true, lunar: true, solarTerms: true },
        dataVersion: 'kr-2025-2035-v1',
      },
      output: { mode: 'single-pdf' },
      ...over,
    });

    /** 단면 낱장 범위 프로파일(step 4) */
    const sheetRangeProfile = (step?: 1 | 2 | 4): ProductProfile => ({
      version: 1,
      kind: 'sheet',
      editorType: 'sheet_single',
      pages: { kind: 'range', min: 1, max: 20, labelRule: 'sheet', ...(step !== undefined ? { step } : {}) },
      sheet: { faces: 1, canvasLayout: 'canvas-per-sheet', binding: 'none', backRotation: 0, duplexFlip: 'short-edge' },
      output: { mode: 'single-pdf' },
    });

    const withProfile = (
      templateProfile: ProductProfile | null,
      over: Partial<SheetValidationRulesInput> = {},
    ): SheetValidationRulesInput =>
      base({ templateSet: { editorMode: 'single', pageStep: null, productProfile: templateProfile }, ...over });

    it('(a) 캘린더 프로파일 fixed 26·faces 2 → expectedPages 26, pageStep 2', () => {
      expect(deriveSheetValidationRules(withProfile(calendarProfile()))).toEqual({
        productKind: 'sheet',
        pageStep: 2,
        expectedPages: 26,
        coverSpine: 'none',
      });
    });

    it('(a-2) 호스트 orderOptions.pageStep 4 가 있어도 양면(faces 2) 프로파일은 pageStep 2', () => {
      const session = {
        mode: SessionMode.BOTH,
        metadata: { orderOptions: { pageStep: 4 } },
      } as unknown as SheetValidationRulesInput['session'];
      expect(deriveSheetValidationRules(withProfile(calendarProfile(), { session }))).toEqual({
        productKind: 'sheet',
        pageStep: 2,
        expectedPages: 26,
        coverSpine: 'none',
      });
    });

    it('(b) templateSet 프로파일이 세션 metadata.productProfile 스냅샷보다 우선(권위) — 스냅샷 28 이어도 26, editorType 불일치 warn 1줄', () => {
      const { calendar: baseCalendar } = calendarProfile();
      const snapshot = calendarProfile({
        editorType: 'calendar_desk_28',
        pages: { kind: 'fixed', count: 28, labelRule: 'month' },
        calendar: { ...(baseCalendar as NonNullable<typeof baseCalendar>), coverCanvases: 2, epilogueCanvases: 2 },
      });
      const warn = jest.fn();
      const session = {
        mode: SessionMode.BOTH,
        metadata: { productProfile: snapshot },
      } as unknown as SheetValidationRulesInput['session'];
      expect(deriveSheetValidationRules(withProfile(calendarProfile(), { session, warn }))).toEqual({
        productKind: 'sheet',
        pageStep: 2,
        expectedPages: 26,
        coverSpine: 'none',
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('calendar_desk_28');
    });

    it('(b-2) templateSet 프로파일이 없을 때만 세션 스냅샷을 쓴다(세트 변경·삭제 뒤 재합성)', () => {
      const session = {
        mode: SessionMode.BOTH,
        metadata: { productProfile: calendarProfile() },
      } as unknown as SheetValidationRulesInput['session'];
      expect(deriveSheetValidationRules(withProfile(null, { session }))).toEqual({
        productKind: 'sheet',
        pageStep: 2,
        expectedPages: 26,
        coverSpine: 'none',
      });
    });

    it('(c) 프로파일 검증 실패(version 2) → 종전 결과(expectedPages 없음) + warn 1줄', () => {
      const warn = jest.fn();
      const bad = { ...calendarProfile(), version: 2 } as unknown as ProductProfile;
      expect(deriveSheetValidationRules(withProfile(bad, { warn }))).toEqual({ productKind: 'sheet' });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('[product-profile]');
    });

    it('(c-2) templateSet 프로파일 없음 + 스냅샷 무효 → 종전 결과(expectedPages 없음)', () => {
      const session = {
        mode: SessionMode.BOTH,
        metadata: { productProfile: { version: 1, kind: 'calendar' } },
      } as unknown as SheetValidationRulesInput['session'];
      expect(deriveSheetValidationRules(withProfile(null, { session }))).toEqual({ productKind: 'sheet' });
    });

    it('(c-2b) 클라이언트가 스냅샷을 무효(version 99)로 바꿔도 templateSet 프로파일의 26 이 유지된다', () => {
      const session = {
        mode: SessionMode.BOTH,
        metadata: { productProfile: { version: 99 } },
      } as unknown as SheetValidationRulesInput['session'];
      expect(deriveSheetValidationRules(withProfile(calendarProfile(), { session }))).toEqual({
        productKind: 'sheet',
        pageStep: 2,
        expectedPages: 26,
        coverSpine: 'none',
      });
    });

    it('(c-3) warn 미지정이면 검증 실패여도 예외 없이 종전 결과', () => {
      const bad = { ...calendarProfile(), version: 2 } as unknown as ProductProfile;
      expect(deriveSheetValidationRules(withProfile(bad))).toEqual({ productKind: 'sheet' });
    });

    it('(d) 캘린더 프로파일인데 낱장 판정 탈락(templateTypes null) → null + warn 1줄(동작 변경 없음)', () => {
      const warn = jest.fn();
      expect(deriveSheetValidationRules(withProfile(calendarProfile(), { templateTypes: null, warn }))).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('calendar 프로파일');
    });

    it('(d-2) sheet 프로파일의 낱장 판정 탈락은 warn 없이 null', () => {
      const warn = jest.fn();
      expect(deriveSheetValidationRules(withProfile(sheetRangeProfile(4), { templateTypes: ['spread'], warn }))).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    });

    it('(e) 단면 range 프로파일 step 4 → pageStep 4, expectedPages 없음', () => {
      expect(deriveSheetValidationRules(withProfile(sheetRangeProfile(4)))).toEqual({ productKind: 'sheet', pageStep: 4, coverSpine: 'none' });
    });

    it('(e-2) 단면 range 프로파일 step 없음 → 종전 산출(templateSet pageStep 4)', () => {
      const input = withProfile(sheetRangeProfile(), {
        templateSet: { editorMode: 'single', pageStep: 4, productProfile: sheetRangeProfile() },
      });
      expect(deriveSheetValidationRules(input)).toEqual({ productKind: 'sheet', pageStep: 4, coverSpine: 'none' });
    });

    it('(e-3) 단면 range 프로파일 step 1 → 종전 산출(미설정이면 키 없음)', () => {
      expect(deriveSheetValidationRules(withProfile(sheetRangeProfile(1)))).toEqual({ productKind: 'sheet', coverSpine: 'none' });
    });

    /** 벽걸이 1단 단면 14쪽(admin 프리셋 wall-1 과 같은 값): faces 1·canvas-per-sheet·월 1캔버스·step 1·protected [0,13] */
    const wall1SingleProfile = (): ProductProfile => ({
      ...calendarProfile(),
      editorType: 'calendar_wall1_a3',
      pages: { kind: 'fixed', count: 14, step: 1, protectedIndices: [0, 13], labelRule: 'month' },
      sheet: { faces: 1, canvasLayout: 'canvas-per-sheet', binding: 'top-ring', backRotation: 0, duplexFlip: 'short-edge' },
      calendar: { ...(calendarProfile().calendar as NonNullable<ProductProfile['calendar']>), layout: 'wall-1', canvasesPerMonth: 1 },
    });

    it('(a-3) 벽걸이 1단 단면 fixed 14·faces 1·step 1 → expectedPages 14, pageStep 키 없음(단면이라 2 고정 아님)', () => {
      const warn = jest.fn();
      expect(deriveSheetValidationRules(withProfile(wall1SingleProfile(), { warn }))).toEqual({
        productKind: 'sheet',
        expectedPages: 14,
        coverSpine: 'none',
      });
      // 프로파일 검증 통과(경고 0) — 실패했다면 종전 결과로 떨어지며 warn 이 남는다
      expect(warn).not.toHaveBeenCalled();
    });

    it('(a-4) 벽걸이 1단 + 호스트 orderOptions.pageStep 2 → 종전 산출대로 pageStep 2(단면 프로파일은 덮지 않음), expectedPages 14 유지', () => {
      const session = {
        mode: SessionMode.BOTH,
        metadata: { orderOptions: { pageStep: 2 } },
      } as unknown as SheetValidationRulesInput['session'];
      expect(deriveSheetValidationRules(withProfile(wall1SingleProfile(), { session }))).toEqual({
        productKind: 'sheet',
        pageStep: 2,
        expectedPages: 14,
        coverSpine: 'none',
      });
    });

    it('(NULL) templateSet.productProfile null·undefined → 종전 결과와 동일(coverSpine 키 없음)', () => {
      expect(deriveSheetValidationRules(withProfile(null))).toEqual(deriveSheetValidationRules(base()));
      expect(deriveSheetValidationRules(base())).toEqual({ productKind: 'sheet' });
      expect(deriveSheetValidationRules(withProfile(null))).not.toHaveProperty('coverSpine');
      expect(deriveSheetValidationRules(base())).not.toHaveProperty('coverSpine');
    });

    // 2026-10-17 P1-e 후속: 프로파일 세트의 cover 슬롯은 책등이 없다 — 워커 spine 게이트 우회 키.
    it('(f) 프로파일이 있으면 coverSpine none 포함, 검증 실패(c)·스냅샷 무효(c-2)·NULL 은 키 없음', () => {
      expect(deriveSheetValidationRules(withProfile(calendarProfile()))).toMatchObject({ coverSpine: 'none' });
      const bad = { ...calendarProfile(), version: 2 } as unknown as ProductProfile;
      expect(deriveSheetValidationRules(withProfile(bad))).not.toHaveProperty('coverSpine');
    });

    // ── 2026-10-19 P2-d 사진인화: 현행 로직이 chemical/digital 을 이미 만족한다는 계약을 고정 ──
    describe('사진인화 프로파일(photo-print, P2-d)', () => {
      const photoPrintBlock = {
        process: 'chemical' as const,
        composition: 'per-photo-free-back' as const,
        sizes: [{ code: '4x6', widthMm: 102, heightMm: 152, minDpi: 200 }],
        options: { border: ['none', 'white'] as ('none' | 'white')[], fit: ['paper-full', 'image-full'] as ('paper-full' | 'image-full')[], finish: ['matte', 'glossy'] as ('matte' | 'glossy')[], brightnessFix: true, dateOverlay: true, grayscale: true },
        copies: { min: 1, max: 99 },
        upload: { maxPhotos: 200, maxMb: 25 },
      };

      /** 인화(chemical): 단면·range·step 1·단일 PDF */
      const photoChemProfile = (): ProductProfile => ({
        version: 1,
        kind: 'photo-print',
        editorType: 'photo_chem',
        pages: { kind: 'range', min: 1, max: 200, step: 1, labelRule: 'photo' },
        sheet: { faces: 1, canvasLayout: 'canvas-per-sheet', binding: 'none', backRotation: 0, duplexFlip: 'short-edge' },
        photoPrint: photoPrintBlock,
        output: { mode: 'single-pdf' },
      });

      /** 인쇄 ①(digital): 양면 same-sheet·range·step 2·sheet-map */
      const photoDigitalProfile = (): ProductProfile => ({
        version: 1,
        kind: 'photo-print',
        editorType: 'photo_digital_items',
        pages: { kind: 'range', min: 2, max: 400, step: 2, labelRule: 'photo' },
        sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'none', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
        photoPrint: { ...photoPrintBlock, process: 'digital' },
        output: { mode: 'sheet-map', sheetFiles: 'per-sheet' },
      });

      it('(g) chemical(faces 1, range, step 1) → pageStep 키 없음·expectedPages 없음·coverSpine none (쪽수 = 세션 기록)', () => {
        const warn = jest.fn();
        const rules = deriveSheetValidationRules(withProfile(photoChemProfile(), { warn }));
        expect(rules).toEqual({ productKind: 'sheet', coverSpine: 'none' });
        expect(rules).not.toHaveProperty('pageStep');
        expect(rules).not.toHaveProperty('expectedPages');
        expect(warn).not.toHaveBeenCalled();
      });

      it('(g-2) chemical + 호스트 orderOptions.pageStep 2 → 종전 산출대로 pageStep 2(프로파일이 덮지 않음)', () => {
        const session = {
          mode: SessionMode.BOTH,
          metadata: { orderOptions: { pageStep: 2 } },
        } as unknown as SheetValidationRulesInput['session'];
        expect(deriveSheetValidationRules(withProfile(photoChemProfile(), { session }))).toEqual({
          productKind: 'sheet',
          pageStep: 2,
          coverSpine: 'none',
        });
      });

      it('(h) digital(faces 2, range step 2) → pageStep 2·expectedPages 없음·coverSpine none', () => {
        const rules = deriveSheetValidationRules(withProfile(photoDigitalProfile()));
        expect(rules).toEqual({ productKind: 'sheet', pageStep: 2, coverSpine: 'none' });
        expect(rules).not.toHaveProperty('expectedPages');
      });

      it('(h-2) digital 은 호스트 orderOptions.pageStep 4 가 있어도 양면이라 pageStep 2', () => {
        const session = {
          mode: SessionMode.BOTH,
          metadata: { orderOptions: { pageStep: 4 }, items: [{ copies: 3 }] },
        } as unknown as SheetValidationRulesInput['session'];
        expect(deriveSheetValidationRules(withProfile(photoDigitalProfile(), { session }))).toEqual({
          productKind: 'sheet',
          pageStep: 2,
          coverSpine: 'none',
        });
      });

      it('(i) photo-print 프로파일의 낱장 판정 탈락(templateTypes null)은 warn 없이 null', () => {
        const warn = jest.fn();
        expect(deriveSheetValidationRules(withProfile(photoChemProfile(), { templateTypes: null, warn }))).toBeNull();
        expect(warn).not.toHaveBeenCalled();
      });
    });
  });
});
