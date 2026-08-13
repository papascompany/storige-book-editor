import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 내지 PDF '앉히기' 회귀 잠금 (W1, 2026-08-13).
 *
 * 종전 결함(G1·G5): 첨부가 끝나도 화면은 그대로였다 — 페이지 확장은 로드 경로
 * (loadTemplateSetEditor 의 underlayPageCount)에만, 가이드 배치는 /embed 세션 로드에만 있어
 * `?sessionId` 로 **재진입해야** 보였다.
 *
 * 잠그는 불변식:
 *  - ensureUnderlayPages 는 **추가만** 한다(감소 없음) — 사용자가 늘린 페이지를 첨부가 지우지 않는다.
 *  - 상한 200p(워커 래스터 상한) 를 넘겨 늘리지 않는다.
 *  - 스프레드 모드가 아니거나 내지 전용 펼침면 세트(regionScope='inner')면 손대지 않는다.
 *  - addInnerPage 가 페이지를 늘리지 못하면 즉시 중단한다(무한 루프 금지).
 *  - 가이드 배치는 **멱등** — 로드로 이미 깔린 뒤 첨부로 다시 호출돼도 중복 적재되지 않는다.
 *  - 표시전용 계약: 가이드는 excludeFromExport 로 깔린다.
 */

// ── 캔버스 런타임 스텁 ───────────────────────────────────────────────
const imageFromURL = vi.fn()
vi.mock('@storige/canvas-core', () => ({
  imageFromURL: (...args: unknown[]) => imageFromURL(...args),
  getFabricSync: () => ({
    Text: class {
      constructor(public text: string, public opts: Record<string, unknown>) {}
    },
  }),
}))

vi.mock('./fontManager', () => ({
  resolveStorageUrl: (u: string) => `https://api.example.com${u}`,
}))

/** 공개 엔드포인트만 쓴다 — `GET /template-sets/:id` 는 게스트 401(2026-08-13 적발) */
const getTemplateSetWithTemplates = vi.fn()
vi.mock('../api/template-sets', () => ({
  templateSetsApi: {
    getTemplateSetWithTemplates: (...a: unknown[]) => getTemplateSetWithTemplates(...a),
    getTemplateSet: () => {
      throw new Error('게스트 401 라우트 — 가이드 배치 경로에서 호출 금지')
    },
  },
}))

// ── 스토어 스텁 ─────────────────────────────────────────────────────
interface FakeCanvas {
  objects: Record<string, unknown>[]
  getObjects: () => Record<string, unknown>[]
  remove: (o: unknown) => void
  insertAt: (o: Record<string, unknown>, idx: number, nonSplicing: boolean) => void
  add: (o: unknown) => void
  requestRenderAll: () => void
  selection?: boolean
}

function makeCanvas(): FakeCanvas {
  const objects: Record<string, unknown>[] = [
    {
      id: 'workspace',
      left: 0,
      top: 0,
      width: 200,
      height: 300,
      scaleX: 1,
      scaleY: 1,
      originX: 'left',
      originY: 'top',
      angle: 0,
    },
  ]
  return {
    objects,
    getObjects: () => objects,
    remove: (o: unknown) => {
      const i = objects.indexOf(o as Record<string, unknown>)
      if (i >= 0) objects.splice(i, 1)
    },
    insertAt: (o, idx) => {
      objects.splice(idx, 0, o)
    },
    add: (o: unknown) => {
      objects.push(o as Record<string, unknown>)
    },
    requestRenderAll: () => {},
  }
}

const appState = {
  isSpreadMode: true,
  allCanvas: [] as FakeCanvas[],
  allEditors: [] as unknown[],
  addInnerPage: vi.fn(),
  setPage: vi.fn(),
}
const settingsState = { spreadConfig: { regionScope: 'cover' } as { regionScope?: string } | null }

vi.mock('../stores/useAppStore', () => ({
  useAppStore: { getState: () => appState },
}))
vi.mock('../stores/useSettingsStore', () => ({
  useSettingsStore: { getState: () => settingsState },
}))

