/**
 * Embed Mode Test Fixtures
 *
 * embed.tsx (IIFE 번들) 통합 테스트를 위한 mock 데이터 및 헬퍼
 *
 * embed 번들은 별도 빌드이므로 dev server(:3000) 대신
 * 정적 HTML 페이지에서 번들을 로드하여 테스트한다.
 */
import { test as base, expect, Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'

// ============================================================
// Mock 데이터
// ============================================================

export const MOCK_TEMPLATE_SET_ID = 'ts-embed-001'
export const MOCK_ORDER_SEQNO = 12345
export const MOCK_SESSION_ID = 'session-embed-001'

/** 기존 세션 (canvasData 포함) — 재편집 시나리오 */
export const MOCK_EXISTING_SESSION = {
  id: MOCK_SESSION_ID,
  orderSeqno: MOCK_ORDER_SEQNO,
  mode: 'cover',
  status: 'editing',
  canvasData: {
    version: '5.3.0',
    objects: [
      {
        type: 'rect',
        left: 100,
        top: 100,
        width: 200,
        height: 150,
        fill: '#ff0000',
      },
    ],
    background: '#ffffff',
  },
  coverFileId: null,
  contentFileId: null,
  coverFile: null,
  contentFile: null,
  templateSetId: MOCK_TEMPLATE_SET_ID,
  callbackUrl: null,
  metadata: {},
  createdAt: '2026-02-20T00:00:00.000Z',
  updatedAt: '2026-02-20T12:00:00.000Z',
  completedAt: null,
}

/** 새 세션 (canvasData 없음) */
export const MOCK_NEW_SESSION = {
  id: 'session-embed-new',
  orderSeqno: MOCK_ORDER_SEQNO,
  mode: 'cover',
  status: 'active',
  canvasData: null,
  coverFileId: null,
  contentFileId: null,
  coverFile: null,
  contentFile: null,
  templateSetId: MOCK_TEMPLATE_SET_ID,
  callbackUrl: null,
  metadata: {},
  createdAt: '2026-02-24T00:00:00.000Z',
  updatedAt: '2026-02-24T00:00:00.000Z',
  completedAt: null,
}

export const MOCK_TEMPLATE_SET_RESPONSE = {
  templateSet: {
    id: MOCK_TEMPLATE_SET_ID,
    name: '임베드 테스트 템플릿',
    type: 'book',
    width: 210,
    height: 297,
    canAddPage: false,
    pageCountRange: null,
    editorMode: 'single',
    isActive: true,
    isDeleted: false,
    templates: [
      { templateId: 'tpl-cover-001', required: true },
    ],
  },
  templateDetails: [
    {
      id: 'tpl-cover-001',
      name: '표지 기본 템플릿',
      type: 'cover',
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
]

// ============================================================
// 헬퍼 함수
// ============================================================

/**
 * embed 테스트용 HTML 페이지 생성 및 서빙
 *
 * dist-embed/editor-bundle.iife.js를 로드하는 HTML을 만들어
 * file:// 프로토콜 대신 dev server의 특정 경로로 접근하게 한다.
 */
function getTestHtmlPath(): string {
  return path.resolve(__dirname, 'test-embed.html')
}

/**
 * embed 테스트용 API mock 설정
 *
 * @param findByOrderResponse - GET /edit-sessions?orderSeqno= 의 응답
 *   null이면 빈 세션 목록 반환 (새 편집)
 */
export async function setupEmbedMocks(page: Page, options?: {
  findByOrderResponse?: { sessions: any[]; total: number } | null
  createSessionResponse?: any
  templateSetResponse?: any
  fontsResponse?: any
}) {
  const findByOrderResp = options?.findByOrderResponse ?? null
  const createSessionResp = options?.createSessionResponse ?? MOCK_NEW_SESSION
  const templateSetResp = options?.templateSetResponse ?? MOCK_TEMPLATE_SET_RESPONSE
  const fontsResp = options?.fontsResponse ?? MOCK_FONTS_RESPONSE

  // API 호출 추적용
  const apiCalls: { method: string; url: string; body?: any }[] = []
  await page.exposeFunction('__getApiCalls', () => apiCalls)

  await page.route('http://localhost:4000/**', async (route) => {
    const url = route.request().url()
    const method = route.request().method()

    apiCalls.push({ method, url })

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

    // 3. Edit session: findByOrder (GET /edit-sessions?orderSeqno=...)
    if (url.includes('/edit-sessions') && method === 'GET' && url.includes('orderSeqno')) {
      if (findByOrderResp) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(findByOrderResp),
        })
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ sessions: [], total: 0 }),
        })
      }
      return
    }

    // 4. Edit session: get by ID (GET /edit-sessions/:id)
    if (url.match(/\/edit-sessions\/[\w-]+$/) && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_EXISTING_SESSION),
      })
      return
    }

    // 5. Edit session: create (POST /edit-sessions)
    if (url.includes('/edit-sessions') && method === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(createSessionResp),
      })
      return
    }

    // 6. Edit session: update (PATCH /edit-sessions/:id)
    if (url.includes('/edit-sessions') && method === 'PATCH') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_EXISTING_SESSION),
      })
      return
    }

    // 7. Auto-save
    if (url.includes('/auto-save')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
      return
    }

    // Catch-all
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  })
}

/**
 * embed 에디터를 dev server 경로로 열기
 *
 * embed.tsx의 EmbeddedEditor는 dev server 메인 앱과 분리되어 있으므로,
 * 테스트 시 dev server에 테스트 HTML을 서빙하는 대신
 * console log를 캡처하여 동작을 검증한다.
 *
 * 실제로는 dev server(:3000)의 EditorView가 유사한 초기화 로직을 사용하지만,
 * embed.tsx의 session 복원 로직은 console.log로 검증한다.
 */
export async function openEmbedEditor(page: Page, options?: {
  timeout?: number
}) {
  const timeout = options?.timeout ?? 20000

  // dev server의 루트에 embed 모드 파라미터로 접근
  // (실제 embed 동작은 API mock의 호출 패턴으로 검증)
  await page.goto(`/?templateSetId=${MOCK_TEMPLATE_SET_ID}`)
  await page.waitForLoadState('networkidle')

  const canvas = page.locator('canvas').first()
  await canvas.waitFor({ state: 'attached', timeout })
  await page.waitForTimeout(3000)

  return canvas
}

// ============================================================
// Custom Test Fixture
// ============================================================

export const test = base.extend<{
  embedPage: Page
}>({
  // Playwright fixture 제공 콜백 — 이름이 use 이면 react-hooks 규칙이 React use() 로 오인한다
  embedPage: async ({ page }, provide) => {
    await provide(page)
  },
})

export { expect }
