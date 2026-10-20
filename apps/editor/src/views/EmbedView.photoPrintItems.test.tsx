/**
 * P2-d 사진인화 (2026-10-19, contract-3): 레거시 `storige:completed` 에 선택 키 `items`(사진별 항목) 동봉.
 *  - 정식 envelope(editor.complete)와 같은 additive 키 — EditorResult.items 가 있을 때만 싣고, 없으면 키 자체가 없다
 *    (캘린더/NULL 세트·게스트 완료는 종전 payload 그대로).
 *  - 자격증명이 아니므로 parentOrigin 이 없는 와일드카드 송신에도 싣는다(D24·D25 불변식은 guestToken 에만 적용).
 *
 * 하네스는 EmbedView.test.tsx D 절을 준용한다(EmbeddedEditor·editSessionsApi 만 모킹).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { PhotoItem } from '@storige/types'
import type { EditorConfig, EditorResult } from '@/embed'

const h = vi.hoisted(() => ({
  editorProps: [] as EditorConfig[],
}))

vi.mock('@/embed', () => ({
  EMBED_MESSAGE_SOURCE: 'storige-editor',
  EMBED_MESSAGE_VERSION: '1',
  EmbeddedEditor: (props: EditorConfig) => {
    h.editorProps.push(props)
    return null
  },
}))

vi.mock('@/api', () => ({
  editSessionsApi: {
    get: vi.fn(),
    getGuest: vi.fn(),
  },
}))

import EmbedView from './EmbedView'

const PARENT = 'https://h.example'

async function propsAt(path: string): Promise<EditorConfig> {
  render(
    <MemoryRouter initialEntries={[path]}>
      <EmbedView />
    </MemoryRouter>,
  )
  await waitFor(() => expect(h.editorProps.length).toBeGreaterThan(0))
  return h.editorProps[h.editorProps.length - 1]
}

function result(partial: Partial<EditorResult>): EditorResult {
  return {
    sessionId: 'sess-1',
    pages: { initial: 1, final: 1 },
    files: {},
    savedAt: '2026-10-19T00:00:00.000Z',
    ...partial,
  }
}

const items: PhotoItem[] = [
  { index: 0, canvasIndex: 0, sizeCode: '4x6', copies: 5, border: 'none', fit: 'paper-full', finish: 'matte', brightnessFix: false, dateOverlay: false, grayscale: false, lowRes: false },
  { index: 1, canvasIndex: 2, sizeCode: '4x6', copies: 2, border: 'white', fit: 'image-full', finish: 'matte', brightnessFix: false, dateOverlay: true, grayscale: true, lowRes: true },
]
const product = { kind: 'photo-print' as const, editorType: 'photo_digital_free', canvasCount: 4, sheetCount: 2, faces: 2 as const }

describe('EmbedView — 레거시 storige:completed items (P2-d 계약 row ②)', () => {
  const realParent = Object.getOwnPropertyDescriptor(window, 'parent')
  const parentPost = vi.fn<(message: unknown, targetOrigin: string) => void>()

  beforeEach(() => {
    h.editorProps.length = 0
    parentPost.mockReset()
    sessionStorage.clear()
    localStorage.clear()
    window.history.replaceState(null, '', '/')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    Object.defineProperty(window, 'parent', { value: { postMessage: parentPost }, configurable: true, writable: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (realParent) Object.defineProperty(window, 'parent', realParent)
  })

  const WITH_ORIGIN = `/embed?templateSetId=ts1&sessionId=s1&parentOrigin=${encodeURIComponent(PARENT)}`

  it('회원 완료 + items → storige:completed payload 에 items 그대로(product 다음 additive 키), targetOrigin=parentOrigin', async () => {
    const p = await propsAt(WITH_ORIGIN)
    p.onComplete?.(result({ sessionId: 's', orderSeqno: 5, savedAt: 't', files: { contentFileId: 'f' }, product, items }))
    expect(parentPost).toHaveBeenCalledTimes(1)
    const [msg, origin] = parentPost.mock.calls[0]
    expect(origin).toBe(PARENT)
    expect(msg).toEqual({
      type: 'storige:completed',
      payload: {
        sessionId: 's',
        orderSeqno: 5,
        status: 'completed',
        completedAt: 't',
        product,
        items,
        files: { coverFileId: null, contentFileId: 'f' },
      },
    })
  })

  it('items 없음(캘린더/NULL 세트): payload 에 items 키 자체가 없다(종전 키 집합 그대로)', async () => {
    const p = await propsAt(WITH_ORIGIN)
    p.onComplete?.(result({ sessionId: 's', orderSeqno: 5, savedAt: 't', files: {} }))
    const payload = (parentPost.mock.calls[0][0] as { payload: Record<string, unknown> }).payload
    expect('items' in payload).toBe(false)
    expect('product' in payload).toBe(false)
    expect(Object.keys(payload).sort()).toEqual(['completedAt', 'files', 'orderSeqno', 'sessionId', 'status'])
  })

  it('parentOrigin 없음(와일드카드 송신)에도 items 는 싣는다 — 자격증명(guestToken)만 제외', async () => {
    const p = await propsAt('/embed?templateSetId=ts1&sessionId=s1')
    p.onComplete?.(result({ sessionId: 's1', needsAuth: true, guestToken: 'g', items }))
    const [msg, origin] = parentPost.mock.calls[0]
    expect(origin).toBe('*')
    const payload = (msg as { payload: Record<string, unknown> }).payload
    expect(payload.items).toEqual(items)
    expect('guestToken' in payload).toBe(false)
  })
})
