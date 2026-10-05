import { describe, it, expect, vi, afterEach } from 'vitest'
import { BindingType } from '@storige/types'
import { getParamCompat } from './searchParams'
import { normalizePageStep } from './pageStep'
import {
  HOST_PAGE_LIMIT_MAX,
  SPREAD_INNER_HOST_MAX,
  bindingPageBounds,
  comparePageStep,
  hasHostPageCountLimit,
  hostPageLimitSides,
  mergePageCountRange,
  parsePageCountLimitParam,
  parsePageStepParam,
  resolveHostPageLimits,
  resolveSeedPageCount,
  resolveStorePageLimits,
  settingsPageBounds,
  warnPageStepMismatch,
} from './hostPageLimits'

/**
 * R-196 host page limits (2026-09-29): 호스트 상품별 쪽수 범위·배수 순수 헬퍼.
 * identity 케이스는 "호스트 값 미전달 = 종전과 byte-identical" 보장을 고정한다.
 */

/** EmbedView 와 동일한 파싱 경로(getParamCompat → parse*) */
const parseMin = (query: string): number | undefined =>
  parsePageCountLimitParam(getParamCompat(new URLSearchParams(query), 'pageCountMin'), 'pageCountMin')
const parseStep = (query: string): number | undefined =>
  parsePageStepParam(getParamCompat(new URLSearchParams(query), 'pageStep'))

/** 종전 로더 인라인 클램프(useEditorContents 단일/스프레드 경로) 복제 — identity 비교 기준 */
function legacyClamp(requested: number, rangeInput: number[] | undefined): number {
  let effective = requested
  const range = rangeInput || []
  if (range.length > 0) {
    const minPages = Math.min(...range)
    const maxPages = Math.max(...range)
    if (effective < minPages) effective = minPages
    if (effective > maxPages) effective = maxPages
  }
  return effective
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('파라미터 파싱', () => {
  it("유효값 '16'·'300'·'500' 수용, snake_case 도 수용", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseMin('pageCountMin=16')).toBe(16)
    expect(parseMin('pageCountMin=300')).toBe(300)
    expect(parseMin('pageCountMin=500')).toBe(500)
    expect(parseMin('page_count_min=%2016%20')).toBe(16)
    expect(parsePageCountLimitParam('300', 'pageCountMax')).toBe(300)
    expect(warn).not.toHaveBeenCalled()
  })

  it("미전달·''·공백은 경고 없이 undefined, pageStep '1' 은 1(배수 제약 없음)", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseMin('')).toBeUndefined()
    expect(parseMin('pageCountMin=')).toBeUndefined()
    expect(parseMin('pageCountMin=%20%20')).toBeUndefined()
    expect(parsePageCountLimitParam(null, 'pageCountMax')).toBeUndefined()
    expect(parsePageCountLimitParam(undefined, 'pageCountMax')).toBeUndefined()
    expect(parseStep('')).toBeUndefined()
    expect(parseStep('pageStep=')).toBeUndefined()
    expect(parseStep('pageStep=%20')).toBeUndefined()
    expect(parseStep('pageStep=1')).toBe(1)
    expect(warn).not.toHaveBeenCalled()
  })

  it("min/max 무효값 '0'·'-1'·'16.5'·'1e2'·'0x10'·'abc'·'501' 은 경고 후 undefined", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bad = ['0', '-1', '16.5', '1e2', '0x10', 'abc', '501']
    for (const v of bad) {
      expect(parsePageCountLimitParam(v, 'pageCountMin')).toBeUndefined()
      expect(parsePageCountLimitParam(v, 'pageCountMax')).toBeUndefined()
    }
    expect(warn).toHaveBeenCalledTimes(bad.length * 2)
    expect(String(warn.mock.calls[0][0])).toMatch(/^\[hostPageLimits\]/)
  })

  it("pageStep 무효값 '0'·'2.5'·'1e1'·'0x4'·'x'·'501' 은 경고 후 undefined", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bad = ['0', '2.5', '1e1', '0x4', 'x', '501']
    for (const v of bad) expect(parsePageStepParam(v)).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(bad.length)
  })

  it("pageStep '2'·'4' 수용 (snake page_step 포함)", () => {
    expect(parseStep('pageStep=2')).toBe(2)
    expect(parseStep('page_step=4')).toBe(4)
  })
})

