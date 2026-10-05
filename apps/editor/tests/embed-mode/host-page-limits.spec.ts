/**
 * /embed 호스트 쪽수 범위(pageCount·pageCountMin·pageCountMax·pageStep) 로더 — 실브라우저 스펙
 *
 * 호스트 iframe 하네스(embed-host-harness.ts)로 편집기를 띄우고, 쪽수는 postMessage getState 의
 * pageCount 로 확인한다. 세션 생성 본문의 metadata.orderOptions 는 모킹 API 가 받은 값으로 확인한다.
 * 개발 서버는 React StrictMode 라 세션 생성 요청이 2회 올 수 있다 — 생성 본문은 모두 확인하고
 * 재진입 sessionId 는 getState 응답에서 얻는다.
 */
import { test, expect, type BrowserContext, type FrameLocator, type Page } from '@playwright/test'
import {
  addPageButton,
  allTemplateSets,
  anyPageStepAlert,
  captureDiagnostics,
  clickAddPage,
  clickDeleteLastPage,
  countCalls,
  expectHarnessClean,
  expectPageCount,
  getState,
  hostEvents,
  installEmbedHarness,
  maxReachedButton,
  openEmbed,
  orderOptionsOf,
  pageStepAlert,
  readEditorStoreLimits,
  saveNow,
  toast,
  TS_A_ID,
  TS_B_ID,
  TS_C_ID,
  TS_D_ID,
  waitReady,
  type Diagnostics,
  type MockApi,
} from './embed-host-harness'

test.use({ viewport: { width: 1480, height: 960 } })
test.setTimeout(120_000)

interface Opened {
  mock: MockApi
  diag: Diagnostics
  frame: FrameLocator
}

interface Reopened {
  page: Page
  diag: Diagnostics
  frame: FrameLocator
  /** 재진입 직전 mock.calls 길이 */
  mark: number
}

type Params = Record<string, string | number>

/** 새 주문(mode=both)으로 열고 editor.ready 를 기다린다. */
async function openNew(context: BrowserContext, page: Page, params: Params): Promise<Opened> {
  const mock = await installEmbedHarness(context, { templateSets: allTemplateSets() })
  const diag = captureDiagnostics(page)
  const frame = await openEmbed(page, mock, { mode: 'both', ...params })
  await waitReady(page, diag)
  return { mock, diag, frame }
}

/** 같은 context 의 새 page 에서 다시 연다. */
async function reopen(context: BrowserContext, mock: MockApi, params: Params): Promise<Reopened> {
  const page = await context.newPage()
  const diag = captureDiagnostics(page)
  const mark = mock.calls.length
  const frame = await openEmbed(page, mock, params)
  await waitReady(page, diag)
  return { page, diag, frame, mark }
}

/** 내지 추가 버튼을 눌러 쪽수가 차례로 expected 가 되는지 확인한다. */
async function addPages(page: Page, frame: FrameLocator, expected: number[]): Promise<void> {
  for (const n of expected) {
    await clickAddPage(frame)
    await expectPageCount(page, n)
  }
}

/** 마지막 내지 삭제 버튼을 눌러 쪽수가 차례로 expected 가 되는지 확인한다. */
async function deletePages(page: Page, frame: FrameLocator, expected: number[]): Promise<void> {
  for (const n of expected) {
    await clickDeleteLastPage(frame)
    await expectPageCount(page, n)
  }
}

async function expectNoEditorError(page: Page): Promise<void> {
  const errors = (await hostEvents(page)).filter((e) => e.event === 'editor.error')
  expect(errors.map((e) => e.payload)).toEqual([])
}

/** 저장(saveNow) 후 모킹 저장소의 캔버스 수를 확인하고 page 를 닫는다. 저장한 세션 id 를 돌려준다. */
async function saveAndClose(page: Page, mock: MockApi, canvasLength: number): Promise<string> {
  const { sessionId } = await getState(page)
  if (!sessionId) throw new Error('getState.sessionId 없음')
  await saveNow(page)
  await expect
    .poll(() => {
      const cd = mock.sessions.get(sessionId)?.canvasData
      return Array.isArray(cd) ? cd.length : null
    })
    .toBe(canvasLength)
  await expectNoEditorError(page)
  await page.close()
  return sessionId
}

