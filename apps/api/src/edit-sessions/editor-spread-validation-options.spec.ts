import {
  deriveEditorContentPageRules,
  deriveEditorSpreadValidationOverrides,
  EditorContentLayoutKind,
  EditorContentPageRules,
  EditorContentPageRulesInput,
  normalizeOrderBinding,
} from './editor-spread-validation-options';

/**
 * R-195 — 편집기 스프레드 책 검증 잡 보정(순수 함수). 운영 실측 기하:
 * 210×297 · 책등 1.3 · 크롭마크(도련 3) 출력 427.3×303 / 크롭마크 없음 출력 = 2W+책등(도련 미가산).
 */
describe('normalizeOrderBinding', () => {
  it.each([
    ['perfect', 'perfect'],
    [' Saddle ', 'saddle'],
    ['spiral', 'spiral'],
    ['spring', 'spring'],
    ['HARDCOVER', 'hardcover'],
  ])('%p → %p', (raw, expected) => {
    expect(normalizeOrderBinding(raw)).toBe(expected);
  });

  it.each([['-'], [''], ['   '], ['무선'], [null], [undefined], [3]])(
    '%p → undefined (현행 값 유지)',
    (raw) => {
      expect(normalizeOrderBinding(raw)).toBeUndefined();
    },
  );
});

