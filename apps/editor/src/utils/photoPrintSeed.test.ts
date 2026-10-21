import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProductProfile } from '@storige/types'

const applyObjectPermissions = vi.fn()
const rebindFrameInteractivity = vi.fn()
const trackRequiredEdits = vi.fn()
const rehydratePhotoPrint = vi.fn(async () => 0)
vi.mock('@/utils/objectPermissions', () => ({ applyObjectPermissions: (...a: unknown[]) => applyObjectPermissions(...(a as [])) }))
vi.mock('@/utils/requiredEditGate', () => ({ trackRequiredEdits: (...a: unknown[]) => trackRequiredEdits(...(a as [])) }))
vi.mock('@/utils/frameInteractive', () => ({ rebindFrameInteractivity: (...a: unknown[]) => rebindFrameInteractivity(...(a as [])) }))
vi.mock('@/utils/photoPrintRehydrate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/photoPrintRehydrate')>()
  return { ...actual, rehydratePhotoPrint: (...a: unknown[]) => rehydratePhotoPrint(...(a as [])) }
})

import { mmToPxDisplay } from '@storige/canvas-core'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { initPhotoPrintSeededCanvas, lockSeededObjects, seedPhotoPrintCanvas } from './photoPrintSeed'

/**
 * P2-d 사진인화 (2026-10-19): 페이지 추가 시 캔버스 k 를 refs[k % refs.length] 로 시드(digital [앞, 뒤]) +
 * composition 'per-photo-fixed-back' 의 뒷면(홀수 캔버스)은 로드 객체 잠금.
 * editor-flow-7/D6: 시드 캔버스는 초기 페이지와 같은 초기화 — applyObjectPermissions(canvas, editMode)·trackRequiredEdits 를
 * 항상 적용하고, editMode(관리자)에서는 잠그지 않는다.
 */
function profile(composition: 'per-photo-free-back' | 'per-photo-fixed-back'): ProductProfile {
  return {
    version: 1,
    kind: 'photo-print',
    editorType: 'photo_digital',
    pages: { kind: 'range', min: 2, max: 40, step: 2, labelRule: 'photo' },
    sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'none', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
    photoPrint: {
      process: 'digital',
      composition,
      sizes: [{ code: '4x6', widthMm: 102, heightMm: 152, minDpi: 200 }],
      options: { border: ['none'], fit: ['paper-full'], finish: ['matte'], brightnessFix: false, dateOverlay: false, grayscale: false },
      copies: { min: 1, max: 99 },
      upload: { maxPhotos: 10, maxMb: 25 },
      ...(composition === 'per-photo-fixed-back' ? { backTemplateId: 't-back' } : {}),
    },
    output: { mode: 'sheet-map', sheetFiles: 'per-sheet' },
  }
}

interface FakeObj {
  id?: string
  type?: string
  width?: number
  height?: number
  preventAutoResize?: boolean
  props: Record<string, unknown>
  set: (p: Record<string, unknown>) => void
  setCoords: () => void
  dirty?: boolean
}

function obj(id: string, extra: Partial<FakeObj> = {}): FakeObj {
  const o: FakeObj = {
    id,
    type: 'rect',
    width: 100,
    height: 50,
    props: {},
    set(p) { Object.assign(this.props, p); Object.assign(this, p) },
    setCoords: vi.fn(),
    ...extra,
  }
  return o
}

