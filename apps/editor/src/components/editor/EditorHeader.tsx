import { useState, useCallback, useEffect, useMemo } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useIsAdmin } from '@/stores/useAuthStore'
import { useWorkSave } from '@/hooks/useWorkSave'
import { useTemplateSetSave } from '@/hooks/useTemplateSetSave'
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
  Save,
  Layers,
  Eye,
} from 'lucide-react'
import { AutoSaveIndicator } from './AutoSaveIndicator'
import { BookMockup3D } from '../Mockup3D/BookMockup3D'
import KeyboardShortcutsModal from './KeyboardShortcutsModal'
import CommandPaletteModal from './CommandPaletteModal'
import HistoryPanel from './HistoryPanel'
import { showToast } from '@/stores/useToastStore'
import { useUiPrefStore, type PageNavPosition, type Theme } from '@/stores/useUiPrefStore'
import { applyObjectPermissions, revertObjectPermissions } from '@/utils/objectPermissions'

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
  /**
   * Admin "템플릿셋 수정" 모드 — true 면 저장 동작이 templates.canvas_data PATCH 로 전환.
   * EditorView 가 ?adminEdit=templateSet 파라미터 + admin 권한일 때 true 로 전달.
   */
  isAdminTemplateSetEdit?: boolean
  /**
   * S1 (2026-07-04): 주문 컨텍스트(embed 임베드) — true 면 규격의 권위가 상품 옵션에
   * 있으므로 '작업 사이즈'를 읽기전용 라벨로 강등(클릭 시 안내 토스트). 관리자(editMode)
   * 는 템플릿 제작 목적이라 편집 가능 유지. EmbeddedEditor 가 true 로 전달.
   * 배경: 편집기 내 규격 변경이 세션 metadata·가격·주문 옵션에 전파되지 않아
   * SIZE_MISMATCH/가격 불일치 사고 소지 — EDITOR_SAVE_LOAD_AND_SIZE_GAP_WORKORDER §3.
   */
  orderContext?: boolean
}

