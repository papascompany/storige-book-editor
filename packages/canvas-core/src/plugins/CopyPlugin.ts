import { v4 as uuid } from 'uuid'
import { getImgStr as imgStr } from '../utils/utils'
import { fabric } from 'fabric'
import CanvasHotkey from '../models/CanvasHotkey'
import { PluginBase, PluginOption } from '../plugin'

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

    this.initPaste()
  }

  /**
   * L1④ (2026-07-06): 관리자 보호 객체(위치고정/삭제잠금/내용잠금/고급잠금)는 고객
   * (비-editMode)이 복제할 수 없다 — 보호 플래그가 사본에 복사돼 삭제 불가한 유령
   * 사본이 쌓이는 것 방지. ObjectPlugin.del 의 삭제 가드와 동일 규약(_options.editMode).
   * 핫키(ctrl+d)·우클릭 컨텍스트 메뉴·SidePanel 버튼이 전부 clone() 을 거치므로 일괄 방어.
   */
  private isCloneProtected(obj: fabric.Object): boolean {
    if (this._options?.editMode) return false
    const o = obj as any
    return (
      o?.movable === false ||
      o?.deleteable === false ||
      o?.contentEditable === false ||
      o?.lockInfo?.isLocked === true
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
  }

  initPaste() {
    // 바인딩된 함수를 사용하여 이벤트 리스너 등록
    window.addEventListener('paste', this.boundPasteListener)
    window.addEventListener('keydown', this.boundDuplicateListener)
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

    activeObject?.clone((cloned: fabric.Object) => {
      if (cloned.left === undefined || cloned.top === undefined) return

      canvas.discardActiveObject()

      cloned.set({
        left: cloned.left + grid,
        top: cloned.top + grid,
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
}

export default CopyPlugin
