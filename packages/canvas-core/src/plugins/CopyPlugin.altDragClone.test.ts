// CopyPlugin — Alt+드래그 복제 테스트 (C5 / E2 W2)
//
// fabric 은 node 에서 native canvas 바인딩이 필요해 최소 mock
// (SmartGuidesPlugin.test / AccessoryPlugin.leak.test 와 동일 패턴).
// 증명 대상(설계 §4-4):
//  ① alt+down → (임계 통과) moving → up = 캔버스 객체 +1, 사본 위치=원본 시작 위치,
//     사본 z-order=원본 직하(insertAt 스냅샷 인덱스), 히스토리 정확히 1엔트리
//     (offHistory 창 안에서 삽입 → object:added 억제, onHistory 1회만 커밋)
//  ② 보호객체(movable=false 등) → 후보 미설정 → 객체 수 불변
//  ③ alt 없는 드래그 → 불변
//  ④ 이동 임계(4px) 미달 → 불변(단순 alt+클릭)
//  ⑤ 다중 선택(ActiveSelection) 복제(C5) — 멤버별 사본을 각 멤버 시작 절대좌표·대응 원본
//     직하에 삽입, 히스토리 1엔트리(N 삽입이 offHistory 창에서 억제). 이중 clone→destroy 로
//     그룹 행렬 baking(멤버 절대좌표 실체화)은 mock 으로 시뮬, 실 fabric 확증은 통합 spec.
//     보호 멤버 포함=복제 생략 / 비동기(이미지) 멤버 / 대기 중 dispose / 멤버<2 방어 포함.
//  ⑥ 빈 곳 alt+드래그(target 없음) → 후보 미설정(DraggingPlugin 팬에 양보)
//  ⑦ 초고속(비동기 이미지) 드래그 — 콜백 도착 전 mouse:up → 콜백에서 삽입+1엔트리 마감
//  ⑧ selection:cleared(핀치 등 비정상 종료) 안전망 → onHistory 복원
//  ⑨ dispose 후 리스너 잔존 없음
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('fabric', () => ({ fabric: {} }))

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

interface FakeObjectInit {
  id?: string
  type?: string
  left?: number
  top?: number
  width?: number
  height?: number
  /** 보호 플래그 (isCloneProtected 판정용) */
  movable?: boolean
  deleteable?: boolean
  contentEditable?: boolean
  lockInfo?: { isLocked: boolean; lockLevel?: string }
  /** 비동기 clone(이미지) 시뮬레이션 — clone(cb) 이 콜백을 즉시 호출하지 않고 보류 */
  asyncClone?: boolean
}

/** fabric.Object 의 clone/set 사용 표면만 흉내낸 fake */
function makeObj(init: FakeObjectInit) {
  const obj: Record<string, unknown> = {
    type: 'rect',
    left: 0,
    top: 0,
    width: 10,
    height: 10,
    ...init,
    set(props: Record<string, unknown> | string, value?: unknown) {
      if (typeof props === 'string') obj[props] = value
      else Object.assign(obj, props)
    },
    setCoords: vi.fn(),
    clone(cb: (cloned: Record<string, unknown>) => void) {
      const cloned = makeObj({
        type: obj.type as string,
        left: obj.left as number,
        top: obj.top as number,
        width: obj.width as number,
        height: obj.height as number,
      })
      if (obj.asyncClone) {
        obj.__pendingClone = () => cb(cloned)
      } else {
        cb(cloned)
      }
    },
  }
  return obj
}

/**
 * ActiveSelection(다중 선택) 의 alt-드래그 복제 표면을 흉내낸 fake.
 * 플러그인은 이중 clone(sel.clone→cloned.clone) → clonedSel.set(start) → destroy() → getObjects()
 * 순으로 멤버 사본을 얻는다. 실 fabric destroy() 의 그룹행렬 baking(멤버 절대좌표 실체화)을
 * 시뮬한다: destroy 시 각 사본 좌표 = clonedSel.left/top + (멤버 시작절대 − AS 시작).
 * 즉 clonedSel 을 AS 시작 위치로 되돌리면 사본은 멤버 시작 절대좌표를 갖는다(reset 검증 가능).
 * `cloned`/`clonedSel` 은 clone 시점의 (드래그된) 위치를 상속 → 플러그인이 start 로 되돌리지
 * 않으면 사본이 드래그 위치에 남는다(회귀를 관측 가능하게). 실 baking 확증은 통합 spec.
 */
