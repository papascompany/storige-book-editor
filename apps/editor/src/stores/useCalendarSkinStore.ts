import { create } from 'zustand'

/**
 * useCalendarSkinStore — 캘린더 디자인(스킨) 적용의 세션 메모리 상태(직렬화 없음)
 *
 * - `baseTemplateSetId`: 세션이 연 기준 템플릿셋 id. `applyTemplateSetProductProfile` 이 기록한다(없으면 스킨 절 비노출).
 * - `cardReasons`: 카드별 사용 불가 사유 캐시. 404(`missing`)·호환 오류(`incompatible`)만 세션 동안 남긴다.
 *   네트워크·5xx 는 캐시하지 않는다(다음 클릭에 다시 받음).
 * - `baseUnavailable`: 기준 세트를 다시 받다가 404 가 나면 절 전체를 비활성으로 둔다.
 * - `idSetCache`: 판정 집합용 다른 스킨 세트의 캔버스별 top-level id 집합(canvasData 는 남기지 않음).
 * - `phase`: 적용 상태(카드 잠금·오버레이·「적용 취소」 노출 판단).
 * - `undo`: 「적용 취소」 스냅샷(적용 직전 캔버스 JSON 1벌). 편집 이벤트·새 적용·취소 뒤에 해제한다.
 */

export type SkinCardReason = 'missing' | 'incompatible'

export type SkinApplyPhase = 'idle' | 'checking' | 'blocked' | 'confirm' | 'applying' | 'applied' | 'failed' | 'fatal'

export interface SkinUndoSnapshot {
  /** 적용 직전 캔버스별 JSON(`toJSON(core.extendFabricOption)`) */
  before: unknown[]
  /** 적용 직전 skinKey(undefined = 기본 디자인) */
  prevSkinKey: string | undefined
  /** 적용한 디자인 이름(토스트·안내용) */
  label: string
}

export interface CalendarSkinStoreState {
  baseTemplateSetId: string | null
  baseUnavailable: boolean
  cardReasons: Record<string, SkinCardReason>
  idSetCache: Record<string, Set<string>[]>
  phase: SkinApplyPhase
  /** checking 중인 카드 key(기본 디자인 = '') */
  activeKey: string | null
  undo: SkinUndoSnapshot | null

  setBase: (templateSetId: string | null) => void
  setBaseUnavailable: (value: boolean) => void
  setCardReason: (key: string, reason: SkinCardReason) => void
  cacheIdSets: (templateSetId: string, sets: Set<string>[]) => void
  setPhase: (phase: SkinApplyPhase, activeKey?: string | null) => void
  setUndo: (undo: SkinUndoSnapshot | null) => void
  reset: () => void
}

const initial = {
  baseTemplateSetId: null,
  baseUnavailable: false,
  cardReasons: {},
  idSetCache: {},
  phase: 'idle' as SkinApplyPhase,
  activeKey: null,
  undo: null,
}

export const useCalendarSkinStore = create<CalendarSkinStoreState>((set, get) => ({
  ...initial,

  setBase: (templateSetId) => {
    // 다른 세트로 바뀌면 그 세트 기준의 캐시는 의미가 없다
    if (get().baseTemplateSetId === templateSetId) return
    set({ ...initial, baseTemplateSetId: templateSetId })
  },
  setBaseUnavailable: (value) => set({ baseUnavailable: value }),
  setCardReason: (key, reason) => set((s) => ({ cardReasons: { ...s.cardReasons, [key]: reason } })),
  cacheIdSets: (templateSetId, sets) => set((s) => ({ idSetCache: { ...s.idSetCache, [templateSetId]: sets } })),
  setPhase: (phase, activeKey = null) => set({ phase, activeKey }),
  setUndo: (undo) => set({ undo }),
  reset: () => set({ ...initial }),
}))