describe('resolveHostPageLimits', () => {
  it('키별 계층: options max + orderOptions min 결합', () => {
    expect(
      resolveHostPageLimits({ pageCountMax: 300 }, { orderOptions: { pageCountMin: 16, pageCountMax: 200 } }),
    ).toEqual({ pageCountMin: 16, pageCountMax: 300 })
  })

  it('같은 계층 min > max 는 둘 다 폐기(경고)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveHostPageLimits({ pageCountMin: 300, pageCountMax: 16 }, undefined)).toEqual({})
    expect(
      resolveHostPageLimits(undefined, { orderOptions: { pageCountMin: 300, pageCountMax: 16 } }),
    ).toEqual({})
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('계층 충돌(URL max 50, orderOptions min 120)은 max 50 유지·min 폐기', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveHostPageLimits({ pageCountMax: 50 }, { orderOptions: { pageCountMin: 120 } })).toEqual({
      pageCountMax: 50,
    })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('기준 정렬: min 10 + step 4 는 step 폐기, min 16 + step 4 는 유지', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveHostPageLimits({ pageCountMin: 10, pageCountMax: 300, pageStep: 4 }, undefined)).toEqual({
      pageCountMin: 10,
      pageCountMax: 300,
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(resolveHostPageLimits({ pageCountMin: 16, pageCountMax: 300, pageStep: 4 }, undefined)).toEqual({
      pageCountMin: 16,
      pageCountMax: 300,
      pageStep: 4,
    })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('실현 불가(min 17, max 19, step 4)는 step 폐기', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // min 17 은 4의 배수가 아니라 정렬 규칙(6)이 먼저 step 을 폐기한다. min 이 정렬돼 있으면 max ≥ min 이라
    // 항상 배수가 존재하므로, 실현 불가 규칙(7) 단독 경로는 min 없이 max 만 있는 경우로 확인한다.
    expect(resolveHostPageLimits({ pageCountMin: 17, pageCountMax: 19, pageStep: 4 }, undefined)).toEqual({
      pageCountMin: 17,
      pageCountMax: 19,
    })
    expect(resolveHostPageLimits({ pageCountMax: 3, pageStep: 4 }, undefined)).toEqual({ pageCountMax: 3 })
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('orderOptions 무효값은 경고 없이 건너뛴다, options 무효값은 경고 후 orderOptions 로 폴백', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      resolveHostPageLimits(undefined, {
        orderOptions: { pageCountMin: 0, pageCountMax: '16.5', pageStep: 'x' },
      }),
    ).toEqual({})
    expect(warn).not.toHaveBeenCalled()
    expect(
      resolveHostPageLimits({ pageCountMax: 999 }, { orderOptions: { pageCountMax: 300 } }),
    ).toEqual({ pageCountMax: 300 })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('(undefined, undefined) 와 ({}, undefined) 는 {} — 세션 기록 불변식', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveHostPageLimits(undefined, undefined)).toEqual({})
    expect(resolveHostPageLimits({}, undefined)).toEqual({})
    expect(resolveHostPageLimits({}, { orderOptions: { pageCount: 24 } })).toEqual({})
    expect(warn).not.toHaveBeenCalled()
  })

  it('hasHostPageCountLimit: min/max 중 하나라도 있으면 true, pageStep 단독은 false', () => {
    expect(hasHostPageCountLimit(undefined)).toBe(false)
    expect(hasHostPageCountLimit({})).toBe(false)
    expect(hasHostPageCountLimit({ pageStep: 2 })).toBe(false)
    expect(hasHostPageCountLimit({ pageCountMin: 16 })).toBe(true)
    expect(hasHostPageCountLimit({ pageCountMax: 300 })).toBe(true)
  })
})

describe('mergePageCountRange', () => {
  it('IDENTITY: 호스트 min/max 없으면 입력 참조 그대로', () => {
    const r = [10, 100]
    const empty: number[] = []
    expect(mergePageCountRange(r, undefined)).toBe(r)
    expect(mergePageCountRange(r, {})).toBe(r)
    expect(mergePageCountRange(r, { pageStep: 4 }, SPREAD_INNER_HOST_MAX)).toBe(r)
    expect(mergePageCountRange(empty, {})).toBe(empty)
    expect(mergePageCountRange(undefined, {})).toBeUndefined()
    expect(mergePageCountRange(null, {})).toBeNull()
  })

  it('호스트 [16,300] → [16,300]', () => {
    expect(mergePageCountRange([10, 100], { pageCountMin: 16, pageCountMax: 300 })).toEqual([16, 300])
  })

  it('max 만 300 → [10,300]', () => {
    expect(mergePageCountRange([10, 100], { pageCountMax: 300 })).toEqual([10, 300])
  })

  it('min 만 120 (템플릿 max 100 과 모순) → [120,500] 로 넓힘', () => {
    expect(mergePageCountRange([10, 100], { pageCountMin: 120 })).toEqual([120, HOST_PAGE_LIMIT_MAX])
  })

  it('max 만 5 (템플릿 min 10 과 모순) → [1,5]', () => {
    expect(mergePageCountRange([10, 100], { pageCountMax: 5 })).toEqual([1, 5])
  })

  it('빈 템플릿 + min 만 16 → [16,100]', () => {
    expect(mergePageCountRange([], { pageCountMin: 16 })).toEqual([16, 100])
  })

  it('용량 상한 400: [16,500] → [16,400] (경고)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      mergePageCountRange([10, 100], { pageCountMin: 16, pageCountMax: 500 }, SPREAD_INNER_HOST_MAX),
    ).toEqual([16, 400])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(
      mergePageCountRange([10, 100], { pageCountMin: 450, pageCountMax: 500 }, SPREAD_INNER_HOST_MAX),
    ).toEqual([400, 400])
  })

  it('정렬 안 된 템플릿 [100,10] 도 처리', () => {
    expect(mergePageCountRange([100, 10], { pageCountMax: 300 })).toEqual([10, 300])
    expect(mergePageCountRange([100, 10], { pageCountMin: 16 })).toEqual([16, 100])
  })
})

