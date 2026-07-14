/**
 * PDF 골든 캡처 픽스처 (Track A ADR-1 사후검증)
 *
 * canvas-core "소스"를 직접 임포트해(빌드 산출물 아님) 실제 편집기 PDF 저장 경로
 * (ServicePlugin.saveMultiPagePDFAsBlob → _createMultiPagePDF → svg2pdf/jspdf)를
 * 결정적 입력으로 실행하고, 생성된 PDF 바이트를 로컬 수신 서버(:3199)로 POST 한다.
 *
 * 커버 경로: 다페이지(2p) 벡터렌더 ×2 + _addCutLinePage(칼선) + SmartCodePlugin
 * barcode()/qrcode()(jsbarcode·qr-code-styling dynamic import 경로) + jspdf compress.
 * 미커버(문서화): effects 페이지(imagePlugin 필요), outlines 칼선, 에러복구 경로,
 * pdf-lib(save.ts, zero-callsite), paper(PDF 경로 아님 — 클리핑 UX 전용).
 *
 * 결정성 원칙: 텍스트/폰트 미사용(로딩 비결정 회피), 고정 좌표/색상, 동일 브라우저.
 */
// offHistory/onHistory 프로토타입 패치 (배럴 미포함 — 반드시 직접 임포트)
import '@cc/utils/history'
import Editor, { ServicePlugin, SmartCodePlugin, mmToPx, getFabric } from '@cc/index'

const logEl = document.getElementById('log')!
const statusEl = document.getElementById('status')!
function log(msg: string) {
  logEl.textContent += msg + '\n'
  // eslint-disable-next-line no-console
  console.log('[golden]', msg)
}

const params = new URLSearchParams(location.search)
const LABEL = params.get('label') || 'unlabeled'
/**
 * 캡처 케이스 (Track 1, 2026-07-06 — 포토북 출력 계약 골든):
 * - 'book'(기본, 기존 경로 byte-identical): A4 2p + 칼선 + 바코드/QR.
 * - 'photobook-content': D-1 — 내지 content 페이지 = 2-up trim(190×2=380 × 190mm).
 *   기대 MediaBox: 380×190mm = 1077.17×538.58pt (bleed 게이트 OFF 기준).
 * - 'photobook-cover-wrap': D-4 — 하드커버 cover 페이지 = wrap 포함 출력 사이즈.
 *   trim 430×297mm(cover210×2+spine10) + caseBind(board2/turnIn15/wrap5) →
 *   printSize 474×337mm = 기대 MediaBox 1343.62×955.28pt, 콘텐츠(trim 렌더)는 중앙 배치.
 */
const CASE = params.get('case') || 'book'
const RECEIVER = 'http://localhost:3199'

// ── 결정적 지오메트리: A4 재단 210x297 + 재단여백 3mm = 작업 216x303mm @150dpi ──
const SIZE = { width: 210, height: 297, cutSize: 3 }
const DPI = 150

async function buildPage1(fabric: any) {
  const el = document.createElement('canvas')
  const canvas = new fabric.Canvas(el, { width: 1500, height: 2000 })
  const editor = new Editor()
  editor.init(canvas)

  const wsW = mmToPx(SIZE.width + SIZE.cutSize * 2, DPI)
  const wsH = mmToPx(SIZE.height + SIZE.cutSize * 2, DPI)
  const workspace = new fabric.Rect({
    id: 'workspace',
    left: 0,
    top: 0,
    width: wsW,
    height: wsH,
    fill: '#ffffff',
    selectable: false,
    evented: false,
  })
  canvas.add(workspace)

  // 벡터 도형(고정 좌표·색)
  canvas.add(
    new fabric.Rect({ id: 'r1', left: 120, top: 160, width: 400, height: 260, fill: '#e8443a' }),
    new fabric.Rect({
      id: 'r2',
      left: 320,
      top: 300,
      width: 400,
      height: 260,
      fill: '#2b6cb0',
      opacity: 0.6,
      angle: 15,
    }),
    new fabric.Circle({ id: 'c1', left: 700, top: 900, radius: 180, fill: '#2f855a' }),
    new fabric.Path('M 200 1400 C 350 1200, 550 1600, 700 1380 S 950 1200, 1050 1450', {
      id: 'p1',
      fill: '',
      stroke: '#6b46c1',
      strokeWidth: 12,
    })
  )

  // E1 §5-1: excludeFromExport 오버레이 케이스 — 스마트 가이드류 화면 전용 객체가
  // PDF 에 유입되지 않아야 한다(leak 회귀를 능동 트리거: 유입 시 마젠타 선이
  // 픽셀 diff 로 즉시 검출). 결정성 원칙 준수(벡터·고정 좌표·텍스트/폰트 미사용).
  canvas.add(
    new fabric.Line([0, 700, wsW, 700], {
      // 가이드 계약: id 미부여 + excludeFromExport + extensionType 'guideline'
      stroke: '#ff00ff',
      strokeWidth: 10,
      selectable: false,
      evented: false,
      excludeFromExport: true,
      extensionType: 'guideline',
    }),
    new fabric.Rect({
      left: 200,
      top: 800,
      width: 600,
      height: 300,
      fill: '#ff00ff',
      opacity: 0.5,
      selectable: false,
      evented: false,
      excludeFromExport: true,
      extensionType: 'guideline',
    })
  )

  // SmartCode 경로(jsbarcode / qr-code-styling — Track A ② dynamic import 실행)
  const smart = new SmartCodePlugin(canvas, editor)
  editor.use(smart)
  const barcode = await smart.barcode({ value: 'GOLDEN-0001', text: 'GOLDEN-0001', format: 'CODE128' } as any)
  if (!barcode) throw new Error('barcode 생성 실패')
  barcode.set({ left: 640, top: 1750 })
  canvas.add(barcode)
  const qr = await smart.qrcode({ data: 'https://golden.example/track-a' } as any)
  if (!qr) throw new Error('qrcode 생성 실패')
  qr.set({ left: 1050, top: 620 })
  qr.scaleToWidth(300)
  canvas.add(qr)

  canvas.renderAll()
  return { canvas, editor }
}

