import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { EditStatus, TemplateType, BindingType, BINDING_CONSTRAINTS } from '@storige/types'
import type { EditSession, EditPage, CanvasData } from '@storige/types'

/**
 * 에디터 세션 상태 관리
 * - 편집 세션 정보
 * - 페이지 목록
 * - 현재 페이지 인덱스
 * - 편집 상태 (draft/review/submitted)
 */

interface EditorState {
  // 세션 정보
  sessionId: string | null
  session: EditSession | null
  templateSetId: string | null
  orderId: string | null
  userId: string | null

  // 페이지 관리
  pages: EditPage[]
  currentPageIndex: number

  // 편집 상태
  status: EditStatus
  isLocked: boolean
  lockedBy: string | null
  lockedAt: Date | null

  // 로딩/에러 상태
  isLoading: boolean
  error: string | null

  // 템플릿셋 정보
  templateSetName: string | null
  canAddPage: boolean
  pageCountRange: number[]
  // A13: 제본 방식(설정 시에만 제본별 최소/최대 페이지 가드 적용. null=제약 없음 — 비제본/미설정 상품 무영향)
  bindingType: BindingType | null
  /**
   * 캔버스 1장이 담는 **물리 페이지 수**. 낱장 내지=1, 펼침면(2-up) 내지=2.
   * pageCountRange·제본 제약은 물리 페이지 기준이라, 펼침면 세션에서 캔버스 수를 그대로
   * 비교하면 상한/하한이 정확히 절반으로 잘못 걸린다(2026-08-03).
   */
  pagesPerCanvas: number
}

interface EditorActions {
  // 세션 관리
  setSession: (session: EditSession) => void
  clearSession: () => void

  // 페이지 관리
  setPages: (pages: EditPage[]) => void
  setCurrentPageIndex: (index: number) => void
  goToPage: (index: number) => void
  goToNextPage: () => void
  goToPrevPage: () => void

  // 페이지 CRUD
  addPage: (page: EditPage, position?: number) => void
  updatePage: (pageId: string, data: Partial<EditPage>) => void
  updatePageCanvasData: (pageId: string, canvasData: CanvasData) => void
  deletePage: (pageId: string) => void
  reorderPages: (pageIds: string[]) => void

  // 상태 관리
  setStatus: (status: EditStatus) => void
  setLock: (lockedBy: string | null, lockedAt: Date | null) => void

  // 로딩/에러
  setLoading: (isLoading: boolean) => void
  setError: (error: string | null) => void

  // 헬퍼
  getCurrentPage: () => EditPage | null
  getPageById: (pageId: string) => EditPage | null
  getPagesByType: (type: TemplateType) => EditPage[]
  getPageCount: () => number
  canDeletePage: (pageId: string) => boolean
  canAddMorePages: () => boolean
}

const initialState: EditorState = {
  sessionId: null,
  session: null,
  templateSetId: null,
  orderId: null,
  userId: null,
  pages: [],
  currentPageIndex: 0,
  status: EditStatus.DRAFT,
  isLocked: false,
  lockedBy: null,
  lockedAt: null,
  isLoading: false,
  error: null,
  templateSetName: null,
  canAddPage: true,
  pageCountRange: [1, 100],
  bindingType: null,
  pagesPerCanvas: 1,
}

