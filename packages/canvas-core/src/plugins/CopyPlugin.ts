import { v4 as uuid } from 'uuid'
import { getImgStr as imgStr } from '../utils/utils'
import { fabric } from 'fabric'
import CanvasHotkey from '../models/CanvasHotkey'
import { PluginBase, PluginOption } from '../plugin'

/**
 * Alt+드래그 복제(C5)의 이동 임계 — 화면 px. 이 거리 미만은 단순 alt+클릭/지터로
 * 간주해 복제하지 않는다(첫 object:moving 에서 판정). Ctrl+D 복제와 무관.
 */
const ALT_DRAG_CLONE_THRESHOLD_PX = 4

class CopyPlugin extends PluginBase {
  name = 'CopyPlugin'
  events: string[] = []
  hotkeys: CanvasHotkey[] = [
    {
      name: '복사',
      input: ['ctrl+c', 'cmd+c'],
      onlyForActiveObject: true,
      callback: () => this.copy()
    },
    {
      name: '붙여넣기',
      input: ['ctrl+v', 'cmd+v'],
      onlyForActiveObject: false,
      callback: () => this.paste()
    },
    {
      name: '복제',
      input: ['ctrl+d', 'cmd+d'],
      onlyForActiveObject: true,
      callback: () => this.clone()
    }
  ]
  private cache: null | fabric.ActiveSelection | fabric.Object
  // 바인딩된 이벤트 핸들러 저장을 위한 변수
  private boundPasteListener: (e: ClipboardEvent) => void
  private boundDuplicateListener: (e: KeyboardEvent) => void
  // 붙여넣기 작업 진행 중 플래그
  private isPasting: boolean = false
  // 핫키로 붙여넣기 실행 중 플래그
  private isHotkeyPasting: boolean = false

  // ── C5 (E2): Alt+드래그 복제 ─────────────────────────────────────────
  // 기본 on. createCanvas 가 VITE_ENABLE_ALT_DRAG_CLONE 를 주입(옵션 부재 시 on).
  private altDragCloneEnabled: boolean = true
  // mouse:down 에서 잡은 복제 후보(단일 비보호 객체) — 첫 이동에서 사본 삽입
  private altCandidate: {
    source: fabric.Object
    startLeft: number
    startTop: number
    downX: number
    downY: number
  } | null = null
  private altCloneStarted = false // 첫 이동에서 clone 파이프라인 진입(재진입 차단)
  private altCloneInserted = false // clone 이 실제 캔버스에 삽입됨(비동기 이미지 대비)
  private altHistoryOff = false // offHistory 개입 여부(onHistory 복원 판정)
  private altEndPending = false // 비동기 clone 대기 중 종료(mouse:up/selection:cleared) 도착
  private boundAltMouseDown: (opt: fabric.IEvent) => void = () => {}
  private boundAltObjectMoving: (opt: fabric.IEvent) => void = () => {}
  private boundAltEnd: (opt?: fabric.IEvent) => void = () => {}

  private getTargetCanvas(): fabric.Canvas {
    if (this._options?.getActiveCanvas) {
      const activeCanvas = this._options.getActiveCanvas()
      if (activeCanvas) return activeCanvas
    }
    return this._canvas
  }

  constructor(canvas: fabric.Canvas, editor: any, options: PluginOption) {
    super(canvas, editor, options)
    this.cache = null

    // 이벤트 핸들러를 인스턴스 메서드로 바인딩
    this.boundPasteListener = this.pasteListener.bind(this)
    this.boundDuplicateListener = this.duplicateListener.bind(this)

    // C5: Alt+드래그 복제 — 옵션 부재 시 on(기본 활성), 명시적 false 만 비활성
    this.altDragCloneEnabled = this._options?.altDragClone !== false
    this.boundAltMouseDown = this.altMouseDown.bind(this)
    this.boundAltObjectMoving = this.altObjectMoving.bind(this)
    this.boundAltEnd = this.altEnd.bind(this)

    this.initPaste()
    this.initAltDragClone()
  }

