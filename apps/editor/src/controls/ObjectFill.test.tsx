// @vitest-environment happy-dom
//
// ObjectFill hook 순서 회귀: 선택 없음(조기 반환) 렌더 다음에 선택 있음 렌더가 와도
// 렌더마다 hook 개수가 같아야 한다. 조기 반환 뒤에 hook 을 두면 React 가
// "Rendered more hooks than during the previous render" 로 컴포넌트를 깨뜨린다.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

interface FakeSelection {
  type: string
  fill?: string
  effects?: string[]
}

let selection: FakeSelection[] = []

vi.mock('@/stores/useAppStore', () => ({
  useActiveSelection: () => selection,
  useSelectionType: () => null,
  useAppStore: (selector: (state: { canvas: null }) => unknown) => selector({ canvas: null }),
}))

import ObjectFill from './ObjectFill'

afterEach(() => {
  cleanup()
  selection = []
})

describe('ObjectFill — 선택 전환 시 hook 순서', () => {
  it('선택 없음 → 선택 있음으로 다시 렌더해도 오류 없이 채우기 섹션을 그린다', () => {
    const { container, rerender } = render(<ObjectFill />)
    expect(container.innerHTML).toBe('')

    selection = [{ type: 'rect', fill: '#ff0000' }]
    expect(() => rerender(<ObjectFill />)).not.toThrow()
    expect(screen.getByText('채우기')).toBeTruthy()
  })

  it('선택 있음 → 선택 없음으로 바뀌면 아무것도 그리지 않는다', () => {
    selection = [{ type: 'rect', fill: '#ff0000' }]
    const { container, rerender } = render(<ObjectFill />)
    expect(screen.getByText('채우기')).toBeTruthy()

    selection = []
    expect(() => rerender(<ObjectFill />)).not.toThrow()
    expect(container.innerHTML).toBe('')
  })

  it('금박 효과가 걸린 객체는 채우기 섹션을 숨긴다(기존 동작 유지)', () => {
    selection = [{ type: 'rect', fill: '#ff0000', effects: ['gold'] }]
    const { container } = render(<ObjectFill />)
    expect(container.innerHTML).toBe('')
  })
})
