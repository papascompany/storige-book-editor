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

vi.mock('../api/edit-sessions', () => ({
  editSessionsApi: {
    update: vi.fn(),
    updateGuest: vi.fn(),
  },
}))

vi.mock('../api/client', () => ({
  apiClient: { post: vi.fn(), get: vi.fn() },
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
  addPage: vi.fn(),
  setPage: vi.fn(),
}
const settingsState = {
  spreadConfig: { regionScope: 'cover' } as {
    regionScope?: string
    innerSpec?: { pageWidthMm: number; pageHeightMm: number }
  } | null,
  hasCoverSlot: true,
  pageTrimMm: { width: 210, height: 297 },
  currentSettings: { size: { width: 210, height: 297 }, dpi: 150 },
}

vi.mock('../stores/useAppStore', () => ({
  useAppStore: { getState: () => appState },
}))
vi.mock('../stores/useSettingsStore', () => ({
  useSettingsStore: { getState: () => settingsState },
}))

import {
  applyContentPdfGuides,
  ensureUnderlayPages,
  persistContentPdfPageOrderAfterReorder,
  rememberContentPdfPageOrder,
  resolveUnderlaySource,
  seatContentPdf,
  UNDERLAY_MAX_PAGES,
} from './contentPdfGuide'

/** 표지 1 + 내지 n 장으로 캔버스 배열을 세팅 */
function setCanvases(innerCount: number): void {
  appState.allCanvas = Array.from({ length: innerCount + 1 }, () => makeCanvas())
  appState.allEditors = appState.allCanvas.map(() => ({ getPlugin: () => undefined }))
}

function growOneCanvas(): void {
  appState.allCanvas = [...appState.allCanvas, makeCanvas()]
  appState.allEditors = [...appState.allEditors, { getPlugin: () => undefined }]
}

/** addInnerPage / addPage 기본 구현 — 캔버스를 실제로 1장 늘린다 */
function wireGrowingAddInnerPage(): void {
  appState.addInnerPage.mockImplementation(async () => {
    growOneCanvas()
  })
  appState.addPage.mockImplementation(async () => {
    growOneCanvas()
  })
}

function setInnerOnlyCanvases(count: number): void {
  appState.allCanvas = Array.from({ length: count }, () => makeCanvas())
  appState.allEditors = appState.allCanvas.map(() => ({ getPlugin: () => undefined }))
}

const guideSession = (pageCount: number, pageImageUrls?: string[]) => ({
  contentPdfMode: 'underlay',
  contentPdfFileId: 'file-1',
  contentPdfPageCount: pageCount,
  metadata: pageImageUrls ? { contentPdfGuide: { pageImageUrls } } : {},
})

beforeEach(() => {
  vi.clearAllMocks()
  rememberContentPdfPageOrder(undefined)
  appState.isSpreadMode = true
  settingsState.spreadConfig = { regionScope: 'cover' }
  settingsState.hasCoverSlot = true
  settingsState.pageTrimMm = { width: 210, height: 297 }
  settingsState.currentSettings = { size: { width: 210, height: 297 }, dpi: 150 }
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

  it('단면(비스프레드)은 addPage 로 1장=1캔버스 확장한다', async () => {
    setInnerOnlyCanvases(1)
    appState.isSpreadMode = false
    settingsState.hasCoverSlot = false
    settingsState.spreadConfig = null
    expect(await ensureUnderlayPages(4)).toBe(3)
    expect(appState.addPage).toHaveBeenCalledTimes(3)
    expect(appState.addInnerPage).not.toHaveBeenCalled()
    expect(appState.allCanvas).toHaveLength(4)
  })

  it("내지 전용 펼침면은 PDF 2장=캔버스 1장으로 확장한다", async () => {
    setInnerOnlyCanvases(1)
    settingsState.hasCoverSlot = false
    settingsState.spreadConfig = {
      regionScope: 'inner',
      innerSpec: { pageWidthMm: 210, pageHeightMm: 297 },
    }
    expect(await ensureUnderlayPages(8)).toBe(3)
    expect(appState.addInnerPage).toHaveBeenCalledTimes(3)
    expect(appState.allCanvas).toHaveLength(4)
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

  it('contentPdfPageOrder 가 있으면 그 원본 PDF 페이지를 슬롯에 깐다', async () => {
    setCanvases(3)
    await applyContentPdfGuides({
      contentPdfMode: 'underlay',
      metadata: {
        contentPdfGuide: { pageImageUrls: ['/a.png', '/b.png', '/c.png'] },
        contentPdfPageOrder: [2, 0, 1],
      },
    })
    expect(imageFromURL).toHaveBeenNthCalledWith(
      1,
      'https://api.example.com/c.png',
      expect.any(Object),
    )
    expect(imageFromURL).toHaveBeenNthCalledWith(
      2,
      'https://api.example.com/a.png',
      expect.any(Object),
    )
    expect(imageFromURL).toHaveBeenNthCalledWith(
      3,
      'https://api.example.com/b.png',
      expect.any(Object),
    )
  })

  it('underlay 모드가 아니면 아무것도 하지 않는다', async () => {
    setCanvases(2)
    await applyContentPdfGuides({
      contentPdfMode: 'replace',
      metadata: { contentPdfGuide: { pageImageUrls: ['/p1.png'] } },
    })
    expect(imageFromURL).not.toHaveBeenCalled()
  })

  it('표지 총폭(430)이 스토어에 있어도 내지 워크스페이스 mm로 앉힌다', async () => {
    setCanvases(1)
    settingsState.currentSettings = { size: { width: 430, height: 297 }, dpi: 150 }
    settingsState.pageTrimMm = { width: 210, height: 297 }
    settingsState.hasCoverSlot = true
    settingsState.spreadConfig = { regionScope: 'cover' }
    // 210mm @ 150dpi ≈ 1240px 워크스페이스, 210mm @ 110dpi 이미지
    const ws = appState.allCanvas[1].objects[0] as { width: number; height: number }
    ws.width = (210 / 25.4) * 150
    ws.height = (297 / 25.4) * 150
    const imgW = (210 / 25.4) * 110
    imageFromURL.mockImplementation(async (_url: string, opts: Record<string, unknown>) => ({
      width: imgW,
      height: (297 / 25.4) * 110,
      ...opts,
      set(this: Record<string, unknown>, patch: Record<string, unknown>) {
        Object.assign(this, patch)
      },
    }))
    await applyContentPdfGuides(guideSession(1, ['/a4.png']))
    const guide = appState.allCanvas[1].objects.find(
      (o) => (o as { meta?: { system?: string } }).meta?.system === 'innerPdfGuide',
    ) as { scaleX?: number; scaleY?: number }
    expect(guide.scaleX).toBeCloseTo(150 / 110, 5)
    expect(guide.scaleX).toBe(guide.scaleY)
    const wrong = (210 / 430) * (ws.width / imgW)
    expect(guide.scaleX).not.toBeCloseTo(wrong, 5)
  })

  it('내지펼침면은 한 캔버스에 좌·우 두 장을 원본 비율로 깐다', async () => {
    setInnerOnlyCanvases(1)
    settingsState.hasCoverSlot = false
    settingsState.spreadConfig = {
      regionScope: 'inner',
      innerSpec: { pageWidthMm: 210, pageHeightMm: 297 },
    }
    imageFromURL.mockImplementation(async (_url: string, opts: Record<string, unknown>) => ({
      width: 100,
      height: 80,
      ...opts,
      set(this: Record<string, unknown>, patch: Record<string, unknown>) {
        Object.assign(this, patch)
      },
    }))
    await applyContentPdfGuides(
      guideSession(2, ['/l.png', '/r.png']),
    )
    const guides = appState.allCanvas[0].objects.filter(
      (o) => (o as { meta?: { system?: string } }).meta?.system === 'innerPdfGuide',
    )
    expect(guides).toHaveLength(2)
    expect(imageFromURL).toHaveBeenNthCalledWith(1, 'https://api.example.com/l.png', expect.any(Object))
    expect(imageFromURL).toHaveBeenNthCalledWith(2, 'https://api.example.com/r.png', expect.any(Object))
    const a = guides[0] as { scaleX?: number; scaleY?: number; originX?: string }
    const b = guides[1] as { scaleX?: number; scaleY?: number }
    expect(a.originX).toBe('center')
    expect(a.scaleX).toBe(a.scaleY)
    expect(b.scaleX).toBe(b.scaleY)
    expect(a.scaleX).not.toBe(200 / 100)
    expect(a.scaleY).not.toBe(300 / 80)
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

describe('resolveUnderlaySource', () => {
  it('contentPdfFileId 가 있으면 그걸 쓴다', () => {
    expect(
      resolveUnderlaySource({
        contentPdfFileId: 'pdf-1',
        contentFileId: 'out-1',
        contentPdfPageCount: 4,
      }),
    ).toEqual({ fileId: 'pdf-1', pageCount: 4 })
  })

  it('주문 화면에서 올린 contentFileId 를 underlay 소스로 승격한다', () => {
    expect(
      resolveUnderlaySource({ contentFileId: 'shop-1', status: 'editing' }),
    ).toEqual({ fileId: 'shop-1', pageCount: null })
  })

  it('완료 세션의 편집 산출물은 승격하지 않는다', () => {
    expect(
      resolveUnderlaySource({ contentFileId: 'out-1', status: 'complete' }),
    ).toBeNull()
  })

  it('replace 모드는 앉히지 않는다', () => {
    expect(
      resolveUnderlaySource({ contentPdfFileId: 'pdf-1', contentPdfMode: 'replace' }),
    ).toBeNull()
  })
})

describe('persistContentPdfPageOrderAfterReorder', () => {
  it('세션이 있으면 metadata.contentPdfPageOrder 를 shallow-merge PATCH 한다', async () => {
    const { editSessionsApi } = await import('../api/edit-sessions')
    const next = await persistContentPdfPageOrderAfterReorder({
      newIndices: [0, 3, 1, 2],
      innerStart: 1,
      sessionId: 'sess-1',
    })
    expect(next).toEqual([2, 0, 1])
    expect(editSessionsApi.update).toHaveBeenCalledWith('sess-1', {
      metadata: { contentPdfPageOrder: [2, 0, 1] },
    })
  })
})
