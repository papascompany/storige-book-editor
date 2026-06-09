// SpreadPlugin 의 scene↔content 좌표 브리지 규약 검증.
//
// 배경(버그): SpreadLayoutEngine 은 content 좌표(0..totalWidthPx)로 계산하나, Fabric workspace 는
// 중앙원점(scene). SpreadPlugin 이 객체 좌표를 변환 없이(또는 viewport 좌표로) 엔진에 넘겨
// 영역 오판정/오배치가 발생했다. 수정: 입력은 scene→content(-origin), 출력은 content→scene(+origin).
//
// 이 테스트는 그 변환 로직(SpreadPlugin.getContentBoundingRect / repositionObjects 출력 변환)을
// 엔진과 함께 검증한다. (fabric getBoundingRect(true,true)=scene 은 fabric 계약이므로 여기선
// scene BR 을 입력으로 시뮬레이션.)
import { describe, it, expect } from 'vitest'
import { computeLayout, resolveRegionRef, computeObjectReposition } from './SpreadLayoutEngine'
import type { SpreadSpec, SpreadLayout } from '@storige/types'

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

// SpreadPlugin.getContentBoundingRect 와 동일: scene BR → content BR
const sceneToContent = (
  br: { left: number; top: number; width: number; height: number },
  origin: { x: number; y: number }
) => ({ left: br.left - origin.x, top: br.top - origin.y, width: br.width, height: br.height })

// 주어진 content 중심에 있는 w×h 객체의 scene 바운딩박스(fabric getBoundingRect(true,true) 모사)
const sceneBRAtContentCenter = (
  cx: number,
  cy: number,
  w: number,
  h: number,
  origin: { x: number; y: number }
) => ({ left: cx + origin.x - w / 2, top: cy + origin.y - h / 2, width: w, height: h })

describe('SpreadPlugin scene↔content 좌표 브리지', () => {
  it('scene→content(-origin) 변환을 해야 올바른 region 으로 판정된다 (미변환 시 오판정)', () => {
    const layout = computeLayout(baseSpec)
    const origin = contentOrigin(layout)
    const front = layout.regions.find((r) => r.position === 'front-cover')!

    // 앞표지 정중앙에 놓인 객체의 scene 바운딩박스
    const cx = front.x + front.width / 2
    const cy = layout.totalHeightPx / 2
    const sceneBR = sceneBRAtContentCenter(cx, cy, 120, 120, origin)

    // ✅ 수정 경로: scene→content 후 판정 → front-cover
    const fixed = resolveRegionRef(layout.regions, sceneToContent(sceneBR, origin), null)
    expect(fixed.regionRef).toBe('front-cover')

    // ❌ 버그 경로: scene 좌표를 그대로(변환 없이) 판정 → front-cover 아님(뒤표지/null)
    const buggy = resolveRegionRef(layout.regions, sceneBR, null)
    expect(buggy.regionRef).not.toBe('front-cover')
  })

  it('뒤표지 객체도 동일 — 변환 후에만 back-cover 로 정확히 판정', () => {
    const layout = computeLayout(baseSpec)
    const origin = contentOrigin(layout)
    const back = layout.regions.find((r) => r.position === 'back-cover')!
    const sceneBR = sceneBRAtContentCenter(
      back.x + back.width / 2,
      layout.totalHeightPx / 2,
      120,
      120,
      origin
    )
    expect(resolveRegionRef(layout.regions, sceneToContent(sceneBR, origin), null).regionRef).toBe('back-cover')
  })

  it('엔진 출력(content)에 +origin 하면 책등 리사이즈 후 올바른 scene 위치로 이동한다', () => {
    const oldLayout = computeLayout(baseSpec)
    const oldOrigin = contentOrigin(oldLayout)
    const oldFront = oldLayout.regions.find((r) => r.position === 'front-cover')!

    const sceneBR = sceneBRAtContentCenter(
      oldFront.x + oldFront.width / 2,
      oldLayout.totalHeightPx / 2,
      120,
      120,
      oldOrigin
    )
    const contentBR = sceneToContent(sceneBR, oldOrigin)
    const reg = resolveRegionRef(oldLayout.regions, contentBR, null)
    expect(reg.regionRef).toBe('front-cover')

    // 책등 10 → 20mm (총폭 +10mm)
    const newLayout = computeLayout({ ...baseSpec, spineWidthMm: 20 })
    const newOrigin = contentOrigin(newLayout)
    const result = computeObjectReposition(
      { regionRef: 'front-cover', anchor: reg.anchor },
      contentBR,
      oldLayout,
      newLayout
    )

    // content → scene (+origin)
    const sceneX = result.x + newOrigin.x

    // 새 앞표지 영역(scene) 안에 있어야 한다
    const newFront = newLayout.regions.find((r) => r.position === 'front-cover')!
    const frontSceneLeft = newFront.x + newOrigin.x
    const frontSceneRight = newFront.x + newFront.width + newOrigin.x
    expect(sceneX).toBeGreaterThanOrEqual(frontSceneLeft)
    expect(sceneX).toBeLessThanOrEqual(frontSceneRight)

    // 책등이 넓어졌으므로 앞표지(우측)는 scene 상 오른쪽으로 이동
    const oldFrontSceneCx = oldFront.x + oldFront.width / 2 + oldOrigin.x
    expect(sceneX).toBeGreaterThan(oldFrontSceneCx)

    // +origin 누락(버그) 시: result.x(content, ~1978) 를 scene 으로 그대로 쓰면 캔버스(±half) 밖
    expect(result.x).toBeGreaterThan(frontSceneRight) // content 값은 scene 범위를 벗어남(변환 필수 입증)
  })

  it('[무결성 IB-1] 책등 리사이즈 후 back-cover 객체의 content 위치가 보존된다(drift 0)', () => {
    const oldLayout = computeLayout(baseSpec) // 책등 10mm
    const oldOrigin = contentOrigin(oldLayout)
    const back = oldLayout.regions.find((r) => r.position === 'back-cover')!
    const contentCx = back.x + back.width / 2
    const sceneBR = sceneBRAtContentCenter(contentCx, oldLayout.totalHeightPx / 2, 120, 120, oldOrigin)
    const contentBR = sceneToContent(sceneBR, oldOrigin)
    const reg = resolveRegionRef(oldLayout.regions, contentBR, null)
    expect(reg.regionRef).toBe('back-cover')

    // 책등 10 → 20mm (총폭 +10mm → origin 좌측 이동)
    const newLayout = computeLayout({ ...baseSpec, spineWidthMm: 20 })
    const newOrigin = contentOrigin(newLayout)

    // ✅ 수정(IB-1): back-cover 도 computeObjectReposition 재배치 → content x 보존(영역 불변이므로)
    const result = computeObjectReposition(
      { regionRef: 'back-cover', anchor: reg.anchor },
      contentBR,
      oldLayout,
      newLayout
    )
    expect(Math.abs(result.x - contentCx)).toBeLessThan(1) // content 위치 보존 = drift 0

    // ❌ 버그(no-op): scene 고정 → content 가 책등 쪽으로 drift = ΔtotalWidthPx/2(= Δspine/2)
    const noopContentX = contentCx + oldOrigin.x - newOrigin.x // scene 고정값을 새 origin 으로 content 환산
    const driftPx = noopContentX - contentCx
    const expectedDrift = (newLayout.totalWidthPx - oldLayout.totalWidthPx) / 2
    expect(driftPx).toBeGreaterThan(1) // drift 실재 입증
    expect(Math.abs(driftPx - expectedDrift)).toBeLessThan(0.5) // 불변식 drift == Δspine/2
  })
})
