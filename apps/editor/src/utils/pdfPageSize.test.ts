import { describe, it, expect } from 'vitest'
import { computePdfPageOutputMm } from './pdfPageSize'

/**
 * metadata.coverOutput 산출 — canvas-core ServicePlugin.saveMultiPagePDFAsBlob 페이지 크기 규칙 미러.
 * 입력은 embed.tsx 스프레드 완료가 표지 PDF 에 넘기는 size 객체 형태 그대로다:
 *   { width: totalWidthMm, height: totalHeightMm, cutSize: bleed, ...(printSize | markOpt) }
 */
describe('computePdfPageOutputMm (R-195 coverOutput)', () => {
  const content = { width: 432.5, height: 297, cutSize: 3 }

  it('재단마커 ON + 블리드 3 → 작업사이즈(콘텐츠 + 3×2), bleedMm 3', () => {
    expect(computePdfPageOutputMm({ ...content, bleedMm: 3, cropMarkEnabled: true })).toEqual({
      widthMm: 438.5,
      heightMm: 303,
      bleedMm: 3,
    })
  })

  it('재단마커 ON + 블리드 0 → 게이트 OFF, 콘텐츠 크기 그대로(cutSize 미가산), bleedMm 0', () => {
    expect(computePdfPageOutputMm({ ...content, bleedMm: 0, cropMarkEnabled: true })).toEqual({
      widthMm: 432.5,
      heightMm: 297,
      bleedMm: 0,
    })
  })

  it('재단마커 OFF (블리드 값 있어도) → 콘텐츠 크기, bleedMm 0', () => {
    expect(computePdfPageOutputMm({ ...content, bleedMm: 3, cropMarkEnabled: false })).toEqual({
      widthMm: 432.5,
      heightMm: 297,
      bleedMm: 0,
    })
  })

  it('printSize(caseBind 출력) 있음 → 페이지 = printSize, bleedMm 0', () => {
    expect(
      computePdfPageOutputMm({ ...content, printSize: { width: 470.04, height: 327.96 } }),
    ).toEqual({ widthMm: 470, heightMm: 328, bleedMm: 0 })
  })

  it('printMarkConfig null → markOpt 가 모두 undefined → 콘텐츠 크기, bleedMm 0', () => {
    expect(
      computePdfPageOutputMm({ ...content, bleedMm: undefined, cropMarkEnabled: undefined }),
    ).toEqual({ widthMm: 432.5, heightMm: 297, bleedMm: 0 })
  })

  it('작업사이즈 게이트 ON 이면 printSize 를 무시한다(ServicePlugin 시맨틱)', () => {
    expect(
      computePdfPageOutputMm({
        ...content,
        bleedMm: 2,
        cropMarkEnabled: true,
        printSize: { width: 500, height: 400 },
      }),
    ).toEqual({ widthMm: 436.5, heightMm: 301, bleedMm: 2 })
  })

  it('0.1mm 반올림', () => {
    expect(computePdfPageOutputMm({ width: 100.04, height: 200.06, bleedMm: 1.25, cropMarkEnabled: true })).toEqual({
      widthMm: 102.5,
      heightMm: 202.6,
      bleedMm: 1.3,
    })
  })
})

describe('computePdfPageOutputMm — 싸바리 wrapMm (canvas-core computePdfPageGeometry 미러)', () => {
  it('wrap 20: 콘텐츠 444×305 → 484×345, bleedMm 0', () => {
    expect(computePdfPageOutputMm({ width: 444, height: 305, cutSize: 3, wrapMm: 20 })).toEqual({
      widthMm: 484,
      heightMm: 345,
      bleedMm: 0,
    })
  })

  it('wrapMm 는 재단 마커·printSize 보다 우선한다', () => {
    expect(
      computePdfPageOutputMm({
        width: 444,
        height: 305,
        cutSize: 3,
        bleedMm: 3,
        cropMarkEnabled: true,
        printSize: { width: 500, height: 400 },
        wrapMm: 20,
      }),
    ).toEqual({ widthMm: 484, heightMm: 345, bleedMm: 0 })
  })

  it('wrapMm 0·음수·NaN·Infinity 는 기존 규칙과 같다', () => {
    const base = { width: 432.5, height: 297, cutSize: 3, bleedMm: 3, cropMarkEnabled: true }
    const legacy = computePdfPageOutputMm(base)
    for (const wrapMm of [0, -20, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(computePdfPageOutputMm({ ...base, wrapMm })).toEqual(legacy)
    }
  })
})