describe('deriveEditorSpreadValidationOverrides', () => {
  const spec = (over: Record<string, unknown> = {}) => ({
    coverWidthMm: 210,
    coverHeightMm: 297,
    spineWidthMm: 1.3,
    wingEnabled: false,
    wingWidthMm: 0,
    cutSizeMm: 3,
    safeSizeMm: 5,
    dpi: 150,
    ...over,
  });
  const meta = (over: Record<string, unknown> = {}) => ({
    orderOptions: { bindingType: 'perfect', paperType: '미색모조 80g', pageCount: 100 },
    spreadContentPageCount: 100,
    spread: { spec: spec(), totalWidthMm: 421.3, totalHeightMm: 297, dpi: 150 },
    coverOutput: { widthMm: 427.3, heightMm: 303, bleedMm: 3 },
    appliedSpine: { spineWidthMm: 1.3, source: 'host' },
    ...over,
  });

  it('스프레드 스냅샷 없음(비스프레드·구 세션) → null (현행 그대로)', () => {
    expect(deriveEditorSpreadValidationOverrides(null)).toBeNull();
    expect(deriveEditorSpreadValidationOverrides({ orderOptions: { bindingType: 'saddle' } })).toBeNull();
  });

  it('크롭마크 출력(도련 3) — 기대식 = 출력 → 표지 책등 기하 연결, 호스트 고정은 paperType 미탑재', () => {
    const r = deriveEditorSpreadValidationOverrides(meta());
    expect(r?.content).toEqual({ binding: 'perfect', pages: 100 });
    expect(r?.cover).toEqual({
      binding: 'perfect',
      size: { width: 210, height: 297 },
      spineWidthMm: 1.3,
      wingEnabled: false,
      wingWidthMm: 0,
      bleed: 3,
      expectedOrientation: 'landscape',
    });
    expect(r?.cover).not.toHaveProperty('paperType');
  });

  it('크롭마크 없는 출력(도련 미가산, 운영 214×301 사례) → bleed 0 으로 연결', () => {
    const r = deriveEditorSpreadValidationOverrides(
      meta({
        spread: { spec: spec({ coverWidthMm: 214, coverHeightMm: 301 }) },
        coverOutput: { widthMm: 429.3, heightMm: 301, bleedMm: 0 },
      }),
    );
    expect(r?.cover).toMatchObject({ size: { width: 214, height: 301 }, spineWidthMm: 1.3, bleed: 0 });
  });

  it('공식 출처 + 유효 spine 스냅샷 → paperType·pages 탑재(서버 재계산 대조)', () => {
    const r = deriveEditorSpreadValidationOverrides(
      meta({
        appliedSpine: { spineWidthMm: 1.3, source: 'formula' },
        spine: { pageCount: 100, paperType: '미색모조 80g', bindingType: 'perfect', spineWidthMm: 1.3, formulaVersion: 'v2' },
      }),
    );
    expect(r?.cover).toMatchObject({ paperType: '미색모조 80g', pages: 100 });
  });

  it('스프링 무책등(책등 0) → spiral + spineWidthMm 0 연결(워커 2W+도련×2)', () => {
    const r = deriveEditorSpreadValidationOverrides(
      meta({
        orderOptions: { bindingType: 'spiral' },
        spread: { spec: spec({ spineWidthMm: 0 }) },
        coverOutput: { widthMm: 426, heightMm: 303, bleedMm: 3 },
        appliedSpine: { spineWidthMm: 0, source: 'host' },
      }),
    );
    expect(r?.content).toEqual({ binding: 'spiral', pages: 100 });
    expect(r?.cover).toMatchObject({ binding: 'spiral', spineWidthMm: 0, bleed: 3 });
  });

  it('날개 사용 → 기대식에 날개×2 포함, wing 필드 연결', () => {
    const r = deriveEditorSpreadValidationOverrides(
      meta({
        spread: { spec: spec({ wingEnabled: true, wingWidthMm: 80 }) },
        coverOutput: { widthMm: 587.3, heightMm: 303, bleedMm: 3 },
      }),
    );
    expect(r?.cover).toMatchObject({ wingEnabled: true, wingWidthMm: 80 });
  });

  it('양장 → 표지 연결 생략(싸바리 전개식 미검증), 내지 binding 은 현행 유지', () => {
    const r = deriveEditorSpreadValidationOverrides(meta({ orderOptions: { bindingType: 'hardcover' } }));
    expect(r?.cover).toBeNull();
    expect(r?.coverSkipReason).toBe('HARDCOVER_GEOMETRY_UNVERIFIED');
    expect(r?.content).toEqual({ pages: 100 });
  });

  it('coverOutput 없음(구 편집기 빌드) → 표지 연결 생략, 내지 보정은 적용', () => {
    const r = deriveEditorSpreadValidationOverrides(meta({ coverOutput: undefined }));
    expect(r?.cover).toBeNull();
    expect(r?.coverSkipReason).toBe('NO_COVER_OUTPUT');
    expect(r?.content).toEqual({ binding: 'perfect', pages: 100 });
  });

  it('출력 크기 ≠ 기대식(caseBind printSize 등) → 표지 연결 생략 + 진단값', () => {
    const r = deriveEditorSpreadValidationOverrides(
      meta({ coverOutput: { widthMm: 484, heightMm: 345, bleedMm: 0 } }),
    );
    expect(r?.cover).toBeNull();
    expect(r?.coverSkipReason).toBe('GEOMETRY_INCONSISTENT');
    expect(r?.coverGeometry).toEqual({
      expectedWidthMm: 421.3,
      expectedHeightMm: 297,
      outputWidthMm: 484,
      outputHeightMm: 345,
    });
  });

  it('비정상 spec(음수 책등) → INVALID_SPEC', () => {
    const r = deriveEditorSpreadValidationOverrides(meta({ spread: { spec: spec({ spineWidthMm: -1 }) } }));
    expect(r?.coverSkipReason).toBe('INVALID_SPEC');
  });

  it("주문 제본 '-'·미전달 → binding 미보정(현행 metadata.binding ?? 'perfect' 유지)", () => {
    const r = deriveEditorSpreadValidationOverrides(meta({ orderOptions: { bindingType: '-' } }));
    expect(r?.content).toEqual({ pages: 100 });
    expect(r?.cover).not.toHaveProperty('binding');
  });

  it('spreadContentPageCount 없으면 spine 스냅샷 pageCount 로 폴백', () => {
    const r = deriveEditorSpreadValidationOverrides(
      meta({ spreadContentPageCount: undefined, spine: { pageCount: 48 } }),
    );
    expect(r?.content.pages).toBe(48);
  });

  it.each([
    ['크롭마크 출력', {}],
    ['양장(layout 없음)', { orderOptions: { bindingType: 'hardcover' } }],
    ['coverOutput 없음', { coverOutput: undefined }],
    ['출력 ≠ 기대식', { coverOutput: { widthMm: 484, heightMm: 345, bleedMm: 0 } }],
    ['공식 출처', { appliedSpine: { source: 'formula' }, spine: { pageCount: 100, paperType: '미색모조 80g' } }],
  ])('%s — 템플릿셋 판형 인자 유/무와 관계없이 같은 결과', (_label, over) => {
    const m = meta(over);
    const base = deriveEditorSpreadValidationOverrides(m);
    expect(deriveEditorSpreadValidationOverrides(m, { widthMm: 210, heightMm: 297 })).toEqual(base);
    expect(deriveEditorSpreadValidationOverrides(m, null)).toEqual(base);
  });
});