describe('resolveSeedPageCount', () => {
  it('호스트 없음: 종전 인라인 클램프와 동일 (5/50/150 on [10,100] 및 [])', () => {
    for (const range of [[10, 100], [], undefined] as Array<number[] | undefined>) {
      for (const requested of [5, 50, 150]) {
        expect(resolveSeedPageCount({ requested, templateRange: range }).count).toBe(
          legacyClamp(requested, range),
        )
        expect(resolveSeedPageCount({ requested, templateRange: range, limits: {} }).count).toBe(
          legacyClamp(requested, range),
        )
      }
    }
    expect(resolveSeedPageCount({ requested: 5, templateRange: [10, 100] })).toEqual({
      count: 10,
      adjusted: 'min',
      bound: 10,
    })
    expect(resolveSeedPageCount({ requested: 150, templateRange: [10, 100] })).toEqual({
      count: 100,
      adjusted: 'max',
      bound: 100,
    })
    expect(resolveSeedPageCount({ requested: 50, templateRange: [10, 100] })).toEqual({
      count: 50,
      adjusted: null,
    })
  })

  it('호스트 없음: 재진입 값이 있어도 무시(종전 클램프 그대로)', () => {
    expect(
      resolveSeedPageCount({ requested: 150, templateRange: [10, 100], restoredInnerCount: 260 }).count,
    ).toBe(100)
  })

  it('FEATURE: 250 on [10,100] + 호스트 [16,300] → 250 (호스트 없으면 100)', () => {
    expect(resolveSeedPageCount({ requested: 250, templateRange: [10, 100] }).count).toBe(100)
    expect(
      resolveSeedPageCount({
        requested: 250,
        templateRange: [10, 100],
        limits: { pageCountMin: 16, pageCountMax: 300 },
      }),
    ).toEqual({ count: 250, adjusted: null })
    expect(
      resolveSeedPageCount({
        requested: 400,
        templateRange: [10, 100],
        limits: { pageCountMin: 16, pageCountMax: 300 },
      }),
    ).toEqual({ count: 300, adjusted: 'max', bound: 300 })
  })

  it('재진입: requested 200, 복원 260, 호스트 [16,300] → 260 (restore)', () => {
    expect(
      resolveSeedPageCount({
        requested: 200,
        templateRange: [10, 100],
        limits: { pageCountMin: 16, pageCountMax: 300 },
        restoredInnerCount: 260,
      }),
    ).toEqual({ count: 260, adjusted: 'restore', bound: 260 })
  })

  it('재진입: 잘못된 큰 requested 999 는 호스트 max 300 으로 상한 클램프(복원 120 은 보존)', () => {
    expect(
      resolveSeedPageCount({
        requested: 999,
        templateRange: [10, 100],
        limits: { pageCountMin: 16, pageCountMax: 300 },
        restoredInnerCount: 120,
      }),
    ).toEqual({ count: 300, adjusted: 'max', bound: 300 })
  })

  it('재진입: 복원 320 이 호스트 max 300 초과여도 클램프 없음', () => {
    expect(
      resolveSeedPageCount({
        requested: 100,
        templateRange: [10, 100],
        limits: { pageCountMax: 300 },
        restoredInnerCount: 320,
      }).count,
    ).toBe(320)
  })

  it('재진입: 복원 20 이 올린 min 32 미만이어도 20 그대로', () => {
    expect(
      resolveSeedPageCount({
        requested: 20,
        templateRange: [10, 100],
        limits: { pageCountMin: 32 },
        restoredInnerCount: 20,
      }),
    ).toEqual({ count: 20, adjusted: null })
  })
})

