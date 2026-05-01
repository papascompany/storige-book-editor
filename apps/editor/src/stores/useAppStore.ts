import { create } from 'zustand'
import { debounce } from 'lodash-es'
import Editor, {
  type CanvasObject,
  type CanvasSettings,
  core,
  PluginBase,
  SelectionType,
  WorkspacePlugin,
  RenderOptimizer,
  createFabricCanvas,
  configureFabricDefaults
} from '@storige/canvas-core'
import type { AppMenu } from '@/types/menu'
import { recalculateSpineWidth } from '@/utils/spineCalculator'
import { useEditorStore } from '@/stores/useEditorStore'
import { TemplateType } from '@storige/types'

// Fabric.js 타입 (실제 fabric 타입은 런타임에 로드됨)
 
type FabricCanvas = any
 
type FabricObject = any
 
type FabricEvent = any

type ContentsBrowserType = 'image' | 'frame' | 'element' | 'background' | 'template' | null

interface AppState {
  // 기본 상태
  currentMenu: AppMenu | null
  showSidePanel: boolean
  ready: boolean
  hasCutlineTemplate: boolean
  initializationId: string | null  // 현재 초기화 세션 ID (React Strict Mode 대응)

  // 캔버스 상태
  allCanvas: FabricCanvas[]
  allEditors: Editor[]
  canvas: FabricCanvas | null
  editor: Editor | null

  // 객체 목록 및 선택
  objects: CanvasObject[]
  activeSelection: FabricObject[]
  triggerSelectionRefresh: number

  // UI 상태
  screenshots: string[]
  currentContentsBrowser: ContentsBrowserType

  // 스프레드 모드 상태
  isSpreadMode: boolean
  spreadCanvasIndex: number  // 항상 0 (스프레드 캔버스는 첫 번째)
  spineResizeAbortController: AbortController | null  // in-flight cancel용
  restoring: boolean  // history replay 중 여부 (debounce 비활성 제어)
  isLayoutTransaction: boolean  // resizeSpine 중 여부 (입력 잠금 제어)
}

interface AppActions {
  // UI 액션
  hideSidePanel: () => void
  setShowSidePanel: (show: boolean) => void
  tapMenu: (menu: AppMenu | null) => void
  setContentsBrowser: (type: 'image' | 'frame' | 'element' | 'background' | 'template') => void
  backFromContentsBrowser: () => void

  // 캔버스 초기화
  init: (c: FabricCanvas, e: Editor, initId?: string) => void
  clearAll: () => void
  reset: () => void  // 스토어 상태만 리셋 (HMR용)
  setReady: (ready: boolean) => void
  startInitialization: () => string  // 새 초기화 세션 시작, ID 반환
  cancelInitialization: () => void   // 현재 초기화 세션 취소
  setCanvas: (canvas: FabricCanvas) => void
  setEditor: (editor: Editor) => void
  addCanvas: (canvas: FabricCanvas) => void
  addEditor: (editor: Editor) => void

  // 플러그인
  getPlugin: <T extends PluginBase>(pluginName: string) => T | undefined

  // 페이지 관리
  setPageName: (name: string) => void
  setPage: (index: number) => void
  /** 페이지 순서 재배열 (DD-5) — newIndices는 0..N-1의 순열 (예: [2,0,1] = 새 순서[0]=기존[2]) */
  reorderByIndex: (newIndices: number[]) => void
  addPage: () => Promise<void>
  addInnerPage: () => Promise<void>     // 내지 추가 → debouncedRecalcSpine()
  deletePage: (canvasId: string) => void
  deleteInnerPage: (canvasId: string) => void   // 내지 삭제 → debouncedRecalcSpine()
  reorderPages: (oldIndex: number, newIndex: number) => void

  // 스프레드 모드 관리
  setSpreadMode: (enabled: boolean) => void
  debouncedRecalcSpine: () => void      // debounce(300ms) + abort

  // 객체 목록 관리
  updateObjects: () => void

  // 객체 관리
  changeObjectValue: (value: number | string, key: string) => void

  // 설정 업데이트
  updateAllWorkspaceSettings: (settings: CanvasSettings) => void

  // 스크린샷
  takeCanvasScreenshot: () => void

  // 렌더링
  render: (immediate?: boolean) => void
  debouncedRender: () => void
  throttledRender: () => void

  // 내부 헬퍼
  _emitSelections: (e: FabricEvent) => void
  _updateObjectsHandler: (e?: FabricEvent) => void
  _fixViewportOnChange: () => void
  _incrementTriggerSelectionRefresh: () => void
}

// Computed values are accessed via selector hooks below
// interface AppComputed {
//   currentIndex: number
//   workspace: FabricObject | undefined
//   hasSelection: boolean
//   selectionType: SelectionType | null
// }

