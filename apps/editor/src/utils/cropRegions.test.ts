import { describe, it, expect } from 'vitest'
import type { SpreadSpec } from '@storige/types'
import {
  extractSpreadRegionImagesFromCanvas,
  type SpreadCaptureCanvas,
} from './cropRegions'

/**
 * 3D 목업 표지 캡처 (2026-07-27)
 *
 * 검증 축:
 * - 블리드 인셋 = 트림만 캡처(인쇄 결과와 동일)
 * - 배율 정규화 = 현재 줌과 무관하게 표지 1면이 목표 폭
 * - 실패 격리 = workspace 부재/오염 캔버스에서 throw 하지 않고 폴백
 */

// 표지 150×200mm, 책등 20mm, 블리드 6mm(사방 3mm), 날개 없음
// → 트림 폭 = 150 + 20 + 150 = 320mm, workspace = 326 × 206mm
const SPEC: SpreadSpec = {
  coverWidthMm: 150,
  coverHeightMm: 200,
  spineWidthMm: 20,
  wingEnabled: false,
  wingWidthMm: 0,
  cutSizeMm: 6,
  safeSizeMm: 5,
  dpi: 150,
}

type CaptureCall = {
  format?: 'png' | 'jpeg'
  quality?: number
  left?: number
  top?: number
  width?: number
  height?: number
  multiplier?: number
}

/**
 * workspace 1개만 가진 가짜 캔버스.
 * @param pxPerMm 뷰포트 배율(줌) — workspace 바운딩을 mm×배율로 만든다.
 * @param origin workspace 좌상단 뷰포트 좌표(패닝 상태 모사)
 */
function makeCanvas(
  pxPerMm: number,
  origin: { left: number; top: number } = { left: 0, top: 0 },
  opts: { throwOn?: number; noWorkspace?: boolean } = {}
): { canvas: SpreadCaptureCanvas; calls: CaptureCall[] } {
  const calls: CaptureCall[] = []
  const bound = {
    left: origin.left,
    top: origin.top,
    width: 326 * pxPerMm,
    height: 206 * pxPerMm,
  }
  const canvas: SpreadCaptureCanvas = {
    getObjects: () =>
      opts.noWorkspace
        ? [{ id: 'other', getBoundingRect: () => bound }]
        : [{ id: 'workspace', getBoundingRect: () => bound }],
    toDataURL: (options) => {
      calls.push(options)
      if (opts.throwOn !== undefined && calls.length === opts.throwOn) {
        throw new Error('tainted canvas')
      }
      return `data:image/jpeg;base64,#${calls.length}`
    },
  }
  return { canvas, calls }
}

describe('extractSpreadRegionImagesFromCanvas — 영역별 트림 캡처', () => {
  it('블리드를 인셋하고 영역 순서대로 back-cover/spine/front-cover 를 캡처한다', () => {
    const { canvas, calls } = makeCanvas(1)
    const images = extractSpreadRegionImagesFromCanvas(canvas, SPEC)

    expect(Object.keys(images).sort()).toEqual(['back-cover', 'front-cover', 'spine'])
    expect(calls).toHaveLength(3)

    // 블리드 3mm 인셋 → 좌단 3, 상단 3. 높이는 트림 200mm.
    expect(calls[0].left).toBeCloseTo(3, 6)
    expect(calls[0].top).toBeCloseTo(3, 6)
    expect(calls[0].width).toBeCloseTo(150, 6)
    expect(calls[0].height).toBeCloseTo(200, 6)

    // 책등: 뒷표지(150) 다음
    expect(calls[1].left).toBeCloseTo(3 + 150, 6)
    expect(calls[1].width).toBeCloseTo(20, 6)

    // 앞표지: 뒷표지 + 책등 다음
    expect(calls[2].left).toBeCloseTo(3 + 170, 6)
    expect(calls[2].width).toBeCloseTo(150, 6)
  })

  it('패닝(원점 이동) 상태에서도 workspace 바운딩 기준으로 오프셋된다', () => {
    const { canvas, calls } = makeCanvas(1, { left: 40, top: 25 })
    extractSpreadRegionImagesFromCanvas(canvas, SPEC)
    expect(calls[0].left).toBeCloseTo(43, 6)
    expect(calls[0].top).toBeCloseTo(28, 6)
  })

  it('줌 배율이 달라도 표지 1면 출력 폭은 목표 폭으로 정규화된다', () => {
    const target = 720
    const zoomed = makeCanvas(4) // 표지 1면 = 600px
    extractSpreadRegionImagesFromCanvas(zoomed.canvas, SPEC, { targetCoverWidthPx: target })
    const outWidth = zoomed.calls[0].width! * zoomed.calls[0].multiplier!
    expect(outWidth).toBeCloseTo(target, 6)

    const shrunk = makeCanvas(0.5) // 표지 1면 = 75px
    extractSpreadRegionImagesFromCanvas(shrunk.canvas, SPEC, { targetCoverWidthPx: target })
    // 업스케일 상한 2배 — 목표에 못 미쳐도 확대는 2배까지만
    expect(shrunk.calls[0].multiplier).toBe(2)
  })

  it('날개가 활성이면 4~5영역까지 캡처한다', () => {
    const { canvas } = makeCanvas(1)
    const images = extractSpreadRegionImagesFromCanvas(canvas, {
      ...SPEC,
      wingEnabled: true,
      wingWidthMm: 60,
    })
    expect(Object.keys(images).sort()).toEqual([
      'back-cover',
      'back-wing',
      'front-cover',
      'front-wing',
      'spine',
    ])
  })

  it('workspace 가 없거나 캔버스가 disposed 면 빈 객체(placeholder 폴백)', () => {
    const { canvas } = makeCanvas(1, { left: 0, top: 0 }, { noWorkspace: true })
    expect(extractSpreadRegionImagesFromCanvas(canvas, SPEC)).toEqual({})
    expect(extractSpreadRegionImagesFromCanvas(null, SPEC)).toEqual({})

    const disposed = makeCanvas(1)
    disposed.canvas.disposed = true
    expect(extractSpreadRegionImagesFromCanvas(disposed.canvas, SPEC)).toEqual({})
    expect(disposed.calls).toHaveLength(0)
  })

  it('일부 영역 인코딩이 실패해도 나머지는 반환한다(오염 캔버스 격리)', () => {
    const { canvas } = makeCanvas(1, { left: 0, top: 0 }, { throwOn: 2 })
    const images = extractSpreadRegionImagesFromCanvas(canvas, SPEC)
    expect(images['back-cover']).toBeDefined()
    expect(images['spine']).toBeUndefined()
    expect(images['front-cover']).toBeDefined()
  })
})
