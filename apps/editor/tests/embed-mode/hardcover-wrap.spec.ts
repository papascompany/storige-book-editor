/**
 * /embed 양장 싸바리(hardcover_wrap) 모드 — 운영 응답 형태 회귀 스펙
 *
 * fixture(responses/)
 * - template-set.storybook-wrap.json: 동화책 싸바리 세트(9e768d01)의 공개 조회
 *   `GET /api/template-sets/{id}/with-templates` 응답(2026-10-06 캡처). 구조·값은 그대로 두고
 *   식별자만 가짜 값으로 바꿨다 — 세트 id → ts-e2e-storybook-wrap, 표지 템플릿 id →
 *   tpl-e2e-storybook-wrap-cover, 내지 템플릿 id → tpl-e2e-storybook-inner, 카테고리 id →
 *   cat-e2e-storybook, 내지 editCode·templateCode → EDIT-E2E-INNER·TMPL-E2E-INNER, createdBy → e2e-admin.
 *   운영 형태 그대로: spreadConfig 는 객체, spec.wingEnabled 는 boolean false, canvasData 는 빈 캔버스 객체.
 * - template-set.storybook-legacy.json: 대조군(207c458f 형태). 같은 응답 형태에 기존 표지 템플릿 값
 *   (면 247.4×276, 책등 1.2, 템플릿 496×276, 빈 캔버스)을 넣은 파생 fixture 다(운영 캡처 아님).
 *
 * 기준값
 * - 싸바리 켜짐: 판형 210×210 → 면 218×218(판형 + 사방 4). 표지 PDF = (2×218 + 책등 8 + 2×20) × (218 + 2×20)
 *   = 484×258 1쪽, 내지 PDF 420×210 8쪽, metadata.coverOutput 7키(layout·trim·wrapMm 포함).
 * - 대조군: 면이 판형과 맞지 않아 FACE_MISMATCH 로 모드가 꺼지고 기존 크기(496×276)로 나온다.
 * - 두 경우 모두 flat-spread 라 책등은 고정이고 /products/spine 호출이 없다.
 *
 * API 는 하네스가 모킹하므로 편집기 쪽 회귀만 잡는다(api 응답 직렬화·로더 회귀는 범위 밖).
 * 1차 단언은 업로드된 PDF 의 MediaBox(싸바리 표지는 TrimBox 키 없음)와 세션 PATCH 의 coverOutput 이다.
 * 스토어(useSettingsStore.hardcoverWrap)와 콘솔 경고 단언은 개발 서버 전용 보조 단언이다.
 * 운영 세트 값이 바뀌면 fixture 를 다시 캡처하고 같은 규칙으로 식별자를 바꾼 뒤 기준값을 공식으로 갱신한다.
 */
