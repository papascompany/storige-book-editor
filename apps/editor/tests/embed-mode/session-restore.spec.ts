/**
 * /embed 주문 세션 열기 — 실브라우저 스펙
 *
 * 호스트 iframe 하네스(embed-host-harness.ts)로 `/embed?templateSetId&orderSeqno&mode=both` 를 연다.
 * 편집기는 주문 세션 목록(GET /edit-sessions?orderSeqno=)에서 저장된 세션(canvasData 있음)을 먼저 고르고,
 * 목록이 비었거나 목록 조회가 404 면 새 세션을 만든다. 목록 조회가 서버 오류면 세션을 만들지 않고
 * editor.error(NETWORK_ERROR) 를 보낸다.
 * 회원 세션 생성이 408·5xx 면 주문 목록을 한 번 다시 조회해 같은 mode·templateSetId 의 세션을 쓰고,
 * 없으면 한 번만 다시 보낸다.
 *
 * 개발 서버는 React StrictMode 라 초기화가 2회 실행될 수 있다. 요청 횟수는 초기화 1회당 관계로 확인한다.
 */
import { test, expect, type Page } from '@playwright/test'
import {
  allTemplateSets,
  captureDiagnostics,
  countCalls,
  expectHarnessClean,
  getState,
  hostEvents,
  installEmbedHarness,
  isCreatePath,
  isOrderListCall,
  openEmbed,
  saveNow,
  TS_A_ID,
  waitForHostEvent,
  waitReady,
  type ApiCall,
  type HostEvent,
  type MockApi,
} from './embed-host-harness'

test.use({ viewport: { width: 1480, height: 960 } })
test.setTimeout(120_000)

function newOrderParams(orderSeqno: number): Record<string, string | number> {
  return { templateSetId: TS_A_ID, orderSeqno, mode: 'both' }
}

const createPosts = (mock: MockApi, from = 0): number => countCalls(mock, 'POST', isCreatePath, from)
const orderListGets = (mock: MockApi, from = 0): number => countCalls(mock, 'GET', isOrderListCall, from)

const isCreateCall = (call: ApiCall): boolean => call.method === 'POST' && isCreatePath(call.path)
const isOrderListGet = (call: ApiCall): boolean => call.method === 'GET' && isOrderListCall(call.path, call.search)

async function editorErrors(page: Page): Promise<HostEvent[]> {
  return (await hostEvents(page)).filter((e) => e.event === 'editor.error')
}

