import {
  deriveEditorSpreadValidationOverrides,
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
