import { describe, it, expect } from 'vitest'
import { resolvePrintGeometry, type PrintGeometrySource } from '@storige/types'
import { computePdfPageGeometry, type PdfPageSizeOptions } from './pdfPageGeometry'

/**
 * @storige/types resolvePrintGeometry(템플릿셋 규격 → 재단·유효 도련·작업 크기·표지 스프레드 cutSizeMm)
 * 단위 테스트와, 편집기 PDF 페이지 기하(computePdfPageGeometry)와의 정합 테스트.
 */

const A4 = { width: 210, height: 297 }

describe('resolvePrintGeometry — 도련 게이트(cropMarkEnabled × bleedMm)', () => {
  it('재단선 ON + bleed 3: 유효 도련 3, 작업 216×303, 마커, cutSizeMm 6', () => {
    expect(resolvePrintGeometry({ ...A4, cropMarkEnabled: true, bleedMm: 3 })).toEqual({
      trimMm: { w: 210, h: 297 },
      bleedMm: 3,
      workMm: { w: 216, h: 303 },
      cropMarks: true,
      coverSpreadCutSizeMm: 6,
    })
  })

  it('재단선 ON + bleed 0: 유효 도련 0, 작업 = 재단, 마커 없음, cutSizeMm 2', () => {
    expect(resolvePrintGeometry({ ...A4, cropMarkEnabled: true, bleedMm: 0 })).toEqual({
      trimMm: { w: 210, h: 297 },
      bleedMm: 0,
      workMm: { w: 210, h: 297 },
      cropMarks: false,
      coverSpreadCutSizeMm: 2,
    })
  })

  it('재단선 OFF + bleed 3: 세트 bleedMm 이 있어도 유효 도련 0, cutSizeMm 2', () => {
    expect(resolvePrintGeometry({ ...A4, cropMarkEnabled: false, bleedMm: 3 })).toEqual({
      trimMm: { w: 210, h: 297 },
      bleedMm: 0,
      workMm: { w: 210, h: 297 },
      cropMarks: false,
      coverSpreadCutSizeMm: 2,
    })
  })

  it('재단선 OFF + bleed 0: 유효 도련 0, cutSizeMm 2', () => {
    expect(resolvePrintGeometry({ ...A4, cropMarkEnabled: false, bleedMm: 0 })).toEqual({
      trimMm: { w: 210, h: 297 },
      bleedMm: 0,
      workMm: { w: 210, h: 297 },
      cropMarks: false,
      coverSpreadCutSizeMm: 2,
    })
  })

  it('재단선 ON + bleed 1: 작업 212×299, cutSizeMm 2(변당 1)', () => {
    expect(resolvePrintGeometry({ ...A4, cropMarkEnabled: true, bleedMm: 1 })).toEqual({
      trimMm: { w: 210, h: 297 },
      bleedMm: 1,
      workMm: { w: 212, h: 299 },
      cropMarks: true,
      coverSpreadCutSizeMm: 2,
    })
  })

  it('재단선 ON + bleed 5: 작업 220×307, cutSizeMm 10(변당 5)', () => {
    expect(resolvePrintGeometry({ ...A4, cropMarkEnabled: true, bleedMm: 5 })).toEqual({
      trimMm: { w: 210, h: 297 },
      bleedMm: 5,
      workMm: { w: 220, h: 307 },
      cropMarks: true,
      coverSpreadCutSizeMm: 10,
    })
  })

  it('재단선 ON + bleed 0.5: 작업 211×298, cutSizeMm 1', () => {
    const g = resolvePrintGeometry({ ...A4, cropMarkEnabled: true, bleedMm: 0.5 })
    expect(g.workMm).toEqual({ w: 211, h: 298 })
    expect(g.coverSpreadCutSizeMm).toBe(1)
  })

  it('재단선 OFF + bleed 1·5: 유효 도련 0, cutSizeMm 2', () => {
    for (const bleedMm of [1, 5]) {
      const g = resolvePrintGeometry({ ...A4, cropMarkEnabled: false, bleedMm })
      expect(g.bleedMm).toBe(0)
      expect(g.workMm).toEqual({ w: 210, h: 297 })
      expect(g.cropMarks).toBe(false)
      expect(g.coverSpreadCutSizeMm).toBe(2)
    }
  })

  it('필드 누락·null: 게이트 OFF 로 본다', () => {
    const inputs: PrintGeometrySource[] = [
      { ...A4 },
      { ...A4, cropMarkEnabled: null, bleedMm: 3 },
      { ...A4, cropMarkEnabled: true, bleedMm: null },
      { ...A4, cropMarkEnabled: true },
    ]
    for (const input of inputs) {
      const g = resolvePrintGeometry(input)
      expect(g.bleedMm).toBe(0)
      expect(g.workMm).toEqual({ w: 210, h: 297 })
      expect(g.cropMarks).toBe(false)
      expect(g.coverSpreadCutSizeMm).toBe(2)
    }
  })

  it('음수·NaN bleed: 게이트 OFF', () => {
    for (const bleedMm of [-3, Number.NaN]) {
      const g = resolvePrintGeometry({ ...A4, cropMarkEnabled: true, bleedMm })
      expect(g.bleedMm).toBe(0)
      expect(g.cropMarks).toBe(false)
      expect(g.coverSpreadCutSizeMm).toBe(2)
    }
  })

  it('재단 크기는 입력 width×height 그대로(가로형)', () => {
    const g = resolvePrintGeometry({ width: 300, height: 150, cropMarkEnabled: true, bleedMm: 3 })
    expect(g.trimMm).toEqual({ w: 300, h: 150 })
    expect(g.workMm).toEqual({ w: 306, h: 156 })
  })
})