async function buildPage2(fabric: any) {
  const el = document.createElement('canvas')
  const canvas = new fabric.Canvas(el, { width: 1500, height: 2000 })
  const editor = new Editor()
  editor.init(canvas)

  const wsW = mmToPx(SIZE.width + SIZE.cutSize * 2, DPI)
  const wsH = mmToPx(SIZE.height + SIZE.cutSize * 2, DPI)
  canvas.add(
    new fabric.Rect({
      id: 'workspace',
      left: 0,
      top: 0,
      width: wsW,
      height: wsH,
      fill: '#fffef2',
      selectable: false,
      evented: false,
    }),
    new fabric.Triangle({ id: 't1', left: 200, top: 200, width: 500, height: 420, fill: '#d69e2e' }),
    new fabric.Ellipse({ id: 'e1', left: 500, top: 1000, rx: 320, ry: 180, fill: '#00b5d8', opacity: 0.75 }),
    new fabric.Path('M 150 1600 Q 450 1350, 750 1600 T 1250 1600 L 1250 1720 L 150 1720 Z', {
      id: 'p2',
      fill: '#805ad5',
      stroke: '#322659',
      strokeWidth: 6,
    })
  )
  canvas.renderAll()
  return { canvas, editor }
}

/**
 * 포토북 케이스용 결정적 벡터 페이지 (텍스트/폰트 미사용 — 결정성 원칙 동일).
 * sizeMm = trim 기준, workspace = trim + cutSize×2 (@150dpi).
 */
async function buildVectorPage(
  fabric: any,
  sizeMm: { width: number; height: number; cutSize: number },
  variant: 0 | 1,
) {
  const el = document.createElement('canvas')
  const canvas = new fabric.Canvas(el, { width: 2600, height: 1400 })
  const editor = new Editor()
  editor.init(canvas)

  const wsW = mmToPx(sizeMm.width + sizeMm.cutSize * 2, DPI)
  const wsH = mmToPx(sizeMm.height + sizeMm.cutSize * 2, DPI)
  canvas.add(
    new fabric.Rect({
      id: 'workspace',
      left: 0,
      top: 0,
      width: wsW,
      height: wsH,
      fill: variant === 0 ? '#ffffff' : '#fbf7ee',
      selectable: false,
      evented: false,
    }),
    // 좌면/우면 식별용 고정 도형(2-up 경계 시각 확인) — 좌면 사각 + 우면 원
    new fabric.Rect({
      id: `pb-r${variant}`,
      left: Math.round(wsW * 0.08),
      top: Math.round(wsH * 0.15),
      width: Math.round(wsW * 0.3),
      height: Math.round(wsH * 0.5),
      fill: variant === 0 ? '#e8443a' : '#2b6cb0',
    }),
    new fabric.Circle({
      id: `pb-c${variant}`,
      left: Math.round(wsW * 0.62),
      top: Math.round(wsH * 0.25),
      radius: Math.round(wsH * 0.22),
      fill: variant === 0 ? '#2f855a' : '#d69e2e',
    }),
    // 중앙(거터/책등) 경계 라인
    new fabric.Rect({
      id: `pb-g${variant}`,
      left: Math.round(wsW / 2) - 2,
      top: 0,
      width: 4,
      height: wsH,
      fill: '#6b46c1',
    })
  )
  canvas.renderAll()
  return { canvas, editor }
}

/** D-1 골든: 포토북 내지 2-up content — 페이지 크기 = pageWidthMm×2 × pageHeightMm (2p). */
async function runPhotobookContent(fabric: any) {
  // innerSpec: 190×190 정방형 포토북, 2-up trim = 380×190
  const CONTENT_SIZE = { width: 380, height: 190, cutSize: 3 }
  const s1 = await buildVectorPage(fabric, CONTENT_SIZE, 0)
  const s2 = await buildVectorPage(fabric, CONTENT_SIZE, 1)
  const service = new ServicePlugin(s1.canvas, s1.editor, null as any, {})
  s1.editor.use(service)
  return service.saveMultiPagePDFAsBlob(
    [s1.canvas, s2.canvas],
    [s1.editor, s2.editor],
    'golden-photobook-content',
    CONTENT_SIZE,
    undefined,
    DPI
  )
}

