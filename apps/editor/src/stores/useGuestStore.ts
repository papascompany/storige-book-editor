/**
 * Guest Session Store — 인쇄 워크플로우 v1 Phase 4 (2026-05-19).
 *
 * 비로그인 사용자가 편집기에 진입하면 게스트 세션이 발급되고,
 * 응답의 guestToken / sessionId 를 sessionStorage 에 저장한다.
 *
 * - 결정 3-1: 24시간 후 EVENT 가 자동 DELETE.
 *   sessionStorage 도 24h 만료 시 자동 정리 (load 시 timestamp 비교).
 * - 결정 3-6: 회원 전환은 저장(편집완료) 시점에 별도 흐름으로.
 *
 * 사용 시점:
 *   1) 편집기 진입 시 token 없으면 → useGuestStore.ensureGuestSession() 호출
 *   2) update 시 → updateGuest(sessionId, guestToken, payload)
 *   3) 회원 가입/로그인 시 → useGuestStore.clearGuest() + 세션 마이그레이션 API 호출 (Phase 6)
 */
import { create } from 'zustand'
import { editSessionsApi, EditSessionResponse } from '../api/edit-sessions'

const STORAGE_KEY = 'storige_guest_session_v1'

interface GuestRecord {
  sessionId: string
  guestToken: string
  expiresAt: string // ISO8601
  templateSetId?: string | null
}

interface GuestStoreState {
  sessionId: string | null
  guestToken: string | null
  expiresAt: Date | null

  /**
   * sessionStorage 에서 게스트 세션을 복원. 만료된 경우 자동 클리어.
   * 앱 마운트 시 한 번 호출.
   */
  initializeFromStorage: () => void

  /**
   * 게스트 세션을 보장. 없으면 새로 생성. 있으면 그대로.
   * @returns 생성/복원된 EditSessionResponse 또는 null (실패)
   */
  ensureGuestSession: (params: {
    templateSetId?: string
    mode?: 'cover' | 'content' | 'both' | 'template'
    canvasData?: any
    metadata?: Record<string, any>
  }) => Promise<EditSessionResponse | null>

  /** 게스트 정보 저장 */
  setGuest: (record: GuestRecord) => void

  /** 게스트 정보 삭제 (회원 전환 / 만료 / 로그아웃) */
  clearGuest: () => void
}

/**
 * sessionStorage 에서 게스트 레코드 로드. 만료 시 null 반환 + 정리.
 */
function loadFromStorage(): GuestRecord | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const rec: GuestRecord = JSON.parse(raw)
    if (!rec.sessionId || !rec.guestToken || !rec.expiresAt) return null
    if (new Date(rec.expiresAt) < new Date()) {
      sessionStorage.removeItem(STORAGE_KEY)
      return null
    }
    return rec
  } catch {
    return null
  }
}

function saveToStorage(record: GuestRecord): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(record))
  } catch {
    // sessionStorage 사용 불가 환경 (예: Safari private)
  }
}

export const useGuestStore = create<GuestStoreState>((set, get) => ({
  sessionId: null,
  guestToken: null,
  expiresAt: null,

  initializeFromStorage: () => {
    const rec = loadFromStorage()
    if (rec) {
      set({
        sessionId: rec.sessionId,
        guestToken: rec.guestToken,
        expiresAt: new Date(rec.expiresAt),
      })
    }
  },

  ensureGuestSession: async (params) => {
    // 이미 세션이 있고 templateSetId 가 일치하면 그대로
    const current = get()
    if (current.sessionId && current.guestToken && current.expiresAt && current.expiresAt > new Date()) {
      try {
        const existing = await editSessionsApi.get(current.sessionId)
        if (existing && (!params.templateSetId || existing.templateSetId === params.templateSetId)) {
          return existing
        }
      } catch {
        // 세션이 만료되었거나 삭제됨 — 새로 생성
        get().clearGuest()
      }
    }

    // 신규 게스트 세션 생성
    try {
      const created = await editSessionsApi.createGuest({
        mode: params.mode ?? 'both',
        templateSetId: params.templateSetId,
        canvasData: params.canvasData,
        metadata: params.metadata,
      })
      if (created.guestToken && created.guestExpiresAt) {
        get().setGuest({
          sessionId: created.id,
          guestToken: created.guestToken,
          expiresAt: created.guestExpiresAt,
          templateSetId: created.templateSetId,
        })
      }
      return created
    } catch (err) {
      console.error('[useGuestStore] createGuest failed:', err)
      return null
    }
  },

  setGuest: (record) => {
    saveToStorage(record)
    set({
      sessionId: record.sessionId,
      guestToken: record.guestToken,
      expiresAt: new Date(record.expiresAt),
    })
  },

  clearGuest: () => {
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      // 무시
    }
    set({ sessionId: null, guestToken: null, expiresAt: null })
  },
}))