function expectAllOrderOptions(mock: MockApi, expected: Record<string, unknown>): void {
  expect(mock.createBodies.length).toBeGreaterThanOrEqual(1)
  for (const body of mock.createBodies) expect(orderOptionsOf(body)).toMatchObject(expected)
}

function expectOrderOptionsWithout(mock: MockApi, keys: string[]): void {
  expect(mock.createBodies.length).toBeGreaterThanOrEqual(1)
  for (const body of mock.createBodies) {
    const oo = orderOptionsOf(body)
    for (const k of keys) expect(oo).not.toHaveProperty(k)
  }
}

function expectWarning(diag: Diagnostics, text: string): void {
  expect(diag.warnings).toContainEqual(expect.stringContaining(text))
}

test.describe('호스트 쪽수 범위 — 표지3분할 + 내지낱장', () => {
  test('호스트 쪽수 범위로 새로 열면 pageCount 로 시작하고 세션 orderOptions 에 범위를 기록한다', async ({ context, page }, testInfo) => {
    const { mock, diag, frame } = await openNew(context, page, {
      templateSetId: TS_A_ID, orderSeqno: 910001, pageCount: 16, pageCountMin: 16, pageCountMax: 300, pageStep: 4,
    })
    await expectPageCount(page, 16)
    expectAllOrderOptions(mock, { pageCount: 16, pageCountMin: 16, pageCountMax: 300, pageStep: 4, orderSeqno: 910001 })
    await expect(anyPageStepAlert(frame)).toHaveCount(0)
    await expect(addPageButton(frame)).toBeVisible()
    await expectNoEditorError(page)
    expectHarnessClean(mock, [diag], testInfo)
  })

  test('호스트 pageStep 단위로 내지를 추가·삭제하고 최소 쪽수 아래로는 삭제하지 않는다', async ({ context, page }, testInfo) => {
    const { mock, diag, frame } = await openNew(context, page, {
      templateSetId: TS_A_ID, orderSeqno: 910002, pageCount: 16, pageCountMin: 16, pageCountMax: 300, pageStep: 4,
    })
    await expectPageCount(page, 16)
    await addPages(page, frame, [20])
    await expect(toast(frame, '내지 4페이지 단위 상품이라 4페이지가 추가되었습니다.')).toBeVisible()

    await clickDeleteLastPage(frame)
    await expectPageCount(page, 16)
    await expect(toast(frame, '인접 페이지까지 4페이지가 삭제되었습니다.')).toBeVisible()

    await clickDeleteLastPage(frame)
    await expect(toast(frame, '최소 페이지 수 제한으로 삭제할 수 없습니다.')).toBeVisible()
    await expectPageCount(page, 16)
    await expectNoEditorError(page)
    expectHarnessClean(mock, [diag], testInfo)
  })

  test('최대 쪽수에 도달하면 추가 버튼을 비활성화한다', async ({ context, page }, testInfo) => {
    const { mock, diag, frame } = await openNew(context, page, {
      templateSetId: TS_A_ID, orderSeqno: 910003, pageCount: 20, pageCountMin: 16, pageCountMax: 24, pageStep: 4,
    })
    await expectPageCount(page, 20)
    await addPages(page, frame, [24])
    await expect(maxReachedButton(frame)).toBeDisabled()
    await expect(addPageButton(frame)).toHaveCount(0)
    await expectPageCount(page, 24)
    await expectNoEditorError(page)
    expectHarnessClean(mock, [diag], testInfo)
  })

  test('pageCount 가 최소보다 작으면 최소 쪽수로 시작한다', async ({ context, page }, testInfo) => {
    const { mock, diag } = await openNew(context, page, {
      templateSetId: TS_A_ID, orderSeqno: 910004, pageCount: 8, pageCountMin: 16, pageCountMax: 300, pageStep: 4,
    })
    await expectPageCount(page, 16)
    expectWarning(diag, 'pageCount 8 < 최소 16')
    await expectNoEditorError(page)
    expectHarnessClean(mock, [diag], testInfo)
  })

  test('pageCount 가 최대보다 크면 최대 쪽수로 시작한다', async ({ context, page }, testInfo) => {
    const { mock, diag } = await openNew(context, page, {
      templateSetId: TS_A_ID, orderSeqno: 910005, pageCount: 60, pageCountMin: 16, pageCountMax: 40, pageStep: 4,
    })
    await expectPageCount(page, 40)
    expectWarning(diag, 'pageCount 60 > 최대 40')
    await expectNoEditorError(page)
    expectHarnessClean(mock, [diag], testInfo)
  })

  test('배수가 아닌 쪽수로 열면 경고를 표시하고 편집완료를 진행하지 않는다', async ({ context, page }, testInfo) => {
    const { mock, diag, frame } = await openNew(context, page, {
      templateSetId: TS_A_ID, orderSeqno: 910006, pageCount: 18, pageCountMin: 16, pageCountMax: 300, pageStep: 4,
    })
    await expectPageCount(page, 18)
    const message = '내지는 4페이지 단위로만 주문할 수 있습니다. 현재 18페이지'
    await expect(pageStepAlert(frame, message).first()).toBeVisible()

    await frame.getByRole('button', { name: '편집완료' }).click()
    await expect(toast(frame, message)).toBeVisible()
    expect((await hostEvents(page)).filter((e) => e.event === 'editor.complete')).toHaveLength(0)
    expect(countCalls(mock, 'PATCH', (p) => p.endsWith('/complete'))).toBe(0)

    await addPages(page, frame, [20])
    await expect(toast(frame, '내지 4페이지 단위 상품이라 2페이지가 추가되었습니다.')).toBeVisible()
    await expect(anyPageStepAlert(frame)).toHaveCount(0)
    await expectNoEditorError(page)
    expectHarnessClean(mock, [diag], testInfo)
  })

  test('형식이 맞지 않는 범위·단위 파라미터는 무시하고 기록하지 않는다', async ({ context, page }, testInfo) => {
    const { mock, diag, frame } = await openNew(context, page, {
      templateSetId: TS_A_ID, orderSeqno: 910008, pageCount: 16, pageCountMin: 0, pageCountMax: 501, pageStep: '2.5',
    })
    await expectPageCount(page, 16)
    expectWarning(diag, '[hostPageLimits] pageCountMin 파라미터 무시')
    expectWarning(diag, '[hostPageLimits] pageCountMax 파라미터 무시')
    expectWarning(diag, '[hostPageLimits] pageStep 파라미터 무시')
    expectAllOrderOptions(mock, { pageCount: 16 })
    expectOrderOptionsWithout(mock, ['pageCountMin', 'pageCountMax', 'pageStep'])
    await addPages(page, frame, [17])
    await expectNoEditorError(page)
    expectHarnessClean(mock, [diag], testInfo)
  })

  test('[P2] 최소가 최대보다 크면 두 값을 모두 무시한다', async ({ context, page }, testInfo) => {
    const { mock, diag } = await openNew(context, page, {
      templateSetId: TS_A_ID, orderSeqno: 910009, pageCount: 16, pageCountMin: 40, pageCountMax: 16,
    })
    await expectPageCount(page, 16)
    expectWarning(diag, 'pageCountMin 40 > pageCountMax 16 — 둘 다 무시')
    expectOrderOptionsWithout(mock, ['pageCountMin', 'pageCountMax'])
    await expectNoEditorError(page)
    expectHarnessClean(mock, [diag], testInfo)
  })

  test('[P2] 최소가 단위의 배수가 아니면 단위를 무시한다', async ({ context, page }, testInfo) => {
    const { mock, diag, frame } = await openNew(context, page, {
      templateSetId: TS_A_ID, orderSeqno: 910010, pageCount: 20, pageCountMin: 18, pageCountMax: 300, pageStep: 4,
    })
    await expectPageCount(page, 20)
    expectWarning(diag, 'pageCountMin 18 이 pageStep 4 의 배수가 아님')
    expectAllOrderOptions(mock, { pageCountMin: 18, pageCountMax: 300 })
    expectOrderOptionsWithout(mock, ['pageStep'])
    await addPages(page, frame, [21])
    await expectNoEditorError(page)
    expectHarnessClean(mock, [diag], testInfo)
  })

  test('[P2] snake_case 범위 파라미터도 같은 범위를 기록한다', async ({ context, page }, testInfo) => {
    const { mock, diag } = await openNew(context, page, {
      templateSetId: TS_A_ID, orderSeqno: 910011, pageCount: 16, page_count_min: 16, page_count_max: 300, page_step: 4,
    })
    await expectPageCount(page, 16)
    expectAllOrderOptions(mock, { pageCount: 16, pageCountMin: 16, pageCountMax: 300, pageStep: 4, orderSeqno: 910011 })
    await expectNoEditorError(page)
    expectHarnessClean(mock, [diag], testInfo)
  })

  test('[P2] 최대 500쪽·2쪽 단위 범위로 열면 2쪽씩 추가한다', async ({ context, page }, testInfo) => {
    const { mock, diag, frame } = await openNew(context, page, {
      templateSetId: TS_A_ID, orderSeqno: 910012, pageCount: 16, pageCountMin: 16, pageCountMax: 500, pageStep: 2,
    })
    await expectPageCount(page, 16)
    expectAllOrderOptions(mock, { pageCount: 16, pageCountMin: 16, pageCountMax: 500, pageStep: 2 })
    await addPages(page, frame, [18])
    await expect(toast(frame, '내지 2페이지 단위 상품이라 2페이지가 추가되었습니다.')).toBeVisible()
    await expectNoEditorError(page)
    expectHarnessClean(mock, [diag], testInfo)
  })
})