describe('pageStep=1 — 배수 제약 없음(2026-09-29 오너 채택)', () => {
  it('resolveHostPageLimits: 1 을 그대로 전달하고 정렬·실현가능성 규칙에 걸리지 않음, 세션 기록에서도 복원', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveHostPageLimits({ pageCountMin: 15, pageCountMax: 301, pageStep: 1 }, undefined)).toEqual({
      pageCountMin: 15,
      pageCountMax: 301,
      pageStep: 1,
    })
    expect(resolveHostPageLimits({}, { orderOptions: { pageStep: 1 } })).toEqual({ pageStep: 1 })
    expect(resolveHostPageLimits({ pageStep: '1' }, undefined)).toEqual({ pageStep: 1 })
    expect(warn).not.toHaveBeenCalled()
  })

  it('resolveStorePageLimits: 템플릿 단위 2 를 무시하고 제약 없음, 자동 채움은 끔', () => {
    expect(
      resolveStorePageLimits({ templateRange: [16, 500], templatePageStep: 2, templatePadToPageStep: true, limits: { pageStep: 1 } }),
    ).toMatchObject({ pageStep: null, padToPageStep: false })
  })

  it('resolveStorePageLimits: 템플릿 단위가 없으면 자동 채움 설정은 종전대로 유지', () => {
    expect(
      resolveStorePageLimits({ templateRange: [16, 500], templatePageStep: null, templatePadToPageStep: true, limits: { pageStep: 1 } }),
    ).toMatchObject({ pageStep: null, padToPageStep: true })
  })

  it('resolveStorePageLimits: ignoreHostStep(비내지 캔버스 단일 모드)이어도 1 은 제약 없음으로 적용', () => {
    expect(
      resolveStorePageLimits({ templateRange: [1, 99], templatePageStep: 2, templatePadToPageStep: false, limits: { pageStep: 1 }, ignoreHostStep: true }),
    ).toMatchObject({ pageStep: null })
  })
})

