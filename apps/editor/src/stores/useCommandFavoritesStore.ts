import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * CommandPalette 즐겨찾기 액션 store (DD-4).
 *
 * 사용자가 자주 쓰는 액션을 ❤로 핀하면, CommandPalette 검색 결과 상단에
 * 별도 "★ 즐겨찾기" 그룹으로 표시되어 빠른 접근이 가능.
 *
 * 정책
 * - actionId(string) Set 영속 (zustand persist v1)
 * - 토글 방식: 핀되어 있으면 제거, 없으면 추가
 * - 빈 상태(0개)에서 즐겨찾기 그룹은 hidden
 * - 핀 액션과 일반 액션은 별도 그룹에 동시 노출 (즐겨찾기 그룹 우선)
 */

interface State {
  ids: string[]  // 핀된 actionId 목록 (Set 대신 array — JSON 직렬화 친화)
  toggle: (id: string) => void
  isFavorite: (id: string) => boolean
  clear: () => void
}

export const useCommandFavoritesStore = create<State>()(
  persist(
    (set, get) => ({
      ids: [],
      toggle: (id) => {
        const current = get().ids
        if (current.includes(id)) {
          set({ ids: current.filter((x) => x !== id) })
        } else {
          set({ ids: [...current, id] })
        }
      },
      isFavorite: (id) => get().ids.includes(id),
      clear: () => set({ ids: [] }),
    }),
    {
      name: 'storige-command-favorites',
      version: 1,
    }
  )
)
