import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { ProductProfile } from '@storige/types'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useCalendarStore } from '@/stores/useCalendarStore'
import {
  applyTemplateSetProductProfile,
  makeCalendarLabelResolver,
  photoPrintCanvasStride,
  resolveCanvasMonthOffset,
  resolveFixedCanvasCount, resolveProfilePdfExportOptions, resolveProfilePdfRequestSize,
  resolvePhotoPrintPageStep,
  resolvePhotoPrintSeedCount,
  type PhotoPrintProductProfile,
} from './productProfile'

/**
 * P1 캘린더 (2026-10-17): 템플릿셋 productProfile → 스토어 배선·캔버스 월 매핑·라벨 resolver.
 * NULL 프로파일은 스토어를 legacy(null)로 되돌리고 모든 헬퍼가 null/undefined 를 돌려준다.
 */
function calendarProfile(layout: 'desk' | 'wall-2' = 'desk'): ProductProfile {
  return {
    version: 1,
    kind: 'calendar',
    editorType: 'calendar_desk',
    pages: { kind: 'fixed', count: 26, labelRule: 'month' },
    sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'top-ring', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
    calendar: {
      layout,
      monthCount: 12,
      coverCanvases: 1,
      canvasesPerMonth: 2,
      epilogueCanvases: 1,
      allowedRange: { from: '2027-01', to: '2027-12' },
      weekStart: 0,
      show: { holidays: true, lunar: true, solarTerms: false },
      dataVersion: 'kr-2025-2035-v1',
    },
    output: { mode: 'single-pdf' },
  }
}

