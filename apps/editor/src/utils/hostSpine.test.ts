import { describe, it, expect, vi, afterEach } from 'vitest'
import { getParamCompat } from './searchParams'
import {
  asNonNegativeNumber,
  buildAppliedSpineSnapshot,
  decideHostSpineAction,
  getAppliedSpineWidthMm,
  hasSpineRegionObjects,
  isHostSpineFixed,
  normalizeSpineCode,
  parseSpineWidthMmParam,
  resolveAppliedSpineSource,
  resolveEffectiveSpineOptions,
} from './hostSpine'

/** EmbedView 와 동일한 파싱 경로(getParamCompat → parseSpineWidthMmParam) */
const parseFromQuery = (query: string): number | undefined =>
  parseSpineWidthMmParam(getParamCompat(new URLSearchParams(query), 'spineWidthMm'))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('spineWidthMm 파라미터 파싱 (R-195 계약 1)', () => {
  it('유한수 ≥ 0 수용 — 문자열 "0" 은 0', () => {
    expect(parseFromQuery('spineWidthMm=0')).toBe(0)
    expect(parseFromQuery('spineWidthMm=12.5')).toBe(12.5)
    expect(parseFromQuery('spineWidthMm=%2012.5%20')).toBe(12.5)
  })

  it('snake_case spine_width_mm 도 수용, 둘 다 있으면 camel 우선', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseFromQuery('spine_width_mm=0')).toBe(0)
    expect(parseFromQuery('spine_width_mm=8.2')).toBe(8.2)
    expect(parseFromQuery('spineWidthMm=5&spine_width_mm=9')).toBe(5)
  })

  it("미전달·빈 문자열은 경고 없이 undefined", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseFromQuery('')).toBeUndefined()
    expect(parseFromQuery('spineWidthMm=')).toBeUndefined()
    expect(parseFromQuery('spineWidthMm=%20%20')).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })

  it("'-'·음수·NaN·Infinity 는 경고 후 undefined", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseFromQuery('spineWidthMm=-')).toBeUndefined()
    expect(parseFromQuery('spineWidthMm=-1')).toBeUndefined()
    expect(parseFromQuery('spineWidthMm=abc')).toBeUndefined()
    expect(parseFromQuery('spineWidthMm=Infinity')).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(4)
  })

  it('asNonNegativeNumber: 숫자/숫자문자열 ≥ 0 만, 그 외 타입 거부', () => {
    expect(asNonNegativeNumber(0)).toBe(0)
    expect(asNonNegativeNumber('0')).toBe(0)
    expect(asNonNegativeNumber(3.3)).toBe(3.3)
    expect(asNonNegativeNumber(-0.1)).toBeUndefined()
    expect(asNonNegativeNumber(NaN)).toBeUndefined()
    expect(asNonNegativeNumber('')).toBeUndefined()
    expect(asNonNegativeNumber(null)).toBeUndefined()
    expect(asNonNegativeNumber(true)).toBeUndefined()
  })
})

describe("S5: paperType/bindingType '-' 정규화 (R-195 계약 2)", () => {
  it("trim 후 '' 또는 '-' → undefined, 그 외는 trim 값", () => {
    expect(normalizeSpineCode('-')).toBeUndefined()
    expect(normalizeSpineCode(' - ')).toBeUndefined()
    expect(normalizeSpineCode('')).toBeUndefined()
    expect(normalizeSpineCode('   ')).toBeUndefined()
    expect(normalizeSpineCode(' mojo_80g ')).toBe('mojo_80g')
    expect(normalizeSpineCode('perfect')).toBe('perfect')
    expect(normalizeSpineCode(undefined)).toBeUndefined()
    expect(normalizeSpineCode(null)).toBeUndefined()
    expect(normalizeSpineCode(80)).toBeUndefined()
  })
})

