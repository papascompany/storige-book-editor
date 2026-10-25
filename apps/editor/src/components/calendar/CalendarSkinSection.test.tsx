// @vitest-environment happy-dom
//
// 달력 패널 「디자인」 절 — 노출 조건·카드·사유·대화상자 문구·차단·취소·미리보기 비활성.
// 적용 오케스트레이터(prepare/execute/undo)는 대역으로 바꾸고 화면 동작만 본다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react'
import { summarizeSkinMergeReports, type SkinMergeSummary } from '@storige/canvas-core'
import type { ProductProfile } from '@storige/types'

const h = vi.hoisted(() => ({ prepare: vi.fn(), execute: vi.fn(), undo: vi.fn() }))
vi.mock('@/utils/calendarSkinApply', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/calendarSkinApply')>()),
  prepareSkinApply: (...a: unknown[]) => h.prepare(...a),
  executeSkinApply: (...a: unknown[]) => h.execute(...a),
  undoSkinApply: (...a: unknown[]) => h.undo(...a),
}))
vi.mock('@/hooks/useEditorContents', () => ({ applyCustomerLocks: vi.fn() }))

import CalendarSkinSection, { SKIN_PREVIEW_DISABLED_MESSAGE, SKIN_UNKNOWN_CURRENT_MESSAGE } from './CalendarSkinSection'
import { SKIN_POSITION_RESET_LINE, SKIN_UNDO_HISTORY_LINE, SKIN_UPLOADS_SESSION_NOTE } from './CalendarSkinConfirmModal'
import { useCalendarSkinStore } from '@/stores/useCalendarSkinStore'
import { useCalendarStore } from '@/stores/useCalendarStore'
import { useSaveStore } from '@/stores/useSaveStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import type { SkinApplyPlan } from '@/utils/calendarSkinApply'

const SKINS = [
  { key: 'spring', label: '봄', templateSetId: 'set-spring', thumbnailUrl: '/storage/files/s.png' },
  { key: 'winter', label: '겨울', templateSetId: 'set-winter' },
]

function profile(skins: typeof SKINS | [] = SKINS): ProductProfile {
  return {
    version: 1,
    kind: 'calendar',
    editorType: 'calendar_desk',
    pages: { kind: 'fixed', count: 26, labelRule: 'month' },
    sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'top-ring', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
    calendar: {
      layout: 'desk',
      monthCount: 12,
      coverCanvases: 1,
      canvasesPerMonth: 2,
      epilogueCanvases: 1,
      allowedRange: { from: '2027-01', to: '2027-12' },
      weekStart: 0,
      show: { holidays: true, lunar: false, solarTerms: false },
      dataVersion: 'kr-2025-2035-v1',
      skins,
    },
    output: { mode: 'single-pdf' },
  } as ProductProfile
}

function summary(over: Partial<SkinMergeSummary> = {}): SkinMergeSummary {
  return { ...summarizeSkinMergeReports([]), ...over }
}

function plan(over: Partial<SkinApplyPlan> = {}): SkinApplyPlan {
  return {
    targetKey: 'winter',
    label: '겨울',
    thumbnailUrl: null,
    prevSkinKey: undefined,
    from: [],
    to: [],
    templateIds: [],
    cur: [],
    summarySkin: summary(),
    summaryKeep: summary(),
    backgrounds: { keepOnSkinChoice: [false, false], forcedKeepIndices: [], editorForcedKeepIndices: [], removedCanvasIndices: [], uploadsByCanvas: [[], []] },
    showBackgroundChoice: false,
    pageLabels: ['표지', '1월 앞면', '1월 뒷면', '2월 앞면', '2월 뒷면'],
    anniversaryCount: 0,
    ...over,
  }
}