function makeActiveSelectionMock(config: {
  sources: Array<Record<string, unknown>>
  selLeft: number
  selTop: number
  /** 각 멤버의 시작 절대좌표(= destroy 후 사본이 land 해야 할 위치) */
  memberAbsStarts: Array<{ left: number; top: number }>
  /** 이미지 멤버 시뮬 — 최내곽 clone 콜백을 즉시 호출하지 않고 __pendingClone 으로 보류 */
  asyncClone?: boolean
}) {
  const { sources, selLeft, selTop, memberAbsStarts, asyncClone } = config
  const relOffsets = memberAbsStarts.map((p) => ({ dx: p.left - selLeft, dy: p.top - selTop }))
  const sel: Record<string, unknown> = {
    id: 'sel',
    type: 'activeSelection',
    left: selLeft,
    top: selTop,
    set(props: Record<string, unknown> | string, value?: unknown) {
      if (typeof props === 'string') sel[props] = value
      else Object.assign(sel, props)
    },
    setCoords: vi.fn(),
    getObjects: () => sources,
    clone(cb: (cloned: Record<string, unknown>) => void) {
      // 이중 clone 1단계 — 현재(드래그된) AS 위치를 상속
      const cloned: Record<string, unknown> = {
        type: 'activeSelection',
        left: sel.left,
        top: sel.top,
        clone(cb2: (clonedSel: Record<string, unknown>) => void) {
          const copies = sources.map(() => makeObj({ type: 'rect' }))
          const clonedSel: Record<string, unknown> = {
            type: 'activeSelection',
            left: cloned.left,
            top: cloned.top,
            set(props: Record<string, unknown> | string, value?: unknown) {
              if (typeof props === 'string') clonedSel[props] = value
              else Object.assign(clonedSel, props)
            },
            setCoords: vi.fn(),
            getObjects: () => copies,
            destroy() {
              // 그룹행렬 baking 시뮬: 멤버 절대좌표 = clonedSel.left/top + relOffset
              copies.forEach((c, i) => {
                c.left = (clonedSel.left as number) + relOffsets[i].dx
                c.top = (clonedSel.top as number) + relOffsets[i].dy
              })
            },
          }
          if (asyncClone) sel.__pendingClone = () => cb2(clonedSel)
          else cb2(clonedSel)
        },
      }
      cb(cloned)
    },
  }
  return sel
}

/**
 * fabric Observable on/off/fire + 히스토리(offHistory/onHistory/insertAt) 시맨틱 mock.
 * 히스토리 엔트리는 실제 utils/history 규약을 최소 재현:
 *  - offHistory → historyProcessing=true → add/insertAt 의 object:added 저장 억제
 *  - onHistory → 상태 변화 시 정확히 1엔트리 커밋
 *  - 억제창 밖 add/insertAt 은 즉시 1엔트리(2엔트리 리스크를 실제로 관측 가능하게)
 */
