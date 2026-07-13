import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useLibraryPanel } from './useLibraryPanel'

// --- store mocks -------------------------------------------------------------
// templateSetId 를 테스트별로 바꿀 수 있게 가변 변수로 보관.
let mockTemplateSetId: string | null = null
let mockIsCustomer = true
// A1-4: 관리자(editMode) fetch 게이트 완화 검증용 — 실스토어 기본값에 기대지 않고 명시 mock.
let mockEditMode = false

vi.mock('@/stores/useEditorStore', () => ({
  useEditorStore: (selector: (s: { templateSetId: string | null }) => unknown) =>
    selector({ templateSetId: mockTemplateSetId }),
}))

vi.mock('@/stores/useAuthStore', () => ({
  useIsCustomer: () => mockIsCustomer,
}))

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: (selector: (s: { currentSettings: { editMode: boolean } }) => unknown) =>
    selector({ currentSettings: { editMode: mockEditMode } }),
}))

// fetcher 헬퍼: success 응답 + 지정 items
const ok = (items: unknown[]) => ({ success: true, data: { items, total: items.length } })

describe('useLibraryPanel', () => {
  beforeEach(() => {
    mockTemplateSetId = null
    mockIsCustomer = true
    mockEditMode = false
    vi.clearAllMocks()
  })

  it('비고객이고 editMode 도 아니면(isCustomer=false && editMode=false) fetcher 를 호출하지 않는다', async () => {
    mockIsCustomer = false
    mockEditMode = false
    const fetcher = vi.fn().mockResolvedValue(ok([]))
    renderHook(() => useLibraryPanel({ fetcher }))
    // 약간 대기 후에도 호출 0
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('비고객이라도 editMode=true(관리자 템플릿 제작)면 fetcher 를 호출한다 (A1-4)', async () => {
    mockIsCustomer = false
    mockEditMode = true
    const fetcher = vi.fn().mockResolvedValue(ok([{ id: '1', name: 'A' }]))
    const { result } = renderHook(() => useLibraryPanel({ fetcher }))

    await waitFor(() => expect(result.current.contents.length).toBe(1))
    expect(fetcher).toHaveBeenCalled()
    expect(result.current.contents[0]).toMatchObject({ id: '1', name: 'A' })
  })

  it('마운트 시 콘텐츠를 조회하고 contents 에 반영한다', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok([{ id: '1', name: 'A' }]))
    const { result } = renderHook(() => useLibraryPanel({ fetcher }))

    await waitFor(() => expect(result.current.contents.length).toBe(1))
    expect(result.current.contents[0]).toMatchObject({ id: '1', name: 'A' })
    expect(result.current.loadingContents).toBe(false)
  })

  it('enableTags=true 면 마운트 시 태그를 디스커버해 정렬·중복제거한다', async () => {
    const fetcher = vi
      .fn()
      // 첫 호출(태그 디스커버리, pageSize=100)
      .mockResolvedValueOnce(
        ok([
          { id: '1', tags: ['하트', '별'] },
          { id: '2', tags: ['별', '사랑'] },
        ]),
      )
      // 이후 콘텐츠 조회
      .mockResolvedValue(ok([{ id: '1' }]))

    const { result } = renderHook(() => useLibraryPanel({ fetcher }))

    await waitFor(() => expect(result.current.availableTags.length).toBeGreaterThan(0))
    // 중복 제거 + ko 정렬
    expect(result.current.availableTags).toEqual(['별', '사랑', '하트'])
  })

  it('enableTags=false 면 태그 디스커버리를 하지 않고 availableTags 는 항상 빈 배열', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok([{ id: '1', tags: ['별'] }]))
    const { result } = renderHook(() =>
      useLibraryPanel({ fetcher, enableTags: false }),
    )

    await waitFor(() => expect(result.current.contents.length).toBe(1))
    expect(result.current.availableTags).toEqual([])
    // 콘텐츠 조회 시 tags 파라미터를 보내지 않아야 한다
    const lastCall = fetcher.mock.calls.at(-1)?.[0]
    expect(lastCall?.tags).toBeUndefined()
  })

  it('태그 선택 시 fetcher 에 tags=[선택값] 으로 재조회한다', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(ok([{ id: '1', tags: ['별'] }])) // discovery
      .mockResolvedValue(ok([{ id: '1' }]))

    const { result } = renderHook(() => useLibraryPanel({ fetcher }))
    await waitFor(() => expect(result.current.availableTags).toContain('별'))

    act(() => result.current.setSelectedTag('별'))

    await waitFor(() => {
      const lastCall = fetcher.mock.calls.at(-1)?.[0]
      expect(lastCall?.tags).toEqual(['별'])
    })
    expect(result.current.hasActiveFilter).toBe(true)
  })

  it('templateSetId 큐레이션 결과가 0건이면 전역으로 폴백 재조회한다', async () => {
    mockTemplateSetId = 'set-123'
    const fetcher = vi
      .fn()
      // 1) 큐레이션 조회 → 0건
      .mockResolvedValueOnce(ok([]))
      // 2) 전역 폴백 → 1건
      .mockResolvedValueOnce(ok([{ id: 'g1', name: '전역' }]))

    const { result } = renderHook(() =>
      useLibraryPanel({ fetcher, enableTags: false }),
    )

    await waitFor(() => expect(result.current.contents.length).toBe(1))
    expect(result.current.contents[0]).toMatchObject({ id: 'g1' })

    // 1차는 templateSetId 포함, 2차(폴백)는 templateSetId 미포함
    expect(fetcher.mock.calls[0][0]).toMatchObject({ templateSetId: 'set-123' })
    expect(fetcher.mock.calls[1][0].templateSetId).toBeUndefined()
  })

  it('검색어가 2자 미만이면 search 파라미터를 보내지 않는다', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok([{ id: '1' }]))
    const { result } = renderHook(() =>
      useLibraryPanel({ fetcher, enableTags: false }),
    )
    await waitFor(() => expect(fetcher).toHaveBeenCalled())

    act(() => result.current.handleSearch({ type: 'name', keyword: 'a' }))
    // 디바운스(300ms) 경과 대기
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400))
    })

    const lastCall = fetcher.mock.calls.at(-1)?.[0]
    expect(lastCall?.search).toBeUndefined()
  })

  it('검색어가 2자 이상이면 디바운스 후 search 파라미터로 재조회한다', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok([{ id: '1' }]))
    const { result } = renderHook(() =>
      useLibraryPanel({ fetcher, enableTags: false }),
    )
    await waitFor(() => expect(fetcher).toHaveBeenCalled())

    act(() => result.current.handleSearch({ type: 'name', keyword: '하트' }))

    await waitFor(() => {
      const lastCall = fetcher.mock.calls.at(-1)?.[0]
      expect(lastCall?.search).toBe('하트')
    })
    expect(result.current.hasActiveFilter).toBe(true)
  })
})
