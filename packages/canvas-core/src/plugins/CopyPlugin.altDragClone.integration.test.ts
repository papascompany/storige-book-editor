// CopyPlugin — Alt+드래그 다중 복제 통합 테스트 (C5 / E2 W2, 실 fabric)
//
// 목적: mock 하네스(CopyPlugin.altDragClone.test.ts)가 흉내내는 "이중 clone → set(start)
// → destroy() → 멤버 절대좌표 실체화" 를 **실 fabric 5.5.2 로 확증**한다. mock 은 destroy 의
// 그룹행렬 baking 을 시뮬할 뿐이므로, 실제로 각 멤버 사본이 멤버 시작 절대좌표에 land 하는지는
// 실 객체로만 증명된다(설계 §4-4 (c) — 순수 기하, 렌더 회피).
//
// 환경: 기본 node env. fabric 5.5.2 는 node-canvas(canvas@2.11.2, fabric peer)로 StaticCanvas 를
// 헤드리스 구동하므로 jsdom 불필요(LockPlugin/HistoryPlugin 등 실-fabric 유닛과 동일 관행).
// fabric 은 mock 하지 않는다. DOM 의존 전이 import(hotkeys-js·contextMenu)만 최소 mock —
// PluginBase 생성자는 canvas/editor/options 저장뿐이라(plugin.ts) 이들은 테스트 대상 아님.
// 상호작용 전용 접근자(getActiveObject/getActiveObjects)와 히스토리 훅(offHistory/onHistory,
// 평소 HistoryPlugin 이 주입)만 StaticCanvas 에 스텁 — 복제 기하(clone/destroy/insertAt)는 전부 실경로.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fabric } from 'fabric'

// DOM 의존 전이 import 만 차단(fabric 은 실물 유지)
const { hotkeysMock } = vi.hoisted(() => {
  const fn: unknown = vi.fn()
  ;(fn as { unbind: unknown }).unbind = vi.fn()
  return { hotkeysMock: fn }
})
vi.mock('hotkeys-js', () => ({ default: hotkeysMock }))
vi.mock('../contextMenu', () => ({
  default: class MockContextMenu {
    addMenu = vi.fn()
    dispose = vi.fn()
  },
}))

import CopyPlugin from './CopyPlugin'

beforeEach(() => {
  // node env: CopyPlugin 생성자의 initPaste() window.addEventListener 스텁.
  // (fabric 은 import 시점에 node-canvas 참조를 캡처하므로 이 스텁의 영향을 받지 않는다.)
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

type AnyCanvas = fabric.StaticCanvas & {
  getActiveObject: () => unknown
  getActiveObjects: () => unknown[]
  offHistory: () => void
  onHistory: () => void
}

describe('CopyPlugin Alt+드래그 다중 복제 — 실 fabric 통합', () => {
  it('실 ActiveSelection 이동 → 각 멤버 사본이 멤버 시작 절대좌표·대응 원본 직하에 삽입된다', () => {
    const canvas = new fabric.StaticCanvas(null, {
      width: 400,
      height: 400,
      renderOnAddRemove: false,
    }) as AnyCanvas
    // 렌더 회피(순수 기하만) — 컨텍스트 렌더링 타이밍 배제
    canvas.requestRenderAll = () => canvas as unknown as fabric.StaticCanvas

    // 실 객체 2개. strokeWidth 0 으로 bbox 결정성 확보.
    const a = new fabric.Rect({ left: 50, top: 50, width: 20, height: 20, strokeWidth: 0 })
    const b = new fabric.Rect({ left: 150, top: 100, width: 20, height: 20, strokeWidth: 0 })
    canvas.add(a, b)
    // 그룹화 전 절대좌표 캡처(= destroy 후 사본이 land 해야 할 위치)
    const aStart = { left: a.left as number, top: a.top as number } // (50,50)
    const bStart = { left: b.left as number, top: b.top as number } // (150,100)

    // 실 ActiveSelection 형성(에디터 다중 선택과 동형). 멤버 left/top 은 이제 그룹-상대.
    const sel = new fabric.ActiveSelection([a, b], { canvas })
    sel.setCoords()
    const startLeft = sel.left as number
    const startTop = sel.top as number

    // 상호작용 접근자 + 히스토리 훅 스텁(기하가 아니라 배선 — 테스트 대상 아님)
    let off = 0
    let on = 0
    canvas.getActiveObject = () => sel
    canvas.getActiveObjects = () => [a, b]
    canvas.offHistory = () => {
      off++
    }
    canvas.onHistory = () => {
      on++
    }

    // 실 CopyPlugin 부착(alt-드래그 리스너 등록)
    const plugin = new (CopyPlugin as unknown as new (
      c: unknown,
      e: unknown,
      o: unknown
    ) => { dispose: () => void })(canvas, {}, { altDragClone: true })

    // mouse:down (alt) — 시작 위치 스냅샷
    canvas.fire('mouse:down', {
      e: { clientX: 100, clientY: 100, altKey: true },
      target: sel,
    } as unknown as fabric.IEvent)

    // 드래그 시뮬: 원본 AS 를 멀리 이동(사본은 시작 위치에 남아야 함 — reset 검증)
    sel.set({ left: startLeft + 120, top: startTop + 60 })
    sel.setCoords()

    // 첫 object:moving(임계 통과) — 실 clone→destroy→insert 동기 실행(rect=동기 clone)
    canvas.fire('object:moving', {
      e: { clientX: 150, clientY: 150, altKey: true },
      target: sel,
    } as unknown as fabric.IEvent)

    // 종료 — 1엔트리 마감(스텁 onHistory)
    canvas.fire('mouse:up', {
      e: { clientX: 150, clientY: 150, altKey: true },
    } as unknown as fabric.IEvent)

    const all = canvas.getObjects()
    // 원본 2 + 사본 2
    expect(all.length).toBe(4)
    const copies = all.filter((o) => o !== a && o !== b)
    expect(copies).toHaveLength(2)

    // 각 사본 = 대응 원본의 시작 절대좌표(드래그 위치가 아님 — 실 destroy baking + reset 확증)
    const near = (v: unknown, t: number) => Math.abs((v as number) - t) < 0.5
    const copyAtA = copies.find((c) => near(c.left, aStart.left) && near(c.top, aStart.top))
    const copyAtB = copies.find((c) => near(c.left, bStart.left) && near(c.top, bStart.top))
    expect(copyAtA, `사본이 a 시작좌표(${aStart.left},${aStart.top})에 없음`).toBeTruthy()
    expect(copyAtB, `사본이 b 시작좌표(${bStart.left},${bStart.top})에 없음`).toBeTruthy()

    // 사본은 신규 id·독립 객체(그룹 해제)
    copies.forEach((c) => {
      expect(c.id).toBeDefined()
      expect((c as { group?: unknown }).group).toBeFalsy()
    })

    // z-order: 각 사본이 대응 원본 직하 — [copyA, a, copyB, b]
    expect(all.indexOf(copyAtA!)).toBeLessThan(all.indexOf(a))
    expect(all.indexOf(copyAtB!)).toBeLessThan(all.indexOf(b))

    // 원본은 드래그 위치로 이동(사본과 분리)
    expect(sel.left).toBe(startLeft + 120)

    // offHistory/onHistory 정확히 1쌍(N 삽입 = 1 상호작용)
    expect(off).toBe(1)
    expect(on).toBe(1)

    plugin.dispose()
  })
})