import {
  applyContentPdfGuides,
  ensureUnderlayPages,
  seatContentPdf,
  UNDERLAY_MAX_PAGES,
} from './contentPdfGuide'

/** 표지 1 + 내지 n 장으로 캔버스 배열을 세팅 */
function setCanvases(innerCount: number): void {
  appState.allCanvas = Array.from({ length: innerCount + 1 }, () => makeCanvas())
  appState.allEditors = appState.allCanvas.map(() => ({ getPlugin: () => undefined }))
}

/** addInnerPage 기본 구현 — 캔버스를 실제로 1장 늘린다 */
function wireGrowingAddInnerPage(): void {
  appState.addInnerPage.mockImplementation(async () => {
    appState.allCanvas = [...appState.allCanvas, makeCanvas()]
    appState.allEditors = [...appState.allEditors, { getPlugin: () => undefined }]
  })
}

const guideSession = (pageCount: number, pageImageUrls?: string[]) => ({
  contentPdfMode: 'underlay',
  contentPdfFileId: 'file-1',
  contentPdfPageCount: pageCount,
  metadata: pageImageUrls ? { contentPdfGuide: { pageImageUrls } } : {},
})

beforeEach(() => {
  vi.clearAllMocks()
  appState.isSpreadMode = true
  settingsState.spreadConfig = { regionScope: 'cover' }
  wireGrowingAddInnerPage()
  imageFromURL.mockImplementation(async (_url: string, opts: Record<string, unknown>) => ({
    width: 100,
    height: 150,
    ...opts,
    set(this: Record<string, unknown>, patch: Record<string, unknown>) {
      Object.assign(this, patch)
    },
  }))
  getTemplateSetWithTemplates.mockResolvedValue({
    templateSet: { contentPdfEditable: true },
    templateDetails: [],
  })
})

describe('ensureUnderlayPages — 첨부 직후 내지 즉시 확장(G5)', () => {
  it('부족분만 추가한다', async () => {
    setCanvases(2)
    const added = await ensureUnderlayPages(5)
    expect(added).toBe(3)
    expect(appState.addInnerPage).toHaveBeenCalledTimes(3)
    expect(appState.allCanvas.length - 1).toBe(5)
  })

  it('이미 충분하면 줄이지 않는다 — 추가만 하는 계약', async () => {
    setCanvases(8)
    const added = await ensureUnderlayPages(3)
    expect(added).toBe(0)
    expect(appState.addInnerPage).not.toHaveBeenCalled()
    expect(appState.allCanvas.length - 1).toBe(8)
  })

  it(`상한 ${UNDERLAY_MAX_PAGES}p 를 넘겨 늘리지 않는다`, async () => {
    setCanvases(0)
    const added = await ensureUnderlayPages(UNDERLAY_MAX_PAGES + 50)
    expect(added).toBe(UNDERLAY_MAX_PAGES)
    expect(appState.allCanvas.length - 1).toBe(UNDERLAY_MAX_PAGES)
  })

  it('스프레드 모드가 아니면 손대지 않는다', async () => {
    setCanvases(1)
    appState.isSpreadMode = false
    expect(await ensureUnderlayPages(10)).toBe(0)
    expect(appState.addInnerPage).not.toHaveBeenCalled()
  })

  it("내지 전용 펼침면 세트(regionScope='inner')는 대상이 아니다", async () => {
    setCanvases(1)
    settingsState.spreadConfig = { regionScope: 'inner' }
    expect(await ensureUnderlayPages(10)).toBe(0)
    expect(appState.addInnerPage).not.toHaveBeenCalled()
  })

  it('addInnerPage 가 페이지를 늘리지 못하면 즉시 중단한다(무한 루프 금지)', async () => {
    setCanvases(1)
    appState.addInnerPage.mockImplementation(async () => {
      /* 컨테이너 부재 등으로 실패 — 캔버스 수 불변 */
    })
    const added = await ensureUnderlayPages(50)
    expect(added).toBe(0)
    expect(appState.addInnerPage).toHaveBeenCalledTimes(1)
  })

  it('페이지 수가 없거나 0 이면 no-op', async () => {
    setCanvases(1)
    expect(await ensureUnderlayPages(undefined)).toBe(0)
    expect(await ensureUnderlayPages(0)).toBe(0)
    expect(appState.addInnerPage).not.toHaveBeenCalled()
  })
})

