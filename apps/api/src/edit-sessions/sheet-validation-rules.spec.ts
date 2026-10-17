import { deriveSheetValidationRules, SheetValidationRulesInput } from './sheet-validation-rules';
import { SessionMode } from './entities/edit-session.entity';

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
});
