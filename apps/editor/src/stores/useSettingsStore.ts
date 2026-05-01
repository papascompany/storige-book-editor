import { create } from 'zustand'
import {
  type CanvasSettings,
  type CanvasControls,
  mmToPx,
  pxToMm,
  mmToPxDisplay,
  pxToMmDisplay,
} from '@storige/canvas-core'
import type { EditorTemplate } from '@/generated/graphql'
import type { SpreadConfig } from '@storige/types'

// Types (will be replaced with GraphQL generated types later)
interface WowPressProductSize {
  sizeno?: number
  width?: number
  height?: number
  non_standard?: boolean
  req_width?: { min: number; max: number }
  req_height?: { min: number; max: number }
  [key: string]: unknown
}

export interface WowPressLinkedProduct {
  id: string
  title?: string | null
  template?: {
    editorPreset?: {
      settings: {
        dpi?: number
        guideline?: { cutLine?: boolean; safeLine?: boolean }
        page?: { count?: number; min?: number; max?: number; interval?: number }
        size?: { width?: number; height?: number; cutSize?: number; safeSize?: number }
        unit?: string
        exportOption?: { colorMode?: 'RGB' | 'CMYK' }
        menu?: unknown[]
      }
      defaultTemplate?: { id: string } | null
      editorTemplates?: EditorTemplate[] | null
    } | null
  } | null
  wowPressProduct?: {
    prodname?: string
    dlvygrpname?: string
    sizeinfo?: Array<{ sizelist: WowPressProductSize[] }>
    colorinfo?: Array<{ pagelist: unknown[] }>
  }
  editorTemplates?: EditorTemplate[] | null
  [key: string]: unknown
}

interface EditorDesign {
  id: string
  name?: string
  metadata?: {
    settings?: CanvasSettings
    sizeInfo?: WowPressProductSize
    [key: string]: unknown
  }
  [key: string]: unknown
}

// Editor use case types
export type EditorUseCase = 'empty' | 'content-edit' | 'product-based' | 'general'

export interface UseCaseConfig {
  useCase: EditorUseCase
  name: string
  description: string
  defaultSettings: Partial<CanvasSettings>
  requiredParams: string[]
  optionalParams: string[]
}

// 사용 케이스별 설정 인터페이스
export interface ProductBasedSetupConfig {
  product: WowPressLinkedProduct
  sizeno?: number
  work?: EditorDesign
  /**
   * 옵션 C: 외부 쇼핑몰의 동적 사이즈 override (mm).
   * `product.allowCustomSize === true` 인 경우에만 EditorView 가 전달.
   * 두 값 모두 양수일 때 templateSet/sizeno 의 사이즈 대신 사용.
   */
  customSize?: { width: number; height: number }
}

export interface ContentEditSetupConfig {
  contentId: string
  contentType: string
  workId?: string
  sizeInfo?: WowPressProductSize
}

export interface EmptyEditorSetupConfig {
  size?: {
    width: number
    height: number
    cutSize?: number
    safeSize?: number
    printSize?: { width: number; height: number }
  }
  unit?: 'mm' | 'px'
  name?: string
}

export interface GeneralSetupConfig {
  name?: string
  size?: {
    width: number
    height: number
    cutSize?: number
    safeSize?: number
    printSize?: { width: number; height: number }
  }
}

export type EditorRenderType =
  | 'bounded'
  | 'sticker'
  | 'noBounded'
  | 'mockup'
  | 'envelope'
  | 'reduced'

// Default controls configuration (light theme)
const defaultControls: CanvasControls = {
  transparentCorners: false,
  borderColor: 'rgba(39,99,138,0.66)',
  cornerColor: '#FFF',
  borderScaleFactor: 1,
  cornerStyle: 'rect',
  cornerStrokeColor: 'rgb(39 99 138)',
  borderOpacityWhenMoving: 0.8,
}

// 다크 모드 객체 선택 핸들 (editor_layout_custom.md §8.3 다크 모드 Phase 3).
// 어두운 surface 위 가독성: 브랜드 그린 보더 + 어두운 코너 + 같은 그린 코너 stroke.
export const defaultControlsDark: CanvasControls = {
  transparentCorners: false,
  borderColor: 'rgba(142, 207, 69, 0.7)',
  cornerColor: '#1f2937',
  borderScaleFactor: 1,
  cornerStyle: 'rect',
  cornerStrokeColor: 'rgb(142, 207, 69)',
  borderOpacityWhenMoving: 0.8,
}