test.describe('Embed 주문 세션 열기', () => {
  test('주문 세션 목록에 저장된 세션이 있으면 그 세션으로 열고 새로 만들지 않는다', async ({ context, page }, testInfo) => {
    const orderSeqno = 920001
    const mock = await installEmbedHarness(context, { templateSets: allTemplateSets() })
    const diag1 = captureDiagnostics(page)
    await openEmbed(page, mock, newOrderParams(orderSeqno))
    await waitReady(page, diag1)
    const saved = (await getState(page)).sessionId
    if (!saved) throw new Error('getState.sessionId 없음')
    await saveNow(page)
    await expect.poll(() => mock.sessions.get(saved)?.canvasData != null).toBe(true)
    await page.close()

    // 같은 주문에 canvasData 없는 더 최근 세션을 추가한다(목록 첫 항목).
    const blank = mock.commitSession({ orderSeqno, mode: 'both', templateSetId: TS_A_ID, metadata: {} })
    expect(blank.canvasData).toBeNull()

    const page2 = await context.newPage()
    const diag2 = captureDiagnostics(page2)
    const mark = mock.calls.length
    await openEmbed(page2, mock, newOrderParams(orderSeqno))
    await waitReady(page2, diag2)
    expect((await getState(page2)).sessionId).toBe(saved)
    expect(orderListGets(mock, mark)).toBeGreaterThanOrEqual(1)
    expect(createPosts(mock, mark)).toBe(0)
    expect(await editorErrors(page2)).toEqual([])
    expectHarnessClean(mock, [diag1, diag2], testInfo)
  })

  test('주문 세션 목록이 비면 새 세션을 만든다', async ({ context, page }, testInfo) => {
    const mock = await installEmbedHarness(context, { templateSets: allTemplateSets() })
    const diag = captureDiagnostics(page)
    await openEmbed(page, mock, newOrderParams(920002))
    await waitReady(page, diag)
    expect(createPosts(mock)).toBeGreaterThanOrEqual(1)
    const { sessionId } = await getState(page)
    expect(sessionId).not.toBeNull()
    expect([...mock.sessions.keys()]).toContain(sessionId)
    expect(await editorErrors(page)).toEqual([])
    expectHarnessClean(mock, [diag], testInfo)
  })

  test('주문 세션 목록 조회가 404 면 새 세션을 만든다', async ({ context, page }, testInfo) => {
    const mock = await installEmbedHarness(context, { templateSets: allTemplateSets() })
    mock.override = (call) => (isOrderListGet(call) ? { status: 404, body: { statusCode: 404, message: 'Not Found' } } : undefined)
    const diag = captureDiagnostics(page)
    await openEmbed(page, mock, newOrderParams(920003))
    await waitReady(page, diag)
    expect(orderListGets(mock)).toBeGreaterThanOrEqual(1)
    expect(createPosts(mock)).toBeGreaterThanOrEqual(1)
    const { sessionId } = await getState(page)
    expect([...mock.sessions.keys()]).toContain(sessionId)
    expect(await editorErrors(page)).toEqual([])
    expectHarnessClean(mock, [diag], testInfo)
  })

  test('주문 세션 목록 조회가 서버 오류면 세션을 만들지 않고 NETWORK_ERROR 를 보낸다', async ({ context, page }, testInfo) => {
    const mock = await installEmbedHarness(context, { templateSets: allTemplateSets() })
    mock.override = (call) => (isOrderListGet(call) ? { status: 503, body: { statusCode: 503, message: 'Service Unavailable' } } : undefined)
    const diag = captureDiagnostics(page)
    await openEmbed(page, mock, newOrderParams(920004))
    // 목록 조회는 자동 재시도 뒤 실패한다 — 고정 대기 없이 editor.error 를 기다린다.
    const first = await waitForHostEvent(page, 'editor.error', 60_000)
    expect(first.payload).toMatchObject({ code: 'NETWORK_ERROR', fatal: true })
    await page.waitForTimeout(1_000)
    for (const e of await editorErrors(page)) expect(e.payload).toMatchObject({ code: 'NETWORK_ERROR', fatal: true })
    expect((await hostEvents(page)).filter((e) => e.event === 'editor.ready')).toHaveLength(0)
    expect(createPosts(mock)).toBe(0)
    expectHarnessClean(mock, [diag], testInfo)
  })

  test('세션 생성이 서버 오류면 주문 목록을 다시 조회한 뒤 한 번만 다시 보내고 NETWORK_ERROR 를 보낸다', async ({ context, page }, testInfo) => {
    const mock = await installEmbedHarness(context, { templateSets: allTemplateSets() })
    mock.override = (call) => (isCreateCall(call) ? { status: 500, body: { statusCode: 500, message: 'Internal Server Error' } } : undefined)
    const diag = captureDiagnostics(page)
    await openEmbed(page, mock, newOrderParams(920005))
    const first = await waitForHostEvent(page, 'editor.error', 60_000)
    expect(first.payload).toMatchObject({ code: 'NETWORK_ERROR', fatal: true })
    // 초기화 1회당: 목록 조회 → 생성(500) → 목록 다시 조회 → 1초 뒤 생성 1회(500) → 실패.
    // 다른 초기화(StrictMode)가 같은 흐름을 끝낼 때까지 요청 수가 멈추기를 기다린다.
    let settled = -1
    await expect
      .poll(async () => {
        await page.waitForTimeout(1_500)
        const n = mock.calls.length
        const stable = n === settled
        settled = n
        return stable
      }, { timeout: 30_000 })
      .toBe(true)
    const posts = createPosts(mock)
    const lists = orderListGets(mock)
    testInfo.annotations.push({ type: 'requests', description: `POST /edit-sessions=${posts}, GET 주문 목록=${lists}` })
    // 초기화는 1회 또는 2회(StrictMode) — 초기화당 생성 2회·목록 조회 2회.
    expect([2, 4]).toContain(posts)
    expect(lists).toBe(posts)
    for (const e of await editorErrors(page)) expect(e.payload).toMatchObject({ code: 'NETWORK_ERROR', fatal: true })
    expect((await hostEvents(page)).filter((e) => e.event === 'editor.ready')).toHaveLength(0)
    expectHarnessClean(mock, [diag], testInfo)
  })

  test('세션 생성 응답이 서버 오류여도 주문 목록에서 같은 세션을 찾으면 그 세션으로 연다', async ({ context, page }, testInfo) => {
    const mock = await installEmbedHarness(context, { templateSets: allTemplateSets() })
    // 서버에는 세션이 만들어지고 응답만 502 로 끝나는 경우
    mock.override = (call, m) => {
      if (!isCreateCall(call)) return undefined
      const body = typeof call.body === 'object' && call.body !== null ? (call.body as Record<string, unknown>) : {}
      m.createBodies.push(body)
      m.commitSession(body)
      return { status: 502, body: { statusCode: 502, message: 'Bad Gateway' } }
    }
    const diag = captureDiagnostics(page)
    await openEmbed(page, mock, newOrderParams(920006))
    await waitReady(page, diag)
    const { sessionId } = await getState(page)
    expect([...mock.sessions.keys()]).toContain(sessionId)
    const posts = createPosts(mock)
    const lists = orderListGets(mock)
    testInfo.annotations.push({ type: 'requests', description: `POST /edit-sessions=${posts}, GET 주문 목록=${lists}` })
    // 생성 요청마다 주문 목록을 다시 조회하고, 같은 초기화 안에서 생성을 다시 보내지 않는다.
    expect(posts).toBeGreaterThanOrEqual(1)
    expect(lists).toBeGreaterThanOrEqual(2 * posts)
    expect(await editorErrors(page)).toEqual([])
    expectHarnessClean(mock, [diag], testInfo)
  })
})
