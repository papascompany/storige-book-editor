// @vitest-environment happy-dom
//
// TemplatePanel — 낱장 템플릿 교체 시 TemplatePlugin.replaceTemplate 에 넘기는 인자.
//  (1) 서버 교체·세션 갱신 전의 현재 페이지 템플릿(불러온 목록)에서 top-level id(workspace 제외)를 currentTemplateIds 로 넘긴다
//  (2) refitFill 은 틀 채우기 경로(useImageStore.fillImageIntoFrame)로 위임한다
//  (3) 현재 템플릿이 목록에 없고 상세 조회도 실패하면 currentTemplateIds 없이(종전 판정) 교체한다
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'

const spies = vi.hoisted(() => ({
  getTemplates: vi.fn(),
  getTemplate: vi.fn(),
  sessionReplace: vi.fn(),
  replaceTemplate: vi.fn(),
  fillImageIntoFrame: vi.fn(async (_c: unknown, fore: unknown) => fore),
}))

vi.mock('@/api/templates', () => ({
  templatesApi: {
    getTemplates: (...a: unknown[]) => spies.getTemplates(...a),
    getTemplate: (...a: unknown[]) => spies.getTemplate(...a),
    getTemplateSets: vi.fn(async () => ({ items: [] })),
  },
}))
vi.mock('@/api/sessions', () => ({
  sessionsApi: { replaceTemplate: (...a: unknown[]) => spies.sessionReplace(...a), replaceTemplateSet: vi.fn() },
}))

import { fabric } from 'fabric'
import { TemplatePanel } from './TemplatePanel'
import { useAppStore } from '@/stores/useAppStore'
import { useEditorStore } from '@/stores/useEditorStore'
import { useImageStore } from '@/stores/useImageStore'

const tpl = (id: string, name: string, objectIds: string[]) => ({
  id,
  name,
  type: 'page',
  width: 210,
  height: 297,
  canvasData: { objects: objectIds.map((oid) => ({ type: 'rect', id: oid, width: 10, height: 10 })) },
})
const TPL_A = tpl('tpl-a', '템플릿 A', ['workspace', 'a-bg', 'a-frame', 'a-title'])
const TPL_B = tpl('tpl-b', '템플릿 B', ['workspace', 'b-bg'])

const canvas = { id: 'c0', getObjects: () => [], requestRenderAll: vi.fn() }
const imagePlugin = { name: 'ImageProcessingPlugin' }

function wire(currentTemplateId: string) {
  const templatePlugin = { replaceTemplate: (...a: unknown[]) => spies.replaceTemplate(...a) }
  act(() => {
    useAppStore.setState({
      canvas,
      getPlugin: (name: string) =>
        name === 'TemplatePlugin' ? templatePlugin : name === 'ImageProcessingPlugin' ? imagePlugin : undefined,
    } as never)
    useEditorStore.setState({
      sessionId: 's1',
      session: null,
      userId: null,
      pages: [{ id: 'p1', templateId: currentTemplateId, templateType: 'page' }],
      currentPageIndex: 0,
    } as never)
    useImageStore.setState({ fillImageIntoFrame: spies.fillImageIntoFrame } as never)
  })
  render(<TemplatePanel />)
}

async function swapTo(name: string) {
  await act(async () => {
    for (let i = 0; i < 20 && !screen.queryByText(name); i++) await new Promise((r) => setTimeout(r, 10))
  })
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
  spies.getTemplates.mockReset()
  spies.getTemplate.mockReset()
  spies.fillImageIntoFrame.mockClear()
  spies.replaceTemplate.mockReset().mockImplementation(async () => undefined)
  // 서버는 교체된 페이지(templateId=새 템플릿)로 세션을 돌려준다 — 그 뒤에도 id 목록은 교체 전 템플릿 기준이어야 한다
  spies.sessionReplace.mockReset().mockImplementation(async (_sid: string, dto: { newTemplateId: string }) => ({
    id: 's1',
    pages: [{ id: 'p1', templateId: dto.newTemplateId, templateType: 'page' }],
  }))
})

afterEach(() => {
  cleanup()
  act(() => {
    useAppStore.setState({ canvas: null } as never)
    useEditorStore.setState({ sessionId: null, session: null, pages: [], currentPageIndex: 0 } as never)
  })
})

describe('TemplatePanel — replaceTemplate 인자(현재 템플릿 id 목록·채움 사진 맞춤)', () => {
  it('교체 전 현재 템플릿의 top-level id(workspace 제외)를 넘기고, refitFill 은 fillImageIntoFrame 으로 위임한다', async () => {
    spies.getTemplates.mockResolvedValue([TPL_A, TPL_B])
    wire('tpl-a')
    await swapTo('템플릿 B')

    expect(spies.sessionReplace).toHaveBeenCalledTimes(1)
    expect(spies.replaceTemplate).toHaveBeenCalledTimes(1)
    const options = spies.replaceTemplate.mock.calls[0][1] as { currentTemplateIds?: string[]; refitFill?: (f: unknown, fr: unknown) => unknown }
    expect(options.currentTemplateIds).toEqual(['a-bg', 'a-frame', 'a-title'])
    expect(spies.getTemplate).not.toHaveBeenCalled()

    const fill = { id: 'photo' }
    const frame = { id: 'b-frame' }
    await options.refitFill?.(fill, frame)
    expect(spies.fillImageIntoFrame).toHaveBeenCalledWith(canvas, fill, frame, imagePlugin)
  })

  it('현재 템플릿이 목록에 없고 상세 조회도 실패하면 currentTemplateIds 없이 교체한다', async () => {
    spies.getTemplates.mockResolvedValue([TPL_B])
    spies.getTemplate.mockRejectedValue(new Error('network'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    wire('tpl-x')
    await swapTo('템플릿 B')

    expect(spies.getTemplate).toHaveBeenCalledWith('tpl-x')
    expect(spies.replaceTemplate).toHaveBeenCalledTimes(1)
    const options = spies.replaceTemplate.mock.calls[0][1] as { currentTemplateIds?: string[] }
    expect(options.currentTemplateIds).toBeUndefined()
    warn.mockRestore()
  })
})
