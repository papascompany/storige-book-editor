// SpreadPlugin — meta(regionRef/anchor) 오염 방어 회귀 테스트 (라이브 P1, 2026-06-11/12 실측).
//
// 사고 재구성 (flat-spine 430mm/spine 10mm 표지, 실측 수치):
//  - textbox 'idml-u715': scene 중심 x=+365.37 (content 1635.06) → 명백한 front-cover,
//    정상 anchor xNorm 0.2708.
//  - 편집기 측 훅(useSpreadAutoAnchor/MoveToCoverRegion)이 `getBoundingRect()`(무인자 =
//    viewport 좌표, 줌·팬 의존)를 resolveRegionRef 에 그대로 전달 → fit-zoom(≈0.49)에서
//    viewport 중심 ≈ 0.49×365.4+622.6 ≈ 801.9 가 content 로 오해석 → back-cover 로 오판,
//    meta = { regionRef:'back-cover', primaryRegionHint:'back-cover', xNorm 801.9/1240.16=0.6466 }.
//    (플러그인 내부 호출부는 getBoundingRect(true,true) 로 정합했으나 편집기 훅에 동일 결함이 잔존했다.)
//  - 이후 resizeSpine → repositionObjects 가 오염 meta 를 무비판 신뢰 → 객체를
//    back-cover anchor 위치(scene −467.8)로 텔레포트 (front 객체가 뒤표지로 점프).
//
// 본 테스트가 고정하는 방어선:
//  (A) repositionObjects 자가치유 — claimed region 과 실측 bbox 가 전혀 겹치지 않으면
//      meta 를 실측(content bbox)으로 재유도 후 재배치 (점프 차단 + meta 자가복구).
//  (B) 자가치유는 보수적 — 부분 겹침(overlap>0)인 정상 객체는 기존 동작 그대로.
//  (C) resolveRegionMetaForObject 공개 API — scene→content 변환을 플러그인이 캡슐화.
//      편집기 훅은 raw getBoundingRect() 대신 반드시 이 API 를 사용한다.
//
// fabric 은 node 테스트 환경에서 native canvas 바인딩을 요구해 로드 불가 → 최소 mock.
// (SpreadPlugin.reposition.test.ts 와 동일 스타일.)
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

vi.mock('../Editor', () => ({ default: class MockEditor {} }))

import SpreadPlugin from './SpreadPlugin'

// ============================================================================
// Helpers (reposition.test.ts 와 동일 규약)
// ============================================================================

// 실측 스펙: 총폭 430mm = 210+10+210, 캔버스 2539.37×1753.94px @150dpi
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

