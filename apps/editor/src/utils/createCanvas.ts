import Editor, {
  AccessoryPlugin,
  AlignPlugin,
  type CanvasSettings,
  ControlsPlugin,
  CopyPlugin,
  DraggingPlugin,
  EffectPlugin,
  FilterPlugin,
  FontPlugin,
  FrameInteractionPlugin,
  GroupPlugin,
  HistoryPlugin,
  ImageProcessingPlugin,
  LockPlugin,
  ObjectPlugin,
  PointerShiftGuardPlugin,
  PreviewPlugin,
  RulerPlugin,
  SafeZoneWarningPlugin,
  ServicePlugin,
  SmartCodePlugin,
  SmartGuidesPlugin,
  SpreadPlugin,
  TemplatePlugin,
  TransformFeedbackPlugin,
  WorkspacePlugin,
  createFabricCanvas,
  configureFabricDefaults,
} from '@storige/canvas-core'

// Feature flag for image processing (OpenCV) features
const ENABLE_IMAGE_PROCESSING = import.meta.env.VITE_ENABLE_IMAGE_PROCESSING !== 'false'
// Feature flag for ruler
const ENABLE_RULER = import.meta.env.VITE_ENABLE_RULER !== 'false'
// Feature flag for smart guides (객체 간 정렬 가이드/스냅 + 회전 각도 스냅, E1 §5-1) — 기본 on
const ENABLE_SMART_GUIDES = import.meta.env.VITE_ENABLE_SMART_GUIDES !== 'false'
// Feature flag for transform feedback (변형 중 실시간 치수/각도/좌표, E1 §5-2) — 기본 on
const ENABLE_TRANSFORM_FEEDBACK = import.meta.env.VITE_ENABLE_TRANSFORM_FEEDBACK !== 'false'
// Feature flag for safe zone warning (재단/안전영역 침범 실시간 경고, E1 §5-5) — 기본 on
const ENABLE_SAFEZONE_WARNING = import.meta.env.VITE_ENABLE_SAFEZONE_WARNING !== 'false'
// Feature flag for alt+drag clone (Alt/Option 키를 누른 채 객체 드래그 시 복제, C5/E2) — 기본 on
const ENABLE_ALT_DRAG_CLONE = import.meta.env.VITE_ENABLE_ALT_DRAG_CLONE !== 'false'
// Feature flag for touch long-press context menu (모바일 롱프레스 컨텍스트 메뉴, C6/E2) — 기본 on
const ENABLE_TOUCH_CONTEXT_MENU = import.meta.env.VITE_ENABLE_TOUCH_CONTEXT_MENU !== 'false'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { innerSpecToPlaceholderSpec } from '@/utils/photobookSpread'
import { bindPrintExcludeOverlay } from '@/utils/printExcludeOverlay'
import { DEFAULT_FONT_FAMILY, loadFonts, getFontList, resolveStorageUrl } from '@/utils/fontManager'
import { apiClient } from '@/api/client'
import type { fabric } from 'fabric'

/**
 * 초기화 세션이 취소/교체되어 캔버스 생성이 중단됨을 알리는 신호.
 * 호출측(뷰)은 이 에러를 오류가 아닌 정상 중단으로 처리해야 한다
 * (StrictMode 이중 마운트·빠른 라우트 전환에서 발생하는 기대 동작).
 */
export class CanvasInitCancelledError extends Error {
  constructor(initId: string) {
    super(`Canvas initialization cancelled (stale initId: ${initId})`)
    this.name = 'CanvasInitCancelledError'
  }
}

/**
 * 캔버스 안전 dispose — DOM에서 이미 분리된 캔버스(fabric dispose가 removeChild로
 * NotFoundError를 던지는 케이스)를 무해화하고 잔여 wrapper 엘리먼트까지 제거한다.
 * StrictMode 이중 마운트에서 cleanup의 innerHTML='' 이후 in-flight 초기화가
 * dispose를 시도할 때 콘솔 에러·고아 캔버스가 남던 결함의 공통 처리기.
 */
export const safeDisposeCanvas = (canvas: fabric.Canvas): void => {
  try {
    canvas.off()
  } catch {
    /* noop */
  }
  ;(canvas as fabric.Canvas & { disposed?: boolean }).disposed = true
  try {
    canvas.dispose()
  } catch {
    /* noop — 이미 DOM에서 분리된 경우 removeChild 실패 무해화 */
  }
  try {
    ;(canvas as fabric.Canvas & { wrapperEl?: HTMLElement }).wrapperEl?.remove()
  } catch {
    /* noop */
  }
}