function wire(opts: { profile: ProductProfile | null; canvasCount: number; refs?: Array<{ id: string; canvasData: { objects?: unknown[] } | null }> }) {
  const loadJSON = vi.fn((data: unknown, cb?: () => void) => { if (cb) cb() })
  const objects = [obj('workspace'), obj('template-background', { width: 200, height: 100 }), obj('frame-1', { type: 'image' }), obj('text-1', { type: 'textbox' })]
  const canvas = { id: 'cv', getObjects: () => objects, requestRenderAll: vi.fn() }
  const editor = { getPlugin: (name: string) => (name === 'ServicePlugin' ? { loadJSON } : undefined) }
  const allCanvas = Array.from({ length: opts.canvasCount }, (_, i) => (i === opts.canvasCount - 1 ? canvas : { id: `c${i}`, getObjects: () => [] }))
  const allEditors = allCanvas.map(() => editor)
  useAppStore.setState({ allCanvas, allEditors } as never)
  useSettingsStore.getState().setProductProfile(opts.profile)
  useSettingsStore.getState().setLinkedPrintTemplates(
    opts.refs ?? [
      { id: 't-front', canvasData: { objects: [{ id: 'workspace' }, { id: 'f-front' }] } },
      { id: 't-back', canvasData: { objects: [{ id: 'workspace' }, { id: 'f-back' }] } },
    ],
  )
  useSettingsStore.setState((s) => ({ currentSettings: { ...s.currentSettings, size: { width: 102, height: 152, cutSize: 6, safeSize: 0 } } }))
  return { loadJSON, objects, canvas }
}

beforeEach(() => {
  applyObjectPermissions.mockReset()
  rebindFrameInteractivity.mockReset()
  trackRequiredEdits.mockReset()
  rehydratePhotoPrint.mockReset()
  rehydratePhotoPrint.mockResolvedValue(0)
  useSettingsStore.getState().setProductProfile(null)
  useSettingsStore.getState().setLinkedPrintTemplates([])
  useSettingsStore.setState((s) => ({ currentSettings: { ...s.currentSettings, editMode: false } }))
})

