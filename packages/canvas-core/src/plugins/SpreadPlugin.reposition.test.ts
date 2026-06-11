// SpreadPlugin.repositionObjects 단위 테스트 — 책등 가변(resizeSpine) 시 객체 재배치 무결성.
//
// 배경(버그, IDML 표지 셋 고객 편집기 재현):
//  (1) spine 분기가 meta.anchor 를 무시하고 SpineResizeStrategy 의 "영역 중앙" 위치만 사용
//      → 책등 텍스트(제목/저자/출판사 등) 전부가 캔버스 중앙 한 점에 적층.
//  (2) 출력 scene 변환에 old layout 기준 origin(stale) 사용 — workspace 는 이미 new 크기
//      → 모든 anchored 객체가 Δspine/2 일괄 드리프트. 코드 주석("drift 0" 의도)이 정본이므로
//      본 테스트는 의도(드리프트 0)를 고정한다.
//  (3) 전폭 배경이 DB에 'spine' 으로 잘못 저장된 경우 비율 축소+중앙이동으로 표지 붕괴
//      → 방어 가드(폭 > oldSpine*1.5 → skip) 검증.
//
// fabric 은 node 테스트 환경에서 native canvas 바인딩을 요구해 로드 불가 → 최소 mock.
// (repositionObjects 는 fabric.Point 생성만 사용. SpreadCoordBridge.test.ts 는 엔진 레벨,
//  본 테스트는 플러그인 코드 경로를 직접 검증한다.)
import { describe, it, expect, vi } from 'vitest'
import { computeLayout } from '../spread/SpreadLayoutEngine'
import type { SpreadSpec, SpreadLayout } from '@storige/types'

vi.mock('fabric', () => ({
  fabric: {
    Point: class Point {
      x: number
      y: number
      constructor(x: number, y: number) {
        this.x = x
        this.y = y
      }
    },
  },
}))

// Editor 는 hotkeys/contextMenu 등 DOM 의존이 있어 mock (repositionObjects 는 미사용)
vi.mock('../Editor', () => ({ default: class MockEditor {} }))

import SpreadPlugin from './SpreadPlugin'

// ============================================================================
// Test Helpers
// ============================================================================

const baseSpec: SpreadSpec = {
  coverWidthMm: 210,
  coverHeightMm: 297,
  spineWidthMm: 10,
  wingEnabled: false,
  wingWidthMm: 0,
  dpi: 150,
  cutSizeMm: 3,
  safeSizeMm: 3,
}

const contentOrigin = (layout: SpreadLayout) => ({
  x: -layout.totalWidthPx / 2,
  y: -layout.totalHeightPx / 2,
})

/**
 * fabric.Object 최소 mock — scene 중심좌표(_centerX/_centerY)와 표시 크기를 보관.
 * getBoundingRect(true,true) = scene bbox, setPositionByOrigin = 중심 이동.
 */
function makeObj(opts: {
  type?: string
  meta?: any
  centerX: number
  centerY: number
  width: number
  height: number
  scaleX?: number
  scaleY?: number
}): any {
  return {
    type: opts.type ?? 'textbox',
    meta: opts.meta ?? {},
    scaleX: opts.scaleX ?? 1,
    scaleY: opts.scaleY ?? 1,
    _centerX: opts.centerX,
    _centerY: opts.centerY,
    _w: opts.width,
    _h: opts.height,
    getBoundingRect() {
      return {
        left: this._centerX - this._w / 2,
        top: this._centerY - this._h / 2,
        width: this._w,
        height: this._h,
      }
    },
    setPositionByOrigin(point: { x: number; y: number }) {
      this._centerX = point.x
      this._centerY = point.y
    },
    set(key: string, value: any) {
      ;(this as any)[key] = value
    },
    setCoords() {},
  }
}

/** SpreadPlugin 인스턴스 생성 (mock canvas + currentLayout 주입) */
function makePlugin(objects: any[], layout: SpreadLayout, spec: SpreadSpec): any {
  const canvas: any = { getObjects: () => objects }
  const editor: any = {}
  const plugin: any = new (SpreadPlugin as any)(canvas, editor, { spec })
  plugin.currentLayout = layout // resizeSpine 6단계 갱신 전 시점 = old layout
  return plugin
}

