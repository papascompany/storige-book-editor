/**
 * Spread Mode Test Fixtures
 *
 * 모든 스프레드 모드 테스트에서 공유하는 mock 데이터 및 헬퍼
 *
 * 주요 주의사항:
 * 1. Playwright는 라우트를 역순으로 매칭 (마지막 등록이 먼저 매칭)
 * 2. glob 패턴 (예: /api/ 와일드카드)은 Vite dev server 소스 파일도 가로챌 수 있음
 * 3. 따라서 단일 http://localhost:4000/ 핸들러에서 URL 기반 분기를 사용
 */
import { test as base, expect, Page } from '@playwright/test'

// ============================================================
// Mock 데이터
// ============================================================

export const MOCK_TEMPLATE_SET_ID = 'test-spread-tset-001'

export const MOCK_SPREAD_CONFIG = {
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
}

export const MOCK_SPREAD_CONFIG_WITH_WINGS = {
  spec: {
    coverWidthMm: 210,
    coverHeightMm: 297,
    spineWidthMm: 7.5,
    wingEnabled: true,
    wingWidthMm: 60,
    cutSizeMm: 2,
    safeSizeMm: 3,
    dpi: 150,
  },
  regions: [],
  totalWidthMm: 547.5,
  totalHeightMm: 297,
}

export const MOCK_TEMPLATE_SET_RESPONSE = {
  templateSet: {
    id: MOCK_TEMPLATE_SET_ID,
    name: '테스트 스프레드 책자',
    type: 'book',
    width: 210,
    height: 297,
    canAddPage: true,
    pageCountRange: [4, 8, 16, 32, 64],
    editorMode: 'book',
    isActive: true,
    isDeleted: false,
    templates: [
      { templateId: 'tpl-spread-001', required: true },
      { templateId: 'tpl-page-001', required: true },
      { templateId: 'tpl-page-002', required: false },
    ],
  },
  templateDetails: [
    {
      id: 'tpl-spread-001',
      name: '표지 스프레드',
      type: 'spread',
      width: 427.5,
      height: 297,
      isDeleted: false,
      canvasData: null,
      thumbnailUrl: null,
      spreadConfig: MOCK_SPREAD_CONFIG,
    },
    {
      id: 'tpl-page-001',
      name: '내지 1',
      type: 'page',
      width: 210,
      height: 297,
      isDeleted: false,
      canvasData: null,
      thumbnailUrl: null,
      spreadConfig: null,
    },
    {
      id: 'tpl-page-002',
      name: '내지 2',
      type: 'page',
      width: 210,
      height: 297,
      isDeleted: false,
      canvasData: null,
      thumbnailUrl: null,
      spreadConfig: null,
    },
  ],
}

export const MOCK_FONTS_RESPONSE = [
  {
    id: 'font-001',
    name: 'Noto Sans KR Regular',
    fileUrl: '/fonts/NotoSansKR-Regular.otf',
    fileFormat: 'otf',
    isActive: true,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'font-002',
    name: 'Noto Sans KR Bold',
    fileUrl: '/fonts/NotoSansKR-Bold.otf',
    fileFormat: 'otf',
    isActive: true,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
]

export const MOCK_SPINE_RESPONSE = {
  spineWidthMm: 10.2,
  formulaVersion: '1.0',
}

// ============================================================
// 헬퍼 함수
// ============================================================

/**
 * 스프레드 모드 에디터에 필요한 모든 API를 mock하는 함수
 *
 * 단일 'http://localhost:4000/**' 핸들러에서 URL 기반 분기하여
 * Vite dev server 소스 모듈 로드를 방해하지 않음
 */
export async function setupSpreadMocks(page: Page, options?: {
  templateSetResponse?: any
  fontsResponse?: any
  spineResponse?: any
}) {
  const templateSetResp = options?.templateSetResponse ?? MOCK_TEMPLATE_SET_RESPONSE
  const fontsResp = options?.fontsResponse ?? MOCK_FONTS_RESPONSE
  const spineResp = options?.spineResponse ?? MOCK_SPINE_RESPONSE

  await page.route('http://localhost:4000/**', async (route) => {
    const url = route.request().url()
    const method = route.request().method()

    // 1. Template set API
    if (url.includes('/template-sets/') && url.includes('/with-templates')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(templateSetResp),
      })
      return
    }

    // 2. Fonts API
    if (url.includes('/library/fonts')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fontsResp),
      })
      return
    }

    // 3. Spine calculation API
    if (url.includes('/spine/calculate')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(spineResp),
      })
      return
    }

    // 4. Edit session API
    if (url.includes('/edit-sessions')) {
      if (method === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'session-test-001', status: 'active' }),
        })
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'session-test-001', status: 'active' }),
        })
      }
      return
    }

    // 5. Auto-save API
    if (url.includes('/auto-save')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
      return
    }

    // 6. Catch-all: 기타 API 요청
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  })
}

/**
 * 스프레드 모드 에디터를 열고 초기화 완료까지 대기
 */
export async function openSpreadEditor(page: Page, options?: {
  templateSetId?: string
  pageCount?: number
  paperType?: string
  bindingType?: string
  timeout?: number
}) {
  const templateSetId = options?.templateSetId ?? MOCK_TEMPLATE_SET_ID
  const pageCount = options?.pageCount ?? 4
  const paperType = options?.paperType ?? 'matte100'
  const bindingType = options?.bindingType ?? 'perfect'
  const timeout = options?.timeout ?? 20000

  // 스프레드 모드로 에디터 진입
  await page.goto(
    `/?templateSetId=${templateSetId}&pageCount=${pageCount}&paperType=${paperType}&bindingType=${bindingType}`
  )

  // 에디터 초기화 대기
  await page.waitForLoadState('networkidle')

  // 에디터 DOM 로드 대기
  const editor = page.locator('#editor')
  await editor.waitFor({ state: 'attached', timeout })

  // 캔버스 로드 대기
  const canvas = page.locator('canvas').first()
  await canvas.waitFor({ state: 'attached', timeout })

  // 스프레드 모드 초기화 완료 대기 (내지 페이지 생성 + spine 계산 등)
  await page.waitForTimeout(4000)

  return canvas
}

// ============================================================
// Custom Test Fixture
// ============================================================

/**
 * 스프레드 모드 기본 fixture - mock 설정 + 에디터 열기를 한 번에
 */
export const test = base.extend<{
  spreadPage: Page
}>({
  // Playwright fixture 제공 콜백 — 이름이 use 이면 react-hooks 규칙이 React use() 로 오인한다
  spreadPage: async ({ page }, provide) => {
    await setupSpreadMocks(page)
    await openSpreadEditor(page)
    await provide(page)
  },
})

export { expect }
