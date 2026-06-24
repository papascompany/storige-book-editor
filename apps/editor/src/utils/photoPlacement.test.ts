import { describe, it, expect } from 'vitest'
import {
  measureFrame,
  imageAspect,
  computeEffectiveDpi,
  matchPhotosToFrames,
  canvasDpi,
  isFrameFilled,
  collectEmptyFrames,
} from './photoPlacement'

// ────────────────────────────────────────────────────────────────────────────
// measureFrame / imageAspect / canvasDpi
// ────────────────────────────────────────────────────────────────────────────

describe('measureFrame', () => {
  it('scale 을 반영한 화면 크기와 가로세로비', () => {
    const m = measureFrame({ width: 100, height: 50, scaleX: 2, scaleY: 2 })
    expect(m.widthPx).toBe(200)
    expect(m.heightPx).toBe(100)
    expect(m.aspect).toBeCloseTo(2)
  })

  it('scale 미지정 → 1 로 간주', () => {
    const m = measureFrame({ width: 300, height: 300 })
    expect(m.widthPx).toBe(300)
    expect(m.aspect).toBeCloseTo(1)
  })

  it('0 크기 → aspect 1 폴백(0 나눗셈 방지)', () => {
    const m = measureFrame({ width: 0, height: 0 })
    expect(m.aspect).toBe(1)
  })
})

describe('imageAspect', () => {
  it('가로 이미지', () => {
    expect(imageAspect({ width: 4000, height: 3000 })).toBeCloseTo(4 / 3)
  })
  it('치수 없음 → 1 폴백', () => {
    expect(imageAspect({})).toBe(1)
  })
})