/** D-4 골든: 하드커버 cover — 페이지(MediaBox) = wrap 포함 출력 사이즈(printSize), 콘텐츠 중앙. */
async function runPhotobookCoverWrap(fabric: any) {
  // trim = cover210×2 + spine10 = 430×297 / caseBind(board2, turnIn15, wrap5)
  // → 출력 = 430+2×2+(15+5)×2 = 474 × 297+(15+5)×2 = 337 (computeSpreadOutputDimensions 동일 공식)
  const COVER_TRIM = { width: 430, height: 297, cutSize: 3 }
  const COVER_OUTPUT = { width: 474, height: 337 }
  const c1 = await buildVectorPage(fabric, COVER_TRIM, 0)
  const service = new ServicePlugin(c1.canvas, c1.editor, null as any, {})
  c1.editor.use(service)
  return service.saveMultiPagePDFAsBlob(
    [c1.canvas],
    [c1.editor],
    'golden-photobook-cover-wrap',
    { ...COVER_TRIM, printSize: COVER_OUTPUT },
    undefined,
    DPI
  )
}

async function run() {
  const fabric = await getFabric()

  // ── 포토북 케이스(Track 1 additive) — 기본 'book' 경로는 아래 기존 흐름 그대로 ──
  if (CASE === 'photobook-content' || CASE === 'photobook-cover-wrap') {
    log(`캡처 시작 label=${LABEL} case=${CASE}`)
    const t0 = performance.now()
    const blob: Blob =
      CASE === 'photobook-content'
        ? await runPhotobookContent(fabric)
        : await runPhotobookCoverWrap(fabric)
    log(`PDF 생성 완료 ${blob.size} bytes (${Math.round(performance.now() - t0)}ms)`)
    const res = await fetch(
      `${RECEIVER}/save?label=${encodeURIComponent(LABEL)}&name=${encodeURIComponent(CASE)}`,
      { method: 'POST', body: blob }
    )
    if (!res.ok) throw new Error(`수신 서버 저장 실패 HTTP ${res.status}`)
    log('수신 서버 저장 OK')
    statusEl.textContent = `DONE ${LABEL} ${CASE} ${blob.size}B`
    document.title = `DONE-${LABEL}`
    return
  }

  const p1 = await buildPage1(fabric)
  const p2 = await buildPage2(fabric)

  // 칼선(_addCutLinePage svg2pdf 경로) — 재단 사각 라운드 패스
  const wsW = mmToPx(SIZE.width + SIZE.cutSize * 2, DPI)
  const wsH = mmToPx(SIZE.height + SIZE.cutSize * 2, DPI)
  const cut = mmToPx(SIZE.cutSize, DPI)
  const cutLine = new fabric.Path(
    `M ${cut + 60} ${cut} L ${wsW - cut - 60} ${cut} Q ${wsW - cut} ${cut}, ${wsW - cut} ${cut + 60} ` +
      `L ${wsW - cut} ${wsH - cut - 60} Q ${wsW - cut} ${wsH - cut}, ${wsW - cut - 60} ${wsH - cut} ` +
      `L ${cut + 60} ${wsH - cut} Q ${cut} ${wsH - cut}, ${cut} ${wsH - cut - 60} ` +
      `L ${cut} ${cut + 60} Q ${cut} ${cut}, ${cut + 60} ${cut} Z`,
    { id: 'cutline', fill: '', stroke: '#ff00ff', strokeWidth: 2 }
  )

  // ServicePlugin — 실제 저장 경로(imagePlugin 은 embed 와 동일하게 null 주입)
  const service = new ServicePlugin(p1.canvas, p1.editor, null as any, {})
  p1.editor.use(service)

  log(`캡처 시작 label=${LABEL}`)
  const t0 = performance.now()
  const blob: Blob = await service.saveMultiPagePDFAsBlob(
    [p1.canvas, p2.canvas],
    [p1.editor, p2.editor],
    'golden',
    SIZE,
    cutLine,
    DPI
  )
  const ms = Math.round(performance.now() - t0)
  log(`PDF 생성 완료 ${blob.size} bytes (${ms}ms)`)

  const res = await fetch(`${RECEIVER}/save?label=${encodeURIComponent(LABEL)}&name=book`, {
    method: 'POST',
    body: blob,
  })
  if (!res.ok) throw new Error(`수신 서버 저장 실패 HTTP ${res.status}`)
  log('수신 서버 저장 OK')
  statusEl.textContent = `DONE ${LABEL} ${blob.size}B`
  document.title = `DONE-${LABEL}`
}

run().catch((e) => {
  console.error('[golden] FAIL', e)
  statusEl.textContent = 'FAIL: ' + (e?.message || e)
  document.title = 'FAIL'
})
