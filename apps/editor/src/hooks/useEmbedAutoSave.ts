import { useCallback, useEffect, useRef } from 'react'
import { debounce } from 'lodash-es'
import { useAppStore } from '@/stores/useAppStore'
import { useSaveStore } from '@/stores/useSaveStore'
import { editSessionsApi, type EditSessionResponse } from '@/api/edit-sessions'
import { core } from '@storige/canvas-core'
import { rebindFrameInteractivity } from '@/utils/frameInteractive'
import {
  shouldOfferRestore,
  type EmbedLocalBackup,
  type RestoreSessionInfo,
  type RestoreDecision,
} from './restoreDecision'

// 로컬 스토리지 키
const LOCAL_BACKUP_KEY = 'storige_embed_session_backup'

interface AutoSaveConfig {
  /** 세션 ID */
  sessionId: string | null
  /** 현재 세션 객체 */
  currentSession: EditSessionResponse | null
  /** 세션 업데이트 콜백 */
  onSessionUpdate?: (session: EditSessionResponse) => void
  /** 에러 콜백 */
  onError?: (error: Error) => void
  /**
   * 초기화(템플릿 로드 + 세션 복원) 완료 신호 — embed 의 isInitializedRef 를 그대로 받는다.
   * ⚠️ useAppStore.ready 로 게이트하면 안 된다: useAppStore.init() 이 캔버스 등록 시마다
   * ready:true 를 set 하므로 복원 시작 전에 이미 true — 복원(loadFromJSON)이 발화하는
   * object:added 가 dirty 로 마킹돼 "무편집 자동저장"이 로드 재계산 지오메트리를 세션에
   * 덮어쓴다(실측 2026-06-11, 적대 리뷰에서 ready 가드 무효 판정 2026-06-12).
   */
  initializedRef?: React.RefObject<boolean>
}

/**
 * Embed 에디터용 자동저장 Hook
 * - editSessionsApi 사용 (bookmoa 연동)
 * - 주기적 자동저장
 * - 로컬 백업
 * - 네트워크 복구 시 동기화
 */
