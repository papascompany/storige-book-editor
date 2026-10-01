/**
 * EmbedView — URL 파라미터 → EmbeddedEditor props 배선 + 레거시 `storige:*` dual-emit.
 *
 * 잠그는 것:
 *   A. 쿼리 파라미터 매핑(camel/snake, 쪽수·책등·날개·내지 PDF 첨부·규격·메타)
 *   B. 재편집: sessionId 만 있으면 세션에서 templateSetId 도출(토큰 선주입 후), 실패/부재 문구
 *   C. adminEdit=session: fragment 토큰 → 탭 저장소, 주소창 fragment 제거, 쿼리 폴백, 플래그 해제
 *   D. 레거시 발신 payload·targetOrigin (와일드카드 송신에는 guestToken 을 싣지 않음)
 *   E. 게스트 세션 재오픈: fragment 게스트 토큰 수신·주소창 제거, 게스트 조회 경로 도출,
 *      도출 실패 시 정식 editor.error(SESSION_NOT_FOUND) 1회
 *
 * EmbeddedEditor 와 editSessionsApi 만 모킹한다. searchParams·hostPageLimits·hostSpine·
 * authTokenStorage·adminEditUrl 은 실제 모듈을 쓴다(통합 배선 잠금).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StrictMode } from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import type { EditorConfig, EditorResult } from '@/embed'

type SessionStub = { templateSetId?: string | null; guestToken?: string | null }

const h = vi.hoisted(() => ({
  editorProps: [] as EditorConfig[],
  get: vi.fn<(sessionId: string) => Promise<SessionStub>>(),
  getGuest: vi.fn<(sessionId: string, guestToken: string) => Promise<SessionStub>>(),
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
    get: (sessionId: string) => h.get(sessionId),
    getGuest: (sessionId: string, guestToken: string) => h.getGuest(sessionId, guestToken),
  },
}))

import EmbedView from './EmbedView'

const PARENT = 'https://h.example'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <EmbedView />
    </MemoryRouter>,
  )
}

/** 렌더 후 EmbeddedEditor 가 받은 마지막 props */
async function propsAt(path: string): Promise<EditorConfig> {
  renderAt(path)
  await waitFor(() => expect(h.editorProps.length).toBeGreaterThan(0))
  return h.editorProps[h.editorProps.length - 1]
}

/** fragment 는 EmbedView 가 window.location.hash 에서 직접 읽으므로 실제 location 도 맞춘다 */
async function propsAtWithHash(pathWithQuery: string, hash: string): Promise<EditorConfig> {
  window.history.replaceState(null, '', `${pathWithQuery}${hash}`)
  return propsAt(pathWithQuery)
}

function result(partial: Partial<EditorResult>): EditorResult {
  return {
    sessionId: 'sess-1',
    pages: { initial: 1, final: 1 },
    files: {},
    savedAt: '2026-09-30T00:00:00.000Z',
    ...partial,
  }
}

