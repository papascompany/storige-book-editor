import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createLongPressTracker,
  isTouchEnv,
  LONG_PRESS_MS,
  LONG_PRESS_MOVE_TOLERANCE_PX,
  resolveTouchDropTarget,
  sidePanelContainerClass,
  type RowRect,
} from './layerTouchSheet'

// -----------------------------------------------------------------------------
// L6-③: 롱프레스 판정 상태기 — 타이머 활성 / 이동 취소 / end 정리
// -----------------------------------------------------------------------------
describe('createLongPressTracker — 롱프레스 판정 (L6)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('임계 시간(350ms) 경과 시 onActivate 1회 호출 + active 전환', () => {
    const onActivate = vi.fn()
    const tracker = createLongPressTracker({ onActivate })
    tracker.start(100, 100)
    expect(tracker.isPending()).toBe(true)
    expect(tracker.isActive()).toBe(false)

    vi.advanceTimersByTime(LONG_PRESS_MS - 1)
    expect(onActivate).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(tracker.isActive()).toBe(true)
    expect(tracker.isPending()).toBe(false)
  })

  it('활성 전 허용 반경 초과 이동 = 취소(스크롤 양보) — 타이머도 발화하지 않는다', () => {
    const onActivate = vi.fn()
    const tracker = createLongPressTracker({ onActivate })
    tracker.start(100, 100)

    // 반경 이내 이동은 pending 유지
    expect(tracker.move(100 + LONG_PRESS_MOVE_TOLERANCE_PX, 100)).toBe('pending')
    // 반경 초과 → cancelled
    expect(tracker.move(100, 100 + LONG_PRESS_MOVE_TOLERANCE_PX + 1)).toBe('cancelled')
    expect(tracker.isPending()).toBe(false)

    vi.advanceTimersByTime(LONG_PRESS_MS * 2)
    expect(onActivate).not.toHaveBeenCalled()
    expect(tracker.isActive()).toBe(false)
    // 취소 후 move 는 idle
    expect(tracker.move(0, 0)).toBe('idle')
  })

  it('활성 후 move 는 active 를 반환(드래그 모드 유지, 반경 무관)', () => {
    const tracker = createLongPressTracker({ onActivate: () => {} })
    tracker.start(0, 0)
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(tracker.move(500, 500)).toBe('active')
  })

  it('cancel(touchend/touchcancel) 은 타이머·상태를 모두 정리한다', () => {
    const onActivate = vi.fn()
    const tracker = createLongPressTracker({ onActivate })
    tracker.start(10, 10)
    tracker.cancel()
    vi.advanceTimersByTime(LONG_PRESS_MS * 2)
    expect(onActivate).not.toHaveBeenCalled()
    expect(tracker.isActive()).toBe(false)
    expect(tracker.isPending()).toBe(false)
  })

  it('start 재호출은 이전 타이머를 리셋한다(마지막 start 기준으로만 활성)', () => {
    const onActivate = vi.fn()
    const tracker = createLongPressTracker({ onActivate })
    tracker.start(0, 0)
    vi.advanceTimersByTime(LONG_PRESS_MS - 50)
    tracker.start(5, 5)
    vi.advanceTimersByTime(LONG_PRESS_MS - 1)
    expect(onActivate).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('delayMs/tolerancePx 옵션 오버라이드 존중', () => {
    const onActivate = vi.fn()
    const tracker = createLongPressTracker({ onActivate, delayMs: 100, tolerancePx: 2 })
    tracker.start(0, 0)
    expect(tracker.move(3, 0)).toBe('cancelled')
    tracker.start(0, 0)
    vi.advanceTimersByTime(100)
    expect(onActivate).toHaveBeenCalledTimes(1)
  })
})

