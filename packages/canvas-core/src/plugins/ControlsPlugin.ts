import { ControlsPluginOption, PluginBase } from '../plugin'
import { fabric } from 'fabric'
import Editor from '../Editor'

// ============================================================
// 커스텀 컨트롤 핸들 렌더러
// ------------------------------------------------------------
// - 코너(tl/tr/bl/br): 원형 — 자유 리사이즈
// - 변 중간(ml/mr): 세로 캡슐 — 가로 스케일 방향 암시
// - 변 중간(mt/mb): 가로 캡슐 — 세로 스케일 방향 암시
// - 회전(mtr): 객체 아래 원형 + 회전 아이콘 — 모양으로 즉시 식별
// 기존 brand 색상(light: 파랑 / dark: 그린)은 prototype 의
// cornerColor / cornerStrokeColor 를 그대로 읽어 적용한다.
// ============================================================

const CORNER_DIAMETER = 12       // 코너 원형 지름
const PILL_SHORT = 7             // 캡슐 짧은 변
const PILL_LONG = 22             // 캡슐 긴 변
const HANDLE_STROKE = 1.5        // 핸들 외곽선 두께
const ROTATE_HANDLE_R = 11       // 회전 핸들 반경
const ROTATE_HANDLE_OFFSET = 36  // 객체 하단 ~ 회전 핸들 거리(px)

let customControlsApplied = false

function isCoarsePointerEnv(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  try { return window.matchMedia('(pointer: coarse)').matches } catch { return false }
}

function getCornerColor(obj: fabric.Object): string {
  return ((obj as any).cornerColor as string) || '#FFFFFF'
}
function getStrokeColor(obj: fabric.Object): string {
  return ((obj as any).cornerStrokeColor as string) || (obj as any).borderColor || '#1f2937'
}

function renderCircleHandle(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  _styleOverride: any,
  fabricObject: fabric.Object
) {
  const base = (fabricObject.cornerSize as number) || CORNER_DIAMETER
  // cornerSize 는 직사각형 변 기준이라 원형은 이를 그대로 지름으로 사용
  const r = base / 2
  ctx.save()
  ctx.translate(left, top)
  ctx.rotate(fabric.util.degreesToRadians(fabricObject.angle || 0))
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.closePath()
  ctx.fillStyle = getCornerColor(fabricObject)
  ctx.fill()
  ctx.lineWidth = HANDLE_STROKE
  ctx.strokeStyle = getStrokeColor(fabricObject)
  ctx.stroke()
  ctx.restore()
}

function makePillRenderer(orientation: 'horizontal' | 'vertical') {
  return function pillHandle(
    ctx: CanvasRenderingContext2D,
    left: number,
    top: number,
    _styleOverride: any,
    fabricObject: fabric.Object
  ) {
    // 터치 환경에서 cornerSize 가 16+ 로 커지면 캡슐도 비례 확대
    const scale = ((fabricObject.cornerSize as number) || CORNER_DIAMETER) / CORNER_DIAMETER
    const w = orientation === 'horizontal' ? PILL_LONG * scale : PILL_SHORT * scale
    const h = orientation === 'horizontal' ? PILL_SHORT * scale : PILL_LONG * scale
    const r = Math.min(w, h) / 2
    const x = -w / 2
    const y = -h / 2
    ctx.save()
    ctx.translate(left, top)
    ctx.rotate(fabric.util.degreesToRadians(fabricObject.angle || 0))
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.arcTo(x + w, y, x + w, y + r, r)
    ctx.lineTo(x + w, y + h - r)
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
    ctx.lineTo(x + r, y + h)
    ctx.arcTo(x, y + h, x, y + h - r, r)
    ctx.lineTo(x, y + r)
    ctx.arcTo(x, y, x + r, y, r)
    ctx.closePath()
    ctx.fillStyle = getCornerColor(fabricObject)
    ctx.fill()
    ctx.lineWidth = HANDLE_STROKE
    ctx.strokeStyle = getStrokeColor(fabricObject)
    ctx.stroke()
    ctx.restore()
  }
}