let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  h.editorProps.length = 0
  h.get.mockReset()
  h.getGuest.mockReset()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('EmbedView — A. 파라미터 매핑', () => {
  it('A1 신규 편집 파라미터가 props 로 전달된다(orderSeqno number, 세션 조회 없음, localStorage 토큰)', async () => {
    const p = await propsAt(
      `/embed?templateSetId=ts1&token=T&orderSeqno=123&parentOrigin=${encodeURIComponent(PARENT)}` +
        '&mode=both&productId=p&callbackUrl=c&coverFileId=cf&contentFileId=ct&apiBaseUrl=a',
    )
    expect(p).toMatchObject({
      templateSetId: 'ts1',
      token: 'T',
      orderSeqno: 123,
      parentOrigin: PARENT,
      mode: 'both',
      productId: 'p',
      callbackUrl: 'c',
      coverFileId: 'cf',
      contentFileId: 'ct',
      apiBaseUrl: 'a',
    })
    expect(p.sessionId).toBeUndefined()
    expect(p.refreshToken).toBeUndefined()
    expect(h.get).not.toHaveBeenCalled()
    expect(localStorage.getItem('auth_token')).toBe('T')
    expect(sessionStorage.getItem('auth_token')).toBeNull()
  })

  it('A2 snake_case 도 같은 결과', async () => {
    const p = await propsAt(
      `/embed?template_set_id=ts1&token=T&order_seqno=123&parent_origin=${encodeURIComponent(PARENT)}` +
        '&page_count_min=16&page_count_max=300&page_step=4&spine_width_mm=5.5&refresh_token=R',
    )
    expect(p).toMatchObject({ templateSetId: 'ts1', orderSeqno: 123, parentOrigin: PARENT, refreshToken: 'R' })
    expect(p.options).toMatchObject({ pageCountMin: 16, pageCountMax: 300, pageStep: 4, spineWidthMm: 5.5 })
    expect(localStorage.getItem('auth_refresh_token')).toBe('R')
  })

  it('A3 pageCountMin/Max/pageStep 16/300/4', async () => {
    const p = await propsAt('/embed?templateSetId=ts1&pageCountMin=16&pageCountMax=300&pageStep=4')
    expect(p.options).toMatchObject({ pageCountMin: 16, pageCountMax: 300, pageStep: 4 })
  })

  it('A4 pageStep=1 → 1', async () => {
    const p = await propsAt('/embed?templateSetId=ts1&pageStep=1')
    expect(p.options?.pageStep).toBe(1)
  })

  it('A5 무효 쪽수 → undefined + 경고 3회', async () => {
    const p = await propsAt('/embed?templateSetId=ts1&pageCountMin=0&pageCountMax=501&pageStep=2.5')
    expect(p.options?.pageCountMin).toBeUndefined()
    expect(p.options?.pageCountMax).toBeUndefined()
    expect(p.options?.pageStep).toBeUndefined()
    expect(warnSpy).toHaveBeenCalledTimes(3)
  })

  it('A6 쪽수 미전달 → 세 키는 존재하고 값은 undefined', async () => {
    const p = await propsAt('/embed?templateSetId=ts1')
    const options = p.options ?? {}
    for (const k of ['pageCountMin', 'pageCountMax', 'pageStep'] as const) {
      expect(k in options).toBe(true)
      expect(options[k]).toBeUndefined()
    }
  })

  it("A7 책등: paperType '-' → undefined, bindingType trim, spineWidthMm '0' → 0, 음수 → undefined", async () => {
    const p = await propsAt('/embed?templateSetId=ts1&paperType=-&bindingType=%20perfect%20&spineWidthMm=0')
    expect(p.options?.paperType).toBeUndefined()
    expect(p.options?.bindingType).toBe('perfect')
    expect(p.options?.spineWidthMm).toBe(0)

    h.editorProps.length = 0
    const neg = await propsAt('/embed?templateSetId=ts1&spineWidthMm=-1')
    expect(neg.options?.spineWidthMm).toBeUndefined()
  })

  it('A8 wingEnabled 1/0/미전달, wingWidthMm', async () => {
    const on = await propsAt('/embed?templateSetId=ts1&wingEnabled=1&wingWidthMm=15')
    expect(on.options?.wingEnabled).toBe(true)
    expect(on.options?.wingWidthMm).toBe(15)

    h.editorProps.length = 0
    const onTrue = await propsAt('/embed?templateSetId=ts1&wingEnabled=true')
    expect(onTrue.options?.wingEnabled).toBe(true)

    h.editorProps.length = 0
    const off = await propsAt('/embed?templateSetId=ts1&wingEnabled=0')
    expect(off.options?.wingEnabled).toBe(false)

    h.editorProps.length = 0
    const none = await propsAt('/embed?templateSetId=ts1')
    expect(none.options?.wingEnabled).toBeUndefined()
    expect(none.options?.wingWidthMm).toBeUndefined()
  })

  it('A9 contentPdfAttach 미전달/0/false/1', async () => {
    const cases: Array<[string, boolean | undefined]> = [
      ['', undefined],
      ['&contentPdfAttach=0', false],
      ['&contentPdfAttach=false', false],
      ['&contentPdfAttach=1', true],
    ]
    for (const [qs, expected] of cases) {
      h.editorProps.length = 0
      const p = await propsAt(`/embed?templateSetId=ts1${qs}`)
      expect(p.options?.contentPdfAttach, qs).toBe(expected)
    }
  })

  it('A10 size 는 width·height 둘 다 있을 때만, quantity·title·productName·pageCount', async () => {
    const p = await propsAt(
      '/embed?templateSetId=ts1&width=210&height=297&quantity=2&title=%EC%A0%9C%EB%AA%A9&productName=Book&pageCount=24',
    )
    expect(p.options).toMatchObject({
      size: { width: 210, height: 297 },
      quantity: 2,
      title: '제목',
      productName: 'Book',
      pageCount: 24,
    })

    h.editorProps.length = 0
    const widthOnly = await propsAt('/embed?templateSetId=ts1&width=210')
    expect(widthOnly.options?.size).toBeUndefined()
  })
})

