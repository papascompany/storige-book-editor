import Editor from '../Editor'
import '../utils/history'
import CanvasHotkey from '../models/CanvasHotkey'
import { fabric } from 'fabric'
import { PluginBase } from '../plugin'

class HistoryPlugin extends PluginBase {
  name = 'HistoryPlugin'
  events = ['historyUpdate']
  hotkeys: CanvasHotkey[] = [
    {
      name: '실행 취소',
      input: ['ctrl+z', '⌘+z'],
      onlyForActiveObject: false,
      callback: () => this.undo(),
      hideContext: true
    },
    {
      name: '다시 실행',
      input: ['ctrl+shift+z', '⌘+shift+z'],
      onlyForActiveObject: false,
      callback: () => this.redo(),
      hideContext: true
    }
  ]

  // 이벤트 핸들러 참조 저장 (cleanup용)
  private _historyAppendHandler: (() => void) | null = null
  private _beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null

  constructor(canvas: fabric.Canvas, editor: Editor) {
    super(canvas, editor, {})

    this.init()
  }

  // 리소스 정리 메서드
  destroyed(): Promise<void> {
    // 캔버스 이벤트 리스너 제거
    if (this._historyAppendHandler) {
      this._canvas.off('history:append', this._historyAppendHandler)
      this._historyAppendHandler = null
    }

    // window 이벤트 리스너 제거
    if (this._beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this._beforeUnloadHandler)
      this._beforeUnloadHandler = null
    }

