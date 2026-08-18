/**
 * 내지 PDF 첨부 진입점 배선 테스트 (W1-G1·G2·G3, 2026-08-13).
 *
 * 종전 결함:
 *  - G2: 첨부 진입점이 레거시 `/`(EditorView) 에만 있어 파트너 정본 경로(/embed)에서는
 *        고객이 내지 PDF 를 첨부할 방법 자체가 없었다.
 *  - G1: 첨부가 끝나도 화면은 그대로 — 세션을 재로드해야 PDF 가 보였다.
 *  - G3: EditorView 는 재로드해도 가이드를 깔지 않았다(applyContentPdfGuides 호출 0건).
 *
 * 잠그는 불변식:
 *  - 명시 세션(임베드)을 주입하면 **게스트 세션을 새로 만들지 않는다** — 만들면 첨부가
 *    편집 중인 세션이 아닌 엉뚱한 세션에 붙는다.
 *  - 첨부 완료 시 재로드 없이 seatContentPdf(focusFirstInnerPage) 로 즉시 앉힌다.
 *  - 소유 세션(레거시 `/`)은 캔버스 ready 후 세션을 조회해 underlay 면 앉힌다.
 *  - book 모드가 아닌 templateSet 에는 첨부 진입점을 노출하지 않는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

/** 공개 엔드포인트(with-templates)만 쓴다 — JWT 필수 라우트는 게스트에서 401(2026-08-13 적발) */
const getTemplateSetWithTemplates = vi.fn()
vi.mock('../../api/template-sets', () => ({
  templateSetsApi: {
    getTemplateSetWithTemplates: (...a: unknown[]) => getTemplateSetWithTemplates(...a),
    getTemplateSet: () => {
      throw new Error('게스트 401 라우트 — 첨부 진입점에서 호출 금지')
    },
  },
}))

const sessionGet = vi.fn()
vi.mock('../../api/edit-sessions', () => ({
  editSessionsApi: { get: (...a: unknown[]) => sessionGet(...a) },
}))

const seatContentPdf = vi.fn(async (..._args: unknown[]) => ({
  addedPages: 2,
  guidesPlaced: true,
}))
const ensureSeatExistingContentPdf = vi.fn(async (..._args: unknown[]) => ({
  addedPages: 0,
  guidesPlaced: false,
}))
vi.mock('../../utils/contentPdfGuide', () => ({
  seatContentPdf: (...a: unknown[]) => seatContentPdf(...a),
  ensureSeatExistingContentPdf: (...a: unknown[]) => ensureSeatExistingContentPdf(...a),
}))

const showToast = vi.fn()
vi.mock('../../stores/useToastStore', () => ({ showToast: (...a: unknown[]) => showToast(...a) }))

const appState = { ready: true, allCanvas: [{}, {}, {}] as unknown[] }
vi.mock('../../stores/useAppStore', () => ({
  useAppStore: Object.assign((sel: (s: typeof appState) => unknown) => sel(appState), {
    getState: () => appState,
  }),
}))

const authState = { token: null as string | null }
vi.mock('../../stores/useAuthStore', () => ({
  useAuthStore: (sel: (s: typeof authState) => unknown) => sel(authState),
}))

const ensureGuestSession = vi.fn(async () => null)
const guestState = { sessionId: null as string | null, ensureGuestSession }
vi.mock('../../stores/useGuestStore', () => ({
  useGuestStore: (sel: (s: typeof guestState) => unknown) => sel(guestState),
}))

/** 첨부 모달 스텁 — 버튼 클릭으로 onAttached 를 발화시켜 '첨부 직후' 경로를 검사한다 */
vi.mock('./ContentPdfAttachModal', () => ({
  ContentPdfAttachModal: ({
    onAttached,
  }: {
    onAttached: (r: Record<string, unknown>) => void
  }) => (
    <button
      type="button"
      onClick={() =>
        onAttached({
          contentPdfFileId: 'file-9',
          contentPdfPageCount: 12,
          targetPageCount: 12,
          validationResult: { status: 'completed' },
          contentPdfGuide: { sourceFileId: 'file-9', pageImageUrls: ['/1.png', '/2.png'] },
        })
      }
    >
      stub-attach
    </button>
  ),
}))

import { EditorWorkflowControls } from './EditorWorkflowControls'

const bookTemplateSet = {
  id: 'ts-book',
  type: 'book',
  editorMode: 'book',
  width: 210,
  height: 297,
  canAddPage: true,
  coverEditable: false, // 레더 배너 조건 — 임베드에서는 노출되지 않아야 한다
  endpaperConfig: { frontCount: 2, backCount: 2 },
  pageCountRange: [16, 200],
}