  /**
   * L1④ (2026-07-06): 관리자 보호 객체(위치고정/삭제잠금/내용잠금/고급잠금)는 고객
   * (비-editMode)이 복제할 수 없다 — 보호 플래그가 사본에 복사돼 삭제 불가한 유령
   * 사본이 쌓이는 것 방지. ObjectPlugin.del 의 삭제 가드와 동일 규약(_options.editMode).
   * 핫키(ctrl+d)·우클릭 컨텍스트 메뉴·SidePanel 버튼이 전부 clone() 을 거치므로 일괄 방어.
   *
   * public (E1 §5-3): ObjectActionBar 가 복제 버튼 노출 게이팅에 동일 판정을 재사용한다
   * — 규칙 이원화(드리프트) 방지. 판정 로직 불변.
   */
  isCloneProtected(obj: fabric.Object): boolean {
    if (this._options?.editMode) return false
    const o = obj as any
    return (
      o?.movable === false ||
      o?.deleteable === false ||
      o?.contentEditable === false ||
      // user 레벨 고급잠금은 본인이 건 '내 잠금' — 복제 허용(레이어 행 mine 판정과 정합).
      // designer+ 레벨만 템플릿 보호로 간주해 차단(적대 리뷰: 판정 불일치 해소).
      (o?.lockInfo?.isLocked === true && o?.lockInfo?.lockLevel !== 'user')
    )
  }

  clone(paramsActiveObject?: fabric.ActiveSelection | fabric.Object) {
    const activeObject = paramsActiveObject || this._canvas.getActiveObject()
    if (!activeObject) return
    if (activeObject?.type === 'activeSelection') {
      const sel = activeObject as fabric.ActiveSelection
      const objects = (sel.getObjects?.() ?? []) as fabric.Object[]
      if (objects.some((o) => this.isCloneProtected(o))) return
      this.copyActiveSelection(activeObject)
    } else {
      if (this.isCloneProtected(activeObject)) return
      this.copyObject(activeObject)
    }
  }

  copy() {
    this.cache = this._canvas.getActiveObject()
  }

  paste() {
    // 이미 붙여넣기 작업 중이면 중복 실행 방지
    if (this.isPasting) return

    // 핫키로 붙여넣기 실행 중 플래그 설정
    this.isHotkeyPasting = true

    if (this.cache) {
      // 붙여넣기 시작
      this.isPasting = true

      try {
        this.copyObject(this.cache)
      } finally {
        // 붙여넣기 상태 초기화
        setTimeout(() => {
          this.isPasting = false
          this.isHotkeyPasting = false
        }, 100)
      }
    } else {
      // 캐시된 객체가 없으면 1초 후 플래그 초기화
      setTimeout(() => {
        this.isHotkeyPasting = false
      }, 1000)
    }
  }

  dispose() {
    // 바인딩된 함수를 사용하여 이벤트 리스너 제거
    window.removeEventListener('paste', this.boundPasteListener)
    window.removeEventListener('keydown', this.boundDuplicateListener)

    // C5: Alt+드래그 복제 캔버스 리스너 해제(누수 방지) + 잔여 상태 마감
    if (this.altDragCloneEnabled) {
      this._canvas.off('mouse:down', this.boundAltMouseDown)
      this._canvas.off('object:moving', this.boundAltObjectMoving)
      this._canvas.off('mouse:up', this.boundAltEnd)
      this._canvas.off('selection:cleared', this.boundAltEnd)
      this.finalizeAltDrag()
    }
  }

  initPaste() {
    // 바인딩된 함수를 사용하여 이벤트 리스너 등록
    window.addEventListener('paste', this.boundPasteListener)
    window.addEventListener('keydown', this.boundDuplicateListener)
  }

  /**
   * C5 (E2): Alt+드래그 복제 트리거 등록. 데스크탑 전용(alt 키). 임베드 포함 전 경로에
   * canvas-core 레벨로 자동 적용된다. 플래그 off 면 리스너를 아예 걸지 않는다(무비용).
   *
   * 시맨틱(Canva/PowerPoint): 원본이 드래그되어 나가고 사본이 시작 위치에 남는다.
   * fabric transform 은 이미 원본을 추적 중이므로(mousedown), 사본을 시작 위치에 정적
   * 삽입만 하면 되어 clone 비동기 레이스를 회피한다.
   */
  initAltDragClone() {
    if (!this.altDragCloneEnabled) return
    this._canvas.on('mouse:down', this.boundAltMouseDown)
    this._canvas.on('object:moving', this.boundAltObjectMoving)
    this._canvas.on('mouse:up', this.boundAltEnd)
    // 핀치 시작(WorkspacePlugin 이 _currentTransform 중단 + discardActiveObject → selection:cleared)
    // 등 mouse:up 미도래 비정상 종료의 안전망 — 플래그·히스토리 누수 방지.
    this._canvas.on('selection:cleared', this.boundAltEnd)
  }

