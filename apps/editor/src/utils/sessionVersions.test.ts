import { describe, it, expect } from 'vitest'
import {
  describeVersionReason,
  formatVersionPages,
  sortVersionsNewestFirst,
  mergeRestoredSession,
  restoredCanvasCount,
} from './sessionVersions'
import type { EditSessionResponse } from '@/api/edit-sessions'

describe('sessionVersions 헬퍼 (P1-4)', () => {
  it('describeVersionReason: shrink 는 경고 톤, restore 는 정보, autosave/미상은 중립', () => {
    expect(describeVersionReason('shrink')).toEqual({ label: '페이지 감소 직전', tone: 'warning' })
    expect(describeVersionReason('restore')).toEqual({ label: '복원 직전', tone: 'info' })
    expect(describeVersionReason('autosave')).toEqual({ label: '자동 저장', tone: 'neutral' })
    expect(describeVersionReason(undefined).tone).toBe('neutral')
    expect(describeVersionReason('weird').tone).toBe('neutral')
  })

  it('formatVersionPages: 줄어든 경우만 화살표 문구를 붙인다', () => {
    expect(formatVersionPages({ pageCount: 9, nextPageCount: 5 })).toBe('9장 → 이후 5장으로 줄어듦')
    expect(formatVersionPages({ pageCount: 9, nextPageCount: 9 })).toBe('9장')
    expect(formatVersionPages({ pageCount: 9, nextPageCount: 17 })).toBe('9장')
    expect(formatVersionPages({ pageCount: 9, nextPageCount: null })).toBe('9장')
  })

  it('sortVersionsNewestFirst: 최신순, 원본 불변', () => {
    const list = [
      { id: 'a', createdAt: '2026-08-22T01:00:00.000Z' },
      { id: 'c', createdAt: '2026-08-22T03:00:00.000Z' },
      { id: 'b', createdAt: '2026-08-22T02:00:00.000Z' },
    ]
    const sorted = sortVersionsNewestFirst(list)
    expect(sorted.map((v) => v.id)).toEqual(['c', 'b', 'a'])
    expect(list.map((v) => v.id)).toEqual(['a', 'c', 'b'])
  })

  it('mergeRestoredSession: 응답 canvasData 가 정본, 게스트 토큰은 응답에 없으면 직전 것을 유지', () => {
    const prev = {
      id: 's1',
      guestToken: 'gt-1',
      canvasData: [{ old: true }],
      contentPdfFileId: 'pdf-1',
    } as unknown as EditSessionResponse
    const restored = {
      id: 's1',
      guestToken: null,
      canvasData: [{ a: 1 }, { b: 2 }],
    } as unknown as EditSessionResponse
    const merged = mergeRestoredSession(prev, restored)
    expect(merged.canvasData).toEqual([{ a: 1 }, { b: 2 }])
    expect(merged.guestToken).toBe('gt-1')
    expect(merged.contentPdfFileId).toBe('pdf-1')
    // 응답이 토큰을 주면 그것을 쓴다
    expect(mergeRestoredSession(prev, { ...restored, guestToken: 'gt-2' }).guestToken).toBe('gt-2')
    // 직전 세션 없음
    expect(mergeRestoredSession(null, restored).guestToken).toBeNull()
  })

  it('restoredCanvasCount: 배열=길이, 객체=1, 없음=null', () => {
    expect(restoredCanvasCount([{}, {}, {}])).toBe(3)
    expect(restoredCanvasCount({ objects: [] })).toBe(1)
    expect(restoredCanvasCount(null)).toBeNull()
    expect(restoredCanvasCount(undefined)).toBeNull()
  })
})
