// @vitest-environment jsdom
//
// ContextMenu — showAt + 터치 이중발화 억제창 + stale-dom 수정 (C6 / E2 W3)
//
// ContextMenu 는 실제 DOM(document/appendChild)을 조작하므로 이 파일만 jsdom 환경.
// 증명 대상:
//  ① showAt(touch) 는 .context 를 clientX/Y(px)에 표시(position:fixed → 뷰포트 좌표 정합)
//  ② T-5: showAt(touch) 직후 400ms 내 외부 mousedown(합성 탭)이 메뉴를 닫지 않음, 이후 정상 닫힘
//  ③ T-3: showAt(touch) 직후 700ms 내 네이티브 contextmenu 가 메뉴를 재발화/재배치하지 않음
//  ④ 데스크탑(touch 아님)은 억제창이 서지 않아 우클릭 경로 무회귀(즉시 닫힘)
//  ⑤ T-6 stale-dom: 직전 표시 후 available 0(빈 곳) showAt → 옛 메뉴가 재출현하지 않음
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import ContextMenu from './contextMenu'

interface Item {
  name: string
  input: string
  onlyForActiveObject?: boolean
  hideContext?: boolean | (() => boolean)
  callback?: () => void
}

function setup(items: Item[], activeObject: unknown) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const canvas = {
    wrapperEl: container,
    getActiveObject: () => activeObject,
  }
  const cm = new (ContextMenu as unknown as new (c: unknown, i: Item[]) => {
    showAt: (x: number, y: number, o?: { touch?: boolean }) => boolean
    shown: boolean
    dispose: () => void
  })(canvas, items)
  return { container, cm, canvas }
}

function menuEl(container: HTMLElement) {
  return container.querySelector('#context-menu') as HTMLElement | null
}

function fire(
  container: HTMLElement,
  type: string,
  init: { button?: number; clientX?: number; clientY?: number } = {}
) {
  container.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }))
}

const ITEMS: Item[] = [{ name: '복제', input: 'ctrl+d', onlyForActiveObject: true }]

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('ContextMenu.showAt — 표시/좌표', () => {
  it('① showAt(touch) 는 clientX/Y px 위치에 .context 를 표시한다', () => {
    const { container, cm } = setup(ITEMS, {}) // active object 존재 → available 1
    const shown = cm.showAt(120, 240, { touch: true })
    expect(shown).toBe(true)
    const el = menuEl(container)
    expect(el).not.toBeNull()
    expect(el!.style.left).toBe('120px')
    expect(el!.style.top).toBe('240px')
  })

  it('빈 곳(available 0) showAt 는 false + 미표시', () => {
    const { container, cm } = setup(ITEMS, null) // onlyForActiveObject 인데 active 없음 → available 0
    const shown = cm.showAt(120, 240, { touch: true })
    expect(shown).toBe(false)
    expect(menuEl(container)).toBeNull()
  })
})

describe('ContextMenu — T-5 합성 mousedown 억제창', () => {
  it('② showAt(touch) 400ms 내 외부 mousedown 은 메뉴를 닫지 않고, 이후엔 닫힌다', () => {
    const { container, cm } = setup(ITEMS, {})
    cm.showAt(100, 100, { touch: true })
    expect(cm.shown).toBe(true)

    // 손 떼는 순간의 합성 mousedown(button 0, 메뉴 밖) — 억제창 내
    vi.advanceTimersByTime(100)
    fire(container, 'mousedown', { button: 0, clientX: 500, clientY: 500 })
    expect(cm.shown).toBe(true) // 유지
    expect(menuEl(container)).not.toBeNull()

    // 억제창 경과 후 외부 mousedown → 정상 닫힘
    vi.advanceTimersByTime(400)
    fire(container, 'mousedown', { button: 0, clientX: 500, clientY: 500 })
    expect(cm.shown).toBe(false)
    expect(menuEl(container)).toBeNull()
  })
})

describe('ContextMenu — T-3 네이티브 contextmenu 억제창', () => {
  it('③ showAt(touch) 700ms 내 contextmenu 는 재발화/재배치하지 않는다', () => {
    const { container, cm } = setup(ITEMS, {})
    cm.showAt(100, 100, { touch: true })
    const before = menuEl(container)!
    expect(before.style.left).toBe('100px')

    // Android 네이티브 contextmenu 이중발화(다른 좌표) — 억제창 내
    vi.advanceTimersByTime(200)
    fire(container, 'contextmenu', { clientX: 500, clientY: 500 })

    const after = menuEl(container)!
    expect(after.style.left).toBe('100px') // 재배치 없음(500px 로 안 점프)
    expect(cm.shown).toBe(true)
  })
})

describe('ContextMenu — 데스크탑 우클릭 무회귀', () => {
  it('④ showAt(touch 아님)은 억제창을 세우지 않아 외부 mousedown 이 즉시 닫는다', () => {
    const { container, cm } = setup(ITEMS, {})
    cm.showAt(100, 100) // touch 옵션 없음
    expect(cm.shown).toBe(true)

    fire(container, 'mousedown', { button: 0, clientX: 500, clientY: 500 }) // 즉시
    expect(cm.shown).toBe(false) // 억제 없음 → 정상 닫힘
    expect(menuEl(container)).toBeNull()
  })

  it('네이티브 contextmenu(우클릭)도 touch 억제창 없이 정상 재표시된다', () => {
    const { container, cm } = setup(ITEMS, {})
    cm.showAt(100, 100) // 비-touch
    fire(container, 'contextmenu', { clientX: 300, clientY: 300 })
    expect(menuEl(container)!.style.left).toBe('300px') // 정상 재배치
  })

  it('빈 곳 롱프레스(미표시)는 억제창을 arm 하지 않아 직후 우클릭이 삼켜지지 않는다', () => {
    // active 없음 → onlyForActiveObject 항목 available 0 → showAt(touch) 미표시(false)
    const { container, cm, canvas } = setup(ITEMS, null)
    expect(cm.showAt(100, 100, { touch: true })).toBe(false)

    // 직후(억제창 만료 전이라면 삼켜졌을 것) 우클릭 표시 주경로 = mousedown button:2(onClick).
    // active 부여해 available>0 으로 만들고 정상 표시 확인.
    ;(canvas as { getActiveObject: () => unknown }).getActiveObject = () => ({})
    fire(container, 'mousedown', { button: 2, clientX: 300, clientY: 300 })
    expect(menuEl(container)).not.toBeNull() // 억제 안 됨(빈 곳은 arm 안 함)
    expect(menuEl(container)!.style.left).toBe('300px')
  })
})

describe('ContextMenu — T-6 stale-dom 수정', () => {
  it('⑤ 직전 표시 후 available 0 로 showAt → 옛 메뉴가 재출현하지 않는다', () => {
    // 1) active object 있는 상태로 표시
    const { container, cm, canvas } = setup(ITEMS, {})
    cm.showAt(100, 100, { touch: true })
    expect(menuEl(container)).not.toBeNull()

    // 2) 닫기
    vi.advanceTimersByTime(500)
    fire(container, 'mousedown', { button: 0, clientX: 500, clientY: 500 })
    expect(menuEl(container)).toBeNull()

    // 3) active object 제거(빈 곳 롱프레스 상당) → available 0
    ;(canvas as { getActiveObject: () => unknown }).getActiveObject = () => null
    const shown = cm.showAt(200, 200, { touch: true })

    // stale dom 재-append 없음(선재결함 수정)
    expect(shown).toBe(false)
    expect(menuEl(container)).toBeNull()
    expect(cm.shown).toBe(false)
  })
})
