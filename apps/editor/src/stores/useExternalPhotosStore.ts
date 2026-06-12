/**
 * D1 외부 사진 주입 스토어 (2026-06-12, EDITOR.md §20.1).
 *
 * 호스트(예: ShareSnap 공유방)가 세션 metadata.externalPhotos 로 주입한 사진 목록.
 * - embed.tsx 가 세션 로드 시 setPhotos() 로 채움.
 * - 목록이 비어있지 않으면 이미지 패널(AppImage)에 "공유방 사진" 탭이 조건부 렌더.
 * - usageTick: 캔버스 배치/삭제 시 증가 → '사용됨' 뱃지 재계산 트리거.
 */
import { create } from 'zustand'
import type { ExternalPhoto } from '@storige/types'

interface ExternalPhotosState {
  photos: ExternalPhoto[]
  usageTick: number
}

interface ExternalPhotosActions {
  setPhotos: (photos: ExternalPhoto[]) => void
  bumpUsage: () => void
  reset: () => void
}

export const useExternalPhotosStore = create<ExternalPhotosState & ExternalPhotosActions>((set) => ({
  photos: [],
  usageTick: 0,
  setPhotos: (photos) => set({ photos: Array.isArray(photos) ? photos.filter((p) => p && typeof p.url === 'string' && p.url) : [] }),
  bumpUsage: () => set((s) => ({ usageTick: s.usageTick + 1 })),
  reset: () => set({ photos: [], usageTick: 0 }),
}))

/**
 * 모든 캔버스를 스캔해 externalPhotoUrl 이 일치하는 이미지 객체가 있는지 검사.
 * (그룹 내부까지는 v1 미탐색 — 공유방 사진은 직접 배치가 기본 경로)
 */
export function isPhotoUsed(allCanvas: Array<{ getObjects: () => Array<Record<string, unknown>> }>, url: string): boolean {
  for (const canvas of allCanvas) {
    try {
      const objs = canvas.getObjects()
      for (const obj of objs) {
        if ((obj as { externalPhotoUrl?: string }).externalPhotoUrl === url) return true
      }
    } catch {
      /* dispose 된 캔버스 무시 */
    }
  }
  return false
}
