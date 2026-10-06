/**
 * /embed 「편집완료」 PDF 업로드 가로채기·측정 헬퍼
 *
 * - `captureFileUploads` 는 `installEmbedHarness` 뒤에 `POST /api/files/upload` 전용 route 를 등록한다.
 *   Playwright 는 나중에 등록한 route 를 먼저 매칭하므로 업로드만 여기서 받고, CORS preflight(OPTIONS)는
 *   `route.fallback()` 으로 하네스에 넘긴다. 하네스 기본 처리는 본문을 문자열(`postData()`)로 읽어 바이너리가
 *   깨지고 미매칭 POST 에 `{}` 를 돌려줘 업로드 id 가 없어진다(표지 업로드 실패 → coverOutput 생략).
 * - multipart 는 Node 내장 `Response.formData()` 로 파싱한다.
 * - pdf-lib 은 apps/editor 에서 resolve 되지 않으므로 packages/canvas-core 의존성을 `createRequire` 로 불러온다
 *   (devDependency 추가 없음).
 * - `readHardcoverWrap` 은 개발 서버(vite)에서만 실행된다(스토어 모듈 직접 import).
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { BrowserContext, Page, Route } from '@playwright/test'
import { API_ORIGIN, API_PREFIX, EDITOR_ORIGIN } from './embed-host-harness'

// ============================================================
// 상수·타입
// ============================================================

/** useEditorContents 가 싸바리 모드를 끌 때 남기는 경고 문구(reason 을 함께 싣는다) */
export const WRAP_OFF_WARNING = '양장 싸바리 모드 꺼짐'

export const UPLOAD_PATH = `${API_PREFIX}/files/upload`

export interface CapturedUpload {
  /** multipart `type` 필드(cover·content 등) */
  type: string
  filename: string
  /** multipart `metadata` 필드(JSON 문자열)를 파싱한 값. 없거나 JSON 이 아니면 null */
  metadata: Record<string, unknown> | null
  bytes: Uint8Array
  /** 이 업로드에 돌려준 가짜 파일 id */
  fileId: string
}

export interface SizeMm {
  w: number
  h: number
}

export interface PdfPageMeasure {
  mediaMm: SizeMm
  /** TrimBox(없으면 pdf-lib 규칙대로 CropBox → MediaBox) */
  trimMm: SizeMm
  hasTrimBox: boolean
}

export interface PdfMeasure {
  pageCount: number
  pages: PdfPageMeasure[]
}

/** useSettingsStore.hardcoverWrap(HardcoverWrapMode) 스냅샷 */
export interface HardcoverWrapSnapshot {
  trimWidthMm: number
  trimHeightMm: number
  wrapPerSideMm: number
  screenCutSizeMm: number
  innerCutSizeMm: number
}

// pdf-lib 에서 쓰는 최소 구조만 선언한다(타입 패키지를 apps/editor 에서 resolve 하지 않음).
interface PdfBoxLike {
  x: number
  y: number
  width: number
  height: number
}

interface PdfPageLike {
  getMediaBox(): PdfBoxLike
  getTrimBox(): PdfBoxLike
  node: { TrimBox(): unknown }
}

interface PdfDocLike {
  getPageCount(): number
  getPages(): PdfPageLike[]
}

interface PdfLibLike {
  PDFDocument: { load(bytes: Uint8Array): Promise<PdfDocLike> }
}

// ============================================================
// pdf-lib 로딩·측정
// ============================================================

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

let pdfLib: PdfLibLike | null = null

/** packages/canvas-core 기준으로 pdf-lib 을 불러온다. */
export function loadPdfLib(): PdfLibLike {
  if (pdfLib) return pdfLib
  const anchor = fileURLToPath(new URL('../../../../packages/canvas-core/package.json', import.meta.url))
  const mod: unknown = createRequire(anchor)('pdf-lib')
  // PDFDocument 는 class(function)이고 load 는 정적 메서드다.
  const doc: unknown = isRecord(mod) ? mod.PDFDocument : undefined
  if (typeof doc !== 'function' || !('load' in doc) || typeof doc.load !== 'function') {
    throw new Error('pdf-lib 을 packages/canvas-core 에서 불러오지 못함')
  }
  pdfLib = mod as unknown as PdfLibLike
  return pdfLib
}

const ptToMm = (pt: number): number => Math.round(((pt * 25.4) / 72) * 100) / 100

const boxMm = (b: PdfBoxLike): SizeMm => ({ w: ptToMm(b.width), h: ptToMm(b.height) })

