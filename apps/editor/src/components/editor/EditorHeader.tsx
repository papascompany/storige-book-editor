import { useState, useCallback, useEffect, useMemo } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useIsAdmin } from '@/stores/useAuthStore'
import { useWorkSave } from '@/hooks/useWorkSave'
import { ServicePlugin, PreviewPlugin, HistoryPlugin } from '@storige/canvas-core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  HelpCircle,
  FolderOpen,
  Check,
  Box,
  Ruler,
  Undo2,
  Redo2,
  ChevronDown,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react'
import { AutoSaveIndicator } from './AutoSaveIndicator'
import { BookMockup3D } from '../Mockup3D/BookMockup3D'
import { useUiPrefStore, type PageNavPosition, type Theme } from '@/stores/useUiPrefStore'

const SIZE_PRESETS: { label: string; width: number; height: number }[] = [
  { label: '정사각', width: 100, height: 100 },
  { label: '명함', width: 90, height: 54 },
  { label: '엽서', width: 148, height: 100 },
  { label: 'A6', width: 105, height: 148 },
  { label: 'A5', width: 148, height: 210 },
  { label: 'A4', width: 210, height: 297 },
  { label: 'B6', width: 125, height: 176 },
  { label: 'B5', width: 176, height: 250 },
]
const SIZE_MIN_MM = 10
const SIZE_MAX_MM = 1500

interface EditorHeaderProps {
  screenMode?: 'mobile' | 'tablet' | 'desktop'
  onToggleSidePanel?: () => void
  onLoadingChange?: (loading: boolean, message?: string) => void
  /** 편집완료 콜백 (bookmoa 연동용) */
  onFinish?: () => Promise<void>
  /** 내 작업에 저장 콜백 */
  onSaveWork?: () => Promise<void>
  /** 불러오기 콜백 */
  onOpenWorkspace?: () => void
}