describe('resolveStorePageLimits', () => {
  it('호스트 없음: 종전 식과 동일 (padToPageStep true/false/undefined, 범위 참조 유지)', () => {
    const range = [10, 100]
    for (const pad of [true, false, undefined]) {
      for (const step of [2, null, undefined, '4', 1]) {
        const expected = {
          pageCountRange: range ?? [],
          pageStep: normalizePageStep(step),
          padToPageStep: pad === true,
        }
        const noLimits = resolveStorePageLimits({
          templateRange: range,
          templatePageStep: step,
          templatePadToPageStep: pad,
        })
        expect(noLimits).toEqual(expected)
        expect(noLimits.pageCountRange).toBe(range)
        // 로더는 config 전체를 limits 로 넘긴다 — 호스트 키가 없으면 동일해야 한다.
        const emptyLimits = resolveStorePageLimits({
          templateRange: range,
          templatePageStep: step,
          templatePadToPageStep: pad,
          limits: {},
          capacityMax: SPREAD_INNER_HOST_MAX,
        })
        expect(emptyLimits).toEqual(expected)
        expect(emptyLimits.pageCountRange).toBe(range)
      }
    }
    expect(
      resolveStorePageLimits({ templateRange: undefined, templatePageStep: null, templatePadToPageStep: true }),
    ).toEqual({ pageCountRange: [], pageStep: null, padToPageStep: true })
  })

  it('호스트 step 4 vs 템플릿 2 → pageStep 4, padToPageStep false', () => {
    expect(
      resolveStorePageLimits({
        templateRange: [10, 100],
        templatePageStep: 2,
        templatePadToPageStep: true,
        limits: { pageCountMin: 16, pageCountMax: 300, pageStep: 4 },
      }),
    ).toEqual({ pageCountRange: [16, 300], pageStep: 4, padToPageStep: false })
  })

  it('호스트 step 이 템플릿과 같으면 padToPageStep 은 템플릿 값 유지', () => {
    expect(
      resolveStorePageLimits({
        templateRange: [10, 100],
        templatePageStep: 2,
        templatePadToPageStep: true,
        limits: { pageStep: 2 },
      }),
    ).toEqual({ pageCountRange: [10, 100], pageStep: 2, padToPageStep: true })
  })

  it('ignoreHostStep: 템플릿 단위 사용', () => {
    expect(
      resolveStorePageLimits({
        templateRange: [10, 100],
        templatePageStep: 2,
        templatePadToPageStep: true,
        limits: { pageStep: 4 },
        ignoreHostStep: true,
      }),
    ).toEqual({ pageCountRange: [10, 100], pageStep: 2, padToPageStep: true })
  })

  it('capacityMax 400 적용', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      resolveStorePageLimits({
        templateRange: [10, 100],
        templatePageStep: null,
        templatePadToPageStep: false,
        limits: { pageCountMin: 16, pageCountMax: 500 },
        capacityMax: SPREAD_INNER_HOST_MAX,
      }).pageCountRange,
    ).toEqual([16, 400])
  })
})

describe('settingsPageBounds', () => {
  it('단일 [16,300], anchor 1 → {17,301}', () => {
    expect(settingsPageBounds({ range: [16, 300], per: 1, anchorCanvases: 1 })).toEqual({ min: 17, max: 301 })
  })

  it('스프레드 per=2, anchor 1, [16,300] → {9,151}', () => {
    expect(settingsPageBounds({ range: [16, 300], per: 2, anchorCanvases: 1 })).toEqual({ min: 9, max: 151 })
  })

  it('SADDLE bindMax 64 → max = anchor + 64/per', () => {
    expect(settingsPageBounds({ range: [16, 300], per: 2, anchorCanvases: 1, bindMax: 64 }).max).toBe(1 + 64 / 2)
    expect(settingsPageBounds({ range: [16, 300], per: 1, anchorCanvases: 0, bindMax: 64 }).max).toBe(64)
  })

  it('PERFECT bindMin 32 → min = anchor + 32/per', () => {
    expect(settingsPageBounds({ range: [16, 300], per: 2, anchorCanvases: 1, bindMin: 32 }).min).toBe(1 + 32 / 2)
    expect(settingsPageBounds({ range: [16, 300], per: 2, anchorCanvases: 0, bindMin: 32 }).min).toBe(16)
  })

  it('충돌(bindMax < range min) → max === min', () => {
    const b = settingsPageBounds({ range: [100, 300], per: 1, anchorCanvases: 1, bindMax: 64 })
    expect(b.max).toBe(b.min)
    expect(b.min).toBe(101)
  })
})

