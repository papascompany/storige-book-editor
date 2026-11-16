import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useAppStore } from './useAppStore'

/**
 * _updateObjectsHandler — 늦게 도는 객체 갱신이 이미 풀린 선택을 되살리지 않는다.
 *
 * 글상자 편집을 끝내며 빈 곳을 누르면 object:modified → selection:cleared 순서로 이벤트가 온다.
 * 객체 갱신은 100ms 뒤에 도는데, 종전에는 이벤트를 받은 시점의 선택 값을 붙들고 있다가 그 값으로
 * 선택 상태를 다시 써넣었다. 그러면 캔버스에는 선택이 없는데 왼쪽 패널은 객체 속성 화면에 남는다.
 */

type Plain = Record<string, unknown>

const settle = () => vi.advanceTimersByTime(200)

describe('useAppStore._updateObjectsHandler — 선택 상태 갱신', () => {
  const text = { id: 'text-1', type: 'textbox' }
  const updateObjects = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    updateObjects.mockClear()
    useAppStore.setState({
      canvas: { disposed: false, historyProcessing: false, getObjects: () => [text] },
      activeSelection: [text],
      updateObjects,
    } as never)
  })
  afterEach(() => {
    settle()
    useAppStore.setState({ canvas: null, activeSelection: [] } as never)
    vi.useRealTimers()
  })

  const fire = (target: Plain) => useAppStore.getState()._updateObjectsHandler({ target } as never)

  it('갱신이 돌기 전에 선택이 풀리면 선택을 되살리지 않는다', () => {
    fire(text)
    // selection:cleared 가 먼저 반영된다
    useAppStore.setState({ activeSelection: [] } as never)
    settle()

    expect(useAppStore.getState().activeSelection).toEqual([])
    expect(updateObjects).toHaveBeenCalledTimes(1)
  })

  it('갱신이 돌기 전에 다른 객체를 선택하면 그 선택을 덮어쓰지 않는다', () => {
    const other = { id: 'rect-2', type: 'rect' }
    fire(text)
    useAppStore.setState({ activeSelection: [other] } as never)
    settle()

    expect(useAppStore.getState().activeSelection).toEqual([other])
  })

  it('여전히 선택 중인 객체가 바뀌면 선택 값을 새 객체 참조로 갱신한다', () => {
    const replaced = { id: 'text-1', type: 'textbox', text: '바뀜' }
    fire(replaced)
    settle()

    expect(useAppStore.getState().activeSelection).toEqual([replaced])
    expect(useAppStore.getState().activeSelection[0]).toBe(replaced)
  })
})