function makeObj(opts: {
  type?: string
  meta?: any
  centerX: number
  centerY: number
  width: number
  height: number
}): any {
  return {
    type: opts.type ?? 'textbox',
    meta: opts.meta ?? {},
    scaleX: 1,
    scaleY: 1,
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

function makePlugin(objects: any[], layout: SpreadLayout, spec: SpreadSpec): any {
  const canvas: any = { getObjects: () => objects }
  const editor: any = {}
  const plugin: any = new (SpreadPlugin as any)(canvas, editor, { spec })
  plugin.currentLayout = layout
  return plugin
}

const toScene = (cx: number, cy: number, layout: SpreadLayout) => ({
  x: cx + contentOrigin(layout).x,
  y: cy + contentOrigin(layout).y,
})

/** 라이브 사고의 u715 형상: front-cover 정중앙 부근(content 1635.06), 400×80 textbox */
function makeU715Like(layout: SpreadLayout, meta: any): any {
  const front = layout.regions.find((r) => r.position === 'front-cover')!
  const contentCx = front.x + 0.27082 * front.width // = 1635.06 (scene +365.37)
  const contentCy = 143.47 // scene top ≈ -733.5 (실측 top 불변 검증용)
  const scene = toScene(contentCx, contentCy, layout)
  return makeObj({
    type: 'textbox',
    centerX: scene.x,
    centerY: scene.y,
    width: 400,
    height: 80,
    meta,
  })
}

// ============================================================================
// (A) 오염 meta 자가치유 — 점프 차단
// ============================================================================

describe('SpreadPlugin.repositionObjects — 오염 meta(regionRef/anchor) 자가치유', () => {
  it('[P1 재현] front 객체에 back-cover/xNorm0.6466 오염 meta: 책등가변 시 뒤표지로 점프하지 않고 front-cover 로 자가치유 재배치', () => {
    const oldLayout = computeLayout(baseSpec) // 10mm
    const newLayout = computeLayout({ ...baseSpec, spineWidthMm: 20 })

    // 라이브 실측 오염값: viewport bbox(zoom≈0.49) 재앵커 산물
    const obj = makeU715Like(oldLayout, {
      regionRef: 'back-cover',
      primaryRegionHint: 'back-cover',
      anchor: { kind: 'region', xNorm: 0.6466, yNorm: 0.0818 },
    })
    const origCenterContent = obj._centerX - contentOrigin(oldLayout).x // 1635.06

    const plugin = makePlugin([obj], oldLayout, baseSpec)
    plugin.repositionObjects(oldLayout, newLayout)

    const newOrigin = contentOrigin(newLayout)
    const newFront = newLayout.regions.find((r) => r.position === 'front-cover')!
    const newBack = newLayout.regions.find((r) => r.position === 'back-cover')!

    // ❌ 버그 시: back-cover anchor 적용 → content 0.6466×1240.16=801.89 (scene −497.3) 점프
    const buggyJumpX = newBack.x + 0.6466 * newBack.width + newOrigin.x
    expect(Math.abs(obj._centerX - buggyJumpX)).toBeGreaterThan(100)

    // ✅ 자가치유: 실측 bbox(front-cover 100% 내부) 로 재유도 → front-cover 정상 재배치
    expect(obj.meta.regionRef).toBe('front-cover')
    expect(obj.meta.primaryRegionHint).toBe('front-cover')
    expect(obj.meta.anchor.kind).toBe('region')
    expect(obj.meta.anchor.xNorm).toBeCloseTo(0.27082, 3)
    const expectedX = newFront.x + 0.27082 * newFront.width + newOrigin.x
    expect(obj._centerX).toBeCloseTo(expectedX, 1)

    // content 프레임 보존 검증: front 영역 내 상대위치(xNorm) 불변
    const healedXNorm = (obj._centerX - newOrigin.x - newFront.x) / newFront.width
    expect(healedXNorm).toBeCloseTo((origCenterContent - 1299.213) / 1240.157, 3)
  })

  it('[P1 재현-왕복] 오염 meta 라도 10→20→10 왕복 후 원좌표 완전 복귀 (점프 0)', () => {
    const layout10 = computeLayout(baseSpec)
    const layout20 = computeLayout({ ...baseSpec, spineWidthMm: 20 })

    const obj = makeU715Like(layout10, {
      regionRef: 'back-cover',
      primaryRegionHint: 'back-cover',
      anchor: { kind: 'region', xNorm: 0.6466, yNorm: 0.0818 },
    })
    const origX = obj._centerX // scene +365.37
    const origY = obj._centerY

    const plugin = makePlugin([obj], layout10, baseSpec)
    plugin.repositionObjects(layout10, layout20)
    plugin.currentLayout = layout20 // resizeSpine 6단계 모사
    plugin.repositionObjects(layout20, layout10)

    // 라이브 사고에서는 scene −467.8 로 점프했다 — 왕복 복귀를 고정
    expect(obj._centerX).toBeCloseTo(origX, 1)
    expect(obj._centerY).toBeCloseTo(origY, 1)
    expect(obj.meta.regionRef).toBe('front-cover')
  })

  it('claimed region 과 무교차 + 어느 영역에도 90% 미만(두 표지 걸침): 자유 객체로 치유 + 위치 보존(무이동)', () => {
    const oldLayout = computeLayout(baseSpec)
    const newLayout = computeLayout({ ...baseSpec, spineWidthMm: 20 })

    // 책등을 가운데 두고 앞/뒤표지에 걸친 넓은 객체 — 그러나 meta 는 (오염으로) front-wing 주장
    // front-wing 은 wingEnabled=false 라 존재하지 않음 → 무교차/없는 영역 동일 처리
    const scene = toScene(1269.685, 800, oldLayout) // 콘텐츠 정중앙(책등 위)
    const obj = makeObj({
      type: 'image',
      centerX: scene.x,
      centerY: scene.y,
      width: 600,
      height: 200,
      meta: {
        regionRef: 'front-wing',
        anchor: { kind: 'region', xNorm: 0.5, yNorm: 0.5 },
      },
    })
    const origX = obj._centerX
    const origY = obj._centerY

    const plugin = makePlugin([obj], oldLayout, baseSpec)
    plugin.repositionObjects(oldLayout, newLayout)

    // 어느 영역에도 promote(≥0.9) 불가 → regionRef null(자유) 치유, 절대좌표 보존
    expect(obj.meta.regionRef).toBeNull()
    expect(obj._centerX).toBe(origX)
    expect(obj._centerY).toBe(origY)
  })

  it('[보수성] 부분 겹침(overlap>0)인 정상 객체는 자가치유 미발동 — 기존 anchor 그대로 재배치', () => {
    const oldLayout = computeLayout(baseSpec)
    const newLayout = computeLayout({ ...baseSpec, spineWidthMm: 20 })
    const oldFront = oldLayout.regions.find((r) => r.position === 'front-cover')!
    const newFront = newLayout.regions.find((r) => r.position === 'front-cover')!

    // 책등/앞표지 경계에 걸친 front-cover 객체 (앞표지와 일부만 겹침 — 정상 데이터)
    const contentCx = oldFront.x + 10 // 경계 바로 안쪽 중심, w=100 → 좌측 40px 책등 침범
    const scene = toScene(contentCx, 800, oldLayout)
    const obj = makeObj({
      type: 'image',
      centerX: scene.x,
      centerY: scene.y,
      width: 100,
      height: 100,
      meta: {
        regionRef: 'front-cover',
        anchor: { kind: 'region', xNorm: 0.123, yNorm: 0.456 },
      },
    })

    const plugin = makePlugin([obj], oldLayout, baseSpec)
    plugin.repositionObjects(oldLayout, newLayout)

    // 치유 없이 기존 anchor(xNorm 0.123) 로 재배치 (기존 동작 보존)
    const newOrigin = contentOrigin(newLayout)
    expect(obj.meta.regionRef).toBe('front-cover')
    expect(obj.meta.anchor.xNorm).toBeCloseTo(0.123, 6)
    expect(obj._centerX).toBeCloseTo(newFront.x + 0.123 * newFront.width + newOrigin.x, 3)
  })
})

// ============================================================================
// (C) resolveRegionMetaForObject — 편집기 훅용 공개 API (scene→content 캡슐화)
// ============================================================================

describe('SpreadPlugin.resolveRegionMetaForObject — scene bbox 기반 영역 판정 API', () => {
  it('front-cover scene 객체: viewport 줌과 무관하게 front-cover + 정확한 xNorm 반환', () => {
    const layout = computeLayout(baseSpec)
    const obj = makeU715Like(layout, { regionRef: 'front-cover' })
    const plugin = makePlugin([obj], layout, baseSpec)

    const result = plugin.resolveRegionMetaForObject(obj, null)
    expect(result).not.toBeNull()
    expect(result.regionRef).toBe('front-cover')
    expect(result.primaryRegionHint).toBe('front-cover')
    expect(result.anchor.kind).toBe('region')
    expect(result.anchor.xNorm).toBeCloseTo(0.27082, 3)

    // 라이브 사고 회귀 고정: viewport bbox(zoom 0.49 fit) 를 쓰면 back-cover 로 오판했다.
    // (편집기 훅이 raw getBoundingRect() 를 쓰던 결함 — 이 API 는 scene bbox 만 사용.)
    expect(result.regionRef).not.toBe('back-cover')
  })

  it('currentRegionRef 히스테리시스 전달 + currentLayout 없으면 null', () => {
    const layout = computeLayout(baseSpec)
    const front = layout.regions.find((r) => r.position === 'front-cover')!

    // 앞표지와 75% 겹침(0.7≤r<0.9) — current='front-cover' 면 유지, null 이면 승격 불가
    const w = 200
    const contentCx = front.x + w / 2 - w * 0.25 // 좌측 25% 책등 쪽 이탈
    const scene = toScene(contentCx, 800, layout)
    const obj = makeObj({ centerX: scene.x, centerY: scene.y, width: w, height: 100 })

    const plugin = makePlugin([obj], layout, baseSpec)
    expect(plugin.resolveRegionMetaForObject(obj, 'front-cover').regionRef).toBe('front-cover')
    expect(plugin.resolveRegionMetaForObject(obj, null).regionRef).toBeNull()

    plugin.currentLayout = null
    expect(plugin.resolveRegionMetaForObject(obj, null)).toBeNull()
  })
})