export const defaultControlsLight: CanvasControls = defaultControls

export function getDefaultControls(theme: 'light' | 'dark'): CanvasControls {
  return theme === 'dark' ? defaultControlsDark : defaultControlsLight
}

// Use case configurations
export const USE_CASE_CONFIGS: Record<EditorUseCase, UseCaseConfig> = {
  empty: {
    useCase: 'empty',
    name: '빈 에디터',
    description: '자유 형식의 에디터 모드',
    defaultSettings: {
      editMode: true,
      showCutBorder: true,
      showSafeBorder: true,
      size: { width: 100, height: 100, cutSize: 5, safeSize: 5 },
      unit: 'mm',
      dpi: 150,
      colorMode: 'CMYK',
      page: { count: 1, min: 1, max: 99, interval: 1 },
    },
    requiredParams: ['editMode'],
    optionalParams: [],
  },
  'content-edit': {
    useCase: 'content-edit',
    name: '콘텐츠 편집',
    description: '기존 콘텐츠를 편집하는 모드',
    defaultSettings: {
      editMode: true,
      showCutBorder: false,
      showSafeBorder: false,
      unit: 'mm',
      dpi: 150,
      colorMode: 'CMYK',
      page: { count: 1, min: 1, max: 99, interval: 1 },
    },
    requiredParams: ['contentId', 'contentType'],
    optionalParams: ['workId'],
  },
  'product-based': {
    useCase: 'product-based',
    name: '제품 기반 에디터',
    description: '특정 제품을 기반으로 한 에디터',
    defaultSettings: {
      editMode: false,
      showCutBorder: true,
      showSafeBorder: true,
      unit: 'mm',
      dpi: 150,
      colorMode: 'CMYK',
    },
    requiredParams: ['productId'],
    optionalParams: ['size'],
  },
  general: {
    useCase: 'general',
    name: '일반 에디터',
    description: '기본 에디터 모드',
    defaultSettings: {
      editMode: false,
      showCutBorder: true,
      showSafeBorder: true,
      size: { width: 100, height: 100, cutSize: 5, safeSize: 5 },
      unit: 'mm',
      dpi: 150,
      colorMode: 'CMYK',
      page: { count: 1, min: 1, max: 1, interval: 1 },
    },
    requiredParams: [],
    optionalParams: [],
  },
}

// 책등 계산 설정 타입
export interface SpineConfig {
  paperType: string | null
  bindingType: string | null
  calculatedSpineWidth: number | null  // 계산된 책등 너비 (mm)
}

// Settings store state
interface SettingsState {
  currentSettings: CanvasSettings
  currentUseCase: EditorUseCase
  editorTemplates: EditorTemplate[]
  renderType: EditorRenderType
  spineConfig: SpineConfig  // 책등 계산 설정
  spreadConfig: SpreadConfig | null  // 스프레드 편집 설정 (null이면 비-스프레드 모드)
  artwork: {
    name: string
    product: WowPressLinkedProduct | null
    sizeInfo: WowPressProductSize | null
    work: EditorDesign | null
    sizeno: number | null
    content: { id: string | null; type: string | null }
  }
}

// Settings store actions
interface SettingsActions {
  // Settings management
  updateSettings: (settings: Partial<CanvasSettings>) => Promise<void>
  setShowCutBorder: (value: boolean) => void
  setShowSafeBorder: (value: boolean) => void

  // Use case management
  initializeUseCase: (useCase: EditorUseCase, params?: Record<string, unknown>) => Promise<void>
  switchUseCase: (useCase: EditorUseCase, params?: Record<string, unknown>) => Promise<void>
  getUseCaseFromParams: (params: Record<string, unknown>) => EditorUseCase

  // Setup functions
  setup: (
    product?: WowPressLinkedProduct,
    sizeno?: number,
    work?: EditorDesign,
    content?: { id: string; type: string },
    sizeInfo?: WowPressProductSize
  ) => void
  setupProductBased: (config: ProductBasedSetupConfig) => Promise<void>
  setupContentEdit: (config: ContentEditSetupConfig) => Promise<void>
  setupEmptyEditor: (config?: EmptyEditorSetupConfig) => Promise<void>
  setupGeneral: (config?: GeneralSetupConfig) => Promise<void>

