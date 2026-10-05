import { describe, it, expect } from 'vitest'
import { buildSpreadSnapshots } from './buildSpreadSnapshots'
import { SPINE_FORMULA_VERSION } from '@storige/types'

const baseSpec = {
  coverWidthMm: 210,
  coverHeightMm: 297,
  spineWidthMm: 10,
  wingEnabled: false,
  wingWidthMm: 0,
  cutSizeMm: 3,
  safeSizeMm: 3,
  dpi: 150,
}

describe('buildSpreadSnapshots', () => {
  it('정상: spread + spine 스냅샷 생성, 총폭=cover×2+spine, formulaVersion 박힘', () => {
    const { spread, spine } = buildSpreadSnapshots(
      { spec: { ...baseSpec } },
      { paperType: 'mojo_80g', bindingType: 'perfect', calculatedSpineWidth: 10 },
      24,
    )
    expect(spread).toBeDefined()
    expect(spread!.totalWidthMm).toBe(430) // 210*2 + 10, wing 없음
    expect(spread!.totalHeightMm).toBe(297)
    expect(spread!.dpi).toBe(150)
    expect(spine).toBeDefined()
    expect(spine!.pageCount).toBe(24)
    expect(spine!.spineWidthMm).toBe(10)
    expect(spine!.paperType).toBe('mojo_80g')
    expect(spine!.formulaVersion).toBe(SPINE_FORMULA_VERSION)
    expect(spine!.spineWidthSource).toBe('formula') // spec(10) == calc(10)
  })

  it('날개 활성: 총폭에 wing×2 포함', () => {
    const { spread } = buildSpreadSnapshots(
      { spec: { ...baseSpec, wingEnabled: true, wingWidthMm: 20 } },
      { paperType: 'mojo_80g', bindingType: 'perfect', calculatedSpineWidth: 10 },
      24,
    )
    expect(spread!.totalWidthMm).toBe(470) // 20*2 + 210*2 + 10
  })

  it('수동조정 책등: spec≠calc → spineWidthSource=manual', () => {
    const { spine } = buildSpreadSnapshots(
      { spec: { ...baseSpec, spineWidthMm: 15 } },
      { paperType: 'mojo_80g', bindingType: 'perfect', calculatedSpineWidth: 10 },
      24,
    )
    expect(spine!.spineWidthMm).toBe(15)
    expect(spine!.spineWidthSource).toBe('manual')
  })

  it('spine 필수값(paperType) 누락 → spine 생략, spread 는 유지(부분기록 금지)', () => {
    const { spread, spine } = buildSpreadSnapshots(
      { spec: { ...baseSpec } },
      { paperType: null, bindingType: 'perfect', calculatedSpineWidth: 10 },
      24,
    )
    expect(spread).toBeDefined()
    expect(spine).toBeUndefined()
  })

  it('내지 0장 → spine 생략', () => {
    const { spine } = buildSpreadSnapshots(
      { spec: { ...baseSpec } },
      { paperType: 'mojo_80g', bindingType: 'perfect', calculatedSpineWidth: 10 },
      0,
    )
    expect(spine).toBeUndefined()
  })

  it('spreadConfig null → 빈 객체', () => {
    expect(buildSpreadSnapshots(null, null, 24)).toEqual({})
  })

  // ── D-4 (2026-07-06): caseBind → metadata.spread 출력 사이즈 additive 기록 ──

  it('caseBind 有: outputWidthMm/outputHeightMm 기록(wrap 포함), 기존 필드 불변', () => {
    const { spread } = buildSpreadSnapshots(
      {
        spec: {
          ...baseSpec,
          caseBind: { boardThicknessMm: 2, turnInMm: 15, wrapMarginMm: 5 },
        },
      },
      { paperType: 'mojo_80g', bindingType: 'perfect', calculatedSpineWidth: 10 },
      24,
    )
    // 기존 필드 불변 (trim 기준)
    expect(spread!.totalWidthMm).toBe(430)
    expect(spread!.totalHeightMm).toBe(297)
    // 출력 = trim + board×2 + (turnIn+wrap)×2 / 높이 = trim + (turnIn+wrap)×2
    expect(spread!.outputWidthMm).toBe(430 + 2 * 2 + (15 + 5) * 2) // 474
    expect(spread!.outputHeightMm).toBe(297 + (15 + 5) * 2) // 337
    // 스냅샷 spec 에도 caseBind 보존(normalizeSpreadSpec additive)
    expect(spread!.spec.caseBind).toEqual({ boardThicknessMm: 2, turnInMm: 15, wrapMarginMm: 5 })
  })

  it('caseBind 無: output 필드 자체 생략(기존 스냅샷 byte-identical)', () => {
    const { spread } = buildSpreadSnapshots(
      { spec: { ...baseSpec } },
      { paperType: 'mojo_80g', bindingType: 'perfect', calculatedSpineWidth: 10 },
      24,
    )
    expect('outputWidthMm' in spread!).toBe(false)
    expect('outputHeightMm' in spread!).toBe(false)
    expect('caseBind' in spread!.spec).toBe(false)
  })

  it('caseBind 비유효(NaN 필드): 미설정으로 간주 — output 미기록, 완료 무중단', () => {
    const { spread } = buildSpreadSnapshots(
      {
        spec: {
          ...baseSpec,
          caseBind: { boardThicknessMm: NaN, turnInMm: 15, wrapMarginMm: 5 },
        },
      },
      { paperType: 'mojo_80g', bindingType: 'perfect', calculatedSpineWidth: 10 },
      24,
    )
    expect(spread).toBeDefined()
    expect(spread!.outputWidthMm).toBeUndefined()
    expect(spread!.spec.caseBind).toBeUndefined()
  })

  it('비정상 spec(NaN) → catch 하여 빈 객체(완료 무중단)', () => {
    const { spread, spine } = buildSpreadSnapshots(
      { spec: { ...baseSpec, coverWidthMm: NaN } },
      { paperType: 'mojo_80g', bindingType: 'perfect', calculatedSpineWidth: 10 },
      24,
    )
    expect(spread).toBeUndefined()
    expect(spine).toBeUndefined()
  })

  // ── S7: 책등 0mm(책등 없는 책)는 유효 — 단 spec 초기값 0 과 확정 0 을 구분 ──

  it('S7 flat-spread + spec 0 + calc 미계산 → spine 0mm 기록(책등 고정 템플릿 확정값)', () => {
    const { spread, spine } = buildSpreadSnapshots(
      { spec: { ...baseSpec, spineWidthMm: 0 }, conversionMode: 'flat-spread' },
      { paperType: 'mojo_80g', bindingType: 'spiral', calculatedSpineWidth: null },
      40,
    )
    expect(spread!.totalWidthMm).toBe(420) // 210*2 + 0
    expect(spine).toEqual({
      pageCount: 40,
      paperType: 'mojo_80g',
      bindingType: 'spiral',
      spineWidthMm: 0,
      formulaVersion: SPINE_FORMULA_VERSION,
    }) // calc 없음 → spineWidthSource 생략
  })

  it('S7 calc 가 유한수 0(호스트 0mm/공식 적용 결과) → spine 0mm 기록, source=formula', () => {
    const { spine } = buildSpreadSnapshots(
      { spec: { ...baseSpec, spineWidthMm: 0 } },
      { paperType: 'mojo_80g', bindingType: 'spiral', calculatedSpineWidth: 0 },
      40,
    )
    expect(spine!.spineWidthMm).toBe(0)
    expect(spine!.spineWidthSource).toBe('formula')
  })

  it('S7 full 모드 spec 0 + calc 미계산(공식 미실행/실패) → 미확정이므로 spine 생략(종전 동일)', () => {
    const { spread, spine } = buildSpreadSnapshots(
      { spec: { ...baseSpec, spineWidthMm: 0 }, conversionMode: 'full' },
      { paperType: 'mojo_80g', bindingType: 'perfect', calculatedSpineWidth: null },
      40,
    )
    expect(spread).toBeDefined()
    expect(spine).toBeUndefined()
  })

  it('S7 spiral + flat-spread 0mm + paperType 누락 → spine 기록, paperType 키 생략', () => {
    const { spine } = buildSpreadSnapshots(
      { spec: { ...baseSpec, spineWidthMm: 0 }, conversionMode: 'flat-spread' },
      { paperType: null, bindingType: 'spiral', calculatedSpineWidth: null },
      40,
    )
    expect(spine).toBeDefined()
    expect('paperType' in spine!).toBe(false)
    expect(spine).toEqual({
      pageCount: 40,
      bindingType: 'spiral',
      spineWidthMm: 0,
      formulaVersion: SPINE_FORMULA_VERSION,
    })
  })

  it('S7 perfect + flat-spread 0mm + paperType 누락 → spine 생략(공식제본은 paperType 필수)', () => {
    const { spine } = buildSpreadSnapshots(
      { spec: { ...baseSpec, spineWidthMm: 0 }, conversionMode: 'flat-spread' },
      { paperType: null, bindingType: 'perfect', calculatedSpineWidth: null },
      40,
    )
    expect(spine).toBeUndefined()
  })

  it('S7 HARDCOVER(대문자) 0mm + paperType 누락 → spine 생략(대소문자 무시)', () => {
    const { spine } = buildSpreadSnapshots(
      { spec: { ...baseSpec, spineWidthMm: 0 } },
      { paperType: null, bindingType: 'HARDCOVER', calculatedSpineWidth: 0 },
      40,
    )
    expect(spine).toBeUndefined()
  })

  it('S7 spiral + 책등 >0mm + paperType 누락 → spine 생략(0mm 에만 예외)', () => {
    const { spine } = buildSpreadSnapshots(
      { spec: { ...baseSpec, spineWidthMm: 5 } },
      { paperType: null, bindingType: 'spiral', calculatedSpineWidth: 5 },
      40,
    )
    expect(spine).toBeUndefined()
  })

  it('S7 bindingType 누락 + 0mm → spine 생략', () => {
    const { spine } = buildSpreadSnapshots(
      { spec: { ...baseSpec, spineWidthMm: 0 }, conversionMode: 'flat-spread' },
      { paperType: 'mojo_80g', bindingType: null, calculatedSpineWidth: null },
      40,
    )
    expect(spine).toBeUndefined()
  })

  it('S7 flat-spread 0mm 라도 내지 0장 → spine 생략', () => {
    const { spine } = buildSpreadSnapshots(
      { spec: { ...baseSpec, spineWidthMm: 0 }, conversionMode: 'flat-spread' },
      { paperType: 'mojo_80g', bindingType: 'spiral', calculatedSpineWidth: null },
      0,
    )
    expect(spine).toBeUndefined()
  })

  it('S7 calc 음수(비정상) + spec 0 → spine 생략', () => {
    const { spine } = buildSpreadSnapshots(
      { spec: { ...baseSpec, spineWidthMm: 0 } },
      { paperType: 'mojo_80g', bindingType: 'perfect', calculatedSpineWidth: -1 },
      24,
    )
    expect(spine).toBeUndefined()
  })
})

