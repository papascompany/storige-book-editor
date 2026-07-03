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

async function run() {
  const fabric = await getFabric()

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
