import { useEffect, useRef, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@/stores/useAuthStore'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useTemplateSave, type UpdateTemplateOptions } from '@/hooks/useTemplateSave'
import { templatesApi } from '@/api'
import { createCanvas } from '@/utils/createCanvas'
import { ServicePlugin, computeLayout } from '@storige/canvas-core'
import { normalizeSpreadSpec, computeSpreadDimensions, TemplateType } from '@storige/types'
import type { SpreadSpec, SpreadConfig, SpreadLayout, SpreadConversionMode, SpreadInnerSpec } from '@storige/types'
import { buildInnerSpreadConfig } from '@/utils/photobookSpread'
import ToolBar from '@/components/editor/ToolBar'
import FeatureSidebar from '@/components/editor/FeatureSidebar'
import ControlBar from '@/components/editor/ControlBar'
import SidePanel from '@/components/editor/SidePanel'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Layers as Stack, Save as FloppyDisk, X, Check } from 'lucide-react'

// PostMessage 이벤트 타입
interface TemplateEditorMessage {
  type: 'TEMPLATE_SAVED' | 'TEMPLATE_CLOSED' | 'TEMPLATE_READY'
  payload?: {
    templateId?: string
    success?: boolean
    error?: string
  }
}

/**
 * TemplateEditorView - 템플릿 생성/편집 전용 에디터 뷰
 * Admin 대시보드에서 iframe으로 로드되어 사용됨
 */