test.describe(
  '현재 동작 기록',
  {
    tag: '@characterization',
    annotation: { type: 'characterization', description: '현재 시작 쪽수·삭제 한도 기록' },
  },
  () => {
    test('pageCount 없이 범위만 주면 템플릿 내지 수로 시작한다', async ({ context, page }, testInfo) => {
      testInfo.annotations.push({ type: 'characterization', description: 'pageCount 없이 범위만 전달된 경우의 현재 시작 쪽수' })
      const { mock, diag, frame } = await openNew(context, page, {
        templateSetId: TS_A_ID, orderSeqno: 910007, pageCountMin: 16, pageCountMax: 300, pageStep: 4,
      })
      await expectPageCount(page, 1)
      await expect(pageStepAlert(frame, '현재 1페이지').first()).toBeVisible()
      expectAllOrderOptions(mock, { pageCountMin: 16, pageCountMax: 300, pageStep: 4 })
      expectOrderOptionsWithout(mock, ['pageCount'])
      await expectNoEditorError(page)
      expectHarnessClean(mock, [diag], testInfo)
    })

    test('무선제본 16쪽(표지3분할 + 내지낱장)의 현재 시작 쪽수와 삭제 한도', async ({ context, page }, testInfo) => {
      const { mock, diag, frame } = await openNew(context, page, {
        templateSetId: TS_A_ID, orderSeqno: 910013, pageCount: 16, pageCountMin: 16, pageCountMax: 300, pageStep: 4,
        bindingType: 'perfect',
      })
      // 현재 시작 쪽수 기록
      await expectPageCount(page, 16)
      testInfo.annotations.push({ type: 'characterization', description: 'TS-A 16/300/4 · bindingType=perfect · pageCount=16 → 시작 16쪽' })
      await clickDeleteLastPage(frame)
      await expect(toast(frame, '무선제본은 최소 32페이지가 필요해 더 삭제할 수 없습니다.')).toBeVisible()
      await expectPageCount(page, 16)
      testInfo.annotations.push({ type: 'characterization', description: '16쪽에서 삭제 → 무선제본 최소 32페이지 토스트, 16쪽 유지' })
      await addPages(page, frame, [20])
      await expectNoEditorError(page)
      expectHarnessClean(mock, [diag], testInfo)
    })

    test('무선제본 16쪽(표지펼침면 + 내지펼침면)의 현재 시작 쪽수와 추가 후 삭제 한도', async ({ context, page }, testInfo) => {
      const { mock, diag, frame } = await openNew(context, page, {
        templateSetId: TS_D_ID, orderSeqno: 910044, pageCount: 16, pageCountMin: 16, pageCountMax: 48, pageStep: 4,
        bindingType: 'perfect',
      })
      // 현재 시작 쪽수 기록
      await expectPageCount(page, 16)
      expectAllOrderOptions(mock, { pageCount: 16, pageCountMin: 16, pageCountMax: 48, pageStep: 4 })
      testInfo.annotations.push({ type: 'characterization', description: 'TS-D 16/48/4 · bindingType=perfect · pageCount=16 → 시작 16쪽' })
      await addPages(page, frame, [20])
      await clickDeleteLastPage(frame)
      await expect(toast(frame, '무선제본은 최소 32페이지가 필요해 더 삭제할 수 없습니다.')).toBeVisible()
      await expectPageCount(page, 20)
      testInfo.annotations.push({ type: 'characterization', description: '16 → 20 추가 후 삭제 → 무선제본 최소 32페이지 토스트, 20쪽 유지' })
      await expectNoEditorError(page)
      expectHarnessClean(mock, [diag], testInfo)
    })
  },
)

