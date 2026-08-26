import { create } from 'zustand'
import { debounce } from 'lodash-es'
import Editor, {
  type CanvasObject,
  type CanvasSettings,
  core,
  ObjectPlugin,
  PluginBase,
  PointerShiftGuardPlugin,
  SelectionType,
  WorkspacePlugin,
  RenderOptimizer,
  createFabricCanvas,
  configureFabricDefaults
} from '@storige/canvas-core'
import type { AppMenu } from '@/types/menu'
import { recalculateSpineWidth } from '@/utils/spineCalculator'
import { isRequestCancelled } from '@/api/spine'
import { lap } from '@/utils/loadProfiler'
import { syncCanvasContainerOrder } from '@/utils/innerPageReorder'
import { bindPrintExcludeOverlay } from '@/utils/printExcludeOverlay'
import { useEditorStore } from '@/stores/useEditorStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { TemplateType } from '@storige/types'
import type { UneditedRequiredItem } from '@/utils/requiredEditCheck'

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

  // S2 (공유): 객체 삭제 확인 모달 상태 (전 상품 적용)
  deleteConfirmOpen: boolean
  deleteConfirmCount: number

  // L7 (2026-07-11): 필수 편집 요소 미편집 경고 모달 상태 (비차단 — '그래도 완료' 가능)
  requiredEditConfirmOpen: boolean
  requiredEditConfirmItems: UneditedRequiredItem[]

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

  /**
   * 레이어 패널 DnD 재정렬 (S3, 공유 계층 — 전 상품 적용).
   * sourceId 객체를 targetId 객체의 위/아래로 z-order 이동.
   * @param sourceId 드래그한 객체 id
   * @param targetId 드롭 대상 객체 id
   * @param placeAbove true=target 위(앞/front)로, false=target 아래(뒤/back)로
   */
  reorderObject: (sourceId: string, targetId: string, placeAbove: boolean) => void

  // S2 (공유): 삭제 확인 — 휴지통 버튼/DEL 핫키 모두 이 액션을 거쳐 모달을 띄운다.
  requestDeleteSelection: () => void
  confirmDeleteSelection: () => void
  cancelDeleteSelection: () => void

  // L7: 필수 편집 경고 — 완료 게이트(requiredEditGate)가 요청, 모달 버튼이 resolve.
  requestRequiredEditConfirm: (items: UneditedRequiredItem[]) => Promise<'proceed' | 'edit'>
  resolveRequiredEditConfirm: (choice: 'proceed' | 'edit') => void

  // 객체 관리
  changeObjectValue: (value: number | string, key: string) => void

  // 설정 업데이트
  updateAllWorkspaceSettings: (settings: CanvasSettings) => void

  // 스크린샷 — changedIndex 를 주면 해당 캔버스만 재캡처, 생략하면 전체 재캡처.
  // P2: options 로 포맷/해상도(jpg·72dpi 등) 추가 지정 가능 (기본 png/320px = 기존 비파괴).
  takeCanvasScreenshot: (changedIndex?: number, options?: ThumbnailFormatOptions) => void

  /**
   * 대량 페이지 생성/삭제를 한 덩어리로 감싼다 — 구간 내 썸네일 캡처를 미루고 종료 시 1회만 캡처.
   *
   * 왜 필요한가(2026-08-24 §2 ⑤): 썸네일 debounce 는 200ms 인데 addPage 1회가 그보다 오래
   * 걸린다(재진입 시드 실측 ≈390ms/장). 그래서 루프 매 반복마다 debounce 가 만료돼 그 시점까지의
   * **전 캔버스**를 재캡처했다(takeCanvasScreenshot() 무인자 = 'all'). N장 증설이면 toDataURL
   * 호출이 1+2+…+N = O(N²) 회. 9장이면 45회다.
   *
   * 반드시 이 래퍼로 감싼다(try/finally 내장) — 수동 begin/end 는 예외 경로에서 썸네일이
   * 영구 정지될 수 있다.
   */
  runBulkPageOps: <T>(fn: () => Promise<T>) => Promise<T>

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

// L7: 필수 편집 경고 모달 promise resolver (요청↔버튼 응답 연결 — state 밖 모듈 보관)
let requiredEditConfirmResolver: ((choice: 'proceed' | 'edit') => void) | null = null
let throttleTimeout: ReturnType<typeof setTimeout> | null = null

// Debounced 함수들 (cancel 가능하도록 외부에 선언)
 
// 터치 디바이스에서는 toDataURL 이 retina(DPR=3) 캔버스에서 매우 비싸 메모리 폭발 → iOS
// Safari 페이지 크래시 유발. coarse pointer 환경에서는 디바운스를 길게(800ms) 잡고
// multiplier 를 0.4 로 줄여 데이터 양 약 1/8 로 축소.
function isTouchEnv(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  try { return window.matchMedia('(pointer: coarse)').matches } catch { return false }
}

// 모바일은 toDataURL 자체를 스킵 — iOS Safari 메모리 한계 회피.
// 썸네일은 모바일에서 보조적이고, 이걸 위해 retina 캔버스 전체를 PNG 로 인코딩하는
// 비용이 크래시 트리거. 모바일에선 빈 placeholder 만 set.
const TOUCH_ENV = isTouchEnv()
const SCREENSHOT_DEBOUNCE_MS = TOUCH_ENV ? 2000 : 200

