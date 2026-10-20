// @vitest-environment happy-dom
//
// P2-d 사진인화 (2026-10-19, editor-flow-1): BookNavigation drag-to-reorder 는 kind 'photo-print' 세트에서 비활성.
//  - 항목(metadata.items)이 캔버스 위치(index×stride)에 묶여 있고 digital 은 2i/2i+1 앞·뒤 쌍이라 1장 단위 재정렬이
//    옵션·매수·sheet-map 짝을 깨뜨린다 → 썸네일 draggable=false·드래그 핸들러로 reorderByIndex 미호출.
//  - NULL 프로파일(legacy) 단일 모드는 종전대로 draggable=true(바이트 동일).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ProductProfile } from '@storige/types'

vi.mock('./PageThumbnail', () => ({
  PageThumbnail: (p: {
    label: string
    draggable?: boolean
    onDragStart?: (e: unknown) => void
    onDrop?: (e: unknown) => void
    onDragOver?: (e: unknown) => void
  }) => (
    <button
      type="button"
      data-testid="thumb"
      data-draggable={String(!!p.draggable)}
      onDragStart={p.onDragStart as never}
      onDragOver={p.onDragOver as never}
      onDrop={p.onDrop as never}
    >
      {p.label}
    </button>
  ),
}))
vi.mock('@/api', () => ({ templateSetsApi: { getTemplateSetWithTemplates: vi.fn(async () => ({ templateDetails: [] })) } }))
vi.mock('@/hooks/useResolvedPageNavPosition', () => ({ useResolvedPageNavPosition: () => 'bottom' as const }))
vi.mock('@/stores/useToastStore', () => ({ showToast: vi.fn() }))

import { BookNavigation } from './BookNavigation'
import { useAppStore } from '@/stores/useAppStore'
import { useEditorStore } from '@/stores/useEditorStore'
import { useSettingsStore } from '@/stores/useSettingsStore'

const photoProfile: ProductProfile = {
  version: 1,
  kind: 'photo-print',
  editorType: 'photo_digital_free',
  pages: { kind: 'range', min: 2, max: 40, step: 2, labelRule: 'photo' },
  sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'none', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
  photoPrint: {
    process: 'digital',
    composition: 'per-photo-free-back',
    sizes: [{ code: '4x6', widthMm: 102, heightMm: 152, minDpi: 200 }],
    options: { border: ['none'], fit: ['paper-full'], finish: ['matte'], brightnessFix: false, dateOverlay: false, grayscale: false },
    copies: { min: 1, max: 99 },
    upload: { maxPhotos: 20, maxMb: 25 },
  },
  output: { mode: 'sheet-map', sheetFiles: 'per-sheet' },
}

const reorderByIndex = vi.fn()

function wire(profile: ProductProfile | null, canvasCount: number) {
  const allCanvas = Array.from({ length: canvasCount }, (_, i) => ({ id: `c${i}`, on: vi.fn(), off: vi.fn(), getObjects: () => [] }))
  act(() => {
    useAppStore.setState({ allCanvas, isSpreadMode: false, setPage: vi.fn(), reorderByIndex } as never)
    useEditorStore.setState({
      pages: allCanvas.map((c) => ({ id: c.id, templateType: 'page' })),
      currentPageIndex: 0,
      goToPage: vi.fn(),
    } as never)
    useSettingsStore.getState().setProductProfile(profile)
  })
  render(
    <MemoryRouter>
      <BookNavigation orientation="horizontal" />
    </MemoryRouter>,
  )
}

const thumbs = () => screen.getAllByTestId('thumb')

beforeEach(() => {
  reorderByIndex.mockReset()
})

afterEach(() => {
  cleanup()
  act(() => {
    useAppStore.setState({ allCanvas: [], isSpreadMode: false } as never)
    useEditorStore.setState({ pages: [], currentPageIndex: 0 } as never)
    useSettingsStore.getState().setProductProfile(null)
  })
})

describe('BookNavigation — 사진인화 세트 순서 변경 비활성 (editor-flow-1)', () => {
  it('photo-print 4캔버스: 모든 썸네일 draggable=false, 라벨은 "사진 N 앞/뒤", drop 해도 reorderByIndex 미호출', () => {
    wire(photoProfile, 4)
    expect(thumbs().map((t) => t.getAttribute('data-draggable'))).toEqual(['false', 'false', 'false', 'false'])
    expect(thumbs().map((t) => t.textContent)).toEqual(['사진 1 앞', '사진 1 뒤', '사진 2 앞', '사진 2 뒤'])
    const data = { effectAllowed: '', dropEffect: '', setData: vi.fn() }
    fireEvent.dragStart(thumbs()[2], { dataTransfer: data })
    fireEvent.dragOver(thumbs()[0], { dataTransfer: data, clientX: 0, clientY: 0 })
    fireEvent.drop(thumbs()[0], { dataTransfer: data, clientX: 0, clientY: 0 })
    expect(reorderByIndex).not.toHaveBeenCalled()
  })

  it('NULL 프로파일(legacy) 4캔버스 단일 모드: 종전대로 draggable=true', () => {
    wire(null, 4)
    expect(thumbs().map((t) => t.getAttribute('data-draggable'))).toEqual(['true', 'true', 'true', 'true'])
    expect(thumbs().map((t) => t.textContent)).toEqual(['1쪽', '2쪽', '3쪽', '4쪽'])
  })
})
