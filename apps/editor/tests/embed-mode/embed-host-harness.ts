/**
 * /embed 호스트 iframe 하네스
 *
 * - 호스트 페이지는 테스트 worker 가 띄운 로컬 http 서버(`http://127.0.0.1:<임의 포트>`)가 준다.
 *   이 페이지가 편집기(`/embed?...&parentOrigin=<호스트 출처>`)를 iframe 으로 띄운다.
 *   편집기는 iframe 안에서만 정식 postMessage 이벤트를 보내고 호스트 명령(getState·saveNow)에 응답한다.
 * - API(`http://localhost:4000/api/**`)는 BrowserContext 단위의 상태 보존형 모킹으로 응답한다.
 *   같은 context 의 새 page(재진입)도 같은 세션 저장소를 쓴다. API 요청은 실제 서버로 보내지 않는다.
 * - 편집기·API·호스트 출처가 아닌 요청은 중단하고 `blocked` 에 기록한다.
 * - 쪽수 단언은 postMessage `getState` 의 `pageCount` 와 DOM 으로 한다.
 *   `readEditorStoreLimits` 만 개발 서버(vite)에서 스토어 모듈을 직접 읽는다(개발 서버에서만 실행).
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, type BrowserContext, type FrameLocator, type Locator, type Page, type Route, type TestInfo } from '@playwright/test'

// ============================================================
// 상수·타입
// ============================================================

export const EDITOR_ORIGIN = 'http://localhost:3000'
export const API_ORIGIN = 'http://localhost:4000'
export const API_PREFIX = '/api'

export interface HostEvent {
  event: string
  payload: Record<string, unknown>
}

declare global {
  interface Window {
    __storigeHost?: {
      events: HostEvent[]
      send: (command: string, payload?: unknown) => string
    }
  }
}

export interface MockSession {
  id: string
  orderSeqno: number
  mode: string
  status: string
  templateSetId: string | null
  canvasData: unknown[] | Record<string, unknown> | null
  metadata: Record<string, unknown>
  guestToken: null
  guestExpiresAt: null
  callbackUrl: null
  coverFileId: null
  contentFileId: null
  createdAt: string
  updatedAt: string
  completedAt: null
}

export interface ApiCall {
  method: string
  path: string
  search: string
  body: unknown
}

export interface MockResponse {
  status: number
  body?: unknown
}

/** 테스트별 응답 교체. undefined 를 돌려주면 기본 모킹으로 처리한다. */
export type ApiOverride = (call: ApiCall, mock: MockApi) => MockResponse | undefined

export interface MockApi {
  /** 호스트 페이지 출처(편집기 URL 의 parentOrigin) */
  hostOrigin: string
  calls: ApiCall[]
  createBodies: Record<string, unknown>[]
  patchBodies: { id: string; body: Record<string, unknown> }[]
  sessions: Map<string, MockSession>
  unmatched: string[]
  blocked: string[]
  override: ApiOverride | null
  /** 세션 생성 본문으로 저장소에 세션을 만든다(기본 POST /edit-sessions 와 같은 처리). */
  commitSession: (body: Record<string, unknown>) => MockSession
}

export interface TemplateDetailMock {
  id: string
  name: string
  type: 'spread' | 'page' | 'cover'
  width: number
  height: number
  isDeleted: boolean
  canvasData: null
  thumbnailUrl: null
  spreadConfig: Record<string, unknown> | null
  required?: boolean
}

export interface TemplateSetMock {
  templateSet: Record<string, unknown>
  templateDetails: TemplateDetailMock[]
}

export interface EditorStateSnapshot {
  pageCount?: number
  sessionId: string | null
  ready: boolean
  dirty: boolean
}

export interface Diagnostics {
  warnings: string[]
  errors: string[]
  dialogs: string[]
  pageErrors: string[]
}

export interface StoreLimits {
  pageStep: number | null
  padToPageStep: boolean
  pageCountRange: number[]
}