// -----------------------------------------------------------------------------
// L6-③: 드롭 대상 판정 — 데스크톱 S3 와 동일 시맨틱(상단 절반=above/front)
// -----------------------------------------------------------------------------
describe('resolveTouchDropTarget — 삽입 위치 판정 (L6)', () => {
  // 목록은 z-order reverse: 위 = 맨앞. 행 높이 40, 간격 없음 가정.
  const rows: RowRect[] = [
    { id: 'front', top: 0, height: 40 },
    { id: 'mid', top: 40, height: 40 },
    { id: 'back', top: 80, height: 40 },
  ]

  it('행 상단 절반 = above(앞으로), 하단 절반 = 뒤로', () => {
    expect(resolveTouchDropTarget(45, rows, 'front')).toEqual({ targetId: 'mid', above: true })
    expect(resolveTouchDropTarget(75, rows, 'front')).toEqual({ targetId: 'mid', above: false })
  })

  it('source 행 자신은 대상에서 제외한다', () => {
    // mid 행 내부지만 source=mid → 가장 가까운 다른 행으로
    const result = resolveTouchDropTarget(45, rows, 'mid')
    expect(result?.targetId).not.toBe('mid')
    expect(result).toEqual({ targetId: 'front', above: false })
  })

  it('목록 위/아래 여백은 가장 가까운 행 기준으로 판정한다', () => {
    expect(resolveTouchDropTarget(-30, rows, 'back')).toEqual({ targetId: 'front', above: true })
    expect(resolveTouchDropTarget(500, rows, 'front')).toEqual({ targetId: 'back', above: false })
  })

  it('대상 후보가 없으면 null (단일 행 목록에서 자기 자신 드래그)', () => {
    expect(resolveTouchDropTarget(20, [{ id: 'only', top: 0, height: 40 }], 'only')).toBeNull()
    expect(resolveTouchDropTarget(20, [], 'any')).toBeNull()
  })
})

// -----------------------------------------------------------------------------
// L6-①: 시트 렌더 분기 — TOUCH_ENV mock (matchMedia) + 컨테이너 클래스 분기
// -----------------------------------------------------------------------------
describe('isTouchEnv — TOUCH_ENV 판정 (L6)', () => {
  const originalMatchMedia = window.matchMedia

  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })

  it('(pointer: coarse) 매치 시 true', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia
    expect(isTouchEnv()).toBe(true)
    expect(window.matchMedia).toHaveBeenCalledWith('(pointer: coarse)')
  })

  it('미매치 시 false, matchMedia 부재/예외 시에도 false(안전 기본값)', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia
    expect(isTouchEnv()).toBe(false)

    window.matchMedia = undefined as unknown as typeof window.matchMedia
    expect(isTouchEnv()).toBe(false)

    window.matchMedia = vi.fn(() => {
      throw new Error('unsupported')
    }) as unknown as typeof window.matchMedia
    expect(isTouchEnv()).toBe(false)
  })
})

describe('sidePanelContainerClass — 바텀시트/우측 패널 분기 (L6)', () => {
  it('터치: 하단 고정 바텀시트(55vh) — show 에 따라 translate-y 전환', () => {
    const shown = sidePanelContainerClass(true, true)
    expect(shown).toContain('bottom-0')
    expect(shown).toContain('h-[55vh]')
    expect(shown).toContain('rounded-t-2xl')
    expect(shown).toContain('translate-y-0')
    expect(shown).not.toContain('w-[220px]')

    const hidden = sidePanelContainerClass(true, false)
    expect(hidden).toContain('translate-y-full')
    expect(hidden).toContain('pointer-events-none')
  })

  it('데스크톱: 기존 우측 220px 슬라이드 문자열 무변경(스냅샷 동결)', () => {
    // ⚠️ 이 두 값은 L6 이전 SidePanel 의 cn(...) 결과와 byte-identical 해야 한다 —
    // 데스크톱 시각 무변경 불변(변경 시 의도적 데스크톱 리디자인인지 확인할 것).
    // show=true 는 twMerge 가 right-[-220px] 를 right-0 으로 병합(기존 cn 동작 그대로)
    expect(sidePanelContainerClass(false, true)).toBe(
      'sidePanel w-[220px] h-[calc(100%-80px)] flex flex-col gap-2 bg-editor-panel fixed transition-all duration-300 ease-in-out z-[99] shadow-[-2.2px_0_3.2px_0_rgba(0,0,0,0.02)] overflow-hidden right-0'
    )
    expect(sidePanelContainerClass(false, false)).toBe(
      'sidePanel w-[220px] h-[calc(100%-80px)] flex flex-col gap-2 bg-editor-panel fixed right-[-220px] transition-all duration-300 ease-in-out z-[99] shadow-[-2.2px_0_3.2px_0_rgba(0,0,0,0.02)] overflow-hidden'
    )
  })

  it('시트는 데스크톱과 달리 좌우 풀폭 고정', () => {
    const sheet = sidePanelContainerClass(true, true)
    expect(sheet).toContain('left-0')
    expect(sheet).toContain('right-0')
    expect(sheet).toContain('w-full')
  })
})