export const useEditorStore = create<EditorState & EditorActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      // 세션 관리
      setSession: (session: EditSession) => {
        set({
          sessionId: session.id,
          session,
          templateSetId: session.templateSetId || null,
          orderId: session.orderId || null,
          userId: session.userId || null,
          pages: session.pages || [],
          status: session.status || EditStatus.DRAFT,
          isLocked: !!session.lockedBy,
          lockedBy: session.lockedBy || null,
          lockedAt: session.lockedAt ? new Date(session.lockedAt) : null,
          currentPageIndex: 0,
          isLoading: false,
          error: null,
        })
      },

      clearSession: () => {
        set(initialState)
      },

      // 페이지 관리
      setPages: (pages: EditPage[]) => {
        set({ pages })
      },

      setCurrentPageIndex: (index: number) => {
        const { pages } = get()
        if (index >= 0 && index < pages.length) {
          set({ currentPageIndex: index })
        }
      },

      goToPage: (index: number) => {
        get().setCurrentPageIndex(index)
      },

      goToNextPage: () => {
        const { currentPageIndex, pages } = get()
        if (currentPageIndex < pages.length - 1) {
          set({ currentPageIndex: currentPageIndex + 1 })
        }
      },

      goToPrevPage: () => {
        const { currentPageIndex } = get()
        if (currentPageIndex > 0) {
          set({ currentPageIndex: currentPageIndex - 1 })
        }
      },

      // 페이지 CRUD
      addPage: (page: EditPage, position?: number) => {
        const { pages } = get()
        const newPages = [...pages]

        if (position !== undefined && position >= 0 && position <= pages.length) {
          newPages.splice(position, 0, page)
        } else {
          newPages.push(page)
        }

        // sortOrder 재계산
        newPages.forEach((p, i) => {
          p.sortOrder = i
        })

        set({ pages: newPages })
      },

      updatePage: (pageId: string, data: Partial<EditPage>) => {
        const { pages } = get()
        const newPages = pages.map((page) =>
          page.id === pageId ? { ...page, ...data } : page
        )
        set({ pages: newPages })
      },

      updatePageCanvasData: (pageId: string, canvasData: CanvasData) => {
        const { pages } = get()
        const newPages = pages.map((page) =>
          page.id === pageId ? { ...page, canvasData } : page
        )
        set({ pages: newPages })
      },

      deletePage: (pageId: string) => {
        const { pages, currentPageIndex } = get()
        const pageIndex = pages.findIndex((p) => p.id === pageId)

        if (pageIndex === -1) return

        const newPages = pages.filter((p) => p.id !== pageId)

        // sortOrder 재계산
        newPages.forEach((p, i) => {
          p.sortOrder = i
        })

        // 현재 페이지 인덱스 조정
        let newCurrentIndex = currentPageIndex
        if (pageIndex <= currentPageIndex && currentPageIndex > 0) {
          newCurrentIndex = currentPageIndex - 1
        }
        if (newCurrentIndex >= newPages.length) {
          newCurrentIndex = newPages.length - 1
        }

        set({
          pages: newPages,
          currentPageIndex: Math.max(0, newCurrentIndex),
        })
      },

      reorderPages: (pageIds: string[]) => {
        const { pages } = get()
        const pageMap = new Map(pages.map((p) => [p.id, p]))

        const reorderedPages: EditPage[] = []
        for (const id of pageIds) {
          const page = pageMap.get(id)
          if (page) {
            reorderedPages.push(page)
          }
        }

        // sortOrder 재계산
        reorderedPages.forEach((p, i) => {
          p.sortOrder = i
        })

        set({ pages: reorderedPages })
      },

      // 상태 관리
      setStatus: (status: EditStatus) => {
        set({ status })
      },

      setLock: (lockedBy: string | null, lockedAt: Date | null) => {
        set({
          isLocked: !!lockedBy,
          lockedBy,
          lockedAt,
        })
      },

      // 로딩/에러
      setLoading: (isLoading: boolean) => {
        set({ isLoading })
      },

      setError: (error: string | null) => {
        set({ error })
      },

      // 헬퍼
      getCurrentPage: () => {
        const { pages, currentPageIndex } = get()
        return pages[currentPageIndex] || null
      },

      getPageById: (pageId: string) => {
        const { pages } = get()
        return pages.find((p) => p.id === pageId) || null
      },

      getPagesByType: (type: TemplateType) => {
        const { pages } = get()
        return pages.filter((p) => p.templateType === type)
      },

      getPageCount: () => {
        return get().pages.length
      },

      canDeletePage: (pageId: string) => {
        const { pages, pageCountRange, bindingType, pagesPerCanvas } = get()
        const page = pages.find((p) => p.id === pageId)

        if (!page) return false
        if (!page.deleteable) return false
        if (page.required) return false

        // 내지(page) 타입인 경우 최소 수량 체크
        if (page.templateType === TemplateType.PAGE) {
          const canvasCount = pages.filter((p) => p.templateType === TemplateType.PAGE).length
          // 펼침면 세션은 캔버스 1장 = 2p → 물리 페이지로 환산해 제약과 비교한다.
          const physicalCount = canvasCount * (pagesPerCanvas || 1)
          // A13: 제본 최소페이지(무선 32p 등) — bindingType 설정 시에만 적용(null=제약 없음).
          //   pageCountRange 최소와 제본 최소 중 큰 값 미만으로는 삭제 불가.
          const bindMin = bindingType ? (BINDING_CONSTRAINTS[bindingType]?.minPages ?? 0) : 0
          const minCount = Math.max(pageCountRange[0] || 1, bindMin)
          // 한 장 지우면 pagesPerCanvas 만큼 줄어든다 — 지운 뒤에도 최소를 만족해야 허용
          return physicalCount - (pagesPerCanvas || 1) >= minCount
        }

        return true
      },

      canAddMorePages: () => {
        const { pages, canAddPage, pageCountRange, bindingType, pagesPerCanvas } = get()

        if (!canAddPage) return false

        const canvasCount = pages.filter((p) => p.templateType === TemplateType.PAGE).length
        const per = pagesPerCanvas || 1
        const physicalCount = canvasCount * per
        // A13: 제본 최대페이지(중철 64p 등) — bindingType 설정 시에만 적용(null=제약 없음).
        const bindMax = bindingType ? (BINDING_CONSTRAINTS[bindingType]?.maxPages ?? Infinity) : Infinity
        const maxCount = Math.min(pageCountRange[pageCountRange.length - 1] || 100, bindMax)

        // 한 장 추가하면 per 만큼 늘어난다 — 추가 후에도 최대를 넘지 않아야 허용
        return physicalCount + per <= maxCount
      },
    }),
    {
      name: 'editor-session-storage',
      partialize: (state) => ({
        sessionId: state.sessionId,
        currentPageIndex: state.currentPageIndex,
      }),
    }
  )
)

// Selector hooks
export const useCurrentPage = () =>
  useEditorStore((state) => state.pages[state.currentPageIndex])

export const usePageCount = () =>
  useEditorStore((state) => state.pages.length)

export const useCanAddPage = () =>
  useEditorStore((state) => state.canAddMorePages())

export const useIsLocked = () =>
  useEditorStore((state) => state.isLocked)

export const useEditStatus = () =>
  useEditorStore((state) => state.status)
