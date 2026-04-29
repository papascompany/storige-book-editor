export const UNIT_CONVERSIONS = {
  MM_TO_INCH: 25.4,
  INCH_TO_MM: 1 / 25.4,
  DEFAULT_DPI: 150
} as const

// D3 ruler palette (Ps/Ai 스타일): 옅은 헤더 + 그레이 80% 눈금
// 기존 hardcoded 값(`#fff`, `#888`, `#ddd`, `#ff2d55`)을 정렬, 단일 소스화
export const RULER_DEFAULTS = {
  RULE_SIZE: 20,
  FONT_SIZE: 10,
  BACKGROUND_COLOR: '#FAFAFA',
  TEXT_COLOR: '#404040',
  BORDER_COLOR: '#E5E5E5',
  HIGHLIGHT_COLOR: '#ff2d55',
  TICK_COLOR: '#A3A3A3',
  MAJOR_TICK_COLOR: '#525252',
  UNIT: 'mm',
  DPI: UNIT_CONVERSIONS.DEFAULT_DPI
} as const

// DPI에 따른 적응형 눈금 간격 설정 (mm 단위)
export const DPI_ADAPTIVE_GAPS = {
  // 72 DPI에서는 더 넓은 간격 사용
  72: {
    ZOOMS: [0.1, 0.5, 1, 2, 4, 8],
    GAPS: [200, 100, 50, 25, 10, 5]
  },
  150: {
    ZOOMS: [0.1, 0.5, 1, 2, 5, 10],
    GAPS: [100, 50, 25, 10, 5, 2]
  },
  300: {
    ZOOMS: [0.1, 0.5, 1, 2, 5, 10],
    GAPS: [50, 25, 10, 5, 2, 1]
  }
} as const

export const ZOOM_GAPS = {
  ZOOMS: [0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 18],
  GAPS: [10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10]
} as const

export const MM_GAPS = {
  ZOOMS: [0.1, 0.5, 1, 2, 5, 10],
  GAPS: [200, 100, 50, 20, 10, 5]
} as const

export const RENDER_SETTINGS = {
  THROTTLE_DELAY: 8,
  DEBOUNCE_DELAY: 16,
  CACHE_SIZE: 50,
  MAX_TICKS_PER_RENDER: 100,
  MIN_TICK_SPACING: 5
} as const 