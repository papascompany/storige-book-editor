import { create } from 'zustand'
import {
  readPhotoItems,
  resolvePhotoItemCount,
  type PhotoItem,
  type PhotoPrintProfile,
  type ProductProfile,
} from '@storige/types'

/**
 * usePhotoPrintStore — 사진인화 세션 메타(`edit_sessions.metadata.items`) 순수 상태 (P2-d, 2026-10-19)
 *
 * - 템플릿셋 `productProfile.kind==='photo-print'` 일 때만 `profile` 이 채워진다(legacy·캘린더 세트는 null).
 * - UI·fabric 호출 없음. 캔버스 적용은 `utils/photoPrintRehydrate` 가 이 스토어를 읽어 수행한다.
 * - 항목 수는 캔버스 수에 종속된다(chemical N / digital ceil(N/2)) — `syncWithCanvasCount` 가 부족분을
 *   프로파일 기본값(허용 어휘 첫째·copies.min·플래그 false)으로 채우고 초과분을 **끝에서** 자른다.
 *   중간 사진 삭제는 `removeItem(photoIndex)` 로 그 항목만 빼고 index/canvasIndex 를 재부여한다(끝 잘림 금지 —
 *   api-sheetmap-1/tests-1: 삭제된 사진의 매수·옵션이 다음 사진으로 밀리지 않는다).
 * - `lowRes`(채움 시 dpi 판정)·`sourcePhotoId`(채움 원본 식별자)는 편집기가 `setItemMeta` 로 기록한다(런처 입력 echo 금지).
 * - 모든 쓰기는 `readPhotoItems(items, profile)` 로 재정제해 index/canvasIndex 재부여·copies 클램프·어휘 검증을 거친다.
 */

/** 항목별로 바꿀 수 있는 옵션(index/canvasIndex/sizeCode/lowRes 는 스토어·프로파일이 결정) */
export type PhotoItemOptionPatch = Partial<
  Pick<PhotoItem, 'copies' | 'border' | 'fit' | 'finish' | 'brightnessFix' | 'dateOverlay' | 'grayscale'>
>

/** 편집기가 채움 시점에 기록하는 항목 메타 — sourcePhotoId null/undefined = 키 제거 */
export interface PhotoItemMetaPatch {
  lowRes?: boolean
  sourcePhotoId?: string | null
}

/** 항목↔캔버스 매핑에 필요한 프로파일 조각(types 의 resolvePhotoItemCount/Canvas 인자) */
export type PhotoPrintMapping = Pick<ProductProfile, 'sheet' | 'photoPrint'>

export interface PhotoPrintStoreState {
  /** null = 사진인화 상품이 아님(legacy) */
  profile: PhotoPrintProfile | null
  /** 항목↔캔버스 매핑용 프로파일 조각(profile 과 함께 세팅) */
  mapping: PhotoPrintMapping | null
  /** 정제된 항목 목록(캔버스 수와 동기화 전에는 비어 있을 수 있다) */
  items: PhotoItem[]

  /** 프로파일로 초기화(항목은 빈 배열 — 캔버스 수 확정 뒤 syncWithCanvasCount 가 채운다). photo-print 가 아니면 reset */
  setFromProfile: (profile: ProductProfile | null | undefined) => void
  /**
   * 저장된 세션 `metadata.items`(런처 PhotoItemInput 부분형 가능) 복원 — readPhotoItems(input, profile) 로 정제.
   * @returns 1건 이상 복원했으면 true(프로파일 없음·배열 아님·빈 배열이면 false, 상태 불변)
   */
  restore: (input: unknown) => boolean
  /**
   * 캔버스 수에 항목 수를 맞춘다(부족분 기본 항목 추가·초과분 제거). canvasCount<1 이면 변경 없음.
   * @returns 동기화된 항목 목록(프로파일 없으면 [])
   */
  syncWithCanvasCount: (canvasCount: number) => PhotoItem[]
  setItemOption: (index: number, patch: PhotoItemOptionPatch) => void
  setCopies: (index: number, copies: number) => void
  /**
   * 사진 photoIndex 의 항목을 제거하고 뒤 항목의 index/canvasIndex 를 재부여한다(옵션·매수 보존).
   * 범위 밖·프로파일 없음이면 변경 없음. 삭제 뒤 캔버스 수 맞춤은 호출자가 syncWithCanvasCount 로.
   * @returns 제거했으면 true
   */
  removeItem: (photoIndex: number) => boolean
  /** 채움/교체 시 lowRes·sourcePhotoId 기록(sourcePhotoId null/undefined 면 키 제거). 범위 밖이면 무시 */
  setItemMeta: (index: number, patch: PhotoItemMetaPatch) => void
  /** 모든 항목에 같은 옵션 적용 */
  applyAll: (patch: PhotoItemOptionPatch) => void
  reset: () => void
}

