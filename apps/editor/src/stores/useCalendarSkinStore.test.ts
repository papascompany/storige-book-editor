import { describe, it, expect, beforeEach } from 'vitest'
import { useCalendarSkinStore } from './useCalendarSkinStore'

beforeEach(() => useCalendarSkinStore.getState().reset())

describe('useCalendarSkinStore', () => {
  it('setBase: 같은 세트면 캐시 유지, 다른 세트로 바뀌면 사유·id 캐시·취소 스냅샷을 비운다', () => {
    const s = useCalendarSkinStore.getState()
    s.setBase('base-1')
    s.setCardReason('spring', 'missing')
    s.cacheIdSets('skin-1', [new Set(['a'])])
    s.setUndo({ before: [{}], prevSkinKey: undefined, label: '봄' })
    s.setBase('base-1')
    expect(useCalendarSkinStore.getState().cardReasons).toEqual({ spring: 'missing' })
    expect(useCalendarSkinStore.getState().undo).not.toBeNull()
    s.setBase('base-2')
    const next = useCalendarSkinStore.getState()
    expect(next.baseTemplateSetId).toBe('base-2')
    expect(next.cardReasons).toEqual({})
    expect(next.idSetCache).toEqual({})
    expect(next.undo).toBeNull()
  })

  it('setPhase 는 activeKey 를 함께 바꾸고 생략하면 null', () => {
    useCalendarSkinStore.getState().setPhase('checking', 'spring')
    expect(useCalendarSkinStore.getState()).toMatchObject({ phase: 'checking', activeKey: 'spring' })
    useCalendarSkinStore.getState().setPhase('idle')
    expect(useCalendarSkinStore.getState()).toMatchObject({ phase: 'idle', activeKey: null })
  })

  it('setUndo(null) 로 스냅샷을 해제한다', () => {
    useCalendarSkinStore.getState().setUndo({ before: [{ a: 1 }], prevSkinKey: 'x', label: 'L' })
    useCalendarSkinStore.getState().setUndo(null)
    expect(useCalendarSkinStore.getState().undo).toBeNull()
  })
})