// 썸네일 목표 폭(px) — 소비처는 PageItem(w-20=80px)/SidePanel(h-120px, 패널폭 ≤~280px).
// retina 대비 320px 이면 충분. 워크스페이스 crop 캡처에 multiplier 를 적용해
// 풀해상도 PNG 인코딩(페이지당 수백 KB~수 MB)을 수십 KB 수준으로 축소.
const THUMBNAIL_TARGET_WIDTH = 320

// P2 (포토북, 2026-06-23): 썸네일 포맷/해상도 파라미터.
// ⚠️ 비파괴 — 기본값은 기존과 동일한 'png'/320px(THUMBNAIL_TARGET_WIDTH). 포토북(펼침면 72dpi
//    jpg 썸네일 등)은 takeCanvasScreenshot 호출 시 옵션으로만 추가 지정한다. 기본 포맷을
//    png→jpg 로 바꾸면 공유 변경=전 상품(BOOK/LEAFLET/카드) 회귀이므로 금지.
export interface ThumbnailFormatOptions {
  /** 인코딩 포맷. 기본 'png'(기존 동작). 포토북 등은 'jpeg' 로 용량/72dpi 산출. */
  format?: 'png' | 'jpeg'
  /** crop 캡처 목표 폭(px). 기본 320(THUMBNAIL_TARGET_WIDTH). 72dpi 펼침면 등은 더 크게. */
  targetWidth?: number
  /** 인코딩 품질(0~1). 기본 0.8(기존 동작). jpeg 에서 주로 의미. */
  quality?: number
}

// 현재 적용 중인 썸네일 포맷 옵션. 기본 = 기존 png 동작과 1:1 일치(비파괴).
// takeCanvasScreenshot(changedIndex, options) 로 호출당 덮어쓴다.
let screenshotFormatOptions: Required<ThumbnailFormatOptions> = {
  format: 'png',
  targetWidth: THUMBNAIL_TARGET_WIDTH,
  quality: 0.8,
}

// 재캡처 대상 인덱스 집합. 'all' 이면 전체 재캡처(페이지 추가/삭제/재정렬 등
// 인덱스가 이동하는 경우). 변경 발생 캔버스만 재캡처해 100p 문서에서
// 편집 1회당 toDataURL 100회 → 1회로 줄인다.
let pendingScreenshotIndices: Set<number> | 'all' = 'all'

// >0 이면 썸네일 캡처를 예약하지 않고 dirty 집합만 누적한다(runBulkPageOps 구간).
// 카운터인 이유: 중첩 호출(내지 PDF 확장 안에서 또 증설)에도 안쪽 종료가 바깥 구간을
// 조기 해제하지 않게 하기 위함.
let bulkPageOpDepth = 0

// 대량 구간 안에서 실제로 썸네일 재캡처 요청이 있었는지. 구간이 아무것도 하지 않았으면
// 종료 시 전 캔버스 toDataURL 플러시를 돌릴 이유가 없다(내지 PDF 앉히기는 부족분이 0이어도
// 구간을 무조건 연다 — contentPdfGuide.ts:388). 최외곽 진입에서 내리고 요청 시 올린다.
let bulkPageOpDirty = false

// 대량 구간 안에서 책등 재계산 요청이 있었는지.
// ⚠️ debounce(300ms)는 이 루프에서 배칭 도구가 아니다 — addPage 1회가 재진입 시드 실측
//    ≈390ms 라 타이머가 매 반복 만료돼 9장 증설이 API 왕복 9회로 나간다(2026-08-26 적대검증
//    CONFIRMED). 썸네일과 **같은 구간 게이트**로 통일해 구간 종료 후 1회만 발사한다.
//    부수효과로, 중간 pageCount 로 계산된 요청 자체가 생기지 않으므로 늦게 도착한 스테일
//    응답이 최종 책등 폭을 덮어쓰는 경합도 이 경로에서는 구조적으로 사라진다.
let spineRecalcPending = false