beforeEach(() => {
  vi.clearAllMocks()
  appState.ready = true
  appState.allCanvas = [{}, {}, {}]
  authState.token = null
  guestState.sessionId = null
  getTemplateSetWithTemplates.mockResolvedValue({ templateSet: bookTemplateSet, templateDetails: [] })
  seatContentPdf.mockResolvedValue({ addedPages: 2, guidesPlaced: true })
  ensureSeatExistingContentPdf.mockResolvedValue({ addedPages: 0, guidesPlaced: false })
  sessionGet.mockResolvedValue({ id: 'sess-1' })
})

describe('EditorWorkflowControls — 임베드(명시 세션) 마운트', () => {
  it('게스트 세션을 새로 만들지 않고 주입된 세션에 첨부한다', async () => {
    render(<EditorWorkflowControls templateSetId="ts-book" sessionId="sess-1" guestToken="gt-1" />)

    expect(await screen.findByRole('button', { name: /내지 PDF 첨부/ })).toBeTruthy()
    expect(ensureGuestSession).not.toHaveBeenCalled()
    // 배지 동기화는 조회하지만 앉히기는 embed.tsx 가 한다
    await waitFor(() => expect(sessionGet).toHaveBeenCalledWith('sess-1'))
    expect(ensureSeatExistingContentPdf).not.toHaveBeenCalled()
    expect(seatContentPdf).not.toHaveBeenCalled()
  })

  it('레더·면지 안내 배너는 임베드에 노출하지 않는다 (W1 변경면적 제한)', async () => {
    render(<EditorWorkflowControls templateSetId="ts-book" sessionId="sess-1" />)

    await screen.findByRole('button', { name: /내지 PDF 첨부/ })
    expect(screen.queryByText(/레더 커버/)).toBeNull()
    expect(screen.queryByText(/페브릭/)).toBeNull()
    expect(screen.queryByText(/앞면지/)).toBeNull()
  })

  it('첨부 완료 시 재로드 없이 즉시 앉히고(첫 내지로 이동) 버튼이 첨부됨으로 바뀐다', async () => {
    const onAttached = vi.fn()
    render(
      <EditorWorkflowControls templateSetId="ts-book" sessionId="sess-1" onAttached={onAttached} />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /내지 PDF 첨부/ }))
    fireEvent.click(screen.getByRole('button', { name: 'stub-attach' }))

    await waitFor(() => expect(seatContentPdf).toHaveBeenCalledTimes(1))
    const [session, tsId, opts] = seatContentPdf.mock.calls[0] as unknown as [
      Record<string, unknown>,
      string,
      Record<string, unknown>,
    ]
    expect(session).toMatchObject({
      contentPdfMode: 'underlay',
      contentPdfFileId: 'file-9',
      contentPdfPageCount: 12,
      metadata: { contentPdfGuide: { pageImageUrls: ['/1.png', '/2.png'] } },
    })
    expect(tsId).toBe('ts-book')
    expect(opts).toEqual({ focusFirstInnerPage: true })

    expect(onAttached).toHaveBeenCalledWith({
      contentPdfFileId: 'file-9',
      contentPdfPageCount: 12,
    })
    expect(await screen.findByRole('button', { name: /첨부됨 \(12p\)/ })).toBeTruthy()
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('편집기에 배치'),
        'success',
        expect.any(Number),
      ),
    )
  })

  it('가이드 래스터가 없으면 경고 토스트로 알린다 (첨부는 성공)', async () => {
    seatContentPdf.mockResolvedValue({ addedPages: 2, guidesPlaced: false })
    render(<EditorWorkflowControls templateSetId="ts-book" sessionId="sess-1" />)

    fireEvent.click(await screen.findByRole('button', { name: /내지 PDF 첨부/ }))
    fireEvent.click(screen.getByRole('button', { name: 'stub-attach' }))

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('미리보기 생성이 지연'),
        'warning',
        expect.any(Number),
      ),
    )
  })
})