describe('재편집 사다리 resolveEffectiveSpineOptions (R-195 계약 2·3)', () => {
  it('options(URL/props) 가 최우선', () => {
    expect(
      resolveEffectiveSpineOptions(
        { paperType: 'a', bindingType: 'b', spineWidthMm: 4 },
        { orderOptions: { paperType: 'x', bindingType: 'y', spineWidthMm: 9 } },
      ),
    ).toEqual({ paperType: 'a', bindingType: 'b', spineWidthMm: 4 })
  })

  it("options 의 '-' 는 미지정 취급 → orderOptions → metadata.spine 순 폴백", () => {
    expect(
      resolveEffectiveSpineOptions(
        { paperType: '-', bindingType: ' - ' },
        { orderOptions: { paperType: '-' }, spine: { paperType: 'snap_p', bindingType: 'snap_b' } },
      ),
    ).toEqual({ paperType: 'snap_p', bindingType: 'snap_b' })
  })

  it('spineWidthMm 0 은 유효값 — options 0 이 orderOptions 값을 이긴다', () => {
    expect(
      resolveEffectiveSpineOptions({ spineWidthMm: 0 }, { orderOptions: { spineWidthMm: 7 } }).spineWidthMm,
    ).toBe(0)
  })

  it('options 미전달 → orderOptions.spineWidthMm(≥0, 0 포함)', () => {
    expect(resolveEffectiveSpineOptions({}, { orderOptions: { spineWidthMm: 0 } }).spineWidthMm).toBe(0)
    expect(resolveEffectiveSpineOptions(undefined, { orderOptions: { spineWidthMm: '6.5' } }).spineWidthMm).toBe(6.5)
  })

  it('orderOptions 무효(음수) → appliedSpine(source=host) 폴백', () => {
    expect(
      resolveEffectiveSpineOptions(
        {},
        { orderOptions: { spineWidthMm: -1 }, appliedSpine: { spineWidthMm: 3.2, source: 'host' } },
      ).spineWidthMm,
    ).toBe(3.2)
  })

  it("appliedSpine 은 source==='host' 일 때만 사다리에 오른다", () => {
    expect(
      resolveEffectiveSpineOptions({}, { appliedSpine: { spineWidthMm: 3.2, source: 'formula' } }).spineWidthMm,
    ).toBeUndefined()
    expect(
      resolveEffectiveSpineOptions({}, { appliedSpine: { spineWidthMm: 3.2, source: 'template' } }).spineWidthMm,
    ).toBeUndefined()
    expect(
      resolveEffectiveSpineOptions({}, { appliedSpine: { spineWidthMm: 0, source: 'host' } }).spineWidthMm,
    ).toBe(0)
  })

  it('metadata 없음/비정상 → 빈 결과(키 자체 생략)', () => {
    expect(resolveEffectiveSpineOptions(undefined, undefined)).toEqual({})
    expect(resolveEffectiveSpineOptions({}, null)).toEqual({})
    expect(resolveEffectiveSpineOptions({}, { orderOptions: 'bad', spine: [] })).toEqual({})
  })
})

describe('hostFixed 판정 (R-195 계약 4)', () => {
  it('용지·제본 모두 있고 host > 0 → 비고정(수식 재계산 허용)', () => {
    expect(isHostSpineFixed({ paperType: 'mojo_80g', bindingType: 'perfect', hostSpineWidthMm: 5 })).toBe(false)
  })
  it('host 0 → 고정', () => {
    expect(isHostSpineFixed({ paperType: 'mojo_80g', bindingType: 'perfect', hostSpineWidthMm: 0 })).toBe(true)
  })
  it("용지 또는 제본 누락('-' 포함) → 고정", () => {
    expect(isHostSpineFixed({ paperType: null, bindingType: 'perfect', hostSpineWidthMm: 5 })).toBe(true)
    expect(isHostSpineFixed({ paperType: 'mojo_80g', bindingType: '-', hostSpineWidthMm: 5 })).toBe(true)
    expect(isHostSpineFixed({ hostSpineWidthMm: 5 })).toBe(true)
  })
})