describe('applyContentPdfGuides — 멱등 배치', () => {
  it('내지마다 가이드를 export 제외로 깐다', async () => {
    setCanvases(2)
    await applyContentPdfGuides(guideSession(2, ['/p1.png', '/p2.png']))

    for (const canvas of appState.allCanvas.slice(1)) {
      const guides = canvas.objects.filter(
        (o) => (o as { meta?: { system?: string } }).meta?.system === 'innerPdfGuide',
      )
      expect(guides).toHaveLength(1)
      expect((guides[0] as { excludeFromExport?: boolean }).excludeFromExport).toBe(true)
    }
    expect(imageFromURL).toHaveBeenCalledTimes(2)
  })

  it('두 번 호출해도 중복 적재되지 않는다 — 로드 후 첨부 재배치', async () => {
    setCanvases(2)
    const session = guideSession(2, ['/p1.png', '/p2.png'])
    await applyContentPdfGuides(session)
    await applyContentPdfGuides(session)

    for (const canvas of appState.allCanvas.slice(1)) {
      const guides = canvas.objects.filter(
        (o) => (o as { meta?: { system?: string } }).meta?.system === 'innerPdfGuide',
      )
      expect(guides).toHaveLength(1)
    }
  })

  it('underlay 모드가 아니면 아무것도 하지 않는다', async () => {
    setCanvases(2)
    await applyContentPdfGuides({
      contentPdfMode: 'replace',
      metadata: { contentPdfGuide: { pageImageUrls: ['/p1.png'] } },
    })
    expect(imageFromURL).not.toHaveBeenCalled()
  })
})

describe('seatContentPdf — 확장 + 배치 합성', () => {
  it('첨부 직후 페이지를 늘리고 가이드를 깐 뒤 첫 내지로 이동한다', async () => {
    setCanvases(1)
    const result = await seatContentPdf(guideSession(4, ['/1.png', '/2.png', '/3.png', '/4.png']), 'ts-1', {
      focusFirstInnerPage: true,
    })

    expect(result).toEqual({ addedPages: 3, guidesPlaced: true })
    expect(appState.allCanvas.length - 1).toBe(4)
    expect(appState.setPage).toHaveBeenCalledWith(1)
  })

  it('가이드 래스터가 없으면 페이지만 늘리고 guidesPlaced=false — 첨부 자체는 성공', async () => {
    setCanvases(1)
    const result = await seatContentPdf(guideSession(3), 'ts-1')

    expect(result).toEqual({ addedPages: 2, guidesPlaced: false })
    expect(appState.allCanvas.length - 1).toBe(3)
    expect(imageFromURL).not.toHaveBeenCalled()
  })

  it('underlay 세션이 아니면 페이지도 가이드도 건드리지 않는다', async () => {
    setCanvases(2)
    const result = await seatContentPdf({ contentPdfMode: null, contentPdfPageCount: 30 }, 'ts-1')

    expect(result).toEqual({ addedPages: 0, guidesPlaced: false })
    expect(appState.addInnerPage).not.toHaveBeenCalled()
    expect(appState.setPage).not.toHaveBeenCalled()
  })

  it('로드 경로(확장 완료 상태)에서 다시 불러도 no-op 확장 + 1회 배치', async () => {
    setCanvases(2)
    const session = guideSession(2, ['/1.png', '/2.png'])
    await seatContentPdf(session, 'ts-1')
    const second = await seatContentPdf(session, 'ts-1')

    expect(second.addedPages).toBe(0)
    expect(appState.allCanvas.length - 1).toBe(2)
    for (const canvas of appState.allCanvas.slice(1)) {
      const guides = canvas.objects.filter(
        (o) => (o as { meta?: { system?: string } }).meta?.system === 'innerPdfGuide',
      )
      expect(guides).toHaveLength(1)
    }
  })
})