describe('resolvePrintGeometry — computePdfPageGeometry 기존 케이스 정합', () => {
  // pdfPageGeometry.test.ts legacyCases 중 봉투가 아닌 6건과 같은 입력.
  // printSize 는 세트 규격 필드가 아니므로 resolvePrintGeometry 에는 넘기지 않는다(렌더 크기에 영향 없음).
  const base: PdfPageSizeOptions = { width: 210, height: 297, cutSize: 3 }
  const cases: Array<{ name: string; size: PdfPageSizeOptions; work: { w: number; h: number } }> = [
    { name: 'plain', size: base, work: { w: 210, h: 297 } },
    { name: 'printSize', size: { ...base, printSize: { width: 220, height: 307 } }, work: { w: 210, h: 297 } },
    { name: '게이트 ON', size: { ...base, bleedMm: 3, cropMarkEnabled: true }, work: { w: 216, h: 303 } },
    {
      name: '게이트 ON + printSize',
      size: { ...base, bleedMm: 3, cropMarkEnabled: true, printSize: { width: 220, height: 307 } },
      work: { w: 216, h: 303 },
    },
    { name: 'cropMark 만', size: { ...base, cropMarkEnabled: true }, work: { w: 210, h: 297 } },
    { name: 'bleed 만', size: { ...base, bleedMm: 3 }, work: { w: 210, h: 297 } },
  ]

  it.each(cases)('$name: 재단·작업 크기와 마커 여부가 편집기 PDF 기하와 같다', ({ size, work }) => {
    const pdf = computePdfPageGeometry(size.width, size.height, size, false)
    const g = resolvePrintGeometry({
      width: size.width,
      height: size.height,
      bleedMm: size.bleedMm,
      cropMarkEnabled: size.cropMarkEnabled,
    })

    expect(g.trimMm).toEqual({ w: 210, h: 297 })
    expect(g.workMm).toEqual(work)
    expect(g.workMm).toEqual({ w: pdf.renderWidth, h: pdf.renderHeight })
    expect(g.cropMarks).toBe(pdf.useEditSize)
    // computePdfPageGeometry.bleedMm 은 게이트와 무관한 입력값 — 유효 도련은 게이트 ON 일 때만 같다.
    expect(g.bleedMm).toBe(pdf.useEditSize ? pdf.bleedMm : 0)
  })
})