// ============================================================
// 템플릿셋 빌더
// ============================================================

/** 표지 스프레드 스펙(tests/spread-mode/fixtures.ts MOCK_SPREAD_CONFIG 와 같은 형태) */
function coverSpreadConfig(conversionMode?: 'flat-spread'): Record<string, unknown> {
  return {
    spec: {
      coverWidthMm: 210,
      coverHeightMm: 297,
      spineWidthMm: 7.5,
      wingEnabled: false,
      wingWidthMm: 0,
      cutSizeMm: 2,
      safeSizeMm: 3,
      dpi: 150,
    },
    regions: [],
    totalWidthMm: 427.5,
    totalHeightMm: 297,
    ...(conversionMode ? { conversionMode } : {}),
  }
}

function baseTemplateSet(id: string, name: string, extra: Record<string, unknown>, details: TemplateDetailMock[]): TemplateSetMock {
  return {
    templateSet: {
      id,
      name,
      type: 'book',
      width: 210,
      height: 297,
      canAddPage: true,
      pageCountRange: [4, 100],
      pageStep: null,
      padToPageStep: false,
      editorMode: 'book',
      isActive: true,
      isDeleted: false,
      templates: details.map((d) => ({ templateId: d.id, required: d.required !== false })),
      ...extra,
    },
    templateDetails: details,
  }
}

const COVER_SPLIT_DETAIL: TemplateDetailMock = {
  id: 'tpl-e2e-cover',
  name: '표지',
  type: 'spread',
  width: 427.5,
  height: 297,
  isDeleted: false,
  canvasData: null,
  thumbnailUrl: null,
  spreadConfig: coverSpreadConfig(),
}

const INNER_SHEET_DETAIL: TemplateDetailMock = {
  id: 'tpl-e2e-inner',
  name: '내지',
  type: 'page',
  width: 210,
  height: 297,
  isDeleted: false,
  canvasData: null,
  thumbnailUrl: null,
  spreadConfig: null,
  required: false,
}

export const TS_A_ID = 'ts-e2e-spread'
export const TS_B_ID = 'ts-e2e-spread-step2'
export const TS_C_ID = 'ts-e2e-single'
export const TS_D_ID = 'ts-e2e-flat-inner-spread'

/** TS-A: 표지3분할 + 내지낱장(템플릿 범위 4~100, 단위 없음) */
export function templateSetA(): TemplateSetMock {
  return baseTemplateSet(TS_A_ID, 'E2E 표지3분할+내지낱장', {}, [COVER_SPLIT_DETAIL, INNER_SHEET_DETAIL])
}

/** TS-B: TS-A + 템플릿 내지 단위 2·배수 채움 */
export function templateSetB(): TemplateSetMock {
  return baseTemplateSet(TS_B_ID, 'E2E 표지3분할+내지낱장(2p 단위)', { pageStep: 2, padToPageStep: true }, [
    COVER_SPLIT_DETAIL,
    INNER_SHEET_DETAIL,
  ])
}

/** TS-C: 단일 모드(표지 1 + 내지 1, 범위 1~100) */
export function templateSetC(): TemplateSetMock {
  return baseTemplateSet(TS_C_ID, 'E2E 단일', { editorMode: 'single', pageCountRange: [1, 100] }, [
    {
      id: 'tpl-e2e-single-cover',
      name: '표지',
      type: 'cover',
      width: 210,
      height: 297,
      isDeleted: false,
      canvasData: null,
      thumbnailUrl: null,
      spreadConfig: null,
    },
    { ...INNER_SHEET_DETAIL, id: 'tpl-e2e-single-inner' },
  ])
}