describe('EmbedView — B. 세션·재편집', () => {
  it('B11 sessionId 만 → 세션 조회로 templateSetId 도출, 조회 시점에 토큰 선주입 완료', async () => {
    let tokenAtCall: string | null = null
    h.get.mockImplementation(async () => {
      tokenAtCall = localStorage.getItem('auth_token')
      return { templateSetId: 'ts9' }
    })
    const p = await propsAt('/embed?sessionId=s1&token=T')
    expect(h.get).toHaveBeenCalledWith('s1')
    expect(tokenAtCall).toBe('T')
    expect(p.templateSetId).toBe('ts9')
    expect(p.sessionId).toBe('s1')
  })

  it('B12 sessionId + templateSetId → 세션 조회 없음', async () => {
    const p = await propsAt('/embed?sessionId=s1&templateSetId=ts1')
    expect(h.get).not.toHaveBeenCalled()
    expect(p.templateSetId).toBe('ts1')
  })

  it('B13 세션 조회 실패 → 세션 템플릿셋 문구, 편집기 미렌더', async () => {
    h.get.mockRejectedValue(new Error('stub'))
    renderAt('/embed?sessionId=s1')
    expect(await screen.findByText(/세션에서 템플릿셋을 확인할 수 없습니다/)).toBeInTheDocument()
    expect(h.editorProps).toHaveLength(0)
  })

  it('B14 파라미터 없음 → 필수 파라미터 문구', async () => {
    renderAt('/embed')
    expect(await screen.findByText('templateSetId 또는 유효한 sessionId 가 필요합니다.')).toBeInTheDocument()
    expect(h.get).not.toHaveBeenCalled()
    expect(h.editorProps).toHaveLength(0)
  })
})

