import { describe, it, expect } from 'vitest'
import { buildPhotoUsageCountMap, photoUsageCount, type UsageCanvasLike } from './photoUsage'

const img = (src: string, extra: Record<string, unknown> = {}) => ({
  type: 'image',
  getSrc: () => src,
  ...extra,
})

const canvasOf = (...objects: unknown[]): UsageCanvasLike => ({
  getObjects: () => objects,
})

describe('buildPhotoUsageCountMap', () => {
  it('src 기준으로 전 캔버스를 합산 집계한다', () => {
    const map = buildPhotoUsageCountMap([
      canvasOf(img('a.png'), img('b.png')),
      canvasOf(img('a.png')),
    ])
    expect(map.get('a.png')).toBe(2)
    expect(map.get('b.png')).toBe(1)
  })

  it('externalPhotoUrl 을 집계한다 (D1 외부주입)', () => {
    const map = buildPhotoUsageCountMap([
      canvasOf({ type: 'image', externalPhotoUrl: 'https://x/p.jpg', getSrc: () => 'blob:local' }),
    ])
    expect(map.get('https://x/p.jpg')).toBe(1)
    expect(map.get('blob:local')).toBe(1)
  })

  it('같은 객체에서 src === externalPhotoUrl 이면 1회만 센다', () => {
    const map = buildPhotoUsageCountMap([
      canvasOf(img('https://x/p.jpg', { externalPhotoUrl: 'https://x/p.jpg' })),
    ])
    expect(map.get('https://x/p.jpg')).toBe(1)
  })

  it('그룹 내부 이미지도 집계한다 (중첩 포함)', () => {
    const nested = {
      type: 'group',
      getObjects: () => [img('deep.png'), { type: 'group', _objects: [img('deep.png')] }],
    }
    const map = buildPhotoUsageCountMap([canvasOf(nested)])
    expect(map.get('deep.png')).toBe(2)
  })

  it('이미지가 아닌 객체(텍스트/도형/워크스페이스)는 무시한다', () => {
    const map = buildPhotoUsageCountMap([
      canvasOf(
        { type: 'i-text', text: 'hello' },
        { type: 'rect', id: 'workspace' },
        { type: 'path' }
      ),
    ])
    expect(map.size).toBe(0)
  })

  it('getSrc 가 던지면 src 속성으로 폴백한다', () => {
    const map = buildPhotoUsageCountMap([
      canvasOf({
        type: 'image',
        src: 'fallback.png',
        getSrc: () => {
          throw new Error('disposed element')
        },
      }),
    ])
    expect(map.get('fallback.png')).toBe(1)
  })

  it('dispose 된 캔버스(getObjects throw)는 건너뛴다', () => {
    const broken: UsageCanvasLike = {
      getObjects: () => {
        throw new Error('disposed')
      },
    }
    const map = buildPhotoUsageCountMap([broken, canvasOf(img('ok.png'))])
    expect(map.get('ok.png')).toBe(1)
  })

  it('null/undefined 캔버스를 허용한다', () => {
    const map = buildPhotoUsageCountMap([null, undefined, canvasOf(img('ok.png'))])
    expect(map.get('ok.png')).toBe(1)
  })

  it('삭제 후 재집계하면 카운트가 줄어든다 (undo/삭제 시나리오)', () => {
    const objects = [img('a.png'), img('a.png')]
    const canvas: UsageCanvasLike = { getObjects: () => objects }
    expect(buildPhotoUsageCountMap([canvas]).get('a.png')).toBe(2)
    objects.pop() // 삭제 (object:removed 후 상태)
    expect(buildPhotoUsageCountMap([canvas]).get('a.png')).toBe(1)
    objects.push(img('a.png')) // undo 로 복원 (object:added 후 상태)
    expect(buildPhotoUsageCountMap([canvas]).get('a.png')).toBe(2)
  })

  it('300장×50페이지 규모에서 1패스 집계가 빠르게 완료된다', () => {
    // 50 캔버스 × 60 객체(이미지 40 + 기타 20) = 3000 객체
    const canvases: UsageCanvasLike[] = []
    for (let c = 0; c < 50; c++) {
      const objs: unknown[] = []
      for (let i = 0; i < 40; i++) objs.push(img(`photo-${(c * 40 + i) % 300}.jpg`))
      for (let i = 0; i < 20; i++) objs.push({ type: 'rect' })
      canvases.push(canvasOf(...objs))
    }
    const t0 = Date.now()
    const map = buildPhotoUsageCountMap(canvases)
    const elapsed = Date.now() - t0
    expect(map.size).toBe(300)
    // 60fps 프레임 예산(16.7ms)의 수 배 이내 — debounce 뒤 1회 실행이라 여유 상한
    expect(elapsed).toBeLessThan(50)
  })
})

describe('photoUsageCount', () => {
  it('여러 키(dataURL + storage URL)를 합산한다', () => {
    const map = new Map([
      ['data:image/png;base64,AAA', 2],
      ['https://storage/x.png', 3],
    ])
    expect(photoUsageCount(map, ['data:image/png;base64,AAA', 'https://storage/x.png'])).toBe(5)
  })

  it('빈 값과 중복 키를 무시한다', () => {
    const map = new Map([['k', 4]])
    expect(photoUsageCount(map, ['k', 'k', null, undefined, ''])).toBe(4)
  })

  it('미사용 사진은 0', () => {
    expect(photoUsageCount(new Map(), ['none.png'])).toBe(0)
  })
})