function renderRotationHandle(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  _styleOverride: any,
  fabricObject: fabric.Object
) {
  const baseR = ROTATE_HANDLE_R
  const scale = ((fabricObject.cornerSize as number) || CORNER_DIAMETER) / CORNER_DIAMETER
  const r = baseR * scale
  const stroke = getStrokeColor(fabricObject)
  ctx.save()
  ctx.translate(left, top)
  // 회전 아이콘은 객체 angle 따라가지 않고 화면 기준으로 그려야 직관적.
  // (회전된 객체에서도 회전 화살표가 항상 위 방향으로 보이도록)
  // 외곽 흰 원
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.closePath()
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()
  ctx.lineWidth = HANDLE_STROKE
  ctx.strokeStyle = stroke
  ctx.stroke()

  // 회전 화살표 (열린 호 + 작은 화살촉)
  const inner = r * 0.5
  ctx.lineWidth = 1.6
  ctx.strokeStyle = stroke
  ctx.beginPath()
  ctx.arc(0, 0, inner, Math.PI * 0.15, Math.PI * 1.5, false)
  ctx.stroke()
  // 화살촉
  const ax = inner * Math.cos(Math.PI * 0.15)
  const ay = inner * Math.sin(Math.PI * 0.15)
  ctx.beginPath()
  ctx.moveTo(ax, ay)
  ctx.lineTo(ax + 4, ay - 1)
  ctx.lineTo(ax + 1, ay + 4)
  ctx.closePath()
  ctx.fillStyle = stroke
  ctx.fill()
  ctx.restore()
}

/**
 * fabric.Object.prototype.controls 에 커스텀 핸들 렌더러를 적용한다.
 * 한 번만 실행되도록 idempotent — 여러 캔버스/플러그인에서 호출해도 안전.
 */
function applyCustomControls() {
  if (customControlsApplied) return
  const ctrls = (fabric.Object.prototype.controls as any) as Record<string, fabric.Control>

  // 코너 4개 — 원형
  ;(['tl', 'tr', 'bl', 'br'] as const).forEach((k) => {
    const c = ctrls[k]
    if (c) c.render = renderCircleHandle as any
  })

  // 좌우 변 — 세로 캡슐
  ;(['ml', 'mr'] as const).forEach((k) => {
    const c = ctrls[k]
    if (c) c.render = makePillRenderer('vertical') as any
  })

  // 상하 변 — 가로 캡슐
  ;(['mt', 'mb'] as const).forEach((k) => {
    const c = ctrls[k]
    if (c) c.render = makePillRenderer('horizontal') as any
  })

  // 회전 핸들 — 객체 아래로 위치 이동 + 별도 렌더러
  // 기본값: y=-0.5, offsetY=-40 (위쪽). 아래쪽으로 옮겨 텍스트/이미지 위 가려짐 방지.
  const mtr = ctrls.mtr
  if (mtr) {
    ;(mtr as any).x = 0
    ;(mtr as any).y = 0.5
    ;(mtr as any).offsetY = ROTATE_HANDLE_OFFSET
    ;(mtr as any).withConnection = true
    mtr.render = renderRotationHandle as any
  }

  customControlsApplied = true
}

class ControlsPlugin extends PluginBase {
  name = 'ControlsPlugin'
  hotkeys = []
  events: string[] = []

