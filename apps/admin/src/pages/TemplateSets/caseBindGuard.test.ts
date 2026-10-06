import { describe, it, expect } from 'vitest';
import type { CaseBindSpec } from '@storige/types';
import { detectCaseBindOnHardcoverWrap, type CaseBindGuardTemplate } from './caseBindGuard';

type CaseBindFixture = Partial<CaseBindSpec> | null;

const VALID_CASE_BIND = { boardThicknessMm: 2, turnInMm: 15, wrapMarginMm: 3 };
const EMPTY_INPUTS: readonly unknown[] = [undefined, null, undefined];

const coverSpread = (caseBind?: CaseBindFixture): CaseBindGuardTemplate => ({
  type: 'spread',
  spreadConfig: {
    regionScope: 'cover',
    spec: {
      coverWidthMm: 218,
      coverHeightMm: 218,
      ...(caseBind !== undefined ? { caseBind } : {}),
    },
  },
});
const innerSpread = (caseBind?: CaseBindFixture): CaseBindGuardTemplate => ({
  type: 'spread',
  spreadConfig: {
    regionScope: 'inner',
    spec: caseBind !== undefined ? { caseBind } : null,
    innerSpec: { pageWidthMm: 210, pageHeightMm: 210 },
  },
});

describe('detectCaseBindOnHardcoverWrap — hardcover_wrap 세트 caseBind 저장 전 경고 판정', () => {
  it('coverType 이 hardcover_wrap 이 아니면 입력·표지 caseBind 와 무관하게 통과', () => {
    for (const coverType of [null, undefined, '', '  ', 'softcover_variable_spine', 'ready_made', 'custom_hard', 'HARDCOVER_WRAP']) {
      expect(
        detectCaseBindOnHardcoverWrap({
          coverType,
          caseBindInputs: [2, 15, 3],
          templates: [coverSpread(VALID_CASE_BIND)],
        }),
      ).toEqual({ blocked: false, sources: [] });
    }
  });

  it('hardcover_wrap + 입력 세 칸 모두 비움 + 표지 caseBind 없음 → 통과(싸바리 모드 유지)', () => {
    expect(
      detectCaseBindOnHardcoverWrap({
        coverType: 'hardcover_wrap',
        caseBindInputs: EMPTY_INPUTS,
        templates: [coverSpread(), { type: 'page' }],
      }),
    ).toEqual({ blocked: false, sources: [] });
  });

  it('coverType 앞뒤 공백을 trim 하고, 입력 한 칸이라도 non-null(0 포함)이면 templateSet 사유로 경고', () => {
    for (const inputs of [[0, null, null], [undefined, 15, undefined], [null, null, 0]]) {
      expect(
        detectCaseBindOnHardcoverWrap({
          coverType: '  hardcover_wrap ',
          caseBindInputs: inputs,
          templates: [coverSpread()],
        }),
      ).toEqual({ blocked: true, sources: ['templateSet'] });
    }
  });

  it('입력이 비어 있어도 표지 템플릿 spec.caseBind 가 유효하면 coverTemplate 사유로 경고', () => {
    expect(
      detectCaseBindOnHardcoverWrap({
        coverType: 'hardcover_wrap',
        caseBindInputs: EMPTY_INPUTS,
        templates: [coverSpread(VALID_CASE_BIND), innerSpread()],
      }),
    ).toEqual({ blocked: true, sources: ['coverTemplate'] });
  });

  it('표지 spec.caseBind 가 부분·비정상 값이거나 내지 펼침면에만 있으면 편집기와 같이 무시', () => {
    const ignored: CaseBindFixture[] = [
      { boardThicknessMm: 2 },
      { boardThicknessMm: -1, turnInMm: 15, wrapMarginMm: 3 },
      null,
    ];
    for (const caseBind of ignored) {
      expect(
        detectCaseBindOnHardcoverWrap({
          coverType: 'hardcover_wrap',
          caseBindInputs: EMPTY_INPUTS,
          templates: [coverSpread(caseBind)],
        }),
      ).toEqual({ blocked: false, sources: [] });
    }
    expect(
      detectCaseBindOnHardcoverWrap({
        coverType: 'hardcover_wrap',
        caseBindInputs: EMPTY_INPUTS,
        templates: [innerSpread(VALID_CASE_BIND)],
      }),
    ).toEqual({ blocked: false, sources: [] });
  });

  it('표지는 편집기와 같이 첫 표지(coverDefault)만 본다 — 두 사유가 모두 있으면 둘 다 보고', () => {
    expect(
      detectCaseBindOnHardcoverWrap({
        coverType: 'hardcover_wrap',
        caseBindInputs: EMPTY_INPUTS,
        templates: [innerSpread(), coverSpread(), coverSpread(VALID_CASE_BIND)],
      }),
    ).toEqual({ blocked: false, sources: [] });
    expect(
      detectCaseBindOnHardcoverWrap({
        coverType: 'hardcover_wrap',
        caseBindInputs: [2, undefined, undefined],
        templates: [innerSpread(), coverSpread(VALID_CASE_BIND)],
      }),
    ).toEqual({ blocked: true, sources: ['templateSet', 'coverTemplate'] });
  });
});
