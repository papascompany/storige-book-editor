// @vitest-environment jsdom
//
// useEditorContents 에셋 배치 — core.imageFromURL 이 로드 실패(isError·0×0)를 reject 할 때의 흐름.
//  - addAssetToCanvas: 같은 오류로 reject 하고 캔버스에 아무것도 넣지 않는다(빈 이미지 배치 금지).
//  - setupAsset(이미지·요소·배경 패널 진입점)·setupFrameContent: 오류를 흡수해 resolve 한다
//    (처리되지 않은 rejection 없음, 배경 배율 계산에 빈 이미지가 들어가지 않음).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const h = vi.hoisted(() => ({
  imageFromURL: vi.fn<(url: string, opts?: Record<string, unknown>) => Promise<unknown>>(),
}))

vi.mock('@storige/canvas-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@storige/canvas-core')>()
  return {
    ...actual,
    core: {
      ...actual.core,
      imageFromURL: (url: string, opts?: Record<string, unknown>) => h.imageFromURL(url, opts),
    },
  }
})

import { useAppStore } from '@/stores/useAppStore'
import { useEditorContents } from './useEditorContents'

const LOAD_ERROR = new Error('이미지 로드 실패: https://cdn.example.com/a.png')

function makeCanvas() {
  const workspace = {
    id: 'workspace',
    width: 500,
    height: 500,
    getCenterPoint: () => ({ x: 250, y: 250 }),
  }
  return {
    add: vi.fn(),
    remove: vi.fn(),
    renderAll: vi.fn(),
    requestRenderAll: vi.fn(),
    getObjects: vi.fn(() => [workspace]),
  }
}

const content = { id: 'c1', imageUrl: 'https://cdn.example.com/a.png' }

let canvas: ReturnType<typeof makeCanvas>
let updateObjects: ReturnType<typeof vi.fn>

beforeEach(() => {
  h.imageFromURL.mockReset()
  h.imageFromURL.mockRejectedValue(LOAD_ERROR)
  canvas = makeCanvas()
  updateObjects = vi.fn()
  useAppStore.setState({ canvas, updateObjects } as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  useAppStore.setState({ canvas: null } as never)
  vi.restoreAllMocks()
})

describe('useEditorContents — 이미지 로드 실패', () => {
  it('addAssetToCanvas 는 같은 오류로 reject 하고 캔버스에 추가하지 않는다', async () => {
    const { result } = renderHook(() => useEditorContents())
    await expect(result.current.addAssetToCanvas(content.imageUrl, content.id)).rejects.toBe(LOAD_ERROR)
    expect(h.imageFromURL).toHaveBeenCalledTimes(1)
    expect(canvas.add).not.toHaveBeenCalled()
  })

  it.each(['image', 'element', 'background'])(
    'setupAsset(%s) 는 오류를 흡수해 resolve 하고 캔버스·배경을 건드리지 않는다',
    async (contentType) => {
      const { result } = renderHook(() => useEditorContents())
      await expect(result.current.setupAsset(content as never, contentType)).resolves.toBeUndefined()
      expect(h.imageFromURL).toHaveBeenCalledTimes(1)
      expect(canvas.add).not.toHaveBeenCalled()
      expect(canvas.remove).not.toHaveBeenCalled()
      expect(updateObjects).not.toHaveBeenCalled()
    },
  )

  it('setupFrameContent 는 오류를 흡수해 resolve 하고 프레임을 추가하지 않는다', async () => {
    const { result } = renderHook(() => useEditorContents())
    await expect(result.current.setupFrameContent(content as never, canvas as never)).resolves.toBeUndefined()
    expect(h.imageFromURL).toHaveBeenCalledTimes(1)
    expect(canvas.add).not.toHaveBeenCalled()
  })
})