/** content 좌표의 한 점을 layout 기준 scene 좌표로 (테스트 배치/검증용) */
const toScene = (cx: number, cy: number, layout: SpreadLayout) => ({
  x: cx + contentOrigin(layout).x,
  y: cy + contentOrigin(layout).y,
})

// ============================================================================
// Tests
// ============================================================================

describe('SpreadPlugin.repositionObjects — 책등 가변 재배치', () => {
  it('(a) anchor 있는 spine 텍스트 2개: yNorm(0.15/0.85) 보존 + 한 점 적층 안 됨', () => {
    const oldLayout = computeLayout(baseSpec) // 책등 10mm
    const newLayout = computeLayout({ ...baseSpec, spineWidthMm: 20 })
    const oldSpine = oldLayout.regions.find((r) => r.position === 'spine')!
    const newSpine = newLayout.regions.find((r) => r.position === 'spine')!
    const H = oldLayout.totalHeightPx

    // 책등 상단(제목, yNorm 0.15) / 하단(출판사, yNorm 0.85) 텍스트 — old layout scene 좌표로 배치
    const mkSpineText = (yNorm: number) => {
      const contentCx = oldSpine.x + 0.5 * oldSpine.width
      const contentCy = yNorm * H
      const scene = toScene(contentCx, contentCy, oldLayout)
      return makeObj({
        type: 'textbox',
        centerX: scene.x,
        centerY: scene.y,
        width: 40,
        height: 120,
        meta: {
          regionRef: 'spine',
          anchor: { kind: 'region', xNorm: 0.5, yNorm },
        },
      })
    }
    const title = mkSpineText(0.15)
    const publisher = mkSpineText(0.85)

    const plugin = makePlugin([title, publisher], oldLayout, baseSpec)
    plugin.repositionObjects(oldLayout, newLayout)

    // 새 레이아웃 기준으로 yNorm 역산 → 보존되어야 한다
    const newOrigin = contentOrigin(newLayout)
    const yNormOf = (o: any) => (o._centerY - newOrigin.y) / newLayout.totalHeightPx
    expect(yNormOf(title)).toBeCloseTo(0.15, 3)
    expect(yNormOf(publisher)).toBeCloseTo(0.85, 3)

    // 서로 적층 금지: 버그 시 둘 다 영역 중앙(yNorm 0.5) 한 점으로 수렴했다
    expect(Math.abs(title._centerY - publisher._centerY)).toBeGreaterThan(100)

    // x 도 새 spine 영역 중앙(xNorm 0.5) — scene 기준
    const expectedSceneX = newSpine.x + 0.5 * newSpine.width + newOrigin.x
    expect(title._centerX).toBeCloseTo(expectedSceneX, 3)
    expect(publisher._centerX).toBeCloseTo(expectedSceneX, 3)

    // 텍스트 전략: 스케일 불변(폰트 품질 보존)
    expect(title.scaleX).toBe(1)
    expect(title.scaleY).toBe(1)

    // anchor 갱신: yNorm 그대로 보존
    expect(title.meta.anchor).toEqual({ kind: 'region', xNorm: 0.5, yNorm: 0.15 })
    expect(publisher.meta.anchor).toEqual({ kind: 'region', xNorm: 0.5, yNorm: 0.85 })
  })

  it('(b) 전폭 배경(spine 오분류, 가드 발동): 이동/스케일 모두 skip', () => {
    const oldLayout = computeLayout(baseSpec)
    const newLayout = computeLayout({ ...baseSpec, spineWidthMm: 20 })

    // 스프레드 전폭 배경 — 중심이 책등 밴드(=캔버스 중앙)라 DB에 'spine' 으로 잘못 저장된 케이스
    const bg = makeObj({
      type: 'rect',
      centerX: 0, // scene 중앙
      centerY: 0,
      width: oldLayout.totalWidthPx, // 전폭 ≫ oldSpine.width * 1.5
      height: oldLayout.totalHeightPx,
      meta: {
        regionRef: 'spine',
        anchor: { kind: 'region', xNorm: 0.5, yNorm: 0.5 },
      },
    })

    const plugin = makePlugin([bg], oldLayout, baseSpec)
    plugin.repositionObjects(oldLayout, newLayout)

    // 가드: 위치·스케일·anchor 전부 불변 (DefaultResizeStrategy 의 비율 축소+중앙이동 차단)
    expect(bg._centerX).toBe(0)
    expect(bg._centerY).toBe(0)
    expect(bg.scaleX).toBe(1)
    expect(bg.scaleY).toBe(1)
    expect(bg.meta.anchor).toEqual({ kind: 'region', xNorm: 0.5, yNorm: 0.5 })
  })

  it('(c) cover 객체: 출력 origin 이 new layout 기준 → content 드리프트 0', () => {
    const oldLayout = computeLayout(baseSpec)
    const newLayout = computeLayout({ ...baseSpec, spineWidthMm: 20 })
    const oldFront = oldLayout.regions.find((r) => r.position === 'front-cover')!
    const newFront = newLayout.regions.find((r) => r.position === 'front-cover')!
    const oldBack = oldLayout.regions.find((r) => r.position === 'back-cover')!
    const H = oldLayout.totalHeightPx

    const mkCoverObj = (regionRef: string, region: { x: number; width: number }) => {
      const contentCx = region.x + 0.5 * region.width
      const scene = toScene(contentCx, 0.5 * H, oldLayout)
      return makeObj({
        type: 'rect',
        centerX: scene.x,
        centerY: scene.y,
        width: 120,
        height: 120,
        meta: {
          regionRef,
          anchor: { kind: 'region', xNorm: 0.5, yNorm: 0.5 },
        },
      })
    }
    const frontObj = mkCoverObj('front-cover', oldFront)
    const backObj = mkCoverObj('back-cover', oldBack)

    const plugin = makePlugin([frontObj, backObj], oldLayout, baseSpec)
    plugin.repositionObjects(oldLayout, newLayout)

    const newOrigin = contentOrigin(newLayout)
    const oldOrigin = contentOrigin(oldLayout)

    // content 프레임에서의 위치 보존 = drift 0 (주석 "drift 0" 의도가 정본)
    // front-cover: 새 region.x(책등 확장만큼 우측 이동) + xNorm 0.5
    const frontContentX = frontObj._centerX - newOrigin.x
    expect(frontContentX).toBeCloseTo(newFront.x + 0.5 * newFront.width, 3)

    // back-cover: region.x 불변 → content x 완전 보존
    const backContentX = backObj._centerX - newOrigin.x
    expect(backContentX).toBeCloseTo(oldBack.x + 0.5 * oldBack.width, 3)

    // 회귀 고정: stale(old) origin 으로 출력하면 전 객체가 Δtotal/2 (= Δspine/2) 만큼
    // 오른쪽으로 드리프트했다 — new origin 과 old origin 의 차가 곧 그 드리프트 양.
    const staleDrift = oldOrigin.x - newOrigin.x
    expect(staleDrift).toBeCloseTo((newLayout.totalWidthPx - oldLayout.totalWidthPx) / 2, 3)
    expect(staleDrift).toBeGreaterThan(1) // 드리프트 실재 입증(가드 의미 확인)
    // 만약 stale origin 버그가 재발하면 frontContentX 가 위 기대값에서 staleDrift 만큼 어긋난다
  })

  it('(a-보강) anchor 없는 spine 객체: 현행 전략 위치(영역 중앙) 폴백 유지', () => {
    const oldLayout = computeLayout(baseSpec)
    const newLayout = computeLayout({ ...baseSpec, spineWidthMm: 20 })
    const oldSpine = oldLayout.regions.find((r) => r.position === 'spine')!
    const newSpine = newLayout.regions.find((r) => r.position === 'spine')!
    const H = oldLayout.totalHeightPx

    const scene = toScene(oldSpine.x + 0.5 * oldSpine.width, 0.3 * H, oldLayout)
    const legacy = makeObj({
      type: 'textbox',
      centerX: scene.x,
      centerY: scene.y,
      width: 40,
      height: 120,
      meta: { regionRef: 'spine' }, // anchor 없음(레거시 데이터)
    })

    const plugin = makePlugin([legacy], oldLayout, baseSpec)
    plugin.repositionObjects(oldLayout, newLayout)

    // 폴백: 새 spine 영역 중앙 (new origin 기준 scene)
    const newOrigin = contentOrigin(newLayout)
    expect(legacy._centerX).toBeCloseTo(newSpine.x + 0.5 * newSpine.width + newOrigin.x, 3)
    expect(legacy._centerY).toBeCloseTo(0.5 * newSpine.height + newOrigin.y, 3)
  })
})