describe('decideHostSpineAction (편집 중 가드)', () => {
  const base = { hostFixed: false, initial: false, baselinePageCount: 20, currentPageCount: 20 }
  it('host 없음 → no-host (기존 경로)', () => {
    expect(decideHostSpineAction({ ...base, hostSpineWidthMm: null })).toBe('no-host')
    expect(decideHostSpineAction({ ...base, hostSpineWidthMm: undefined })).toBe('no-host')
  })
  it('초기 로드 → 항상 apply-host (고정/비고정 무관)', () => {
    expect(decideHostSpineAction({ ...base, hostSpineWidthMm: 5, initial: true, hostFixed: true })).toBe('apply-host')
    expect(decideHostSpineAction({ ...base, hostSpineWidthMm: 5, initial: true, baselinePageCount: null })).toBe('apply-host')
  })
  it('고정 + 편집 중 → skip (페이지 수 변화 무관)', () => {
    expect(decideHostSpineAction({ ...base, hostSpineWidthMm: 0, hostFixed: true, currentPageCount: 24 })).toBe('skip')
  })
  it('비고정 + 페이지 수 변화 → formula(API)', () => {
    expect(decideHostSpineAction({ ...base, hostSpineWidthMm: 5, currentPageCount: 22 })).toBe('formula')
  })
  it('비고정 + 기준선과 같은 페이지 수 → apply-host(재적용, API 없음)', () => {
    expect(decideHostSpineAction({ ...base, hostSpineWidthMm: 5 })).toBe('apply-host')
  })
  it('비고정 + 기준선 미기록(호스트 적용 전) → formula', () => {
    expect(decideHostSpineAction({ ...base, hostSpineWidthMm: 5, baselinePageCount: null })).toBe('formula')
  })
})

describe('appliedSpine 출처/값 (R-195 계약 6)', () => {
  it('flat-spread 는 항상 template', () => {
    expect(resolveAppliedSpineSource({ conversionMode: 'flat-spread', lastAppliedSource: 'host' })).toBe('template')
  })
  it('host / formula 는 마지막 적용 출처 그대로, 기록 없으면 template', () => {
    expect(resolveAppliedSpineSource({ conversionMode: 'full', lastAppliedSource: 'host' })).toBe('host')
    expect(resolveAppliedSpineSource({ conversionMode: 'flat-spine', lastAppliedSource: 'formula' })).toBe('formula')
    expect(resolveAppliedSpineSource({ conversionMode: 'full', lastAppliedSource: null })).toBe('template')
    expect(resolveAppliedSpineSource({})).toBe('template')
  })
  it('buildAppliedSpineSnapshot: spec 책등(0.1 반올림) + 출처', () => {
    expect(
      buildAppliedSpineSnapshot({
        isSpreadMode: true,
        spreadConfig: { regionScope: 'cover', conversionMode: 'full', spec: { spineWidthMm: 7.26 } },
        lastAppliedSource: 'host',
      }),
    ).toEqual({ spineWidthMm: 7.3, source: 'host' })
    expect(
      buildAppliedSpineSnapshot({
        isSpreadMode: true,
        spreadConfig: { conversionMode: 'full', spec: { spineWidthMm: 0 } },
        lastAppliedSource: 'host',
      }),
    ).toEqual({ spineWidthMm: 0, source: 'host' })
  })
  it('비스프레드·내지 전용·spec 부재 → null / undefined', () => {
    expect(buildAppliedSpineSnapshot({ isSpreadMode: false, spreadConfig: { spec: { spineWidthMm: 5 } } })).toBeNull()
    expect(
      buildAppliedSpineSnapshot({ isSpreadMode: true, spreadConfig: { regionScope: 'inner', spec: { spineWidthMm: 5 } } }),
    ).toBeNull()
    expect(getAppliedSpineWidthMm(true, { regionScope: 'cover' })).toBeUndefined()
    expect(getAppliedSpineWidthMm(true, null)).toBeUndefined()
    expect(getAppliedSpineWidthMm(true, { spec: { spineWidthMm: NaN } })).toBeUndefined()
  })
})

describe('hasSpineRegionObjects (0mm 적용 가드)', () => {
  it('시스템·flat 책등 아트워크는 제외, 일반 책등 객체만 true', () => {
    expect(hasSpineRegionObjects([])).toBe(false)
    expect(hasSpineRegionObjects([{ meta: { system: 'spreadGuide', regionRef: 'spine' } }])).toBe(false)
    expect(hasSpineRegionObjects([{ meta: { regionRef: 'spine', flatArtwork: 'spine' } }])).toBe(false)
    expect(hasSpineRegionObjects([{ meta: { regionRef: 'front-cover' } }, {}])).toBe(false)
    expect(hasSpineRegionObjects([{ meta: { regionRef: 'spine' } }])).toBe(true)
  })
})