function makeMockCanvas(
  objects: Array<Record<string, unknown>>,
  activeObject: Record<string, unknown> | null
) {
  const __eventListeners: Record<string, Array<(e: unknown) => void>> = {}
  const insertLog: Array<{ id: unknown; suppressed: boolean }> = []
  let historyProcessing = false
  let offHistoryCalls = 0
  let onHistoryCalls = 0
  const historyEntries: string[] = []
  const snap = () =>
    JSON.stringify(objects.map((o) => ({ id: o.id, left: o.left, top: o.top })))
  let committed = snap()
  const maybeCommit = () => {
    const s = snap()
    if (s !== committed) {
      historyEntries.push(committed)
      committed = s
    }
  }
  const canvas = {
    __eventListeners,
    __insertLog: insertLog,
    get __historyEntries() {
      return historyEntries
    },
    get __historyProcessing() {
      return historyProcessing
    },
    get __offHistoryCalls() {
      return offHistoryCalls
    },
    get __onHistoryCalls() {
      return onHistoryCalls
    },
    setActive(o: Record<string, unknown> | null) {
      activeObject = o
    },
    on(name: string, h: (e: unknown) => void) {
      if (!__eventListeners[name]) __eventListeners[name] = []
      __eventListeners[name].push(h)
    },
    off(name: string, h: (e: unknown) => void) {
      const l = __eventListeners[name]
      if (!l) return
      const i = l.indexOf(h)
      if (i >= 0) l.splice(i, 1)
    },
    fire(name: string, e?: unknown) {
      ;(__eventListeners[name] || []).slice().forEach((h) => h(e))
    },
    getObjects: () => objects,
    getActiveObject: () => activeObject,
    getActiveObjects: () => {
      const a = activeObject as
        | { type?: string; getObjects?: () => Array<Record<string, unknown>> }
        | null
      if (a && a.type === 'activeSelection') return a.getObjects?.() ?? []
      return a ? [a] : []
    },
    offHistory() {
      offHistoryCalls++
      historyProcessing = true
    },
    onHistory() {
      onHistoryCalls++
      historyProcessing = false
      maybeCommit()
    },
    insertAt(obj: Record<string, unknown>, index: number, nonSplicing?: boolean) {
      if (nonSplicing) objects[index] = obj
      else objects.splice(index, 0, obj)
      insertLog.push({ id: obj.id, suppressed: historyProcessing })
      if (!historyProcessing) maybeCommit()
    },
    add(obj: Record<string, unknown>) {
      objects.push(obj)
      if (!historyProcessing) maybeCommit()
    },
    discardActiveObject: vi.fn(),
    setActiveObject: vi.fn(),
    requestRenderAll: vi.fn(),
  }
  return canvas
}

type MockCanvas = ReturnType<typeof makeMockCanvas>

function setup(
  objects: Array<Record<string, unknown>>,
  activeObject: Record<string, unknown> | null,
  options: Record<string, unknown> = { altDragClone: true }
) {
  const canvas = makeMockCanvas(objects, activeObject)
  const plugin = new (CopyPlugin as unknown as new (
    c: unknown,
    e: unknown,
    o: unknown
  ) => { dispose: () => void })(canvas, {}, options)
  return { canvas, plugin }
}

function down(canvas: MockCanvas, target: unknown, x = 100, y = 100, altKey = true) {
  canvas.fire('mouse:down', { e: { clientX: x, clientY: y, altKey }, target })
}
function moving(canvas: MockCanvas, target: unknown, x: number, y: number, altKey = true) {
  canvas.fire('object:moving', { e: { clientX: x, clientY: y, altKey }, target })
}
function up(canvas: MockCanvas, x = 120, y = 120) {
  canvas.fire('mouse:up', { e: { clientX: x, clientY: y, altKey: true } })
}

