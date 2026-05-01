import { useEffect, useRef, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuthStore, useIsCustomer } from '@/stores/useAuthStore'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useEditorContents } from '@/hooks/useEditorContents'
import { createCanvas } from '@/utils/createCanvas'
import ToolBar from '@/components/editor/ToolBar'
import FeatureSidebar from '@/components/editor/FeatureSidebar'
import ControlBar from '@/components/editor/ControlBar'
import SidePanel from '@/components/editor/SidePanel'
import EditorHeader from '@/components/editor/EditorHeader'
import { PagePanel } from '@/components/PagePanel/PagePanel'
import { SpreadPagePanel } from '@/components/PagePanel/SpreadPagePanel'
import { productsApi } from '@/api'

// Screen mode type
type ScreenMode = 'mobile' | 'tablet' | 'desktop'

// Query parameters type
interface QueryParams {
  productId: string | null
  contentId: string | null
  contentType: string | null
  editMode: string | null
  size: string | null
  templateSetId: string | null
  pageCount: string | null
  paperType: string | null
  bindingType: string | null
  /** 옵션 C: 인쇄 사이즈 직접 지정 (mm). product.allowCustomSize=true 일 때만 적용 */
  width: string | null
  height: string | null
}

const MOBILE_BREAKPOINT = 768
const TABLET_BREAKPOINT = 1024

/**
 * EditorView - Main canvas editor view
 * Handles canvas initialization, use case detection, and layout
 *
 * 초기화 흐름:
 * 1. 마운트 시: 캔버스 초기화 + 콘텐츠 로드 (단일 useEffect)
 * 2. 파라미터 변경 시: 콘텐츠만 재로드 (별도 useEffect)
 */