import { readFileSync } from 'node:fs'
import { test, expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import {
  captureDiagnostics,
  countCalls,
  expectHarnessClean,
  installEmbedHarness,
  openEmbed,
  waitForHostEvent,
  waitReady,
  type Diagnostics,
  type HostEvent,
  type MockApi,
  type TemplateSetMock,
} from './embed-host-harness'
import {
  captureFileUploads,
  measurePdf,
  readHardcoverWrap,
  WRAP_OFF_WARNING,
  type CapturedUpload,
  type HardcoverWrapSnapshot,
  type PdfMeasure,
} from './pdf-upload-capture'

test.use({ viewport: { width: 1480, height: 960 } })
test.setTimeout(120_000)

// ============================================================
// fixture
// ============================================================

const WRAP_ID = 'ts-e2e-storybook-wrap'
const LEGACY_ID = 'ts-e2e-storybook-legacy'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function recordAt(v: unknown, label: string): Record<string, unknown> {
  if (!isRecord(v)) throw new Error(`${label} 가 객체가 아님`)
  return v
}

function loadResponse(name: string): Record<string, unknown> {
  const raw: unknown = JSON.parse(readFileSync(new URL(`./responses/${name}`, import.meta.url), 'utf8'))
  const body = recordAt(raw, name)
  recordAt(body.templateSet, `${name} templateSet`)
  if (!Array.isArray(body.templateDetails) || !body.templateDetails.every(isRecord)) {
    throw new Error(`${name} templateDetails 가 객체 배열이 아님`)
  }
  return body
}

/** 하네스 TemplateSetMock 로 넘긴다(fixture 는 canvasData 객체 등 하네스 선언보다 넓은 운영 형태). */
function asTemplateSetMock(body: Record<string, unknown>): TemplateSetMock {
  return body as unknown as TemplateSetMock
}

function templateSetOf(body: Record<string, unknown>): Record<string, unknown> {
  return recordAt(body.templateSet, 'templateSet')
}

function detailsOf(body: Record<string, unknown>): Record<string, unknown>[] {
  const details = body.templateDetails
  if (!Array.isArray(details)) throw new Error('templateDetails 없음')
  return details.map((d, i) => recordAt(d, `templateDetails[${i}]`))
}

/** templates[] 순서대로 detail 을 찾는다. */
function detailByTemplateIndex(body: Record<string, unknown>, index: number): Record<string, unknown> {
  const templates = templateSetOf(body).templates
  if (!Array.isArray(templates)) throw new Error('templates 없음')
  const ref = recordAt(templates[index], `templates[${index}]`)
  const detail = detailsOf(body).find((d) => d.id === ref.templateId)
  if (!detail) throw new Error(`templates[${index}] 의 detail 없음`)
  return detail
}

// ============================================================
// 실행 공통
// ============================================================

/** bookmoa 전환 후 동화책 진입과 같은 값(두 테스트 공통 — 결과 차이는 데이터에서만 나온다). */
const ENTRY: Record<string, string | number> = {
  mode: 'both',
  pageCount: 16,
  pageCountMin: 16,
  pageCountMax: 48,
  pageStep: 4,
  bindingType: 'hardcover',
}

const SIZE_TOLERANCE_MM = 0.1

interface FinishRun {
  mock: MockApi
  diag: Diagnostics
  uploads: CapturedUpload[]
  complete: HostEvent
  wrapAtReady: HardcoverWrapSnapshot | null
}

async function openAndFinish(
  context: BrowserContext,
  page: Page,
  templateSetId: string,
  orderSeqno: number,
  waitWrapState: (page: Page, diag: Diagnostics) => Promise<HardcoverWrapSnapshot | null>,
): Promise<FinishRun> {
  const mock = await installEmbedHarness(context, {
    templateSets: {
      [WRAP_ID]: asTemplateSetMock(loadResponse('template-set.storybook-wrap.json')),
      [LEGACY_ID]: asTemplateSetMock(loadResponse('template-set.storybook-legacy.json')),
    },
  })
  const uploads = await captureFileUploads(context)
  const diag = captureDiagnostics(page)
  const frame = await openEmbed(page, mock, { ...ENTRY, templateSetId, orderSeqno })
  await waitReady(page, diag)
  const wrapAtReady = await waitWrapState(page, diag)
  await frame.getByRole('button', { name: '편집완료' }).click()
  const complete = await waitForHostEvent(page, 'editor.complete', 120_000)
  return { mock, diag, uploads, complete, wrapAtReady }
}

function uploadOf(uploads: CapturedUpload[], type: string): CapturedUpload {
  const found = uploads.filter((u) => u.type === type)
  expect(found, `${type} 업로드 건수`).toHaveLength(1)
  return found[0]
}

function expectSize(actual: { w: number; h: number }, w: number, h: number, label: string): void {
  expect(Math.abs(actual.w - w), `${label} 폭 ${actual.w} ≈ ${w}`).toBeLessThanOrEqual(SIZE_TOLERANCE_MM)
  expect(Math.abs(actual.h - h), `${label} 높이 ${actual.h} ≈ ${h}`).toBeLessThanOrEqual(SIZE_TOLERANCE_MM)
}

/** metadata.coverOutput 을 실은 PATCH 본문의 coverOutput 목록 */
function patchedCoverOutputs(mock: MockApi): unknown[] {
  return mock.patchBodies
    .map((p) => p.body.metadata)
    .filter(isRecord)
    .filter((m) => 'coverOutput' in m)
    .map((m) => m.coverOutput)
}

const spinePathCalls = (mock: MockApi): number => countCalls(mock, 'GET', (p) => p.startsWith('/products/spine')) +
  countCalls(mock, 'POST', (p) => p.startsWith('/products/spine'))

const wrapOffWarnings = (diag: Diagnostics): string[] => diag.warnings.filter((w) => w.includes(WRAP_OFF_WARNING))

function pdfFailureErrors(diag: Diagnostics): string[] {
  return diag.errors.filter((e) => e.includes('Spread COVER PDF 실패') || e.includes('Spread CONTENT PDF 실패'))
}

async function attachMeasures(
  testInfo: TestInfo,
  run: FinishRun,
  cover: PdfMeasure,
  content: PdfMeasure,
): Promise<void> {
  await testInfo.attach('measures.json', {
    contentType: 'application/json',
    body: JSON.stringify(
      {
        wrapAtReady: run.wrapAtReady,
        uploads: run.uploads.map((u) => ({ type: u.type, filename: u.filename, metadata: u.metadata, bytes: u.bytes.byteLength })),
        cover,
        content,
        coverOutputs: patchedCoverOutputs(run.mock),
        complete: run.complete.payload,
        wrapOffWarnings: wrapOffWarnings(run.diag),
      },
      null,
      2,
    ),
  })
}

// ============================================================
// 스펙
// ============================================================

test.describe('Embed 양장 싸바리 — 운영 응답 형태', () => {
  test('fixture 형태: 운영 응답의 타입·값을 유지한다', () => {
    const wrap = loadResponse('template-set.storybook-wrap.json')
    const legacy = loadResponse('template-set.storybook-legacy.json')

    for (const [label, body, face] of [
      ['wrap', wrap, { w: 218, h: 218 }],
      ['legacy', legacy, { w: 247.4, h: 276 }],
    ] as const) {
      const ts = templateSetOf(body)
      expect(ts.coverType, `${label} coverType`).toBe('hardcover_wrap')
      expect(ts.coverConfig, `${label} coverConfig`).toEqual({ innerRepeat: 'cycle' })
      expect([ts.width, ts.height], `${label} 판형`).toEqual([210, 210])
      expect([ts.pageCountRange, ts.pageStep], `${label} 쪽수 범위·단위`).toEqual([[16, 48], 4])

      const cover = detailByTemplateIndex(body, 0)
      const coverCfg = recordAt(cover.spreadConfig, `${label} 표지 spreadConfig`)
      expect(coverCfg.regionScope, `${label} 표지 regionScope`).toBe('cover')
      expect(coverCfg.conversionMode, `${label} 표지 conversionMode`).toBe('flat-spread')
      const spec = recordAt(coverCfg.spec, `${label} 표지 spec`)
      expect(typeof spec.wingEnabled, `${label} spec.wingEnabled 타입`).toBe('boolean')
      expect(spec.wingEnabled, `${label} spec.wingEnabled`).toBe(false)
      expect(spec, `${label} spec.caseBind`).not.toHaveProperty('caseBind')
      expect([spec.coverWidthMm, spec.coverHeightMm], `${label} 표지 면`).toEqual([face.w, face.h])

      const inner = detailByTemplateIndex(body, 1)
      expect(recordAt(inner.spreadConfig, `${label} 내지 spreadConfig`).regionScope, `${label} 내지 regionScope`).toBe('inner')

      for (const [part, detail] of [['표지', cover], ['내지', inner]] as const) {
        const canvas = recordAt(detail.canvasData, `${label} ${part} canvasData`)
        expect(canvas.objects, `${label} ${part} canvasData.objects`).toEqual([])
        expect(JSON.stringify(canvas), `${label} ${part} 외곽선 객체`).not.toContain('outline')
      }
    }
    expect(templateSetOf(wrap).id).toBe(WRAP_ID)
    expect(templateSetOf(legacy).id).toBe(LEGACY_ID)
  })

  test('싸바리 세트는 모드를 켜고 표지 484×258·내지 420×210 으로 완료한다', async ({ context, page }, testInfo) => {
    const run = await openAndFinish(context, page, WRAP_ID, 930001, async (p) => {
      let wrap: HardcoverWrapSnapshot | null = null
      await expect
        .poll(async () => {
          wrap = await readHardcoverWrap(p)
          return wrap
        }, { timeout: 30_000, message: 'hardcoverWrap 켜짐 대기' })
        .toEqual({ trimWidthMm: 210, trimHeightMm: 210, wrapPerSideMm: 20, screenCutSizeMm: 40, innerCutSizeMm: 3 })
      return wrap
    })

    expect(run.uploads.map((u) => u.type).sort()).toEqual(['content', 'cover'])
    const coverUpload = uploadOf(run.uploads, 'cover')
    const contentUpload = uploadOf(run.uploads, 'content')
    expect(coverUpload.metadata?.isSpreadCover).toBe(true)
    expect(contentUpload.metadata?.pageCount).toBe(8)

    const cover = await measurePdf(coverUpload.bytes)
    const content = await measurePdf(contentUpload.bytes)
    await attachMeasures(testInfo, run, cover, content)

    expect(cover.pageCount).toBe(1)
    expectSize(cover.pages[0].mediaMm, 484, 258, '표지 MediaBox')
    // 싸바리 출력은 재단 박스를 넣지 않는다(MediaBox 만) — TrimBox 키가 없어야 한다.
    expect(cover.pages[0].hasTrimBox).toBe(false)
    expect(content.pageCount).toBe(8)
    content.pages.forEach((p, i) => expectSize(p.mediaMm, 420, 210, `내지 ${i + 1}쪽 MediaBox`))

    const coverOutputs = patchedCoverOutputs(run.mock)
    expect(coverOutputs.length).toBeGreaterThanOrEqual(1)
    for (const co of coverOutputs) {
      expect(co).toEqual({
        widthMm: 484,
        heightMm: 258,
        bleedMm: 0,
        layout: 'hardcover-wrap',
        trimWidthMm: 210,
        trimHeightMm: 210,
        wrapMm: 20,
      })
    }

    expect(run.complete.payload.pageCount).toBe(16)
    expect(run.complete.payload.spineWidthMm).toBe(8)
    expect(wrapOffWarnings(run.diag)).toEqual([])
    expect(pdfFailureErrors(run.diag)).toEqual([])
    expect(spinePathCalls(run.mock)).toBe(0)
    expectHarnessClean(run.mock, [run.diag], testInfo)
  })

  test('대조군(면 247.4×276)은 FACE_MISMATCH 로 모드를 끄고 표지 496×276 으로 완료한다', async ({ context, page }, testInfo) => {
    const run = await openAndFinish(context, page, LEGACY_ID, 930002, async (p, diag) => {
      await expect
        .poll(() => wrapOffWarnings(diag).some((w) => w.includes('FACE_MISMATCH')), {
          timeout: 30_000,
          message: 'FACE_MISMATCH 모드 꺼짐 경고 대기',
        })
        .toBe(true)
      return readHardcoverWrap(p)
    })

    expect(run.wrapAtReady).toBeNull()
    expect(run.uploads.map((u) => u.type).sort()).toEqual(['content', 'cover'])
    const coverUpload = uploadOf(run.uploads, 'cover')
    const contentUpload = uploadOf(run.uploads, 'content')
    expect(coverUpload.metadata?.isSpreadCover).toBe(true)
    expect(contentUpload.metadata?.pageCount).toBe(8)

    const cover = await measurePdf(coverUpload.bytes)
    const content = await measurePdf(contentUpload.bytes)
    await attachMeasures(testInfo, run, cover, content)

    expect(cover.pageCount).toBe(1)
    expectSize(cover.pages[0].mediaMm, 496, 276, '표지 MediaBox')
    expect(content.pageCount).toBe(8)
    content.pages.forEach((p, i) => expectSize(p.mediaMm, 420, 210, `내지 ${i + 1}쪽 MediaBox`))

    const coverOutputs = patchedCoverOutputs(run.mock)
    expect(coverOutputs.length).toBeGreaterThanOrEqual(1)
    for (const co of coverOutputs) expect(co).toEqual({ widthMm: 496, heightMm: 276, bleedMm: 0 })

    expect(run.complete.payload.pageCount).toBe(16)
    expect(run.complete.payload.spineWidthMm).toBe(1.2)
    expect(wrapOffWarnings(run.diag).every((w) => w.includes('FACE_MISMATCH'))).toBe(true)
    expect(pdfFailureErrors(run.diag)).toEqual([])
    expect(spinePathCalls(run.mock)).toBe(0)
    expectHarnessClean(run.mock, [run.diag], testInfo)
  })
})
