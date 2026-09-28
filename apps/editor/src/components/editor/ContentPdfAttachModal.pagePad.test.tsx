/**
 * 2026-09-28 — 첨부 PDF 빈 페이지 배수 채움(템플릿셋 padToPageStep) 잠금.
 *
 *  - computePagePadTarget: 설정·pageStep·쪽수 게이트와 ceil(n/step)*step
 *  - 첨부 흐름: 채움이 필요하면 fix-pagecount/attach 결과(채움본)로 세션 PATCH·onAttached 를 하고
 *    pageCount 도 채움 후 쪽수로 보고한다(호스트가 보관·합성에 쓰는 id = 채움본).
 *  - 채움 실패 시 원본으로 첨부하지 않고 중단한다.
 *  - 설정이 꺼져 있으면 채움 잡을 호출하지 않는다(기존 동작).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const post = vi.fn()
const get = vi.fn()
vi.mock('../../api/client', () => ({
  apiClient: {
    post: (...a: unknown[]) => post(...a),
    get: (...a: unknown[]) => get(...a),
    getDirectBaseUrl: () => 'https://api.example.com',
  },
  toUserMessage: (_e: unknown, fallback: string) => fallback,
}))
const sessionUpdate = vi.fn(async (..._a: unknown[]) => ({}))
vi.mock('../../api/edit-sessions', () => ({
  editSessionsApi: { update: (...a: unknown[]) => sessionUpdate(...a), updateGuest: vi.fn() },
}))

import { ContentPdfAttachModal, computePagePadTarget } from './ContentPdfAttachModal'
import { useEditorStore } from '../../stores/useEditorStore'

describe('computePagePadTarget', () => {
  it('설정 켜짐 + 배수 아님 → 올림 배수', () => {
    expect(computePagePadTarget(5, 4, true)).toBe(8)
    expect(computePagePadTarget(15, 2, true)).toBe(16)
  })
  it('이미 배수·설정 꺼짐·pageStep 없음/1·쪽수 없음 → null', () => {
    expect(computePagePadTarget(8, 4, true)).toBeNull()
    expect(computePagePadTarget(5, 4, false)).toBeNull()
    expect(computePagePadTarget(5, null, true)).toBeNull()
    expect(computePagePadTarget(5, 1, true)).toBeNull()
    expect(computePagePadTarget(0, 4, true)).toBeNull()
    expect(computePagePadTarget(undefined, 4, true)).toBeNull()
  })
})

describe('ContentPdfAttachModal — 빈 페이지 채움 첨부 흐름', () => {
  const onAttached = vi.fn()

  /** URL 별 응답 라우팅. padOutcome: 채움 잡 최종 상태 */
  function wireApi(opts: { pdfPages: number; padOutcome?: 'COMPLETED' | 'FAILED' }) {
    post.mockImplementation(async (url: string) => {
      if (url.startsWith('/storage/upload-public')) return { data: { id: 'orig-file', url: '/u' } }
      if (url === '/worker-jobs/validate') return { data: { id: 'vjob' } }
      if (url === '/worker-jobs/fix-pagecount/attach') return { data: { id: 'pjob' } }
      if (url === '/worker-jobs/render-pages') return { data: { id: 'rjob' } }
      throw new Error(`unexpected POST ${url}`)
    })
    get.mockImplementation(async (url: string) => {
      if (url === '/worker-jobs/vjob') {
        return { data: { status: 'COMPLETED', result: { result: { metadata: { pageCount: opts.pdfPages }, errors: [], warnings: [] } } } }
      }
      if (url === '/worker-jobs/pjob') {
        return opts.padOutcome === 'FAILED'
          ? { data: { status: 'FAILED' } }
          : { data: { status: 'COMPLETED', outputFileId: 'padded-file' } }
      }
      if (url === '/worker-jobs/rjob') return { data: { status: 'FAILED' } } // 가이드 생략(첨부는 성공)
      throw new Error(`unexpected GET ${url}`)
    })
  }

  async function attach(currentContentPageCount: number) {
    render(
      <ContentPdfAttachModal
        open
        sessionId="sess-1"
        currentContentPageCount={currentContentPageCount}
        canAddPage
        templateSetId="ts-1"
        onClose={() => {}}
        onAttached={onAttached}
      />,
    )
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['%PDF-1.4'], 'inner.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })
    await act(async () => {
      fireEvent.click(screen.getByText('업로드 + 검증'))
    })
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.useRealTimers()
    useEditorStore.setState({ pageStep: null, padToPageStep: false })
  })

  it('PDF 5p · pageStep 4 · 채움 켜짐 → 채움본(8p)으로 세션 PATCH 와 onAttached', async () => {
    useEditorStore.setState({ pageStep: 4, padToPageStep: true })
    wireApi({ pdfPages: 5 })
    await attach(8)

    expect(post).toHaveBeenCalledWith('/worker-jobs/fix-pagecount/attach', { fileId: 'orig-file', templateSetId: 'ts-1' })
    expect(sessionUpdate).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({ contentPdfFileId: 'padded-file', contentPdfPageCount: 8 }),
    )
    expect(onAttached).toHaveBeenCalledWith(
      expect.objectContaining({
        contentPdfFileId: 'padded-file',
        contentPdfPageCount: 8,
        validationResult: expect.objectContaining({
          pagePadded: { sourceFileId: 'orig-file', paddedFileId: 'padded-file', originalPages: 5, paddedPages: 8, pageStep: 4 },
        }),
      }),
    )
  })

  it('채움 실패 → 원본으로 첨부하지 않고 중단', async () => {
    useEditorStore.setState({ pageStep: 4, padToPageStep: true })
    wireApi({ pdfPages: 5, padOutcome: 'FAILED' })
    await attach(8)

    expect(sessionUpdate).not.toHaveBeenCalled()
    expect(onAttached).not.toHaveBeenCalled()
    expect(screen.getByText(/빈 페이지 채움 실패/)).toBeInTheDocument()
  })

  it('설정 꺼짐 → 채움 잡 미호출, 원본 그대로 첨부(기존 동작)', async () => {
    useEditorStore.setState({ pageStep: 4, padToPageStep: false })
    wireApi({ pdfPages: 5 })
    await attach(5)

    expect(post).not.toHaveBeenCalledWith('/worker-jobs/fix-pagecount/attach', expect.anything())
    expect(onAttached).toHaveBeenCalledWith(
      expect.objectContaining({ contentPdfFileId: 'orig-file', contentPdfPageCount: 5 }),
    )
  })
})