  // Artwork management
  updateArtwork: (
    setting: { name: string; sizeno: string },
    content?: { id: string; type: string },
    work?: Partial<EditorDesign>,
    sizeInfo?: WowPressProductSize
  ) => void
  updateArtworkForProduct: (product: WowPressLinkedProduct, sizeno?: number, work?: EditorDesign) => void
  updateArtworkForContent: (contentId: string, contentType: string, workId?: string) => void
  updateArtworkForEmpty: (name?: string) => void

  // Conversion utilities
  pxSize: (size: number) => number
  mmSize: (size: number) => number
  pixelToMM: (px: number) => number
  mmToPixel: (mm: number) => number
  pxSizeDisplay: (size: number) => number
  mmSizeDisplay: (size: number) => number
  pixelToMMDisplay: (px: number) => number
  mmToPixelDisplay: (mm: number) => number
  getEffectiveValue: (value: number) => number
  showAsVisibleUnit: (value: number, isPixelValue?: boolean) => number

  // 작업명 (artwork.name) 단순 setter — 헤더 input 동기화용
  setArtworkName: (name: string) => void

  // Editor templates management
  setEditorTemplates: (templates: EditorTemplate[]) => void

  // 책등 계산 설정 관리
  setSpineConfig: (config: Partial<SpineConfig>) => void
  getSpineConfig: () => SpineConfig

  // 스프레드 편집 설정 관리
  setSpreadConfig: (config: SpreadConfig | null) => void
  updateSpreadSpineWidth: (newWidthMm: number) => void
}

// Initial state
const initialState: SettingsState = {
  currentSettings: {
    unit: 'mm',
    visibleUnit: undefined,
    colorMode: 'CMYK',
    dpi: 150,
    size: { width: 100, height: 100, cutSize: 5, safeSize: 5 },
    showCutBorder: true,
    showSafeBorder: true,
    controls: defaultControls,
    editMode: false,
    page: { count: 1, min: 1, max: 1, interval: 1 },
    reduced: false,
  },
  currentUseCase: 'general',
  editorTemplates: [],
  renderType: 'bounded',
  spineConfig: {
    paperType: null,
    bindingType: null,
    calculatedSpineWidth: null,
  },
  spreadConfig: null,
  artwork: {
    name: '나의 새로운 작업',
    product: null,
    sizeInfo: null,
    work: null,
    sizeno: null,
    content: { id: null, type: null },
  },
}

