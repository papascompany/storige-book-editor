import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * 최근 사용 색상 stack — 사용자가 색상을 적용할 때마다 자동 누적.
 * 기존 사용자 저장 색상(`storige-color-presets`)과 별도로 관리되며,
 * push 시 자동으로 가장 오래된 항목이 제거된다 (FIFO 큐, 최대 16개).
 *
 * 정규화: hex(#rrggbb 또는 #rgb) / rgb / rgba 입력을 받아 hex 6자리 + opacity 분리.
 * 'mixed' 같은 sentinel은 push하지 않음.
 */

const MAX_RECENT = 16

/** rgb / rgba / 짧은 hex(#rgb)를 6자리 hex로 정규화. 'mixed' 등 무효 값은 null. */
export function normalizeToHex(color: string | undefined | null): string | null {
  if (!color) return null
  const c = String(color).trim().toLowerCase()
  if (!c || c === 'mixed' || c === 'transparent') return null

  // #rrggbb
  if (/^#[0-9a-f]{6}$/.test(c)) return c
  // #rgb → #rrggbb
  if (/^#[0-9a-f]{3}$/.test(c)) {
    return '#' + c.slice(1).split('').map((ch) => ch + ch).join('')
  }
  // rgb(r,g,b) or rgba(r,g,b,a)
  const m = c.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  if (m) {
    const r = Math.max(0, Math.min(255, parseInt(m[1], 10)))
    const g = Math.max(0, Math.min(255, parseInt(m[2], 10)))
    const b = Math.max(0, Math.min(255, parseInt(m[3], 10)))
    const toHex = (n: number) => n.toString(16).padStart(2, '0')
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`
  }
  return null
}

interface RecentColorsState {
  recent: string[] // hex(#rrggbb) 정규화된 색상
  push: (color: string) => void
  clear: () => void
}

export const useRecentColorsStore = create<RecentColorsState>()(
  persist(
    (set) => ({
      recent: [],
      push: (color) => {
        const hex = normalizeToHex(color)
        if (!hex) return
        set((s) => {
          // 이미 있으면 제일 앞으로 옮김 (LRU)
          const filtered = s.recent.filter((c) => c !== hex)
          return { recent: [hex, ...filtered].slice(0, MAX_RECENT) }
        })
      },
      clear: () => set({ recent: [] }),
    }),
    {
      name: 'storige-recent-colors',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    }
  )
)