function setup(opts: { skins?: typeof SKINS | []; editMode?: boolean; base?: string | null; preview?: boolean } = {}) {
  act(() => {
    const p = profile(opts.skins ?? SKINS)
    useSettingsStore.getState().setProductProfile(p)
    useSettingsStore.setState({
      customerPreview: opts.preview ?? false,
      linkedPrintTemplates: [{ id: 't0', name: 't0', type: 'page', width: 1, height: 1, thumbnailUrl: '/storage/files/base.png' }],
      currentSettings: { ...useSettingsStore.getState().currentSettings, editMode: opts.editMode ?? false },
    } as never)
    useCalendarStore.getState().setFromProfile(p)
    useCalendarSkinStore.getState().reset()
    if (opts.base !== null) useCalendarSkinStore.getState().setBase(opts.base ?? 'base')
    useSaveStore.setState({ status: 'saved', isDirty: false } as never)
  })
}

const card = (label: string) => screen.getByRole('button', { name: `디자인 ${label}` })

async function clickCard(label: string) {
  await act(async () => {
    fireEvent.click(card(label))
  })
}

beforeEach(() => {
  h.prepare.mockReset()
  h.execute.mockReset()
  h.undo.mockReset()
  setup()
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('CalendarSkinSection — 노출 조건', () => {
  it('skins 있음 + 플래그 on + editMode 아님 + 기준 세트 id → 보인다', () => {
    render(<CalendarSkinSection />)
    expect(screen.getByRole('region', { name: '디자인' })).toBeTruthy()
  })

  it('skins 없음·플래그 off·editMode·기준 세트 id 미상·NULL 프로파일이면 숨긴다', () => {
    const variants: Array<() => void> = [
      () => setup({ skins: [] }),
      () => {
        setup()
        vi.stubEnv('VITE_ENABLE_CALENDAR_SKINS', 'false')
      },
      () => setup({ editMode: true }),
      () => setup({ base: null }),
      () => {
        setup()
        act(() => useSettingsStore.getState().setProductProfile(null))
      },
    ]
    for (const v of variants) {
      vi.unstubAllEnvs()
      v()
      const { container, unmount } = render(<CalendarSkinSection />)
      expect(container.innerHTML).toBe('')
      unmount()
    }
  })

  it('고객 미리보기 중에는 보이되 카드를 모두 막고 안내한다', () => {
    setup({ preview: true })
    render(<CalendarSkinSection />)
    expect(screen.getByText(SKIN_PREVIEW_DISABLED_MESSAGE)).toBeTruthy()
    for (const l of ['기본 디자인', '봄', '겨울']) expect((card(l) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('CalendarSkinSection — 카드', () => {
  it('기본 디자인 + skins 순서, 현재 디자인 강조(키 없음 = 기본 디자인), 썸네일 없으면 미리보기 없음', () => {
    render(<CalendarSkinSection />)
    const labels = screen.getAllByRole('button', { name: /^디자인 / }).map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual(['디자인 기본 디자인', '디자인 봄', '디자인 겨울'])
    expect(card('기본 디자인').getAttribute('aria-pressed')).toBe('true')
    expect(card('봄').getAttribute('aria-pressed')).toBe('false')
    expect(within(card('겨울')).getByText('미리보기 없음')).toBeTruthy()
    act(() => useCalendarStore.getState().setSkinKey('spring'))
    expect(card('봄').getAttribute('aria-pressed')).toBe('true')
    expect(card('기본 디자인').getAttribute('aria-pressed')).toBe('false')
  })

  it('skins 에 없는 skinKey 면 아무 카드도 강조하지 않고 "현재: 목록에 없는 디자인"', () => {
    act(() => useCalendarStore.getState().setSkinKey('gone'))
    render(<CalendarSkinSection />)
    expect(screen.getByText(SKIN_UNKNOWN_CURRENT_MESSAGE)).toBeTruthy()
    for (const l of ['기본 디자인', '봄', '겨울']) expect(card(l).getAttribute('aria-pressed')).toBe('false')
  })

  it('missing·incompatible 캐시 카드는 비활성 + 사유 툴팁, network 는 캐시하지 않고 안내만', async () => {
    act(() => {
      useCalendarSkinStore.getState().setCardReason('spring', 'missing')
      useCalendarSkinStore.getState().setCardReason('winter', 'incompatible')
    })
    const { unmount } = render(<CalendarSkinSection />)
    expect((card('봄') as HTMLButtonElement).disabled).toBe(true)
    expect(card('봄').getAttribute('title')).toBe('더 이상 제공되지 않는 디자인입니다')
    expect(card('겨울').getAttribute('title')).toBe('지금 상품과 맞지 않는 디자인입니다')
    unmount()
    setup()
    h.prepare.mockResolvedValue({ kind: 'rejected', reason: 'network' })
    render(<CalendarSkinSection />)
    await clickCard('겨울')
    expect(screen.getByText('디자인을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')).toBeTruthy()
    expect((card('겨울') as HTMLButtonElement).disabled).toBe(false)
    expect(useCalendarSkinStore.getState().phase).toBe('idle')
  })

  it('저장 중이면 조회하지 않고 안내한다', async () => {
    act(() => useSaveStore.setState({ status: 'saving' } as never))
    render(<CalendarSkinSection />)
    await clickCard('겨울')
    expect(h.prepare).not.toHaveBeenCalled()
    expect(screen.getByText('저장 중입니다. 잠시 후 다시 시도해 주세요.')).toBeTruthy()
  })

  it('현재 카드를 다시 누르면 아무 일도 없다', async () => {
    render(<CalendarSkinSection />)
    await clickCard('기본 디자인')
    expect(h.prepare).not.toHaveBeenCalled()
  })
})

describe('CalendarSkinSection — 확인 대화상자', () => {
  it('값이 0인 줄은 생략하고, 위치 초기화·실행 취소 기록 줄은 늘 보인다. 배경 블록은 고객 배경이 없으면 없다', async () => {
    h.prepare.mockResolvedValue({ kind: 'confirm', plan: plan({ summarySkin: summary({ photosKept: 2, photosClipRebuilt: 1, textsMoved: 1 }), anniversaryCount: 2 }) })
    render(<CalendarSkinSection />)
    await clickCard('겨울')
    const dialog = screen.getByRole('alertdialog', { name: '디자인 변경 확인' })
    expect(within(dialog).getByText('디자인을 「겨울」(으)로 바꿀까요?')).toBeTruthy()
    const items = within(dialog).getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual([
      '사진 3장은 그대로 옮깁니다.',
      '기념일 2건은 그대로 둡니다.',
      '수정한 문구 1건은 새 디자인의 같은 자리로 옮깁니다.',
      SKIN_POSITION_RESET_LINE,
      SKIN_UNDO_HISTORY_LINE,
    ])
    expect(within(dialog).queryByRole('group', { name: '배경 선택' })).toBeNull()
  })

  it('배경 블록: 강제 유지(forcedKeep) 쪽 안내·내 업로드 안내·skinBackgroundsReplaced 문구, 내 배경 유지를 고르면 keep 으로 실행', async () => {
    h.execute.mockResolvedValue({ kind: 'applied', label: '겨울', photosDropped: 0 })
    h.prepare.mockResolvedValue({
      kind: 'confirm',
      plan: plan({
        showBackgroundChoice: true,
        backgrounds: { keepOnSkinChoice: [false, true], forcedKeepIndices: [1, 2, 3, 4], editorForcedKeepIndices: [1], removedCanvasIndices: [0], uploadsByCanvas: [['u'], []] },
        summaryKeep: summary({ customerBackgroundsKept: 2, skinBackgroundsReplaced: 2 }),
      }),
    })
    render(<CalendarSkinSection />)
    await clickCard('겨울')
    const group = screen.getByRole('group', { name: '배경 선택' })
    const text = group.textContent ?? ''
    expect(text).toContain('내 배경을 넣은 1쪽은 새 디자인 배경으로 바꿉니다.')
    expect(text).toContain("업로드한 배경 1개는 '내 업로드'에 남습니다.")
    expect(text).toContain('1월 앞면, 1월 뒷면, 2월 앞면 외 1쪽은 내 배경을 다시 넣을 수 없는 형식이라 그대로 둡니다')
    expect(text).toContain(SKIN_UPLOADS_SESSION_NOTE)
    expect(text).toContain('내 배경 2쪽을 그대로 두고, 그 쪽의 새 디자인 배경 2개는 쓰지 않습니다.')
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[]
    expect(radios[0].checked).toBe(true)
    fireEvent.click(radios[1])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '바꾸기' }))
    })
    expect(h.execute).toHaveBeenCalledWith(expect.objectContaining({ targetKey: 'winter' }), 'keep')
  })

  it('blocked: 확인 버튼 없이 닫기만, 문구에 쪽 라벨', async () => {
    h.prepare.mockResolvedValue({ kind: 'blocked', plan: plan(), suspectIndices: [0, 3] })
    render(<CalendarSkinSection />)
    await clickCard('겨울')
    const dialog = screen.getByRole('alertdialog', { name: '디자인 적용 불가' })
    expect(within(dialog).getByText(/기존 디자인 요소를 구분하지 못한 쪽이 있습니다\(표지, 2월 앞면\)/)).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: '바꾸기' })).toBeNull()
    fireEvent.click(within(dialog).getAllByRole('button', { name: '닫기' })[1])
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(h.execute).not.toHaveBeenCalled()
    expect(useCalendarSkinStore.getState().phase).toBe('idle')
  })

  it('취소는 아무것도 바꾸지 않는다(실행 0회, idle)', async () => {
    h.prepare.mockResolvedValue({ kind: 'confirm', plan: plan() })
    render(<CalendarSkinSection />)
    await clickCard('겨울')
    expect(useCalendarSkinStore.getState().phase).toBe('confirm')
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(h.execute).not.toHaveBeenCalled()
    expect(useCalendarSkinStore.getState().phase).toBe('idle')
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('적용 뒤 「적용 취소」 버튼이 보이고 누르면 되돌린다', async () => {
    h.prepare.mockResolvedValue({ kind: 'confirm', plan: plan() })
    h.execute.mockImplementation(async () => {
      useCalendarSkinStore.getState().setUndo({ before: [], prevSkinKey: undefined, label: '겨울' })
      useCalendarSkinStore.getState().setPhase('applied')
      return { kind: 'applied', label: '겨울', photosDropped: 0 }
    })
    h.undo.mockResolvedValue(true)
    render(<CalendarSkinSection />)
    await clickCard('겨울')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '바꾸기' }))
    })
    expect(h.execute).toHaveBeenCalledWith(expect.anything(), 'skin')
    const undoButton = screen.getByRole('button', { name: '적용 취소' })
    await act(async () => {
      fireEvent.click(undoButton)
    })
    expect(h.undo).toHaveBeenCalledTimes(1)
    act(() => useCalendarSkinStore.getState().setPhase('idle'))
    expect(screen.queryByRole('button', { name: '적용 취소' })).toBeNull()
  })

  it('적용 직전 저장 실패 → 안내하고 idle', async () => {
    h.prepare.mockResolvedValue({ kind: 'confirm', plan: plan() })
    h.execute.mockResolvedValue({ kind: 'aborted', reason: 'save-failed' })
    render(<CalendarSkinSection />)
    await clickCard('겨울')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '바꾸기' }))
    })
    expect(screen.getByText('저장하지 못해 디자인을 바꾸지 않았습니다.')).toBeTruthy()
    expect(useCalendarSkinStore.getState().phase).toBe('idle')
  })

  it('fatal 이면 새로고침 안내 오버레이', () => {
    act(() => useCalendarSkinStore.getState().setPhase('fatal'))
    render(<CalendarSkinSection />)
    expect(screen.getByRole('alertdialog', { name: '화면 복구 실패' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '새로고침' })).toBeTruthy()
  })
})