beforeEach(() => {
  useSettingsStore.getState().setProductProfile(null)
  useCalendarStore.getState().reset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('applyTemplateSetProductProfile', () => {
  it('calendar 프로파일 세트 → settings.productProfile + calendar meta 채움', () => {
    const p = applyTemplateSetProductProfile({ productProfile: calendarProfile() })
    expect(p?.kind).toBe('calendar')
    expect(useSettingsStore.getState().productProfile?.kind).toBe('calendar')
    expect(useCalendarStore.getState().meta).toMatchObject({ startYear: 2027, startMonth: 1 })
  })

  it('productProfile 없음(legacy) → 둘 다 null 로 reset', () => {
    applyTemplateSetProductProfile({ productProfile: calendarProfile() })
    const p = applyTemplateSetProductProfile({})
    expect(p).toBeNull()
    expect(useSettingsStore.getState().productProfile).toBeNull()
    expect(useCalendarStore.getState().meta).toBeNull()
  })

  it('검증 실패 프로파일 → warn 1회 + legacy(null)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const p = applyTemplateSetProductProfile({ productProfile: { version: 1, kind: 'nope' } as unknown as ProductProfile })
    expect(p).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(useSettingsStore.getState().productProfile).toBeNull()
  })
})

describe('resolveFixedCanvasCount', () => {
  it('fixed 26 → 26, null → null', () => {
    expect(resolveFixedCanvasCount(calendarProfile())).toBe(26)
    expect(resolveFixedCanvasCount(null)).toBeNull()
  })

  it('range 프로파일 → null', () => {
    const range: ProductProfile = { ...calendarProfile(), pages: { kind: 'range', min: 2, max: 10, labelRule: 'default' } }
    expect(resolveFixedCanvasCount(range)).toBeNull()
  })
})

describe('resolveCanvasMonthOffset', () => {
  it('표지 0 → null, 1·2 → 0, 3·4 → 1, 23·24 → 11, 에필로그 25 → null, 범위 밖 26 → null', () => {
    const p = calendarProfile()
    expect(resolveCanvasMonthOffset(p, 0)).toBeNull()
    expect(resolveCanvasMonthOffset(p, 1)).toBe(0)
    expect(resolveCanvasMonthOffset(p, 2)).toBe(0)
    expect(resolveCanvasMonthOffset(p, 3)).toBe(1)
    expect(resolveCanvasMonthOffset(p, 24)).toBe(11)
    expect(resolveCanvasMonthOffset(p, 25)).toBeNull()
    expect(resolveCanvasMonthOffset(p, 26)).toBeNull()
  })

  it('null 프로파일 → null', () => {
    expect(resolveCanvasMonthOffset(null, 1)).toBeNull()
  })
})

describe('makeCalendarLabelResolver', () => {
  it('desk: 표지 / 2027년 1월 앞면 / 2027년 1월 뒷면 / … / 에필로그', () => {
    const r = makeCalendarLabelResolver(calendarProfile(), null)
    expect(r(0)).toBe('표지')
    expect(r(1)).toBe('2027년 1월 앞면')
    expect(r(2)).toBe('2027년 1월 뒷면')
    expect(r(24)).toBe('2027년 12월 뒷면')
    expect(r(25)).toBe('에필로그')
    expect(r(26)).toBeUndefined()
  })

  it('wall-2: 상단/하단 라벨', () => {
    const r = makeCalendarLabelResolver(calendarProfile('wall-2'), null)
    expect(r(1)).toBe('2027년 1월 상단')
    expect(r(2)).toBe('2027년 1월 하단')
  })

  it('세션 메타 시작연월(2027-03)을 우선한다', () => {
    const r = makeCalendarLabelResolver(calendarProfile(), { startYear: 2027, startMonth: 3 })
    expect(r(1)).toBe('2027년 3월 앞면')
    expect(r(21)).toBe('2028년 1월 앞면')
  })

  it('null 프로파일 → 항상 undefined', () => {
    const r = makeCalendarLabelResolver(null, null)
    expect(r(0)).toBeUndefined()
    expect(r(5)).toBeUndefined()
  })
})

describe('resolveProfilePdfRequestSize — 단일모드 PDF 요청 치수', () => {
  const tpl = { width: 265, height: 190 }
  const profile = { kind: 'calendar' } as unknown as import('@storige/types').ProductProfile
  it('호스트 size 가 있으면 그대로(프로파일 유무 무관 — 원본 보존 계약)', () => {
    expect(resolveProfilePdfRequestSize({ width: 190, height: 265 }, profile, tpl)).toEqual({ width: 190, height: 265 })
    expect(resolveProfilePdfRequestSize({ width: 100, height: 100 }, null, tpl)).toEqual({ width: 100, height: 100 })
  })
  it('호스트 size 없음 + 프로파일 세트 → 템플릿셋 판형(A4 폴백 대신 상품 판형)', () => {
    expect(resolveProfilePdfRequestSize(undefined, profile, tpl)).toEqual(tpl)
  })
  it('프로파일 NULL 세트는 undefined(종전 A4 폴백 유지)', () => {
    expect(resolveProfilePdfRequestSize(undefined, null, tpl)).toBeUndefined()
    expect(resolveProfilePdfRequestSize(null, undefined, tpl)).toBeUndefined()
  })
  it('프로파일 세트라도 템플릿셋 판형이 없으면 undefined', () => {
    expect(resolveProfilePdfRequestSize(undefined, profile, null)).toBeUndefined()
  })
})

describe('resolveProfilePdfExportOptions — 프로파일 세트 전용 PDF export 옵션', () => {
  const profile = { kind: 'calendar' } as unknown as import('@storige/types').ProductProfile
  it('프로파일 세트 → 세 옵션 모두 true(미사용 폰트 생략·워크스페이스 제외·transparent 치환)', () => {
    expect(resolveProfilePdfExportOptions(profile)).toEqual({
      omitUnusedFonts: true,
      excludeWorkspaceFromExport: true,
      neutralizeTransparentFills: true,
    })
  })
  it('프로파일 NULL 세트 → undefined(ServicePlugin 종전 경로·바이트 그대로)', () => {
    expect(resolveProfilePdfExportOptions(null)).toBeUndefined()
    expect(resolveProfilePdfExportOptions(undefined)).toBeUndefined()
  })
})

// ─── P2-d 사진인화 시드·단위 보정 (D1/D2/api-sheetmap-3, null-set-1/contract-7) ─────────────────────────────

function photoProfile(process: 'digital' | 'chemical', over: Partial<ProductProfile['pages']> = {}): PhotoPrintProductProfile {
  const digital = process === 'digital'
  return {
    version: 1,
    kind: 'photo-print',
    editorType: digital ? 'photo_digital_free' : 'photo_chem',
    pages: digital
      ? { kind: 'range', min: 2, max: 40, step: 2, labelRule: 'photo', ...over }
      : { kind: 'range', min: 1, max: 200, labelRule: 'photo', ...over },
    sheet: digital
      ? { faces: 2, canvasLayout: 'canvas-pair', binding: 'none', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' }
      : { faces: 1, canvasLayout: 'canvas-per-sheet', binding: 'none', backRotation: 0, duplexFlip: 'short-edge' },
    photoPrint: {
      process,
      composition: 'per-photo-free-back',
      sizes: [{ code: '4x6', widthMm: 102, heightMm: 152, minDpi: 200 }],
      options: { border: ['none'], fit: ['paper-full'], finish: ['matte'], brightnessFix: false, dateOverlay: false, grayscale: false },
      copies: { min: 1, max: 99 },
      upload: { maxPhotos: 20, maxMb: 25 },
    },
    output: digital ? { mode: 'sheet-map', sheetFiles: 'per-sheet' } : { mode: 'single-pdf' },
  } as PhotoPrintProductProfile
}

describe('resolvePhotoPrintSeedCount — range 세트 시드 캔버스 수', () => {
  it('D1 재오픈: 저장 canvasData 4장(restoredCanvasCount 4) → 4 (요청 pageCount 가 적어도·없어도 저장본이 하한, 호스트 한도 무관)', () => {
    const p = photoProfile('digital')
    expect(resolvePhotoPrintSeedCount(p, { restoredCanvasCount: 4, templateCanvasCount: 2 })).toEqual({ count: 4, truncated: 0 })
    expect(resolvePhotoPrintSeedCount(p, { requested: 3, restoredCanvasCount: 4, templateCanvasCount: 2 })).toEqual({ count: 4, truncated: 0 })
    expect(resolvePhotoPrintSeedCount(p, { requested: 6, restoredCanvasCount: 4, templateCanvasCount: 2 })).toEqual({ count: 6, truncated: 0 })
    // chemical 3장 저장 → 3
    expect(resolvePhotoPrintSeedCount(photoProfile('chemical'), { restoredCanvasCount: 3, templateCanvasCount: 1 })).toEqual({ count: 3, truncated: 0 })
  })

  it('D2 신규 세션 + 런처 items N건: digital N×2 / chemical N×1, 재오픈이면 items 는 무시(저장본 우선)', () => {
    expect(resolvePhotoPrintSeedCount(photoProfile('digital'), { itemCount: 2, templateCanvasCount: 2 })).toEqual({ count: 4, truncated: 0 })
    expect(resolvePhotoPrintSeedCount(photoProfile('digital'), { itemCount: 5, templateCanvasCount: 2 })).toEqual({ count: 10, truncated: 0 })
    expect(resolvePhotoPrintSeedCount(photoProfile('chemical'), { itemCount: 3, templateCanvasCount: 1 })).toEqual({ count: 3, truncated: 0 })
    expect(resolvePhotoPrintSeedCount(photoProfile('digital'), { itemCount: 5, restoredCanvasCount: 4, templateCanvasCount: 2 })).toEqual({ count: 4, truncated: 0 })
  })

  it('pages.max 클램프(초과분 truncated), refs 수 하한, 셋 다 없으면 null(종전 흐름)', () => {
    expect(resolvePhotoPrintSeedCount(photoProfile('digital', { max: 6 }), { itemCount: 5, templateCanvasCount: 2 })).toEqual({ count: 6, truncated: 4 })
    expect(resolvePhotoPrintSeedCount(photoProfile('digital', { max: 6 }), { restoredCanvasCount: 8, templateCanvasCount: 2 })).toEqual({ count: 6, truncated: 2 })
    expect(resolvePhotoPrintSeedCount(photoProfile('digital'), { requested: 1, templateCanvasCount: 2 })).toEqual({ count: 2, truncated: 0 })
    expect(resolvePhotoPrintSeedCount(photoProfile('digital'), { templateCanvasCount: 2 })).toBeNull()
    expect(resolvePhotoPrintSeedCount(photoProfile('digital'), { requested: 0, restoredCanvasCount: Number.NaN, itemCount: -1, templateCanvasCount: 2 })).toBeNull()
  })

  it('photoPrintCanvasStride: digital 2 / chemical 1', () => {
    expect(photoPrintCanvasStride(photoProfile('digital'))).toBe(2)
    expect(photoPrintCanvasStride(photoProfile('chemical'))).toBe(1)
  })
})

describe('resolvePhotoPrintPageStep — 프로파일 pages.step 우선, 호스트 pageStep 무시(api-sheetmap-3)', () => {
  it('사진인화 digital: 프로파일 step 2 가 템플릿셋 값보다 우선, 호스트 pageStep 4 는 warn 1회 뒤 무시', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolvePhotoPrintPageStep(photoProfile('digital'), 1, 4)).toEqual({ pageStep: 2, ignoreHostPageStep: true })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('호스트 pageStep 4 무시')
    // 호스트가 같은 값을 보내면 경고 없이 무시 플래그만
    warn.mockClear()
    expect(resolvePhotoPrintPageStep(photoProfile('digital'), undefined, 2)).toEqual({ pageStep: 2, ignoreHostPageStep: true })
    expect(warn).not.toHaveBeenCalled()
    // 호스트 pageStep 없음 → 무시할 것도 없음
    expect(resolvePhotoPrintPageStep(photoProfile('digital'), undefined, undefined)).toEqual({ pageStep: 2, ignoreHostPageStep: false })
  })

  it('사진인화 chemical(pages.step 없음): 템플릿셋 pageStep 폴백(null 이면 null)', () => {
    expect(resolvePhotoPrintPageStep(photoProfile('chemical'), null, undefined)).toEqual({ pageStep: null, ignoreHostPageStep: false })
    expect(resolvePhotoPrintPageStep(photoProfile('chemical'), 1, undefined)).toEqual({ pageStep: 1, ignoreHostPageStep: false })
  })

  it('null-set-1/contract-7: 캘린더·NULL 프로파일은 템플릿셋 값 그대로(null 유지)·호스트 무시 없음 — 프로파일 pages.step 폴백 없음', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const calendar: ProductProfile = { ...calendarProfile(), pages: { kind: 'fixed', count: 26, step: 2, labelRule: 'month' } }
    expect(resolvePhotoPrintPageStep(calendar, null, 4)).toEqual({ pageStep: null, ignoreHostPageStep: false })
    expect(resolvePhotoPrintPageStep(calendar, undefined, undefined)).toEqual({ pageStep: undefined, ignoreHostPageStep: false })
    expect(resolvePhotoPrintPageStep(null, null, 2)).toEqual({ pageStep: null, ignoreHostPageStep: false })
    expect(resolvePhotoPrintPageStep(undefined, 2, 4)).toEqual({ pageStep: 2, ignoreHostPageStep: false })
    expect(warn).not.toHaveBeenCalled()
  })
})