export default function EditorHeader({
  screenMode = 'desktop',
  onToggleSidePanel,
  onLoadingChange,
  onFinish,
  onSaveWork,
  onOpenWorkspace,
}: EditorHeaderProps) {
  const [previewMode, setPreviewMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [show3DMockup, setShow3DMockup] = useState(false)

  // 페이지 네비게이션 위치 선호 (auto/right/bottom)
  const pageNavPosition = useUiPrefStore((s) => s.pageNavPosition)
  const setPageNavPosition = useUiPrefStore((s) => s.setPageNavPosition)
  // 룰러 토글 (기본 OFF, 사용자 선호로 영속)
  const showRuler = useUiPrefStore((s) => s.showRuler)
  const toggleRuler = useUiPrefStore((s) => s.toggleRuler)
  // 테마 (light/dark/system)
  const theme = useUiPrefStore((s) => s.theme)
  const setTheme = useUiPrefStore((s) => s.setTheme)
  const cycleTheme = useCallback(() => {
    const next: Record<Theme, Theme> = { light: 'dark', dark: 'system', system: 'light' }
    setTheme(next[theme])
  }, [theme, setTheme])

  // Stores
  const { ready, canvas, allCanvas, allEditors, getPlugin, setPage, isSpreadMode, updateAllWorkspaceSettings } = useAppStore()
  const { artwork, currentSettings, spreadConfig, updateSettings } = useSettingsStore()
  const isAdmin = useIsAdmin()

  // Undo/Redo 가능 여부 (HistoryPlugin의 historyUpdate 이벤트 + canvas.canUndo/canRedo 사용)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  useEffect(() => {
    if (!ready || allEditors.length === 0) {
      setCanUndo(false)
      setCanRedo(false)
      return
    }

    const refresh = () => {
      const cv = useAppStore.getState().canvas
      if (!cv || (cv as any).disposed) return
      try {
        setCanUndo(cv.canUndo?.() ?? false)
        setCanRedo(cv.canRedo?.() ?? false)
      } catch {
        // ignore
      }
    }

    refresh()

    const handlers: Array<{ editor: any; fn: () => void }> = []
    allEditors.forEach((editor: any) => {
      if (!editor?.on) return
      const fn = () => refresh()
      editor.on('historyUpdate', fn)
      handlers.push({ editor, fn })
    })

    return () => {
      handlers.forEach(({ editor, fn }) => {
        try { editor.off?.('historyUpdate', fn) } catch {}
      })
    }
  }, [ready, allEditors, canvas])

  // Work save hook for admin
  const { saveWorkForAdmin, saving: workSaving } = useWorkSave()

  // Size from settings
  const size = currentSettings.size || { width: 100, height: 100, cutSize: 5, safeSize: 5, printSize: undefined }

  // Loading helper
  const setLoading = useCallback(
    (loading: boolean, message?: string) => {
      onLoadingChange?.(loading, message)
    },
    [onLoadingChange]
  )

  // 작업 이름 변경
  const handleNameChange = useCallback(
    (e: React.FocusEvent<HTMLInputElement> | React.KeyboardEvent<HTMLInputElement>) => {
      if ('key' in e && e.key !== 'Enter') return

      const target = e.target as HTMLInputElement
      if (e.type === 'keydown') {
        target.blur()
      }

      // useSettingsStore의 artwork.name은 이미 바인딩되어 있으므로 추가 처리 불필요
      // 필요시 여기에 저장 로직 추가
    },
    []
  )

  // 인쇄 미리보기 토글
  const handlePreview = useCallback(async () => {
    if (!ready) return

    try {
      setLoading(true, '미리보기 모드를 전환하는 중...')

      const newPreviewMode = !previewMode
      setPreviewMode(newPreviewMode)

      const plugin = getPlugin<PreviewPlugin>('PreviewPlugin')
      if (plugin) {
        await plugin.setPreview(newPreviewMode, currentSettings.colorMode)
      }

      // TODO: 토스트 메시지 추가
      console.log(
        '인쇄 미리보기 모드가 ' + (newPreviewMode ? '활성화' : '비활성화') + '되었습니다.'
      )
    } catch (error) {
      console.error('미리보기 전환 중 오류:', error)
    } finally {
      setLoading(false)
    }
  }, [ready, previewMode, getPlugin, currentSettings.colorMode, setLoading])

  // PDF 저장
  const saveAllPagesToSinglePDF = useCallback(async () => {
    if (!ready || !canvas) return

    try {
      setLoading(true, 'PDF를 생성하는 중...')

      // 현재 활성화된 캔버스 인덱스 저장
      const originalCanvasIndex = allCanvas.findIndex((cvs) => cvs.id === canvas.id)

      // 첫 페이지로 이동
      if (allCanvas.length > 0) {
        setPage(0)
      }

      // preview 모드가 활성화되어 있으면 먼저 해제
      if (previewMode) {
        setPreviewMode(false)
        const previewPlugin = getPlugin<PreviewPlugin>('PreviewPlugin')
        if (previewPlugin) {
          await previewPlugin.setPreview(false, currentSettings.colorMode)
        }
      }

      // ServicePlugin 가져오기
      const servicePlugin = getPlugin<ServicePlugin>('ServicePlugin')
      if (!servicePlugin) {
        throw new Error('ServicePlugin을 찾을 수 없습니다')
      }

      // cutline 찾기
      const cutline = allCanvas[0].getObjects().find((obj: { id?: string }) => obj.id === 'cutline-template')

      // 여러 페이지 PDF 저장 함수 호출
      await servicePlugin.saveMultiPagePDF(
        allCanvas,
        allEditors,
        artwork.name || 'project',
        {
          width: size.width + size.cutSize,
          height: size.height + size.cutSize,
          cutSize: size.cutSize,
          printSize: size.printSize,
        },
        cutline,
        // TODO: DPI 설정 적용 (현재는 72로 하드코딩)
        72
      )

      // 원래 페이지로 돌아가기
      if (originalCanvasIndex >= 0) {
        setPage(originalCanvasIndex)
      }

      // TODO: 토스트 메시지 추가
      console.log('모든 페이지가 포함된 PDF가 성공적으로 저장되었습니다.')
    } catch (error) {
      console.error('PDF 저장 중 오류:', error)
      alert(`PDF 저장 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setLoading(false)
    }
  }, [
    ready,
    canvas,
    allCanvas,
    allEditors,
    artwork.name,
    size,
    previewMode,
    currentSettings.colorMode,
    getPlugin,
    setPage,
    setLoading,
  ])

  // 내 작업에 저장
  const handleSaveWork = useCallback(async () => {
    if (!ready || !canvas) return

    try {
      setSaving(true)
      setLoading(true, '작업을 저장하는 중...')

      // preview 모드가 활성화되어 있으면 먼저 해제
      if (previewMode) {
        setPreviewMode(false)
        const previewPlugin = getPlugin<PreviewPlugin>('PreviewPlugin')
        if (previewPlugin) {
          await previewPlugin.setPreview(false, currentSettings.colorMode)
        }
      }

      // onSaveWork 콜백이 있으면 해당 콜백 호출
      if (onSaveWork) {
        await onSaveWork()
      } else {
        console.log('내 작업에 저장: 세션 없음 (독립 실행 모드)')
      }
    } catch (error) {
      console.error('저장 중 오류:', error)
    } finally {
      setSaving(false)
      setLoading(false)
    }
  }, [ready, canvas, previewMode, getPlugin, currentSettings.colorMode, setLoading, onSaveWork])

  // 편집완료 (고객용)
  const handleFinish = useCallback(async () => {
    if (!ready || !canvas) return

    try {
      setFinishing(true)
      setLoading(true, '디자인을 저장하는 중...')

      // preview 모드가 활성화되어 있으면 먼저 해제
      if (previewMode) {
        setPreviewMode(false)
        const previewPlugin = getPlugin<PreviewPlugin>('PreviewPlugin')
        if (previewPlugin) {
          await previewPlugin.setPreview(false, currentSettings.colorMode)
        }
      }

      // onFinish 콜백이 있으면 (bookmoa 연동 모드) 해당 콜백 호출
      if (onFinish) {
        await onFinish()
      } else {
        // 독립 실행 모드 - 로컬 저장만 수행
        console.log('편집완료: 독립 실행 모드 (세션 없음)')
      }
    } catch (error) {
      console.error('디자인 저장 실패:', error)
    } finally {
      setFinishing(false)
      setLoading(false)
    }
  }, [ready, canvas, previewMode, getPlugin, currentSettings.colorMode, setLoading, onFinish])

  /**
   * CMS에 메시지 전송 (iframe 통신)
   */
  const sendMessageToCMS = useCallback((message: {
    type: 'ADMIN_EDITOR_SAVED' | 'ADMIN_EDITOR_CLOSED' | 'ADMIN_EDITOR_READY' | 'ADMIN_EDITOR_ERROR'
    payload?: { success?: boolean; error?: string; workId?: string }
  }) => {
    // iframe 내에서 실행 중인지 확인
    if (window.parent !== window) {
      window.parent.postMessage(message, '*')
      console.log('[EditorHeader] CMS 메시지 전송:', message)
    }
  }, [])

  // 관리자용 저장
  const handleSaveForAdmin = useCallback(
    async (closeWindow: boolean = false) => {
      if (!ready || !canvas) return

      try {
        setFinishing(true)
        setLoading(true, '디자인을 저장하는 중...')

        // preview 모드가 활성화되어 있으면 먼저 해제
        if (previewMode) {
          setPreviewMode(false)
          const previewPlugin = getPlugin<PreviewPlugin>('PreviewPlugin')
          if (previewPlugin) {
            await previewPlugin.setPreview(false, currentSettings.colorMode)
          }
        }

        // 관리자용 저장 실행 (useWorkSave 훅 사용)
        await saveWorkForAdmin()

        console.log('관리자 작업이 성공적으로 저장되었습니다.')

        // CMS에 저장 완료 메시지 전송
        sendMessageToCMS({
          type: 'ADMIN_EDITOR_SAVED',
          payload: { success: true }
        })

        if (closeWindow) {
          // CMS에 창 닫기 메시지 전송
          sendMessageToCMS({
            type: 'ADMIN_EDITOR_CLOSED',
            payload: { success: true }
          })

          // iframe 내에서 실행 중인 경우 부모에게 닫기 요청
          // 독립 창인 경우 직접 닫기
          if (window.parent === window && window.opener) {
            window.close()
          }
        }
      } catch (error) {
        console.error('디자인 저장 실패:', error)
        const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류'

        // CMS에 에러 메시지 전송
        sendMessageToCMS({
          type: 'ADMIN_EDITOR_ERROR',
          payload: { success: false, error: errorMessage }
        })
      } finally {
        setFinishing(false)
        setLoading(false)
      }
    },
    [ready, canvas, previewMode, getPlugin, currentSettings.colorMode, setLoading, saveWorkForAdmin, sendMessageToCMS]
  )

  // 불러오기
  const handleOpenWorkspace = useCallback(() => {
    if (onOpenWorkspace) {
      onOpenWorkspace()
    } else {
      console.log('불러오기: 세션 없음 (독립 실행 모드)')
    }
  }, [onOpenWorkspace])

  // Undo/Redo (HistoryPlugin)
  const handleUndo = useCallback(() => {
    const plugin = getPlugin<HistoryPlugin>('HistoryPlugin')
    plugin?.undo()
  }, [getPlugin])
  const handleRedo = useCallback(() => {
    const plugin = getPlugin<HistoryPlugin>('HistoryPlugin')
    plugin?.redo()
  }, [getPlugin])

  // 작업 사이즈 표시 (mm 단위)
  const sizeLabel = `${Math.round(size.width)} × ${Math.round(size.height)} mm`

  // 사이즈 변경 (프리셋/직접 입력) — currentSettings를 갱신하고 모든 WorkspacePlugin에 전파
  const applySize = useCallback(
    (nextWidth: number, nextHeight: number) => {
      const w = Math.min(SIZE_MAX_MM, Math.max(SIZE_MIN_MM, Math.round(nextWidth)))
      const h = Math.min(SIZE_MAX_MM, Math.max(SIZE_MIN_MM, Math.round(nextHeight)))
      const nextSettings = {
        ...currentSettings,
        size: {
          ...currentSettings.size,
          width: w,
          height: h,
        },
      }
      // store 업데이트는 비동기지만 직접 만든 nextSettings를 전파해서 동기화
      updateSettings({ size: { ...currentSettings.size, width: w, height: h } })
      try {
        updateAllWorkspaceSettings(nextSettings as any)
      } catch (e) {
        console.warn('[EditorHeader] applySize: workspace update failed', e)
      }
    },
    [currentSettings, updateSettings, updateAllWorkspaceSettings]
  )

  // 사이즈 popover 내부 입력 상태
  const [sizeOpen, setSizeOpen] = useState(false)
  const [draftWidth, setDraftWidth] = useState<string>(String(Math.round(size.width)))
  const [draftHeight, setDraftHeight] = useState<string>(String(Math.round(size.height)))

  // popover 열릴 때 현재 값으로 동기화
  useEffect(() => {
    if (sizeOpen) {
      setDraftWidth(String(Math.round(size.width)))
      setDraftHeight(String(Math.round(size.height)))
    }
  }, [sizeOpen, size.width, size.height])

  // 현재 사이즈가 어떤 프리셋인지 매칭 (선택 강조용)
  const matchedPreset = useMemo(() => {
    return SIZE_PRESETS.find(
      (p) => p.width === Math.round(size.width) && p.height === Math.round(size.height)
    )
  }, [size.width, size.height])

  const handleApplyDraft = useCallback(() => {
    const w = Number(draftWidth)
    const h = Number(draftHeight)
    if (!Number.isFinite(w) || !Number.isFinite(h)) return
    applySize(w, h)
    setSizeOpen(false)
  }, [draftWidth, draftHeight, applySize])

  return (
    <TooltipProvider>
      <nav className="h-14 bg-editor-panel border-b border-editor-border shadow-sm flex items-center px-4 z-[100]">
        {/* 좌측: 로고 + Undo/Redo + 자동저장 인디케이터 */}
        <div className="flex items-center gap-2">
          <span className="font-bold text-base tracking-tight text-editor-accent select-none mr-2">
            Storige
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleUndo}
                disabled={!ready || !canUndo}
                aria-label="실행 취소"
                className="h-9 w-9 text-editor-text-muted hover:bg-editor-hover disabled:opacity-40"
              >
                <Undo2 className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>실행 취소 (⌘Z)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRedo}
                disabled={!ready || !canRedo}
                aria-label="다시 실행"
                className="h-9 w-9 text-editor-text-muted hover:bg-editor-hover disabled:opacity-40"
              >
                <Redo2 className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>다시 실행 (⌘⇧Z)</TooltipContent>
          </Tooltip>
          {/* 자동 저장 상태 (클라우드 인디케이터 역할) */}
          <AutoSaveIndicator className="hidden sm:flex ml-1" />
        </div>

        {/* 중앙: 작업명 + 사이즈 표시 */}
        <div className="flex-1 flex items-center justify-center gap-3">
          <input
            type="text"
            defaultValue={artwork.name || '새로운 작업 1'}
            placeholder="제목을 입력해주세요"
            className="bg-transparent border-none outline-none text-editor-text text-sm font-medium text-center min-w-[80px] max-w-[140px] sm:max-w-[200px] md:max-w-[280px] focus:ring-1 focus:ring-editor-accent/50 rounded px-2 py-1"
            onBlur={handleNameChange}
            onKeyDown={handleNameChange}
          />
          <Popover open={sizeOpen} onOpenChange={setSizeOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="작업 사이즈 변경"
                className="hidden md:inline-flex items-center gap-1 px-2 py-1 text-xs text-editor-text-muted border border-editor-border rounded-md bg-editor-surface-low hover:bg-editor-hover hover:border-editor-border transition-colors"
              >
                <span>{sizeLabel}</span>
                <ChevronDown className="h-3 w-3 text-editor-text-muted" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="center" sideOffset={6} className="w-72 p-3">
              <div className="text-[12px] font-semibold text-editor-text mb-2">
                작업 사이즈
              </div>
              <div className="grid grid-cols-2 gap-1.5 mb-3">
                {SIZE_PRESETS.map((preset) => {
                  const active = matchedPreset?.label === preset.label
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        applySize(preset.width, preset.height)
                        setSizeOpen(false)
                      }}
                      className={`flex flex-col items-start px-2.5 py-1.5 rounded-md border text-left transition-colors ${
                        active
                          ? 'border-editor-accent bg-editor-accent/10 text-editor-accent'
                          : 'border-editor-border hover:bg-editor-surface-low text-editor-text'
                      }`}
                    >
                      <span className="text-[12px] font-medium">{preset.label}</span>
                      <span className="text-[11px] text-editor-text-muted">
                        {preset.width} × {preset.height} mm
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="border-t border-editor-border pt-3">
                <div className="text-[11px] text-editor-text-muted mb-1.5">직접 입력 (mm)</div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={SIZE_MIN_MM}
                    max={SIZE_MAX_MM}
                    value={draftWidth}
                    onChange={(e) => setDraftWidth(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleApplyDraft()
                    }}
                    className="h-8 text-xs"
                    aria-label="너비"
                  />
                  <span className="text-xs text-editor-text-muted">×</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={SIZE_MIN_MM}
                    max={SIZE_MAX_MM}
                    value={draftHeight}
                    onChange={(e) => setDraftHeight(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleApplyDraft()
                    }}
                    className="h-8 text-xs"
                    aria-label="높이"
                  />
                  <Button
                    size="sm"
                    onClick={handleApplyDraft}
                    className="h-8 px-3 bg-editor-accent hover:bg-editor-accent-hover text-white"
                  >
                    적용
                  </Button>
                </div>
                <div className="mt-1.5 text-[10px] text-editor-text-muted">
                  {SIZE_MIN_MM}~{SIZE_MAX_MM} mm 범위. 재단/안전 영역은 유지됩니다.
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* 우측: 보기 옵션 + 불러오기 + 편집완료 + 도움말 */}
        <div className="flex items-center gap-1 md:gap-2">
          {/* 룰러 토글 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleRuler}
                aria-label={showRuler ? '룰러 끄기' : '룰러 켜기'}
                aria-pressed={showRuler}
                className={`h-9 w-9 ${showRuler ? 'bg-editor-accent/10 text-editor-accent hover:bg-editor-accent/20 hover:text-editor-accent' : 'text-editor-text-muted hover:bg-editor-hover'}`}
              >
                <Ruler className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>룰러 {showRuler ? '끄기' : '켜기'}</TooltipContent>
          </Tooltip>

          {/* 테마 토글 (light → dark → system → light) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={cycleTheme}
                aria-label={`테마 변경 (현재: ${theme === 'light' ? '라이트' : theme === 'dark' ? '다크' : '시스템'})`}
                className="h-9 w-9 text-editor-text-muted hover:bg-editor-hover"
              >
                {theme === 'light' && <Sun className="h-5 w-5" />}
                {theme === 'dark' && <Moon className="h-5 w-5" />}
                {theme === 'system' && <Monitor className="h-5 w-5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              테마: {theme === 'light' ? '라이트' : theme === 'dark' ? '다크' : '시스템'} (클릭하여 변경)
            </TooltipContent>
          </Tooltip>

          {/* 3D 미리보기 (스프레드 모드 전용) */}
          {isSpreadMode && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShow3DMockup(true)}
                  disabled={!ready}
                  className="h-9 w-9 text-editor-text-muted hover:bg-editor-hover"
                >
                  <Box className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>3D 미리보기</TooltipContent>
            </Tooltip>
          )}

          {/* 페이지 네비 위치 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <select
                value={pageNavPosition}
                onChange={(e) => setPageNavPosition(e.target.value as PageNavPosition)}
                className="hidden md:block text-xs px-2 py-1 rounded-md border border-editor-border bg-editor-panel hover:bg-editor-hover transition-colors cursor-pointer text-editor-text-muted"
                aria-label="페이지 네비 위치"
              >
                <option value="auto">네비: 자동</option>
                <option value="right">네비: 우측</option>
                <option value="bottom">네비: 하단</option>
              </select>
            </TooltipTrigger>
            <TooltipContent>페이지 네비 위치 (PC에서만 표시)</TooltipContent>
          </Tooltip>

          {/* 도움말 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 text-editor-text-muted hover:bg-editor-hover">
                <HelpCircle className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>도움말</TooltipContent>
          </Tooltip>

          {/* 구분선 */}
          <div className="hidden md:block w-px h-6 bg-editor-border mx-1" />

          {/* 불러오기 */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenWorkspace}
            className="hidden md:flex rounded-full border-editor-border text-editor-text hover:bg-editor-surface-low px-4"
          >
            <FolderOpen className="h-4 w-4 mr-2" />
            불러오기
          </Button>

          {/* 편집완료 (고객용) */}
          {!isAdmin && (
            <Button
              size="sm"
              onClick={handleFinish}
              disabled={!ready || finishing}
              className="bg-editor-accent hover:bg-editor-accent-hover text-white rounded-full shadow-sm px-4"
            >
              {finishing ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              편집완료
            </Button>
          )}

          {/* 편집완료 (관리자용) */}
          {isAdmin && (
            <Button
              onClick={() => handleSaveForAdmin(true)}
              disabled={!ready || finishing}
              className="bg-editor-accent hover:bg-editor-accent-hover text-white rounded-full shadow-sm"
            >
              {finishing ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              편집완료
            </Button>
          )}
        </div>
      </nav>

      {/* 3D 미리보기 모달 */}
      {show3DMockup && spreadConfig && (
        <BookMockup3D
          spineWidthMm={spreadConfig.spec.spineWidthMm}
          coverWidthMm={spreadConfig.spec.coverWidthMm}
          coverHeightMm={spreadConfig.spec.coverHeightMm}
          onClose={() => setShow3DMockup(false)}
        />
      )}
    </TooltipProvider>
  )
}