describe('deriveEditorSpreadValidationOverrides — 싸바리 전개 표지(layout=hardcover-wrap)', () => {
  const A4 = { widthMm: 210, heightMm: 297 };
  // A4 · 책등 8: 면 218×305, 전개 (218×2+8+40)×(305+40) = 484×345
  const wrapSpec = (over: Record<string, unknown> = {}) => ({
    coverWidthMm: 218,
    coverHeightMm: 305,
    spineWidthMm: 8,
    wingEnabled: false,
    wingWidthMm: 0,
    cutSizeMm: 40,
    safeSizeMm: 5,
    dpi: 150,
    ...over,
  });
  const wrapOutput = (over: Record<string, unknown> = {}) => ({
    widthMm: 484,
    heightMm: 345,
    bleedMm: 0,
    layout: 'hardcover-wrap',
    trimWidthMm: 210,
    trimHeightMm: 297,
    wrapMm: 20,
    ...over,
  });
  const wrapMeta = (over: Record<string, unknown> = {}) => ({
    orderOptions: { bindingType: 'hardcover', paperType: '미색모조 80g', pageCount: 32 },
    spreadContentPageCount: 32,
    spread: { spec: wrapSpec(), totalWidthMm: 444, totalHeightMm: 305, dpi: 150 },
    coverOutput: wrapOutput(),
    appliedSpine: { spineWidthMm: 8, source: 'host' },
    ...over,
  });
  const formulaSpine = {
    appliedSpine: { spineWidthMm: 8, source: 'formula' },
    spine: { pageCount: 32, paperType: '미색모조 80g', bindingType: 'hardcover', spineWidthMm: 8 },
  };

  it('주문 제본 미전달 + 전개식 일치 → hardcover 표지 연결, 공식 출처여도 paperType 미탑재', () => {
    const r = deriveEditorSpreadValidationOverrides(
      wrapMeta({ orderOptions: { bindingType: '-' }, ...formulaSpine }),
      A4,
    );
    expect(r?.content).toEqual({ pages: 32 });
    expect(r?.coverSkipReason).toBeUndefined();
    expect(r?.cover).toEqual({
      binding: 'hardcover',
      size: { width: 210, height: 297 },
      spineWidthMm: 8,
      wingEnabled: false,
      wingWidthMm: 0,
      bleed: 0,
      expectedOrientation: 'landscape',
    });
  });

  it('양장 주문 + 공식 출처 → paperType·pages 탑재', () => {
    const r = deriveEditorSpreadValidationOverrides(wrapMeta(formulaSpine), A4);
    expect(r?.content).toEqual({ pages: 32 });
    expect(r?.cover).toMatchObject({
      binding: 'hardcover',
      size: { width: 210, height: 297 },
      spineWidthMm: 8,
      paperType: '미색모조 80g',
      pages: 32,
    });
  });

  it('양장 주문 + 호스트 고정 책등 → paperType·pages 미탑재', () => {
    const r = deriveEditorSpreadValidationOverrides(wrapMeta(), A4);
    expect(r?.cover).toMatchObject({ binding: 'hardcover', spineWidthMm: 8, bleed: 0 });
    expect(r?.cover).not.toHaveProperty('paperType');
    expect(r?.cover).not.toHaveProperty('pages');
  });

  it('210×210 · 책등 8 → 전개 484×258 로 연결', () => {
    const r = deriveEditorSpreadValidationOverrides(
      wrapMeta({
        spread: { spec: wrapSpec({ coverWidthMm: 218, coverHeightMm: 218 }) },
        coverOutput: wrapOutput({ widthMm: 484, heightMm: 258, trimWidthMm: 210, trimHeightMm: 210 }),
      }),
      { widthMm: 210, heightMm: 210 },
    );
    expect(r?.cover).toMatchObject({ binding: 'hardcover', size: { width: 210, height: 210 } });
  });

  it('주문 제본이 양장이 아님(perfect) → BINDING_LAYOUT_CONFLICT, 내지 보정은 적용', () => {
    const r = deriveEditorSpreadValidationOverrides(
      wrapMeta({ orderOptions: { bindingType: 'perfect' } }),
      A4,
    );
    expect(r?.cover).toBeNull();
    expect(r?.coverSkipReason).toBe('BINDING_LAYOUT_CONFLICT');
    expect(r?.content).toEqual({ binding: 'perfect', pages: 32 });
  });

  it('출력 444×305(싸바리 여분 없음) → GEOMETRY_INCONSISTENT + 진단값', () => {
    const r = deriveEditorSpreadValidationOverrides(
      wrapMeta({ coverOutput: wrapOutput({ widthMm: 444, heightMm: 305 }) }),
      A4,
    );
    expect(r?.cover).toBeNull();
    expect(r?.coverSkipReason).toBe('GEOMETRY_INCONSISTENT');
    expect(r?.coverGeometry).toEqual({
      expectedWidthMm: 484,
      expectedHeightMm: 345,
      outputWidthMm: 444,
      outputHeightMm: 305,
    });
  });

  it('표지 면 ≠ 판형+8 → GEOMETRY_INCONSISTENT', () => {
    const r = deriveEditorSpreadValidationOverrides(
      wrapMeta({ spread: { spec: wrapSpec({ coverWidthMm: 210, coverHeightMm: 297 }) } }),
      A4,
    );
    expect(r?.cover).toBeNull();
    expect(r?.coverSkipReason).toBe('GEOMETRY_INCONSISTENT');
  });

  it('기록 판형 ≠ 템플릿셋 판형 → GEOMETRY_INCONSISTENT', () => {
    const r = deriveEditorSpreadValidationOverrides(wrapMeta(), { widthMm: 210, heightMm: 210 });
    expect(r?.cover).toBeNull();
    expect(r?.coverSkipReason).toBe('GEOMETRY_INCONSISTENT');
  });

  it('판형 차 허용 0.5mm — 0.2 는 템플릿셋 판형으로 연결, 0.6 은 GEOMETRY_INCONSISTENT', () => {
    expect(
      deriveEditorSpreadValidationOverrides(wrapMeta(), { widthMm: 210.2, heightMm: 297 })?.cover,
    ).toMatchObject({ binding: 'hardcover', size: { width: 210.2, height: 297 } });
    expect(
      deriveEditorSpreadValidationOverrides(wrapMeta(), { widthMm: 210.6, heightMm: 297 })
        ?.coverSkipReason,
    ).toBe('GEOMETRY_INCONSISTENT');
  });

  it.each([[undefined], [null], [{ widthMm: 0, heightMm: 297 }]])(
    '템플릿셋 판형 %p → GEOMETRY_INCONSISTENT',
    (trim) => {
      const r = deriveEditorSpreadValidationOverrides(wrapMeta(), trim);
      expect(r?.cover).toBeNull();
      expect(r?.coverSkipReason).toBe('GEOMETRY_INCONSISTENT');
    },
  );

  it.each([['trimWidthMm'], ['trimHeightMm'], ['wrapMm'], ['widthMm']])(
    'coverOutput.%s 없음 → GEOMETRY_INCONSISTENT',
    (key) => {
      const r = deriveEditorSpreadValidationOverrides(
        wrapMeta({ coverOutput: wrapOutput({ [key]: undefined }) }),
        A4,
      );
      expect(r?.coverSkipReason).toBe('GEOMETRY_INCONSISTENT');
    },
  );

  it('비정상 spec(음수 책등·날개 사용) → INVALID_SPEC', () => {
    expect(
      deriveEditorSpreadValidationOverrides(
        wrapMeta({ spread: { spec: wrapSpec({ spineWidthMm: -1 }) } }),
        A4,
      )?.coverSkipReason,
    ).toBe('INVALID_SPEC');
    expect(
      deriveEditorSpreadValidationOverrides(
        wrapMeta({ spread: { spec: wrapSpec({ wingEnabled: true, wingWidthMm: 80 }) } }),
        A4,
      )?.coverSkipReason,
    ).toBe('INVALID_SPEC');
  });

  it('layout 없는 양장 주문 → 템플릿셋 판형이 있어도 HARDCOVER_GEOMETRY_UNVERIFIED', () => {
    const r = deriveEditorSpreadValidationOverrides(
      wrapMeta({ coverOutput: wrapOutput({ layout: undefined }) }),
      A4,
    );
    expect(r?.cover).toBeNull();
    expect(r?.coverSkipReason).toBe('HARDCOVER_GEOMETRY_UNVERIFIED');
  });
});