describe('hostPageLimitSides — 호스트가 보낸 쪽(키별)', () => {
  it('min·max 모두 있음 → 둘 다 true', () => {
    expect(hostPageLimitSides({ pageCountMin: 16, pageCountMax: 48 })).toEqual({ min: true, max: true })
  })
  it('min 만 있음 → min 만 true', () => {
    expect(hostPageLimitSides({ pageCountMin: 16 })).toEqual({ min: true, max: false })
  })
  it('max 만 있음 → max 만 true', () => {
    expect(hostPageLimitSides({ pageCountMax: 48 })).toEqual({ min: false, max: true })
  })
  it('{} (pageStep 단독 포함) → 둘 다 false', () => {
    expect(hostPageLimitSides({})).toEqual({ min: false, max: false })
    expect(hostPageLimitSides({ pageStep: 4 })).toEqual({ min: false, max: false })
  })
  it('undefined → 둘 다 false', () => {
    expect(hostPageLimitSides(undefined)).toEqual({ min: false, max: false })
  })
})

describe('bindingPageBounds — 제본 최소/최대 키별 대체', () => {
  const none = { min: false, max: false }
  const minOnly = { min: true, max: false }
  const maxOnly = { min: false, max: true }
  const both = { min: true, max: true }

  it('PERFECT, 범위 없음 → 무선 최소 32', () => {
    expect(bindingPageBounds(BindingType.PERFECT, none)).toEqual({ minPages: 32 })
  })
  it('PERFECT, min 보냄 → 제본 최소 미적용', () => {
    expect(bindingPageBounds(BindingType.PERFECT, minOnly)).toEqual({})
  })
  it('PERFECT, max 만 보냄 → 무선 최소 32 유지', () => {
    expect(bindingPageBounds(BindingType.PERFECT, maxOnly)).toEqual({ minPages: 32 })
  })
  it('PERFECT, 둘 다 보냄 → {}', () => {
    expect(bindingPageBounds(BindingType.PERFECT, both)).toEqual({})
  })
  it('SADDLE, 범위 없음 → 중철 최대 64', () => {
    expect(bindingPageBounds(BindingType.SADDLE, none)).toEqual({ maxPages: 64 })
  })
  it('SADDLE, max 보냄 → 제본 최대 미적용', () => {
    expect(bindingPageBounds(BindingType.SADDLE, maxOnly)).toEqual({})
  })
  it('SADDLE, min 만 보냄 → 중철 최대 64 유지', () => {
    expect(bindingPageBounds(BindingType.SADDLE, minOnly)).toEqual({ maxPages: 64 })
  })
  it('bindingType null → {}', () => {
    expect(bindingPageBounds(null, none)).toEqual({})
  })
  it('SPIRAL·HARDCOVER, 범위 없음 → {}', () => {
    expect(bindingPageBounds(BindingType.SPIRAL, none)).toEqual({})
    expect(bindingPageBounds(BindingType.HARDCOVER, none)).toEqual({})
  })
  it('PERFECT, sides 미전달 → 무선 최소 32', () => {
    expect(bindingPageBounds(BindingType.PERFECT, undefined)).toEqual({ minPages: 32 })
  })
})

describe('settingsPageBounds × bindingPageBounds 조합', () => {
  it('[16,48] 스프레드 per=2 anchor 1, 둘 다 보냄 → {9,25}', () => {
    const bb = bindingPageBounds(BindingType.PERFECT, hostPageLimitSides({ pageCountMin: 16, pageCountMax: 48 }))
    expect(
      settingsPageBounds({ range: [16, 48], per: 2, anchorCanvases: 1, bindMin: bb.minPages, bindMax: bb.maxPages }),
    ).toEqual({ min: 9, max: 25 })
  })
  it('[4,48] + max 만 + PERFECT → 무선 최소 32 유지, min = 1 + 16 = 17', () => {
    const bb = bindingPageBounds(BindingType.PERFECT, hostPageLimitSides({ pageCountMax: 48 }))
    expect(
      settingsPageBounds({ range: [4, 48], per: 2, anchorCanvases: 1, bindMin: bb.minPages, bindMax: bb.maxPages }).min,
    ).toBe(17)
  })
})

