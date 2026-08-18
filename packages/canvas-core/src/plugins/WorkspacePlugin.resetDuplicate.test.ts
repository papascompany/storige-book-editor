// WorkspacePlugin reset() workspace rect 이중화 회귀 테스트
//
// 검증 대상 (2026-08-18 표지 flat-spread 결함):
//  - embed 가 createCanvas({}) 기본 사이즈(정사각) workspace rect 를 만든 뒤 빈 템플릿이라
//    initWorkspace()→reset() 만 타는데, reset() 의 제거 루프가 id==='workspace' 를 보존해
//    옛 rect 가 잔존 → _getWorkspace()(first-match) 가 옛 정사각 rect 를 반환해
//    setZoomAuto 과확대·썸네일 정사각 크롭 결함.
//  - 수정 후: 인자 없이 새 rect 를 생성하는 경로는 기존 workspace rect 까지 전부 제거해
//    reset 후 workspace rect 가 정확히 1개(새 크기)여야 한다.
//  - 인자로 workspace 를 받은 경로(loadJSON 복원 채택 rect)는 기존 동작 보존 —
//    canvas 에 남아 있는 id==='workspace' 객체를 제거하지 않는다.
import { describe, it, expect, vi } from 'vitest'

// fabric 은 node 테스트 환경에서 native canvas 바인딩을 요구해 로드 불가 → mock
// (AccessoryPlugin.leak.test.ts 와 동일 패턴, reset 경로에 필요한 생성자만 제공)
vi.mock('fabric', () => {
  class MockRect {
    [key: string]: unknown
    constructor(opts: Record<string, unknown>) {
      Object.assign(this, opts)
    }
    set(opts: Record<string, unknown>) {
      Object.assign(this, opts)
      return this
    }
    setCoords() {}
    getCenterPoint() {
      return { x: 0, y: 0 }
    }
    bringToFront() {}
  }
  class MockPath {
    [key: string]: unknown
    constructor(_path: unknown, opts: Record<string, unknown>) {
      Object.assign(this, opts)
    }
    bringToFront() {}
  }
  class MockLine {
    [key: string]: unknown
    constructor(_points: number[], opts: Record<string, unknown>) {
      Object.assign(this, opts)
    }
  }
  class MockGroup {
    [key: string]: unknown
    constructor(_objects: unknown[], opts: Record<string, unknown>) {
      Object.assign(this, opts)
    }
    bringToFront() {}
  }
  return { fabric: { Rect: MockRect, Path: MockPath, Line: MockLine, Group: MockGroup } }
})

// utils/svg 는 top-level 에서 실제 fabric/d3 를 import → mock 으로 차단
vi.mock('../utils/svg', () => ({
  extractSvgElementsAsObjects: vi.fn().mockResolvedValue([]),
  convertFabricObjectToSVGString: vi.fn().mockReturnValue('')
}))
vi.mock('../utils/history', () => ({
  connectWorkspacePlugin: vi.fn()
}))

import WorkspacePlugin from './WorkspacePlugin'
import { mmToPxDisplay } from '../utils/math'

/** fabric.Canvas 의 reset() 경로에 필요한 최소 표면 mock (getObjects 는 fabric 5 처럼 사본 반환) */
function makeMockCanvas() {
  const objects: any[] = []
  return {
    _objects: objects,
    clipPath: null as unknown,
    getContext: () => ({}),
    getObjects: () => objects.concat(),
    add(...objs: any[]) {
      objects.push(...objs)
    },
    remove(...objs: any[]) {
      for (const obj of objs) {
        const idx = objects.indexOf(obj)
        if (idx >= 0) objects.splice(idx, 1)
      }
    },
    discardActiveObject: vi.fn(),
    clearHistory: vi.fn(),
    renderAll: vi.fn(),
    requestRenderAll: vi.fn(),
    forEachObject(cb: (obj: any) => void) {
      objects.concat().forEach(cb)
    },
    on: vi.fn(),
    off: vi.fn()
  }
}

function makeEditor(): any {
  return { emit: vi.fn(), on: vi.fn(), off: vi.fn() }
}

// 표지 flat-spread 시나리오: 재단 포함 496×276mm, cutSize 6(양측 3mm)
const COVER_OPTIONS = {
  size: { width: 490, height: 270, cutSize: 6 },
  unit: 'mm' as const,
  showCutBorder: false,
  showSafeBorder: false
}

function setupPlugin(canvas: any, options: Record<string, unknown> = COVER_OPTIONS) {
  return new (WorkspacePlugin as any)(canvas, makeEditor(), { ...options, size: { ...(options as any).size } })
}

describe('WorkspacePlugin — reset() workspace rect 이중화 회귀', () => {
  it('인자 없는 reset() 은 기존 workspace rect 를 제거하고 새 rect 정확히 1개만 남긴다', () => {
    const canvas = makeMockCanvas()
    // createCanvas({}) 가 만든 기본(정사각) workspace rect 잔존 상황 재현
    const staleWorkspace: any = { id: 'workspace', width: 100, height: 100 }
    const userObject: any = { id: 'obj-1' }
    canvas.add(staleWorkspace, userObject)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const plugin = setupPlugin(canvas)
    ;(plugin as any).reset()
    consoleSpy.mockRestore()
    errorSpy.mockRestore()

    const workspaces = canvas.getObjects().filter((obj: any) => obj.id === 'workspace')
    expect(workspaces).toHaveLength(1)
    // 남은 rect 는 옛 정사각이 아니라 새 크기(496×276mm 상당)여야 한다
    expect(workspaces[0]).not.toBe(staleWorkspace)
    expect(workspaces[0].width).toBeCloseTo(mmToPxDisplay(496), 5)
    expect(workspaces[0].height).toBeCloseTo(mmToPxDisplay(276), 5)
    // _getWorkspace()(first-match) 도 새 rect 를 반환
    expect((plugin as any)._getWorkspace()).toBe(workspaces[0])
    // 다른 일반 객체는 기존대로 제거된다
    expect(canvas.getObjects().find((obj: any) => obj.id === 'obj-1')).toBeUndefined()
  })

  it('인자로 workspace 를 받은 경로는 canvas 의 기존 workspace rect 를 제거하지 않는다 (기존 동작 보존)', () => {
    const canvas = makeMockCanvas()
    // loadJSON 복원이 채택한 rect 가 이미 canvas 에 있는 상황
    const restoredWorkspace: any = {
      id: 'workspace',
      width: 200,
      height: 300,
      set: vi.fn(),
      setCoords: vi.fn(),
      getCenterPoint: () => ({ x: 0, y: 0 })
    }
    canvas.add(restoredWorkspace)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const plugin = setupPlugin(canvas)
    ;(plugin as any).reset(restoredWorkspace)
    consoleSpy.mockRestore()
    errorSpy.mockRestore()

    // 기존 rect 는 제거 루프에서 보존된다 (reset 말미의 add 까지 포함해 참조 자체가 유지)
    expect(canvas.getObjects()).toContain(restoredWorkspace)
    expect((plugin as any).workspace).toBe(restoredWorkspace)
  })
})