/**
 * N-API-3b — 편집 완료 content 검증 잡 쪽 단위(오너 결정 D1(a)·D2(a)·D3(a)).
 * 물리 쪽 단위 S → content PDF 쪽 단위 pageMultiple = Mphys / gcd(Mphys, k), 중철 상한 = MaxPhys / k.
 */
describe('deriveEditorContentPageRules', () => {
  const CONTENT_ID = 'file-content-1';

  interface Case {
    bindingType?: string;
    hostStep?: unknown;
    hostMax?: unknown;
    templateStep?: unknown;
    layout?: EditorContentLayoutKind;
    /** 미지정 시 R-195 on 기준: 비양장 정규 제본이면 그 값, 그 밖은 'perfect' */
    legacyBinding?: string;
  }

  const r195Legacy = (bindingType: string | undefined): string => {
    const b = normalizeOrderBinding(bindingType);
    return b && b !== 'hardcover' ? b : 'perfect';
  };

  const input = (c: Case): EditorContentPageRulesInput => ({
    metadata: {
      orderOptions: {
        ...(c.bindingType !== undefined ? { bindingType: c.bindingType } : {}),
        ...(c.hostStep !== undefined ? { pageStep: c.hostStep } : {}),
        ...(c.hostMax !== undefined ? { pageCountMax: c.hostMax } : {}),
      },
      spreadContentPageCount: 20,
      spread: { spec: { coverWidthMm: 210, coverHeightMm: 297, spineWidthMm: 1 } },
      editorOutputContentFileId: CONTENT_ID,
    },
    contentFileId: CONTENT_ID,
    templatePageStep: c.templateStep ?? null,
    layout: c.layout ?? 'none',
    legacyBinding: c.legacyBinding ?? r195Legacy(c.bindingType),
  });

  const run = (c: Case): EditorContentPageRules | null => deriveEditorContentPageRules(input(c));

  describe('환산표(D1(a) 기준)', () => {
    it.each<[string, Case, EditorContentPageRules | null]>([
      ['step4 펼침 perfect → 2', { bindingType: 'perfect', templateStep: 4, layout: 'inner-spread' },
        { pageMultiple: 2, physicalStep: 4, pagesPerPdfPage: 2, source: 'template' }],
      ['step4 펼침 hardcover → 2', { bindingType: 'hardcover', templateStep: 4, layout: 'inner-spread' },
        { pageMultiple: 2, physicalStep: 4, pagesPerPdfPage: 2, source: 'template' }],
      ['step2 펼침 → 1', { bindingType: 'perfect', templateStep: 2, layout: 'inner-spread' },
        { pageMultiple: 1, physicalStep: 2, pagesPerPdfPage: 2, source: 'template' }],
      ['step3 펼침 → 3', { bindingType: 'perfect', templateStep: 3, layout: 'inner-spread' },
        { pageMultiple: 3, physicalStep: 3, pagesPerPdfPage: 2, source: 'template' }],
      ['step2 낱장 → 2', { bindingType: 'perfect', templateStep: 2 },
        { pageMultiple: 2, physicalStep: 2, pagesPerPdfPage: 1, source: 'template' }],
      ['step4 낱장 → 4', { bindingType: 'perfect', templateStep: 4 },
        { pageMultiple: 4, physicalStep: 4, pagesPerPdfPage: 1, source: 'template' }],
      ['host1 낱장 비중철 → 1(템플릿 단위 무시)', { bindingType: 'perfect', hostStep: 1, templateStep: 4 },
        { pageMultiple: 1, physicalStep: 1, pagesPerPdfPage: 1, source: 'host-none' }],
      ['host1 중철 낱장 → 4·max64', { bindingType: 'saddle', hostStep: 1, templateStep: 2 },
        { pageMultiple: 4, pageCountMax: 64, physicalStep: 1, pagesPerPdfPage: 1, source: 'saddle-floor' }],
      ['중철 step2 낱장 → 4·max64', { bindingType: 'saddle', templateStep: 2 },
        { pageMultiple: 4, pageCountMax: 64, physicalStep: 2, pagesPerPdfPage: 1, source: 'saddle-floor' }],
      ['중철 step4 펼침 → 2·max32', { bindingType: 'saddle', templateStep: 4, layout: 'inner-spread' },
        { pageMultiple: 2, pageCountMax: 32, physicalStep: 4, pagesPerPdfPage: 2, source: 'saddle-floor' }],
      ['중철 + host max 80 낱장 → 80', { bindingType: 'saddle', hostMax: 80, templateStep: 2 },
        { pageMultiple: 4, pageCountMax: 80, physicalStep: 2, pagesPerPdfPage: 1, source: 'saddle-floor' }],
      ['중철 + host max 80 펼침 → 40', { bindingType: 'saddle', hostMax: 80, templateStep: 2, layout: 'inner-spread' },
        { pageMultiple: 2, pageCountMax: 40, physicalStep: 2, pagesPerPdfPage: 2, source: 'saddle-floor' }],
      ['NULL 낱장 perfect(명시) → null (D1(a))', { bindingType: 'perfect' }, null],
      ['NULL 낱장 hardcover → null', { bindingType: 'hardcover' }, null],
      ['NULL 낱장 spring → null', { bindingType: 'spring' }, null],
      ['NULL 낱장 spiral → null', { bindingType: 'spiral' }, null],
      ['NULL 낱장 제본 미전송 → null', {}, null],
      ['NULL 펼침 perfect(명시) → 2 (D1(a): 물리 4)', { bindingType: 'perfect', layout: 'inner-spread' },
        { pageMultiple: 2, physicalStep: null, pagesPerPdfPage: 2, source: 'legacy-2up' }],
      ['NULL 펼침 hardcover → 2', { bindingType: 'hardcover', layout: 'inner-spread' },
        { pageMultiple: 2, physicalStep: null, pagesPerPdfPage: 2, source: 'legacy-2up' }],
      ['NULL 펼침 미전송 → 2', { layout: 'inner-spread' },
        { pageMultiple: 2, physicalStep: null, pagesPerPdfPage: 2, source: 'legacy-2up' }],
      ['NULL 펼침 spring → 1', { bindingType: 'spring', layout: 'inner-spread' },
        { pageMultiple: 1, physicalStep: null, pagesPerPdfPage: 2, source: 'legacy-2up' }],
      ['NULL 펼침 spiral → 1', { bindingType: 'spiral', layout: 'inner-spread' },
        { pageMultiple: 1, physicalStep: null, pagesPerPdfPage: 2, source: 'legacy-2up' }],
      ['NULL 펼침 중철 → 2·max32', { bindingType: 'saddle', layout: 'inner-spread' },
        { pageMultiple: 2, pageCountMax: 32, physicalStep: null, pagesPerPdfPage: 2, source: 'saddle-floor' }],
      ['R-195 off + 중철 주문 낱장 step2 → 4·max64', { bindingType: 'saddle', templateStep: 2, legacyBinding: 'perfect' },
        { pageMultiple: 4, pageCountMax: 64, physicalStep: 2, pagesPerPdfPage: 1, source: 'saddle-floor' }],
    ])('%s', (_name, c, expected) => {
      expect(run(c)).toEqual(expected);
    });

    it('범위 키(pageCountMin·비중철 pageCountMax)는 싣지 않는다(D3)', () => {
      const r = run({ bindingType: 'perfect', hostMax: 120, templateStep: 2 });
      expect(r).toEqual({ pageMultiple: 2, physicalStep: 2, pagesPerPdfPage: 1, source: 'template' });
      expect(r).not.toHaveProperty('pageCountMax');
      expect(r).not.toHaveProperty('pageCountMin');
    });
  });

  describe('게이트 — 하나라도 어긋나면 null(키 미주입)', () => {
    const base = (): EditorContentPageRulesInput => input({ bindingType: 'perfect', templateStep: 2 });
    const withMeta = (patch: (m: Record<string, unknown>) => void): EditorContentPageRulesInput => {
      const i = base();
      const m = { ...(i.metadata as Record<string, unknown>) };
      patch(m);
      return { ...i, metadata: m };
    };

    it('기준 입력은 통과(대조군)', () => {
      expect(deriveEditorContentPageRules(base())).not.toBeNull();
    });

    it('spread.spec 없음 → null', () => {
      expect(deriveEditorContentPageRules(withMeta((m) => { delete m.spread; }))).toBeNull();
      expect(deriveEditorContentPageRules(withMeta((m) => { m.spread = { totalWidthMm: 420 }; }))).toBeNull();
    });

    it('spreadContentPageCount 없음·비정상 → null', () => {
      expect(deriveEditorContentPageRules(withMeta((m) => { delete m.spreadContentPageCount; }))).toBeNull();
      expect(deriveEditorContentPageRules(withMeta((m) => { m.spreadContentPageCount = 0; }))).toBeNull();
    });

    it('산출물 마커 불일치(첨부 교체 세션) → null', () => {
      expect(
        deriveEditorContentPageRules(withMeta((m) => { m.editorOutputContentFileId = 'file-other'; })),
      ).toBeNull();
    });

    it('산출물 마커 없음(구 세션) → null', () => {
      expect(deriveEditorContentPageRules(withMeta((m) => { delete m.editorOutputContentFileId; }))).toBeNull();
    });

    it.each([[null], [undefined], ['']])('contentFileId %p → null', (contentFileId) => {
      expect(deriveEditorContentPageRules({ ...base(), contentFileId })).toBeNull();
    });

    it("layout 'unknown'(펼침면 판정 실패) → null", () => {
      expect(deriveEditorContentPageRules({ ...base(), layout: 'unknown' })).toBeNull();
    });

    it('metadata 비객체 → null', () => {
      expect(deriveEditorContentPageRules({ ...base(), metadata: null })).toBeNull();
      expect(deriveEditorContentPageRules({ ...base(), metadata: 'x' })).toBeNull();
    });
  });

  describe('호스트 pageStep 해석', () => {
    it.each([[0], [1.5], ['x'], [-2], [null], ['']])('host %p(비정상) → 템플릿 단위로 폴백', (hostStep) => {
      expect(run({ bindingType: 'perfect', hostStep, templateStep: 4 })).toEqual({
        pageMultiple: 4, physicalStep: 4, pagesPerPdfPage: 1, source: 'template',
      });
    });

    it("host '4'(숫자 문자열)는 인정 — 템플릿보다 우선", () => {
      expect(run({ bindingType: 'perfect', hostStep: '4', templateStep: 2 })).toEqual({
        pageMultiple: 4, physicalStep: 4, pagesPerPdfPage: 1, source: 'host',
      });
    });

    it('host 6 > 템플릿 2 → 호스트 우선', () => {
      expect(run({ bindingType: 'perfect', hostStep: 6, templateStep: 2 })?.pageMultiple).toBe(6);
    });

    it("템플릿 pageStep 숫자 문자열 '2' 도 인정", () => {
      expect(run({ bindingType: 'perfect', templateStep: '2' })?.pageMultiple).toBe(2);
    });
  });

  describe('제본 판정(주문값 기준, R-195 독립)', () => {
    it('양장 주문(legacyBinding perfect): step4 낱장 → 4, NULL 낱장 → null(2로 완화 안 됨)', () => {
      expect(run({ bindingType: 'hardcover', templateStep: 4 })).toEqual({
        pageMultiple: 4, physicalStep: 4, pagesPerPdfPage: 1, source: 'template',
      });
      expect(run({ bindingType: 'hardcover' })).toBeNull();
    });

    it('spring·spiral 주문: step2 → 2, NULL 낱장 → null', () => {
      for (const bindingType of ['spring', 'spiral']) {
        expect(run({ bindingType, templateStep: 2 })?.pageMultiple).toBe(2);
        expect(run({ bindingType })).toBeNull();
      }
    });

    it("주문 제본 미전송 + legacyBinding 'saddle'(구 metadata.binding) → 중철 바닥값", () => {
      expect(run({ legacyBinding: 'saddle' })).toEqual({
        pageMultiple: 4, pageCountMax: 64, physicalStep: null, pagesPerPdfPage: 1, source: 'saddle-floor',
      });
    });

    it('중철 호스트 pageCountMax 비정상(0·문자열) → 64', () => {
      expect(run({ bindingType: 'saddle', hostMax: 0, templateStep: 2 })?.pageCountMax).toBe(64);
      expect(run({ bindingType: 'saddle', hostMax: '80', templateStep: 2 })?.pageCountMax).toBe(64);
    });

    it('중철 펼침면에서 호스트 상한이 펼침 단위보다 작아도 상한(1)을 남긴다', () => {
      expect(run({ bindingType: 'saddle', hostMax: 1, templateStep: 4, layout: 'inner-spread' })?.pageCountMax).toBe(1);
    });

    it('쪽 단위가 편집기 한도(500)를 넘으면 무효 — 템플릿 단위로 폴백, 템플릿도 넘으면 레거시', () => {
      expect(run({ bindingType: 'perfect', hostStep: 1000, templateStep: 2 })?.pageMultiple).toBe(2);
      expect(run({ bindingType: 'perfect', hostStep: 500, templateStep: 2 })?.pageMultiple).toBe(500);
      expect(run({ bindingType: 'perfect', hostStep: 1e300, templateStep: 1e300 })).toBeNull();
    });
  });

  it('재편집 한계 고정: 판정은 metadata.orderOptions.pageStep 만 읽고 다른 키는 무시', () => {
    const i = input({ bindingType: 'perfect' });
    const m = i.metadata as Record<string, unknown>;
    const withOtherKeys: EditorContentPageRulesInput = {
      ...i,
      metadata: { ...m, pageStep: 2, hostPageLimits: { pageStep: 2 }, pageCountMin: 16 },
    };
    expect(deriveEditorContentPageRules(withOtherKeys)).toBeNull();
    const withRecorded: EditorContentPageRulesInput = {
      ...i,
      metadata: { ...m, orderOptions: { bindingType: 'perfect', pageStep: 2 } },
    };
    expect(deriveEditorContentPageRules(withRecorded)?.pageMultiple).toBe(2);
  });
});