function normalize(items: ReadonlyArray<Partial<PhotoItem>>, profile: PhotoPrintProfile): PhotoItem[] {
  return readPhotoItems(items, profile)
}

function defaultItem(profile: PhotoPrintProfile): PhotoItem {
  return readPhotoItems([{}], profile)[0]
}

export const usePhotoPrintStore = create<PhotoPrintStoreState>((set, get) => ({
  profile: null,
  mapping: null,
  items: [],

  setFromProfile: (profile) => {
    const photo = profile?.kind === 'photo-print' ? profile.photoPrint : undefined
    if (!profile || !photo) {
      set({ profile: null, mapping: null, items: [] })
      return
    }
    set({ profile: photo, mapping: { sheet: profile.sheet, photoPrint: photo }, items: [] })
  },

  restore: (input) => {
    const { profile } = get()
    if (!profile || !Array.isArray(input)) return false
    const items = readPhotoItems(input, profile)
    if (items.length === 0) return false
    set({ items })
    return true
  },

  syncWithCanvasCount: (canvasCount) => {
    const { profile, mapping, items } = get()
    if (!profile || !mapping) return []
    if (!Number.isInteger(canvasCount) || canvasCount < 1) return items
    const target = resolvePhotoItemCount(mapping, canvasCount)
    if (items.length === target) return items
    const next: Partial<PhotoItem>[] = items.slice(0, target)
    while (next.length < target) next.push(defaultItem(profile))
    const synced = normalize(next, profile)
    set({ items: synced })
    return synced
  },

  setItemOption: (index, patch) => {
    const { profile, items } = get()
    if (!profile || !Number.isInteger(index) || index < 0 || index >= items.length) return
    set({ items: normalize(items.map((it, i) => (i === index ? { ...it, ...patch } : it)), profile) })
  },

  setCopies: (index, copies) => {
    get().setItemOption(index, { copies })
  },

  removeItem: (photoIndex) => {
    const { profile, items } = get()
    if (!profile || !Number.isInteger(photoIndex) || photoIndex < 0 || photoIndex >= items.length) return false
    set({ items: normalize(items.filter((_, i) => i !== photoIndex), profile) })
    return true
  },

  setItemMeta: (index, patch) => {
    const { profile, items } = get()
    if (!profile || !Number.isInteger(index) || index < 0 || index >= items.length) return
    set({
      items: normalize(
        items.map((it, i) => {
          if (i !== index) return it
          const next: Partial<PhotoItem> = { ...it }
          delete next.sourcePhotoId
          if (patch.lowRes !== undefined) next.lowRes = patch.lowRes
          const source = patch.sourcePhotoId === undefined ? it.sourcePhotoId : patch.sourcePhotoId
          if (typeof source === 'string' && source.length > 0) next.sourcePhotoId = source
          return next
        }),
        profile,
      ),
    })
  },

  applyAll: (patch) => {
    const { profile, items } = get()
    if (!profile || items.length === 0) return
    set({ items: normalize(items.map((it) => ({ ...it, ...patch })), profile) })
  },

  reset: () => set({ profile: null, mapping: null, items: [] }),
}))