const debouncedTakeScreenshot = debounce((allCanvas: any[], set: any, get: any) => {
  // 캔버스가 유효한지 확인
  if (!allCanvas || allCanvas.length === 0) return

  // 이번 실행분 dirty 스냅샷을 가져가고 누적 집합은 리셋
  const dirty = pendingScreenshotIndices
  pendingScreenshotIndices = new Set<number>()

  // 모바일/터치 디바이스에서는 썸네일 생성을 스킵 — toDataURL 비용이 iOS Safari
  // 메모리 한계와 만나 페이지 크래시를 유발. 썸네일이 필요한 PagePanel 등은
  // empty 문자열을 받아 placeholder 표시.
  if (TOUCH_ENV) {
    const placeholders: string[] = allCanvas.map(() => '')
    set({ screenshots: placeholders })
    return
  }

  // 변경 없는 인덱스는 기존 썸네일 유지 (길이는 현재 캔버스 수에 맞춤)
  const prevScreenshots: string[] = get().screenshots || []
  const newScreenshots: string[] = allCanvas.map((_: FabricCanvas, i: number) => prevScreenshots[i] ?? '')

  allCanvas.forEach((cvs: FabricCanvas, index: number) => {
    // 변경 발생 캔버스만 재캡처 (dirty === 'all' 이면 전체)
    if (dirty !== 'all' && !dirty.has(index)) return
    try {
      // 캔버스가 disposed되었는지 확인
      if (cvs && !cvs.disposed && cvs.getContext()) {
        // 워크스페이스 영역만 캡처 (회색 배경 제외)
        const workspace = cvs.getObjects().find((obj: any) => obj.id === 'workspace')
        // P2: 포맷/목표폭/품질은 screenshotFormatOptions 에서 (기본=png/320/0.8 = 기존 동작)
        const { format, targetWidth, quality } = screenshotFormatOptions
        if (workspace) {
          const bound = workspace.getBoundingRect()
          // 썸네일 목표폭/현재폭 비율로 축소 캡처 (업스케일은 하지 않음)
          const multiplier = bound.width > 0
            ? Math.min(1, targetWidth / bound.width)
            : 1
          newScreenshots[index] = cvs.toDataURL({
            format,
            quality,
            left: bound.left,
            top: bound.top,
            width: bound.width,
            height: bound.height,
            multiplier,
          })
        } else {
          newScreenshots[index] = cvs.toDataURL({
            format,
            quality,
            multiplier: 0.2
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
  deleteConfirmOpen: false,
  deleteConfirmCount: 0,
  requiredEditConfirmOpen: false,
  requiredEditConfirmItems: [],
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
    const { allCanvas, allEditors } = get()

    // 에디터(플러그인 리스너 + 전역 hotkeys + contextMenu) 먼저 정리
    // — 캔버스 dispose 후에 정리하면 플러그인 off() 가 dispose 된 캔버스를 만진다
    allEditors.forEach((editor: Editor) => {
      try {
        editor?.dispose()
      } catch (e) {
        console.warn('에디터 dispose 중 오류 발생:', e)
      }
    })

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

    // 다음 세션 첫 캡처는 전체 재캡처
    pendingScreenshotIndices = 'all'
    // 대량 구간 카운터도 초기화 — 예외로 종료된 세션이 다음 세션의 썸네일을 정지시키지 않게.
    bulkPageOpDepth = 0
    bulkPageOpDirty = false
    spineRecalcPending = false

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

      // ── 재진입 증설 sub-lap 계측 (2026-08-26) ────────────────────────────
      // restore:grow(총합 ≈390ms/장)를 항목별로 분해한다. embed 로드 구간에서만 활성이고
      // 그 밖에서는 lap() 이 공유 no-op 상수를 돌려주므로 평상시 '+페이지' 경로는 비용 0.
      const endCreate = lap('grow:createCanvas')

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

      // 현재 설정 로드 — createFabricCanvas 보다 먼저 필요 (unitOptions 주입).
      // ⚠️ 동적 import — createCanvas 유틸과 동일 사유로 useSettingsStore 정적 import 는 순환.
      // 스프레드 내지 시드 시점에는 setupEmptyEditor(unit:'mm')가 선행돼 currentSettings 확정
      // (store 기본값도 mm/150 — 미확정 창이 없다).
      const settingsStore = (await import('@/stores/useSettingsStore')).useSettingsStore.getState()
      const spreadConfig = settingsStore.spreadConfig
      const currentSettings = settingsStore.currentSettings

      // FabricJS 캔버스 인스턴스 생성 (core API 사용)
      // id 문자열 대신 요소 직접 전달 — 동시 초기화 시 getElementById 요소 탈취 레이스 방지
      // unitOptions 주입 — 종전엔 미주입이라 이 경로(addPage/addInnerPage)의 캔버스는
      // canvas.unitOptions===undefined 영구 → 이미지 업로드 mm 스케일 보정에서 TypeError.
      const newCanvas = await createFabricCanvas(canvasElement, {
        index: index,
        unitOptions: {
          unit: currentSettings.unit,
          dpi: currentSettings.dpi,
        },
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

      // 새 에디터 생성 — init 은 registerCanvasPlugins 안에서 1회만 수행한다
      // (여기서 또 부르면 ContextMenu 가 중복 생성돼 document 리스너가 두 벌 붙는다)
      const newEditor = new Editor()

      // 워크스페이스 사이즈 결정 (위에서 로드한 현재 설정 사용)
      let pageSize: { width: number; height: number; cutSize: number; safeSize: number }
      const useInnerSpreadSize =
        !!spreadConfig?.innerSpec &&
        (spreadConfig.regionScope === 'inner' || get().allCanvas.length > 0)
      const pageTrim = settingsStore.pageTrimMm
      if (useInnerSpreadSize && spreadConfig?.innerSpec) {
        // 포토북 내지(O-2): 2-up 펼침면 — 폭=한 면×2, 높이=한 면. (한 펼침면=1 캔버스라
        // 좌/우 페어가 구조적으로 함께 이동·삭제·재정렬 → 페어 무결성 보장.)
        const isp = spreadConfig.innerSpec
        pageSize = {
          width: isp.pageWidthMm * 2,
          height: isp.pageHeightMm,
          cutSize: isp.cutSizeMm,
          safeSize: isp.safeSizeMm,
        }
      } else if (pageTrim && get().allCanvas.length > 0) {
        // 표지 스프레드 다음 내지: 판형(한 면)이지 표지 총폭(430)이 아니다.
        pageSize = {
          width: pageTrim.width,
          height: pageTrim.height,
          cutSize: currentSettings.size.cutSize,
          safeSize: currentSettings.size.safeSize ?? 5,
        }
      } else if (spreadConfig?.spec) {
        // 스프레드 모드: 내지는 표지 크기 사용
        pageSize = {
          width: spreadConfig.spec.coverWidthMm,
          height: spreadConfig.spec.coverHeightMm,
          cutSize: spreadConfig.spec.cutSizeMm,
          safeSize: spreadConfig.spec.safeSizeMm,
        }
      } else {
        // 일반 모드: 현재 설정 사용 (safeSize default 5)
        pageSize = {
          width: currentSettings.size.width,
          height: currentSettings.size.height,
          cutSize: currentSettings.size.cutSize,
          safeSize: currentSettings.size.safeSize ?? 5,
        }
      }

      const workspaceOptions = {
        ...currentSettings,
        size: pageSize,
      }
      endCreate()

      const endPlugins = lap('grow:plugins')
      // createCanvas 와 **동일한 플러그인 세트**를 등록한다(2026-08-03).
      // 종전에는 WorkspacePlugin+PointerShiftGuard 2개만 붙어서, 스프레드 모드의 2번째 이후
      // 캔버스가 ObjectPlugin(삭제)·HistoryPlugin(되돌리기)·FrameInteractionPlugin(사진틀)·
      // SpreadPlugin(거터/좌우면 가이드) 없이 사실상 편집 불가였다. 특히 포토북 내지 펼침면은
      // 전 캔버스가 이 경로를 타므로 첫 장 말고는 전부 죽은 캔버스였다.
      // ⚠️ registerCanvasPlugins 가 editor.init(canvas) 를 수행하므로 호출측에서 중복 init 금지
      //    (ContextMenu 가 두 번 생성돼 document 리스너가 중복된다).
      // ⚠️ 동적 import — createCanvas 가 useAppStore 를 참조하므로 정적 import 는 순환이 된다
      //    (같은 함수의 useSettingsStore 로딩과 동일 패턴).
      const { registerCanvasPlugins } = await import('@/utils/createCanvas')
      const { workspace: workspacePlugin, spread: spreadPlugin } = registerCanvasPlugins(
        newCanvas,
        newEditor,
        workspaceOptions as Parameters<typeof registerCanvasPlugins>[2],
        // 책 내지(+ 버튼 / 내지 PDF 확장)에 표지 SpreadPlugin 을 붙이지 않는다.
        // 포토북 펼침면만 inner SpreadPlugin 이 등록된다.
        { allowCoverSpread: false },
      )
      endPlugins()

      // 스토어에 등록 (initializationId 전달하여 등록 허용)
      const endStoreInit = lap('grow:storeInit')
      init(newCanvas, newEditor, initializationId || undefined)
      endStoreInit()

      // 새 페이지로 전환 (컨테이너가 display:block으로 변경됨)
      const nextIndex = allCanvas.length // init 후에는 allCanvas가 업데이트됨
      const endSetPage = lap('grow:setPage')
      setPage(nextIndex)
      endSetPage()

      // 컨테이너가 표시된 후 WorkspacePlugin 초기화
      // init()이 workspace Rect 생성 + 이벤트 바인딩 + setZoomAuto()까지 처리
      // (이 순서가 createCanvas 와 다른 이유 = 새 캔버스 컨테이너가 여기서야 표시되기 때문)
      const endWsInit = lap('grow:wsInit')
      workspacePlugin.init()
      // 펼침면(표지/내지 공통) 가이드 — workspace 확정 후 초기화
      spreadPlugin?.init()
      endWsInit()

      // 새 캔버스는 컨테이너 표시 전에 생성돼 fabric 치수가 0/스테일일 수 있는데,
      // 리사이즈 이벤트가 없으면 useCanvasContainerSizeSync 가 발화하지 않아 첫 표시가
      // 빈 화면으로 남는다(페이지 전환 시에야 자가치유). 표시 직후 래퍼 실측으로 동기.
      const wrapperEl = document.getElementById('canvas-wrapper')
      if (wrapperEl) {
        const w = wrapperEl.clientWidth
        const h = wrapperEl.clientHeight
        // 1px 허용오차 — setZoomAuto 는 wrapper 의 getBoundingClientRect() 소수폭으로
        // 캔버스를 잡아 clientWidth 정수와 상시 불일치할 수 있다. 이 블록의 목적은
        // "치수가 0/스테일이라 첫 표시가 빈 화면" 구제이고 1px 미만 차이는 그 실패 모드를
        // 만들 수 없다(useCanvasContainerSizeSync 의 nearlyUnchanged 와 동일 기준).
        // 비유한값은 종전처럼 무조건 구제한다(허용오차 도입이 판정을 좁히지 않도록).
        const cw = newCanvas.getWidth()
        const ch = newCanvas.getHeight()
        const stale =
          !Number.isFinite(cw) || !Number.isFinite(ch) ||
          Math.abs(cw - w) >= 1 || Math.abs(ch - h) >= 1
        if (w > 0 && h > 0 && stale) {
          // hit/skip 을 서로 다른 lap 키로 나눠 count 만으로 이 블록의 실효를 판정한다
          // (lapStart 는 extra 를 받지 않는다).
          const endSync = lap('grow:wrapperSync:hit')
          newCanvas.setDimensions({ width: w, height: h })
          newCanvas.calcOffset?.()
          workspacePlugin.setZoomAuto()
          endSync()
        } else {
          lap('grow:wrapperSync:skip')()
        }
      }

      const endTail = lap('grow:tail')
      // useEditorStore.pages에 새 EditPage 추가 (SpreadPagePanel 동기화)
      const editorStore = useEditorStore.getState()
      editorStore.addPage({
        id: canvasId,
        templateId: canvasId,
        templateType: useInnerSpreadSize ? TemplateType.SPREAD : TemplateType.PAGE,
        canvasData: { version: '5.3.0', objects: [], width: pageSize.width, height: pageSize.height },
        sortOrder: editorStore.pages.length,
        required: false,
        deleteable: true,
      })
      // currentPageIndex도 동기화
      editorStore.setCurrentPageIndex(nextIndex)

      // 객체 목록 및 스크린샷 업데이트
      updateObjects()
      takeCanvasScreenshot()
      endTail()

      console.log(`새 페이지 추가됨: ${canvasId}`)

      // 내지 추가 시 책등 너비 재계산.
      // 스프레드 모드는 **반드시 debouncedRecalcSpine 경유** — 여기서 직접 부르면
      // 재진입 시드(embed 복원의 restore:grow 루프)가 페이지마다 책등 API 왕복 +
      // 표지 캔버스 resizeSpine 을 발사한다(9장 = 9회). debounce(300ms)+AbortController 가
      // 그걸 마지막 1회로 접는다. 또 직접 호출분은 abort 대상이 아니라서, 늦게 도착한
      // 중간 pageCount 응답이 최종 응답보다 나중에 resizeSpine 을 덮어쓸 여지도 있었다
      // (경합 — 최종 책등 폭이 스테일 페이지 수로 확정될 수 있음).
      // 비스프레드(일반 책)는 debouncedRecalcSpine 이 즉시 return 하므로 직접 호출 유지.
      if (get().isSpreadMode) {
        get().debouncedRecalcSpine()
      } else {
        recalculateSpineWidth().then((result) => {
          if (result.success) {
            console.log(`[AppStore] 책등 너비 재계산 완료: ${result.spineWidth}mm (내지 ${result.pageCount}p)`)
          } else if (result.error) {
            console.warn(`[AppStore] 책등 재계산 스킵: ${result.error}`)
          }
        }).catch((error) => {
          console.error('[AppStore] 책등 재계산 오류:', error)
        })
      }
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

    // setPage 는 `#canvas-containers > .canvas-container` 의 DOM 인덱스로
    // 표시/숨김을 바꾼다. 배열만 바꾸고 DOM 을 안 맞추면 재정렬 후 다른 페이지가 보인다.
    syncCanvasContainerOrder(
      document.getElementById('canvas-containers'),
      newCanvases,
    )

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

    // 재정렬로 인덱스가 이동했으므로 전체 재캡처 (부분 갱신 시 썸네일 어긋남)
    get().takeCanvasScreenshot()

    // 내지 매수가 같아도 책등 공식은 페이지 수 기준 — 순서가 바뀌어도 호출은 멱등.
    // 스프레드가 아니면 no-op 에 가깝지만 가드 후 호출한다.
    if (get().isSpreadMode) {
      get().debouncedRecalcSpine()
    }
  },

  deletePage: (canvasId: string) => {
    const { allCanvas, allEditors, setPage, updateObjects, takeCanvasScreenshot } = get()
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
    const targetEditor = newEditors[indexOfCanvas]

    // DOM에서 캔버스 컨테이너 요소 찾기 - wrapperEl 사용
    const containerToRemove = targetCanvas.wrapperEl
    const parentNode = containerToRemove?.parentNode

    // 캔버스 정리
    try {
      targetCanvas.clear()
    } catch (err) {
      console.error('캔버스 clear 중 오류:', err)
    }

    // 에디터 정리 (캔버스 dispose 전) — 플러그인 리스너 off / 전역 hotkeys unbind /
    // contextMenu DOM 리스너 해제. 누락 시 삭제된 페이지의 단축키 핸들러가 잔존해
    // dispose 된 캔버스를 건드린다 (메모리 누수 + TypeError 위험)
    try {
      targetEditor?.dispose()
    } catch (err) {
      console.error('에디터 dispose 중 오류:', err)
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
    // 페이지 삭제로 인덱스가 이동했으므로 전체 재캡처 (부분 갱신 시 썸네일 어긋남)
    takeCanvasScreenshot()

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
      // L3 B-5 (2026-07-06): 디자이너(editMode)는 template-element 를 목록에 표시 —
      // 제작자가 보호 속성을 제어해야 하므로. 고객은 현행 은폐 유지(CC <LC> 패턴 정합).
      // fillImage 는 양쪽 모두 은폐(사진틀 내부 구현체).
      const isEditMode = useSettingsStore.getState().currentSettings.editMode === true
      const prevented = isEditMode
        ? ['overlay', 'outline', 'clipping', 'printguide', 'fillImage']
        : ['overlay', 'outline', 'clipping', 'printguide', 'template-element', 'fillImage']
      // L3 B-5(적대 리뷰): 구조성 헬퍼는 editMode 에도 은폐 — 독립 조작 의미가 없고
      // z-order/삭제가 저장본 구조를 오염시킨다(page-outline 계열·템플릿 배경).
      const structuralIds = ['page-outline', 'page-outline-clip', 'template-background', 'template-mockup']

      // 객체 정보 생성
      allObjects.forEach((obj: FabricObject, index: number) => {
        // settingsStore 연동은 나중에 추가
        if (!obj || obj.excludeFromExport === true || prevented.includes(obj.extensionType || '')) {
          return
        }
        if (structuralIds.includes(obj.id || '')) {
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
          // B1: contentEditable 강제(applyObjectPermissions)가 fabric editable=false 를
          // 세팅해도 레이어 행 액션(잠금/가시성)은 유지 — 내용편집만 잠근다는 설계 의도 초과 방지.
          editable: (obj.editable ?? true) || (obj as { contentEditable?: boolean }).contentEditable === false,
          // B0-②: 관리자 위치고정 여부 — SidePanel 이 비-editMode 에서 해제 버튼 숨김 판정에 사용
          movable: (obj as { movable?: boolean }).movable,
          // B1: 레이어 행 배지용 속성 스냅샷
          deleteable: (obj as { deleteable?: boolean }).deleteable,
          contentEditable: (obj as { contentEditable?: boolean }).contentEditable,
          printExclude: (obj as { printExclude?: boolean }).printExclude,
          lockLayerOrder: (obj as { lockLayerOrder?: boolean }).lockLayerOrder,
          lockLevel: (obj as { lockInfo?: { isLocked?: boolean; lockLevel?: string } }).lockInfo?.isLocked
            ? ((obj as { lockInfo?: { lockLevel?: string } }).lockInfo?.lockLevel as CanvasObject['lockLevel'])
            : undefined,
          // L2: 텍스트 내용 미리보기 — 행 표시명(자동 이름일 때 대체)용, 저장 무접촉
          textPreview: typeof (obj as { text?: unknown }).text === 'string'
            ? ((obj as { text?: string }).text as string).slice(0, 24)
            : undefined,
          displayOrder: index
        } as CanvasObject)
      })

      // 순서를 뒤집어서 최상위 객체가 첫 번째로 오도록 함
      newObjects.reverse()

      // 스크린샷 및 객체 목록 상태 업데이트
      // 변경이 발생한 캔버스(현재 캔버스)만 재캡처 — 100p 문서에서 매 편집마다
      // 전 페이지 toDataURL 100회가 돌던 것을 1회로 축소
      const changedIndex = get().allCanvas.findIndex((c: FabricCanvas) => c.id === cvs.id)
      get().takeCanvasScreenshot(changedIndex)
      set({ objects: newObjects })
    } catch (error) {
      console.error('updateObjects 에러:', error)
    } finally {
      blockedUpdate = false
    }
  },

  // 레이어 패널 DnD 재정렬 (S3, 공유 계층 — BOOK/LEAFLET/카드 전 상품 적용)
  //
  // ⚠️ 단일 진실원(R2): 레이어 목록은 updateObjects()에서 core.getObjects() 필터 결과를
  //    .reverse() 한 것이라 "목록 위 = 맨앞(front, 높은 z-index)"이다. 목록 인덱스로
  //    직접 계산하면 방향이 뒤집혀 "맨앞으로"가 뒤로 가는 회귀가 난다. 따라서 목록 인덱스가
  //    아니라 **fabric 라이브 스택(canvas.getObjects())의 실제 인덱스**를 기준으로 moveTo 한다.
  //    placeAbove(앞으로)=target 의 fabric 인덱스보다 위, placeAbove=false(뒤로)=아래.
  reorderObject: (sourceId: string, targetId: string, placeAbove: boolean) => {
    const { canvas, getPlugin, updateObjects } = get()
    if (!canvas || sourceId === targetId) return

    const all: FabricObject[] = canvas.getObjects()
    const source = all.find((obj: FabricObject) => obj.id === sourceId)
    const target = all.find((obj: FabricObject) => obj.id === targetId)
    if (!source || !target) return

    // ObjectPlugin 의 z-order 가드와 동일: 레이어 순서 잠금 객체는 단독 이동 불가
    if ((source as any).lockLayerOrder) {
      console.log('🔒 레이어 순서 이동이 잠긴 객체입니다')
      return
    }

    // 히스토리 1트랜잭션으로 묶기 (ObjectPlugin.up/down 패턴)
    canvas.offHistory()
    try {
      // target 의 현재 fabric 인덱스를 기준으로 목적지 산출.
      // fabric 인덱스: 0 = 맨뒤(back), 큰 값 = 맨앞(front).
      // placeAbove(앞으로) → target 위(인덱스 +1), 아니면 target 자리(아래).
      const sourceIdx = canvas.getObjects().indexOf(source)
      const targetIdx = canvas.getObjects().indexOf(target)
      if (sourceIdx === -1 || targetIdx === -1) {
        canvas.onHistory()
        return
      }

      let destIdx = placeAbove ? targetIdx + 1 : targetIdx
      // source 를 먼저 빼면 source 아래(작은 인덱스)의 목적지는 한 칸 당겨진다.
      if (sourceIdx < destIdx) destIdx -= 1
      // 범위 클램프
      const maxIdx = canvas.getObjects().length - 1
      if (destIdx < 0) destIdx = 0
      if (destIdx > maxIdx) destIdx = maxIdx

      if (destIdx === sourceIdx) {
        canvas.onHistory()
        return
      }

      source.moveTo(destIdx)

      // ObjectPlugin z-order 와 동일: 사진틀 채움 이미지(fillImage)는 부모 바로 위로 동반 이동
      const fillImage = canvas.getObjects().find((obj: FabricObject) =>
        obj.extensionType === 'fillImage' && (obj as any).parentLayerId === source.id
      )
      if (fillImage) {
        const parentIndex = canvas.getObjects().indexOf(source)
        fillImage.moveTo(parentIndex + 1)
      }

      // workspace/background/guide 등 항상-바닥/항상-위 객체 재고정 (ObjectPlugin.setUnchangeable)
      getPlugin<ObjectPlugin>('ObjectPlugin')?.setUnchangeable()

      RenderOptimizer.queueRender(canvas)
    } catch (error) {
      console.error('reorderObject 에러:', error)
    } finally {
      canvas.onHistory()
    }

    // layerChanged 핸들러가 debounce 라 목록 즉시 갱신을 위해 updateObjects 직접 호출
    updateObjects()
  },

  // ── S2 (공유 계층, 2026-06-23): 객체 삭제 확인 (전 상품 BOOK/LEAFLET/카드 적용) ──
  // ⚠️ canvas-core 무변경(R1): DEL/Backspace 핫키는 canvas-core 의 hotkeys-js(document keydown)가
  //    처리하므로, editor 의 ObjectDeleteConfirm 가 document 캡처단계에서 가로채(stopImmediatePropagation)
  //    이 액션을 호출한다 → 외부 임베더(ShareSnap/100p/MD2Books)는 이 모달이 없어 영향 0.
  //    실제 삭제는 기존 ObjectPlugin.del() 재사용(삭제잠금·lid·fillImage 동반제거 가드 그대로).
  requestDeleteSelection: () => {
    const { canvas, activeSelection } = get()
    if (!canvas) return
    const sel =
      activeSelection && activeSelection.length > 0
        ? activeSelection
        : (canvas.getActiveObjects?.() ?? [])
    if (!sel || sel.length === 0) return
    set({ deleteConfirmOpen: true, deleteConfirmCount: sel.length })
  },
  confirmDeleteSelection: () => {
    const { getPlugin, updateObjects, canvas } = get()
    // del() 무인자 = active selection 전체를 1회 삭제(가드 내장). 버튼/핫키 공통 경로.
    getPlugin<ObjectPlugin>('ObjectPlugin')?.del()
    canvas?.discardActiveObject?.()
    canvas?.requestRenderAll?.()
    updateObjects()
    set({ deleteConfirmOpen: false, deleteConfirmCount: 0, activeSelection: [] })
  },
  cancelDeleteSelection: () => set({ deleteConfirmOpen: false, deleteConfirmCount: 0 }),

  // ── L7 (2026-07-11): 필수 편집 요소 미편집 경고 (비차단) ──
  // requiredEditGate.confirmRequiredEditsBeforeComplete 가 요청하고 RequiredEditConfirmModal
  // 버튼이 resolve. 'proceed'=그래도 완료(원 플로우 속행) / 'edit'=계속 편집(완료 중단).
  requestRequiredEditConfirm: (items: UneditedRequiredItem[]) =>
    new Promise<'proceed' | 'edit'>((resolve) => {
      // 중복 완료 클릭 방어 — 앞선 미해결 요청은 '계속 편집' 으로 정리
      requiredEditConfirmResolver?.('edit')
      requiredEditConfirmResolver = resolve
      set({ requiredEditConfirmOpen: true, requiredEditConfirmItems: items })
    }),
  resolveRequiredEditConfirm: (choice: 'proceed' | 'edit') => {
    set({ requiredEditConfirmOpen: false, requiredEditConfirmItems: [] })
    const resolver = requiredEditConfirmResolver
    requiredEditConfirmResolver = null
    resolver?.(choice)
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
  // changedIndex 지정 시 해당 캔버스만 재캡처(나머지는 기존 썸네일 유지),
  // 생략 시 전체 재캡처(페이지 추가/삭제/재정렬 등 인덱스 이동 케이스)
  // P2: options 지정 시 포맷/목표폭/품질을 덮어쓴다. 미지정 필드는 기본(png/320/0.8)으로
  //     리셋해 호출 간 상태 누수를 막는다 — 한 번 jpg 로 호출해도 다음 png 호출이 영향받지 않음.
  takeCanvasScreenshot: (changedIndex?: number, options?: ThumbnailFormatOptions) => {
    const { allCanvas } = get()
    screenshotFormatOptions = {
      format: options?.format ?? 'png',
      targetWidth: options?.targetWidth ?? THUMBNAIL_TARGET_WIDTH,
      quality: options?.quality ?? 0.8,
    }
    if (typeof changedIndex === 'number' && changedIndex >= 0 && pendingScreenshotIndices !== 'all') {
      pendingScreenshotIndices.add(changedIndex)
    } else if (typeof changedIndex !== 'number' || changedIndex < 0) {
      pendingScreenshotIndices = 'all'
    }
    // 대량 구간에서는 예약하지 않는다 — dirty 는 위에서 이미 누적됐고,
    // runBulkPageOps 종료 시 'all' 로 한 번만 캡처한다.
    if (bulkPageOpDepth > 0) {
      bulkPageOpDirty = true
      debouncedTakeScreenshot.cancel()
      return
    }
    debouncedTakeScreenshot(allCanvas, set, get)
  },

  runBulkPageOps: async <T,>(fn: () => Promise<T>): Promise<T> => {
    // 최외곽 진입에서만 누적 플래그를 내린다(중첩 구간이 바깥 누적을 지우지 않게).
    if (bulkPageOpDepth === 0) bulkPageOpDirty = false
    bulkPageOpDepth++
    try {
      return await fn()
    } finally {
      bulkPageOpDepth = Math.max(0, bulkPageOpDepth - 1)
      if (bulkPageOpDepth === 0) {
        // 인덱스가 이동했을 수 있으므로 전체 재캡처 1회 — 단 구간 안에서 실제 요청이
        // 있었을 때만. 아무 일도 없던 구간까지 플러시하면 전 캔버스 toDataURL 이 헛돈다.
        if (bulkPageOpDirty) {
          bulkPageOpDirty = false
          get().takeCanvasScreenshot()
        }
        // 구간 중 접어둔 책등 재계산을 여기서 1회만 발사한다(위 spineRecalcPending 주석).
        if (spineRecalcPending) {
          spineRecalcPending = false
          get().debouncedRecalcSpine()
        }
      }
    }
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

    // 대량 구간(runBulkPageOps)에서는 발사하지 않고 종료 시 1회로 접는다.
    // debounce 300ms 는 addPage(≈390ms/장)보다 짧아 루프에서 매 반복 만료되므로
    // 배칭 도구가 되지 못한다 — 썸네일과 동일한 구간 게이트로 통일.
    if (bulkPageOpDepth > 0) {
      // 종전과 동일하게 "새 트리거는 이전 예약을 무효화한다" 불변식을 유지한다 —
      // 구간 진입 직전에 걸려 있던 타이머를 살려두면 그게 구간 한복판에서 중간 pageCount 로
      // 발사돼, 구간 종료 후의 최종 요청과 in-flight 로 겹칠 수 있다.
      if (spineResizeAbortController) {
        spineResizeAbortController.abort()
        set({ spineResizeAbortController: null })
      }
      spineRecalcPending = true
      return
    }

    // restoring 중이면 debounce 비활성 (즉시 실행)
    if (restoring) {
      // 이전 요청 취소
      if (spineResizeAbortController) {
        spineResizeAbortController.abort()
      }

      // 즉시 실행 (debounce 없이)
      const newController = new AbortController()
      set({ spineResizeAbortController: newController })

      // 스토어 컨트롤러를 HTTP 까지 관통시킨다 — 종전에는 대기 중 setTimeout 만 막혀,
      // 이미 발사된 요청은 계속 살아 있었다(spineApi.calculate 가 signal 미수신이었음).
      recalculateSpineWidth({ signal: newController.signal })
        .then((result) => {
          if (result.success) {
            console.log(`[AppStore] 책등 너비 재계산 완료 (즉시): ${result.spineWidth}mm (내지 ${result.pageCount}p)`)
          }
        })
        .catch((error) => {
          // axios 취소는 CanceledError(code='ERR_CANCELED') 라 'AbortError' 이름 비교로는
          // 절대 걸러지지 않는다. 실제로는 recalculateSpineWidth 가 자체 try/catch 로
          // 모든 에러를 반환값으로 바꾸므로 이 catch 는 API 에러를 보지 못하지만,
          // 틀린 판별식을 남겨두면 다음 사람이 그대로 복사한다.
          if (!isRequestCancelled(error)) {
            console.error('[AppStore] 책등 재계산 오류:', error)
          }
        })
        .finally(() => {
          // 정상 분기(:하단)와 동일한 identity 가드 — 무조건 null 로 밀면 이 사이에
          // 새로 만들어진 컨트롤러까지 지워져 다음 abort 체인이 조용히 끊긴다.
          if (get().spineResizeAbortController === newController) {
            set({ spineResizeAbortController: null })
          }
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

      // 스토어 컨트롤러를 HTTP 까지 관통시킨다 — 종전에는 대기 중 setTimeout 만 막혀,
      // 이미 발사된 요청은 계속 살아 있었다(spineApi.calculate 가 signal 미수신이었음).
      recalculateSpineWidth({ signal: newController.signal })
        .then((result) => {
          if (result.success) {
            console.log(`[AppStore] 책등 너비 재계산 완료: ${result.spineWidth}mm (내지 ${result.pageCount}p)`)
          }
        })
        .catch((error) => {
          // axios 취소는 CanceledError(code='ERR_CANCELED') 라 'AbortError' 이름 비교로는
          // 절대 걸러지지 않는다. 실제로는 recalculateSpineWidth 가 자체 try/catch 로
          // 모든 에러를 반환값으로 바꾸므로 이 catch 는 API 에러를 보지 못하지만,
          // 틀린 판별식을 남겨두면 다음 사람이 그대로 복사한다.
          if (!isRequestCancelled(error)) {
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
