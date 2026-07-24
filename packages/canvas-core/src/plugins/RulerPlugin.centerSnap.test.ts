// RulerPlugin 중앙 스냅 토글 게이트 (C9/E2 W4 §6-3, 적대 리뷰 #6 가드)
//
// 생성자(CanvasRuler init)가 무거워 Object.create 로 프로토타입 인스턴스만 만들어
// handleObjectMoving(private) 를 직접 호출한다.
//  ① centerSnap ON(기본): 중앙 근처 객체가 중앙으로 스냅 + 중앙 가이드 표시
//  ② setCenterSnapEnabled(false): 스냅·가이드 표시 모두 스킵(오펀 가이드 방지 = 데드존 커플링의 룰러측)
import { describe, it, expect, vi } from 'vitest'

vi.mock('fabric', () => ({
  fabric: {
    Point: class {
      x: number
      y: number
      constructor(x: number, y: number) {
        this.x = x
        this.y = y
      }
    },
  },
}))
vi.mock('../ruler/ruler', () => ({ default: class {} }))
vi.mock('../ruler/guideline', () => ({ setupGuideLine: vi.fn() }))
vi.mock('../ruler/constants', () => ({ getRulerDefaults: () => ({}) }))

import RulerPlugin from './RulerPlugin'

function makeGuideline() {
  return { visible: false, set(k: string, v: unknown) { if (k === 'visible') this.visible = v as boolean }, bringToFront: vi.fn() }
}
function makeObj(init: Record<string, unknown>) {
  const o: Record<string, unknown> = {
    ...init,
    getCenterPoint: () => ({ x: o.left as number, y: o.top as number }),
    setPositionByOrigin(p: { x: number; y: number }) {
      o.left = p.x
      o.top = p.y
    },
    setCoords: vi.fn(),
  }
  return o
}

function setup(centerSnapEnabled: boolean) {
  // 워크스페이스 중앙 = (500,500)
  const workspace = makeObj({ id: 'workspace', left: 500, top: 500, width: 1000, height: 1000, scaleX: 1, scaleY: 1 })
  workspace.getCenterPoint = () => ({ x: 500, y: 500 })
  const objects = [workspace]
  const canvas = { getObjects: () => objects, requestRenderAll: vi.fn(), remove: vi.fn() }
  const plugin = Object.create(RulerPlugin.prototype) as Record<string, unknown> & {
    handleObjectMoving: (e: unknown) => void
    setCenterSnapEnabled: (v: boolean) => void
  }
  plugin._canvas = canvas
  plugin.isDragging = false
  plugin._centerSnapEnabled = true
  plugin.centerGuidelineH = makeGuideline()
  plugin.centerGuidelineV = makeGuideline()
  plugin.setCenterSnapEnabled(centerSnapEnabled)
  return { plugin, canvas, objects }
}

describe('RulerPlugin — 중앙 스냅 게이트', () => {
  it('① 기본(ON): 중앙 3px 근처 객체가 중앙(500,500)으로 스냅 + 가이드 표시', () => {
    const { plugin } = setup(true)
    const obj = makeObj({ id: 'o1', left: 503, top: 502 }) // 중앙 8px 내
    ;(plugin as unknown as { handleObjectMoving: (e: unknown) => void }).handleObjectMoving({ target: obj })

    expect(obj.left).toBe(500) // x 스냅
    expect(obj.top).toBe(500) // y 스냅
    expect((plugin.centerGuidelineH as { visible: boolean }).visible).toBe(true)
    expect((plugin.centerGuidelineV as { visible: boolean }).visible).toBe(true)
  })

  it('② setCenterSnapEnabled(false): 스냅·가이드 표시 모두 스킵(오펀 가이드 없음)', () => {
    const { plugin } = setup(false)
    const obj = makeObj({ id: 'o1', left: 503, top: 502 })
    ;(plugin as unknown as { handleObjectMoving: (e: unknown) => void }).handleObjectMoving({ target: obj })

    expect(obj.left).toBe(503) // 스냅 없음
    expect(obj.top).toBe(502)
    expect((plugin.centerGuidelineH as { visible: boolean }).visible).toBe(false)
    expect((plugin.centerGuidelineV as { visible: boolean }).visible).toBe(false)
  })
})