  // public hotkeys: string[] = ['space'];
  constructor(canvas: fabric.Canvas, editor: Editor, option: ControlsPluginOption) {
    super(canvas, editor, {})

    /// basic control
    fabric.Object.NUM_FRACTION_DIGITS = 4
    // 데스크톱은 약간 더 두꺼운 보더로 선택 객체 가독성↑.
    // 터치 환경(pointer:coarse) 은 factory.ts 에서 borderScaleFactor=2 로 별도 적용.
    const isCoarse = isCoarsePointerEnv()
    fabric.Object.prototype.set({
      transparentCorners: false,
      cornerColor: '#FFF',
      borderScaleFactor: isCoarse ? 2 : 1.5,
      cornerStyle: 'rect', // render 함수가 모양을 그리므로 무시되지만 기본값 유지
      cornerSize: isCoarse ? 16 : CORNER_DIAMETER,
      borderOpacityWhenMoving: 0.8,
      ...option
    })

    // 커스텀 핸들 모양 적용 (한 번만)
    applyCustomControls()

    // W4 §6-1: 방향키 이동은 ObjectPlugin.hotkeys 로 일원화(잠금 가드·Shift 10px). 여기서
    // 중복 등록하던 window keydown 핸들러(잠금 미가드)는 제거 — 합산 2px·Shift 잠금우회 결함 해소.

    // 텍스트 객체 유니폼 스케일 강제 및 폰트 크기 동기화
    // 기존 객체에도 적용
    this._canvas.getObjects().forEach((obj) => {
      if (obj.type === 'i-text') {
        obj.set({ 
          lockUniScaling: true
        })
      }
    })

    // 새로 추가되는 객체에 대해서도 적용
    this._canvas.on('object:added', (evt) => {
      const target = evt.target as fabric.Object | undefined
      if (target && target.type === 'i-text') {
        target.set({ 
          lockUniScaling: true
        })
        this._canvas.requestRenderAll()
      }
    })

    // // 스케일링 시 폰트 크기 동기화: 코너 리사이즈로 텍스트 크기를 변경
    // this._canvas.on('object:scaling', (evt) => {
    //   const target = evt.target as (fabric.Object & { fontSize?: number; _scalingGuard?: boolean; __corner?: string }) | undefined
    //   if (!target || target.type !== 'i-text') return

    //   if ((target as any)._scalingGuard) return
    //   ;(target as any)._scalingGuard = true
    //   try {
    //     const sx = (target.scaleX ?? 1)
    //     const sy = (target.scaleY ?? 1)
    //     const scale = Math.max(sx, sy)
    //     if (!isFinite(scale) || scale === 1) return

    //     const currentFontSize = (target as any).fontSize ?? 16
    //     const newFontSize = Math.max(1, Math.round(currentFontSize * scale))

    //     // 드래그 중인 코너의 반대편을 기준점으로 사용
    //     const corner = target.__corner
    //     let originX: string = 'center'
    //     let originY: string = 'center'
        
    //     if (corner) {
    //       // 코너 핸들: 반대편 코너를 기준점으로
    //       if (corner === 'tl') { originX = 'right'; originY = 'bottom' }
    //       else if (corner === 'tr') { originX = 'left'; originY = 'bottom' }
    //       else if (corner === 'bl') { originX = 'right'; originY = 'top' }
    //       else if (corner === 'br') { originX = 'left'; originY = 'top' }
    //     }
        
    //     // 크기 변경 전 기준점의 좌표 저장
    //     const originPoint = target.getPointByOrigin(originX, originY)

    //     target.set({
    //       // 유니폼 스케일은 lockUniScaling으로 보장, 폰트 사이즈로 반영하고 스케일을 리셋
    //       scaleX: 1,
    //       scaleY: 1
    //     })
    //     ;(target as any).fontSize = newFontSize

    //     // 폰트 크기 변경 후 동일한 기준점의 좌표 유지 (반대편 코너 고정)
    //     target.setPositionByOrigin(originPoint, originX, originY)
    //     target.setCoords()
    //     this._canvas.requestRenderAll()
    //   } finally {
    //     ;(target as any)._scalingGuard = false
    //   }
    // })

    // 측면 핸들은 Shift 키 조합에 따라 scale/skew 동작하도록 기본 설정 유지
    // (텍스트 객체는 측면 핸들이 숨겨져 있으므로 영향 없음)
    // Shift를 누르지 않으면 scale, Shift를 누르면 skew
    ;(['ml', 'mr'] as const).forEach((key) => {
      const ctrl = (fabric.Object.prototype.controls as any)[key] as fabric.Control | undefined
      if (ctrl) {
        // Fabric.js 기본 동작: scalingXOrSkewingY
        ctrl.actionHandler = fabric.controlsUtils.scalingXOrSkewingY
        ctrl.actionName = fabric.controlsUtils.scaleOrSkewActionName
      }
    })
    ;(['mt', 'mb'] as const).forEach((key) => {
      const ctrl = (fabric.Object.prototype.controls as any)[key] as fabric.Control | undefined
      if (ctrl) {
        // Fabric.js 기본 동작: scalingYOrSkewingX
        ctrl.actionHandler = fabric.controlsUtils.scalingYOrSkewingX
        ctrl.actionName = fabric.controlsUtils.scaleOrSkewActionName
      }
    })

    //this.cornerRotationControl()
  }

}

export default ControlsPlugin