beforeEach(() => {
  // node 환경: CopyPlugin 생성자의 initPaste() window.addEventListener 를 위해 stub
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CopyPlugin Alt+드래그 — ① 단일 객체 복제', () => {
  it('alt+down → moving(임계 통과) → up = 객체 +1, 사본=시작 위치, 히스토리 1엔트리', () => {
    const bg = makeObj({ id: 'bg', left: 0, top: 0 })
    const src = makeObj({ id: 'src', left: 50, top: 50 })
    const top = makeObj({ id: 'top', left: 200, top: 200 })
    const objects = [bg, src, top]
    const { canvas } = setup(objects, src)

    down(canvas, src, 100, 100) // 시작 위치 (50,50) 스냅샷
    src.left = 60
    src.top = 60 // 드래그 시뮬레이션(원본 이동)
    moving(canvas, src, 114, 114) // 화면 이동 ~19.8px > 4px 임계
    up(canvas)

    // 객체 +1
    expect(objects.length).toBe(4)
    const clone = objects.find((o) => o !== bg && o !== src && o !== top)!
    // 사본은 원본 시작 위치에 남는다
    expect(clone.left).toBe(50)
    expect(clone.top).toBe(50)
    // 사본 id 는 신규(원본과 다름, 정의됨)
    expect(clone.id).toBeDefined()
    expect(clone.id).not.toBe('src')
    // 원본은 이동 위치
    expect(src.left).toBe(60)
    // 히스토리 정확히 1엔트리
    expect(canvas.__historyEntries.length).toBe(1)
    expect(canvas.__offHistoryCalls).toBe(1)
    expect(canvas.__onHistoryCalls).toBe(1)
    // 사본은 offHistory 억제창 안에서 삽입됐다(2엔트리 방지의 핵심)
    expect(canvas.__insertLog).toHaveLength(1)
    expect(canvas.__insertLog[0].suppressed).toBe(true)
  })

  it('사본 z-order 는 원본 직하(스냅샷 인덱스) — 원본은 위로 밀린다', () => {
    const bg = makeObj({ id: 'bg', left: 0, top: 0 })
    const src = makeObj({ id: 'src', left: 50, top: 50 }) // index 1
    const top = makeObj({ id: 'top', left: 200, top: 200 })
    const objects = [bg, src, top]
    const { canvas } = setup(objects, src)

    down(canvas, src, 100, 100)
    src.left = 70
    moving(canvas, src, 120, 100)
    up(canvas)

    const clone = objects.find((o) => o !== bg && o !== src && o !== top)!
    // [bg, clone, src, top] — clone 이 원본 직하
    expect(objects.indexOf(clone)).toBe(1)
    expect(objects.indexOf(src)).toBe(2)
  })
})

describe('CopyPlugin Alt+드래그 — ②③④⑥ 비대상 경로(불변)', () => {
  it('② 보호객체(movable=false)는 복제되지 않는다', () => {
    const src = makeObj({ id: 'src', left: 50, top: 50, movable: false })
    const objects = [src]
    const { canvas } = setup(objects, src)

    down(canvas, src, 100, 100)
    src.left = 70
    moving(canvas, src, 120, 100)
    up(canvas)

    expect(objects.length).toBe(1)
    expect(canvas.__historyEntries.length).toBe(0)
    expect(canvas.__offHistoryCalls).toBe(0)
  })

  it('② 보호객체(lockInfo designer)도 복제되지 않는다', () => {
    const src = makeObj({
      id: 'src',
      left: 50,
      top: 50,
      lockInfo: { isLocked: true, lockLevel: 'designer' },
    })
    const objects = [src]
    const { canvas } = setup(objects, src)

    down(canvas, src, 100, 100)
    src.left = 70
    moving(canvas, src, 130, 100)
    up(canvas)

    expect(objects.length).toBe(1)
  })

  it('③ alt 없는 드래그는 복제하지 않는다', () => {
    const src = makeObj({ id: 'src', left: 50, top: 50 })
    const objects = [src]
    const { canvas } = setup(objects, src)

    down(canvas, src, 100, 100, /* altKey */ false)
    src.left = 70
    moving(canvas, src, 130, 100, false)
    up(canvas)

    expect(objects.length).toBe(1)
    expect(canvas.__offHistoryCalls).toBe(0)
  })

  it('④ 이동 임계(4px) 미달 — 단순 alt+클릭은 복제하지 않는다', () => {
    const src = makeObj({ id: 'src', left: 50, top: 50 })
    const objects = [src]
    const { canvas } = setup(objects, src)

    down(canvas, src, 100, 100)
    moving(canvas, src, 102, 101) // 이동 ~2.2px < 4px
    up(canvas)

    expect(objects.length).toBe(1)
    expect(canvas.__offHistoryCalls).toBe(0)
  })

  it('⑥ 빈 곳 alt+드래그(target 없음)는 후보 미설정 — 팬에 양보', () => {
    const src = makeObj({ id: 'src', left: 50, top: 50 })
    const objects = [src]
    const { canvas } = setup(objects, null)

    down(canvas, undefined, 100, 100) // target 없음
    canvas.fire('object:moving', { e: { clientX: 130, clientY: 100, altKey: true }, target: undefined })
    up(canvas)

    expect(objects.length).toBe(1)
    expect(canvas.__offHistoryCalls).toBe(0)
  })
})

