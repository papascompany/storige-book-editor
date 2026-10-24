/**
 * productProfile 은 forbidNonWhitelisted 전역 파이프를 통과해야 한다(P1 캘린더, 2026-10-17).
 * 중첩 객체가 DTO 미등록이면 admin 저장이 400 이 된다. 교차 필드 규칙은 types
 * `validateProductProfile` 의 문구가 그대로 400 메시지에 실려야 한다.
 */
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateTemplateSetDto, UpdateTemplateSetDto } from './template-set.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

const base = { name: '탁상형 라지달력', type: 'leaflet', width: 265, height: 190 };

/** 오너 확정 탁상 라지 프리셋(admin calendarProfilePresets 와 동일 shape) */
const deskLargeProfile = {
  version: 1,
  kind: 'calendar',
  editorType: 'calendar_desk_large',
  pages: { kind: 'fixed', count: 26, step: 2, protectedIndices: [0, 25], labelRule: 'month' },
  sheet: {
    faces: 2,
    canvasLayout: 'canvas-pair',
    binding: 'top-ring',
    pairing: 'offset-next',
    backRotation: 0,
    duplexFlip: 'short-edge',
  },
  calendar: {
    layout: 'desk',
    monthCount: 12,
    coverCanvases: 1,
    canvasesPerMonth: 2,
    epilogueCanvases: 1,
    allowedRange: { from: '2026-01', to: '2027-12' },
    weekStart: 0,
    show: { holidays: true, lunar: true, solarTerms: true },
    dataVersion: 'kr-2025-2035-v1',
  },
  output: { mode: 'single-pdf' },
};

async function expect400(body: unknown, metatype: typeof CreateTemplateSetDto | typeof UpdateTemplateSetDto = CreateTemplateSetDto): Promise<string[]> {
  try {
    await pipe.transform(body, { type: 'body', metatype });
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    const res = (e as BadRequestException).getResponse() as { message: string[] | string };
    return Array.isArray(res.message) ? res.message : [res.message];
  }
  throw new Error('400 이어야 합니다');
}