/** TS-D: 표지펼침면(flat-spread) + 내지펼침면(캔버스 1장 = 2쪽) */
export function templateSetD(): TemplateSetMock {
  return baseTemplateSet(TS_D_ID, 'E2E 표지펼침면+내지펼침면', {}, [
    { ...COVER_SPLIT_DETAIL, id: 'tpl-e2e-flat-cover', name: '표지펼침면', spreadConfig: coverSpreadConfig('flat-spread') },
    {
      id: 'tpl-e2e-inner-spread',
      name: '내지펼침면',
      type: 'spread',
      width: 420,
      height: 297,
      isDeleted: false,
      canvasData: null,
      thumbnailUrl: null,
      spreadConfig: {
        regionScope: 'inner',
        innerSpec: { pageWidthMm: 210, pageHeightMm: 297, gutterMm: 0, cutSizeMm: 2, safeSizeMm: 3, dpi: 150 },
      },
      required: false,
    },
  ])
}

export function allTemplateSets(): Record<string, TemplateSetMock> {
  return {
    [TS_A_ID]: templateSetA(),
    [TS_B_ID]: templateSetB(),
    [TS_C_ID]: templateSetC(),
    [TS_D_ID]: templateSetD(),
  }
}

// ============================================================
// 호스트 페이지
// ============================================================

const HOST_PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>e2e host</title></head>
<body style="margin:0">
<iframe id="storige" style="width:1440px;height:900px;border:0"></iframe>
<script>
(function () {
  var EDITOR_ORIGIN = ${JSON.stringify(EDITOR_ORIGIN)};
  var frame = document.getElementById('storige');
  var events = [];
  var seq = 0;
  window.addEventListener('message', function (e) {
    if (e.origin !== EDITOR_ORIGIN) return;
    var d = e.data;
    if (!d || d.source !== 'storige-editor') return;
    events.push({ event: String(d.event), payload: d.payload && typeof d.payload === 'object' ? d.payload : {} });
  });
  window.__storigeHost = {
    events: events,
    send: function (command, payload) {
      seq += 1;
      var requestId = 'e2e-' + seq + '-' + Date.now();
      frame.contentWindow.postMessage(
        { source: 'storige-host', version: '1', command: command, requestId: requestId, payload: payload },
        EDITOR_ORIGIN
      );
      return requestId;
    }
  };
  var src = new URLSearchParams(location.search).get('src');
  if (src) frame.src = src;
})();
</script>
</body></html>`

// ============================================================
// API 모킹
// ============================================================

const NOT_FOUND: MockResponse = { status: 404, body: { statusCode: 404, message: 'Not Found' } }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function corsHeaders(route: Route): Record<string, string> {
  const requested = route.request().headers()['access-control-request-headers']
  return {
    'access-control-allow-origin': EDITOR_ORIGIN,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': requested || 'authorization,content-type,x-guest-token',
  }
}

function parseBody(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

function sessionsOfOrder(mock: MockApi, orderSeqno: number): MockSession[] {
  return [...mock.sessions.values()]
    .filter((s) => s.orderSeqno === orderSeqno)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
}

function defaultResponse(call: ApiCall, mock: MockApi, templateSets: Record<string, TemplateSetMock>): MockResponse | null {
  const { method, path } = call
  const segs = path.split('/').filter(Boolean)

  if (method === 'POST' && path === '/auth/me') {
    return { status: 200, body: { id: '1001', email: 'e2e@example.test', name: 'E2E', role: 'customer' } }
  }
  if (method === 'GET' && segs[0] === 'template-sets' && segs.length === 3 && segs[2] === 'with-templates') {
    const ts = templateSets[segs[1]]
    return ts ? { status: 200, body: ts } : NOT_FOUND
  }
  if (method === 'GET' && path === '/library/fonts') {
    return { status: 200, body: [] }
  }
  if (method === 'POST' && path === '/products/spine/calculate') {
    return { status: 200, body: { spineWidth: 5, paperThickness: 0.1, bindingMargin: 0, warnings: [], formula: 'e2e' } }
  }
  if (method === 'GET' && (path === '/products/spine/paper-types' || path === '/products/spine/binding-types')) {
    return { status: 200, body: [] }
  }

  if (segs[0] === 'edit-sessions') {
    if (method === 'GET' && segs.length === 1) {
      const orderSeqno = Number(new URLSearchParams(call.search).get('orderSeqno'))
      const sessions = sessionsOfOrder(mock, orderSeqno)
      return { status: 200, body: { sessions, total: sessions.length } }
    }
    if (method === 'POST' && segs.length === 1) {
      const body = isRecord(call.body) ? call.body : {}
      mock.createBodies.push(body)
      return { status: 201, body: mock.commitSession(body) }
    }
    if (method === 'POST' && segs.length === 2 && segs[1] === 'guest') {
      return { status: 500, body: { statusCode: 500, message: 'guest create is not expected in this test' } }
    }
    if (method === 'GET' && segs.length === 3 && segs[2] === 'versions') {
      return { status: 200, body: [] }
    }
    if (method === 'GET' && segs.length === 2) {
      const s = mock.sessions.get(segs[1])
      return s ? { status: 200, body: s } : NOT_FOUND
    }
    if (method === 'PATCH' && segs.length === 3 && segs[2] === 'complete') {
      const s = mock.sessions.get(segs[1])
      return s ? { status: 200, body: s } : NOT_FOUND
    }
    if (method === 'PATCH' && segs.length === 2) {
      const s = mock.sessions.get(segs[1])
      if (!s) return NOT_FOUND
      const body = isRecord(call.body) ? call.body : {}
      mock.patchBodies.push({ id: s.id, body })
      if ('canvasData' in body) {
        const cd = body.canvasData
        s.canvasData = Array.isArray(cd) ? cd : isRecord(cd) ? cd : null
      }
      if (isRecord(body.metadata)) s.metadata = { ...s.metadata, ...body.metadata }
      if (typeof body.status === 'string') s.status = body.status
      s.updatedAt = new Date().toISOString()
      return { status: 200, body: s }
    }
  }
  return null
}

let hostServer: Promise<string> | null = null

/** worker 당 1개의 호스트 페이지 서버를 띄우고 출처를 돌려준다. */
export function ensureHostServer(): Promise<string> {
  if (!hostServer) {
    hostServer = new Promise<string>((resolve, reject) => {
      const server: Server = createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(HOST_PAGE_HTML)
      })
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.unref()
        const { port } = server.address() as AddressInfo
        resolve(`http://127.0.0.1:${port}`)
      })
    })
  }
  return hostServer
}