// 객체 타입 판별 헬퍼 함수
const getObjectType = (type: string): SelectionType => {
  switch (type) {
    case 'text':
    case 'textbox':
    case 'curveText':
    case 'i-text':
      return SelectionType.text
    case 'template-element':
      return SelectionType.templateElement
    case 'image':
      return SelectionType.image
    case 'barcode':
    case 'qrcode':
      return SelectionType.smartCode
    case 'frame':
      return SelectionType.frame
    case 'background':
      return SelectionType.background
    case 'shape':
      return SelectionType.shape
    case 'group':
      return SelectionType.group
    default:
      return SelectionType.shape
  }
}

// 숫자 속성 정의
const numberValues = [
  'width',
  'height',
  'left',
  'top',
  'scaleX',
  'scaleY',
  'angle',
  'opacity',
  'strokeWidth',
  'fontSize',
  'charSpacing',
  'lineHeight'
]

// 스토어의 내부 상태를 위한 변수들 (React 상태와 분리)
let blockedUpdate = false
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let throttleTimeout: ReturnType<typeof setTimeout> | null = null

// Debounced 함수들 (cancel 가능하도록 외부에 선언)
 
// 터치 디바이스에서는 toDataURL 이 retina(DPR=3) 캔버스에서 매우 비싸 메모리 폭발 → iOS
// Safari 페이지 크래시 유발. coarse pointer 환경에서는 디바운스를 길게(800ms) 잡고
// multiplier 를 0.4 로 줄여 데이터 양 약 1/8 로 축소.
function isTouchEnv(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  try { return window.matchMedia('(pointer: coarse)').matches } catch { return false }
}

// 모바일은 더 공격적으로 — iOS Safari 메모리 한계 회피.
// 디바운스 1500ms 로 길게 (사용자 인터랙션 멈춘 후에만 캡처),
// multiplier 0.25 로 데이터 양을 약 1/16 로 축소.
const SCREENSHOT_DEBOUNCE_MS = isTouchEnv() ? 1500 : 200
const SCREENSHOT_MULTIPLIER_TOUCH = 0.25

const debouncedTakeScreenshot = debounce((allCanvas: any[], set: any) => {
  // 캔버스가 유효한지 확인
  if (!allCanvas || allCanvas.length === 0) return
  const touchEnv = isTouchEnv()

  const newScreenshots: string[] = []
  allCanvas.forEach((cvs: FabricCanvas, index: number) => {
    try {
      // 캔버스가 disposed되었는지 확인
      if (cvs && !cvs.disposed && cvs.getContext()) {
        // 워크스페이스 영역만 캡처 (회색 배경 제외)
        const workspace = cvs.getObjects().find((obj: any) => obj.id === 'workspace')
        if (workspace) {
          const bound = workspace.getBoundingRect()
          newScreenshots[index] = cvs.toDataURL({
            format: 'png',
            quality: 0.8,
            left: bound.left,
            top: bound.top,
            width: bound.width,
            height: bound.height,
            // 모바일에서는 다운샘플 — 썸네일은 작게 표시되므로 충분
            ...(touchEnv ? { multiplier: SCREENSHOT_MULTIPLIER_TOUCH } : {}),
          })
        } else {
          newScreenshots[index] = cvs.toDataURL({
            format: 'png',
            quality: 0.8,
            multiplier: touchEnv ? SCREENSHOT_MULTIPLIER_TOUCH : 0.2
          })
        }
      }
    } catch (e) {
      // disposed된 캔버스에서 발생하는 에러 무시
    }
  })
  set({ screenshots: newScreenshots })
}, SCREENSHOT_DEBOUNCE_MS)

 
const debouncedRenderFn = debounce((canvas: any) => {
  if (canvas && !canvas.disposed) {
    RenderOptimizer.queueRender(canvas, false)
  }
}, 16)

 
const debouncedUpdateObjectsHandler = debounce((callback: () => void) => {
  callback()
}, 100)