describe('comparePageStep — 호스트·템플릿셋 쪽 추가 단위 비교', () => {
  // [호스트 limits.pageStep(undefined = 미전달), 템플릿셋 pageStep, 기대 status, 기대 host, 기대 template]
  const table: Array<[number | undefined, unknown, string, number | null, number | null]> = [
    [4, null, 'host-only', 4, null],
    [4, 4, 'match', 4, 4],
    [1, null, 'none', 1, null],
    [1, 4, 'mismatch', 1, 4],
    [undefined, 4, 'template-only', null, 4],
    [2, 4, 'mismatch', 2, 4],
    [undefined, null, 'none', null, null],
    [undefined, 1, 'none', null, null],
    [1, 1, 'none', 1, null],
    [4, '4', 'match', 4, 4],
    [4, 1, 'host-only', 4, null],
  ]
  it.each(table)('host %s / template %s → %s', (hostStep, templateStep, status, host, template) => {
    const limits = hostStep === undefined ? {} : { pageStep: hostStep }
    expect(comparePageStep(templateStep, limits)).toEqual({ status, host, template })
  })

  it('limits 미전달 → 호스트 미전달과 같음', () => {
    expect(comparePageStep(4, undefined)).toEqual({ status: 'template-only', host: null, template: 4 })
    expect(comparePageStep(null)).toEqual({ status: 'none', host: null, template: null })
  })

  it('판정은 실효 단위와 일치: none·match·template-only 는 호스트가 템플릿 단위를 바꾸지 않음', () => {
    for (const [hostStep, templateStep, status] of table) {
      const limits = hostStep === undefined ? {} : { pageStep: hostStep }
      const effective = resolveStorePageLimits({
        templateRange: [16, 48],
        templatePageStep: templateStep,
        templatePadToPageStep: false,
        limits,
      }).pageStep
      const differs = effective !== normalizePageStep(templateStep)
      expect(differs).toBe(status === 'host-only' || status === 'mismatch')
    }
  })

  it('콘솔 출력 없음', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const [hostStep, templateStep] of table) {
      comparePageStep(templateStep, hostStep === undefined ? {} : { pageStep: hostStep })
    }
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('warnPageStepMismatch — 호스트 단위 적용 시 불일치 경고', () => {
  it('host-only: 경고 1줄', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(warnPageStepMismatch(null, { pageStep: 4 }).status).toBe('host-only')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      '[hostPageLimits] 호스트 pageStep 4 ≠ 템플릿셋 pageStep 미설정 — 호스트 값 적용(상품 관리자와 템플릿셋 단위를 같게 설정하세요)',
    )
  })

  it('mismatch 2/4: 경고 1줄', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnPageStepMismatch(4, { pageStep: 2 })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('[hostPageLimits] 호스트 pageStep 2 ≠ 템플릿셋 pageStep 4')
  })

  it('mismatch 1/4: 배수 제약 없음 표기로 경고 1줄', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnPageStepMismatch(4, { pageStep: 1 })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('[hostPageLimits] 호스트 pageStep 1(배수 제약 없음) ≠ 템플릿셋 pageStep 4')
  })

  it('match·none·template-only: 경고 없음', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnPageStepMismatch(4, { pageStep: 4 })
    warnPageStepMismatch(null, { pageStep: 1 })
    warnPageStepMismatch(null, {})
    warnPageStepMismatch(4, {})
    warnPageStepMismatch(4, undefined)
    expect(warn).not.toHaveBeenCalled()
  })

  it('ignoreHostStep: 호스트 ≥ 2 는 적용되지 않으므로 경고 없음', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(warnPageStepMismatch(2, { pageStep: 4 }, { ignoreHostStep: true }).status).toBe('mismatch')
    warnPageStepMismatch(null, { pageStep: 4 }, { ignoreHostStep: true })
    expect(warn).not.toHaveBeenCalled()
  })

  it('ignoreHostStep: 호스트 1 은 적용되므로 템플릿 단위가 있으면 경고', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnPageStepMismatch(4, { pageStep: 1 }, { ignoreHostStep: true })
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('상수', () => {
  it('SPREAD_INNER_HOST_MAX === UNDERLAY_MAX_PAGES * 2', async () => {
    const { UNDERLAY_MAX_PAGES } = await import('./contentPdfGuide')
    expect(SPREAD_INNER_HOST_MAX).toBe(UNDERLAY_MAX_PAGES * 2)
    expect(HOST_PAGE_LIMIT_MAX).toBe(500)
  })
})