/** PDF 쪽수와 쪽별 MediaBox·TrimBox 크기(mm, 소수 2자리)를 잰다. */
export async function measurePdf(bytes: Uint8Array): Promise<PdfMeasure> {
  const doc = await loadPdfLib().PDFDocument.load(bytes)
  const pages = doc.getPages().map(
    (p): PdfPageMeasure => ({
      mediaMm: boxMm(p.getMediaBox()),
      trimMm: boxMm(p.getTrimBox()),
      hasTrimBox: p.node.TrimBox() !== undefined,
    }),
  )
  return { pageCount: doc.getPageCount(), pages }
}

// ============================================================
// 업로드 가로채기
// ============================================================

function parseJsonRecord(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null
  try {
    const v: unknown = JSON.parse(raw)
    return isRecord(v) ? v : null
  } catch {
    return null
  }
}

async function fulfillUpload(route: Route, uploads: CapturedUpload[]): Promise<void> {
  const request = route.request()
  const headers = {
    'access-control-allow-origin': EDITOR_ORIGIN,
    'access-control-allow-credentials': 'true',
  }
  const contentType = request.headers()['content-type'] ?? ''
  const body = request.postDataBuffer()
  if (!body || !contentType.startsWith('multipart/form-data')) {
    await route.fulfill({
      status: 400,
      headers,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 400, message: 'e2e: multipart 본문 없음' }),
    })
    return
  }
  const form = await new Response(new Uint8Array(body), { headers: { 'content-type': contentType } }).formData()
  const file = form.get('file')
  const typeField = form.get('type')
  const metadataField = form.get('metadata')
  if (file === null || typeof file === 'string') {
    await route.fulfill({
      status: 400,
      headers,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 400, message: 'e2e: file 파트 없음' }),
    })
    return
  }
  const type = typeof typeField === 'string' ? typeField : ''
  const bytes = new Uint8Array(await file.arrayBuffer())
  const fileId = `e2e-file-${type || 'unknown'}-${uploads.length + 1}`
  uploads.push({
    type,
    filename: file.name,
    metadata: parseJsonRecord(typeof metadataField === 'string' ? metadataField : null),
    bytes,
    fileId,
  })
  const now = new Date().toISOString()
  await route.fulfill({
    status: 201,
    headers,
    contentType: 'application/json',
    body: JSON.stringify({
      id: fileId,
      fileName: file.name,
      originalName: file.name,
      filePath: '',
      mimeType: 'application/pdf',
      fileSize: bytes.byteLength,
      fileType: type,
      status: 'uploaded',
      createdAt: now,
      updatedAt: now,
    }),
  })
}

/**
 * `installEmbedHarness` 뒤에 호출한다. 받은 업로드를 돌려준 배열에 차례로 쌓는다.
 * 실제 서버로는 보내지 않는다.
 */
export async function captureFileUploads(context: BrowserContext): Promise<CapturedUpload[]> {
  const uploads: CapturedUpload[] = []
  await context.route(`${API_ORIGIN}${UPLOAD_PATH}`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    await fulfillUpload(route, uploads)
  })
  return uploads
}

// ============================================================
// 개발 서버 전용 스토어 읽기
// ============================================================

/**
 * 개발 서버에서만 실행: 편집기 iframe 에서 vite 모듈 `/src/stores/useSettingsStore.ts` 를 불러
 * hardcoverWrap(싸바리 모드)을 읽는다. 모드가 꺼져 있으면 null.
 */
export async function readHardcoverWrap(page: Page): Promise<HardcoverWrapSnapshot | null> {
  const frame = page.frame({ url: /\/embed/ })
  if (!frame) throw new Error('편집기 frame 없음')
  const raw: unknown = await frame.evaluate(
    "import('/src/stores/useSettingsStore.ts').then(m => { const w = m.useSettingsStore.getState().hardcoverWrap; return w ? { trimWidthMm: w.trimWidthMm, trimHeightMm: w.trimHeightMm, wrapPerSideMm: w.wrapPerSideMm, screenCutSizeMm: w.screenCutSizeMm, innerCutSizeMm: w.innerCutSizeMm } : null })",
  )
  if (raw === null) return null
  if (!isRecord(raw)) throw new Error('hardcoverWrap 값을 읽지 못함')
  const num = (k: keyof HardcoverWrapSnapshot): number => {
    const v = raw[k]
    if (typeof v !== 'number') throw new Error(`hardcoverWrap.${k} 가 숫자가 아님`)
    return v
  }
  return {
    trimWidthMm: num('trimWidthMm'),
    trimHeightMm: num('trimHeightMm'),
    wrapPerSideMm: num('wrapPerSideMm'),
    screenCutSizeMm: num('screenCutSizeMm'),
    innerCutSizeMm: num('innerCutSizeMm'),
  }
}
