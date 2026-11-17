// @vitest-environment happy-dom
//
// 사진틀 클릭 채움의 내용 편집 잠금.
//  - 사진인화 고정 뒷면은 lockSeededObjects 가 로드 객체 전부에 contentEditable=false 를 강제한다.
//    그렇게 잠긴 사진틀은 고객(editMode 아님)이 눌러도 파일 선택이 열리지 않고, 올려도 안내 오버레이가 뜨지 않는다.
//  - 관리자(editMode)와 잠기지 않은 사진틀은 종전대로 파일 선택이 열린다.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const selectFiles = vi.hoisted(() => vi.fn(async () => null))
vi.mock('@storige/canvas-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@storige/canvas-core')>()),
  selectFiles,
}))

import type { fabric } from 'fabric'
import type { ImageProcessingPlugin } from '@storige/canvas-core'
import { useImageStore } from './useImageStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { lockSeededObjects } from '@/utils/photoPrintSeed'

type Handler = () => unknown

function makeFrame(id: string) {
  const handlers = new Map<string, Handler>()
  const frame = {
    id,
    extensionType: 'frame',
    width: 100,
    height: 100,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    set(props: Record<string, unknown>) {
      Object.assign(frame, props)
      return frame
    },
    on(name: string, fn: Handler) {
      handlers.set(name, fn)
    },
    getCenterPoint: () => ({ x: 0, y: 0 }),
  }
  return { frame, fire: (name: string) => handlers.get(name)?.() }
}

function makeCanvas(objects: unknown[]) {
  return {
    getObjects: () => objects,
    add: vi.fn(),
    remove: vi.fn(),
    requestRenderAll: vi.fn(),
  }
}

function bind(frame: unknown, canvas: unknown) {
  useImageStore
    .getState()
    .makeFrameInteractive(canvas as fabric.Canvas, frame as fabric.Object, {} as ImageProcessingPlugin)
}

function setEditMode(editMode: boolean) {
  useSettingsStore.setState((s) => ({ currentSettings: { ...s.currentSettings, editMode } }))
}

describe('사진틀 클릭 채움 — 내용 편집 잠금', () => {
  beforeEach(() => {
    selectFiles.mockClear()
    setEditMode(false)
  })

  it('고정 뒷면으로 잠긴 사진틀은 고객이 눌러도 파일 선택이 열리지 않고 안내 오버레이도 없다', async () => {
    const { frame, fire } = makeFrame('f-locked')
    const canvas = makeCanvas([{ id: 'workspace' }, frame])
    expect(lockSeededObjects(canvas as unknown as fabric.Canvas)).toBe(1)
    bind(frame, canvas)

    fire('mouseover')
    await fire('mousedown')

    expect(selectFiles).not.toHaveBeenCalled()
    expect(canvas.add).not.toHaveBeenCalled()
  })

  it('같은 사진틀이라도 관리자(editMode)는 파일 선택이 열린다', async () => {
    const { frame, fire } = makeFrame('f-admin')
    const canvas = makeCanvas([{ id: 'workspace' }, frame])
    lockSeededObjects(canvas as unknown as fabric.Canvas)
    bind(frame, canvas)
    setEditMode(true)

    await fire('mousedown')

    expect(selectFiles).toHaveBeenCalledTimes(1)
  })

  it('잠기지 않은 사진틀은 고객이 누르면 파일 선택이 열린다', async () => {
    const { frame, fire } = makeFrame('f-free')
    const canvas = makeCanvas([{ id: 'workspace' }, frame])
    bind(frame, canvas)

    await fire('mousedown')

    expect(selectFiles).toHaveBeenCalledTimes(1)
  })
})