describe('CopyPlugin Alt+드래그 — ⑤ 다중 선택(ActiveSelection) 복제', () => {
  it('⑤ alt+down(다중) → moving → up = 멤버별 사본, 각 사본=멤버 시작 절대좌표, z-order 원본 직하, 히스토리 1엔트리', () => {
    const bg = makeObj({ id: 'bg', left: 0, top: 0 })
    const a = makeObj({ id: 'a', left: 50, top: 50 }) // index 1
    const b = makeObj({ id: 'b', left: 80, top: 80 }) // index 2
    const objects = [bg, a, b]
    const sel = makeActiveSelectionMock({
      sources: [a, b],
      selLeft: 50, // AS 시작(top-left) = (50,50)
      selTop: 50,
      memberAbsStarts: [
        { left: 50, top: 50 },
        { left: 80, top: 80 }
      ]
    })
    const { canvas } = setup(objects, sel)

    down(canvas, sel, 100, 100) // 시작 위치 (50,50) 스냅샷
    sel.left = 90 // 드래그 시뮬(원본 AS 이동) — 사본은 시작 위치에 남아야 함
    sel.top = 80
    moving(canvas, sel, 130, 120) // 화면 이동 > 4px 임계
    up(canvas)

    // 멤버 2개 → 사본 2개 추가
    expect(objects.length).toBe(5)
    const copies = objects.filter((o) => o !== bg && o !== a && o !== b)
    expect(copies).toHaveLength(2)
    // 각 사본 = 대응 멤버의 시작 절대좌표(드래그 위치가 아니라 시작 위치 — reset 검증)
    const byPos = (l: number, t: number) => copies.find((c) => c.left === l && c.top === t)
    const copyA = byPos(50, 50)!
    const copyB = byPos(80, 80)!
    expect(copyA).toBeTruthy()
    expect(copyB).toBeTruthy()
    // 사본 id 는 신규(원본과 다름, 정의됨)
    copies.forEach((c) => {
      expect(c.id).toBeDefined()
      expect(c.id).not.toBe('a')
      expect(c.id).not.toBe('b')
    })
    // z-order: 각 사본이 대응 원본 직하 — [bg, copyA, a, copyB, b]
    expect(objects).toEqual([bg, copyA, a, copyB, b])
    // 히스토리 정확히 1엔트리(N 삽입이 offHistory 창에서 억제 → onHistory 1회만 커밋)
    expect(canvas.__historyEntries.length).toBe(1)
    expect(canvas.__offHistoryCalls).toBe(1)
    expect(canvas.__onHistoryCalls).toBe(1)
    // 모든 사본 삽입이 억제창 안에서 이뤄졌다(2엔트리 방지의 핵심)
    expect(canvas.__insertLog).toHaveLength(2)
    expect(canvas.__insertLog.every((l) => l.suppressed)).toBe(true)
  })

  it('⑤-b 다중 선택에 보호 멤버(movable=false)가 포함되면 복제하지 않는다 — 일반 이동 폴백', () => {
    const a = makeObj({ id: 'a', left: 50, top: 50 })
    const b = makeObj({ id: 'b', left: 80, top: 80, movable: false }) // 보호 멤버
    const objects = [a, b]
    const sel = makeActiveSelectionMock({
      sources: [a, b],
      selLeft: 50,
      selTop: 50,
      memberAbsStarts: [
        { left: 50, top: 50 },
        { left: 80, top: 80 }
      ]
    })
    const { canvas } = setup(objects, sel)

    down(canvas, sel, 100, 100)
    sel.left = 90
    moving(canvas, sel, 130, 100)
    up(canvas)

    expect(objects.length).toBe(2) // 사본 없음
    expect(canvas.__offHistoryCalls).toBe(0) // 후보 미설정 → offHistory 미개입
  })

  it('⑤-c 비동기(이미지 멤버) 다중 clone — 콜백 도착 전 mouse:up → 콜백에서 전량 삽입 + 1엔트리', () => {
    const a = makeObj({ id: 'a', left: 50, top: 50 })
    const b = makeObj({ id: 'b', left: 80, top: 80 })
    const objects = [a, b]
    const sel = makeActiveSelectionMock({
      sources: [a, b],
      selLeft: 50,
      selTop: 50,
      memberAbsStarts: [
        { left: 50, top: 50 },
        { left: 80, top: 80 }
      ],
      asyncClone: true
    })
    const { canvas } = setup(objects, sel)

    down(canvas, sel, 100, 100)
    sel.left = 90
    moving(canvas, sel, 140, 100) // clone 시작(offHistory) — 최내곽 콜백 보류
    expect(objects.length).toBe(2) // 아직 미삽입
    expect(canvas.__historyProcessing).toBe(true)

    up(canvas) // 콜백 전 종료 — pending 신호만
    expect(objects.length).toBe(2)
    expect(canvas.__onHistoryCalls).toBe(0) // 아직 마감 안 됨

    // 비동기 clone 콜백 도착 → 전량 삽입 + 마감
    ;(sel.__pendingClone as () => void)()

    expect(objects.length).toBe(4)
    expect(canvas.__onHistoryCalls).toBe(1)
    expect(canvas.__historyEntries.length).toBe(1)
    expect(canvas.__historyProcessing).toBe(false)
  })

  it('⑤-d 비동기 다중 clone 대기 중 dispose → 콜백이 삽입을 취소', () => {
    const a = makeObj({ id: 'a', left: 50, top: 50 })
    const b = makeObj({ id: 'b', left: 80, top: 80 })
    const objects = [a, b]
    const sel = makeActiveSelectionMock({
      sources: [a, b],
      selLeft: 50,
      selTop: 50,
      memberAbsStarts: [
        { left: 50, top: 50 },
        { left: 80, top: 80 }
      ],
      asyncClone: true
    })
    const { canvas, plugin } = setup(objects, sel)

    down(canvas, sel, 100, 100)
    sel.left = 90
    moving(canvas, sel, 140, 100) // clone 시작 — 콜백 보류
    expect(objects.length).toBe(2)

    plugin.dispose() // 대기 중 dispose → finalizeAltDrag 로 플래그 하강 + onHistory 복원
    expect(canvas.__historyProcessing).toBe(false)

    // 뒤늦게 도착한 콜백은 삽입하지 않는다(disposed 캔버스 쓰기 방지)
    ;(sel.__pendingClone as () => void)()
    expect(objects.length).toBe(2)
  })

  it('⑤-e 멤버 2개 미만 activeSelection(비정상)은 후보 미설정 — 복제 없음', () => {
    const a = makeObj({ id: 'a', left: 50, top: 50 })
    const objects = [a]
    const sel = makeActiveSelectionMock({
      sources: [a],
      selLeft: 50,
      selTop: 50,
      memberAbsStarts: [{ left: 50, top: 50 }]
    })
    const { canvas } = setup(objects, sel)

    down(canvas, sel, 100, 100)
    sel.left = 90
    moving(canvas, sel, 130, 100)
    up(canvas)

    expect(objects.length).toBe(1)
    expect(canvas.__offHistoryCalls).toBe(0)
  })
})