  duplicateListener(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
      e.preventDefault()
    }
  }

  async pasteListener(event: ClipboardEvent) {
    // 핫키로 붙여넣기가 진행 중이면 이벤트 처리하지 않음
    if (this.isHotkeyPasting) {
      return
    }

    // 이미 붙여넣기 작업 중이면 중복 실행 방지
    if (this.isPasting) {
      return
    }

    const canvas = this.getTargetCanvas()

    // 멀티페이지 중복 처리 방지 (cache 없고 비활성 캔버스이면 skip)
    if (this._options?.getActiveCanvas && this._canvas !== canvas && !this.cache) {
      return
    }

    // 포커스가 document.body가 아닌 경우 리턴
    if (document.activeElement !== document.body) {
      return
    }

    event.preventDefault()

    // 붙여넣기 작업 시작
    this.isPasting = true

    try {
      // 클립보드에 저장된 객체가 있을 경우 복제하고 리턴
      if (this.cache) {
        this.clone(this.cache)
        this.cache = null
        return
      }

      const items = (event.clipboardData || (event as any).originalEvent?.clipboardData)?.items
      if (!items) return

      const fileAccept = '.pdf,.psd,.cdr,.ai,.svg,.jpg,.jpeg,.png,.webp,.json'
      let hasProcessedItem = false // 항목 처리 여부 추적

      for (const item of items) {
        // 이미 항목을 처리한 경우 중복 처리 방지
        if (hasProcessedItem) break

        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (!file) continue

          const curFileSuffix: string | undefined = file.name.split('.').pop()?.toLowerCase()
          if (!curFileSuffix || !fileAccept.split(',').includes(`.${curFileSuffix}`)) continue

          hasProcessedItem = true // 항목 처리 표시

          if (curFileSuffix === 'svg') {
            try {
              const svgFile = await imgStr(file)
              if (!svgFile) throw new Error('file is undefined')

              fabric.loadSVGFromURL(svgFile as string, (objects, options) => {
                const item = fabric.util.groupSVGElements(objects, {
                  ...options,
                  name: 'defaultSVG',
                  id: uuid()
                })
                canvas.add(item).centerObject(item).renderAll()
              })
            } catch (error) {
              console.error('SVG 로드 중 오류:', error)
            }
          } else if (item.type.indexOf('image/') === 0) {
            try {
              const imageUrl = URL.createObjectURL(file)
              const imgEl = document.createElement('img')

              // 이미지 로드 완료 후 캔버스에 추가하는 Promise 생성
              await new Promise<void>((resolve, reject) => {
                imgEl.onload = () => {
                  try {
                    const imgInstance = new fabric.Image(imgEl, {
                      id: uuid(),
                      name: 'defaultImage',
                      left: 100,
                      top: 100
                    })

                    canvas.add(imgInstance as any)
                    canvas.setActiveObject(imgInstance as any)
                    canvas.renderAll()

                    // 리소스 정리
                    URL.revokeObjectURL(imageUrl)
                    resolve()
                  } catch (err) {
                    reject(err)
                  } finally {
                    // DOM에서 이미지 요소 제거
                    if (imgEl.parentNode) {
                      imgEl.parentNode.removeChild(imgEl)
                    }
                  }
                }

                imgEl.onerror = (err) => {
                  URL.revokeObjectURL(imageUrl)
                  reject(err)
                }

                imgEl.src = imageUrl
                // DOM에 임시로 추가
                document.body.appendChild(imgEl)
              })
            } catch (error) {
              console.error('이미지 로드 중 오류:', error)
            }
          }
        } else if (item.kind === 'string' && item.type.indexOf('text/plain') === 0) {
          // 이미 항목을 처리한 경우 중복 처리 방지
          if (hasProcessedItem) break

          hasProcessedItem = true // 항목 처리 표시

          await new Promise<void>((resolve) => {
            item.getAsString((text: string) => {
              try {
                const activeObject = canvas.getActiveObject() as fabric.Textbox

                if (
                  activeObject &&
                  (activeObject.type === 'textbox' || activeObject.type === 'i-text') &&
                  activeObject.text
                ) {
                  const cursorPosition = activeObject.selectionStart ?? 0
                  const textBeforeCursorPosition = activeObject.text.substring(0, cursorPosition)
                  const textAfterCursorPosition = activeObject.text.substring(cursorPosition)

                  activeObject.set(
                    'text',
                    textBeforeCursorPosition + text + textAfterCursorPosition
                  )

                  activeObject.selectionStart = cursorPosition + text.length
                  activeObject.selectionEnd = cursorPosition + text.length

                  activeObject.dirty = true
                  canvas.renderAll()
                } else {
                  const fabricText = new fabric.IText(text, {
                    left: 100,
                    top: 100,
                    fontSize: 80,
                    id: uuid(),
                    scaleX: 1,
                    scaleY: 1,
                    lockScalingX: true,
                    lockScalingY: true,
                    hasControls: false
                  })
                  canvas.add(fabricText)
                  canvas.setActiveObject(fabricText)
                }
                resolve()
              } catch (error) {
                console.error('텍스트 처리 중 오류:', error)
                resolve()
              }
            })
          })
        }
      }
    } finally {
      // 붙여넣기 작업 완료, 상태 초기화
      setTimeout(() => {
        this.isPasting = false
      }, 100)
    }
  }

  private copyActiveSelection(activeObject: fabric.Object) {
    const grid = 10
    const canvas = this.getTargetCanvas()

    // 복사 전 히스토리 비활성화
    canvas.offHistory()

    activeObject?.clone((cloned: fabric.Object) => {
      cloned.clone((clonedObj: fabric.ActiveSelection) => {
        canvas.discardActiveObject()
        if (clonedObj.left === undefined || clonedObj.top === undefined) return

        clonedObj.canvas = canvas
        clonedObj.set({
          left: clonedObj.left + grid,
          top: clonedObj.top + grid,
          evented: true,
          id: uuid()
        })

        clonedObj.forEachObject((obj: fabric.Object) => {
          obj.id = uuid()
          canvas.add(obj)
        })

        clonedObj.setCoords()
        canvas.setActiveObject(clonedObj)
        canvas.requestRenderAll()

        // 복사 완료 후 히스토리 활성화
        canvas.onHistory()
      })
    })
  }

  private copyObject(activeObject: fabric.Object) {
    const grid = 10
    const canvas = this.getTargetCanvas()

    // 복사 전 히스토리 비활성화
    canvas.offHistory()

    this.cloneObject(activeObject, (cloned) => {
      canvas.discardActiveObject()

      cloned.set({
        left: (cloned.left as number) + grid,
        top: (cloned.top as number) + grid,
        evented: true,
        id: uuid()
      })

      canvas.add(cloned)
      canvas.setActiveObject(cloned)
      canvas.requestRenderAll()

      // 복사 완료 후 히스토리 활성화
      canvas.onHistory()
    })
  }

  /**
   * 원본을 fabric `clone(cb)` 파이프라인으로 복제해 콜백에 전달하는 공유 프리미티브.
   * 붙여넣기/복제(copyObject)와 Alt+드래그 복제(C5)가 이 경로를 공유한다 — `clone(cb)` 은
   * 붙여넣기 프로덕션 경로와 동일한 커스텀 속성 상속 규약을 그대로 따르므로 신규 직렬화
   * 경로가 생기지 않는다(canvasData 왕복·PDF 계약 무접촉). left/top 미정의 클론은 무시.
   */
  private cloneObject(source: fabric.Object, onCloned: (cloned: fabric.Object) => void): void {
    source?.clone((cloned: fabric.Object) => {
      if (cloned.left === undefined || cloned.top === undefined) return
      onCloned(cloned)
    })
  }

  // ── C5 (E2): Alt+드래그 복제 핸들러 ─────────────────────────────────
  /** mouse/pointer 이벤트에서 화면 좌표+altKey 안전 추출(터치 폴백 — alt 는 데스크탑뿐). */
  private altPoint(e: unknown): { x: number; y: number; altKey: boolean; hasPoint: boolean } {
    type TouchPointList = { [i: number]: { clientX: number; clientY: number } }
    const ev = e as
      | { clientX?: number; clientY?: number; altKey?: boolean; touches?: TouchPointList; changedTouches?: TouchPointList }
      | undefined
    if (!ev) return { x: 0, y: 0, altKey: false, hasPoint: false }
    if (typeof ev.clientX === 'number') {
      return { x: ev.clientX, y: ev.clientY ?? 0, altKey: !!ev.altKey, hasPoint: true }
    }
    const t = ev.touches?.[0] ?? ev.changedTouches?.[0]
    if (t) return { x: t.clientX, y: t.clientY, altKey: !!ev.altKey, hasPoint: true }
    return { x: 0, y: 0, altKey: false, hasPoint: false }
  }

  /**
   * mouse:down — alt + 단일 비보호 객체 위에서 시작하면 복제 후보로 표시(아직 clone 안 함).
   * 시작 위치·인덱스 스냅샷만 잡아 두고, 실제 사본 삽입은 첫 이동에서 수행한다.
   * - 빈 곳(target 없음): DraggingPlugin 의 alt-팬에 양보(후보 미설정).
   * - 다중 선택(ActiveSelection): v1 복제 비대상 → 일반 이동 폴백(후보 미설정).
   * - 보호객체: Ctrl+D 와 동일한 isCloneProtected 판정 재사용(규칙 이원화 금지).
   */
  private altMouseDown(opt: fabric.IEvent) {
    // 직전 상호작용의 잔여 상태 정리(안전망 미도달 대비 — 히스토리 불변식 유지)
    if (this.altCandidate || this.altHistoryOff) this.finalizeAltDrag()

    const { altKey, x, y } = this.altPoint(opt.e)
    if (!altKey) return
    const target = opt.target as fabric.Object | undefined
    if (!target) return
    const active = this._canvas.getActiveObject() as fabric.Object | undefined
    if (active && (active as { type?: string }).type === 'activeSelection') return
    if (this.isCloneProtected(target)) return

    this.altCandidate = {
      source: target,
      startLeft: target.left ?? 0,
      startTop: target.top ?? 0,
      downX: x,
      downY: y
    }
  }

  /**
   * 첫 object:moving(이동 임계 통과) — offHistory 후 사본을 원본 시작 위치·원본 직하
   * (insertAt 스냅샷 인덱스)에 삽입한다. 원본은 fabric transform 으로 계속 드래그된다.
   * 히스토리는 mouse:up 의 onHistory 까지 억제되어 "사본 삽입 + 원본 이동" = 1 엔트리.
   */
  private altObjectMoving(opt: fabric.IEvent) {
    const cand = this.altCandidate
    if (!cand || this.altCloneStarted) return
    // 다른 객체의 이동 이벤트는 무시(후보 원본만)
    if (opt.target && opt.target !== cand.source) return
    // 이동 임계(화면 px) — 좌표를 못 얻으면 통과로 간주(프로그램적 이동 대비)
    const { x, y, hasPoint } = this.altPoint(opt.e)
    if (hasPoint) {
      const dist = Math.hypot(x - cand.downX, y - cand.downY)
      if (dist < ALT_DRAG_CLONE_THRESHOLD_PX) return
    }

    this.altCloneStarted = true
    const canvas = this._canvas
    canvas.offHistory()
    this.altHistoryOff = true

    this.cloneObject(cand.source, (cloned) => {
      cloned.set({
        left: cand.startLeft,
        top: cand.startTop,
        evented: true,
        id: uuid()
      })
      const objs = canvas.getObjects()
      const idx = objs.indexOf(cand.source)
      // 원본 직하(스냅샷 인덱스)에 삽입 — 원본은 위로 밀리고 사본이 자리에 남는다.
      canvas.insertAt(cloned, idx >= 0 ? idx : objs.length, false)
      canvas.requestRenderAll()
      this.altCloneInserted = true
      // 초고속(이미지 비동기) 드래그: 콜백 도착 전 종료가 왔으면 지금 마감(1엔트리)
      if (this.altEndPending) this.finalizeAltDrag()
    })
  }

  /**
   * mouse:up / selection:cleared — 복제 후보 마감. 비동기 clone 이 아직 안 끝났으면
   * 종료 신호만 남기고 콜백이 마감하게 한다(엔트리 분리 방지).
   */
  private altEnd(_opt?: fabric.IEvent) {
    if (!this.altCandidate) return
    if (this.altCloneStarted && !this.altCloneInserted) {
      this.altEndPending = true
      return
    }
    this.finalizeAltDrag()
  }

  /** offHistory 를 복원(1엔트리 확정)하고 모든 Alt+드래그 상태를 초기화한다. */
  private finalizeAltDrag() {
    if (this.altHistoryOff) {
      this._canvas.onHistory()
      this.altHistoryOff = false
    }
    this.altCandidate = null
    this.altCloneStarted = false
    this.altCloneInserted = false
    this.altEndPending = false
  }
}

export default CopyPlugin