describe('seedPhotoPrintCanvas', () => {
  it('NULL 프로파일·refs 없음·캔버스 없음 → false, loadJSON 미호출', async () => {
    const { loadJSON } = wire({ profile: null, canvasCount: 2 })
    expect(await seedPhotoPrintCanvas(1)).toBe(false)
    wire({ profile: profile('per-photo-free-back'), canvasCount: 2, refs: [] })
    expect(await seedPhotoPrintCanvas(1)).toBe(false)
    wire({ profile: profile('per-photo-free-back'), canvasCount: 2 })
    expect(await seedPhotoPrintCanvas(5)).toBe(false)
    expect(loadJSON).not.toHaveBeenCalled()
  })

  it('캔버스 3(digital 뒷면) → refs[1] 로드 + workspace 치수 보정(trim+cutSize) + 재바인딩 + 초기 페이지와 같은 보호/필수편집 추적 + rehydrate; 자유 뒷면은 잠금 플래그 없음', async () => {
    const { loadJSON, objects, canvas } = wire({ profile: profile('per-photo-free-back'), canvasCount: 4 })
    expect(await seedPhotoPrintCanvas(3)).toBe(true)
    expect(loadJSON).toHaveBeenCalledTimes(1)
    expect((loadJSON.mock.calls[0] as unknown[])[0]).toEqual({ objects: [{ id: 'workspace' }, { id: 'f-back' }] })
    const ws = objects[0]
    expect(ws.props).toEqual({ width: mmToPxDisplay(108), height: mmToPxDisplay(158), scaleX: 1, scaleY: 1 })
    const bg = objects[1]
    expect(bg.props).toEqual({ scaleX: mmToPxDisplay(108) / 200, scaleY: mmToPxDisplay(158) / 100 })
    expect(objects[2].props).toEqual({})
    // editor-flow-7: 비잠금 시드 캔버스도 초기 페이지와 같은 applyObjectPermissions(고객 세션 = editMode false)·trackRequiredEdits
    expect(applyObjectPermissions).toHaveBeenCalledTimes(1)
    expect(applyObjectPermissions).toHaveBeenCalledWith(canvas, false)
    expect(trackRequiredEdits).toHaveBeenCalledWith(canvas)
    expect(rebindFrameInteractivity).toHaveBeenCalledTimes(1)
    expect(rehydratePhotoPrint).toHaveBeenCalledWith(expect.anything(), canvas, 3)
    expect(canvas.requestRenderAll).toHaveBeenCalled()
  })

  it('D6: editMode(관리자) 에서는 applyObjectPermissions(canvas, true) — 고정 뒷면 잠금 플래그는 기록하되 편집은 잠그지 않는다', async () => {
    useSettingsStore.setState((s) => ({ currentSettings: { ...s.currentSettings, editMode: true } }))
    const { objects, canvas } = wire({ profile: profile('per-photo-fixed-back'), canvasCount: 2 })
    expect(await seedPhotoPrintCanvas(1)).toBe(true)
    expect(objects[1].props).toMatchObject({ movable: false, deleteable: false, contentEditable: false })
    expect(applyObjectPermissions).toHaveBeenCalledWith(canvas, true)
    expect(applyObjectPermissions).not.toHaveBeenCalledWith(canvas, false)
    expect(trackRequiredEdits).toHaveBeenCalledWith(canvas)
  })

  it('캔버스 2(앞면) → refs[0]; 캔버스 4 → refs[0](k % refs.length)', async () => {
    const a = wire({ profile: profile('per-photo-fixed-back'), canvasCount: 3 })
    expect(await seedPhotoPrintCanvas(2)).toBe(true)
    expect((a.loadJSON.mock.calls[0] as unknown[])[0]).toEqual({ objects: [{ id: 'workspace' }, { id: 'f-front' }] })
    // 앞면은 잠금 플래그 없이(objects 불변) 초기 페이지와 같은 보호만
    expect(a.objects[2].props).toEqual({})
    expect(applyObjectPermissions).toHaveBeenCalledWith(a.canvas, false)
    const b = wire({ profile: profile('per-photo-fixed-back'), canvasCount: 5 })
    expect(await seedPhotoPrintCanvas(4)).toBe(true)
    expect((b.loadJSON.mock.calls[0] as unknown[])[0]).toEqual({ objects: [{ id: 'workspace' }, { id: 'f-front' }] })
  })

  it("composition 'per-photo-fixed-back' 의 뒷면: workspace 제외 전 객체에 movable/deleteable/contentEditable=false + applyObjectPermissions(canvas,false)", async () => {
    const { objects, canvas } = wire({ profile: profile('per-photo-fixed-back'), canvasCount: 2 })
    expect(await seedPhotoPrintCanvas(1)).toBe(true)
    expect(objects[0].props).not.toHaveProperty('movable')
    for (const o of objects.slice(1)) {
      expect(o.props).toMatchObject({ movable: false, deleteable: false, contentEditable: false })
    }
    expect(applyObjectPermissions).toHaveBeenCalledWith(canvas, false)
  })

  it('템플릿 canvasData 에 workspace 외 객체가 없으면 false(빈 캔버스 유지), 문자열 JSON 은 파싱', async () => {
    const empty = wire({
      profile: profile('per-photo-free-back'),
      canvasCount: 2,
      refs: [{ id: 't', canvasData: { objects: [{ id: 'workspace' }] } }],
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await seedPhotoPrintCanvas(1)).toBe(false)
    expect(empty.loadJSON).not.toHaveBeenCalled()
    warn.mockRestore()

    const str = wire({
      profile: profile('per-photo-free-back'),
      canvasCount: 2,
      refs: [{ id: 't', canvasData: JSON.stringify({ objects: [{ id: 'x' }] }) as unknown as { objects: unknown[] } }],
    })
    expect(await seedPhotoPrintCanvas(1)).toBe(true)
    expect((str.loadJSON.mock.calls[0] as unknown[])[0]).toEqual({ objects: [{ id: 'x' }] })
  })
})

describe('lockSeededObjects', () => {
  it('workspace 를 제외한 객체 수를 돌려준다', () => {
    const objects = [obj('workspace'), obj('a'), obj('b')]
    const canvas = { getObjects: () => objects }
    expect(lockSeededObjects(canvas as never)).toBe(2)
    expect(objects[0].props).toEqual({})
    expect(objects[1].props).toEqual({ movable: false, deleteable: false, contentEditable: false })
  })
})

describe('initPhotoPrintSeededCanvas (D11, 2026-10-21)', () => {
  // 템플릿셋 초기 로드(useEditorContents 2번째 이후 페이지)와 페이지 추가 시드가 공유하는 초기화 —
  // 초기 뒷면 textbox 가 TemplatePlugin.afterLoad 뒤 hasControls true·editable true 로 남던 결함의 수정 지점.
  const editor = { getPlugin: () => undefined } as never
  function canvasWith(objects: FakeObj[]) {
    return { id: 'cv', getObjects: () => objects, requestRenderAll: vi.fn() }
  }

  it("② 고정 뒷면(digital 홀수 캔버스): 잠금 플래그 강제 + 재바인딩 + applyObjectPermissions(canvas, editMode) + trackRequiredEdits", () => {
    const objects = [obj('workspace'), obj('logo'), obj('text-1', { type: 'textbox' })]
    const canvas = canvasWith(objects)
    const r = initPhotoPrintSeededCanvas(editor, canvas as never, 1, profile('per-photo-fixed-back') as never)
    expect(r).toEqual({ lockedBack: true })
    expect(objects[0].props).toEqual({})
    expect(objects[1].props).toEqual({ movable: false, deleteable: false, contentEditable: false })
    expect(objects[2].props).toEqual({ movable: false, deleteable: false, contentEditable: false })
    expect(rebindFrameInteractivity).toHaveBeenCalledWith(editor, canvas)
    expect(applyObjectPermissions).toHaveBeenCalledWith(canvas, false)
    expect(trackRequiredEdits).toHaveBeenCalledWith(canvas)
  })

  it('앞면(짝수)·자유 뒷면·chemical(stride 1)은 잠금 플래그 없이 보호·추적만', () => {
    const cases: Array<[ReturnType<typeof profile>, number]> = [
      [profile('per-photo-fixed-back'), 0],
      [profile('per-photo-fixed-back'), 2],
      [profile('per-photo-free-back'), 1],
    ]
    for (const [p, idx] of cases) {
      const objects = [obj('workspace'), obj('text-1', { type: 'textbox' })]
      const canvas = canvasWith(objects)
      expect(initPhotoPrintSeededCanvas(editor, canvas as never, idx, p as never)).toEqual({ lockedBack: false })
      expect(objects[1].props).toEqual({})
      expect(applyObjectPermissions).toHaveBeenCalledWith(canvas, false)
      expect(trackRequiredEdits).toHaveBeenCalledWith(canvas)
    }
    const chem = { ...profile('per-photo-fixed-back'), photoPrint: { ...profile('per-photo-fixed-back').photoPrint, process: 'chemical' as const } }
    const objects = [obj('workspace'), obj('text-1', { type: 'textbox' })]
    expect(initPhotoPrintSeededCanvas(editor, canvasWith(objects) as never, 1, chem as never)).toEqual({ lockedBack: false })
    expect(objects[1].props).toEqual({})
  })

  it('editMode(관리자) 는 플래그는 기록하되 applyObjectPermissions(canvas, true) 로 잠그지 않는다', () => {
    useSettingsStore.setState((s) => ({ currentSettings: { ...s.currentSettings, editMode: true } }))
    const objects = [obj('workspace'), obj('logo')]
    const canvas = canvasWith(objects)
    initPhotoPrintSeededCanvas(editor, canvas as never, 3, profile('per-photo-fixed-back') as never)
    expect(objects[1].props).toMatchObject({ movable: false })
    expect(applyObjectPermissions).toHaveBeenCalledWith(canvas, true)
  })
})