/**
 * 캔버스 생성 함수
 * FabricJS 캔버스 인스턴스를 생성하고 플러그인을 초기화합니다.
 * @param customSettings - 사용자 정의 캔버스 설정
 * @param containerElement - 캔버스를 삽입할 컨테이너 요소
 * @param initId - 초기화 세션 ID (React Strict Mode 대응용)
 */
export const createCanvas = async (
  customSettings: Partial<CanvasSettings> = {},
  containerElement?: HTMLElement,
  initId?: string
): Promise<fabric.Canvas> => {
  const appStore = useAppStore.getState()

  // 사용자 설정이 제공되면 스토어 업데이트
  if (Object.keys(customSettings).length > 0) {
    useSettingsStore.getState().updateSettings(customSettings)
  }

  // 현재 설정 가져오기 (업데이트 후 fresh state에서 읽어야 함)
  const settings = useSettingsStore.getState().currentSettings

  // 새 캔버스의 인덱스 계산
  const { allCanvas } = appStore
  const index =
    allCanvas.length > 0
      ? allCanvas.reduce((max, item) => {
           
          const canvasIndex = (item as any).index ?? 0
          return canvasIndex > max ? canvasIndex : max
        }, -Infinity) + 1
      : 0

  const editor = new Editor()
  const canvasId = 'canvas' + index

  // 캔버스 컨테이너 요소
  const canvasContainer = containerElement || document.getElementById('canvas-containers')

  if (!canvasContainer) {
    console.error('Canvas container element not found')
    throw new Error('Canvas container element not found')
  }

  // 1. 캔버스 컨테이너 초기화 - 해당 인덱스에 관련된 모든 요소 제거
  const existingContainers = canvasContainer.querySelectorAll(`.canvas-container`)
  existingContainers.forEach((container) => {
    if (container.querySelector(`#${canvasId}`)) {
      container.remove()
    }
  })

  // 2. 새로운 FabricJS 캔버스 생성을 위한 DOM 요소 설정
  const canvasElement = document.createElement('canvas')
  canvasElement.id = canvasId

  // 사용자 정의 컨테이너 생성
  const customContainer = document.createElement('div')
  customContainer.className = 'canvas-container'
  customContainer.style.width = '100%'
  customContainer.style.height = '100%'
  customContainer.style.position = 'relative'
  customContainer.style.userSelect = 'none'
  customContainer.style.display = index === 0 ? 'block' : 'none'

  // 먼저 DOM 트리에 추가
  customContainer.appendChild(canvasElement)
  canvasContainer.appendChild(customContainer)

  // 3. FabricJS 기본 설정 (1회만 실행됨)
  configureFabricDefaults()

  // 초기화 세션 유효성 — await 경계마다 검사해 stale 초기화(StrictMode 이중 마운트,
  // 빠른 라우트 전환)가 DOM/스토어/전역 리스너를 오염시키기 전에 중단한다.
  // initId 미전달 호출자(페이지 추가 등 세션 내 경로)는 기존 동작 그대로.
  const isInitStale = (): boolean =>
    initId !== undefined && useAppStore.getState().initializationId !== initId

  // 4. FabricJS 캔버스 인스턴스 생성 (core API 사용)
  // ⚠️ id 문자열이 아니라 요소를 직접 전달 — 같은 id('canvas0')의 초기화 두 개가 겹치면
  // getElementById 조회가 상대편 요소를 훔쳐 바인딩하는 레이스가 있다(StrictMode 이중 마운트).
  const canvas = await createFabricCanvas(canvasElement, {
    index: index,
    unitOptions: {
      unit: settings.unit,
      dpi: settings.dpi,
    },
  })

  if (isInitStale()) {
    safeDisposeCanvas(canvas)
    customContainer.remove()
    throw new CanvasInitCancelledError(initId!)
  }

  // 5. FabricJS가 생성한 DOM 요소 구조 정리
  const fabricWrapper = canvasElement.parentElement

  if (fabricWrapper && fabricWrapper !== customContainer) {
    canvasContainer.removeChild(customContainer)

    const lowerCanvas = canvas.lowerCanvasEl
    const upperCanvas = canvas.upperCanvasEl

    customContainer.innerHTML = ''
    customContainer.appendChild(lowerCanvas)
    customContainer.appendChild(upperCanvas)

    canvasContainer.appendChild(customContainer)
    canvas.wrapperEl = customContainer
  }

  // 6. 폰트 목록 로드 (API에서)
  await loadFonts()

  // loadFonts(네트워크) 동안 세션이 교체됐으면 플러그인 초기화 전에 중단 —
  // stale initPlugins는 전역 리스너(핫키·contextMenu)와 #canvas-wrapper 전역
  // 셀렉터 조작을 라이브 뷰에 누수시킨다(appStore.init의 initId 가드만으로는 부족).
  if (isInitStale()) {
    safeDisposeCanvas(canvas)
    customContainer.remove()
    throw new CanvasInitCancelledError(initId!)
  }

  // 7. 플러그인 초기화
  initPlugins(canvas, editor, settings, initId)

  return canvas
}