test.describe('템플릿 내지 단위 2 세트', () => {
  test('pageStep=1 이면 템플릿 단위를 쓰지 않고 1쪽씩 추가한다', async ({ context, page }, testInfo) => {
    const { mock, diag, frame } = await openNew(context, page, {
      templateSetId: TS_B_ID, orderSeqno: 910021, pageCount: 17, pageCountMin: 16, pageCountMax: 300, pageStep: 1,
    })
    await expectPageCount(page, 17)
    await expect(anyPageStepAlert(frame)).toHaveCount(0)
    expectAllOrderOptions(mock, { pageStep: 1 })
    expect(await readEditorStoreLimits(page)).toMatchObject({ pageStep: null, padToPageStep: false })
    await addPages(page, frame, [18])
    await expect(toast(frame, '페이지가 추가되었습니다.')).toHaveCount(0)
    await expectNoEditorError(page)
    expectHarnessClean(mock, [diag], testInfo)
  })

  test('호스트 한도가 없으면 템플릿 단위로 경고하고 배수 채움을 유지한다', async ({ context, page }, testInfo) => {
    const { mock, diag, frame } = await openNew(context, page, {
      templateSetId: TS_B_ID, orderSeqno: 910022, pageCount: 17,
    })
    await expectPageCount(page, 17)
    await expect(pageStepAlert(frame, '내지는 2페이지 단위로만 주문할 수 있습니다. 현재 17페이지').first()).toBeVisible()
    expectOrderOptionsWithout(mock, ['pageCountMin', 'pageCountMax', 'pageStep'])
    expect(await readEditorStoreLimits(page)).toEqual({ pageStep: 2, padToPageStep: true, pageCountRange: [4, 100] })
    await expectNoEditorError(page)
    expectHarnessClean(mock, [diag], testInfo)
  })

  test('[P2] 호스트 pageStep 이 템플릿 단위보다 우선한다', async ({ context, page }, testInfo) => {
    const { mock, diag, frame } = await openNew(context, page, {
      templateSetId: TS_B_ID, orderSeqno: 910023, pageCount: 16, pageCountMin: 16, pageCountMax: 300, pageStep: 4,
    })
    await expectPageCount(page, 16)
    expect(await readEditorStoreLimits(page)).toEqual({ pageStep: 4, padToPageStep: false, pageCountRange: [16, 300] })
    await addPages(page, frame, [20])
    await expectNoEditorError(page)
    expectHarnessClean(mock, [diag], testInfo)
  })
})

