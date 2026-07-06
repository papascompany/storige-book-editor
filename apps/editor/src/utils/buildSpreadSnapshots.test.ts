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
})
