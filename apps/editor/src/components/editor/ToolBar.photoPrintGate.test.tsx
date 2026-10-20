// @vitest-environment happy-dom
//
// P2-d 사진인화 (2026-10-19): ToolBar PHOTO_PRINT 메뉴 게이트.
//  (1) photo-print 세트(productProfile kind=photo-print)에서만 '사진인화' 메뉴 노출
//  (2) NULL(legacy)·캘린더 세트는 enabledMenus 와 무관하게 숨김
//  (3) photo-print 세트도 enabledMenus 배열에 'PHOTO_PRINT' 가 없으면 숨김(화이트리스트 존중), null 이면 노출
//  (4) editMode(관리자)는 전체 노출(CALENDAR 와 같은 예외)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import type { EditorMenuKey, ProductProfile } from '@storige/types'
import ToolBar from './ToolBar'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'

const photoProfile: ProductProfile = {
  version: 1,
  kind: 'photo-print',
  editorType: 'photo_chem',
  pages: { kind: 'range', min: 1, max: 200, labelRule: 'photo' },
  sheet: { faces: 1, canvasLayout: 'canvas-per-sheet', binding: 'none', backRotation: 0, duplexFlip: 'short-edge' },
  photoPrint: {
    process: 'chemical',
    composition: 'per-photo-free-back',
    sizes: [{ code: '4x6', widthMm: 102, heightMm: 152, minDpi: 200 }],
    options: { border: ['none'], fit: ['paper-full'], finish: ['glossy'], brightnessFix: false, dateOverlay: false, grayscale: false },
    copies: { min: 1, max: 99 },
    upload: { maxPhotos: 200, maxMb: 25 },
  },
  output: { mode: 'single-pdf' },
}

const calendarProfile: ProductProfile = {
  version: 1,
  kind: 'calendar',
  editorType: 'calendar_desk',
  pages: { kind: 'fixed', count: 26, labelRule: 'month' },
  sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'top-ring', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
  calendar: {
    layout: 'desk', monthCount: 12, coverCanvases: 1, canvasesPerMonth: 2, epilogueCanvases: 1,
    allowedRange: { from: '2027-01', to: '2027-12' }, weekStart: 0,
    show: { holidays: true, lunar: false, solarTerms: false }, dataVersion: 'kr-2025-2035-v1',
  },
  output: { mode: 'single-pdf' },
}

function wire(opts: { profile: ProductProfile | null; enabledMenus?: EditorMenuKey[] | null; editMode?: boolean }) {
  act(() => {
    useAppStore.setState({ ready: false, canvas: null, allCanvas: [], currentMenu: null, activeSelection: [] } as never)
    useSettingsStore.getState().setProductProfile(opts.profile)
    useSettingsStore.setState((s) => ({
      enabledMenus: opts.enabledMenus ?? null,
      currentSettings: { ...s.currentSettings, editMode: opts.editMode ?? false },
    }))
  })
  render(<ToolBar />)
}

const photoPrintButton = () => screen.queryByTitle('사진인화')
const calendarButton = () => screen.queryByTitle('달력')

beforeEach(() => {
  act(() => {
    useSettingsStore.getState().setProductProfile(null)
    useSettingsStore.setState((s) => ({ enabledMenus: null, currentSettings: { ...s.currentSettings, editMode: false } }))
  })
})

afterEach(() => {
  cleanup()
})

describe('ToolBar — PHOTO_PRINT 메뉴 게이트 (P2-d 사진인화)', () => {
  it('photo-print 세트(enabledMenus null): 사진인화 노출, 달력 숨김', () => {
    wire({ profile: photoProfile })
    expect(photoPrintButton()).not.toBeNull()
    expect(calendarButton()).toBeNull()
    expect(screen.queryByTitle('이미지')).not.toBeNull()
  })

  it('NULL 프로파일(legacy): enabledMenus 에 PHOTO_PRINT 가 있어도 숨김', () => {
    wire({ profile: null, enabledMenus: ['IMAGE', 'TEXT', 'PHOTO_PRINT'] as EditorMenuKey[] })
    expect(photoPrintButton()).toBeNull()
    expect(screen.queryByTitle('이미지')).not.toBeNull()
  })

  it('캘린더 세트: 달력만 노출, 사진인화 숨김', () => {
    wire({ profile: calendarProfile })
    expect(calendarButton()).not.toBeNull()
    expect(photoPrintButton()).toBeNull()
  })

  it('photo-print 세트 + enabledMenus 화이트리스트에 PHOTO_PRINT 없음 → 숨김, 있으면 노출', () => {
    wire({ profile: photoProfile, enabledMenus: ['IMAGE', 'TEXT'] as EditorMenuKey[] })
    expect(photoPrintButton()).toBeNull()
    cleanup()
    wire({ profile: photoProfile, enabledMenus: ['IMAGE', 'PHOTO_PRINT'] as EditorMenuKey[] })
    expect(photoPrintButton()).not.toBeNull()
    expect(screen.queryByTitle('텍스트')).toBeNull()
  })

  it('editMode(관리자): 프로파일 NULL 이어도 전체 노출(사진인화 포함)', () => {
    wire({ profile: null, editMode: true })
    expect(photoPrintButton()).not.toBeNull()
    expect(calendarButton()).not.toBeNull()
  })
})
