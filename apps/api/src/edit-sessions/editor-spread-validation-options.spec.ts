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
});