describe('CopyPlugin Alt+드래그 — ⑦⑧ 레이스/안전망', () => {
  it('⑦ 초고속(비동기 이미지) 드래그 — 콜백 도착 전 mouse:up → 콜백에서 삽입+1엔트리', () => {
    const src = makeObj({ id: 'src', left: 50, top: 50, asyncClone: true })
    const objects = [src]
    const { canvas } = setup(objects, src)

    down(canvas, src, 100, 100)
    src.left = 90
    moving(canvas, src, 140, 100) // clone 시작(offHistory) — 콜백 보류
    expect(objects.length).toBe(1) // 아직 미삽입
    expect(canvas.__historyProcessing).toBe(true)

    up(canvas) // 콜백 전 종료 — pending 신호만
    expect(objects.length).toBe(1)
    expect(canvas.__onHistoryCalls).toBe(0) // 아직 마감 안 됨

    // 비동기 clone 콜백 도착 → 삽입 + 마감
    ;(src.__pendingClone as () => void)()

    expect(objects.length).toBe(2)
    const clone = objects.find((o) => o !== src)!
    expect(clone.left).toBe(50) // 시작 위치
    expect(canvas.__onHistoryCalls).toBe(1)
    expect(canvas.__historyEntries.length).toBe(1)
    expect(canvas.__historyProcessing).toBe(false)
  })

  it('⑦-b 비동기 clone 대기 중 dispose → 콜백이 삽입을 취소(disposed 캔버스 쓰기 방지)', () => {
    const src = makeObj({ id: 'src', left: 50, top: 50, asyncClone: true })
    const objects = [src]
    const { canvas, plugin } = setup(objects, src)

    down(canvas, src, 100, 100)
    src.left = 90
    moving(canvas, src, 140, 100) // clone 시작 — 콜백 보류
    expect(objects.length).toBe(1)

    plugin.dispose() // 대기 중 dispose → finalizeAltDrag 로 플래그 하강 + onHistory 복원
    expect(canvas.__historyProcessing).toBe(false)

    // 뒤늦게 도착한 콜백은 삽입하지 않는다
    ;(src.__pendingClone as () => void)()
    expect(objects.length).toBe(1)
  })

  it('⑧ selection:cleared(핀치 등 비정상 종료) 안전망 — onHistory 복원', () => {
    const src = makeObj({ id: 'src', left: 50, top: 50 })
    const objects = [src]
    const { canvas } = setup(objects, src)

    down(canvas, src, 100, 100)
    src.left = 90
    moving(canvas, src, 140, 100) // 사본 삽입 + offHistory
    expect(canvas.__historyProcessing).toBe(true)

    // mouse:up 대신 selection:cleared 발화(핀치 discardActiveObject 경로)
    canvas.fire('selection:cleared', {})

    expect(canvas.__historyProcessing).toBe(false) // 히스토리 복원(누수 없음)
    expect(canvas.__onHistoryCalls).toBe(1)
    expect(objects.length).toBe(2) // 사본은 이미 삽입됨(1엔트리로 확정)
    expect(canvas.__historyEntries.length).toBe(1)
  })
})