export const useSettingsStore = create<SettingsState & SettingsActions>()((set, get) => ({
  ...initialState,

  // Settings management
  updateSettings: async (settings) => {
    const { currentSettings } = get()

    set({
      currentSettings: {
        ...currentSettings,
        ...settings,
        size: {
          ...currentSettings.size,
          ...settings.size,
        },
        controls: {
          ...currentSettings.controls,
          ...settings.controls,
        },
      },
    })
  },

  setShowCutBorder: (value) => {
    set((state) => ({
      currentSettings: { ...state.currentSettings, showCutBorder: value },
    }))
  },

  setShowSafeBorder: (value) => {
    set((state) => ({
      currentSettings: { ...state.currentSettings, showSafeBorder: value },
    }))
  },

  // Use case management
  initializeUseCase: async (useCase, params) => {
    console.log(`[SettingsStore] Initializing use case: ${useCase}`, params)

    const config = USE_CASE_CONFIGS[useCase]

    set({ currentUseCase: useCase })

    await get().updateSettings({
      ...config.defaultSettings,
      controls: defaultControls,
    })
  },

  switchUseCase: async (useCase, params) => {
    console.log(`[SettingsStore] Switching to ${useCase}`)
    await get().initializeUseCase(useCase, params)
  },

  getUseCaseFromParams: (params) => {
    if (params.editMode && !params.contentId && !params.productId) {
      return 'empty'
    }
    if (params.contentId && params.contentType) {
      return 'content-edit'
    }
    if (params.productId) {
      return 'product-based'
    }
    return 'general'
  },

  // Setup functions
  setup: (product, sizeno, work, content, sizeInfo) => {
    console.log('[SettingsStore] setup start', { product, sizeno, work, content, sizeInfo })

    const { currentSettings, artwork } = get()

    const newArtwork = { ...artwork }

    if (work) {
      newArtwork.work = work
      newArtwork.name = work?.name || (product?.title ? product.title + ' 작업' : '작업')
    }
    if (content) {
      newArtwork.content = content
    }
    if (product) {
      newArtwork.product = product
      newArtwork.name = work?.name || (product?.title ? product.title + ' 작업' : '작업')
    }

    // Get size info
    const allSizes = product?.wowPressProduct?.sizeinfo?.flatMap(e => e.sizelist) || []
    const foundSizeInfo = sizeno
      ? allSizes.find((e) => e.sizeno === sizeno) || allSizes[0] || null
      : allSizes[0] || null

    newArtwork.sizeInfo = sizeInfo ||
      (work?.metadata?.sizeInfo as WowPressProductSize) ||
      foundSizeInfo
    newArtwork.sizeno = sizeno || null

    // Apply preset settings if product has template
    if (product?.template?.editorPreset) {
      const { settings: presetSettings } = product.template.editorPreset
      const { dpi, guideline, page, size: presetSize, unit } = presetSettings

      let width = 50
      let height = 50

      if (newArtwork.sizeInfo) {
        if (newArtwork.sizeInfo.non_standard) {
          width = Math.round(((newArtwork.sizeInfo.req_width?.min || 0) + (newArtwork.sizeInfo.req_width?.max || 0)) / 2)
          height = Math.round(((newArtwork.sizeInfo.req_height?.min || 0) + (newArtwork.sizeInfo.req_height?.max || 0)) / 2)
        } else {
          width = newArtwork.sizeInfo.width || presetSize?.width || 50
          height = newArtwork.sizeInfo.height || presetSize?.height || 50
        }
      }

      const unitValue = unit?.toString().toLowerCase()
      const safeUnit: 'mm' | 'px' = unitValue === 'mm' || unitValue === 'px' ? unitValue : 'mm'

      set({
        artwork: newArtwork,
        currentSettings: {
          ...currentSettings,
          dpi: dpi || 150,
          colorMode: presetSettings.exportOption?.colorMode || 'CMYK',
          unit: safeUnit,
          size: {
            width,
            height,
            cutSize: presetSize?.cutSize ?? 2,
            safeSize: presetSize?.safeSize ?? 3,
          },
          showCutBorder: guideline?.cutLine ?? true,
          showSafeBorder: guideline?.safeLine ?? true,
          page: {
            count: page?.count ?? 1,
            min: page?.min ?? 1,
            max: page?.max ?? 1,
            interval: page?.interval ?? 1,
          },
        },
      })
    } else if (work?.metadata?.settings) {
      set({
        artwork: newArtwork,
        currentSettings: work.metadata.settings as CanvasSettings,
      })
    } else {
      set({ artwork: newArtwork })
    }

    console.log('setup done')
  },

  setupProductBased: async (config) => {
    console.log('[SettingsStore] setupProductBased called with config:', config)
    if (!config.product) {
      console.error('[SettingsStore] setupProductBased: product is missing!')
      return
    }
    console.log('[SettingsStore] Calling setup() with product:', config.product.title || config.product.id)
    get().setup(config.product, config.sizeno, config.work)
    set({ currentUseCase: 'product-based' })

    // 옵션 C: customSize 가 있으면 setup() 의 sizeno 기반 결과를 덮어쓰기
    // (templateSet 의 사이즈를 무시하고 외부 쇼핑몰의 동적 사이즈 사용)
    if (config.customSize) {
      const { width, height } = config.customSize
      const { currentSettings } = get()
      set({
        currentSettings: {
          ...currentSettings,
          size: {
            ...currentSettings.size,
            width,
            height,
          },
        },
      })
      console.log('[SettingsStore] Applied customSize override:', { width, height })
    }

    console.log('[SettingsStore] setupProductBased completed')
  },

  setupContentEdit: async (config) => {
    console.log('[SettingsStore] Setting up content editor', config)
    await get().updateSettings(USE_CASE_CONFIGS['content-edit'].defaultSettings)
    get().updateArtworkForContent(config.contentId, config.contentType, config.workId)
    set({ currentUseCase: 'content-edit' })
  },

  setupEmptyEditor: async (config) => {
    console.log('[SettingsStore] Setting up empty editor', config)

    const defaultConfig = USE_CASE_CONFIGS['empty'].defaultSettings

    const mergedSize = config?.size ? {
      width: config.size.width ?? defaultConfig.size?.width ?? 100,
      height: config.size.height ?? defaultConfig.size?.height ?? 100,
      cutSize: config.size.cutSize ?? defaultConfig.size?.cutSize ?? 0,
      safeSize: config.size.safeSize ?? defaultConfig.size?.safeSize,
      printSize: config.size.printSize ?? defaultConfig.size?.printSize,
    } : defaultConfig.size

    await get().updateSettings({
      ...defaultConfig,
      size: mergedSize,
      unit: config?.unit || defaultConfig.unit,
    })

    get().updateArtworkForEmpty(config?.name)
    set({ currentUseCase: 'empty' })
  },

  setupGeneral: async (config) => {
    console.log('[SettingsStore] Setting up general editor', config)

    const defaultConfig = USE_CASE_CONFIGS['general'].defaultSettings

    const mergedSize = config?.size ? {
      width: config.size.width ?? defaultConfig.size?.width ?? 100,
      height: config.size.height ?? defaultConfig.size?.height ?? 100,
      cutSize: config.size.cutSize ?? defaultConfig.size?.cutSize ?? 0,
      safeSize: config.size.safeSize ?? defaultConfig.size?.safeSize,
      printSize: config.size.printSize ?? defaultConfig.size?.printSize,
    } : defaultConfig.size

    await get().updateSettings({
      ...defaultConfig,
      size: mergedSize,
    })

    set({
      currentUseCase: 'general',
      artwork: {
        name: config?.name || '일반 작업',
        product: null,
        sizeInfo: null,
        work: null,
        sizeno: null,
        content: { id: null, type: null },
      },
    })
  },

  // Artwork management
  updateArtwork: (setting, content, work, sizeInfo) => {
    const { artwork } = get()
    const allSizes = artwork.product?.wowPressProduct?.sizeinfo?.flatMap(e => e.sizelist) || []

    const sizenoNum = parseInt(setting.sizeno, 10)

    set({
      artwork: {
        ...artwork,
        name: setting.name,
        content: content || artwork.content,
        work: (work && work.id) ? work as EditorDesign : artwork.work,
        sizeno: sizenoNum,
        sizeInfo: sizeInfo || allSizes.find((e) => e.sizeno === sizenoNum) || null,
      },
    })
  },

  updateArtworkForProduct: (product, sizeno, work) => {
    const { artwork } = get()
    const allSizes = product?.wowPressProduct?.sizeinfo?.flatMap(e => e.sizelist) || []

    set({
      artwork: {
        ...artwork,
        product,
        sizeno: sizeno || null,
        work: work || null,
        name: work?.name || `${product.title} 작업`,
        sizeInfo: sizeno ? allSizes.find((e) => e.sizeno === sizeno) || null : null,
      },
    })
  },

  updateArtworkForContent: (contentId, contentType, workId) => {
    set({
      artwork: {
        name: `${contentType} 편집`,
        product: null,
        sizeInfo: null,
        work: workId ? { id: workId } as EditorDesign : null,
        sizeno: null,
        content: { id: contentId, type: contentType },
      },
    })
  },

  updateArtworkForEmpty: (name) => {
    set({
      artwork: {
        name: name || '새로운 작업',
        product: null,
        sizeInfo: null,
        work: null,
        sizeno: null,
        content: { id: null, type: null },
      },
    })
  },

  // Conversion utilities
  pxSize: (size) => {
    const { currentSettings } = get()
    return currentSettings.unit === 'mm' ? mmToPx(size, currentSettings.dpi) : size
  },

  mmSize: (size) => {
    const { currentSettings } = get()
    return currentSettings.unit === 'mm' ? size : pxToMm(size, currentSettings.dpi)
  },

  pixelToMM: (px) => {
    const { currentSettings } = get()
    return pxToMm(px, currentSettings.dpi)
  },

  mmToPixel: (mm) => {
    const { currentSettings } = get()
    return mmToPx(mm, currentSettings.dpi)
  },

  pxSizeDisplay: (size) => {
    const { currentSettings } = get()
    return currentSettings.unit === 'mm' ? mmToPxDisplay(size) : size
  },

  mmSizeDisplay: (size) => {
    const { currentSettings } = get()
    return currentSettings.unit === 'mm' ? size : pxToMmDisplay(size)
  },

  pixelToMMDisplay: (px) => pxToMmDisplay(px),

  mmToPixelDisplay: (mm) => mmToPxDisplay(mm),

  getEffectiveValue: (value) => {
    const { currentSettings } = get()
    const unit = currentSettings.visibleUnit ?? currentSettings.unit
    return unit === 'mm' ? mmToPxDisplay(value) : value
  },

  showAsVisibleUnit: (value, isPixelValue = true) => {
    const { currentSettings } = get()
    const isMM = (currentSettings.visibleUnit ?? currentSettings.unit) === 'mm'
    return isMM
      ? isPixelValue ? pxToMmDisplay(value) : value
      : isPixelValue ? value : mmToPxDisplay(value)
  },

  setArtworkName: (name) => {
    set((state) => ({
      artwork: { ...state.artwork, name },
    }))
  },

  setEditorTemplates: (templates) => {
    set({ editorTemplates: templates })
  },

  // 책등 계산 설정 관리
  setSpineConfig: (config) => {
    const { spineConfig } = get()
    set({
      spineConfig: {
        ...spineConfig,
        ...config,
      },
    })
  },

  getSpineConfig: () => {
    return get().spineConfig
  },

  // 스프레드 편집 설정 관리
  setSpreadConfig: (config) => {
    set({ spreadConfig: config })
  },

  updateSpreadSpineWidth: (newWidthMm) => {
    const { spreadConfig } = get()
    if (!spreadConfig) return

    // SpreadConfig의 spec.spineWidthMm 업데이트
    set({
      spreadConfig: {
        ...spreadConfig,
        spec: {
          ...spreadConfig.spec,
          spineWidthMm: newWidthMm,
        },
      },
    })
  },
}))