export function useEmbedAutoSave(config: AutoSaveConfig) {
  const { sessionId, currentSession, onSessionUpdate, onError, initializedRef } = config

  // Refs
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isSavingRef = useRef(false)

  // App Store
  const canvas = useAppStore((state) => state.canvas)
  const allCanvas = useAppStore((state) => state.allCanvas)

  // Save Store
  const isDirty = useSaveStore((state) => state.isDirty)
  const isOnline = useSaveStore((state) => state.isOnline)
  const autoSaveEnabled = useSaveStore((state) => state.autoSaveEnabled)
  const autoSaveInterval = useSaveStore((state) => state.autoSaveInterval)
  const setSaving = useSaveStore((state) => state.setSaving)
  const setSaved = useSaveStore((state) => state.setSaved)
  const setFailed = useSaveStore((state) => state.setFailed)
  const markDirty = useSaveStore((state) => state.markDirty)
  const markClean = useSaveStore((state) => state.markClean)
  const setOnline = useSaveStore((state) => state.setOnline)
  const incrementRetry = useSaveStore((state) => state.incrementRetry)
  const resetRetry = useSaveStore((state) => state.resetRetry)
  const canRetry = useSaveStore((state) => state.canRetry)
  const setLocalBackup = useSaveStore((state) => state.setLocalBackup)
  const clearLocalBackup = useSaveStore((state) => state.clearLocalBackup)

  /**
   * 캔버스 데이터 수집 — 멀티페이지면 배열, 단일이면 객체
   * allCanvas가 2+이면 각 캔버스를 JSON 배열로 직렬화 (내지 N페이지 완전 보존)
   */
  const collectCanvasData = useCallback(() => {
    if (allCanvas.length >= 2) {
      return allCanvas.map((cvs) => {
        try { return cvs.toJSON(core.extendFabricOption) } catch { return null }
      }).filter(Boolean)
    }
    if (!canvas) return null
    return canvas.toJSON(core.extendFabricOption)
  }, [canvas, allCanvas])

  /**
   * 로컬 백업 저장
   */
  const saveToLocal = useCallback(() => {
    if (!sessionId) return

    try {
      const canvasData = collectCanvasData()
      const backup = {
        sessionId,
        canvasData,
        savedAt: new Date().toISOString(),
      }

      localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(backup))
      setLocalBackup(true, new Date())
      console.log('[EmbedAutoSave] 로컬 백업 저장됨')
    } catch (error) {
      console.error('[EmbedAutoSave] 로컬 백업 실패:', error)
    }
  }, [sessionId, collectCanvasData, setLocalBackup])

  /**
   * 로컬 백업 불러오기
   */
  const loadFromLocal = useCallback((): {
    sessionId: string
    canvasData: any
    savedAt: string
  } | null => {
    try {
      const backupString = localStorage.getItem(LOCAL_BACKUP_KEY)
      if (!backupString) return null

      const backup = JSON.parse(backupString)

      // 현재 세션과 일치하는지 확인
      if (backup.sessionId !== sessionId) {
        console.log('[EmbedAutoSave] 다른 세션의 백업 발견, 무시함')
        return null
      }

      return backup
    } catch (error) {
      console.error('[EmbedAutoSave] 로컬 백업 불러오기 실패:', error)
      return null
    }
  }, [sessionId])

  /**
   * 로컬 백업 삭제
   */
  const deleteLocalBackup = useCallback(() => {
    localStorage.removeItem(LOCAL_BACKUP_KEY)
    clearLocalBackup()
  }, [clearLocalBackup])

  /**
   * 로컬 백업을 캔버스에 복원 (사용자 [복원] 발동 시에만 호출 — 자동 복원 금지).
   *
   * collectCanvasData() 의 역방향:
   *  - 배열 백업 → allCanvas[i] 에 순서대로 loadFromJSON (멀티페이지 전체 복원,
   *    min(saved.length, allCanvas.length) 로 페이지수 불일치 시 안전 절단).
   *  - 객체 백업 → 활성 canvas 에 loadFromJSON (단일/표지전용 세션).
   * 복원 성공 후 dirty 마킹 → 사용자가 저장하면 서버 반영, 백업은 삭제(중복 제안 방지).
   * 실패 시 백업을 보존(삭제하지 않음)해 사용자가 재시도/이탈 시 데이터를 잃지 않게 한다.
   */
  const restoreFromLocal = useCallback(async (): Promise<boolean> => {
    const backup = loadFromLocal()
    if (!backup || backup.canvasData == null) return false

    try {
      const saved = backup.canvasData
      const allEditors = useAppStore.getState().allEditors || []
      if (Array.isArray(saved)) {
        if (saved.length === 0) return false
        for (let i = 0; i < saved.length && i < allCanvas.length; i++) {
          if (saved[i]) await core.loadFromJSON(allCanvas[i], saved[i])
          // 복원 직후 사진틀 인터랙션 재바인딩 (핸들러 미직렬화 → 미재바인딩 시 채우기 불능).
          rebindFrameInteractivity(allEditors[i], allCanvas[i])
        }
        console.log('[EmbedAutoSave] 멀티페이지 백업 복원:', saved.length, 'pages')
      } else if (canvas) {
        await core.loadFromJSON(canvas, saved)
        rebindFrameInteractivity(allEditors[Math.max(0, allCanvas.indexOf(canvas))], canvas)
        console.log('[EmbedAutoSave] 단일 백업 복원')
      } else {
        return false
      }

      // 복원된 내용은 아직 서버에 없다 — dirty 로 마킹해 사용자가 저장하면 반영되게 한다.
      markDirty()
      // 복원 완료 → 백업 삭제(같은 백업으로 중복 제안 방지). 미저장 상태는 dirty 가드 +
      // beforeunload 경고가 보호하고, 이후 자동저장이 서버에 반영한다.
      deleteLocalBackup()
      return true
    } catch (error) {
      console.error('[EmbedAutoSave] 백업 복원 실패:', error)
      // 실패 시 백업 보존 — 데이터 유실 방지.
      return false
    }
  }, [loadFromLocal, allCanvas, canvas, markDirty, deleteLocalBackup])

  /**
   * 서버에 저장
   */
  const saveToServer = useCallback(async (): Promise<boolean> => {
    if (!sessionId || isSavingRef.current) return false

    isSavingRef.current = true
    setSaving()

    try {
      const canvasData = collectCanvasData()

      // 게스트 세션이면 guestToken 동봉(updateGuest), 아니면 회원 update
      const guestToken = currentSession?.guestToken
      const updatedSession = guestToken
        ? await editSessionsApi.updateGuest(sessionId, guestToken, { canvasData, status: 'editing' })
        : await editSessionsApi.update(sessionId, { canvasData, status: 'editing' })

      // 성공 시 상태 업데이트
      setSaved()
      resetRetry()
      deleteLocalBackup()
      markClean()

      onSessionUpdate?.(updatedSession)

      console.log('[EmbedAutoSave] 서버 저장 성공')
      return true
    } catch (error) {
      console.error('[EmbedAutoSave] 서버 저장 실패:', error)

      // 실패 시 로컬 백업
      saveToLocal()

      if (canRetry()) {
        incrementRetry()
        setFailed('저장 실패. 재시도 중...')
      } else {
        // ⚠️ "백업되었습니다" 단정 금지 — localStorage 임시 보관일 뿐 서버에 저장된 것이
        // 아니고, 복원 UI 도 아직 없다(아래 TODO 참조). 사용자가 안심하고 이탈하지 않도록 안내.
        setFailed('저장 실패. 변경사항이 서버에 저장되지 않았습니다 — 네트워크 확인 후 다시 시도해 주세요.')
      }

      onError?.(error instanceof Error ? error : new Error('저장 실패'))

      return false
    } finally {
      isSavingRef.current = false
    }
  }, [
    sessionId,
    currentSession,
    collectCanvasData,
    setSaving,
    setSaved,
    setFailed,
    resetRetry,
    incrementRetry,
    canRetry,
    saveToLocal,
    deleteLocalBackup,
    markClean,
    onSessionUpdate,
    onError,
  ])

  /**
   * Debounced 저장 (캔버스 변경 시 호출)
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSave = useCallback(
    debounce(() => {
      if (isDirty && isOnline && sessionId) {
        saveToServer()
      }
    }, 2000),
    [isDirty, isOnline, sessionId, saveToServer]
  )

  /**
   * 즉시 저장
   */
  const saveNow = useCallback(async () => {
    debouncedSave.cancel()
    return saveToServer()
  }, [debouncedSave, saveToServer])

  /**
   * 캔버스 변경 시 dirty 마킹 및 debounced 저장 트리거
   */
  useEffect(() => {
    if (!canvas) return

    const handleChange = () => {
      // 초기화/세션 복원 중 가드 (2026-06-12): loadJSON/loadFromJSON·가이드 배치가 발화하는
      // object:added 등은 사용자 편집이 아니다. 여기서 dirty 로 마킹되면 "무편집 자동저장"이
      // 로드 시 재계산 지오메트리를 세션 canvasData 에 덮어써 영구 오염시킨다(실측 2026-06-11).
      // 게이트는 embed 의 isInitializedRef(복원 완료 시점에만 true) — useAppStore.ready 는
      // 캔버스 등록 시점에 이미 true 라 게이트로 무효(AutoSaveConfig.initializedRef 주석 참조).
      if (initializedRef && !initializedRef.current) return
      markDirty()
      debouncedSave()
    }

    // 변경 감지 이벤트 등록
    canvas.on('object:added', handleChange)
    canvas.on('object:removed', handleChange)
    canvas.on('object:modified', handleChange)

    return () => {
      canvas.off('object:added', handleChange)
      canvas.off('object:removed', handleChange)
      canvas.off('object:modified', handleChange)
      debouncedSave.cancel()
    }
  }, [canvas, markDirty, debouncedSave])

  /**
   * 네트워크 상태 감지
   */
  useEffect(() => {
    const handleOnline = () => {
      console.log('[EmbedAutoSave] 온라인 전환')
      setOnline(true)

      // 온라인 복귀 시 저장되지 않은 변경사항 동기화
      if (isDirty && sessionId) {
        saveToServer()
      }
    }

    const handleOffline = () => {
      console.log('[EmbedAutoSave] 오프라인 전환')
      setOnline(false)
      saveToLocal()
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // 초기 상태 설정
    setOnline(navigator.onLine)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [setOnline, isDirty, sessionId, saveToServer, saveToLocal])

  /**
   * 주기적 자동저장
   */
  useEffect(() => {
    if (!autoSaveEnabled || !sessionId) {
      if (saveTimerRef.current) {
        clearInterval(saveTimerRef.current)
        saveTimerRef.current = null
      }
      return
    }

    saveTimerRef.current = setInterval(() => {
      if (isDirty && isOnline && !isSavingRef.current) {
        saveToServer()
      }
    }, autoSaveInterval)

    return () => {
      if (saveTimerRef.current) {
        clearInterval(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [autoSaveEnabled, autoSaveInterval, sessionId, isDirty, isOnline, saveToServer])

  /**
   * 페이지 이탈 시 경고
   */
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault()
        e.returnValue = '저장되지 않은 변경사항이 있습니다. 페이지를 나가시겠습니까?'
        return e.returnValue
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [isDirty])

  /**
   * 컴포넌트 언마운트 시 로컬 백업
   * ⚠️ 서버 저장이 아니다 — 언마운트 cleanup 은 동기라 API 호출을 보장할 수 없어
   * localStorage 백업만 수행한다. 미저장 변경은 서버 세션에는 반영되지 않은 상태.
   * collectCanvasData() 사용: 멀티페이지(allCanvas 2+)면 전체 페이지 배열을 직렬화 —
   * 과거 canvas.toJSON(현재 페이지 1장)만 백업해 내지 N페이지가 유실되던 문제 수정.
   */
  useEffect(() => {
    return () => {
      debouncedSave.cancel()

      if (isDirty && sessionId && canvas) {
        // 동기적으로 로컬 백업 (언마운트 시에는 async 불가)
        try {
          const canvasData = collectCanvasData()
          const backup = {
            sessionId,
            canvasData,
            savedAt: new Date().toISOString(),
          }
          localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(backup))
        } catch (error) {
          console.error('[EmbedAutoSave] 언마운트 시 백업 실패:', error)
        }
      }
    }
  }, [isDirty, sessionId, canvas, debouncedSave, collectCanvasData])

  /**
   * 초기화 시 로컬 백업 확인 (상태 플래그만 — 자동 복원 금지).
   *
   * 복원 제안(모달/배너) 노출 판정은 embed 마운트 경로가 세션 로드 완료(isInitializedRef
   * true) 후 evaluateRestore(session) 로 1회 수행한다. 여기서는 hasLocalBackup 플래그와
   * 백업 시각만 스토어에 반영해, 복원 UI 가 없던 시절의 "백업만 쓰고 안 읽음" 상태를
   * 더는 만들지 않는다. 실제 캔버스 변경은 사용자가 [복원] 을 누른 restoreFromLocal 에서만.
   */
  useEffect(() => {
    if (!sessionId || !canvas) return

    const backup = loadFromLocal()
    if (backup && backup.canvasData) {
      const ms = Date.parse(backup.savedAt)
      console.log('[EmbedAutoSave] 로컬 백업 발견:', backup.savedAt)
      setLocalBackup(true, Number.isFinite(ms) ? new Date(ms) : new Date())
    }
  }, [sessionId, canvas, loadFromLocal, setLocalBackup])

  /**
   * 복원 제안 판정 — embed 가 세션 로드 완료 후 1회 호출.
   * 순수 함수 shouldOfferRestore 에 위임(자동 복원 절대 없음, 판정만).
   */
  const evaluateRestore = useCallback(
    (session: RestoreSessionInfo | null | undefined): RestoreDecision => {
      const backup = loadFromLocal() as EmbedLocalBackup | null
      return shouldOfferRestore(backup, session)
    },
    [loadFromLocal],
  )

  return {
    // Actions
    saveNow,
    saveToLocal,
    loadFromLocal,
    deleteLocalBackup,
    restoreFromLocal,
    evaluateRestore,
    markDirty,
    markClean,

    // Trigger debounced save on change
    triggerSave: debouncedSave,
  }
}