describe('ProductProfileDto (P1 캘린더 프로파일 파이프)', () => {
  it('productProfile 생략 → 통과하고 undefined (기존 페이로드 비파괴)', async () => {
    const out = await pipe.transform({ ...base }, { type: 'body', metatype: CreateTemplateSetDto });
    expect(out.productProfile).toBeUndefined();
  });

  it('productProfile: null → 통과 (명시적 미사용)', async () => {
    const out = await pipe.transform({ ...base, productProfile: null }, { type: 'body', metatype: CreateTemplateSetDto });
    expect(out.productProfile).toBeNull();
  });

  it('탁상 라지 프리셋 JSON → Create 통과, 중첩 값 보존', async () => {
    const out = await pipe.transform(
      { ...base, productProfile: deskLargeProfile },
      { type: 'body', metatype: CreateTemplateSetDto },
    );
    expect(JSON.parse(JSON.stringify(out.productProfile))).toEqual(deskLargeProfile);
  });

  it('탁상 라지 프리셋 JSON → Update 통과', async () => {
    const out = await pipe.transform(
      { productProfile: deskLargeProfile },
      { type: 'body', metatype: UpdateTemplateSetDto },
    );
    expect(out.productProfile?.calendar?.allowedRange).toEqual({ from: '2026-01', to: '2027-12' });
  });

  it('faceLabels 2개 문자열 → 통과', async () => {
    const out = await pipe.transform(
      {
        ...base,
        productProfile: {
          ...deskLargeProfile,
          calendar: { ...deskLargeProfile.calendar, layout: 'wall-2', faceLabels: ['상단', '하단'] },
        },
      },
      { type: 'body', metatype: CreateTemplateSetDto },
    );
    expect(out.productProfile?.calendar?.faceLabels).toEqual(['상단', '하단']);
  });

  it('미등재 키(pages.foo) → 400 (forbidNonWhitelisted)', async () => {
    const messages = await expect400({
      ...base,
      productProfile: { ...deskLargeProfile, pages: { ...deskLargeProfile.pages, foo: 1 } },
    });
    expect(messages.join('\n')).toContain('foo');
  });

  it('pages.count=25 (정합 위반) → 400 메시지에 types 오류 문구 포함', async () => {
    const messages = await expect400({
      ...base,
      productProfile: { ...deskLargeProfile, pages: { ...deskLargeProfile.pages, count: 25 } },
    });
    const joined = messages.join('\n');
    expect(joined).toContain('pages.count(25)는 coverCanvases + 12×canvasesPerMonth + epilogueCanvases = 26 여야 합니다');
    expect(joined).toContain('sheet.faces=2 이면 pages.count 는 짝수여야 합니다');
  });

  it("kind 미등재('poster') → 400 (kind 문구)", async () => {
    const messages = await expect400({
      ...base,
      productProfile: { ...deskLargeProfile, kind: 'poster' },
    });
    expect(messages.join('\n')).toContain('kind');
  });

  // ── P2-d 사진인화(2026-10-19): kind 'photo-print' + photoPrint 블록 ───────────────────────────
  describe("kind 'photo-print' + photoPrint (P2-d, 2026-10-19)", () => {
    const photoPrintBlock = {
      process: 'chemical',
      composition: 'per-photo-free-back',
      sizes: [{ code: '4x6', widthMm: 102, heightMm: 152, minDpi: 200 }],
      options: { border: ['none', 'white'], fit: ['paper-full', 'image-full'], finish: ['matte', 'glossy'], brightnessFix: true, dateOverlay: true, grayscale: true },
      copies: { min: 1, max: 99 },
      upload: { maxPhotos: 200, maxMb: 25 },
    };

    /** 인화(chemical, 단면 미니랩) */
    const photoChemProfile = {
      version: 1,
      kind: 'photo-print',
      editorType: 'photo_chem',
      pages: { kind: 'range', min: 1, max: 200, step: 1, labelRule: 'photo' },
      sheet: { faces: 1, canvasLayout: 'canvas-per-sheet', binding: 'none', backRotation: 0, duplexFlip: 'short-edge' },
      photoPrint: photoPrintBlock,
      output: { mode: 'single-pdf' },
    };

    /** 인쇄 ②(digital, 사진별 고정 뒷면 + sheet-map) */
    const photoDigitalFixedBackProfile = {
      version: 1,
      kind: 'photo-print',
      editorType: 'photo_digital_fixedback',
      pages: { kind: 'range', min: 2, max: 400, step: 2, labelRule: 'photo' },
      sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'none', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
      photoPrint: {
        ...photoPrintBlock,
        process: 'digital',
        composition: 'per-photo-fixed-back',
        backTemplateId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        options: { ...photoPrintBlock.options, borderInsetMm: 3 },
      },
      output: { mode: 'sheet-map', sheetFiles: 'per-sheet' },
    };

    it('인화(chemical) 프로파일 → Create 통과, 중첩 값(sizes/options/copies/upload) 보존', async () => {
      const out = await pipe.transform({ ...base, productProfile: photoChemProfile }, { type: 'body', metatype: CreateTemplateSetDto });
      expect(JSON.parse(JSON.stringify(out.productProfile))).toEqual(photoChemProfile);
    });

    it('인쇄 ②(digital, fixed-back, backTemplateId, borderInsetMm, sheet-map) → Update 통과, 값 보존', async () => {
      const out = await pipe.transform({ productProfile: photoDigitalFixedBackProfile }, { type: 'body', metatype: UpdateTemplateSetDto });
      expect(JSON.parse(JSON.stringify(out.productProfile))).toEqual(photoDigitalFixedBackProfile);
    });

    it("kind 'photo-print' 인데 photoPrint 블록 없음 → 400 (types 문구)", async () => {
      const messages = await expect400({ ...base, productProfile: { ...deskLargeProfile, kind: 'photo-print' } });
      expect(messages.join('\n')).toContain("kind='photo-print' 는 photoPrint 프로파일이 필요합니다");
    });

    it("calendar 세트에 photoPrint 블록 → 400 (kind='photo-print' 에서만)", async () => {
      const messages = await expect400({ ...base, productProfile: { ...deskLargeProfile, photoPrint: photoPrintBlock } });
      expect(messages.join('\n')).toContain("photoPrint 프로파일은 kind='photo-print' 에서만 지정합니다");
    });

    it('미등재 키(photoPrint.sizes[0].raster, options.foo) → 400 (forbidNonWhitelisted)', async () => {
      const m1 = await expect400({
        ...base,
        productProfile: { ...photoChemProfile, photoPrint: { ...photoPrintBlock, sizes: [{ ...photoPrintBlock.sizes[0], raster: 'png' }] } },
      });
      expect(m1.join('\n')).toContain('raster');
      const m2 = await expect400({
        ...base,
        productProfile: { ...photoChemProfile, photoPrint: { ...photoPrintBlock, options: { ...photoPrintBlock.options, foo: 1 } } },
      });
      expect(m2.join('\n')).toContain('foo');
    });

    it('결합 규칙 위반 — chemical 에 faces 2 → 400 (types 문구)', async () => {
      const messages = await expect400({
        ...base,
        productProfile: {
          ...photoChemProfile,
          sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'none', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
        },
      });
      expect(messages.join('\n')).toContain("photoPrint.process='chemical' 은 sheet.faces=1(canvas-per-sheet) 이어야 합니다");
    });

    it('결합 규칙 위반 — digital 에 pages.step 1 / fixed-back 에 backTemplateId 없음 → 400', async () => {
      const m1 = await expect400({
        ...base,
        productProfile: { ...photoDigitalFixedBackProfile, pages: { ...photoDigitalFixedBackProfile.pages, step: 1 } },
      });
      expect(m1.join('\n')).toContain("photoPrint.process='digital' 은 pages.step=2 여야 합니다");
      const { backTemplateId: _omit, ...noBack } = photoDigitalFixedBackProfile.photoPrint;
      const m2 = await expect400({ ...base, productProfile: { ...photoDigitalFixedBackProfile, photoPrint: noBack } });
      expect(m2.join('\n')).toContain("photoPrint.composition='per-photo-fixed-back' 은 backTemplateId 가 필요합니다");
    });

    it("어휘 미등재(process 'inkjet', options.border 'black') / sizes 2개 → 400", async () => {
      const m1 = await expect400({
        ...base,
        productProfile: { ...photoChemProfile, photoPrint: { ...photoPrintBlock, process: 'inkjet' } },
      });
      expect(m1.join('\n')).toContain('process');
      const m2 = await expect400({
        ...base,
        productProfile: { ...photoChemProfile, photoPrint: { ...photoPrintBlock, options: { ...photoPrintBlock.options, border: ['black'] } } },
      });
      expect(m2.join('\n')).toContain('border');
      const m3 = await expect400({
        ...base,
        productProfile: { ...photoChemProfile, photoPrint: { ...photoPrintBlock, sizes: [photoPrintBlock.sizes[0], { ...photoPrintBlock.sizes[0], code: '5x7' }] } },
      });
      expect(m3.join('\n')).toContain('sizes');
    });

    it('기존 sheet/calendar 프로파일은 photoPrint 없이 그대로 통과(직렬화 바이트 동일 — photoPrint 키 없음)', async () => {
      const out = await pipe.transform({ ...base, productProfile: deskLargeProfile }, { type: 'body', metatype: CreateTemplateSetDto });
      const serialized = JSON.parse(JSON.stringify(out.productProfile));
      expect(serialized).toEqual(deskLargeProfile);
      expect(Object.keys(serialized)).not.toContain('photoPrint');
    });
  });

  it('calendar.show.temporaryHolidays — 생략·boolean 통과, 비불리언 400 (2026-10-17 임시공휴일 고객 선택)', async () => {
    const withFlag = {
      ...base,
      productProfile: { ...deskLargeProfile, calendar: { ...deskLargeProfile.calendar, show: { ...deskLargeProfile.calendar.show, temporaryHolidays: true } } },
    };
    const out = await pipe.transform(withFlag, { type: 'body', metatype: CreateTemplateSetDto });
    expect(out.productProfile.calendar.show.temporaryHolidays).toBe(true);
    const msgs = await expect400({
      ...base,
      productProfile: { ...deskLargeProfile, calendar: { ...deskLargeProfile.calendar, show: { ...deskLargeProfile.calendar.show, temporaryHolidays: 'yes' } } },
    });
    expect(msgs.join(' ')).toMatch(/temporaryHolidays/);
  });

  describe("output.mode 'sheet-map' (P2-a, 2026-10-18)", () => {
    /** 낱장 양면 same-sheet(인쇄 ①~③ shape) */
    const pairSheetProfile = {
      version: 1,
      kind: 'sheet',
      editorType: 'photo_digital_items',
      pages: { kind: 'range', min: 2, max: 60, step: 2, labelRule: 'default' },
      sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'top-ring', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
      output: { mode: 'sheet-map' },
    };

    it("output: { mode: 'sheet-map' } → 통과, sheetFiles 생략 보존", async () => {
      const out = await pipe.transform({ ...base, productProfile: pairSheetProfile }, { type: 'body', metatype: CreateTemplateSetDto });
      expect(out.productProfile?.output).toEqual({ mode: 'sheet-map' });
    });

    it("sheetFiles 'per-sheet' | 'merged-duplex' → 통과", async () => {
      for (const sheetFiles of ['per-sheet', 'merged-duplex']) {
        const out = await pipe.transform(
          { ...base, productProfile: { ...pairSheetProfile, output: { mode: 'sheet-map', sheetFiles } } },
          { type: 'body', metatype: CreateTemplateSetDto },
        );
        expect(out.productProfile?.output?.sheetFiles).toBe(sheetFiles);
      }
    });

    it('캘린더 프리셋 + sheet-map(벽걸이 (나) 설계) → 통과', async () => {
      const out = await pipe.transform(
        { ...base, productProfile: { ...deskLargeProfile, output: { mode: 'sheet-map', sheetFiles: 'per-sheet' } } },
        { type: 'body', metatype: CreateTemplateSetDto },
      );
      expect(out.productProfile?.output).toEqual({ mode: 'sheet-map', sheetFiles: 'per-sheet' });
    });

    it("output.mode 미등재('per-sheet') → 400", async () => {
      const messages = await expect400({ ...base, productProfile: { ...pairSheetProfile, output: { mode: 'per-sheet' } } });
      expect(messages.join('\n')).toContain('mode');
    });

    it("sheetFiles 미등재('zip') → 400", async () => {
      const messages = await expect400({ ...base, productProfile: { ...pairSheetProfile, output: { mode: 'sheet-map', sheetFiles: 'zip' } } });
      expect(messages.join('\n')).toContain('sheetFiles');
    });

    it('single-pdf 에 sheetFiles 지정 → 400 (types 결합 규칙 문구)', async () => {
      const messages = await expect400({ ...base, productProfile: { ...pairSheetProfile, output: { mode: 'single-pdf', sheetFiles: 'per-sheet' } } });
      expect(messages.join('\n')).toContain("output.sheetFiles 는 output.mode='sheet-map' 에서만 지정합니다");
    });

    it('center-punch + offset-next + sheet-map → 400 (pairing 결합 규칙)', async () => {
      const messages = await expect400({
        ...base,
        productProfile: { ...pairSheetProfile, sheet: { ...pairSheetProfile.sheet, binding: 'center-punch', pairing: 'offset-next' } },
      });
      expect(messages.join('\n')).toContain("sheet.binding='center-punch' 는 pairing 'same-sheet' 만 허용합니다");
    });
  });

  // ── T3a 연달력(설계 C8, v1.26): calendar.yearPolicy · calendar.show.yearTitle ─────────────────────
  describe('calendar.yearPolicy (T3a, v1.26)', () => {
    const withCal = (patch: Record<string, unknown>) => ({
      ...base,
      productProfile: { ...deskLargeProfile, calendar: { ...deskLargeProfile.calendar, ...patch } },
    });
    const PRESET_PAIRS: Array<[string, string]> = [
      ['calendar_desk_large', 'desk'], ['calendar_desk_basic', 'desk'], ['calendar_desk_tiny', 'desk'], ['calendar_desk_mini', 'desk'],
      ['calendar_wall1_a3', 'wall-1'], ['calendar_wall2_a4', 'wall-2'], ['calendar_wall2_a3', 'wall-2'],
    ];

    it('yearPolicy 생략 → 통과, 변환 결과에 yearPolicy 키 없음(직렬화 바이트 동일) — 프리셋 7종', async () => {
      for (const [editorType, layout] of PRESET_PAIRS) {
        const profile = { ...deskLargeProfile, editorType, calendar: { ...deskLargeProfile.calendar, layout } };
        const out = await pipe.transform({ ...base, productProfile: profile }, { type: 'body', metatype: CreateTemplateSetDto });
        expect(JSON.stringify(out.productProfile)).toBe(JSON.stringify(profile));
        // DTO 인스턴스는 선언 필드를 undefined 로 가질 수 있다(기존 faceLabels 와 같음) — 계약은 직렬화 결과
        const wire = JSON.parse(JSON.stringify(out.productProfile));
        expect(Object.keys(wire.calendar)).not.toContain('yearPolicy');
        expect(Object.keys(wire.calendar.show)).not.toContain('yearTitle');
      }
    });

    it("{span:'calendar-year'} → Create·Update 통과, 값 보존", async () => {
      const body = withCal({ yearPolicy: { span: 'calendar-year' } });
      const created = await pipe.transform(body, { type: 'body', metatype: CreateTemplateSetDto });
      expect(JSON.parse(JSON.stringify(created.productProfile))).toEqual(body.productProfile);
      const updated = await pipe.transform({ productProfile: body.productProfile }, { type: 'body', metatype: UpdateTemplateSetDto });
      expect(JSON.parse(JSON.stringify(updated.productProfile.calendar.yearPolicy))).toEqual({ span: 'calendar-year' });
    });

    it("{span:'start-span', select:{minDelta:0,maxDelta:1}} · span 생략 {select} → 통과, 중첩 값 보존", async () => {
      for (const yearPolicy of [{ span: 'start-span', select: { minDelta: 0, maxDelta: 1 } }, { select: { minDelta: -1, maxDelta: 1 } }]) {
        const body = withCal({ yearPolicy });
        const out = await pipe.transform(body, { type: 'body', metatype: CreateTemplateSetDto });
        expect(JSON.parse(JSON.stringify(out.productProfile))).toEqual(body.productProfile);
      }
    });

    it("show.yearTitle boolean → 통과·보존, 비불리언 → 400", async () => {
      const body = withCal({ show: { ...deskLargeProfile.calendar.show, yearTitle: false } });
      const out = await pipe.transform(body, { type: 'body', metatype: CreateTemplateSetDto });
      expect(out.productProfile.calendar.show.yearTitle).toBe(false);
      const msgs = await expect400(withCal({ show: { ...deskLargeProfile.calendar.show, yearTitle: 'no' } }));
      expect(msgs.join('\n')).toContain('yearTitle');
    });

    it("span 미등재('fiscal') → 400", async () => {
      const msgs = await expect400(withCal({ yearPolicy: { span: 'fiscal' } }));
      expect(msgs.join('\n')).toContain('span');
    });

    it("select.minDelta 0.5·'1' → 400", async () => {
      for (const minDelta of [0.5, '1']) {
        const msgs = await expect400(withCal({ yearPolicy: { span: 'calendar-year', select: { minDelta, maxDelta: 1 } } }));
        expect(msgs.join('\n')).toContain('minDelta');
      }
    });

    it('미등재 키(yearPolicy.foo·select.bar) → 400 (forbidNonWhitelisted)', async () => {
      const m1 = await expect400(withCal({ yearPolicy: { span: 'calendar-year', foo: 1 } }));
      expect(m1.join('\n')).toContain('foo');
      const m2 = await expect400(withCal({ yearPolicy: { span: 'calendar-year', select: { minDelta: 0, maxDelta: 1, bar: 1 } } }));
      expect(m2.join('\n')).toContain('bar');
    });

    it('select 범위 위반(maxDelta 3·min>max·데이터 밖) → 400 메시지에 types 문구 포함', async () => {
      const m1 = await expect400(withCal({ yearPolicy: { span: 'calendar-year', select: { minDelta: 0, maxDelta: 3 } } }));
      expect(m1.join('\n')).toContain('calendar.yearPolicy.select.minDelta/maxDelta 는 -2~2 정수여야 합니다');
      const m2 = await expect400(withCal({ yearPolicy: { span: 'calendar-year', select: { minDelta: 1, maxDelta: 0 } } }));
      expect(m2.join('\n')).toContain('calendar.yearPolicy.select.minDelta 는 maxDelta 이하여야 합니다');
      const m3 = await expect400(withCal({ yearPolicy: { span: 'calendar-year', select: { minDelta: -2, maxDelta: 0 } } }));
      expect(m3.join('\n')).toContain('calendar.yearPolicy.select 연달력 범위(2024-01~2027-12)는 데이터 범위 2025-01~2035-12 안이어야 합니다');
    });
  });

  // ── T4 잡절(v1.27): calendar.show.minorTerms — whitelist 등재(미등재면 forbidNonWhitelisted 로 admin 저장 400) ──
  it('calendar.show.minorTerms — 생략은 직렬화에 키 없음, boolean 은 Create·Update 통과·보존, 비불리언 400 (T4, v1.27)', async () => {
    const plain = await pipe.transform({ ...base, productProfile: deskLargeProfile }, { type: 'body', metatype: CreateTemplateSetDto });
    expect(JSON.stringify(plain.productProfile)).toBe(JSON.stringify(deskLargeProfile));
    expect(Object.keys(JSON.parse(JSON.stringify(plain.productProfile)).calendar.show)).not.toContain('minorTerms');

    const profile = { ...deskLargeProfile, calendar: { ...deskLargeProfile.calendar, show: { ...deskLargeProfile.calendar.show, minorTerms: true } } };
    const created = await pipe.transform({ ...base, productProfile: profile }, { type: 'body', metatype: CreateTemplateSetDto });
    expect(created.productProfile.calendar.show.minorTerms).toBe(true);
    expect(JSON.parse(JSON.stringify(created.productProfile))).toEqual(profile);
    const updated = await pipe.transform({ productProfile: profile }, { type: 'body', metatype: UpdateTemplateSetDto });
    expect(updated.productProfile.calendar.show.minorTerms).toBe(true);

    const msgs = await expect400({
      ...base,
      productProfile: { ...deskLargeProfile, calendar: { ...deskLargeProfile.calendar, show: { ...deskLargeProfile.calendar.show, minorTerms: 'on' } } },
    });
    expect(msgs.join('\n')).toMatch(/minorTerms/);
  });

  it('faceLabels 1개 → 400', async () => {
    const messages = await expect400({
      ...base,
      productProfile: {
        ...deskLargeProfile,
        calendar: { ...deskLargeProfile.calendar, faceLabels: ['앞면'] },
      },
    });
    expect(messages.join('\n')).toContain('faceLabels');
  });
});
