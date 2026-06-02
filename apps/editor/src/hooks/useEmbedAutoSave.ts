import { useCallback, useEffect, useRef } from 'react'
import { debounce } from 'lodash-es'
import { useAppStore } from '@/stores/useAppStore'
import { useSaveStore } from '@/stores/useSaveStore'
import { editSessionsApi, type EditSessionResponse } from '@/api/edit-sessions'
import { core } from '@storige/canvas-core'

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
}

/**
 * Embed 에디터용 자동저장 Hook
 * - editSessionsApi 사용 (bookmoa 연동)
 * - 주기적 자동저장
 * - 로컬 백업
 * - 네트워크 복구 시 동기화
 */
export function useEmbedAutoSave(config: AutoSaveConfig) {
  const { sessionId, currentSession, onSessionUpdate, onError } = config

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
        setFailed('저장 실패. 로컬에 백업되었습니다.')
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
   * 컴포넌트 언마운트 시 저장
   */
  useEffect(() => {
    return () => {
      debouncedSave.cancel()

      if (isDirty && sessionId && canvas) {
        // 동기적으로 로컬 백업 (언마운트 시에는 async 불가)
        try {
          const canvasData = canvas.toJSON(core.extendFabricOption)
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
  }, [isDirty, sessionId, canvas, debouncedSave])

  /**
   * 초기화 시 로컬 백업 확인
   */
  useEffect(() => {
    if (!sessionId || !canvas) return

    const backup = loadFromLocal()
    if (backup && backup.canvasData) {
      // 백업이 있고 세션이 일치하면 복구 여부 확인 가능
      // 현재는 자동 복구하지 않고 정보만 제공
      console.log('[EmbedAutoSave] 로컬 백업 발견:', backup.savedAt)
      setLocalBackup(true, new Date(backup.savedAt))
    }
  }, [sessionId, canvas, loadFromLocal, setLocalBackup])

  return {
    // Actions
    saveNow,
    saveToLocal,
    loadFromLocal,
    deleteLocalBackup,
    markDirty,
    markClean,

    // Trigger debounced save on change
    triggerSave: debouncedSave,
  }
}