export default function EditorView() {
  const [searchParams] = useSearchParams()
  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const isFirstRenderRef = useRef(true)
  const isInitializedRef = useRef(false)
  const [screenMode, setScreenMode] = useState<ScreenMode>('desktop')
  const [isLoading, setIsLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('')

  // Query parameters
  const productId = searchParams.get('productId')
  const contentId = searchParams.get('contentId')
  const contentType = searchParams.get('contentType')
  const editMode = searchParams.get('editMode')
  const token = searchParams.get('token')
  const size = searchParams.get('size')
  const templateSetId = searchParams.get('templateSetId')
  const pageCount = searchParams.get('pageCount')
  const paperType = searchParams.get('paperType')
  const bindingType = searchParams.get('bindingType')
  // 옵션 C: 외부 쇼핑몰의 동적 사이즈 override (mm 단위)
  // product.allowCustomSize=true 일 때만 적용. 둘 다 있어야 적용 (한쪽만이면 무시).
  const width = searchParams.get('width')
  const height = searchParams.get('height')

  // Stores
  const { setToken, initializeFromStorage } = useAuthStore()
  const isCustomer = useIsCustomer()
  const {
    ready,
    showSidePanel,
    setShowSidePanel,
    setReady,
    startInitialization,
    cancelInitialization,
    updateObjects,
    isSpreadMode,
  } = useAppStore()
  const { getUseCaseFromParams } = useSettingsStore()

  // Editor contents hook
  const {
    loadEmptyEditor,
    loadContentEditor,
    loadProductBasedEditor,
    loadGeneralEditor,
    loadTemplateSetEditor,
  } = useEditorContents()

  // Product API function ref
  const fetchProductRef = useRef<((productId: string) => Promise<any>) | null>(null)

  // ============================================================
  // 초기화 함수를 useRef로 관리 (최신 상태/함수 참조 보장)
  // ============================================================

  /**
   * 콘텐츠 로드 함수 (useRef로 관리)
   * - 캔버스가 초기화된 후 호출
   * - 파라미터 변경 시에도 호출
   */
  const loadContentRef = useRef<((params: QueryParams) => Promise<void>) | null>(null)

  // 매 렌더링마다 최신 함수를 ref에 저장
  loadContentRef.current = async (params: QueryParams) => {
    const { productId, contentId, contentType, editMode, size, templateSetId, pageCount, paperType, bindingType, width, height } = params

    // 캔버스 유효성 검사
    const currentCanvas = useAppStore.getState().canvas
    if (!currentCanvas || !currentCanvas.getContext()) {
      console.warn('[EditorView] Canvas is not available, skipping content load')
      return
    }

    // templateSetId가 있으면 template-set 모드로 처리
    if (templateSetId) {
      console.log('[EditorView] Handling template set editor')
      setIsLoading(true)
      setLoadingMessage('템플릿셋을 불러오는 중...')

      try {
        await loadTemplateSetEditor({
          templateSetId,
          pageCount: pageCount ? parseInt(pageCount, 10) : undefined,
          paperType: paperType || undefined,
          bindingType: bindingType || undefined,
        })
      } catch (error) {
        console.error('[EditorView] Template set load error:', error)
      } finally {
        setIsLoading(false)
        setLoadingMessage('')
      }
      return
    }

    const queryParams: Record<string, unknown> = {
      productId,
      contentId,
      contentType,
      editMode,
      size,
    }

    const useCase = getUseCaseFromParams(queryParams)
    console.log(`[EditorView] Loading content for use case: ${useCase}`)

    try {
      switch (useCase) {
        case 'empty':
          console.log('[EditorView] Handling empty editor')
          await loadEmptyEditor({
            name: '새로운 작업',
            size: { width: 100, height: 100, cutSize: 5, safeSize: 5 },
            unit: 'mm',
          })
          break

        case 'content-edit':
          console.log('[EditorView] Handling content editor')
          if (!contentType || isCustomer) {
            console.error('권한이 없습니다.')
            return
          }
          await loadContentEditor({
            contentId: contentId!,
            contentType: contentType,
          })
          break

        case 'product-based':
          console.log('[EditorView] Handling product editor')
          if (!productId) return

          setIsLoading(true)
          setLoadingMessage('상품 정보를 불러오는 중...')

          try {
            // REST API로 상품 정보 조회
            const result = await productsApi.getProduct(productId)

            if (!result.success || !result.data) {
              console.error('[EditorView] Product API error:', result.error?.message)
              throw new Error(result.error?.message || '상품을 찾을 수 없습니다.')
            }

            const product = result.data
            console.log('[EditorView] Product loaded:', product.title)

            // 옵션 C: 상품이 customSize 를 허용하고 width/height 가 둘 다 전달되면 override
            // 정수/실수 모두 허용. 비합리한 값(<=0, NaN, 너무 큰 값)은 무시.
            const customWidthMm = Number(width)
            const customHeightMm = Number(height)
            const productAllowsCustomSize = (product as { allowCustomSize?: boolean })?.allowCustomSize === true
            const isValidCustomSize =
              productAllowsCustomSize &&
              Number.isFinite(customWidthMm) && customWidthMm > 0 && customWidthMm <= 2000 &&
              Number.isFinite(customHeightMm) && customHeightMm > 0 && customHeightMm <= 2000
            if (width != null && height != null && !isValidCustomSize) {
              console.warn('[EditorView] custom size ignored — product.allowCustomSize=false 또는 값 검증 실패', {
                productAllowsCustomSize,
                width,
                height,
              })
            }

            await loadProductBasedEditor({

              product: product as any,
              sizeno: Number(size ?? 0),
              customSize: isValidCustomSize ? { width: customWidthMm, height: customHeightMm } : undefined,
            })
          } finally {
            setIsLoading(false)
            setLoadingMessage('')
          }
          break

        case 'general':
        default:
          console.log('[EditorView] Handling general editor')
          await loadGeneralEditor({
            name: '일반 작업',
            size: { width: 100, height: 100, cutSize: 5, safeSize: 5 },
          })
          break
      }
    } catch (error) {
      console.error('[EditorView] Error loading content:', error)
    }
  }

  // Screen resize handler
  const handleResize = useCallback(() => {
    const width = window.innerWidth
    if (width < MOBILE_BREAKPOINT) {
      setScreenMode('mobile')
    } else if (width < TABLET_BREAKPOINT) {
      setScreenMode('tablet')
    } else {
      setScreenMode('desktop')
    }
  }, [])

  // Initialize auth
  useEffect(() => {
    initializeFromStorage()
    if (token) {
      setToken(token)
    }
  }, [token, setToken, initializeFromStorage])

  // Handle window resize
  useEffect(() => {
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [handleResize])

  // ============================================================
  // 마운트 시 캔버스 초기화 + 콘텐츠 로드 (단일 useEffect)
  // ============================================================
  useEffect(() => {
    // 컨테이너가 없으면 스킵
    if (!canvasContainerRef.current) return

    // 이미 초기화되었으면 스킵 (Strict Mode 이중 마운트 대응)
    if (useAppStore.getState().ready) {
      console.log('[EditorView] Already initialized, skipping')
      return
    }

    // 마운트 상태 추적
    let isMounted = true

    const initializeEditor = async () => {
      try {
        setIsLoading(true)
        setLoadingMessage('에디터를 초기화하는 중...')

        // 0. 기존 캔버스 정리 (React Strict Mode 이중 마운트 대응)
        const container = document.getElementById('canvas-containers')
        if (container) {
          container.innerHTML = ''
        }
        // 스토어 상태도 초기화
        useAppStore.getState().reset()

        // 초기화 세션 시작 - 고유 ID 생성 (React Strict Mode 대응)
        const initId = startInitialization()

        // 1. 캔버스 초기화 (initId 전달)
        const fabricCanvas = await createCanvas({}, canvasContainerRef.current!, initId)

        // cleanup 후에는 초기화 중단
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

        // 스토어에서 editor 가져오기
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

        // cleanup 체크
        if (!isMounted) {
          fabricCanvas.dispose()
          return
        }

        // 2. 콘텐츠 로드 (캔버스 초기화 직후)
        const params: QueryParams = {
          productId,
          contentId,
          contentType,
          editMode,
          size,
          templateSetId,
          pageCount,
          paperType,
          bindingType,
          width,
          height,
        }

        await loadContentRef.current?.(params)

        // cleanup 체크
        if (!isMounted) return

        // 3. 초기화 완료
        setReady(true)
        isInitializedRef.current = true

        console.log('[EditorView] Editor initialized and content loaded successfully')
      } catch (error) {
        console.error('[EditorView] Failed to initialize editor:', error)
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

      // 먼저 초기화 세션을 취소하여 진행 중인 비동기 init() 차단
      cancelInitialization()

      const { allCanvas: canvases, allEditors: editors, reset } = useAppStore.getState()

      // 캔버스 정리
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

      // 에디터 정리
      editors.forEach((ed) => {
        try {
          ed?.dispose()
        } catch (e) {
          console.error('Editor dispose error:', e)
        }
      })

      // DOM 정리
      const container = document.getElementById('canvas-containers')
      if (container) {
        container.innerHTML = ''
      }

      // 스토어 리셋
      reset()
      isInitializedRef.current = false

      console.log('[EditorView] Editor cleanup completed')
    }
    // 의존성 배열 비움 - 마운트 시 1회만 실행
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ============================================================
  // 파라미터 변경 시 콘텐츠 재로드 (마운트 이후에만)
  // ============================================================
  useEffect(() => {
    // 첫 렌더링은 스킵 (마운트 useEffect에서 처리)
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false
      return
    }

    // 초기화가 완료되지 않았으면 스킵
    if (!isInitializedRef.current || !ready) {
      return
    }

    console.log('[EditorView] Parameters changed, reloading content')

    const params: QueryParams = {
      productId,
      contentId,
      contentType,
      editMode,
      size,
      templateSetId,
      pageCount,
      paperType,
      bindingType,
    }

    // ref를 통해 최신 함수 호출
    loadContentRef.current?.(params)
  }, [productId, contentId, contentType, editMode, size, templateSetId, pageCount, paperType, bindingType, width, height, ready])

  // Toggle side panel
  const toggleSidePanel = () => {
    setShowSidePanel(!showSidePanel)
  }

  // Loading state handler for EditorHeader
  const handleLoadingChange = useCallback((loading: boolean, message?: string) => {
    setIsLoading(loading)
    setLoadingMessage(message || '')
  }, [])

  return (
    <div id="editor" className="flex flex-col h-full w-full absolute">
      {/* Top Navigation Bar */}
      <EditorHeader
        screenMode={screenMode}
        onLoadingChange={handleLoadingChange}
      />

      {/* Main Layout */}
      <div className={`flex-1 flex ${screenMode !== 'desktop' ? 'flex-col' : 'flex-row'} relative overflow-hidden`}>
        {/* Tool Sidebar - horizontal in tablet/mobile mode */}
        <ToolBar horizontal={screenMode !== 'desktop'} />

        {/* Content area - flex-col로 캔버스 영역 + 하단 패널 배치 */}
        <div className="flex-1 flex flex-col relative overflow-hidden">
          {/* Upper row: sidebar + canvas */}
          <div className="flex-1 flex flex-row relative overflow-hidden">
            {/* Feature Sidebar or Control Bar - mutually exclusive */}
            <FeatureSidebar />
            {ready && <ControlBar />}

            {/* Canvas Area */}
            <main className="flex-1 relative overflow-hidden bg-editor-workspace">
              {/* Canvas Container */}
              <div
                id="canvas-wrapper"
                className="h-full w-full overflow-hidden relative"
              >
                {/* Workspace background - id="workspace"는 WorkspacePlugin에서 사용 */}
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

            {/* Side Panel 숨김 처리 */}
          </div>

          {/* 스프레드 모드 전용 하단 페이지 패널 */}
          {isSpreadMode && <SpreadPagePanel />}
        </div>
      </div>

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
  )
}