/**
 * BrowserContext 에 API 모킹·외부 요청 차단을 등록하고 호스트 페이지 서버를 준비한다.
 * Playwright 는 나중에 등록한 라우트를 먼저 매칭하므로 차단 → API 순서로 등록한다.
 */
export async function installEmbedHarness(
  context: BrowserContext,
  opts: { templateSets: Record<string, TemplateSetMock> },
): Promise<MockApi> {
  let seq = 0
  const mock: MockApi = {
    hostOrigin: await ensureHostServer(),
    calls: [],
    createBodies: [],
    patchBodies: [],
    sessions: new Map<string, MockSession>(),
    unmatched: [],
    blocked: [],
    override: null,
    commitSession: (body: Record<string, unknown>): MockSession => {
      seq += 1
      const now = new Date(Date.now() + seq).toISOString()
      const session: MockSession = {
        id: `e2e-session-${seq}`,
        orderSeqno: Number(body.orderSeqno),
        mode: typeof body.mode === 'string' ? body.mode : 'both',
        status: 'editing',
        templateSetId: typeof body.templateSetId === 'string' ? body.templateSetId : null,
        canvasData: null,
        metadata: isRecord(body.metadata) ? { ...body.metadata } : {},
        guestToken: null,
        guestExpiresAt: null,
        callbackUrl: null,
        coverFileId: null,
        contentFileId: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      }
      mock.sessions.set(session.id, session)
      return session
    },
  }

  const hostPort = new URL(mock.hostOrigin).port
  await context.route(new RegExp(`^https?://(?!localhost:3000/|localhost:4000/|127\\.0\\.0\\.1:${hostPort}/)`), async (route) => {
    mock.blocked.push(route.request().url())
    await route.abort()
  })

  await context.route(`${API_ORIGIN}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const headers = corsHeaders(route)
    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers })
      return
    }
    const path = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) : url.pathname
    const call: ApiCall = { method, path, search: url.search, body: parseBody(request.postData()) }
    mock.calls.push(call)

    const overridden = mock.override ? mock.override(call, mock) : undefined
    let res = overridden ?? defaultResponse(call, mock, opts.templateSets)
    if (!res) {
      mock.unmatched.push(`${method} ${path}`)
      res = method === 'GET' ? NOT_FOUND : { status: 200, body: {} }
    }
    await route.fulfill({
      status: res.status,
      headers,
      contentType: 'application/json',
      body: res.status === 204 ? '' : JSON.stringify(res.body ?? {}),
    })
  })

  return mock
}

// ============================================================
// 진입·진단
// ============================================================

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

/** 테스트용 회원 토큰(sub=1001) */
export const E2E_MEMBER_TOKEN = `${base64UrlJson({ alg: 'HS256', typ: 'JWT' })}.${base64UrlJson({
  sub: '1001',
  siteId: 'site-e2e',
  exp: 4102444800,
})}.e2e`

export function buildEmbedUrl(hostOrigin: string, params: Record<string, string | number>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) q.set(k, String(v))
  q.set('token', E2E_MEMBER_TOKEN)
  q.set('parentOrigin', hostOrigin)
  return `${EDITOR_ORIGIN}/embed?${q.toString()}`
}

export function editorFrame(page: Page): FrameLocator {
  return page.frameLocator('#storige')
}

export async function openEmbed(page: Page, mock: MockApi, params: Record<string, string | number>): Promise<FrameLocator> {
  await page.goto(`${mock.hostOrigin}/?src=${encodeURIComponent(buildEmbedUrl(mock.hostOrigin, params))}`)
  return editorFrame(page)
}

/** page 의 콘솔(하위 frame 포함) 경고·오류, dialog, 처리되지 않은 예외를 모은다. dialog 는 닫는다. */
export function captureDiagnostics(page: Page): Diagnostics {
  const diag: Diagnostics = { warnings: [], errors: [], dialogs: [], pageErrors: [] }
  page.on('console', (msg) => {
    const type = msg.type()
    if (type === 'warning') diag.warnings.push(msg.text())
    else if (type === 'error') diag.errors.push(msg.text())
  })
  page.on('dialog', (d) => {
    diag.dialogs.push(d.message())
    void d.dismiss().catch(() => undefined)
  })
  page.on('pageerror', (err) => {
    diag.pageErrors.push(`${err.name}: ${err.message}`)
  })
  return diag
}

export async function hostEvents(page: Page): Promise<HostEvent[]> {
  return page.evaluate(() => (window.__storigeHost ? window.__storigeHost.events.slice() : []))
}

async function sendCommand(page: Page, command: string, payload?: unknown): Promise<string> {
  return page.evaluate(
    ([c, p]) => {
      if (!window.__storigeHost) throw new Error('host harness not ready')
      return window.__storigeHost.send(c, p)
    },
    [command, payload] as const,
  )
}

async function waitEvent(page: Page, event: string, requestId: string, timeout: number): Promise<HostEvent> {
  let found: HostEvent | undefined
  await expect
    .poll(
      async () => {
        found = (await hostEvents(page)).find((e) => e.event === event && e.payload.requestId === requestId)
        return found !== undefined
      },
      { timeout, message: `${event} 응답 대기(requestId=${requestId})` },
    )
    .toBe(true)
  if (!found) throw new Error(`${event} 응답 없음`)
  return found
}

/** 지정 이벤트가 처음 들어올 때까지 기다린다. */
export async function waitForHostEvent(page: Page, event: string, timeout = 90_000): Promise<HostEvent> {
  let found: HostEvent | undefined
  await expect
    .poll(
      async () => {
        found = (await hostEvents(page)).find((e) => e.event === event)
        return found !== undefined
      },
      { timeout, message: `${event} 이벤트 대기` },
    )
    .toBe(true)
  if (!found) throw new Error(`${event} 이벤트 없음`)
  return found
}

/**
 * editor.ready 를 기다린 뒤 샘플 템플릿셋 폴백이 없고(ready.payload.fallback 없음·매핑 알림 없음)
 * editor.error 가 없음을 확인한다.
 */
export async function waitReady(page: Page, diag: Diagnostics, timeout = 90_000): Promise<HostEvent> {
  let status: 'pending' | 'ready' | 'error' = 'pending'
  await expect
    .poll(
      async () => {
        const events = await hostEvents(page)
        if (events.some((e) => e.event === 'editor.error')) status = 'error'
        else if (events.some((e) => e.event === 'editor.ready')) status = 'ready'
        return status
      },
      { timeout, message: 'editor.ready 대기' },
    )
    .not.toBe('pending')
  const events = await hostEvents(page)
  const errors = events.filter((e) => e.event === 'editor.error')
  expect(errors, `editor.error: ${JSON.stringify(errors.map((e) => e.payload))}`).toHaveLength(0)
  const ready = events.find((e) => e.event === 'editor.ready')
  if (!ready) throw new Error('editor.ready 없음')
  expect(ready.payload).not.toHaveProperty('fallback')
  expect(diag.dialogs.filter((m) => m.includes('템플릿셋 매핑'))).toHaveLength(0)
  return ready
}

export async function getState(page: Page, timeout = 15_000): Promise<EditorStateSnapshot> {
  const requestId = await sendCommand(page, 'getState')
  const ev = await waitEvent(page, 'editor.state', requestId, timeout)
  const p = ev.payload
  return {
    ...(typeof p.pageCount === 'number' ? { pageCount: p.pageCount } : {}),
    sessionId: typeof p.sessionId === 'string' ? p.sessionId : null,
    ready: p.ready === true,
    dirty: p.dirty === true,
  }
}

export async function expectPageCount(page: Page, n: number, timeout = 30_000): Promise<void> {
  await expect.poll(async () => (await getState(page)).pageCount, { timeout, message: `pageCount=${n} 대기` }).toBe(n)
}

/** 호스트 saveNow → editor.saved ok. 진행 중 저장과 겹쳐 EDITOR_BUSY 가 오면 잠시 뒤 다시 요청한다. */
export async function saveNow(page: Page, attempts = 10): Promise<void> {
  let last: Record<string, unknown> = {}
  for (let i = 0; i < attempts; i++) {
    const requestId = await sendCommand(page, 'saveNow')
    const ev = await waitEvent(page, 'editor.saved', requestId, 30_000)
    last = ev.payload
    if (last.ok === true) return
    if (last.error !== 'EDITOR_BUSY') break
    await page.waitForTimeout(500)
  }
  throw new Error(`saveNow 실패: ${JSON.stringify(last)}`)
}

// ============================================================
// DOM 헬퍼
// ============================================================

export function addPageButton(frame: FrameLocator): Locator {
  return frame.locator('button[title="내지 페이지 추가"]')
}

export function maxReachedButton(frame: FrameLocator): Locator {
  return frame.locator('button[title="최대 페이지 수에 도달했습니다"]')
}

export async function clickAddPage(frame: FrameLocator): Promise<void> {
  await addPageButton(frame).click()
}

/**
 * 마지막 내지의 삭제 버튼(hover 시 표시)을 누른다. 페이지 목록이 새 페이지로 스크롤하는 중일 수 있어
 * 버튼 위치가 멈춘 뒤(trial 클릭의 안정 대기) 누른다.
 */
export async function clickDeleteLastPage(frame: FrameLocator): Promise<void> {
  const button = frame.locator('button[title="페이지 삭제"]').last()
  await button.scrollIntoViewIfNeeded()
  await button.click({ trial: true })
  await button.click({ force: true })
}

/** 내지 배수 경고(role=alert). 여러 위치에 렌더될 수 있어 텍스트로 거른다. */
export function pageStepAlert(frame: FrameLocator, text: string): Locator {
  return frame.locator('[role="alert"]').filter({ hasText: text })
}

export function anyPageStepAlert(frame: FrameLocator): Locator {
  return frame.locator('[role="alert"]').filter({ hasText: '페이지 단위로만 주문할 수 있습니다' })
}

/** 알림 영역의 토스트 */
export function toast(frame: FrameLocator, text: string): Locator {
  return frame.getByRole('region', { name: '알림' }).getByRole('status').filter({ hasText: text })
}

// ============================================================
// 개발 서버 전용 스토어 읽기
// ============================================================

/**
 * 개발 서버에서만 실행: 편집기 iframe 에서 vite 모듈 `/src/stores/useEditorStore.ts` 를 불러
 * pageStep·padToPageStep·pageCountRange 를 읽는다. 빌드 산출물 대상 실행에서는 쓸 수 없다.
 */
export async function readEditorStoreLimits(page: Page): Promise<StoreLimits> {
  const frame = page.frame({ url: /\/embed/ })
  if (!frame) throw new Error('편집기 frame 없음')
  const raw: unknown = await frame.evaluate(
    "import('/src/stores/useEditorStore.ts').then(m => { const s = m.useEditorStore.getState(); return { pageStep: s.pageStep, padToPageStep: s.padToPageStep, pageCountRange: s.pageCountRange } })",
  )
  if (!isRecord(raw)) throw new Error('스토어 값을 읽지 못함')
  return {
    pageStep: typeof raw.pageStep === 'number' ? raw.pageStep : null,
    padToPageStep: raw.padToPageStep === true,
    pageCountRange: Array.isArray(raw.pageCountRange) ? raw.pageCountRange.filter((n): n is number => typeof n === 'number') : [],
  }
}

// ============================================================
// 공통 단언
// ============================================================

/** 생성 본문의 metadata.orderOptions */
export function orderOptionsOf(body: Record<string, unknown>): Record<string, unknown> {
  const metadata = isRecord(body.metadata) ? body.metadata : {}
  return isRecord(metadata.orderOptions) ? metadata.orderOptions : {}
}

export function countCalls(mock: MockApi, method: string, test: (path: string, search: string) => boolean, from = 0): number {
  return mock.calls.slice(from).filter((c) => c.method === method && test(c.path, c.search)).length
}

export const isCreatePath = (path: string): boolean => path === '/edit-sessions'
export const isOrderListCall = (path: string, search: string): boolean =>
  path === '/edit-sessions' && new URLSearchParams(search).has('orderSeqno')

/**
 * 매 테스트 끝 공통 확인: API 요청 차단 0, 비회원 생성 0, 처리되지 않은 예외 0, CORS 콘솔 오류 0.
 * 미매칭 엔드포인트·세션 생성 횟수는 annotation 으로 남긴다.
 */
export function expectHarnessClean(mock: MockApi, diags: Diagnostics[], testInfo: TestInfo): void {
  testInfo.annotations.push({ type: 'createCount', description: String(mock.createBodies.length) })
  if (mock.unmatched.length > 0) {
    testInfo.annotations.push({ type: 'unmatched', description: [...new Set(mock.unmatched)].join(', ') })
  }
  expect(mock.blocked.filter((u) => u.includes('/api/'))).toHaveLength(0)
  expect(countCalls(mock, 'POST', (p) => p === '/edit-sessions/guest')).toBe(0)
  expect(diags.flatMap((d) => d.pageErrors)).toEqual([])
  expect(diags.flatMap((d) => d.errors).filter((e) => /CORS|Access-Control/i.test(e))).toEqual([])
}
