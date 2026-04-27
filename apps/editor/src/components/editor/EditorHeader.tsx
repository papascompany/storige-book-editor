import { useState, useCallback } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useIsAdmin } from '@/stores/useAuthStore'
import { useWorkSave } from '@/hooks/useWorkSave'
import { ServicePlugin, PreviewPlugin } from '@storige/canvas-core'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Stack,
  Question,
  FloppyDisk,
  DownloadSimple,
  UploadSimple,
  Monitor,
  Check,
  Cube,
} from '@phosphor-icons/react'
import { AutoSaveIndicator } from './AutoSaveIndicator'
import { BookMockup3D } from '../Mockup3D/BookMockup3D'
import { useUiPrefStore, type PageNavPosition } from '@/stores/useUiPrefStore'

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

  // Stores
  const { ready, canvas, allCanvas, allEditors, getPlugin, setPage, isSpreadMode } = useAppStore()
  const { artwork, currentSettings, spreadConfig } = useSettingsStore()
  const isAdmin = useIsAdmin()

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

  return (
    <TooltipProvider>
      <nav className="h-12 bg-gradient-to-b from-violet-200 to-white border-b border-b-editor-border flex items-center px-4 z-[100]">
        {/* 왼쪽: 작업 제목 + 자동저장 상태 */}
        <div className="flex items-center gap-4">
          <input
            type="text"
            defaultValue={artwork.name || '새로운 작업 1'}
            placeholder="새로운 작업 1"
            className="bg-transparent border-none outline-none text-editor-text text-base font-medium w-40 md:w-auto focus:ring-1 focus:ring-editor-accent rounded px-2 py-1"
            onBlur={handleNameChange}
            onKeyDown={handleNameChange}
          />
          {/* 자동 저장 상태 표시 */}
          <AutoSaveIndicator className="hidden sm:flex" />
        </div>

        {/* 오른쪽: 액션 버튼들 */}
        <div className="ml-auto flex items-center gap-2 md:gap-4">
          {/* 데스크톱/태블릿 버튼들 */}
          <div className="hidden md:flex items-center gap-2">
            {/* 인쇄 미리보기 - 숨김 처리 */}
            {/* <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={previewMode ? 'default' : 'ghost'}
                  size="icon"
                  onClick={handlePreview}
                  disabled={!ready}
                >
                  <Monitor className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>인쇄 미리보기</TooltipContent>
            </Tooltip> */}

            {/* 3D 미리보기 (스프레드 모드 전용) */}
            {isSpreadMode && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShow3DMockup(true)}
                    disabled={!ready}
                  >
                    <Cube className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>3D 미리보기</TooltipContent>
              </Tooltip>
            )}

            {/* PDF 저장 - 숨김 처리 */}
            {/* <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={saveAllPagesToSinglePDF}
                  disabled={!ready}
                >
                  <DownloadSimple className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>PDF 저장</TooltipContent>
            </Tooltip> */}

            {/* 내 작업에 저장 - 숨김 처리 */}
            {/* <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={isAdmin ? () => handleSaveForAdmin(false) : handleSaveWork}
                  disabled={!ready || saving}
                >
                  {saving ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-editor-text" />
                  ) : (
                    <UploadSimple className="h-5 w-5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>내 작업에 저장</TooltipContent>
            </Tooltip> */}
          </div>

          {/* 구분선 */}
          <div className="hidden md:block w-px h-6 bg-editor-border" />

          {/* 불러오기 */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenWorkspace}
            className="hidden md:flex rounded-full"
          >
            <FloppyDisk className="h-4 w-4 mr-2" />
            불러오기
          </Button>

          {/* 편집완료 버튼 */}
          {!isAdmin && (
            <Button
              onClick={handleFinish}
              disabled={!ready || finishing}
              className="bg-editor-accent hover:bg-editor-accent-hover text-white rounded-full"
            >
              {finishing ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              편집완료
            </Button>
          )}

          {/* 관리자용 편집완료 버튼 */}
          {isAdmin && (
            <Button
              onClick={() => handleSaveForAdmin(true)}
              disabled={!ready || finishing}
              className="bg-editor-accent hover:bg-editor-accent-hover text-white rounded-full"
            >
              {finishing ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              편집완료
            </Button>
          )}

          {/* 구분선 */}
          <div className="w-px h-6 bg-editor-border" />

          {/* 레이어 패널 토글 - 숨김 처리 */}

          {/* 페이지 네비게이션 위치 선택 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <select
                value={pageNavPosition}
                onChange={(e) => setPageNavPosition(e.target.value as PageNavPosition)}
                className="hidden md:block text-xs px-2 py-1 rounded-md border border-editor-border bg-white/80 hover:bg-white transition-colors cursor-pointer"
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
              <Button variant="ghost" size="icon">
                <Question className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>도움말</TooltipContent>
          </Tooltip>
        </div>

        {/* 모바일 버튼들 */}
        {screenMode === 'mobile' && (
          <div className="flex md:hidden items-center gap-2">
            {/* 편집완료 */}
            <Button
              variant="ghost"
              size="icon"
              onClick={isAdmin ? () => handleSaveForAdmin(true) : handleFinish}
              disabled={!ready || finishing}
            >
              <Check className="h-5 w-5" />
            </Button>
          </div>
        )}
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
