import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { ProductProfile } from '@storige/types'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useCalendarStore } from '@/stores/useCalendarStore'
import {
  applyTemplateSetProductProfile,
  makeCalendarLabelResolver,
  resolveCanvasMonthOffset,
  resolveFixedCanvasCount, resolveProfilePdfRequestSize } from './productProfile'

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