export default function TemplateEditorView() {
  const [searchParams] = useSearchParams()
  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const isInitializedRef = useRef(false)
  const [isLoading, setIsLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('')
  const [showSidePanel, setShowSidePanel] = useState(false)
  const [templateName, setTemplateName] = useState('새 템플릿')

  // Query parameters
  const templateId = searchParams.get('templateId')
  const token = searchParams.get('token')
  const nameParam = searchParams.get('name')
  const widthParam = searchParams.get('width')
  const heightParam = searchParams.get('height')
  const typeParam = searchParams.get('type') as TemplateType | null
  const modeParam = searchParams.get('mode')
  const specParam = searchParams.get('spec')

  // Spread mode detection & spec parsing
  const [spreadError, setSpreadError] = useState<string | null>(null)
  const spreadSpecRef = useRef<SpreadSpec | null>(null)
  const spreadLayoutRef = useRef<SpreadLayout | null>(null)
  // 포토북 내지 펼침면(2-up, O-2): admin 이 spec 으로 보낸 regionScope='inner' config 의 innerSpec.
  // 표지(cover) spec 과 별개 — 존재하면 좌/우 면+거터 모델로 저장/렌더한다.
  const innerSpecRef = useRef<SpreadInnerSpec | null>(null)
  // 템플릿 로드 시 기존 spreadConfig.conversionMode 보관 — 저장 시 spreadConfig 를
  // {version,spec,regions,...} 로 재구성하면서 conversionMode 가 유실(라운드트립 'full' 강등)
  // 되는 사고 방지. 없으면 필드 자체를 생략(legacy='full' 간주는 소비측 규약).
  const existingConversionModeRef = useRef<SpreadConversionMode | undefined>(undefined)

  const isSpreadMode = modeParam === 'spread' && specParam != null

  // Parse and validate spread spec (once)
  if (isSpreadMode && !spreadSpecRef.current && !innerSpecRef.current && !spreadError) {
    try {
      const parsed = JSON.parse(specParam!)
      if (parsed?.regionScope === 'inner' && parsed?.innerSpec) {
        // 포토북 내지 펼침면(2-up): innerSpec 권위 — cover 파싱(normalizeSpreadSpec) 우회.
        const is = parsed.innerSpec as SpreadInnerSpec
        if (!(is.pageWidthMm > 0) || !(is.pageHeightMm > 0)) {
          throw new Error('innerSpec.pageWidthMm/pageHeightMm은 양수여야 합니다')
        }
        innerSpecRef.current = is
      } else {
        const normalized = normalizeSpreadSpec(parsed)
        // Validate finite + positive
        if (normalized.coverWidthMm <= 0 || normalized.coverHeightMm <= 0) {
          throw new Error('coverWidthMm, coverHeightMm은 양수여야 합니다')
        }
        if (normalized.wingEnabled && normalized.wingWidthMm <= 0) {
          throw new Error('wingEnabled=true일 때 wingWidthMm은 양수여야 합니다')
        }
        spreadSpecRef.current = normalized
        spreadLayoutRef.current = computeLayout(normalized)
      }
    } catch (e) {
      setSpreadError(e instanceof Error ? e.message : 'spec 파싱 실패')
    }
  }

  // Stores
  const { setToken, initializeFromStorage } = useAuthStore()
  const {
    ready,
    showSidePanel: sidePanelState,
    setShowSidePanel: setSidePanelState,
    setReady,
    startInitialization,
    cancelInitialization,
    updateObjects,
    editor,
    canvas,
  } = useAppStore()
  const { updateSettings, setSpreadConfig } = useSettingsStore()

  // Template save hook
  const { saving, saveTemplate, updateExistingTemplate } = useTemplateSave()

  // 부모 창에 메시지 전송
  const sendMessageToParent = useCallback((message: TemplateEditorMessage) => {
    if (window.parent !== window) {
      window.parent.postMessage(message, '*')
    }
  }, [])

  // 초기화 및 인증
  useEffect(() => {
    initializeFromStorage()
    if (token) {
      setToken(token)
    }
    // URL에서 전달된 이름이 있으면 초기값으로 설정
    if (nameParam) {
      setTemplateName(nameParam)
    }
  }, [token, setToken, initializeFromStorage, nameParam])

  // 캔버스 초기화
  useEffect(() => {
    if (!canvasContainerRef.current) return
    if (useAppStore.getState().ready) {
      console.log('[TemplateEditorView] Already initialized, skipping')
      return
    }

    let isMounted = true

    const initializeEditor = async () => {
      try {
        setIsLoading(true)
        setLoadingMessage('에디터를 초기화하는 중...')

        // 기존 캔버스 정리
        const container = document.getElementById('canvas-containers')
        if (container) {
          container.innerHTML = ''
        }
        useAppStore.getState().reset()

        const initId = startInitialization()

        // 캔버스 크기 설정: spread 모드일 때 spec이 권위
        let width: number
        let height: number
        let cutSize = 3
        let safeSize = 3

        if (isSpreadMode && innerSpecRef.current) {
          // 포토북 내지 펼침면: 폭=한 면×2, 높이=한 면.
          const is = innerSpecRef.current
          width = is.pageWidthMm * 2
          height = is.pageHeightMm
          cutSize = is.cutSizeMm
          safeSize = is.safeSizeMm
        } else if (isSpreadMode && spreadSpecRef.current) {
          const dims = computeSpreadDimensions(spreadSpecRef.current)
          width = dims.totalWidthMm
          height = dims.totalHeightMm
          cutSize = spreadSpecRef.current.cutSizeMm
          safeSize = spreadSpecRef.current.safeSizeMm
        } else {
          width = widthParam ? parseInt(widthParam) : 210
          height = heightParam ? parseInt(heightParam) : 297
        }

        // 설정 업데이트
        updateSettings({
          size: {
            width,
            height,
            cutSize,
            safeSize,
          },
          unit: 'mm',
        })

        // 스프레드 모드: spreadConfig을 settings store에 설정
        // createCanvas에서 SpreadPlugin 등록 여부를 spreadConfig?.spec(또는 innerSpec)으로 판단
        if (isSpreadMode && innerSpecRef.current) {
          // 포토북 내지 펼침면: 좌/우 면+거터 config(regionScope='inner').
          setSpreadConfig(buildInnerSpreadConfig(innerSpecRef.current))
        } else if (isSpreadMode && spreadSpecRef.current && spreadLayoutRef.current) {
          const dims = computeSpreadDimensions(spreadSpecRef.current)
          setSpreadConfig({
            version: 1,
            spec: spreadSpecRef.current,
            regions: spreadLayoutRef.current.regions,
            totalWidthMm: dims.totalWidthMm,
            totalHeightMm: dims.totalHeightMm,
          })
        }

        // 캔버스 초기화
        const fabricCanvas = await createCanvas({}, canvasContainerRef.current!, initId)

        if (!isMounted) {
          fabricCanvas.dispose()
          return
        }

        // 캔버스 크기 조정
        const containerWidth = canvasContainerRef.current?.clientWidth || 800
        const containerHeight = canvasContainerRef.current?.clientHeight || 600
        fabricCanvas.setDimensions({
          width: containerWidth,
          height: containerHeight,
        })

        // 에디터 가져오기
        const appStore = useAppStore.getState()
        const newEditor = appStore.editor

        // 이벤트 리스너 등록
        fabricCanvas.on('selection:created', () => updateObjects())
        fabricCanvas.on('selection:updated', () => updateObjects())
        fabricCanvas.on('selection:cleared', () => updateObjects())
        fabricCanvas.on('object:added', () => updateObjects())
        fabricCanvas.on('object:removed', () => updateObjects())
        fabricCanvas.on('object:modified', () => updateObjects())

        // Long task 이벤트 리스너
        if (newEditor) {
          newEditor.on('longTask:start', (options: { message: string }) => {
            setIsLoading(true)
            setLoadingMessage(options.message)
          })

          newEditor.on('longTask:end', () => {
            setIsLoading(false)
            setLoadingMessage('')
          })
        }

        if (!isMounted) {
          fabricCanvas.dispose()
          return
        }

        // 기존 템플릿 로드 (편집 모드)
        if (templateId) {
          setLoadingMessage('템플릿을 불러오는 중...')
          try {
            const template = await templatesApi.getTemplate(templateId)
            setTemplateName(template.name)
            // 기존 conversionMode 보관 (저장 시 병합 보존)
            existingConversionModeRef.current = template.spreadConfig?.conversionMode

            // 캔버스에 템플릿 데이터 로드
            const servicePlugin = newEditor?.getPlugin('ServicePlugin') as ServicePlugin
            if (servicePlugin && template.canvasData) {
              await servicePlugin.loadJSON(JSON.stringify(template.canvasData))
            }
          } catch (error) {
            console.error('[TemplateEditorView] Failed to load template:', error)
          }
        }

        if (!isMounted) return

        // 초기화 완료
        setReady(true)
        isInitializedRef.current = true

        // 부모 창에 준비 완료 알림
        sendMessageToParent({ type: 'TEMPLATE_READY' })

        console.log('[TemplateEditorView] Editor initialized successfully')
      } catch (error) {
        console.error('[TemplateEditorView] Failed to initialize editor:', error)
      } finally {
        if (isMounted) {
          setIsLoading(false)
          setLoadingMessage('')
        }
      }
    }

    initializeEditor()

    // Cleanup
    return () => {
      isMounted = false
      cancelInitialization()

      const { allCanvas: canvases, allEditors: editors, reset } = useAppStore.getState()

      canvases.forEach((cvs) => {
        try {
          if (!cvs) return
          cvs.off()
          cvs.disposed = true
          cvs.dispose()
        } catch (e) {
          if (!(e instanceof TypeError && String(e).includes('clearRect'))) {
            console.error('Canvas dispose error:', e)
          }
        }
      })

      editors.forEach((ed) => {
        try {
          ed?.dispose()
        } catch (e) {
          console.error('Editor dispose error:', e)
        }
      })

      const containerEl = document.getElementById('canvas-containers')
      if (containerEl) {
        containerEl.innerHTML = ''
      }

      reset()
      setSpreadConfig(null)
      isInitializedRef.current = false

      console.log('[TemplateEditorView] Editor cleanup completed')
    }
  }, [templateId, widthParam, heightParam, updateSettings, setSpreadConfig, startInitialization, cancelInitialization, setReady, updateObjects, sendMessageToParent])

  // 템플릿 저장 핸들러
  const handleSaveTemplate = useCallback(async () => {
    if (!ready || saving) return
    if (isSpreadMode && spreadError) return

    try {
      setIsLoading(true)
      setLoadingMessage('템플릿을 저장하는 중...')

      // spread 모드: spec 기반 크기 + spreadConfig 포함
      let spreadConfig: SpreadConfig | undefined
      if (isSpreadMode && innerSpecRef.current) {
        // 포토북 내지 펼침면(2-up): innerSpec 권위로 spreadConfig{regionScope:'inner'} 저장.
        // 이 템플릿이 DB 에 저장되면 loadSpreadModeEditor 가 이를 보고 N개 펼침면을 생성한다.
        spreadConfig = {
          ...buildInnerSpreadConfig(innerSpecRef.current),
          ...(existingConversionModeRef.current !== undefined
            ? { conversionMode: existingConversionModeRef.current }
            : {}),
        }
      } else if (isSpreadMode && spreadSpecRef.current && spreadLayoutRef.current) {
        const dims = computeSpreadDimensions(spreadSpecRef.current)
        spreadConfig = {
          version: 1,
          spec: spreadSpecRef.current,
          regions: spreadLayoutRef.current.regions,
          totalWidthMm: dims.totalWidthMm,
          totalHeightMm: dims.totalHeightMm,
          // 템플릿 로드 시 보관한 기존 conversionMode 병합 보존.
          // 없으면 필드 자체 생략 — 'full' 강제 주입 금지(서버/소비측이 legacy 간주).
          ...(existingConversionModeRef.current !== undefined
            ? { conversionMode: existingConversionModeRef.current }
            : {}),
        }
      }

      let savedTemplate
      if (templateId) {
        // 기존 템플릿 업데이트 — URL 에 명시된 메타만 전달 (기존 DB 값 보존).
        // 이전엔 type/width/height 기본값(PAGE/210/297) 으로 강제 덮어써서
        // spread 표지가 page 로 손상되는 사고 발생 → 명시된 값만 전송 (2026-05-19 fix).
        const updates: UpdateTemplateOptions = {
          name: templateName,
        }
        if (typeParam) updates.type = typeParam
        if (widthParam) updates.width = parseInt(widthParam)
        if (heightParam) updates.height = parseInt(heightParam)
        // spread 모드 진입 시(URL 에 mode=spread+spec) 만 spreadConfig 덮어쓰기.
        // 일반 편집 진입(/template?templateId=...) 에서는 spread 정보 누락 가능 →
        // 기존 spreadConfig 보존을 위해 보내지 않음.
        if (isSpreadMode && spreadConfig) {
          updates.spreadConfig = spreadConfig
          // mode=spread 진입에서는 width/height 도 spec 으로 갱신
          updates.width = spreadConfig.totalWidthMm
          updates.height = spreadConfig.totalHeightMm
        }
        savedTemplate = await updateExistingTemplate(templateId, updates)
      } else {
        // 새 템플릿 생성 — 기존 값이 없으므로 기본값(PAGE/210/297) 허용.
        const width = isSpreadMode && spreadConfig
          ? spreadConfig.totalWidthMm
          : (widthParam ? parseInt(widthParam) : 210)
        const height = isSpreadMode && spreadConfig
          ? spreadConfig.totalHeightMm
          : (heightParam ? parseInt(heightParam) : 297)
        savedTemplate = await saveTemplate({
          name: templateName,
          type: typeParam || TemplateType.PAGE,
          width,
          height,
          spreadConfig,
        })
      }

      if (savedTemplate) {
        // 부모 창에 저장 완료 알림
        sendMessageToParent({
          type: 'TEMPLATE_SAVED',
          payload: {
            templateId: savedTemplate.id,
            success: true,
          },
        })
      }
    } catch (error) {
      console.error('템플릿 저장 실패:', error)
      sendMessageToParent({
        type: 'TEMPLATE_SAVED',
        payload: {
          success: false,
          error: error instanceof Error ? error.message : '템플릿 저장에 실패했습니다',
        },
      })
    } finally {
      setIsLoading(false)
      setLoadingMessage('')
    }
  }, [ready, saving, templateId, templateName, typeParam, widthParam, heightParam, isSpreadMode, spreadError, saveTemplate, updateExistingTemplate, sendMessageToParent])

  // 닫기 핸들러
  const handleClose = useCallback(() => {
    sendMessageToParent({ type: 'TEMPLATE_CLOSED' })
  }, [sendMessageToParent])

  // 템플릿 이름 변경
  const handleNameChange = useCallback((e: React.FocusEvent<HTMLInputElement> | React.KeyboardEvent<HTMLInputElement>) => {
    if ('key' in e && e.key !== 'Enter') return
    const target = e.target as HTMLInputElement
    setTemplateName(target.value || '새 템플릿')
    if (e.type === 'keydown') {
      target.blur()
    }
  }, [])

  return (
    <TooltipProvider>
      <div id="template-editor" className="flex flex-col h-full w-full absolute">
        {/* Header */}
        <nav className="h-14 bg-editor-panel border-b border-editor-border flex items-center px-4 z-[100]">
          {/* 왼쪽: 템플릿 이름 */}
          <div className="flex items-center gap-4">
            <input
              type="text"
              defaultValue={templateName}
              placeholder="템플릿 이름"
              className="bg-transparent border-none outline-none text-editor-text text-base font-medium w-40 md:w-auto focus:ring-1 focus:ring-editor-accent rounded px-2 py-1"
              onBlur={handleNameChange}
              onKeyDown={handleNameChange}
            />
            <span className="text-xs text-editor-text-muted">
              {isSpreadMode && spreadSpecRef.current ? (() => {
                const dims = computeSpreadDimensions(spreadSpecRef.current)
                return `spread | ${dims.totalWidthMm} × ${dims.totalHeightMm} mm (표지 ${spreadSpecRef.current.coverWidthMm}×${spreadSpecRef.current.coverHeightMm})`
              })() : `${typeParam || TemplateType.PAGE} | ${widthParam || 210}×${heightParam || 297}mm`}
            </span>
          </div>

          {/* 오른쪽: 액션 버튼들 */}
          <div className="ml-auto flex items-center gap-2 md:gap-4">
            {/* 저장 버튼 */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveTemplate}
              disabled={!ready || saving}
            >
              {saving ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-editor-text mr-2" />
              ) : (
                <FloppyDisk className="h-4 w-4 mr-2" />
              )}
              저장
            </Button>

            {/* 저장 후 닫기 버튼 */}
            <Button
              onClick={async () => {
                await handleSaveTemplate()
                handleClose()
              }}
              disabled={!ready || saving}
              className="bg-editor-accent hover:bg-editor-accent-hover text-white"
            >
              {saving ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              저장 후 닫기
            </Button>

            {/* 구분선 */}
            <div className="w-px h-6 bg-editor-border" />

            {/* 레이어 패널 토글 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => setShowSidePanel(!showSidePanel)}>
                  <Stack className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>레이어 패널</TooltipContent>
            </Tooltip>

            {/* 닫기 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={handleClose}>
                  <X className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>닫기</TooltipContent>
            </Tooltip>
          </div>
        </nav>

        {/* Main Layout */}
        <div className="flex-1 flex relative overflow-hidden">
          {/* Tool Sidebar */}
          <ToolBar horizontal={false} />

          {/* Feature Sidebar or Control Bar */}
          <FeatureSidebar />
          {ready && <ControlBar />}

          {/* Canvas Area */}
          <main className="flex-1 relative overflow-hidden bg-editor-workspace">
            <div
              id="canvas-wrapper"
              className="h-full w-full overflow-hidden relative"
            >
              <div id="workspace" className="workspace absolute inset-0 flex items-center justify-center">
                <div className="inside-shadow absolute inset-0 shadow-inner pointer-events-none" />
                <div
                  ref={canvasContainerRef}
                  id="canvas-containers"
                  className="relative"
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            </div>
          </main>

          {/* Side Panel */}
          <SidePanel show={showSidePanel} onClose={() => setShowSidePanel(false)} />
        </div>

        {/* Spread Error Overlay */}
        {spreadError && (
          <div className="absolute inset-0 z-[200] flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-lg p-6 flex flex-col items-center gap-4 max-w-md">
              <p className="text-red-600 font-medium">스프레드 설정 오류</p>
              <p className="text-sm text-gray-600">{spreadError}</p>
              <p className="text-xs text-gray-400">저장할 수 없습니다. 관리자 페이지에서 설정을 확인해주세요.</p>
            </div>
          </div>
        )}

        {/* Loading Overlay */}
        {isLoading && (
          <div className="absolute inset-0 z-[200] flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-lg p-6 flex flex-col items-center gap-4">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-editor-accent" />
              <p className="text-editor-text">{loadingMessage || '로딩 중...'}</p>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
