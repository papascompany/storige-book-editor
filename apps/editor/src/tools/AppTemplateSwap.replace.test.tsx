// @vitest-environment happy-dom
//
// AppTemplateSwap — 페이지 템플릿 교체 시 TemplatePlugin.replaceTemplate 에 넘기는 인자.
//  (1) 현재 페이지 템플릿(연결 템플릿 목록)의 top-level id 를 currentTemplateIds 로 넘긴다(workspace 제외)
//  (2) refitFill 은 틀 채우기 경로(useImageStore.fillImageIntoFrame)로 옮긴 채움 사진을 새 틀에 맞춘다
//  (3) 현재 템플릿이 목록에 없으면 상세를 조회하고, 조회 실패면 currentTemplateIds 없이(종전 판정) 교체한다
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'

const spies = vi.hoisted(() => ({
  getTemplate: vi.fn(),
  replaceTemplate: vi.fn(),
  fillImageIntoFrame: vi.fn(async (_c: unknown, fore: unknown) => fore),
}))

vi.mock('@/api/templates', () => ({ templatesApi: { getTemplate: (...a: unknown[]) => spies.getTemplate(...a) } }))
vi.mock('@/api/sessions', () => ({ sessionsApi: { replaceTemplate: vi.fn() } }))
vi.mock('@/utils/calendarRehydrate', () => ({ rehydrateCalendarGrids: vi.fn(async () => 0) }))
vi.mock('@/utils/objectPermissions', () => ({ applyCoverMaterialLock: vi.fn() }))

import { fabric } from 'fabric'
import AppTemplateSwap from './AppTemplateSwap'
import { useAppStore } from '@/stores/useAppStore'
import { useEditorStore } from '@/stores/useEditorStore'
import { useSettingsStore, type LinkedPrintTemplate } from '@/stores/useSettingsStore'
import { useImageStore } from '@/stores/useImageStore'

const TPL_A: LinkedPrintTemplate = {
  id: 'tpl-a',
  name: '템플릿 A',
  type: 'page',
  width: 100,
  height: 100,
  canvasData: {
    objects: [
      { type: 'rect', id: 'workspace', width: 100, height: 100 },
      { type: 'rect', id: 'a-bg', width: 100, height: 100 },
      { type: 'rect', id: 'a-frame', extensionType: 'frame', width: 50, height: 50 },
    ],
  },
}
const TPL_B: LinkedPrintTemplate = {
  id: 'tpl-b',
  name: '템플릿 B',
  type: 'page',
  width: 100,
  height: 100,
  canvasData: { objects: [{ type: 'rect', id: 'b-bg', width: 100, height: 100 }] },
}

const canvas = { id: 'c0', getObjects: () => [], requestRenderAll: vi.fn() }
const imagePlugin = { name: 'ImageProcessingPlugin' }

function wire(currentTemplateId: string, linked: LinkedPrintTemplate[]) {
  const templatePlugin = { replaceTemplate: (...a: unknown[]) => spies.replaceTemplate(...a) }
  act(() => {
    useAppStore.setState({
      canvas,
      allCanvas: [canvas],
      allEditors: [{}],
      getPlugin: (name: string) =>
        name === 'TemplatePlugin' ? templatePlugin : name === 'ImageProcessingPlugin' ? imagePlugin : undefined,
    } as never)
    useSettingsStore.setState({
      linkedPrintTemplates: linked,
      spreadConfig: null,
      currentSettings: { ...useSettingsStore.getState().currentSettings, size: { width: 100, height: 100 } },
    } as never)
    useEditorStore.setState({
      sessionId: null,
      pages: [{ id: 'p1', templateId: currentTemplateId, templateType: 'page' }],
      currentPageIndex: 0,
    } as never)
    useImageStore.setState({ fillImageIntoFrame: spies.fillImageIntoFrame } as never)
  })
  render(<AppTemplateSwap />)
}

async function swapTo(name: string) {
  fireEvent.click(screen.getByText(name))
  await act(async () => {
    fireEvent.click(screen.getByText('교체'))
    for (let i = 0; i < 20 && spies.replaceTemplate.mock.calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10))
    }
  })
}

beforeEach(() => {
  // 전역 fabric mock(src/test/setup.ts)에는 enlivenObjects 가 없다 — 입력을 그대로 돌려주는 대역
  ;(fabric.util as unknown as { enlivenObjects: (o: unknown[], cb: (e: unknown[]) => void) => void }).enlivenObjects = (o, cb) => cb(o)
  spies.getTemplate.mockReset()
  spies.fillImageIntoFrame.mockClear()
  spies.replaceTemplate.mockReset().mockImplementation(async () => undefined)
})

afterEach(() => {
  cleanup()
  act(() => {
    useAppStore.setState({ canvas: null, allCanvas: [], allEditors: [] } as never)
    useSettingsStore.setState({ linkedPrintTemplates: [] } as never)
    useEditorStore.setState({ pages: [], currentPageIndex: 0 } as never)
  })
})

describe('AppTemplateSwap — replaceTemplate 인자(현재 템플릿 id 목록·채움 사진 맞춤)', () => {
  it('현재 페이지 템플릿의 top-level id(workspace 제외)를 넘기고, refitFill 은 fillImageIntoFrame 으로 위임한다', async () => {
    wire('tpl-a', [TPL_A, TPL_B])
    await swapTo('템플릿 B')

    expect(spies.replaceTemplate).toHaveBeenCalledTimes(1)
    const [objects, options] = spies.replaceTemplate.mock.calls[0] as [Array<{ id: string }>, { currentTemplateIds?: string[]; refitFill?: (f: unknown, fr: unknown) => unknown }]
    expect(objects.map((o) => o.id)).toEqual(['b-bg'])
    expect(options.currentTemplateIds).toEqual(['a-bg', 'a-frame'])
    expect(spies.getTemplate).not.toHaveBeenCalled()

    const fill = { id: 'photo' }
    const frame = { id: 'b-frame' }
    await options.refitFill?.(fill, frame)
    expect(spies.fillImageIntoFrame).toHaveBeenCalledWith(canvas, fill, frame, imagePlugin)
    // 교체 뒤 페이지의 templateId 갱신
    expect(useEditorStore.getState().pages[0].templateId).toBe('tpl-b')
  })

  it('현재 템플릿이 연결 목록에 없으면 상세를 조회해 id 목록을 만든다', async () => {
    spies.getTemplate.mockResolvedValue({ id: 'tpl-x', canvasData: { objects: [{ id: 'workspace' }, { id: 'x-frame' }] } })
    wire('tpl-x', [TPL_B])
    await swapTo('템플릿 B')

    expect(spies.getTemplate).toHaveBeenCalledWith('tpl-x')
    const options = spies.replaceTemplate.mock.calls[0][1] as { currentTemplateIds?: string[] }
    expect(options.currentTemplateIds).toEqual(['x-frame'])
  })

  it('상세 조회가 실패하면 currentTemplateIds 없이(종전 판정) 교체한다', async () => {
    spies.getTemplate.mockRejectedValue(new Error('network'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    wire('tpl-x', [TPL_B])
    await swapTo('템플릿 B')

    expect(spies.replaceTemplate).toHaveBeenCalledTimes(1)
    const options = spies.replaceTemplate.mock.calls[0][1] as { currentTemplateIds?: string[] }
    expect(options.currentTemplateIds).toBeUndefined()
    warn.mockRestore()
  })
})
