import { describe, it, expect } from 'vitest'
import { computePdfPageGeometry, type PdfPageSizeOptions } from './pdfPageGeometry'

/**
 * wrapMm 가 없을 때의 기준 산식 — ServicePlugin._createMultiPagePDF 의 페이지 기하
 * (작업사이즈 게이트 + printSize 중앙 배치)를 그대로 옮긴 것.
 */
function legacyGeometry(
  contentWidth: number,
  contentHeight: number,
  size: PdfPageSizeOptions,
  isEnvelope: boolean
) {
  const bleedMm = size.bleedMm ?? 0
  const useEditSize = !!size.cropMarkEnabled && bleedMm > 0 && !isEnvelope
  let renderWidth = contentWidth
  let renderHeight = contentHeight
  if (useEditSize) {
    renderWidth = contentWidth + bleedMm * 2
    renderHeight = contentHeight + bleedMm * 2
  }
  let pageWidth = useEditSize ? renderWidth : contentWidth
  let pageHeight = useEditSize ? renderHeight : contentHeight
  if (!useEditSize && size.printSize && size.printSize.width && size.printSize.height) {
    pageWidth = size.printSize.width
    pageHeight = size.printSize.height
  }
  return {
    renderWidth,
    renderHeight,
    pageWidth,
    pageHeight,
    offsetX: Math.max(0, (pageWidth - renderWidth) / 2),
    offsetY: Math.max(0, (pageHeight - renderHeight) / 2),
    useEditSize,
    bleedMm,
  }
}

const base: PdfPageSizeOptions = { width: 210, height: 297, cutSize: 3 }

describe('computePdfPageGeometry — 싸바리 여분(wrapMm)', () => {
  it('wrap 20: 444×305 → 페이지 484×345, offset 0, 작업사이즈 아님, 클립 확장', () => {
    const g = computePdfPageGeometry(444, 305, { width: 444, height: 305, cutSize: 40, wrapMm: 20 }, false)
    expect(g).toEqual({
      renderWidth: 484,
      renderHeight: 345,
      pageWidth: 484,
      pageHeight: 345,
      offsetX: 0,
      offsetY: 0,
      useEditSize: false,
      wrapActive: true,
      expandClip: true,
      bleedMm: 0,
    })
  })

  it('wrap 과 cropMark·bleed·printSize 를 함께 줘도 wrap 이 우선한다', () => {
    const g = computePdfPageGeometry(
      444,
      305,
      {
        width: 444,
        height: 305,
        cutSize: 40,
        wrapMm: 20,
        bleedMm: 3,
        cropMarkEnabled: true,
        printSize: { width: 600, height: 400 },
      },
      false
    )
    expect(g.wrapActive).toBe(true)
    expect(g.useEditSize).toBe(false)
    expect([g.pageWidth, g.pageHeight]).toEqual([484, 345])
    expect([g.renderWidth, g.renderHeight]).toEqual([484, 345])
    expect([g.offsetX, g.offsetY]).toEqual([0, 0])
    expect(g.bleedMm).toBe(0)
  })

  it('봉투이면 wrapMm 를 무시하고 기준 산식을 따른다', () => {
    const size: PdfPageSizeOptions = { ...base, wrapMm: 20, printSize: { width: 230, height: 320 } }
    const g = computePdfPageGeometry(210, 297, size, true)
    expect(g.wrapActive).toBe(false)
    expect(g).toMatchObject(legacyGeometry(210, 297, size, true))
    expect([g.pageWidth, g.pageHeight]).toEqual([230, 320])
  })

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    'wrapMm=%s 이면 기준 산식과 같다',
    (wrapMm) => {
      const size: PdfPageSizeOptions = { ...base, wrapMm, bleedMm: 3, cropMarkEnabled: true }
      const g = computePdfPageGeometry(210, 297, size, false)
      expect(g.wrapActive).toBe(false)
      expect(g).toMatchObject(legacyGeometry(210, 297, size, false))
      expect(g.expandClip).toBe(g.useEditSize)
    }
  )
})

describe('computePdfPageGeometry — wrapMm 없음(기준 산식 동치)', () => {
  it('plain: 페이지 = 렌더 = 콘텐츠, offset 0', () => {
    const g = computePdfPageGeometry(210, 297, base, false)
    expect(g).toEqual({
      renderWidth: 210,
      renderHeight: 297,
      pageWidth: 210,
      pageHeight: 297,
      offsetX: 0,
      offsetY: 0,
      useEditSize: false,
      wrapActive: false,
      expandClip: false,
      bleedMm: 0,
    })
  })

  it('printSize: 페이지 = printSize, 렌더는 중앙 배치', () => {
    const g = computePdfPageGeometry(210, 297, { ...base, printSize: { width: 220, height: 307 } }, false)
    expect([g.pageWidth, g.pageHeight]).toEqual([220, 307])
    expect([g.renderWidth, g.renderHeight]).toEqual([210, 297])
    expect([g.offsetX, g.offsetY]).toEqual([5, 5])
    expect(g.useEditSize).toBe(false)
    expect(g.expandClip).toBe(false)
  })

  it('작업사이즈 게이트(cropMark + bleed 3): 페이지 = 렌더 = 216×303, printSize 무시, 클립 확장', () => {
    const g = computePdfPageGeometry(
      210,
      297,
      { ...base, bleedMm: 3, cropMarkEnabled: true, printSize: { width: 220, height: 307 } },
      false
    )
    expect([g.pageWidth, g.pageHeight]).toEqual([216, 303])
    expect([g.renderWidth, g.renderHeight]).toEqual([216, 303])
    expect([g.offsetX, g.offsetY]).toEqual([0, 0])
    expect(g.useEditSize).toBe(true)
    expect(g.expandClip).toBe(true)
    expect(g.bleedMm).toBe(3)
  })

  const legacyCases: Array<{ name: string; size: PdfPageSizeOptions; envelope: boolean }> = [
    { name: 'plain', size: base, envelope: false },
    { name: 'printSize', size: { ...base, printSize: { width: 220, height: 307 } }, envelope: false },
    { name: 'printSize 0 값', size: { ...base, printSize: { width: 0, height: 307 } }, envelope: false },
    { name: 'printSize 가 콘텐츠보다 작음', size: { ...base, printSize: { width: 200, height: 280 } }, envelope: false },
    { name: '게이트 ON', size: { ...base, bleedMm: 3, cropMarkEnabled: true }, envelope: false },
    { name: '게이트 ON + printSize', size: { ...base, bleedMm: 3, cropMarkEnabled: true, printSize: { width: 220, height: 307 } }, envelope: false },
    { name: 'cropMark 만', size: { ...base, cropMarkEnabled: true }, envelope: false },
    { name: 'bleed 만', size: { ...base, bleedMm: 3 }, envelope: false },
    { name: '봉투 + 게이트 옵션', size: { ...base, bleedMm: 3, cropMarkEnabled: true }, envelope: true },
  ]

  it.each(legacyCases)('$name: 기준 산식과 같다', ({ size, envelope }) => {
    const g = computePdfPageGeometry(210, 297, size, envelope)
    expect(g).toMatchObject(legacyGeometry(210, 297, size, envelope))
    expect(g.wrapActive).toBe(false)
    expect(g.expandClip).toBe(g.useEditSize)
  })
})