    return Promise.resolve()
  }

  historyUpdate() {
    const { historyUndo, historyRedo } = this._canvas
    this._editor.emit('historyUpdate', historyUndo.length, historyRedo.length)
  }

  /**
   * 캔버스가 화면에 표시 중인지 확인 (DraggingPlugin.isCanvasVisible 과 동일 가드)
   * 멀티페이지 환경에서 hotkeys 가 전역 등록되어 ctrl+z 한 번에 모든 페이지의
   * undo/redo 가 동시에 실행되는 문제 차단 — 보이는 캔버스만 동작.
   */
  private isCanvasVisible(): boolean {
    if (!this._canvas) return false
    const el = this._canvas.wrapperEl || this._canvas.getElement()?.parentElement
    if (!el) return false
    return el.offsetParent !== null && getComputedStyle(el).display !== 'none'
  }

  undo() {
    // 숨겨진(비활성 페이지) 캔버스에서는 undo 금지 — 전 페이지 동시 undo 차단
    if (!this.isCanvasVisible()) return
    console.log('undo')
    this._canvas.undo(async () => {
      // undo 완료 후 추가 처리
      // 히스토리 억제: 복원 후 후처리 중 발생하는 변화가 히스토리를 오염시키지 않도록
      this._canvas.offHistory()
      this.realignOverlays()
      this.ensureGuideElements()
      await this.rebindMoldFeatures()
      // 히스토리 스택을 건드리지 않고 현재 스냅샷 기준으로 동기화
      ;(this._canvas as any).historyProcessing = false
      ;(this._canvas as any).historyNextState = (this._canvas as any)._historyNext()
      this.historyUpdate()
    })
  }

  redo() {
    // 숨겨진(비활성 페이지) 캔버스에서는 redo 금지 — 전 페이지 동시 redo 차단
    if (!this.isCanvasVisible()) return
    this._canvas.redo(async () => {
      // redo 완료 후 추가 처리
      this._canvas.offHistory()
      this.realignOverlays()
      this.ensureGuideElements()
      await this.rebindMoldFeatures()
      ;(this._canvas as any).historyProcessing = false
      ;(this._canvas as any).historyNextState = (this._canvas as any)._historyNext()
      this.historyUpdate()
    })
  }

  afterLoad(...args): Promise<void> {
    this._canvas.clearHistory()
    this.historyUpdate()
    return super.afterLoad(...args)
  }

  // 오버레이 객체의 위치를 원본 객체에 맞게 조정하는 메서드
  private realignOverlays() {
    // 모든 객체 가져오기
    const allObjects = this._canvas.getObjects()

    // 오버레이 객체 찾기
    const overlays = allObjects.filter((obj) => obj.extensionType === 'overlay')

    // 각 오버레이에 대해
    for (const overlay of overlays) {
      if (!overlay.id) continue

      // 원본 ID 추출 (예: "obj123_gold" → "obj123")
      const originalId = overlay.id.split('_')[0]

      // 원본 객체 찾기
      const originalObj = allObjects.find((obj) => obj.id === originalId)
      if (!originalObj) continue

      // 오버레이 위치 및 속성 업데이트
      overlay.set({
        left: originalObj.left,
        top: originalObj.top,
        angle: originalObj.angle,
        flipX: originalObj.flipX,
        flipY: originalObj.flipY,
        skewX: originalObj.skewX,
        skewY: originalObj.skewY,
        width: originalObj.width * originalObj.scaleX,
        height: originalObj.height * originalObj.scaleY,
        scaleX: 1,
        scaleY: 1,
        visible: true
      })

      // 클립패스 업데이트 (비동기 작업을 즉시 처리하기 위해)
      this.updateClipPathAsync(overlay, originalObj)
    }

    // 캔버스 다시 렌더링
    this._canvas.requestRenderAll()
  }

  // 클립패스 비동기 업데이트 처리
  private updateClipPathAsync(overlay: fabric.Object, originalObj: fabric.Object) {
    const filterPlugin = this._editor.getPlugin('FilterPlugin')
    if (!filterPlugin || !filterPlugin.createLowResClipPath) return // 클립패스 업데이트 비동기 처리
    ;(async () => {
      try {
        const clippath = await filterPlugin.createLowResClipPath(originalObj)
        overlay.set({ clipPath: clippath })
        this._canvas.requestRenderAll()
      } catch (err) {
        console.error('클립패스 업데이트 오류:', err)
      }
    })()
  }
  
  // 가이드 요소가 존재하는지 확인하고 없으면 재생성
  private ensureGuideElements() {
    const workspacePlugin = this._editor.getPlugin('WorkspacePlugin')
    if (!workspacePlugin) {
      console.warn('WorkspacePlugin not found in HistoryPlugin.ensureGuideElements')
      return
    }
    
    // cut-border와 safe-zone-border가 있는지 확인
    const objects = this._canvas.getObjects()
    const hasCutBorder = objects.some(obj => obj.id === 'cut-border')
    const hasSafeBorder = objects.some(obj => obj.id === 'safe-zone-border')
    
    console.log('Guide elements check:', { hasCutBorder, hasSafeBorder })
    
    // 없는 경계선들을 재생성
    if (!hasCutBorder || !hasSafeBorder) {
      console.log('Recreating missing guide elements')
      workspacePlugin.restoreGuideElements()
    }
  }

  // Undo/Redo 이후 모양틀(Outline / +아이콘) 바인딩 복원
  private async rebindMoldFeatures() {
    const imagePlugin = this._editor.getPlugin('ImageProcessingPlugin') as any
    if (!imagePlugin || !imagePlugin.bindWithMold || !imagePlugin.bindWithOutline) {
      console.warn('ImageProcessingPlugin not found or missing bind methods')
      return
    }

    const objects = this._canvas.getObjects()

    // hasMolding 대상에 대해 +아이콘/outline 재결합
    const moldingTargets = objects.filter((o: any) => o.hasMolding)
    for (const item of moldingTargets) {
      const path = objects.find((obj: any) => obj.id === `${item.id}_outline`)
      if (path) {
        // +아이콘은 히스토리 복원 대신 동적 재생성
        const icon = await this._recreateMoldIconFor(item)
        if (icon) {
          imagePlugin.bindWithMold(item, path, icon)
        }
      }
    }

    // hasCutting 대상에 대해 outline 재결합
    const cuttingTargets = objects.filter((o: any) => o.hasCutting)
    for (const item of cuttingTargets) {
      const path =
        objects.find((obj: any) => obj.id === `${item.id}_outline`) ||
        objects.find((obj: any) => obj.extensionType === 'outline' && obj.id === `${item.id}_outline`)
      if (path) {
        imagePlugin.bindWithOutline(item, path)
      }
    }

    // 모양틀 클릭 이벤트 재바인딩: 필요 객체만 (중복 방지)
    const moldShapes = objects.filter((obj: any) => obj.hasMolding)
    for (const shape of moldShapes) {
      if (!(shape as any)._moldClickBound && imagePlugin.bindMoldClickEvent) {
        imagePlugin.bindMoldClickEvent(shape)
      }
    }
  }

  // 모양틀 +아이콘을 재생성
  private _recreateMoldIconFor(shape: fabric.Object): Promise<fabric.Object | null> {
    return new Promise((resolve) => {
      try {
        const iconSize = Math.min(shape.width || 24, shape.height || 24) / 8 || 12
        const plusSvg = `
          <svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="11" fill="rgba(0,0,0,0.6)" stroke="#fff" stroke-width="1"/>
            <path d="M12 6v12M6 12h12" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
          </svg>
        `

        fabric.loadSVGFromString(plusSvg, (objects, options) => {
          const svgObject = fabric.util.groupSVGElements(objects, options)
          const center = shape.getCenterPoint()
          svgObject.set({
            id: `${shape.id}_moldIcon`,
            originX: 'center',
            originY: 'center',
            left: center.x,
            top: center.y,
            selectable: false,
            hasControls: false,
            hasBorders: false,
            absolutePositioned: true,
            evented: false
          })
          ;(svgObject as any).extensionType = 'moldIcon'
          this._canvas.add(svgObject)
          svgObject.setCoords()
          resolve(svgObject)
        })
      } catch (e) {
        console.warn('Failed to recreate mold icon', e)
        resolve(null)
      }
    })
  }

  private init() {
    /*    fabric.Canvas.prototype._historyNext = () => {
          return this.editor.getJson()
        }*/

    // 핸들러 참조 저장 (cleanup을 위해)
    this._historyAppendHandler = () => {
      this.historyUpdate()
    }
    this._canvas.on('history:append', this._historyAppendHandler)

    this._beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      if (this._canvas.historyUndo.length > 0) {
        ;(e || window.event).returnValue = 'cannot back'
      }
    }
    window.addEventListener('beforeunload', this._beforeUnloadHandler)
  }
}

export default HistoryPlugin
