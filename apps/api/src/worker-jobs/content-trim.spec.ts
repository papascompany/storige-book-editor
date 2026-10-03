/**
 * X1 contentTrim 도출(content-trim.ts) — 순수 함수 잠금.
 *
 *  - 계약 fixture(워커 spec 과 같은 리터럴)를 deep-equal 로 고정한다.
 *  - templateSet 출처: 재단 = width×height, 도련 = bleedMm, tolMm·작업사이즈 키 없음.
 *  - bookSpec 출처: tolMm = sizeToleranceMm.
 *  - 내지 펼침면 세트·무효 값·비정상 입력은 키 없음, 공통 래퍼는 예외를 던지지 않는다.
 */
import {
  buildContentTrimFromBookSpec,
  buildContentTrimFromTemplateSet,
  deriveContentTrimFailOpen,
  normalizeContentTrim,
} from './content-trim';

/** 계약 fixture — apps/worker spec 과 같은 리터럴 */
const FIXTURE_TEMPLATE_SET = JSON.parse(
  '{"trimWidthMm":210,"trimHeightMm":297,"bleedMm":3,"source":"templateSet"}',
) as unknown;
const FIXTURE_BOOK_SPEC = JSON.parse(
  '{"trimWidthMm":148,"trimHeightMm":210,"bleedMm":3,"tolMm":0.5,"source":"bookSpec"}',
) as unknown;

const makeLogger = () => ({ log: jest.fn(), warn: jest.fn() });

describe('content-trim — 계약 fixture', () => {
  it('templateSet 210×297·도련 3 → 계약 fixture 와 같은 객체', () => {
    expect(
      buildContentTrimFromTemplateSet({ width: 210, height: 297, bleedMm: 3 }, []),
    ).toEqual({ contentTrim: FIXTURE_TEMPLATE_SET });
  });

  it('bookSpec 148×210·도련 3·허용오차 0.5 → 계약 fixture 와 같은 객체', () => {
    expect(
      buildContentTrimFromBookSpec({
        innerTrimWidthMm: 148,
        innerTrimHeightMm: 210,
        bleedMm: 3,
        sizeToleranceMm: 0.5,
      }),
    ).toEqual({ contentTrim: FIXTURE_BOOK_SPEC });
  });

  it('계약 fixture 는 normalizeContentTrim 을 거쳐도 같다', () => {
    expect(normalizeContentTrim(FIXTURE_TEMPLATE_SET)).toEqual(FIXTURE_TEMPLATE_SET);
    expect(normalizeContentTrim(FIXTURE_BOOK_SPEC)).toEqual(FIXTURE_BOOK_SPEC);
  });
});

describe('buildContentTrimFromTemplateSet', () => {
  it('tolMm·workWidthMm·workHeightMm 키를 넣지 않는다', () => {
    const r = buildContentTrimFromTemplateSet({ width: 210, height: 297, bleedMm: 3 }, []);
    expect(Object.keys(r.contentTrim ?? {}).sort()).toEqual(
      ['bleedMm', 'source', 'trimHeightMm', 'trimWidthMm'],
    );
  });

  it('도련 0·5 는 유효하다', () => {
    expect(buildContentTrimFromTemplateSet({ width: 210, height: 297, bleedMm: 0 }, []).contentTrim?.bleedMm).toBe(0);
    expect(buildContentTrimFromTemplateSet({ width: 210, height: 297, bleedMm: 5 }, []).contentTrim?.bleedMm).toBe(5);
  });

  it.each([
    ['도련 5.01', { width: 210, height: 297, bleedMm: 5.01 }],
    ['도련 -0.1', { width: 210, height: 297, bleedMm: -0.1 }],
    ['도련 없음', { width: 210, height: 297 }],
    ['도련 NaN', { width: 210, height: 297, bleedMm: Number.NaN }],
    ['도련 문자열', { width: 210, height: 297, bleedMm: '3' }],
    ['폭 9.9', { width: 9.9, height: 297, bleedMm: 3 }],
    ['높이 Infinity', { width: 210, height: Number.POSITIVE_INFINITY, bleedMm: 3 }],
  ])('%s → skip invalid', (_label, ts) => {
    expect(buildContentTrimFromTemplateSet(ts, [])).toEqual({ skip: 'invalid' });
  });

  it('템플릿 중 하나라도 regionScope inner → skip inner-spread', () => {
    expect(
      buildContentTrimFromTemplateSet({ width: 210, height: 297, bleedMm: 3 }, [
        { spreadConfig: { regionScope: 'cover' } },
        { spreadConfig: { regionScope: 'inner', innerSpec: { pageWidthMm: 200, pageHeightMm: 200 } } },
      ]),
    ).toEqual({ skip: 'inner-spread' });
  });

  it('regionScope cover·spreadConfig 없음 템플릿은 도출 대상이다', () => {
    expect(
      buildContentTrimFromTemplateSet({ width: 210, height: 297, bleedMm: 3 }, [
        { spreadConfig: { regionScope: 'cover' } },
        { spreadConfig: null },
        {},
      ]).contentTrim,
    ).toEqual(FIXTURE_TEMPLATE_SET);
  });

  it("비정상 spreadConfig('x'·[]·null 원소)는 내지 펼침면 근거가 아니다", () => {
    expect(
      buildContentTrimFromTemplateSet({ width: 210, height: 297, bleedMm: 3 }, [
        { spreadConfig: 'x' },
        { spreadConfig: [] },
        null,
        undefined,
      ]).contentTrim,
    ).toEqual(FIXTURE_TEMPLATE_SET);
  });

  it('templateDetails 가 undefined·배열 아님 → skip invalid', () => {
    expect(buildContentTrimFromTemplateSet({ width: 210, height: 297, bleedMm: 3 }, undefined)).toEqual({
      skip: 'invalid',
    });
    expect(
      buildContentTrimFromTemplateSet(
        { width: 210, height: 297, bleedMm: 3 },
        'x' as unknown as ReadonlyArray<{ spreadConfig?: unknown }>,
      ),
    ).toEqual({ skip: 'invalid' });
  });
});

