import type { fabric } from 'fabric'

/**
 * L4-① (2026-07-11): printExclude 캔버스 상시 시각 표식 — CS 리스크 해소(CTO 결정: 표시형).
 *
 * printExclude=true 객체는 화면에는 보이지만 인쇄물(PDF)에는 없다 — 고객 클레임 벡터.
 * SidePanel 배지(L2)만으로는 캔버스에서 안 보이므로, 캔버스 위에 **화면 전용 오버레이**로
 * 연한 점선 테두리 + 우상단 '인쇄 제외' 라벨을 상시 표시한다(고객·디자이너 공통).
 *
 * 오염 없음 보장(핵심 불변):
 * - fabric 객체를 추가하지 않는다 — `after:render` 훅에서 contextTop(upper canvas)에
 *   순수 2D 드로잉만 수행. 따라서 toJSON(저장)·PDF(ServicePlugin toSVG)·썸네일
 *   (toDataURL = lowerCanvasEl 캡처)에 절대 포함되지 않는다.
 * - 신규 직렬화 속성 없음(§8 불변) — 바인딩 마커는 캔버스 인스턴스의 비직렬화 필드.
 *
 * 좌표 정합: getBoundingRect(true, true)(절대좌표, 캐시 미사용) → viewportTransform 을
 * 수동 적용해 화면(screen) 좌표로 변환 — 스크롤/줌/팬에서 테두리가 객체를 정확히 따라간다.
 * (이 편집기의 vpt 는 zoom+pan 만 사용 — 회전/스큐 없음.)
 *
 * 잔상 처리: contextTop 은 fabric 이 매 렌더마다 지워주지 않으므로, 직전 프레임에 그린
 * 영역을 기억해 두었다가 다음 draw 시작 시 해당 영역만 clearRect 한다(전체 clear 는
 * fabric 의 선택 러버밴드 등 top 레이어 드로잉을 지울 수 있어 회피).
 */

const LABEL_TEXT = '인쇄 제외'
const STROKE_COLOR = '#f59e0b' // amber-500 — SidePanel 인쇄 제외 배지와 동일 계열
const LABEL_BG = '#f59e0b'
const LABEL_FG = '#ffffff'
const LABEL_FONT = '10px sans-serif'
const LABEL_PAD_X = 4
const LABEL_H = 14
const DASH: number[] = [4, 3]
/** clearRect 여유(px) — 점선/라벨 안티앨리어싱 픽셀까지 확실히 지우기 위한 패딩 */
const CLEAR_PAD = 3

interface DrawnRect {
  x: number
  y: number
  w: number
  h: number
}

type OverlayCanvas = fabric.Canvas & {
  __printExcludeOverlayBound?: boolean
  __printExcludeOverlayRects?: DrawnRect[]
  contextTop?: CanvasRenderingContext2D
}

/** 화면 좌표계 bounding rect (viewportTransform 적용) */
function toScreenRect(
  obj: fabric.Object,
  vpt: number[],
): DrawnRect {
  const r = obj.getBoundingRect(true, true)
  return {
    x: r.left * vpt[0] + vpt[4],
    y: r.top * vpt[3] + vpt[5],
    w: r.width * vpt[0],
    h: r.height * vpt[3],
  }
}

/**
 * printExclude 객체들의 오버레이를 contextTop 에 1회 드로잉.
 * (내보내기용 — 테스트에서 직접 호출해 무오염 단언에 사용)
 */
export function drawPrintExcludeOverlay(canvas: OverlayCanvas): void {
  const ctx = canvas.contextTop
  if (!ctx) return

  // 1) 직전 프레임 드로잉 잔상 제거 (해당 영역만)
  const prev = canvas.__printExcludeOverlayRects
  if (prev && prev.length > 0) {
    for (const r of prev) {
      ctx.clearRect(r.x - CLEAR_PAD, r.y - CLEAR_PAD, r.w + CLEAR_PAD * 2, r.h + CLEAR_PAD * 2)
    }
  }
  canvas.__printExcludeOverlayRects = []

  const vpt = canvas.viewportTransform
  if (!vpt) return

  const targets = (canvas.getObjects() as fabric.Object[]).filter(
    (obj) =>
      (obj as { printExclude?: boolean }).printExclude === true && obj.visible !== false,
  )
  if (targets.length === 0) return

  const drawn: DrawnRect[] = []
  ctx.save()
  try {
    for (const obj of targets) {
      const rect = toScreenRect(obj, vpt)

      // 점선 테두리 (불투명 — 반복 드로잉 시 알파 누적 없음)
      ctx.setLineDash(DASH)
      ctx.lineWidth = 1
      ctx.strokeStyle = STROKE_COLOR
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)

      // 우상단 라벨 배지
      ctx.setLineDash([])
      ctx.font = LABEL_FONT
      const textW = ctx.measureText(LABEL_TEXT).width
      const labelW = textW + LABEL_PAD_X * 2
      const labelX = rect.x + rect.w - labelW
      const labelY = rect.y - LABEL_H - 1
      ctx.fillStyle = LABEL_BG
      ctx.fillRect(labelX, labelY, labelW, LABEL_H)
      ctx.fillStyle = LABEL_FG
      ctx.textBaseline = 'middle'
      ctx.fillText(LABEL_TEXT, labelX + LABEL_PAD_X, labelY + LABEL_H / 2)

      // 다음 프레임 clear 용 — 테두리+라벨 전체를 덮는 union 영역 기록
      const x0 = Math.min(rect.x, labelX)
      const y0 = labelY
      drawn.push({
        x: x0,
        y: y0,
        w: rect.x + rect.w - x0,
        h: rect.y + rect.h - y0,
      })
    }
  } finally {
    ctx.restore()
  }
  canvas.__printExcludeOverlayRects = drawn
}

/**
 * 캔버스에 printExclude 오버레이 렌더 훅을 바인딩(멱등).
 * createCanvas(editor 레벨)·addPage(스프레드 내지) 양쪽 캔버스 생성 경로에서 호출한다.
 * canvas-core 공개 API 는 건드리지 않는다 — after:render 바인딩도 editor 레벨(§8 불변).
 */
export function bindPrintExcludeOverlay(canvas: fabric.Canvas): void {
  const c = canvas as OverlayCanvas
  if (c.__printExcludeOverlayBound) return
  c.__printExcludeOverlayBound = true
  c.on('after:render', () => {
    try {
      drawPrintExcludeOverlay(c)
    } catch {
      // 오버레이는 표시 보조 — 드로잉 실패가 편집/렌더를 깨서는 안 된다.
    }
  })
}