describe('CopyPlugin Alt+드래그 — ⑨ dispose 정리', () => {
  it('dispose 후 alt-드래그 캔버스 리스너가 전량 해제된다', () => {
    const src = makeObj({ id: 'src', left: 50, top: 50 })
    const objects = [src]
    const { canvas, plugin } = setup(objects, src)

    expect(canvas.__eventListeners['mouse:down'].length).toBe(1)
    expect(canvas.__eventListeners['object:moving'].length).toBe(1)
    expect(canvas.__eventListeners['mouse:up'].length).toBe(1)
    expect(canvas.__eventListeners['selection:cleared'].length).toBe(1)

    plugin.dispose()

    expect(canvas.__eventListeners['mouse:down'].length).toBe(0)
    expect(canvas.__eventListeners['object:moving'].length).toBe(0)
    expect(canvas.__eventListeners['mouse:up'].length).toBe(0)
    expect(canvas.__eventListeners['selection:cleared'].length).toBe(0)

    // dispose 후 이벤트가 남은 핸들러로 후보를 만들지 않는다
    down(canvas, src, 100, 100)
    moving(canvas, src, 140, 100)
    expect(objects.length).toBe(1)
  })

  it('플래그 off 면 alt-드래그 리스너를 아예 걸지 않는다', () => {
    const src = makeObj({ id: 'src', left: 50, top: 50 })
    const objects = [src]
    const { canvas } = setup(objects, src, { altDragClone: false })

    expect(canvas.__eventListeners['object:moving']).toBeUndefined()

    down(canvas, src, 100, 100)
    src.left = 90
    moving(canvas, src, 140, 100)
    up(canvas)

    expect(objects.length).toBe(1) // 복제 없음
  })
})