test.describe('단일 모드', () => {
  test('내지가 아닌 캔버스가 있는 단일 모드는 호스트 pageStep 을 단위로 쓰지 않는다', async ({ context, page }, testInfo) => {
    const { mock, diag, frame } = await openNew(context, page, {
      templateSetId: TS_C_ID, orderSeqno: 910031, pageCount: 5, pageCountMin: 4, pageCountMax: 100, pageStep: 4,
    })
    // 단일 모드 pageCount = 표지 포함 캔버스 수(표지 1 + 내지 5)
    await expectPageCount(page, 6)
    expectWarning(diag, '[hostPageLimits] 단일 모드 템플릿에 내지가 아닌 캔버스 1개 — 호스트 pageStep 4 무시')
    expectAllOrderOptions(mock, { pageStep: 4 })
    await expect(anyPageStepAlert(frame)).toHaveCount(0)
    await expectNoEditorError(page)
    expectHarnessClean(mock, [diag], testInfo)
  })
})

test.describe('호스트 쪽수 범위 — 표지펼침면 + 내지펼침면(캔버스 1장 = 2쪽)', () => {
  test('범위로 새로 열면 펼침면 쪽수로 시작하고 4쪽씩 추가·삭제한다', async ({ context, page }, testInfo) => {
    const { mock, diag, frame } = await openNew(context, page, {
      templateSetId: TS_D_ID, orderSeqno: 910041, pageCount: 16, pageCountMin: 16, pageCountMax: 48, pageStep: 4,
    })
    await expectPageCount(page, 16)
    expectAllOrderOptions(mock, { pageCount: 16, pageCountMin: 16, pageCountMax: 48, pageStep: 4 })
    await expect(anyPageStepAlert(frame)).toHaveCount(0)

    await addPages(page, frame, [20])
    await expect(toast(frame, '내지 4페이지 단위 상품이라 4페이지가 추가되었습니다.')).toBeVisible()
    await clickDeleteLastPage(frame)
    await expectPageCount(page, 16)
    await expect(toast(frame, '인접 페이지까지 4페이지가 삭제되었습니다.')).toBeVisible()
    await clickDeleteLastPage(frame)
    await expect(toast(frame, '최소 페이지 수 제한으로 삭제할 수 없습니다.')).toBeVisible()
    await expectPageCount(page, 16)
    await expectNoEditorError(page)
    expectHarnessClean(mock, [diag], testInfo)
  })

  test('최대 48쪽에 도달하면 추가 버튼을 비활성화한다', async ({ context, page }, testInfo) => {
    const { mock, diag, frame } = await openNew(context, page, {
      templateSetId: TS_D_ID, orderSeqno: 910042, pageCount: 44, pageCountMin: 16, pageCountMax: 48, pageStep: 4,
    })
    await expectPageCount(page, 44)
    await addPages(page, frame, [48])
    await expect(maxReachedButton(frame)).toBeDisabled()
    await expectNoEditorError(page)
    expectHarnessClean(mock, [diag], testInfo)
  })

  test('sessionId 로 다시 열면 저장된 펼침면 쪽수와 세션의 쪽수 단위·최소 쪽수를 유지한다', async ({ context, page }, testInfo) => {
    const { mock, diag, frame } = await openNew(context, page, {
      templateSetId: TS_D_ID, orderSeqno: 910043, pageCount: 16, pageCountMin: 16, pageCountMax: 48, pageStep: 4,
    })
    await expectPageCount(page, 16)
    await addPages(page, frame, [20])
    // 표지 1 + 펼침면 10
    const sid = await saveAndClose(page, mock, 11)

    const r = await reopen(context, mock, { sessionId: sid })
    expect(countCalls(mock, 'POST', (p) => p === '/edit-sessions', r.mark)).toBe(0)
    expect((await getState(r.page)).sessionId).toBe(sid)
    await expectPageCount(r.page, 20)
    await addPages(r.page, r.frame, [24])
    await expect(toast(r.frame, '내지 4페이지 단위 상품이라 4페이지가 추가되었습니다.')).toBeVisible()
    await deletePages(r.page, r.frame, [20, 16])
    await clickDeleteLastPage(r.frame)
    await expect(toast(r.frame, '최소 페이지 수 제한으로 삭제할 수 없습니다.')).toBeVisible()
    await expectPageCount(r.page, 16)
    await expectNoEditorError(r.page)
    expectHarnessClean(mock, [diag, r.diag], testInfo)
  })
})

