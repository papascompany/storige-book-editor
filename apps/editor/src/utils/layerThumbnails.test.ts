import { describe, it, expect } from 'vitest'
import { SelectionType } from '@storige/canvas-core'
import {
  createThumbCache,
  isThumbEligibleType,
  thumbMultiplier,
  findFillCompanion,
  THUMB_TARGET_PX,
  type FabricThumbSource,
} from './layerThumbnails'

describe('createThumbCache — 무효화 시맨틱 (L5-②)', () => {
  it('set 후 get=fresh 값, getStale 도 동일', () => {
    const cache = createThumbCache()
    cache.set('a', 'data:1')
    expect(cache.get('a')).toBe('data:1')
    expect(cache.getStale('a')).toBe('data:1')
  })

  it('미생성 id 는 get/getStale 모두 undefined', () => {
    const cache = createThumbCache()
    expect(cache.get('nope')).toBeUndefined()
    expect(cache.getStale('nope')).toBeUndefined()
  })

  it('invalidate 후 get 은 undefined(재생성 대상)지만 getStale 은 이전 URL 유지 — stale-while-revalidate', () => {
    const cache = createThumbCache()
    cache.set('a', 'data:old')
    cache.invalidate('a')
    expect(cache.get('a')).toBeUndefined()
    expect(cache.getStale('a')).toBe('data:old')
  })

  it('invalidate 후 재-set 하면 다시 fresh', () => {
    const cache = createThumbCache()
    cache.set('a', 'data:old')
    cache.invalidate('a')
    cache.set('a', 'data:new')
    expect(cache.get('a')).toBe('data:new')
    expect(cache.getStale('a')).toBe('data:new')
  })

  it('없는 id invalidate 는 no-op (엔트리 생성 금지)', () => {
    const cache = createThumbCache()
    cache.invalidate('ghost')
    expect(cache.size()).toBe(0)
  })

  it("음성 캐시('') 는 get 에서 '' 로 구분(undefined=미생성 과 다름) — 매 패스 재시도 방지", () => {
    const cache = createThumbCache()
    cache.set('empty-frame', '')
    expect(cache.get('empty-frame')).toBe('')
    expect(cache.get('empty-frame')).not.toBeUndefined()
  })

  it('prune 은 살아있는 id 만 남긴다(페이지 전환·삭제 후 무한 성장 방지)', () => {
    const cache = createThumbCache()
    cache.set('keep', 'data:k')
    cache.set('drop', 'data:d')
    cache.prune(new Set(['keep']))
    expect(cache.size()).toBe(1)
    expect(cache.get('keep')).toBe('data:k')
    expect(cache.get('drop')).toBeUndefined()
    expect(cache.getStale('drop')).toBeUndefined()
  })
})

describe('isThumbEligibleType — 이미지·도형류만 (미리캔버스 규약)', () => {
  it('image/background/shape/frame/group(svg 계열) 은 대상', () => {
    expect(isThumbEligibleType(SelectionType.image)).toBe(true)
    expect(isThumbEligibleType(SelectionType.background)).toBe(true)
    expect(isThumbEligibleType(SelectionType.shape)).toBe(true)
    expect(isThumbEligibleType(SelectionType.frame)).toBe(true)
    expect(isThumbEligibleType(SelectionType.group)).toBe(true)
  })

  it('텍스트(내용 미리보기 유지)·QR/바코드·템플릿 요소는 비대상', () => {
    expect(isThumbEligibleType(SelectionType.text)).toBe(false)
    expect(isThumbEligibleType(SelectionType.smartCode)).toBe(false)
    expect(isThumbEligibleType(SelectionType.templateElement)).toBe(false)
    expect(isThumbEligibleType(SelectionType.multiple)).toBe(false)
  })
})

describe('thumbMultiplier — 소형 래스터 배율', () => {
  it('대형 원본은 목표 크기로 축소(원본 크기 인코딩 금지)', () => {
    expect(thumbMultiplier(4800, 2400)).toBeCloseTo(THUMB_TARGET_PX / 4800)
  })

  it('미세 도형 업스케일은 2배 캡', () => {
    expect(thumbMultiplier(4, 4)).toBe(2)
  })

  it('0/음수/미정의 치수에도 유한값', () => {
    expect(Number.isFinite(thumbMultiplier(0, 0))).toBe(true)
    expect(thumbMultiplier(0, 0)).toBeLessThanOrEqual(2)
  })
})

describe('findFillCompanion — 사진틀 채움 이미지 탐색(연결 규약 3종)', () => {
  const frame: FabricThumbSource = { id: 'frame-1', extensionType: 'frame' }

  it('parentLayerId 연결(FrameInteractionPlugin)', () => {
    const fill: FabricThumbSource = { id: 'x', extensionType: 'fillImage', parentLayerId: 'frame-1' }
    expect(findFillCompanion(frame, [frame, fill])).toBe(fill)
  })

  it('clipPath.id 연결(fillImageToMold)', () => {
    const fill: FabricThumbSource = { id: 'x', extensionType: 'fillImage', clipPath: { id: 'frame-1' } }
    expect(findFillCompanion(frame, [frame, fill])).toBe(fill)
  })

  it('`${id}_fillImage` id 규약', () => {
    const fill: FabricThumbSource = { id: 'frame-1_fillImage', extensionType: 'fillImage' }
    expect(findFillCompanion(frame, [frame, fill])).toBe(fill)
  })

  it('빈 틀(동반 객체 없음)·타 틀의 fillImage 는 undefined', () => {
    const otherFill: FabricThumbSource = {
      id: 'y',
      extensionType: 'fillImage',
      parentLayerId: 'frame-2',
    }
    expect(findFillCompanion(frame, [frame, otherFill])).toBeUndefined()
  })

  it('extensionType 이 fillImage 가 아니면 parentLayerId 가 같아도 제외', () => {
    const notFill: FabricThumbSource = { id: 'z', extensionType: 'image', parentLayerId: 'frame-1' }
    expect(findFillCompanion(frame, [frame, notFill])).toBeUndefined()
  })

  it('id 없는 객체는 undefined(방어)', () => {
    expect(findFillCompanion({ extensionType: 'frame' }, [])).toBeUndefined()
  })
})