describe('EmbedView — C. adminEdit=session fragment 토큰', () => {
  const Q = '/embed?sessionId=s1&templateSetId=ts1&adminEdit=session'

  it('C15 fragment 토큰 → props·sessionStorage, localStorage 미사용, 주소창 fragment 제거·쿼리 보존', async () => {
    const p = await propsAtWithHash(Q, '#token=A&refreshToken=R')
    expect(p.token).toBe('A')
    expect(p.refreshToken).toBe('R')
    expect(sessionStorage.getItem('auth_token')).toBe('A')
    expect(sessionStorage.getItem('auth_refresh_token')).toBe('R')
    expect(sessionStorage.getItem('storige_admin_edit')).toBe('1')
    expect(localStorage.getItem('auth_token')).toBeNull()
    expect(localStorage.getItem('auth_refresh_token')).toBeNull()
    expect(window.location.hash).not.toContain('token')
    expect(window.location.search).toBe('?sessionId=s1&templateSetId=ts1&adminEdit=session')
  })

  it('C16 fragment 가 쿼리 token 보다 우선', async () => {
    const p = await propsAtWithHash(`${Q}&token=Q`, '#token=A')
    expect(p.token).toBe('A')
    expect(sessionStorage.getItem('auth_token')).toBe('A')
  })

  it('C17 fragment 가 없으면 쿼리 token 폴백(sessionStorage 저장)', async () => {
    const p = await propsAtWithHash(`${Q}&token=Q`, '')
    expect(p.token).toBe('Q')
    expect(sessionStorage.getItem('auth_token')).toBe('Q')
    expect(localStorage.getItem('auth_token')).toBeNull()
  })

  it('C18 fragment refresh_token(snake) 인식', async () => {
    const p = await propsAtWithHash(Q, '#token=A&refresh_token=R2')
    expect(p.refreshToken).toBe('R2')
    expect(sessionStorage.getItem('auth_refresh_token')).toBe('R2')
  })

  it('C19 adminEdit 없으면 fragment 무시, 기존 관리자 탭 플래그 해제, localStorage 사용', async () => {
    sessionStorage.setItem('storige_admin_edit', '1')
    const p = await propsAtWithHash('/embed?templateSetId=ts1&token=Q', '#token=X')
    expect(p.token).toBe('Q')
    expect(sessionStorage.getItem('storige_admin_edit')).toBeNull()
    expect(localStorage.getItem('auth_token')).toBe('Q')
    expect(sessionStorage.getItem('auth_token')).toBeNull()

    h.editorProps.length = 0
    const none = await propsAtWithHash('/embed?templateSetId=ts1', '#token=X')
    expect(none.token).toBeUndefined()
  })
})