export const useAppStore = create<AppState & AppActions>()((set, get) => ({
  // 초기 상태
  currentMenu: null,
  showSidePanel: false,
  ready: false,
  hasCutlineTemplate: false,
  initializationId: null,
  allCanvas: [],
  allEditors: [],
  canvas: null,
  editor: null,
  objects: [],
  activeSelection: [],
  triggerSelectionRefresh: 0,
  screenshots: [],
  currentContentsBrowser: null,

  // 스프레드 모드 초기 상태
  isSpreadMode: false,
  spreadCanvasIndex: 0,
  spineResizeAbortController: null,
  restoring: false,
  isLayoutTransaction: false,

  // UI 액션
  hideSidePanel: () => set({ showSidePanel: false }),
  setShowSidePanel: (show: boolean) => set({ showSidePanel: show }),

  tapMenu: (menu: AppMenu | null) => {
    const { canvas, currentMenu } = get()
    set({ currentContentsBrowser: null })

    // 선택 객체가 있고 메뉴 변경 시 선택 해제
    canvas?.discardActiveObject()
    canvas?.renderAll()

    // 메뉴 클릭 시 동작
    if (!menu?.onTap) {
      set({ currentMenu: currentMenu !== menu ? menu : null })
    } else {
      menu.onTap()
    }
  },

  setContentsBrowser: (type) => set({ currentContentsBrowser: type }),
  backFromContentsBrowser: () => set({ currentContentsBrowser: null }),

  // 캔버스 초기화
  init: (c: FabricCanvas, e: Editor, initId?: string) => {
    const { allCanvas, allEditors, initializationId, _emitSelections, _updateObjectsHandler, _fixViewportOnChange, _incrementTriggerSelectionRefresh } = get()

    // 초기화 ID가 현재 세션과 일치하지 않으면 차단 (React Strict Mode 대응)
    if (!initId || initId !== initializationId) {
      console.log('[AppStore] init blocked - initId mismatch', { provided: initId, current: initializationId })
      return
    }

    if (allCanvas.some((cvs: FabricCanvas) => cvs.id === c.id)) {
      return
    }

    set({ ready: false })

    // 배열 업데이트
    set({
      allCanvas: [...allCanvas, c],
      allEditors: [...allEditors, e],
      canvas: c,
      editor: e,
      ready: true
    })

    c.clearHistory()

    // 이벤트 핸들러 등록
    c.on('selection:created', _emitSelections)
    c.on('selection:updated', _emitSelections)
    c.on('selection:cleared', _emitSelections)

    // 최적화된 이벤트 리스너 등록
    c.on('object:added', _updateObjectsHandler)
    c.on('object:removed', _updateObjectsHandler)
    c.on('object:modified', _updateObjectsHandler)
    c.on('layerChanged', _updateObjectsHandler)
    c.on('history:undo', _updateObjectsHandler)
    c.on('history:redo', _updateObjectsHandler)
    e.on('layerChanged', _updateObjectsHandler)

    c.on('mouse:wheel', _fixViewportOnChange)
    c.on('viewportTransform:modified', _fixViewportOnChange)
    c.on('object:modified', _incrementTriggerSelectionRefresh)
  },

  clearAll: () => {
    const { allCanvas } = get()

    // 모든 캔버스 DOM 요소 정리
    allCanvas.forEach((canvas: FabricCanvas) => {
      try {
        canvas.dispose()
      } catch (e) {
        console.warn('캔버스 dispose 중 오류 발생:', e)
      }
    })

    // 캔버스 컨테이너 초기화
    const container = document.getElementById('canvas-containers')
    if (container) {
      container.innerHTML = ''
    }

    // 상태 초기화
    set({
      allCanvas: [],
      allEditors: [],
      canvas: null,
      editor: null,
      objects: [],
      activeSelection: [],
      ready: false
    })
  },

  // HMR 시 스토어 상태만 리셋 (DOM 정리 없이)
  reset: () => {
    const { spineResizeAbortController } = get()

    // 모든 debounced 함수 취소 (메모리 누수 방지)
    debouncedTakeScreenshot.cancel()
    debouncedRenderFn.cancel()
    debouncedUpdateObjectsHandler.cancel()

    // 타이머 정리
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (throttleTimeout) {
      clearTimeout(throttleTimeout)
      throttleTimeout = null
    }

    // 스프레드 모드 AbortController 취소
    if (spineResizeAbortController) {
      spineResizeAbortController.abort()
    }

    set({
      allCanvas: [],
      allEditors: [],
      canvas: null,
      editor: null,
      objects: [],
      activeSelection: [],
      ready: false,
      hasCutlineTemplate: false,
      initializationId: null,  // 초기화 ID도 리셋
      screenshots: [],
      currentContentsBrowser: null,
      currentMenu: null,
      // 스프레드 모드 상태 리셋
      isSpreadMode: false,
      spreadCanvasIndex: 0,
      spineResizeAbortController: null,
      restoring: false,
      isLayoutTransaction: false,
    })
  },

  setReady: (ready: boolean) => set({ ready }),

  // 새 초기화 세션 시작 - 고유 ID 생성 및 반환
  startInitialization: () => {
    const newId = `init-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    console.log('[AppStore] Starting initialization session:', newId)
    set({ initializationId: newId })
    return newId
  },

  // 현재 초기화 세션 취소 - 진행 중인 비동기 init 차단
  cancelInitialization: () => {
    console.log('[AppStore] Cancelling initialization session')
    set({ initializationId: null })
  },
  setCanvas: (canvas: FabricCanvas) => set({ canvas }),
  setEditor: (editor: Editor) => set({ editor }),
  addCanvas: (canvas: FabricCanvas) => set((state) => ({ allCanvas: [...state.allCanvas, canvas] })),
  addEditor: (editor: Editor) => set((state) => ({ allEditors: [...state.allEditors, editor] })),

  // 새 페이지 추가
  addPage: async () => {
     
    const { allCanvas, allEditors: _allEditors, init, setPage, updateObjects, takeCanvasScreenshot, initializationId } = get()

    try {
      // 현재 설정 사용 (settingsStore 연동은 나중에 추가)
      const index = allCanvas.length > 0
        ? allCanvas.reduce((max: number, item: FabricCanvas) => {
            return (item.index || 0) > max ? item.index : max
          }, -Infinity) + 1
        : 0

      const canvasId = `canvas${index}`

      // 캔버스 컨테이너 요소
      const canvasContainer = document.getElementById('canvas-containers')
      if (!canvasContainer) {
        console.error('Canvas container element not found')
        return
      }

      // 새로운 캔버스 요소 생성
      const canvasElement = document.createElement('canvas')
      canvasElement.id = canvasId

      // 사용자 정의 컨테이너 생성
      const customContainer = document.createElement('div')
      customContainer.className = 'canvas-container'
      customContainer.style.width = '100%'
      customContainer.style.height = '100%'
      customContainer.style.position = 'relative'
      customContainer.style.userSelect = 'none'
      customContainer.style.display = 'none' // 새 페이지는 처음에 숨김

      // DOM 트리에 추가
      customContainer.appendChild(canvasElement)
      canvasContainer.appendChild(customContainer)

      // FabricJS 기본 설정 (1회만 실행됨)
      configureFabricDefaults()

      // FabricJS 캔버스 인스턴스 생성 (core API 사용)
      const newCanvas = await createFabricCanvas(canvasId, {
        index: index
      })

      // FabricJS wrapper 처리
      const fabricWrapper = canvasElement.parentElement
      if (fabricWrapper && fabricWrapper !== customContainer) {
        const lowerCanvas = newCanvas.lowerCanvasEl
        const upperCanvas = newCanvas.upperCanvasEl

        customContainer.innerHTML = ''
        customContainer.appendChild(lowerCanvas)
        customContainer.appendChild(upperCanvas)

        canvasContainer.appendChild(customContainer)
        newCanvas.wrapperEl = customContainer
      }

      // 새 에디터 생성
      const newEditor = new Editor()
      newEditor.init(newCanvas)

      // WorkspacePlugin 등록 (현재 설정에서 사이즈 가져오기)
      const settingsStore = (await import('@/stores/useSettingsStore')).useSettingsStore.getState()
      const spreadConfig = settingsStore.spreadConfig
      const currentSettings = settingsStore.currentSettings

      let pageSize: { width: number; height: number; cutSize: number; safeSize: number }
      if (spreadConfig?.spec) {
        // 스프레드 모드: 내지는 표지 크기 사용
        pageSize = {
          width: spreadConfig.spec.coverWidthMm,
          height: spreadConfig.spec.coverHeightMm,
          cutSize: spreadConfig.spec.cutSizeMm,
          safeSize: spreadConfig.spec.safeSizeMm,
        }
      } else {
        // 일반 모드: 현재 설정 사용
        pageSize = currentSettings.size
      }

      const workspaceOptions = {
        ...currentSettings,
        size: pageSize,
      }
      const workspacePlugin = new WorkspacePlugin(newCanvas, newEditor, workspaceOptions)
      newEditor.use(workspacePlugin)

      // 스토어에 등록 (initializationId 전달하여 등록 허용)
      init(newCanvas, newEditor, initializationId || undefined)

      // 새 페이지로 전환 (컨테이너가 display:block으로 변경됨)
      const nextIndex = allCanvas.length // init 후에는 allCanvas가 업데이트됨
      setPage(nextIndex)

      // 컨테이너가 표시된 후 WorkspacePlugin 초기화
      // init()이 workspace Rect 생성 + 이벤트 바인딩 + setZoomAuto()까지 처리
      workspacePlugin.init()

      // useEditorStore.pages에 새 EditPage 추가 (SpreadPagePanel 동기화)
      const editorStore = useEditorStore.getState()
      editorStore.addPage({
        id: canvasId,
        templateId: canvasId,
        templateType: TemplateType.PAGE,
        canvasData: { version: '5.3.0', objects: [] },
        sortOrder: editorStore.pages.length,
        required: false,
        deleteable: true,
      })
      // currentPageIndex도 동기화
      editorStore.setCurrentPageIndex(nextIndex)

      // 객체 목록 및 스크린샷 업데이트
      updateObjects()
      takeCanvasScreenshot()

      console.log(`새 페이지 추가됨: ${canvasId}`)

      // 내지 추가 시 책등 너비 재계산
      recalculateSpineWidth().then((result) => {
        if (result.success) {
          console.log(`[AppStore] 책등 너비 재계산 완료: ${result.spineWidth}mm (내지 ${result.pageCount}p)`)
        } else if (result.error) {
          console.warn(`[AppStore] 책등 재계산 스킵: ${result.error}`)
        }
      }).catch((error) => {
        console.error('[AppStore] 책등 재계산 오류:', error)
      })
    } catch (error) {
      console.error('새 페이지 추가 중 오류:', error)
    }
  },

  // 플러그인
  getPlugin: <T extends PluginBase>(pluginName: string): T | undefined => {
    const { editor } = get()
    return editor?.getPlugin(pluginName) as T | undefined
  },

  // 페이지 관리
  setPageName: (name: string) => {
    const { canvas } = get()
    if (canvas) {
      canvas.name = name
    }
  },

  setPage: (index: number) => {
    const { allCanvas, allEditors, updateObjects } = get()

    if (index < 0 || index >= allCanvas.length) {
      console.warn(`유효하지 않은 페이지 인덱스: ${index}`)
      return
    }

    // 모든 캔버스 선택 해제
    allCanvas.forEach((cvs: FabricCanvas, i: number) => {
      try {
        cvs.discardActiveObject()
        cvs.requestRenderAll()
      } catch (e) {
        console.warn(`캔버스 ${i} 선택 해제 중 오류:`, e)
      }
    })

    // 현재 캔버스와 에디터 설정
    set({
      canvas: allCanvas[index],
      editor: allEditors[index],
      activeSelection: []
    })

    // DOM 요소 표시/숨김 처리
    const containers = document.querySelectorAll('#canvas-containers > .canvas-container')
    containers.forEach((container, idx) => {
      const htmlElement = container as HTMLElement
      htmlElement.style.display = idx === index ? 'block' : 'none'
    })

    // 캔버스 렌더링
    allCanvas[index].requestRenderAll()

    // useEditorStore.currentPageIndex 동기화
    useEditorStore.getState().setCurrentPageIndex(index)

    // 객체 목록 업데이트
    updateObjects()
  },

  reorderByIndex: (newIndices: number[]) => {
    // DD-5: 페이지 순서 재배열 (drag-to-reorder 트리거)
    const { allCanvas, allEditors, canvas: currentCanvas } = get()
    if (newIndices.length !== allCanvas.length) {
      console.warn('[reorderByIndex] length mismatch', newIndices.length, allCanvas.length)
      return
    }
    // 유효한 순열인지 검사 (0..N-1 한 번씩)
    const sorted = [...newIndices].sort((a, b) => a - b)
    const valid = sorted.every((v, i) => v === i)
    if (!valid) {
      console.warn('[reorderByIndex] invalid permutation', newIndices)
      return
    }
    // identity 순열이면 no-op
    const isIdentity = newIndices.every((v, i) => v === i)
    if (isIdentity) return

    const newCanvases = newIndices.map((i) => allCanvas[i])
    const newEditors = newIndices.map((i) => allEditors[i])

    // useEditorStore.pages 동기화 (1:1 인덱스 매핑)
    const ed = useEditorStore.getState()
    const newPageIds: string[] = []
    for (const i of newIndices) {
      const p = ed.pages[i]
      if (p) newPageIds.push(p.id)
    }

    set({ allCanvas: newCanvases, allEditors: newEditors })
    if (newPageIds.length === ed.pages.length) {
      ed.reorderPages(newPageIds)
    }

    // 사용자가 보던 페이지의 새 인덱스로 setPage 보정
    if (currentCanvas) {
      const newCurrentIdx = newCanvases.findIndex((c: FabricCanvas) => c.id === currentCanvas.id)
      if (newCurrentIdx >= 0 && newCurrentIdx < newCanvases.length) {
        get().setPage(newCurrentIdx)
      }
    }
  },

  deletePage: (canvasId: string) => {
    const { allCanvas, allEditors, setPage, updateObjects } = get()
    const currentIndex = allCanvas.findIndex((cvs: FabricCanvas) => cvs.id === get().canvas?.id)

    if (allCanvas.length <= 1) {
      throw TypeError('최소 한개의 캔버스는 존재해야 합니다.')
    }

    const indexOfCanvas = allCanvas.findIndex((cvs: FabricCanvas) => cvs.id === canvasId)
    if (indexOfCanvas === -1) return

    // 배열 복사
    const newCanvases = [...allCanvas]
    const newEditors = [...allEditors]
    const targetCanvas = newCanvases[indexOfCanvas]

    // DOM에서 캔버스 컨테이너 요소 찾기 - wrapperEl 사용
    const containerToRemove = targetCanvas.wrapperEl
    const parentNode = containerToRemove?.parentNode

    // 캔버스 정리
    try {
      targetCanvas.clear()
    } catch (err) {
      console.error('캔버스 clear 중 오류:', err)
    }

    // DOM에서 제거 (dispose 전에 수행)
    if (containerToRemove && parentNode) {
      try {
        parentNode.removeChild(containerToRemove)
      } catch (err) {
        console.error('DOM 컨테이너 제거 중 오류:', err)
      }
    }

    // dispose는 DOM 제거 후 수행
    try {
      targetCanvas.dispose()
    } catch (err) {
      // dispose 오류는 무시 (DOM이 이미 제거된 경우 발생할 수 있음)
    }

    // 배열에서 요소 제거
    newCanvases.splice(indexOfCanvas, 1)
    newEditors.splice(indexOfCanvas, 1)

    // 상태 업데이트
    set({
      allCanvas: newCanvases,
      allEditors: newEditors
    })

    // useEditorStore.pages에서도 해당 페이지 제거
    const editorStore = useEditorStore.getState()
    const editorPages = editorStore.pages
    if (indexOfCanvas < editorPages.length) {
      editorStore.deletePage(editorPages[indexOfCanvas].id)
    }

    // 필요한 경우 다른 페이지로 이동
    if (indexOfCanvas === currentIndex) {
      const nextIndex = indexOfCanvas > 0 ? indexOfCanvas - 1 : 0
      set({
        canvas: newCanvases[nextIndex],
        editor: newEditors[nextIndex]
      })
      setPage(nextIndex)
    }

    updateObjects()

    // 내지 삭제 시 책등 너비 재계산
    recalculateSpineWidth().then((result) => {
      if (result.success) {
        console.log(`[AppStore] 책등 너비 재계산 완료: ${result.spineWidth}mm (내지 ${result.pageCount}p)`)
      }
    }).catch((error) => {
      console.error('[AppStore] 책등 재계산 오류:', error)
    })
  },

  // 내지 추가 (스프레드 모드 전용)
  addInnerPage: async () => {
    const { isSpreadMode, addPage, debouncedRecalcSpine } = get()

    if (!isSpreadMode) {
      console.warn('[AppStore] addInnerPage는 스프레드 모드에서만 사용 가능합니다.')
      return
    }

    await addPage()
    debouncedRecalcSpine()
  },

  // 내지 삭제 (스프레드 모드 전용)
  deleteInnerPage: (canvasId: string) => {
    const { isSpreadMode, deletePage, debouncedRecalcSpine } = get()

    if (!isSpreadMode) {
      console.warn('[AppStore] deleteInnerPage는 스프레드 모드에서만 사용 가능합니다.')
      return
    }

    deletePage(canvasId)
    debouncedRecalcSpine()
  },

  reorderPages: (oldIndex: number, newIndex: number) => {
    const { allCanvas, allEditors, canvas, updateObjects, takeCanvasScreenshot } = get()

    if (oldIndex === newIndex) return
    if (oldIndex < 0 || oldIndex >= allCanvas.length) return
    if (newIndex < 0 || newIndex >= allCanvas.length) return

    // 현재 선택된 페이지의 ID 저장
    const currentPageId = canvas?.id

    // 배열 복사
    const newCanvases = [...allCanvas]
    const newEditors = [...allEditors]

    // 요소 이동
    const movedCanvas = newCanvases.splice(oldIndex, 1)[0]
    const movedEditor = newEditors.splice(oldIndex, 1)[0]

    newCanvases.splice(newIndex, 0, movedCanvas)
    newEditors.splice(newIndex, 0, movedEditor)

    // DOM 컨테이너 순서 변경
    const containers = document.getElementById('canvas-containers')
    if (containers) {
      const containerElements = Array.from(containers.children)
      const movedContainer = containerElements[oldIndex]

      if (movedContainer) {
        containers.removeChild(movedContainer)
        if (newIndex >= containerElements.length - 1) {
          containers.appendChild(movedContainer)
        } else {
          const nextContainer = containerElements[newIndex > oldIndex ? newIndex : newIndex]
          containers.insertBefore(movedContainer, nextContainer)
        }
      }
    }

    // 상태 업데이트
    set({
      allCanvas: newCanvases,
      allEditors: newEditors
    })

    // 현재 선택된 페이지 인덱스 업데이트
    if (currentPageId) {
      const newCurrentIndex = newCanvases.findIndex((cvs: FabricCanvas) => cvs.id === currentPageId)
      if (newCurrentIndex !== -1) {
        set({
          canvas: newCanvases[newCurrentIndex],
          editor: newEditors[newCurrentIndex]
        })

        // DOM 요소 표시/숨김 처리
        const domContainers = document.querySelectorAll('#canvas-containers > .canvas-container')
        domContainers.forEach((container, idx) => {
          const htmlElement = container as HTMLElement
          htmlElement.style.display = idx === newCurrentIndex ? 'block' : 'none'
        })
      }
    }

    updateObjects()
    takeCanvasScreenshot()
  },

  // 객체 목록 관리
  updateObjects: () => {
    const { canvas, activeSelection } = get()

    if (blockedUpdate || canvas?.historyProcessing) return

    blockedUpdate = true

    try {
      const cvs = canvas
      if (!cvs) return

      const allObjects = core.getObjects(cvs)
      if (!Array.isArray(allObjects)) return

      const newObjects: CanvasObject[] = []
      const prevented = ['overlay', 'outline', 'clipping', 'printguide', 'template-element', 'fillImage']

      // 객체 정보 생성
      allObjects.forEach((obj: FabricObject, index: number) => {
        // settingsStore 연동은 나중에 추가
        if (!obj || obj.excludeFromExport === true || prevented.includes(obj.extensionType || '')) {
          return
        }

        obj.name = obj.name ?? obj.type + index.toString()
        const selected = Array.isArray(activeSelection)
          ? activeSelection.some((item: FabricObject) => item?.id === obj.id)
          : false

        newObjects.push({
          id: obj.id || `obj_${index}`,
          name: obj.name || `${obj.type}_${index}`,
          type: getObjectType(obj.extensionType || obj.type || ''),
          visible: Boolean(obj.visible !== false),
          locked: !(obj.hasControls ?? true),
          selected: selected,
          editable: obj.editable ?? true,
          displayOrder: index
        } as CanvasObject)
      })

      // 순서를 뒤집어서 최상위 객체가 첫 번째로 오도록 함
      newObjects.reverse()

      // 스크린샷 및 객체 목록 상태 업데이트
      get().takeCanvasScreenshot()
      set({ objects: newObjects })
    } catch (error) {
      console.error('updateObjects 에러:', error)
    } finally {
      blockedUpdate = false
    }
  },

  // 객체 값 변경
  changeObjectValue: (inputValue: number | string, key: string) => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }

    debounceTimer = setTimeout(() => {
      const { canvas } = get()
      let value: string | number = inputValue

      const item = canvas?.getActiveObject()
      if (!item) return

      if (numberValues.includes(key)) {
        const strValue = String(value)
        value = strValue.trim().length === 0 || isNaN(Number(value)) ? 0 : Number(value)

        // width/height는 scale 변경 (텍스트 제외)
        if (key === 'width') {
          const originWidth = Number(value) === 0 ? 1 : Number(value)
          if (item.type === 'i-text' || item.type === 'text' || item.type === 'textbox') {
            item.scaleX = 1
            item.scaleY = 1
          } else {
            const changed = originWidth / item.width!
            item.scaleX = changed
            if (item.lockUniScaling) {
              item.scaleY = changed
            }
          }
        } else if (key === 'height') {
          const originHeight = Number(value) === 0 ? 1 : Number(value)
          if (item.type === 'i-text' || item.type === 'text' || item.type === 'textbox') {
            item.scaleX = 1
            item.scaleY = 1
          } else {
            const changed = originHeight / item.height!
            item.scaleY = changed
            if (item.lockUniScaling) {
              item.scaleX = changed
            }
          }
        } else {
          item[key] = value
        }
      } else {
        item[key] = String(value)
      }

      item.dirty = true
      canvas?.renderAll()
      debounceTimer = null
    }, 100)
  },

  // 설정 업데이트
  updateAllWorkspaceSettings: (settings: CanvasSettings) => {
    const { allEditors } = get()
    allEditors.forEach((editor: Editor) => {
      const plugin = editor.getPlugin<WorkspacePlugin>('WorkspacePlugin')
      if (plugin) {
        plugin.setOptions(settings)
      }
    })
  },

  // 스크린샷 (외부 debounce 함수 사용)
  takeCanvasScreenshot: () => {
    const { allCanvas } = get()
    debouncedTakeScreenshot(allCanvas, set)
  },

  // 렌더링
  render: (immediate = false) => {
    const { canvas } = get()
    if (canvas && !canvas.disposed) {
      RenderOptimizer.queueRender(canvas, immediate)
    }
  },

  debouncedRender: () => {
    const { canvas } = get()
    debouncedRenderFn(canvas)
  },

  throttledRender: () => {
    if (!throttleTimeout) {
      throttleTimeout = setTimeout(() => {
        get().render(false)
        throttleTimeout = null
      }, 16)
    }
  },

  // 내부 헬퍼 함수들
  _emitSelections: (e: FabricEvent) => {
    const { objects } = get()

    try {
      let selected: FabricObject[] = Array.isArray(e.selected) ? e.selected : (e.selected ? [e.selected] : [])

      if (selected.length === 1 && !!selected[0]?.group) {
        selected = selected[0].group.getObjects()
      }

      // 안전한 필터링
      selected = selected?.filter(
        (item: FabricObject) =>
          item &&
          item.extensionType !== 'guideline' &&
          item.extensionType !== 'printguide' &&
          item.extensionType !== 'overlay' &&
          item.extensionType !== 'outline' &&
          item.extensionType !== 'clipping'
      ) || []

      // 선택 객체 업데이트
      set({ activeSelection: selected || [] })

      // objects 업데이트
      if (Array.isArray(objects)) {
        const updatedObjects = objects.map((obj) => {
          if (obj && obj.id) {
            return {
              ...obj,
              selected: selected.some((item: FabricObject) => item?.id === obj.id)
            }
          }
          return obj
        })
        set({ objects: updatedObjects })
      }
    } catch (error) {
      console.error('emitSelections 에러:', error)
      set({ activeSelection: [] })
    }
  },

  _updateObjectsHandler: (e?: FabricEvent) => {
    const { canvas, activeSelection, updateObjects } = get()

    // 캔버스 유효성 검사
    if (!canvas || canvas.disposed) return

    // 특정 타입의 객체는 무시
    if (
      e?.target?.type === 'GuideLine' ||
      e?.target?.extensionType === 'overlay' ||
      e?.target?.extensionType === 'outline' ||
      e?.target?.extensionType === 'clipping' ||
      e?.target?.extensionType === 'guideline'
    ) {
      return
    }

    // 외부 debounced 함수 사용 (cancel 가능)
    debouncedUpdateObjectsHandler(() => {
      try {
        useAppStore.setState({
          hasCutlineTemplate: Boolean(canvas
            ?.getObjects()
            ?.find((obj: FabricObject) => obj?.id === 'cutline-template'))
        })

        // 히스토리 처리 중에는 업데이트 건너뛰기
        if (canvas?.historyProcessing) return

        // 안전한 activeSelection 업데이트
        if (e?.target && e.target.id && activeSelection?.[0]?.id === e.target.id) {
          if (e.target) {
            useAppStore.setState({ activeSelection: [e.target] })
          }
        }

        updateObjects()
      } catch (error) {
        console.error('updateObjectsHandler 에러:', error)
      }
    })
  },

  _fixViewportOnChange: () => {
    const { canvas } = get()
    if (canvas) {
      core.fixViewportObjects(canvas)
    }
  },

  _incrementTriggerSelectionRefresh: () => {
    set((state) => ({ triggerSelectionRefresh: state.triggerSelectionRefresh + 1 }))
  },

  // 스프레드 모드 관리
  setSpreadMode: (enabled: boolean) => {
    set({ isSpreadMode: enabled })
  },

  debouncedRecalcSpine: () => {
    const { isSpreadMode, restoring, spineResizeAbortController } = get()

    if (!isSpreadMode) return

    // restoring 중이면 debounce 비활성 (즉시 실행)
    if (restoring) {
      // 이전 요청 취소
      if (spineResizeAbortController) {
        spineResizeAbortController.abort()
      }

      // 즉시 실행 (debounce 없이)
      const newController = new AbortController()
      set({ spineResizeAbortController: newController })

      recalculateSpineWidth()
        .then((result) => {
          if (result.success) {
            console.log(`[AppStore] 책등 너비 재계산 완료 (즉시): ${result.spineWidth}mm (내지 ${result.pageCount}p)`)
          }
        })
        .catch((error) => {
          if (error.name !== 'AbortError') {
            console.error('[AppStore] 책등 재계산 오류:', error)
          }
        })
        .finally(() => {
          set({ spineResizeAbortController: null })
        })

      return
    }

    // 정상 모드: debounce(300ms) + AbortController
    // 이전 요청 취소
    if (spineResizeAbortController) {
      spineResizeAbortController.abort()
    }

    const newController = new AbortController()
    set({ spineResizeAbortController: newController })

    // debounce 300ms
    setTimeout(() => {
      if (newController.signal.aborted) return

      recalculateSpineWidth()
        .then((result) => {
          if (result.success) {
            console.log(`[AppStore] 책등 너비 재계산 완료: ${result.spineWidth}mm (내지 ${result.pageCount}p)`)
          }
        })
        .catch((error) => {
          if (error.name !== 'AbortError') {
            console.error('[AppStore] 책등 재계산 오류:', error)
          }
        })
        .finally(() => {
          if (get().spineResizeAbortController === newController) {
            set({ spineResizeAbortController: null })
          }
        })
    }, 300)
  },
}))

// Computed 값들을 위한 Selector hooks
export const useCurrentIndex = () => useAppStore((state) => {
  return state.allCanvas.findIndex((cvs: FabricCanvas) => cvs.id === state.canvas?.id)
})

export const useWorkspace = () => useAppStore((state) => {
  return state.canvas?.getObjects().find((obj: FabricObject) => obj.id === 'workspace')
})

export const useHasSelection = () => useAppStore((state) => state.activeSelection.length > 0)

export const useActiveSelection = () => useAppStore((state) => state.activeSelection)

export const useSelectionType = () => useAppStore((state) => {
  const { activeSelection } = state
  if (activeSelection.length === 1) {
    const obj = activeSelection[0] as FabricObject
    if (obj.id === 'page-outline') {
      return SelectionType.templateElement
    }
    return getObjectType(obj.extensionType || obj.type || '')
  } else if (activeSelection.length > 1) {
    return SelectionType.multiple
  } else {
    return null
  }
})

export const useHasCutlineTemplate = () => useAppStore((state) => state.hasCutlineTemplate)

// 개발/테스트 환경에서 Playwright 등 외부 도구가 스토어에 접근할 수 있도록 노출
if (import.meta.env.DEV) {
  ;(window as any).__appStore = useAppStore
}