// Selector hooks for computed values
export const useEditMode = () => useSettingsStore((state) => state.currentSettings.editMode)
export const useUnit = () => useSettingsStore((state) => state.currentSettings.visibleUnit ?? state.currentSettings.unit)
export const useDpi = () => useSettingsStore((state) => state.currentSettings.dpi)
export const useColorMode = () => useSettingsStore((state) => state.currentSettings.colorMode)
export const useSize = () => useSettingsStore((state) => state.currentSettings.size)

export const useEffectiveSize = () => useSettingsStore((state) => {
  const { unit, size } = state.currentSettings
  if (unit === 'mm') {
    return {
      width: mmToPxDisplay(size.width + size.cutSize),
      height: mmToPxDisplay(size.height + size.cutSize),
    }
  }
  return {
    width: size.width + size.cutSize,
    height: size.height + size.cutSize,
  }
})

// Additional selectors for tool panels
export const useSettingsSize = () => useSettingsStore((state) => state.currentSettings.size)
export const useSettingsUnit = () => useSettingsStore((state) => state.currentSettings.unit)
export const useShowCutBorder = () => useSettingsStore((state) => state.currentSettings.showCutBorder)
export const useShowSafeBorder = () => useSettingsStore((state) => state.currentSettings.showSafeBorder)
export const useEditorTemplates = () => useSettingsStore((state) => state.editorTemplates)
export const useSpineConfig = () => useSettingsStore((state) => state.spineConfig)

export const useRenderType = (): EditorRenderType => {
  const { currentSettings, artwork } = useSettingsStore.getState()

  const category = currentSettings.category
  if (category) {
    if (category.includes('스티커')) return 'sticker'
    if (category.includes('어패럴') || category.includes('텀블러') || category.includes('에코백')) return 'noBounded'
    if (category.includes('폰케이스') || category.includes('케이스')) return 'mockup'
    if (category.includes('칼라봉투')) return 'envelope'
    if (category.includes('현수막')) return 'reduced'
    return 'bounded'
  }

  if (artwork.product) {
    const productName = (artwork.product.wowPressProduct?.prodname || '') + ' ' + (artwork.product.wowPressProduct?.dlvygrpname || '')
    if (productName.includes('스티커')) return 'sticker'
    if (productName.includes('어패럴') || productName.includes('티셔츠') || productName.includes('텀블러') || productName.includes('에코백')) return 'noBounded'
    if (productName.includes('폰케이스') || productName.includes('케이스')) return 'mockup'
    if (productName.includes('칼라봉투')) return 'envelope'
    if (productName.includes('현수막')) return 'reduced'
    return 'bounded'
  }

  return 'bounded'
}
