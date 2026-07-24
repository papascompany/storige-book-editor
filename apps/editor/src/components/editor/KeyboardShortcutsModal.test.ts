// KeyboardShortcutsModal 자동 생성 로직 (C9/E2 W4 §6-2)
//
// 순수 함수 buildShortcutGroups/formatHotkeyKeys 검증(렌더 없이):
//  ① 포매터: displayKeys 우선 / ctrl+·cmd+ 배열 → 플랫폼별 1개 축약 / 특수키 심볼
//  ② 드리프트 차단: hideInHelp 아닌 모든 등록 hotkey 가 그룹에 존재, hideInHelp 는 제외
//  ③ 앱소유 static(⌘K/⌘S/?/⌘\) 병합 / category 폴백(pluginName)
import { describe, it, expect } from 'vitest'
import { buildShortcutGroups, formatHotkeyKeys } from './KeyboardShortcutsModal'

type Reg = Parameters<typeof buildShortcutGroups>[0][number]

function flat(groups: ReturnType<typeof buildShortcutGroups>) {
  return groups.flatMap((g) => g.items.map((i) => i.description))
}

describe('formatHotkeyKeys', () => {
  it('① displayKeys 우선', () => {
    expect(formatHotkeyKeys({ name: 'x', input: 'left', displayKeys: ['←', '→', '↑', '↓'] }, true)).toEqual([
      '←', '→', '↑', '↓',
    ])
  })
  it('cmd+[ → [⌘, []', () => {
    expect(formatHotkeyKeys({ name: 'x', input: 'cmd+[' }, true)).toEqual(['⌘', '['])
  })
  it("ctrl+/cmd+ 배열은 플랫폼별 1개로 축약", () => {
    const h: Reg = { name: '실행 취소', input: ['ctrl+z', '⌘+z'] }
    expect(formatHotkeyKeys(h, true)).toEqual(['⌘', 'Z']) // Mac
    expect(formatHotkeyKeys(h, false)).toEqual(['Ctrl', 'Z']) // Win
  })
  it('특수키 심볼: backspace/del/화살표/shift', () => {
    expect(formatHotkeyKeys({ name: 'x', input: 'backspace' }, true)).toEqual(['⌫'])
    expect(formatHotkeyKeys({ name: 'x', input: 'shift+left' }, true)).toEqual(['⇧', '←'])
    expect(formatHotkeyKeys({ name: 'x', input: 'del' }, true)).toEqual(['Delete'])
  })
})

describe('buildShortcutGroups — 드리프트 차단·병합', () => {
  const registered: Reg[] = [
    { name: '복사', input: ['ctrl+c', 'cmd+c'], pluginName: 'CopyPlugin' }, // category 폴백→clipboard
    { name: '삭제', input: ['backspace', 'del'], pluginName: 'ObjectPlugin', category: 'object' },
    { name: '객체 이동', input: 'left', pluginName: 'ObjectPlugin', category: 'move', displayKeys: ['←', '→', '↑', '↓'] },
    { name: '우측 이동', input: 'right', pluginName: 'ObjectPlugin', category: 'move', hideInHelp: true }, // 제외
    { name: '실행 취소', input: ['ctrl+z', '⌘+z'], pluginName: 'HistoryPlugin' }, // 폴백→view
  ]

  it('② hideInHelp 아닌 등록 hotkey 전부 그룹에 존재, hideInHelp 는 제외', () => {
    const names = flat(buildShortcutGroups(registered, true))
    expect(names).toContain('복사')
    expect(names).toContain('삭제')
    expect(names).toContain('객체 이동')
    expect(names).toContain('실행 취소')
    expect(names).not.toContain('우측 이동') // hideInHelp
  })

  it('드리프트 불변식: 모든 non-hideInHelp 등록이 정확히 1회 노출', () => {
    const visible = registered.filter((h) => !h.hideInHelp)
    const names = flat(buildShortcutGroups(registered, true))
    for (const h of visible) {
      expect(names.filter((n) => n === h.name)).toHaveLength(1)
    }
  })

  it('③ 앱소유 static(커맨드 팔레트/저장/도움말/사이드바) 병합', () => {
    const names = flat(buildShortcutGroups([], true))
    expect(names).toContain('커맨드 팔레트')
    expect(names).toContain('편집 완료 (저장)')
    expect(names).toContain('단축키 도움말')
    expect(names).toContain('사이드바 접기/펼치기')
  })

  it('category 그룹핑 + pluginName 폴백(Copy→클립보드, History→보기·작업)', () => {
    const groups = buildShortcutGroups(registered, true)
    const clip = groups.find((g) => g.title === '클립보드')
    expect(clip?.items.map((i) => i.description)).toContain('복사')
    const view = groups.find((g) => g.title === '보기·작업')
    expect(view?.items.map((i) => i.description)).toContain('실행 취소')
  })

  it('빈 등록이어도 앱소유 그룹은 생성(no-op editor 방어)', () => {
    expect(buildShortcutGroups([], true).length).toBeGreaterThan(0)
  })
})