describe('buildSpreadSnapshots — 양장 싸바리 출력 크기(opts.hardcoverWrapMm)', () => {
  const wrapSpec = { ...baseSpec, coverWidthMm: 218, coverHeightMm: 305, spineWidthMm: 8, cutSizeMm: 40 }
  const spineCfg = { paperType: 'mojo_80g', bindingType: 'hardcover', calculatedSpineWidth: 8 }

  it('wrap 20 · caseBind 없음 → outputWidthMm/HeightMm = 484×345', () => {
    const { spread } = buildSpreadSnapshots({ spec: { ...wrapSpec } }, spineCfg, 24, { hardcoverWrapMm: 20 })
    expect(spread!.totalWidthMm).toBe(444)
    expect(spread!.totalHeightMm).toBe(305)
    expect(spread!.outputWidthMm).toBe(484)
    expect(spread!.outputHeightMm).toBe(345)
  })

  it('opts 가 없거나 wrap 이 0·비정상이면 output 키가 없고 결과가 opts 없는 호출과 같다', () => {
    const legacy = buildSpreadSnapshots({ spec: { ...wrapSpec } }, spineCfg, 24)
    expect(legacy.spread).toBeDefined()
    expect('outputWidthMm' in legacy.spread!).toBe(false)
    expect('outputHeightMm' in legacy.spread!).toBe(false)
    for (const opts of [undefined, {}, { hardcoverWrapMm: undefined }, { hardcoverWrapMm: 0 }, { hardcoverWrapMm: Number.NaN }]) {
      expect(buildSpreadSnapshots({ spec: { ...wrapSpec } }, spineCfg, 24, opts)).toEqual(legacy)
    }
  })
})