describe('EmbedView — D. 레거시 dual-emit', () => {
  const realParent = Object.getOwnPropertyDescriptor(window, 'parent')
  const parentPost = vi.fn<(message: unknown, targetOrigin: string) => void>()

  function stubParent(): void {
    Object.defineProperty(window, 'parent', {
      value: { postMessage: parentPost },
      configurable: true,
      writable: true,
    })
  }

  beforeEach(() => {
    parentPost.mockReset()
    stubParent()
  })

  afterEach(() => {
    if (realParent) Object.defineProperty(window, 'parent', realParent)
  })

  const WITH_ORIGIN = `/embed?templateSetId=ts1&sessionId=s1&parentOrigin=${encodeURIComponent(PARENT)}`
  const NO_ORIGIN = '/embed?templateSetId=ts1&sessionId=s1'

  it('D20 onReady → storige:ready {templateSetId, sessionId} → parentOrigin', async () => {
    const p = await propsAt(WITH_ORIGIN)
    p.onReady?.()
    expect(parentPost).toHaveBeenCalledWith(
      { type: 'storige:ready', payload: { templateSetId: 'ts1', sessionId: 's1' } },
      PARENT,
    )
  })

  it('D21 onSave → storige:saved {sessionId, savedAt}', async () => {
    const p = await propsAt(WITH_ORIGIN)
    p.onSave?.({ sessionId: 's', savedAt: 't', thumbnail: 'ignored' })
    expect(parentPost).toHaveBeenCalledWith({ type: 'storige:saved', payload: { sessionId: 's', savedAt: 't' } }, PARENT)
  })

  it("D22 회원 완료: status 'completed' 리터럴, files null 병합, 선택 키 없음", async () => {
    const p = await propsAt(WITH_ORIGIN)
    p.onComplete?.(result({ sessionId: 's', orderSeqno: 5, savedAt: 't', files: { coverFileId: 'c' } }))
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
        files: { coverFileId: 'c', contentFileId: null },
      },
    })
    const payload = (msg as { payload: Record<string, unknown> }).payload
    for (const k of ['needsAuth', 'guestToken', 'pageCount', 'size', 'pricing', 'spineWidthMm']) {
      expect(k in payload, k).toBe(false)
    }
  })

  it('D23 pageCount 0·spineWidthMm 0·size·pricing 포함(!= null 판정)', async () => {
    const p = await propsAt(WITH_ORIGIN)
    const size = { width: 210, height: 297, unit: 'mm' as const }
    const pricing = { basePrice: 1000 } as unknown as EditorResult['pricing']
    p.onComplete?.(result({ pageCount: 0, spineWidthMm: 0, size, pricing }))
    const payload = (parentPost.mock.calls[0][0] as { payload: Record<string, unknown> }).payload
    expect(payload.pageCount).toBe(0)
    expect(payload.spineWidthMm).toBe(0)
    expect(payload.size).toEqual(size)
    expect(payload.pricing).toEqual(pricing)
  })

  it('D24 게스트 완료 + parentOrigin → needsAuth·guestToken 포함, targetOrigin=parentOrigin', async () => {
    const p = await propsAt(WITH_ORIGIN)
    p.onComplete?.(result({ needsAuth: true, guestToken: 'g' }))
    const [msg, origin] = parentPost.mock.calls[0]
    const payload = (msg as { payload: Record<string, unknown> }).payload
    expect(origin).toBe(PARENT)
    expect(payload.needsAuth).toBe(true)
    expect(payload.guestToken).toBe('g')
    expect(payload.status).toBe('completed')
  })

  it("D25 게스트 완료 + parentOrigin 없음 → guestToken 키 없음, targetOrigin '*' (sessionId 는 범위 밖)", async () => {
    // 와일드카드 송신에 싣지 않는 대상은 token·guestToken 이다. sessionId 는 기존 레거시 계약대로
    // 포함되며(현행 동작 잠금), 이 불변식의 범위 밖이다.
    const p = await propsAt(NO_ORIGIN)
    p.onComplete?.(result({ sessionId: 's1', needsAuth: true, guestToken: 'g' }))
    const [msg, origin] = parentPost.mock.calls[0]
    const payload = (msg as { payload: Record<string, unknown> }).payload
    expect(origin).toBe('*')
    expect(payload.needsAuth).toBe(true)
    expect('guestToken' in payload).toBe(false)
    expect('token' in payload).toBe(false)
    expect(payload.sessionId).toBe('s1')

    // ready·saved 도 와일드카드 송신(현행) — sessionId 포함, 자격증명 키 없음
    parentPost.mockReset()
    p.onReady?.()
    p.onSave?.({ sessionId: 's1', savedAt: 't' })
    for (const [m, o] of parentPost.mock.calls) {
      expect(o).toBe('*')
      const pl = (m as { payload: Record<string, unknown> }).payload
      expect(pl.sessionId).toBe('s1')
      expect('guestToken' in pl).toBe(false)
      expect('token' in pl).toBe(false)
    }
  })

  it('D26 cancel·error payload', async () => {
    const p = await propsAt(WITH_ORIGIN)
    p.onCancel?.()
    p.onError?.(new Error('e'))
    p.onError?.({ code: 'SAVE_FAILED', message: 'm' })
    expect(parentPost.mock.calls).toEqual([
      [{ type: 'storige:cancel', payload: {} }, PARENT],
      [{ type: 'storige:error', payload: { message: 'e' } }, PARENT],
      [{ type: 'storige:error', payload: { message: 'm' } }, PARENT],
    ])
  })

  it('D27 top-level(window.parent === window)이면 postMessage 없음', async () => {
    Object.defineProperty(window, 'parent', { value: window, configurable: true, writable: true })
    const spy = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const p = await propsAt(WITH_ORIGIN)
    p.onReady?.()
    p.onComplete?.(result({}))
    expect(spy).not.toHaveBeenCalled()
    expect(parentPost).not.toHaveBeenCalled()
  })

  it('D28 postMessage 가 throw 해도 콜백은 throw 하지 않고 경고', async () => {
    parentPost.mockImplementation(() => {
      throw new Error('blocked')
    })
    const p = await propsAt(WITH_ORIGIN)
    expect(() => p.onReady?.()).not.toThrow()
    expect(warnSpy).toHaveBeenCalledWith('[EmbedView] legacy postMessage failed:', expect.any(Error))
  })
})