describe('canvasDpi', () => {
  it("unit==='mm' → unitOptions.dpi", () => {
    expect(canvasDpi({ unitOptions: { unit: 'mm', dpi: 300 } })).toBe(300)
  })
  it("unit==='mm' dpi 미지정 → 150 기본", () => {
    expect(canvasDpi({ unitOptions: { unit: 'mm' } })).toBe(150)
  })
  it('mm 아님 → 72(px=pt)', () => {
    expect(canvasDpi({ unitOptions: { unit: 'px' } })).toBe(72)
    expect(canvasDpi({})).toBe(72)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// computeEffectiveDpi
// ────────────────────────────────────────────────────────────────────────────

describe('computeEffectiveDpi', () => {
  it('동일 비율: imgPx*dpi/framePx', () => {
    // 프레임 300px @150dpi = 2인치. 사진 600px → 600/2 = 300dpi
    const frame = measureFrame({ width: 300, height: 300 })
    const dpi = computeEffectiveDpi({ width: 600, height: 600 }, frame, 150)
    expect(dpi).toBeCloseTo(300)
  })

  it('cover 채움: 가장 늘어나는 축(작은 dpi) 채택', () => {
    // 프레임 정사각 300px @150dpi, 사진 600x300(가로로 김) → 세로축이 더 늘어남
    const frame = measureFrame({ width: 300, height: 300 })
    const dpi = computeEffectiveDpi({ width: 600, height: 300 }, frame, 150)
    // dpiX=600*150/300=300, dpiY=300*150/300=150 → min=150
    expect(dpi).toBeCloseTo(150)
  })

  it('측정 불가(0 픽셀) → Infinity(경고 안 띄움)', () => {
    const frame = measureFrame({ width: 300, height: 300 })
    expect(computeEffectiveDpi({ width: 0, height: 0 }, frame, 150)).toBe(Infinity)
  })

  it('작은 사진 → 임계(150) 미만으로 경고 대상', () => {
    // 프레임 600px @150dpi = 4인치. 사진 300px → 75dpi (< 150)
    const frame = measureFrame({ width: 600, height: 600 })
    const dpi = computeEffectiveDpi({ width: 300, height: 300 }, frame, 150)
    expect(dpi).toBeCloseTo(75)
    expect(dpi).toBeLessThan(150)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// matchPhotosToFrames (순수 매칭)
// ────────────────────────────────────────────────────────────────────────────

describe('matchPhotosToFrames', () => {
  it('aspectMatch=false: 순서대로 zip, 적은 쪽까지', () => {
    const photos = [{ aspect: 1, id: 'p0' }, { aspect: 2, id: 'p1' }, { aspect: 3, id: 'p2' }]
    const frames = [{ aspect: 9, id: 'f0' }, { aspect: 9, id: 'f1' }]
    const r = matchPhotosToFrames(photos, frames, false)
    expect(r.pairs.map((x) => [x.photo.id, x.frame.id])).toEqual([
      ['p0', 'f0'],
      ['p1', 'f1'],
    ])
    expect(r.leftoverPhotos.map((p) => p.id)).toEqual(['p2'])
    expect(r.leftoverFrames).toEqual([])
  })

  it('aspectMatch=true: 가로사진→가로프레임 최근접 배치', () => {
    // 사진: 정사각(1) → 가로(2.0). 프레임: 가로(2.0), 정사각(1.0)
    const photos = [{ aspect: 1.0, id: 'square' }, { aspect: 2.0, id: 'wide' }]
    const frames = [{ aspect: 2.0, id: 'F-wide' }, { aspect: 1.0, id: 'F-square' }]
    const r = matchPhotosToFrames(photos, frames, true)
    const map = Object.fromEntries(r.pairs.map((x) => [x.photo.id, x.frame.id]))
    expect(map.square).toBe('F-square')
    expect(map.wide).toBe('F-wide')
  })

  it('aspectMatch=true: 동률이면 페이지 순서(앞쪽 프레임) 우선', () => {
    const photos = [{ aspect: 1.0, id: 'p0' }]
    const frames = [{ aspect: 1.0, id: 'f0' }, { aspect: 1.0, id: 'f1' }]
    const r = matchPhotosToFrames(photos, frames, true)
    expect(r.pairs[0].frame.id).toBe('f0')
    expect(r.leftoverFrames.map((f) => f.id)).toEqual(['f1'])
  })

  it('프레임 부족: 남은 사진 leftover', () => {
    const photos = [{ aspect: 1, id: 'p0' }, { aspect: 1, id: 'p1' }]
    const frames = [{ aspect: 1, id: 'f0' }]
    const r = matchPhotosToFrames(photos, frames, true)
    expect(r.pairs).toHaveLength(1)
    expect(r.leftoverPhotos.map((p) => p.id)).toEqual(['p1'])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// isFrameFilled / collectEmptyFrames (캔버스 읽기)
// ────────────────────────────────────────────────────────────────────────────

function fakeCanvas(objects: any[], unitOptions?: any): any {
  return { getObjects: () => objects, unitOptions }
}

describe('isFrameFilled', () => {
  it('parentLayerId 매칭 fillImage 있으면 채워짐', () => {
    const frame = { id: 'fr1', extensionType: 'frame' }
    const filled = { extensionType: 'fillImage', parentLayerId: 'fr1' }
    expect(isFrameFilled(fakeCanvas([frame, filled]), frame)).toBe(true)
  })
  it('frameRef 매칭도 채워짐', () => {
    const frame = { id: 'fr1', extensionType: 'frame' }
    const filled = { extensionType: 'fillImage', frameRef: 'fr1' }
    expect(isFrameFilled(fakeCanvas([frame, filled]), frame)).toBe(true)
  })
  it('매칭 fillImage 없으면 빈 틀', () => {
    const frame = { id: 'fr1', extensionType: 'frame' }
    const other = { extensionType: 'fillImage', parentLayerId: 'other' }
    expect(isFrameFilled(fakeCanvas([frame, other]), frame)).toBe(false)
  })
})

describe('collectEmptyFrames', () => {
  it('여러 캔버스에서 페이지 순서대로 빈 프레임만 수집', () => {
    const c1Frame1 = { id: 'a', extensionType: 'frame', width: 100, height: 100 }
    const c1FrameFilled = { id: 'b', extensionType: 'frame', width: 100, height: 100 }
    const c1Fill = { extensionType: 'fillImage', parentLayerId: 'b' }
    const c1Other = { id: 'txt', extensionType: 'text' } // 프레임 아님
    const c2Frame = { id: 'c', extensionType: 'frame', width: 200, height: 100 }

    const c1 = fakeCanvas([c1Frame1, c1FrameFilled, c1Fill, c1Other], { unit: 'mm', dpi: 150 })
    const c2 = fakeCanvas([c2Frame], { unit: 'mm', dpi: 300 })

    const out = collectEmptyFrames([c1, c2])
    expect(out.map((f) => f.frame.id)).toEqual(['a', 'c']) // b 는 채워짐 → 제외
    expect(out[0].dpi).toBe(150)
    expect(out[1].dpi).toBe(300)
    expect(out[1].aspect).toBeCloseTo(2) // 200/100
  })

  it('dispose 등 getObjects throw 캔버스는 건너뜀', () => {
    const bad = { getObjects: () => { throw new Error('disposed') } }
    const good = fakeCanvas([{ id: 'x', extensionType: 'frame', width: 10, height: 10 }])
    const out = collectEmptyFrames([bad as any, good])
    expect(out.map((f) => f.frame.id)).toEqual(['x'])
  })
})