describe('EditorWorkflowControls — 레거시 `/`(소유 세션)', () => {
  it('ready 후 세션을 조회해 underlay 면 앉힌다 (G3 대칭)', async () => {
    guestState.sessionId = 'guest-sess'
    sessionGet.mockResolvedValue({
      id: 'guest-sess',
      contentPdfMode: 'underlay',
      contentPdfFileId: 'file-3',
      contentPdfPageCount: 24,
    })

    render(<EditorWorkflowControls templateSetId="ts-book" />)

    await waitFor(() => expect(ensureSeatExistingContentPdf).toHaveBeenCalledTimes(1))
    expect(sessionGet).toHaveBeenCalledWith('guest-sess')
    expect(await screen.findByRole('button', { name: /첨부됨 \(24p\)/ })).toBeTruthy()
  })

  it('주문 contentFileId 만 있어도(미완료 세션 + 편집완료 마커 없음) 첨부됨 배지를 보여 준다', async () => {
    guestState.sessionId = 'guest-sess'
    sessionGet.mockResolvedValue({
      id: 'guest-sess',
      status: 'editing',
      contentPdfMode: null,
      contentFileId: 'shop-pdf',
      contentPdfPageCount: 8,
    })

    render(<EditorWorkflowControls templateSetId="ts-book" />)

    await waitFor(() => expect(ensureSeatExistingContentPdf).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('button', { name: /첨부됨 \(8p\)/ })).toBeTruthy()
  })

  it('편집완료 산출물(contentFileId + spreadContentPageCount 마커)은 첨부 배지로 오인하지 않는다 (R5)', async () => {
    guestState.sessionId = 'guest-sess'
    sessionGet.mockResolvedValue({
      id: 'guest-sess',
      status: 'editing', // 자동저장이 complete → editing 으로 되돌린 재편집 세션
      contentPdfMode: null,
      contentFileId: 'editor-output-content-pdf',
      contentPdfPageCount: null,
      metadata: { spreadContentPageCount: 8 },
    })

    render(<EditorWorkflowControls templateSetId="ts-book" />)

    await waitFor(() => expect(sessionGet).toHaveBeenCalledWith('guest-sess'))
    expect(await screen.findByRole('button', { name: /내지 PDF 첨부/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /첨부됨/ })).toBeNull()
  })

  it('완료 이력(status=complete) 세션의 contentFileId 도 첨부로 간주하지 않는다 (R5)', async () => {
    guestState.sessionId = 'guest-sess'
    sessionGet.mockResolvedValue({
      id: 'guest-sess',
      status: 'complete',
      contentPdfMode: null,
      contentFileId: 'editor-output-content-pdf',
      contentPdfPageCount: null,
    })

    render(<EditorWorkflowControls templateSetId="ts-book" />)

    await waitFor(() => expect(sessionGet).toHaveBeenCalledWith('guest-sess'))
    expect(await screen.findByRole('button', { name: /내지 PDF 첨부/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /첨부됨/ })).toBeNull()
  })

  it('진짜 첨부(contentPdfFileId)는 편집완료 마커가 있어도 배지를 유지한다 (혼합 케이스)', async () => {
    guestState.sessionId = 'guest-sess'
    sessionGet.mockResolvedValue({
      id: 'guest-sess',
      status: 'editing',
      contentPdfMode: 'underlay',
      contentPdfFileId: 'real-attach-pdf',
      contentFileId: 'editor-output-content-pdf',
      contentPdfPageCount: 24,
      metadata: { spreadContentPageCount: 8 },
    })

    render(<EditorWorkflowControls templateSetId="ts-book" />)

    expect(await screen.findByRole('button', { name: /첨부됨 \(24p\)/ })).toBeTruthy()
  })

  it('pageCount 가 없으면 "(0p)" 대신 페이지 수 표기를 생략한다 (R5)', async () => {
    guestState.sessionId = 'guest-sess'
    sessionGet.mockResolvedValue({
      id: 'guest-sess',
      status: 'editing',
      contentPdfMode: 'underlay',
      contentPdfFileId: 'real-attach-pdf',
      contentPdfPageCount: null,
    })

    render(<EditorWorkflowControls templateSetId="ts-book" />)

    expect(await screen.findByRole('button', { name: '✓ PDF 첨부됨' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /0p/ })).toBeNull()
  })

  it('캔버스가 준비되기 전에는 조회·배치하지 않는다', async () => {
    appState.ready = false
    guestState.sessionId = 'guest-sess'

    render(<EditorWorkflowControls templateSetId="ts-book" />)

    await waitFor(() => expect(getTemplateSetWithTemplates).toHaveBeenCalled())
    expect(sessionGet).not.toHaveBeenCalled()
    expect(seatContentPdf).not.toHaveBeenCalled()
  })
})

describe('EditorWorkflowControls — 노출 게이트', () => {
  it('book 모드가 아닌 templateSet 에는 첨부 진입점을 노출하지 않는다', async () => {
    getTemplateSetWithTemplates.mockResolvedValue({
      templateSet: { ...bookTemplateSet, type: 'leaflet', editorMode: 'single' },
      templateDetails: [],
    })
    render(<EditorWorkflowControls templateSetId="ts-book" sessionId="sess-1" />)

    await waitFor(() => expect(getTemplateSetWithTemplates).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /내지 PDF 첨부/ })).toBeNull()
  })

  it('세션이 없으면(주입도 게스트도 없음) 첨부 진입점을 노출하지 않는다', async () => {
    authState.token = 'jwt'
    guestState.sessionId = null
    render(<EditorWorkflowControls templateSetId="ts-book" />)

    await waitFor(() => expect(getTemplateSetWithTemplates).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /내지 PDF 첨부/ })).toBeNull()
  })
})