describe('EmbedView — E. 게스트 세션 재오픈(fragment 게스트 토큰)', () => {
  const realParent = Object.getOwnPropertyDescriptor(window, 'parent')
  const parentPost = vi.fn<(message: unknown, targetOrigin: string) => void>()
  const RECORD_KEY = 'storige_embed_guest_v1:s1'
  const G = 'g-tok+/='

  function axiosHttpError(status: number, data: Record<string, unknown> = {}, token?: string): AxiosError {
    const headers = new AxiosHeaders()
    if (token) headers.set('x-guest-token', token)
    const cfg = { url: '/edit-sessions/guest/s1', method: 'get', headers } as InternalAxiosRequestConfig
    return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', cfg, undefined, {
      status,
      data,
      statusText: '',
      headers: {},
      config: cfg,
    })
  }

  function formalErrors(): Array<Record<string, unknown>> {
    return parentPost.mock.calls
      .map(([m]) => m as { source?: string; event?: string; payload?: Record<string, unknown> })
      .filter((m) => m.source === 'storige-editor' && m.event === 'editor.error')
      .map((m) => m.payload ?? {})
  }

  beforeEach(() => {
    parentPost.mockReset()
    Object.defineProperty(window, 'parent', {
      value: { postMessage: parentPost },
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    if (realParent) Object.defineProperty(window, 'parent', realParent)
  })

  it('E1 sessionId + #guestToken → cfg.guestToken, 탭 저장소 미기록, 주소창 fragment 제거·쿼리 보존', async () => {
    const p = await propsAtWithHash('/embed?sessionId=s1&templateSetId=ts1', `#guestToken=${encodeURIComponent(G)}`)
    expect(p.guestToken).toBe(G)
    expect(sessionStorage.getItem(RECORD_KEY)).toBeNull()
    expect(window.location.hash).toBe('')
    expect(window.location.search).toBe('?sessionId=s1&templateSetId=ts1')
    expect(h.getGuest).not.toHaveBeenCalled()
  })

  it('E1 #guest_token(snake) 도 인식한다', async () => {
    const p = await propsAtWithHash('/embed?sessionId=s1&templateSetId=ts1', '#guest_token=G2')
    expect(p.guestToken).toBe('G2')
    expect(window.location.hash).toBe('')
  })

  it('E2 쿼리 ?guestToken= 은 읽지도 지우지도 않는다(cfg 없음, 기록 없음)', async () => {
    const p = await propsAtWithHash('/embed?sessionId=s1&templateSetId=ts1&guestToken=Q', '')
    expect('guestToken' in p).toBe(false)
    expect(sessionStorage.getItem(RECORD_KEY)).toBeNull()
    expect(window.location.search).toContain('guestToken=Q')
  })

  it('E3 adminEdit=session 에서는 게스트 토큰을 쓰지 않고 두 키 모두 주소창에서 지운다', async () => {
    const p = await propsAtWithHash(
      '/embed?sessionId=s1&templateSetId=ts1&adminEdit=session',
      `#token=A&guestToken=${G}`,
    )
    expect(p.token).toBe('A')
    expect('guestToken' in p).toBe(false)
    expect(sessionStorage.getItem(RECORD_KEY)).toBeNull()
    expect(window.location.hash).toBe('')
  })

  it('E4 sessionId 만 + fragment → templateSetId 도출은 getGuest(s1, G), 기존 조회 경로 미호출', async () => {
    h.getGuest.mockResolvedValue({ templateSetId: 'ts9', guestToken: G })
    const p = await propsAtWithHash('/embed?sessionId=s1&token=T', `#guestToken=${encodeURIComponent(G)}`)
    expect(h.getGuest).toHaveBeenCalledWith('s1', G)
    expect(h.get).not.toHaveBeenCalled()
    expect(p.templateSetId).toBe('ts9')
    expect(p.guestToken).toBe(G)
  })

  it('E4 fragment 토큰이 거절되면 기억된 토큰 1회 → 성공, 기존 조회 경로 미호출', async () => {
    sessionStorage.setItem(RECORD_KEY, JSON.stringify({ guestToken: 'remembered', expiresAt: null }))
    h.getGuest.mockImplementation(async (_id, token) => {
      if (token === 'remembered') return { templateSetId: 'ts9' }
      throw axiosHttpError(403, { code: 'GUEST_TOKEN_MISMATCH' }, token)
    })
    const p = await propsAtWithHash('/embed?sessionId=s1', '#guestToken=wrong')
    expect(h.getGuest.mock.calls).toEqual([
      ['s1', 'wrong'],
      ['s1', 'remembered'],
    ])
    expect(h.get).not.toHaveBeenCalled()
    expect(p.templateSetId).toBe('ts9')
    // 기억된 토큰은 유지된다(fragment 토큰으로 덮어쓰지 않음)
    expect(JSON.parse(sessionStorage.getItem(RECORD_KEY) as string).guestToken).toBe('remembered')
  })

  it('E5 sessionId 없이 fragment 만 → cfg 없음, 기록 없음, 주소창에서 제거', async () => {
    const p = await propsAtWithHash('/embed?templateSetId=ts1', `#guestToken=${encodeURIComponent(G)}`)
    expect('guestToken' in p).toBe(false)
    expect(sessionStorage.length).toBe(0)
    expect(window.location.hash).toBe('')
  })

  it('E6 StrictMode 이중 effect 에서도 fragment 토큰이 유지된다', async () => {
    h.getGuest.mockResolvedValue({ templateSetId: 'ts9' })
    const path = '/embed?sessionId=s1'
    window.history.replaceState(null, '', `${path}#guestToken=${encodeURIComponent(G)}`)
    render(
      <StrictMode>
        <MemoryRouter initialEntries={[path]}>
          <EmbedView />
        </MemoryRouter>
      </StrictMode>,
    )
    await waitFor(() => expect(h.editorProps.length).toBeGreaterThan(0))
    const p = h.editorProps[h.editorProps.length - 1]
    expect(p.guestToken).toBe(G)
    expect(p.templateSetId).toBe('ts9')
    expect(h.getGuest.mock.calls.length).toBeGreaterThanOrEqual(2)
    for (const call of h.getGuest.mock.calls) expect(call).toEqual(['s1', G])
    expect(h.get).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('')
  })

  it('E7 운영자 토큰으로 sessionId 만 → 기존 조회 경로로 도출(getGuest 미호출)', async () => {
    h.get.mockResolvedValue({ templateSetId: 'ts9' })
    const p = await propsAt(`/embed?sessionId=s1&token=OP&parentOrigin=${encodeURIComponent(PARENT)}`)
    expect(h.get).toHaveBeenCalledWith('s1')
    expect(h.getGuest).not.toHaveBeenCalled()
    expect(p.templateSetId).toBe('ts9')
    expect('guestToken' in p).toBe(false)
    expect(formalErrors()).toHaveLength(0)
  })

  it("E8 토큰 없이 기존 조회 경로 403 GUEST_TOKEN_REQUIRED → editor.error(reason 'guest_token_required') 1회, 오류 화면 유지", async () => {
    h.get.mockRejectedValue(axiosHttpError(403, { code: 'GUEST_TOKEN_REQUIRED' }))
    renderAt(`/embed?sessionId=s1&parentOrigin=${encodeURIComponent(PARENT)}`)
    expect(await screen.findByText(/세션에서 템플릿셋을 확인할 수 없습니다/)).toBeInTheDocument()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    const errors = formalErrors()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      code: 'SESSION_NOT_FOUND',
      fatal: true,
      sessionId: 's1',
      reason: 'guest_token_required',
    })
    const formalCall = parentPost.mock.calls.find(([m]) => (m as { event?: string }).event === 'editor.error')
    expect(formalCall?.[1]).toBe(PARENT)
    expect(parentPost).toHaveBeenCalledWith(
      { type: 'storige:error', payload: { message: errors[0].message } },
      PARENT,
    )
    expect(h.editorProps).toHaveLength(0)
  })

  it.each([
    [404, {}, 'not_found'],
    [403, {}, 'forbidden'],
    [400, {}, 'invalid_id'],
  ] as const)('E9 도출 실패 %s → editor.error reason %s 1회', async (status, data, reason) => {
    h.get.mockRejectedValue(axiosHttpError(status, data))
    renderAt(`/embed?sessionId=s1&parentOrigin=${encodeURIComponent(PARENT)}`)
    expect(await screen.findByText(/세션에서 템플릿셋을 확인할 수 없습니다/)).toBeInTheDocument()
    const errors = formalErrors()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ code: 'SESSION_NOT_FOUND', fatal: true, sessionId: 's1', reason })
  })

  it("E10 제시 토큰이 GUEST_SESSION_EXPIRED → reason 'not_found', GUEST_TOKEN_MISMATCH → 'forbidden'", async () => {
    h.get.mockRejectedValue(axiosHttpError(403, { code: 'GUEST_TOKEN_REQUIRED' }))
    h.getGuest.mockRejectedValue(axiosHttpError(403, { code: 'GUEST_SESSION_EXPIRED' }, G))
    window.history.replaceState(null, '', `/embed?sessionId=s1#guestToken=${encodeURIComponent(G)}`)
    const expired = renderAt(`/embed?sessionId=s1&parentOrigin=${encodeURIComponent(PARENT)}`)
    expect(await expired.findByText(/세션에서 템플릿셋을 확인할 수 없습니다/)).toBeInTheDocument()
    expect(formalErrors()).toEqual([expect.objectContaining({ reason: 'not_found' })])
    expired.unmount()

    parentPost.mockReset()
    h.getGuest.mockRejectedValue(axiosHttpError(403, { code: 'GUEST_TOKEN_MISMATCH' }, G))
    window.history.replaceState(null, '', `/embed?sessionId=s1#guestToken=${encodeURIComponent(G)}`)
    const mismatch = renderAt(`/embed?sessionId=s1&parentOrigin=${encodeURIComponent(PARENT)}`)
    expect(await mismatch.findByText(/세션에서 템플릿셋을 확인할 수 없습니다/)).toBeInTheDocument()
    expect(formalErrors()).toEqual([expect.objectContaining({ reason: 'forbidden' })])
  })

  it('E11 5xx·비 HTTP 실패는 editor.error 없이 오류 화면만, 경고 로그에 토큰 원문 없음', async () => {
    h.getGuest.mockRejectedValue(axiosHttpError(503, {}, G))
    window.history.replaceState(null, '', `/embed?sessionId=s1#guestToken=${encodeURIComponent(G)}`)
    renderAt(`/embed?sessionId=s1&parentOrigin=${encodeURIComponent(PARENT)}`)
    expect(await screen.findByText(/세션에서 템플릿셋을 확인할 수 없습니다/)).toBeInTheDocument()
    expect(formalErrors()).toHaveLength(0)
    expect(h.get).not.toHaveBeenCalled()
    const logged = JSON.stringify(warnSpy.mock.calls)
    expect(logged).not.toContain(G)
    expect(logged).not.toContain(encodeURIComponent(G))
  })

  it('E12 parentOrigin 이 없으면 정식 editor.error 를 보내지 않는다', async () => {
    h.get.mockRejectedValue(axiosHttpError(404))
    renderAt('/embed?sessionId=s1')
    expect(await screen.findByText(/세션에서 템플릿셋을 확인할 수 없습니다/)).toBeInTheDocument()
    expect(formalErrors()).toHaveLength(0)
  })
})