/**
 * 여러 캔버스 동시 생성 함수
 */
export const createMultipleCanvas = async (
  count: number,
  customSetting?: Partial<CanvasSettings>
): Promise<fabric.Canvas[]> => {
  const canvasArray: fabric.Canvas[] = []

  const canvasContainer = document.getElementById('canvas-containers') as HTMLDivElement

  if (canvasContainer) {
    canvasContainer.innerHTML = ''
  }

  for (let i = 0; i < count; i++) {
    const canvas = await createCanvas(customSetting, canvasContainer)
    canvasArray.push(canvas)
  }

  if (canvasArray.length > 0) {
    const appStore = useAppStore.getState()
    appStore.setPage(0)
  }

  return canvasArray
}

/**
 * 플러그인 초기화 함수
 */
function initPlugins(
  canvas: fabric.Canvas,
  editor: Editor,
  settings: CanvasSettings,
  initId?: string
) {
  const appStore = useAppStore.getState()
  const settingsStore = useSettingsStore.getState()

  // 플러그인 인스턴스 생성
  // RulerPlugin은 VITE_ENABLE_RULER 환경변수로 제어
  const ruler = ENABLE_RULER
    ? new RulerPlugin(canvas, editor, {
        canvas,
        ruleSize: 24,
        fontSize: 10,
        enabled: false, // 성능 테스트를 위해 비활성화
        unit: settings.unit,
        dpi: settings.dpi,
      })
    : null

  // SmartGuidesPlugin은 VITE_ENABLE_SMART_GUIDES 환경변수로 제어 (기본 on)
  // ⚠️ 생성 순서 계약 (P0, 2026-07-15): fabric 이벤트 핸들러는 **등록(=생성자 바인딩) 순서대로**
  //   발화한다. SmartGuides 는 생성자에서 object:moving/rotating 을 바인딩하므로, 같은 이벤트를
  //   생성자에서 바인딩하는 FrameInteractionPlugin(아래) 보다 **먼저 생성**되어야
  //   "스냅 → 사진틀(fillImage/clipPath) 동기화" 순서가 보장된다. 뒤에 생성하면 프레임 동기화가
  //   스냅 전 raw 좌표/각도로 실행되어 사진·마스크가 어긋난 채 저장된다(이동 최대 8/zoom px·회전 3°,
  //   FrameInteractionPlugin._onTransformEnd 는 재동기화하지 않음).
  //   RulerPlugin(위)과의 중앙 스냅 상호 양보(8px)는 SmartGuides 가 축별 거리 판정으로 스스로
  //   양보하므로 등록 순서와 무관하게 동작한다.
  const smartGuides = ENABLE_SMART_GUIDES ? new SmartGuidesPlugin(canvas, editor, {}) : null

  // renderType은 settings 스토어에서 계산된 값이나, 현재는 기본값 사용
  // TODO: useSettingsStore에 renderType computed 구현 필요
  const renderType = settingsStore.renderType || 'bounded'
  const mergedOptions = {
    ...settings,
    renderType,
  }

  // SpreadPlugin은 스프레드 모드일 때만 등록
  // conversionMode: IDML 가져오기 유형(미존재 시 'full') — flat-spread 는 resizeSpine 방어 no-op,
  // flat-spine 은 spine-artwork 재배치 불변 가드에 사용된다.
  const spreadConfig = settingsStore.spreadConfig
  // 포토북 내지(O-2): regionScope==='inner' + innerSpec 이면 2-up 펼침면 렌더 경로.
  // inner 도 SpreadPlugin 생성자 계약상 spec(표지 SpreadSpec)을 요구하므로 placeholder 합성
  // (렌더는 innerSpec 으로만 수행 — placeholder 는 currentSpec 비-null 유지용, 표지경로 미진입).
  const isInnerSpread = spreadConfig?.regionScope === 'inner' && !!spreadConfig.innerSpec
  const spread = spreadConfig?.spec
    ? new SpreadPlugin(canvas, editor, {
        spec: spreadConfig.spec,
        conversionMode: spreadConfig.conversionMode ?? 'full',
      })
    : isInnerSpread
      ? new SpreadPlugin(canvas, editor, {
          spec: innerSpecToPlaceholderSpec(spreadConfig!.innerSpec!),
          regionScope: 'inner',
          innerSpec: spreadConfig!.innerSpec!,
        })
      : null

  const workspace = new WorkspacePlugin(canvas, editor, mergedOptions)
  const object = new ObjectPlugin(canvas, editor, mergedOptions)
  // P1-5 (2026-06-02): 객체 잠금/삭제불가 — LockPlugin 배선.
  // editMode(관리자 템플릿 제작)면 'admin'(잠금 지정/해제 가능), 고객 편집이면 'user'.
  const lock = new LockPlugin(canvas, editor, mergedOptions)
  // 사진틀(프레임) 인터랙션 — 프레임=선택단위 그룹 이동/스케일 동기화 + 더블클릭 사진 조정 모드.
  // 캔버스 레벨 리스너라 EditorView/embed 양쪽에 한 번 등록으로 적용되고 loadFromJSON 복원 후에도 유지된다.
  // ⚠️ 반드시 SmartGuidesPlugin(위) **이후** 생성 — 생성 순서 계약 참조(스냅이 프레임 동기화보다 먼저 발화).
  const frameInteraction = new FrameInteractionPlugin(canvas, editor, mergedOptions)
  const group = new GroupPlugin(canvas, editor)
  const history = new HistoryPlugin(canvas, editor)
  const copy = new CopyPlugin(canvas, editor, {
    getActiveCanvas: () => useAppStore.getState().canvas,
    // C5 (E2): Alt+드래그 복제 (기본 on). CopyPlugin 이 clone 파이프라인을 공유.
    altDragClone: ENABLE_ALT_DRAG_CLONE
  })
  // E2 §3-2a: 분배 보호객체 제외 가드의 editMode(관리자) 면제 판정용 옵션 전달
  // (additive — AlignPlugin 시그니처 하위호환, CopyPlugin editMode 규약과 동형).
  const align = new AlignPlugin(canvas, editor, mergedOptions)
  // ImageProcessingPlugin은 이미지 처리 기능이 활성화된 경우에만 생성
  const image = ENABLE_IMAGE_PROCESSING ? new ImageProcessingPlugin(canvas, editor) : null
  const service = new ServicePlugin(canvas, editor, image, mergedOptions)
  const material = new AccessoryPlugin(canvas, editor, {})
  // C5 (E2): 객체 위 alt+드래그를 CopyPlugin 복제에 양보하도록 동일 플래그 주입
  // (빈 곳 alt+팬은 불변). off 면 종전 거동 복원.
  const drag = new DraggingPlugin(canvas, editor, { altDragClone: ENABLE_ALT_DRAG_CLONE })
  // P1-3 (2026-06-12): 드래그 변환 진행 중 캔버스 레이아웃 이동/vpt 변경이 드래그
  // 변위로 전이되는 결함 차단 — 패널(ControlBar 280px) 열림 × 더블클릭 편집 레이스로
  // 객체가 -280px/zoom 텔레포트하던 라이브 P1 의 근본 수정.
  const pointerShiftGuard = new PointerShiftGuardPlugin(canvas, editor)

  // FontPlugin에 전달하기 위해 fontList 변환 (API에서 로드된 LibraryFont 사용)
  // 상대 URL을 절대 URL로 변환하여 전달
  const fontListForPlugin = getFontList().map((font) => ({
    name: font.name,
    src: resolveStorageUrl(font.fileUrl),
  }))

  // woff2ToTtf 변환은 NestJS API 에서 수행하므로 API 베이스 URL 을 주입한다.
  // (apiClient.getBaseUrl() 은 embed 의 setBaseUrl 런타임 오버라이드도 반영)
  const font = new FontPlugin(
    canvas,
    editor,
    fontListForPlugin,
    DEFAULT_FONT_FAMILY,
    apiClient.getBaseUrl()
  )

  // TransformFeedbackPlugin은 VITE_ENABLE_TRANSFORM_FEEDBACK 환경변수로 제어 (기본 on)
  // — DOM 오버레이(wrapperEl 내)라 직렬화/PDF/히스토리 원천 무관
  const transformFeedback = ENABLE_TRANSFORM_FEEDBACK
    ? new TransformFeedbackPlugin(canvas, editor, {})
    : null
  // SafeZoneWarningPlugin은 VITE_ENABLE_SAFEZONE_WARNING 환경변수로 제어 (기본 on)
  // — WorkspacePlugin cut/safe border 좌표 재사용, 토스트는 editor 쪽 safeZoneViolation 구독
  const safeZoneWarning = ENABLE_SAFEZONE_WARNING
    ? new SafeZoneWarningPlugin(canvas, editor, {})
    : null

  const filter = new FilterPlugin(canvas, editor)
  const effect = new EffectPlugin(canvas, editor)
  const smartCode = new SmartCodePlugin(canvas, editor)
  const controls = new ControlsPlugin(canvas, editor, settings.controls || {})
  const template = new TemplatePlugin(canvas, editor, mergedOptions)
  const preview = new PreviewPlugin(canvas, editor, mergedOptions)

  // Editor 초기화
  editor.init(canvas)

  // 모든 플러그인 등록
  editor.use(workspace)

  // SpreadPlugin은 workspace 다음에 등록 (workspace가 먼저 초기화되어야 함)
  if (spread) {
    editor.use(spread)
  }

  editor.use(object)
  editor.use(lock)
  lock.setUserRole((mergedOptions as any).editMode ? 'admin' : 'user')
  // SmartGuidesPlugin — editor.use 순서는 이벤트 발화 순서와 무관하다(fabric 바인딩은 각
  // 플러그인 **생성자**에서 이미 완료). 발화 순서의 권위는 위 "생성 순서 계약" —
  // ruler(중앙 스냅) → smartGuides(스냅) → frameInteraction(사진틀 동기화) 생성 순.
  if (smartGuides) {
    editor.use(smartGuides)
  }
  editor.use(frameInteraction)
  // RulerPlugin은 VITE_ENABLE_RULER 환경변수로 제어
  if (ruler) {
    editor.use(ruler)
  }
  if (transformFeedback) {
    editor.use(transformFeedback)
  }
  if (safeZoneWarning) {
    editor.use(safeZoneWarning)
  }
  editor.use(controls)
  editor.use(group)
  editor.use(history)
  editor.use(copy)
  editor.use(align)
  editor.use(drag)
  editor.use(pointerShiftGuard)
  editor.use(font)
  editor.use(filter)
  editor.use(effect)
  editor.use(smartCode)
  // ImageProcessingPlugin은 이미지 처리 기능이 활성화된 경우에만 등록
  if (image) {
    editor.use(image)
  }
  editor.use(material)
  editor.use(preview)
  editor.use(template)
  editor.use(service)

  workspace.init()

  // SpreadPlugin 초기화 (spread가 있을 때만)
  if (spread) {
    spread.init()
  }

  // 룰러는 사용자 토글 기반 — 시작 시 자동 enable 안 함
  // 토글은 EditorView가 useUiPrefStore.showRuler 변화에 반응해 ruler.enable()/disable() 호출

  // L4-①: printExclude 화면 전용 오버레이 훅 (after:render, contextTop 순수 드로잉 — 저장/PDF/썸네일 무오염)
  bindPrintExcludeOverlay(canvas)

  // C6 (E2): 모바일 터치 롱프레스 컨텍스트 메뉴 — coarse-pointer 환경에서만 활성(데스크탑 무영향).
  // editor.init 이후라 wrapperEl·contextMenu 확정. embed/EditorView/TemplateEditorView 모두 이
  // 단일 createCanvas 경유라 자동 적용. coarse 판정은 React 훅(useIsCoarsePointer) 대신 인라인
  // matchMedia — 여기는 비-React async 유틸.
  if (
    ENABLE_TOUCH_CONTEXT_MENU &&
    typeof window !== 'undefined' &&
    window.matchMedia?.('(pointer: coarse)').matches
  ) {
    editor.enableTouchContextMenu({ haptic: true })
  }

  // 앱 스토어에 등록 (initId 전달)
  appStore.init(canvas, editor, initId)
}

/**
 * 이전 버전과의 호환성을 위한 함수
 */
export const setupCanvas = async (options?: {
  customSettings?: Partial<CanvasSettings>
  page?: number
}): Promise<fabric.Canvas[] | fabric.Canvas> => {
  return !options?.page || options?.page === 1
    ? createCanvas(options?.customSettings)
    : createMultipleCanvas(options?.page || 1, options?.customSettings)
}