test.describe('sessionId 재진입', () => {
  const PHASE1: Params = { templateSetId: TS_A_ID, pageCount: 16, pageCountMin: 16, pageCountMax: 300, pageStep: 4 }

  /** 16쪽으로 열어 24쪽까지 추가한 뒤 저장하고 page 를 닫는다(표지 1 + 내지 24). */
  async function savedAt24(context: BrowserContext, page: Page, orderSeqno: number, params: Params = PHASE1): Promise<{ opened: Opened; sid: string }> {
    const opened = await openNew(context, page, { ...params, orderSeqno })
    await expectPageCount(page, 16)
    await addPages(page, opened.frame, [20, 24])
    const sid = await saveAndClose(page, opened.mock, 25)
    return { opened, sid }
  }

  test('sessionId 로 다시 열면 저장된 쪽수와 세션의 쪽수 단위를 유지한다', async ({ context, page }, testInfo) => {
    const { opened, sid } = await savedAt24(context, page, 910051)
    const { mock } = opened
    const r = await reopen(context, mock, { sessionId: sid })
    expect(countCalls(mock, 'GET', (p) => p === `/edit-sessions/${sid}`, r.mark)).toBeGreaterThanOrEqual(1)
    expect(countCalls(mock, 'POST', (p) => p === '/edit-sessions', r.mark)).toBe(0)
    expect((await getState(r.page)).sessionId).toBe(sid)
    await expectPageCount(r.page, 24)
    await addPages(r.page, r.frame, [28])
    await expect(toast(r.frame, '내지 4페이지 단위 상품이라 4페이지가 추가되었습니다.')).toBeVisible()
    await expectNoEditorError(r.page)
    expectHarnessClean(mock, [opened.diag, r.diag], testInfo)
  })

  test('범위 파라미터 없이 sessionId 로 다시 열면 세션의 최대·최소 쪽수를 적용한다', async ({ context, page }, testInfo) => {
    const { opened, sid } = await savedAt24(context, page, 910056, { ...PHASE1, pageCountMax: 40 })
    const { mock } = opened
    const r = await reopen(context, mock, { sessionId: sid })
    expect(countCalls(mock, 'POST', (p) => p === '/edit-sessions', r.mark)).toBe(0)
    expect((await getState(r.page)).sessionId).toBe(sid)
    await expectPageCount(r.page, 24)

    await addPages(r.page, r.frame, [28, 32, 36, 40])
    await expect(maxReachedButton(r.frame)).toBeDisabled()
    await expect(addPageButton(r.frame)).toHaveCount(0)
    await expectPageCount(r.page, 40)

    await deletePages(r.page, r.frame, [36, 32, 28, 24, 20, 16])
    await clickDeleteLastPage(r.frame)
    await expect(toast(r.frame, '최소 페이지 수 제한으로 삭제할 수 없습니다.')).toBeVisible()
    await expectPageCount(r.page, 16)
    await expectNoEditorError(r.page)
    expectHarnessClean(mock, [opened.diag, r.diag], testInfo)
  })

  test('다시 열 때 pageCount 가 저장 쪽수보다 작아도 저장 쪽수를 유지한다', async ({ context, page }, testInfo) => {
    const { opened, sid } = await savedAt24(context, page, 910052)
    const r = await reopen(context, opened.mock, { sessionId: sid, pageCount: 16 })
    await expectPageCount(r.page, 24)
    expectWarning(r.diag, 'pageCount 16 < 복원 내지수 24 — 저장 쪽수로 시드(R-196)')
    await expectNoEditorError(r.page)
    expectHarnessClean(opened.mock, [opened.diag, r.diag], testInfo)
  })

  test('다시 열 때 pageCount 가 최대보다 크면 최대 쪽수로 연다', async ({ context, page }, testInfo) => {
    const { opened, sid } = await savedAt24(context, page, 910053, { ...PHASE1, pageCountMax: 40 })
    const r = await reopen(context, opened.mock, { sessionId: sid, pageCount: 60 })
    await expectPageCount(r.page, 40)
    expectWarning(r.diag, 'pageCount 60 > 최대 40')
    await expectNoEditorError(r.page)
    expectHarnessClean(opened.mock, [opened.diag, r.diag], testInfo)
  })

  test('[P2] 다시 열 때 URL pageStep 이 세션 기록보다 우선한다', async ({ context, page }, testInfo) => {
    const { opened, sid } = await savedAt24(context, page, 910054)
    const r = await reopen(context, opened.mock, { sessionId: sid, pageStep: 2 })
    await expectPageCount(r.page, 24)
    await addPages(r.page, r.frame, [26])
    await expect(toast(r.frame, '내지 2페이지 단위 상품이라 2페이지가 추가되었습니다.')).toBeVisible()
    await expectNoEditorError(r.page)
    expectHarnessClean(opened.mock, [opened.diag, r.diag], testInfo)
  })

  test('[P2] 호스트 범위 없이 저장한 세션은 템플릿 단위로 추가한다', async ({ context, page }, testInfo) => {
    const opened = await openNew(context, page, { templateSetId: TS_A_ID, orderSeqno: 910055, pageCount: 24 })
    await expectPageCount(page, 24)
    const sid = await saveAndClose(page, opened.mock, 25)
    const r = await reopen(context, opened.mock, { sessionId: sid })
    await expectPageCount(r.page, 24)
    await addPages(r.page, r.frame, [25])
    await expectNoEditorError(r.page)
    expectHarnessClean(opened.mock, [opened.diag, r.diag], testInfo)
  })
})
