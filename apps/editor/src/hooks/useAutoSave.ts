import { useCallback, useEffect, useRef } from 'react'
import { debounce } from 'lodash-es'
import { useEditorStore } from '@/stores/useEditorStore'
import { useSaveStore } from '@/stores/useSaveStore'
import { useAppStore } from '@/stores/useAppStore'
import { useAutoSaveSnapshotsStore } from '@/stores/useAutoSaveSnapshotsStore'
import { useAutoSaveThumbnail } from '@/hooks/useAutoSaveThumbnail'
import { sessionsApi } from '@/api/sessions'
import { isAutosaveSuspended, deferUntilAutosaveResumed } from '@/utils/autosaveSuspend'
import { ServicePlugin } from '@storige/canvas-core'
import type { EditPage, CanvasData } from '@storige/types'

// 로컬 스토리지 키
const LOCAL_BACKUP_KEY = 'storige_session_backup'

/**
 * 자동저장 Hook
 * - 주기적 자동저장
 * - 로컬 백업
 * - 네트워크 복구 시 동기화
 */
export function useAutoSave() {
  // Refs
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isSavingRef = useRef(false)

  // Editor Store
  const sessionId = useEditorStore((state) => state.sessionId)
  const pages = useEditorStore((state) => state.pages)
  const currentPageIndex = useEditorStore((state) => state.currentPageIndex)
  const userId = useEditorStore((state) => state.userId)
  const setPages = useEditorStore((state) => state.setPages)
  const updatePageCanvasData = useEditorStore((state) => state.updatePageCanvasData)

  // Save Store
  const isDirty = useSaveStore((state) => state.isDirty)
  const isOnline = useSaveStore((state) => state.isOnline)
  const autoSaveEnabled = useSaveStore((state) => state.autoSaveEnabled)
  const autoSaveInterval = useSaveStore((state) => state.autoSaveInterval)
  const setSaving = useSaveStore((state) => state.setSaving)
  const setSaved = useSaveStore((state) => state.setSaved)
  const setFailed = useSaveStore((state) => state.setFailed)
  const markDirty = useSaveStore((state) => state.markDirty)
  const setOnline = useSaveStore((state) => state.setOnline)
  const incrementRetry = useSaveStore((state) => state.incrementRetry)
  const resetRetry = useSaveStore((state) => state.resetRetry)
  const canRetry = useSaveStore((state) => state.canRetry)
  const setLocalBackup = useSaveStore((state) => state.setLocalBackup)
  const clearLocalBackup = useSaveStore((state) => state.clearLocalBackup)

  // App Store
  const allCanvas = useAppStore((state) => state.allCanvas)
  const allEditors = useAppStore((state) => state.allEditors)

  // BB-Phase 3 follow-up — 시점 썸네일 캡처/업로드 helper (모바일 자동 스킵)
  const { captureAndUpload: captureThumbnail } = useAutoSaveThumbnail()

  /**
   * 현재 캔버스 데이터 수집
   */
  const collectCanvasData = useCallback(async (): Promise<EditPage[]> => {
    const updatedPages = [...pages]

    for (let i = 0; i < allEditors.length && i < updatedPages.length; i++) {
      const editor = allEditors[i]
      const plugin = editor?.getPlugin?.('ServicePlugin') as ServicePlugin | undefined

      if (plugin) {
        try {
          const jsonString = await plugin.saveJSON()
          const canvasData = JSON.parse(jsonString) as CanvasData
          updatedPages[i] = {
            ...updatedPages[i],
            canvasData,
          }
        } catch (error) {
          console.error(`캔버스 ${i} 데이터 수집 실패:`, error)
        }
      }
    }

    return updatedPages
  }, [pages, allEditors])

  /**
   * 로컬 백업 저장
   */
  const saveToLocal = useCallback(async () => {
    if (!sessionId) return

    try {
      const updatedPages = await collectCanvasData()
      const backup = {
        sessionId,
        pages: updatedPages,
        currentPageIndex,
        savedAt: new Date().toISOString(),
      }

      localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(backup))
      setLocalBackup(true, new Date())
      console.log('[AutoSave] 로컬 백업 저장됨')
    } catch (error) {
      console.error('[AutoSave] 로컬 백업 실패:', error)
    }
  }, [sessionId, collectCanvasData, currentPageIndex, setLocalBackup])

  /**
   * 로컬 백업 불러오기
   */
  const loadFromLocal = useCallback((): {
    sessionId: string
    pages: EditPage[]
    currentPageIndex: number
    savedAt: string
  } | null => {
    try {
      const backupString = localStorage.getItem(LOCAL_BACKUP_KEY)
      if (!backupString) return null

      const backup = JSON.parse(backupString)

      // 현재 세션과 일치하는지 확인
      if (backup.sessionId !== sessionId) {
        console.log('[AutoSave] 다른 세션의 백업 발견, 무시함')
        return null
      }

      return backup
    } catch (error) {
      console.error('[AutoSave] 로컬 백업 불러오기 실패:', error)
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
    // L4-②: PDF 생성 창(excludeFromExport 임시 플래깅) 동안 직렬화하면 printExclude/moldIcon
    // 객체가 저장에서 누락 — 스킵 대신 생성 완료 후 1회 지연 실행(ref 로 최신 클로저).
    if (isAutosaveSuspended()) {
      deferUntilAutosaveResumed('autoSave.saveToServer', () => {
        void saveToServerRef.current()
      })
      return false
    }

    isSavingRef.current = true
    setSaving()

    try {
      const updatedPages = await collectCanvasData()

      // BB-Phase 3 follow-up — 시점 썸네일 캡처/업로드는 autoSave POST와 병렬로 진행.
      // (실패해도 null로 fallback해 자동저장 자체는 그대로 성공)
      // 백엔드 maybePushVersion은 1분 debounce로 묶여 매번 push되지 않으므로
      // 매번 캡처되는 썸네일도 일부는 사용 안 됨 — 비용은 0.25x JPEG라 미미.
      const thumbnailUrl = await captureThumbnail()

      await sessionsApi.autoSave(
        sessionId,
        {
          pages: updatedPages,
          currentPageIndex,
          thumbnailUrl,
        },
        userId || undefined
      )

      // 성공 시 상태 업데이트
      setPages(updatedPages)
      setSaved()
      resetRetry()
      deleteLocalBackup()

      // 자동저장 시점 스냅샷 메타 push (트랙 BB — Phase 2 minimal, LRU 5개)
      try {
        useAutoSaveSnapshotsStore.getState().pushSnapshot({
          savedAt: new Date().toISOString(),
          pageCount: updatedPages.length,
          sessionId: sessionId ?? undefined,
        })
      } catch (e) {
        console.warn('[AutoSave] snapshot push 실패:', e)
      }

      console.log('[AutoSave] 서버 저장 성공')
      return true
    } catch (error) {
      console.error('[AutoSave] 서버 저장 실패:', error)

      // 실패 시 로컬 백업
      await saveToLocal()

      if (canRetry()) {
        incrementRetry()
        setFailed('저장 실패. 재시도 중...')
      } else {
        setFailed('저장 실패. 로컬에 백업되었습니다.')
      }

      return false
    } finally {
      isSavingRef.current = false
    }
  }, [
    sessionId,
    collectCanvasData,
    currentPageIndex,
    userId,
    setPages,
    setSaving,
    setSaved,
    setFailed,
    resetRetry,
    incrementRetry,
    canRetry,
    saveToLocal,
    deleteLocalBackup,
    captureThumbnail,
  ])

  /**
   * Debounced 저장
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSave = useCallback(
    debounce(() => {
      if (isDirty && isOnline) {
        saveToServer()
      }
    }, 2000),
    [isDirty, isOnline, saveToServer]
  )

  /**
   * 즉시 저장
   */
  const saveNow = useCallback(async () => {
    debouncedSave.cancel()
    return saveToServer()
  }, [debouncedSave, saveToServer])

  /**
   * 네트워크 상태 감지
   *
   * RACE-001(2026-06-22): 과거 deps 에 [isDirty, saveToServer, saveToLocal] 가 있어
   * isDirty 변동마다 리스너가 재구독되고, 핸들러가 stale isDirty/saveToServer 를 캡처해
   * 중복 저장 호출 위험이 있었다. 최신값은 ref 로 읽고 리스너는 마운트 시 1회만 구독한다.
   * (saveToServer 는 내부 isSavingRef 가드가 이미 있어 중복은 1차 차단되지만, 여기서도
   *  isSavingRef 가드 + 단일구독으로 이중 방어.)
   */
  // 최신 클로저 값 동기화(렌더마다) — 핸들러가 ref 로 최신값을 읽어 stale 방지.
  const isDirtyRef = useRef(isDirty)
  isDirtyRef.current = isDirty
  const saveToServerRef = useRef(saveToServer)
  saveToServerRef.current = saveToServer
  const saveToLocalRef = useRef(saveToLocal)
  saveToLocalRef.current = saveToLocal

  useEffect(() => {
    const handleOnline = () => {
      console.log('[AutoSave] 온라인 전환')
      setOnline(true)

      // 온라인 복귀 시 저장되지 않은 변경사항 동기화(저장 진행 중이면 스킵 — 중복 방어)
      if (isDirtyRef.current && !isSavingRef.current) {
        saveToServerRef.current()
      }
    }

    const handleOffline = () => {
      console.log('[AutoSave] 오프라인 전환')
      setOnline(false)
      saveToLocalRef.current()
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // 초기 상태 설정
    setOnline(navigator.onLine)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [setOnline])

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
      if (isDirty && sessionId) {
        // 동기적으로 로컬 백업 (언마운트 시에는 async 불가)
        try {
          const backup = {
            sessionId,
            pages,
            currentPageIndex,
            savedAt: new Date().toISOString(),
          }
          localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(backup))
        } catch (error) {
          console.error('[AutoSave] 언마운트 시 백업 실패:', error)
        }
      }
    }
  }, [isDirty, sessionId, pages, currentPageIndex])

  return {
    // Actions
    saveNow,
    saveToLocal,
    loadFromLocal,
    deleteLocalBackup,
    markDirty,

    // Trigger debounced save on change
    triggerSave: debouncedSave,
  }
}

/**
 * 캔버스 변경 감지 Hook
 * 캔버스 변경 시 자동으로 dirty 마킹
 */
export function useCanvasChangeDetection() {
  const canvas = useAppStore((state) => state.canvas)
  const markDirty = useSaveStore((state) => state.markDirty)

  useEffect(() => {
    if (!canvas) return

    const handleChange = () => {
      markDirty()
    }

    // 변경 감지 이벤트 등록
    canvas.on('object:added', handleChange)
    canvas.on('object:removed', handleChange)
    canvas.on('object:modified', handleChange)

    return () => {
      canvas.off('object:added', handleChange)
      canvas.off('object:removed', handleChange)
      canvas.off('object:modified', handleChange)
    }
  }, [canvas, markDirty])
}