export default function EditorHeader({
  screenMode = 'desktop',
  onToggleSidePanel,
  onLoadingChange,
  onFinish,
  onSaveWork,
  onOpenWorkspace,
  isAdminTemplateSetEdit = false,
  orderContext = false,
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

  // 단축키 도움말 모달 — 키 리스너는 handleFinish/handleSaveForAdmin 정의 후 useEffect로 등록
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // 커맨드 팔레트 모달 (Cmd+K)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Stores
  const { ready, canvas, allCanvas, allEditors, getPlugin, setPage, isSpreadMode, updateAllWorkspaceSettings } = useAppStore()
  const { artwork, currentSettings, spreadConfig, updateSettings, setArtworkName } = useSettingsStore()
  const isAdmin = useIsAdmin()

  // L3 B-3 (2026-07-06): 고객 시점 미리보기 — 디자이너가 보호 강제를 고객 모드 그대로
  // 체험(저장 없는 일시 모드). editMode 를 실제로 내리되 customerPreview 플래그가
  // ① 복귀 버튼 게이트 ② EditorView/TemplateEditorView 의 editMode 자동 승격 억제
  // ③ 저장 차단을 담당한다. 종료 시 revert+재승격으로 정확 원복.
  const customerPreview = useSettingsStore((s) => s.customerPreview)
  const setCustomerPreview = useSettingsStore((s) => s.setCustomerPreview)

  const toggleCustomerPreview = useCallback(() => {
    const { allCanvas: cvs, allEditors: eds } = useAppStore.getState()
    if (!customerPreview) {
      setCustomerPreview(true)
      updateSettings({ editMode: false })
      eds.forEach((ed) =>
        (ed?.getPlugin?.('LockPlugin') as { setUserRole?: (r: string) => void } | undefined)?.setUserRole?.('user')
      )
      cvs.forEach((c: unknown) => applyObjectPermissions(c as never, false))
      // B-5 stale 방지: 레이어 목록의 template-element 노출 분기를 즉시 재계산
      useAppStore.getState().updateObjects()
      showToast('고객 화면 미리보기 중 — 저장은 잠겨 있어요.', 'info')
    } else {
      cvs.forEach((c: unknown) => revertObjectPermissions(c as never))
      setCustomerPreview(false)
      updateSettings({ editMode: true })
      eds.forEach((ed) =>
        (ed?.getPlugin?.('LockPlugin') as { setUserRole?: (r: string) => void } | undefined)?.setUserRole?.('admin')
      )
      // contentEditable 강제분(editable=false) 원복은 editMode 분기가 담당
      cvs.forEach((c: unknown) => applyObjectPermissions(c as never, true))
      useAppStore.getState().updateObjects()
    }
  }, [customerPreview, setCustomerPreview, updateSettings])

  // (작업명 핸들러는 commitArtworkName/handleNameKeyDown으로 정의 — 아래)

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
    // afterLoad 직후 stale 케이스 방어 — 100ms / 500ms 후 한 번 더 동기화
    const stale1 = setTimeout(refresh, 100)
    const stale2 = setTimeout(refresh, 500)

    const editorHandlers: Array<{ editor: any; fn: () => void }> = []
    allEditors.forEach((editor: any) => {
      if (!editor?.on) return
      const fn = () => refresh()
      editor.on('historyUpdate', fn)
      editorHandlers.push({ editor, fn })
    })

    return () => {
      clearTimeout(stale1)
      clearTimeout(stale2)
      editorHandlers.forEach(({ editor, fn }) => {
        try { editor.off?.('historyUpdate', fn) } catch { /* noop */ }
      })
    }
  }, [ready, allEditors, canvas])

  // Work save hook for admin
  const { saveWorkForAdmin, saving: workSaving } = useWorkSave()
  // Admin "템플릿셋 수정" 모드 전용 저장 — 각 페이지 → templates.canvas_data PATCH
  const { saveTemplateSet, saving: templateSetSaving } = useTemplateSetSave()

  // Size from settings
  const size = currentSettings.size || { width: 100, height: 100, cutSize: 5, safeSize: 5, printSize: undefined }

  // Loading helper
  const setLoading = useCallback(
    (loading: boolean, message?: string) => {
      onLoadingChange?.(loading, message)
    },
    [onLoadingChange]
  )

  // K-1: 작업명 핸들러는 input JSX 인라인 (closure 단순화)

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

      showToast(
        '인쇄 미리보기 모드가 ' + (newPreviewMode ? '활성화' : '비활성화') + '되었습니다.',
        'info'
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
        // P0-3 (2026-06-02): 인쇄 화질 정합 — embed/스프레드 경로(300 DPI)와 통일.
        // 기존 72 DPI는 px→mm 변환이 ~4배 어긋나 인쇄물 물리 크기 불일치 원인이었음.
        300
      )

      // 원래 페이지로 돌아가기
      if (originalCanvasIndex >= 0) {
        setPage(originalCanvasIndex)
      }

      showToast('모든 페이지가 PDF로 저장되었습니다.', 'success')
    } catch (error) {
      console.error('PDF 저장 중 오류:', error)
      showToast(
        `PDF 저장 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`,
        'error',
        6000
      )
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
        showToast('내 작업에 저장됐습니다.', 'success')
      } else {
        showToast('독립 실행 모드 — 외부 저장 콜백 없음', 'info')
      }
    } catch (error) {
      console.error('저장 중 오류:', error)
      showToast(
        `저장 중 오류: ${error instanceof Error ? error.message : String(error)}`,
        'error',
        6000
      )
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
        showToast('편집이 완료되었습니다.', 'success')
      } else {
        showToast('독립 실행 모드 — 편집완료 콜백 없음', 'info')
      }
    } catch (error) {
      console.error('디자인 저장 실패:', error)
      showToast(
        `저장 실패: ${error instanceof Error ? error.message : String(error)}`,
        'error',
        6000
      )
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
      // L3 B-3: 미리보기 강제 상태(lockMovement 등)가 저장본에 새는 것 방지
      if (useSettingsStore.getState().customerPreview) {
        showToast('고객 화면 미리보기 중에는 저장할 수 없어요 — 미리보기를 끄고 저장해주세요.', 'info')
        return
      }

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

        // ====== Admin "템플릿셋 수정" 모드 분기 ======
        // EditorView 가 ?adminEdit=templateSet 으로 진입한 경우, editor_designs 에 작품을
        // 만드는 saveWorkForAdmin 대신 각 페이지의 fabric canvas → 해당 templates.canvas_data
        // 로 PATCH 한다. 같은 templateId 가 반복되면 한 번만 저장 (데이터 모델 그대로 따름).
        if (isAdminTemplateSetEdit) {
          const result = await saveTemplateSet()
          showToast(
            `템플릿셋 저장됨 (${result.savedCount}/${result.totalPages} templates 갱신)`,
            'success'
          )
        } else {
          // 기존 흐름 — editor_designs 에 admin 작품으로 저장
          await saveWorkForAdmin()
          showToast('저장됐습니다.', 'success')
        }

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

        showToast(`저장 실패: ${errorMessage}`, 'error', 6000)

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
    [ready, canvas, previewMode, getPlugin, currentSettings.colorMode, setLoading, saveWorkForAdmin, saveTemplateSet, isAdminTemplateSetEdit, sendMessageToCMS]
  )

  // 불러오기
  const handleOpenWorkspace = useCallback(() => {
    if (onOpenWorkspace) {
      onOpenWorkspace()
    } else {
      showToast('독립 실행 모드 — 불러오기 콜백 없음', 'info')
    }
  }, [onOpenWorkspace])

  /**
   * Phase 2-F — Admin "템플릿셋 수정" 저장 직전 확인.
   *
   * 같은 templateSetId 로 진입하는 모든 사용자에게 새 디자인이 노출되므로
   * 운영 사고(실수로 빈 캔버스 저장 등) 방지를 위해 명시적 확인 단계를 둔다.
   * window.confirm 으로 충분 — 운영 가드 목적이며 디자인 일관성보다 안정성 우선.
   */
  const confirmAndSaveTemplateSet = useCallback(
    (closeWindow: boolean) => {
      // L3 B-3: 미리보기 강제 상태가 템플릿 저장본에 새는 것 방지
      if (useSettingsStore.getState().customerPreview) {
        showToast('고객 화면 미리보기 중에는 저장할 수 없어요 — 미리보기를 끄고 저장해주세요.', 'info')
        return
      }
      const { allCanvas } = useAppStore.getState()
      const { editorTemplates } = useSettingsStore.getState()
      const sliced = (editorTemplates as Array<{ id?: string }>).slice(0, allCanvas.length)
      const uniqueIds = new Set(sliced.map((t) => t?.id).filter(Boolean))
      const msg =
        '이 템플릿셋의 모든 페이지 디자인을 갱신합니다.\n\n' +
        `• 영향 페이지: ${allCanvas.length}개\n` +
        `• PATCH 대상 templates: ${uniqueIds.size}개 (중복 templateId 제거)\n` +
        '• 갱신 후 같은 templateSetId 로 진입하는 모든 사용자에게 새 디자인이 보입니다.\n\n' +
        (closeWindow
          ? '저장 후 창을 닫습니다. 진행하시겠습니까?'
          : '저장 후 계속 편집할 수 있습니다. 진행하시겠습니까?')
      if (!window.confirm(msg)) return
      void handleSaveForAdmin(closeWindow)
    },
    [handleSaveForAdmin]
  )

  // ? 키 + Cmd/Ctrl+S 글로벌 리스너 — handleFinish/handleSaveForAdmin 정의 후 등록
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const inInput = !!target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      )

      // ? 키 → 단축키 도움말 토글
      if (e.key === '?' && !inInput) {
        e.preventDefault()
        setShortcutsOpen((v) => !v)
        return
      }

      // Cmd/Ctrl+K → 커맨드 팔레트 토글 (입력 필드에서도 동작)
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }

      // Cmd/Ctrl+S → 저장 (브라우저 저장 다이얼로그 차단)
      // - admin "템플릿셋 수정" 모드: 운영 가드(confirm) 적용된 저장 경로 사용
      // - admin standalone: 기존 saveWorkForAdmin (editor_designs 작품 저장)
      // - 고객: handleFinish (PHP 콜백 또는 standalone 토스트)
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        if (inInput) return
        if (!ready || finishing) return
        if (isAdminTemplateSetEdit) {
          confirmAndSaveTemplateSet(false)
        } else if (isAdmin) {
          handleSaveForAdmin(false)
        } else {
          handleFinish()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ready, finishing, isAdmin, isAdminTemplateSetEdit, handleFinish, handleSaveForAdmin, confirmAndSaveTemplateSet])

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

  // S1 (2026-07-04): 주문 컨텍스트(embed 고객)에서는 규격 편집 차단 — 읽기전용 라벨.
  // 규격 권위 = 상품 옵션(파트너 장바구니). 관리자(editMode)는 편집 가능 유지.
  const sizeReadOnly = orderContext && !currentSettings.editMode

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
          {/* 저장 상태 인디케이터.
              - 일반(고객) 모드: 자동저장(useEmbedAutoSave)이 useSaveStore 를 갱신 → AutoSaveIndicator 가 실시간 표시.
              - admin "템플릿셋 수정" 모드: 자동저장 미적용 → AutoSaveIndicator 의 거짓 "저장됨" 표시 방지를 위해 숨기고
                "수동 저장 모드" 뱃지로 명확히 구분. */}
          {!isAdminTemplateSetEdit ? (
            <AutoSaveIndicator className="hidden sm:flex ml-1" />
          ) : (
            <span
              className="hidden sm:inline-flex items-center gap-1 ml-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 text-[11px] font-medium border border-amber-200 dark:border-amber-700/50"
              title="이 모드에서는 자동저장이 동작하지 않습니다. ⌘S 또는 우측 '저장' 버튼을 눌러 명시적으로 저장하세요."
            >
              <span aria-hidden>⚠</span>
              수동 저장 모드
            </span>
          )}

          {/* 변경 이력 요약 popover — 모바일(< sm) 에서 숨김 */}
          <span className="hidden sm:contents">
            <HistoryPanel />
          </span>
        </div>

        {/* 중앙: 작업명 + 사이즈 표시 */}
        <div className="flex-1 flex items-center justify-center gap-3">
          <input
            key={artwork.name || 'untitled'}
            type="text"
            defaultValue={artwork.name || ''}
            placeholder="제목을 입력해주세요"
            aria-label="작업명"
            className="bg-transparent border-none outline-none text-editor-text text-sm font-medium text-center min-w-[80px] max-w-[140px] sm:max-w-[180px] md:max-w-[200px] lg:max-w-[280px] focus:ring-1 focus:ring-editor-accent/50 rounded px-2 py-1"
            onBlur={(e) => {
              const value = (e.target as HTMLInputElement).value.trim()
              if (!value) {
                ;(e.target as HTMLInputElement).value = artwork.name || ''
                return
              }
              if (value !== artwork.name) {
                useSettingsStore.getState().setArtworkName(value)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                ;(e.target as HTMLInputElement).blur()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                ;(e.target as HTMLInputElement).value = artwork.name || ''
                ;(e.target as HTMLInputElement).blur()
              }
            }}
          />
          {sizeReadOnly ? (
            /* S1: 주문 컨텍스트 — 규격 읽기전용 라벨. 클릭 시 안내만(권위=상품 옵션). */
            <button
              type="button"
              aria-label="작업 사이즈 (상품 옵션에서 변경)"
              onClick={() =>
                showToast('규격은 상품 옵션에서 변경할 수 있어요.', 'info')
              }
              className="hidden md:inline-flex items-center gap-1 px-2 py-1 text-xs text-editor-text-muted border border-editor-border rounded-md bg-editor-surface-low cursor-help"
            >
              <span>{sizeLabel}</span>
            </button>
          ) : (
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
          )}
        </div>

        {/* 우측: 보기 옵션 + 불러오기 + 편집완료 + 도움말 */}
        <div className="flex items-center gap-1 md:gap-2">
          {/* 룰러 토글 — 모바일(< sm) 에서 숨김 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleRuler}
                aria-label={showRuler ? '룰러 끄기' : '룰러 켜기'}
                aria-pressed={showRuler}
                className={`hidden sm:inline-flex h-9 w-9 ${showRuler ? 'bg-editor-accent/10 text-editor-accent hover:bg-editor-accent/20 hover:text-editor-accent' : 'text-editor-text-muted hover:bg-editor-hover'}`}
              >
                <Ruler className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>룰러 {showRuler ? '끄기' : '켜기'}</TooltipContent>
          </Tooltip>

          {/* 테마 토글 — 모바일(< sm) 에서 숨김 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={cycleTheme}
                aria-label={`테마 변경 (현재: ${theme === 'light' ? '라이트' : theme === 'dark' ? '다크' : '시스템'})`}
                className="hidden sm:inline-flex h-9 w-9 text-editor-text-muted hover:bg-editor-hover"
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
                className="hidden lg:block text-xs px-2 py-1 rounded-md border border-editor-border bg-editor-panel hover:bg-editor-hover transition-colors cursor-pointer text-editor-text-muted"
                aria-label="페이지 네비 위치"
              >
                <option value="auto">네비: 자동</option>
                <option value="right">네비: 우측</option>
                <option value="bottom">네비: 하단</option>
              </select>
            </TooltipTrigger>
            <TooltipContent>페이지 네비 위치 (1024px 이상에서만 표시 · ⌘K로도 변경)</TooltipContent>
          </Tooltip>

          {/* 도움말 — 모바일(< sm) 에서 숨김 */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShortcutsOpen(true)}
                aria-label="키보드 단축키 도움말"
                className="hidden sm:inline-flex h-9 w-9 text-editor-text-muted hover:bg-editor-hover"
              >
                <HelpCircle className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>키보드 단축키 (?)</TooltipContent>
          </Tooltip>

          {/* 구분선 */}
          <div className="hidden md:block w-px h-6 bg-editor-border mx-1" />

          {/* 불러오기 — admin "템플릿셋 수정" 모드에서는 의미 없음(templateSet 자체를 편집 중) → 숨김. */}
          {!isAdminTemplateSetEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenWorkspace}
              className="hidden md:flex rounded-full border-editor-border text-editor-text hover:bg-editor-surface-low px-4"
            >
              <FolderOpen className="h-4 w-4 mr-2" />
              불러오기
            </Button>
          )}

          {/* L1② (2026-07-06): 레이어 패널 진입점 복원 — cefe2d4 에서 제거된 뒤 고객이
              SidePanel 을 열 방법이 0이던 갭. onToggleSidePanel prop 은 embed/EditorView
              양쪽에서 배선되므로 이 버튼 하나로 두 화면 진입점 동시 복원. */}
          {onToggleSidePanel && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onToggleSidePanel}
                  aria-label="레이어 패널"
                  className="text-editor-text hover:bg-editor-surface-low"
                >
                  <Layers className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">레이어</TooltipContent>
            </Tooltip>
          )}

          {/* L3 B-3: 고객 시점 미리보기 토글 — editMode(디자이너)일 때 노출, 미리보기 중에는
              복귀 버튼으로 유지(editMode 가 내려가 있으므로 customerPreview 로 게이트). */}
          {(currentSettings.editMode || customerPreview) && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggleCustomerPreview}
                    aria-label="고객 화면으로 보기"
                    aria-pressed={customerPreview}
                    className={customerPreview ? 'text-amber-500 hover:bg-editor-surface-low' : 'text-editor-text hover:bg-editor-surface-low'}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {customerPreview ? '디자이너 화면으로 돌아가기' : '고객 화면으로 보기'}
                </TooltipContent>
              </Tooltip>
              {customerPreview && (
                <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-600">
                  고객 화면 미리보기 중
                </span>
              )}
            </>
          )}

          {/* === 우측 액션 (모드별 분리) === */}

          {/* 1) Admin "템플릿셋 수정" 모드 — 두 버튼: "저장" (창 유지) + "저장 후 닫기".
                둘 다 templates.canvas_data PATCH. window.confirm 으로 운영 사고 방지 가드. */}
          {isAdminTemplateSetEdit && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => confirmAndSaveTemplateSet(false)}
                    disabled={!ready || finishing || templateSetSaving}
                    aria-label="템플릿셋 저장"
                    className="hidden sm:inline-flex rounded-full border-editor-border text-editor-text hover:bg-editor-surface-low px-4"
                  >
                    {(finishing || templateSetSaving) ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    저장
                  </Button>
                </TooltipTrigger>
                <TooltipContent>각 페이지 캔버스를 templates.canvas_data 로 저장 (창 유지) · ⌘S</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => confirmAndSaveTemplateSet(true)}
                    disabled={!ready || finishing || templateSetSaving}
                    aria-label="저장 후 닫기"
                    className="bg-editor-accent hover:bg-editor-accent-hover text-white rounded-full shadow-sm px-2 sm:px-4"
                  >
                    {(finishing || templateSetSaving) ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white sm:mr-2" />
                    ) : (
                      <Check className="h-4 w-4 sm:mr-2" />
                    )}
                    <span className="sr-only sm:not-sr-only">저장 후 닫기</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>저장 후 이 창을 닫습니다.</TooltipContent>
              </Tooltip>
            </>
          )}

          {/* 2) Admin standalone(legacy, adminEdit 파라미터 없음) — 기존 saveWorkForAdmin (editor_designs 작품 저장) */}
          {!isAdminTemplateSetEdit && isAdmin && (
            <Button
              onClick={() => handleSaveForAdmin(true)}
              disabled={!ready || finishing}
              aria-label="편집완료"
              className="bg-editor-accent hover:bg-editor-accent-hover text-white rounded-full shadow-sm px-2 sm:px-4"
            >
              {finishing ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white sm:mr-2" />
              ) : (
                <Check className="h-4 w-4 sm:mr-2" />
              )}
              <span className="sr-only sm:not-sr-only">편집완료</span>
            </Button>
          )}

          {/* 3) 고객 — 편집완료 (PHP/embed 콜백 또는 standalone 토스트) */}
          {!isAdmin && (
            <Button
              size="sm"
              onClick={handleFinish}
              disabled={!ready || finishing}
              aria-label="편집완료"
              className="bg-editor-accent hover:bg-editor-accent-hover text-white rounded-full shadow-sm px-2 sm:px-4"
            >
              {finishing ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white sm:mr-2" />
              ) : (
                <Check className="h-4 w-4 sm:mr-2" />
              )}
              <span className="sr-only sm:not-sr-only">편집완료</span>
            </Button>
          )}
        </div>
      </nav>

      {/* 단축키 도움말 모달 */}
      <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {/* 커맨드 팔레트 (Cmd+K) — admin "템플릿셋 수정" 모드는 confirm 거친 저장 경로 사용 */}
      <CommandPaletteModal
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onFinish={
          isAdminTemplateSetEdit
            ? () => confirmAndSaveTemplateSet(false)
            : isAdmin
              ? () => handleSaveForAdmin(false)
              : handleFinish
        }
        onOpenWorkspace={handleOpenWorkspace}
        onOpenShortcuts={() => {
          setPaletteOpen(false)
          setShortcutsOpen(true)
        }}
      />

      {/* 3D 미리보기 모달 — 표지 스프레드 전용(spine/cover). 포토북 내지(spec 없음)는 미해당 */}
      {show3DMockup && spreadConfig?.spec && (
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