describe('buildContentTrimFromBookSpec', () => {
  it('허용오차 1 → tolMm 1, source bookSpec', () => {
    expect(
      buildContentTrimFromBookSpec({ innerTrimWidthMm: 148, innerTrimHeightMm: 210, bleedMm: 3, sizeToleranceMm: 1 }),
    ).toEqual({
      contentTrim: { trimWidthMm: 148, trimHeightMm: 210, bleedMm: 3, tolMm: 1, source: 'bookSpec' },
    });
  });

  it.each([Number.NaN, -1, 6, null, undefined])('허용오차 %p → tolMm 키만 빠진다', (tol) => {
    expect(
      buildContentTrimFromBookSpec({ innerTrimWidthMm: 148, innerTrimHeightMm: 210, bleedMm: 3, sizeToleranceMm: tol }),
    ).toEqual({ contentTrim: { trimWidthMm: 148, trimHeightMm: 210, bleedMm: 3, source: 'bookSpec' } });
  });

  it('도련 6 → skip invalid', () => {
    expect(
      buildContentTrimFromBookSpec({ innerTrimWidthMm: 148, innerTrimHeightMm: 210, bleedMm: 6, sizeToleranceMm: 1 }),
    ).toEqual({ skip: 'invalid' });
  });
});

describe('normalizeContentTrim', () => {
  it('계약 밖 키(work·임의 키)는 뺀다', () => {
    expect(
      normalizeContentTrim({
        trimWidthMm: 210,
        trimHeightMm: 297,
        bleedMm: 3,
        workWidthMm: 216,
        workHeightMm: 303,
        extra: 'x',
        source: 'templateSet',
      }),
    ).toEqual(FIXTURE_TEMPLATE_SET);
  });

  it.each([
    ['source 무효', { trimWidthMm: 210, trimHeightMm: 297, bleedMm: 3, source: 'session' }],
    ['source 없음', { trimWidthMm: 210, trimHeightMm: 297, bleedMm: 3 }],
    ['null', null],
    ['배열', []],
    ['문자열', 'x'],
  ])('%s → undefined', (_label, raw) => {
    expect(normalizeContentTrim(raw)).toBeUndefined();
  });
});

describe('deriveContentTrimFailOpen', () => {
  it('유효 값 → contentTrim 반환 + attach 로그 1줄', async () => {
    const logger = makeLogger();
    const out = await deriveContentTrimFailOpen('synthesize', logger, () => ({
      contentTrim: { trimWidthMm: 210, trimHeightMm: 297, bleedMm: 3, source: 'templateSet' },
    }));
    expect(out).toEqual(FIXTURE_TEMPLATE_SET);
    expect(logger.log).toHaveBeenCalledWith(
      '[content-trim] attach route=synthesize source=templateSet trim=210x297 bleed=3',
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('skip 결과 → undefined + skip 경고(reason)', async () => {
    const logger = makeLogger();
    const out = await deriveContentTrimFailOpen('compose-mixed', logger, () => ({ skip: 'inner-spread' }));
    expect(out).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('[content-trim] skip route=compose-mixed reason=inner-spread');
  });

  it('동기 예외(TypeError)·비동기 reject 도 undefined + lookup-error 경고, 예외를 던지지 않는다', async () => {
    const logger = makeLogger();
    await expect(
      deriveContentTrimFailOpen('attach-page-pad', logger, () => {
        throw new TypeError('x');
      }),
    ).resolves.toBeUndefined();
    await expect(
      deriveContentTrimFailOpen('finalization', logger, async () => {
        throw new Error('db down');
      }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenNthCalledWith(
      1,
      '[content-trim] skip route=attach-page-pad reason=lookup-error err=TypeError',
    );
    expect(logger.warn).toHaveBeenNthCalledWith(
      2,
      '[content-trim] skip route=finalization reason=lookup-error err=Error',
    );
  });

  it('getter 가 예외를 던지는 비정상 spreadConfig 도 키 없음으로 끝난다', async () => {
    const logger = makeLogger();
    const hostile = {
      get spreadConfig(): unknown {
        throw new RangeError('bad');
      },
    };
    const out = await deriveContentTrimFailOpen('compose-mixed', logger, () =>
      buildContentTrimFromTemplateSet({ width: 210, height: 297, bleedMm: 3 }, [hostile]),
    );
    expect(out).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      '[content-trim] skip route=compose-mixed reason=lookup-error err=RangeError',
    );
  });

  it('로그에 오류 메시지 원문을 남기지 않는다', async () => {
    const logger = makeLogger();
    await deriveContentTrimFailOpen('synthesize', logger, () => {
      throw new Error('ts-secret-id-123');
    });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('ts-secret-id-123');
  });
});
