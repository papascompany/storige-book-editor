import { v4 as uuid } from 'uuid'
import Editor from '../Editor'
import { fabric } from 'fabric'
import CanvasHotkey from '../models/CanvasHotkey'
import { PluginBase } from '../plugin'

class GroupPlugin extends PluginBase {
  name = 'GroupPlugin'
  hotkeys: CanvasHotkey[] = [
    {
      name: '그룹',
      input: ['ctrl+g', 'cmd+g'],
      onlyForActiveObject: true,
      category: 'object',
      callback: () => this.group(),
      hideContext: () => {
        const activeObject = this._canvas.getActiveObject()
        // ActiveSelection이고 2개 이상의 객체가 있을 때만 그룹 생성 가능
        return !activeObject ||
               !(activeObject instanceof fabric.ActiveSelection) ||
               activeObject.getObjects().length < 2
      }
    },
    {
      name: '그룹 해제',
      // Windows(Ctrl)·Mac(⌘) 양쪽 실동작 + 모달 표기 정합
      input: ['ctrl+backspace', 'cmd+backspace'],
      onlyForActiveObject: true,
      category: 'object',
      callback: () => this.unGroup(),
      hideContext: () => {
        const activeObject = this._canvas.getActiveObject()
        return !activeObject || activeObject.type !== 'group'
      }
    }
  ]
  events: string[] = []

  constructor(canvas: fabric.Canvas, editor: Editor) {
    super(canvas, editor, {})
  }

  toggleGroup() {
    const activeObject = this._canvas.getActiveObject()
    if (
      activeObject &&
      activeObject instanceof fabric.Group &&
      !(activeObject instanceof fabric.ActiveSelection)
    ) {
      this.unGroup()
    } else if (activeObject instanceof fabric.ActiveSelection) {
      this.group()
    }
  }

  unGroup() {
    const activeObject = this._canvas.getActiveObject() as fabric.Group
    if (!activeObject || activeObject.type !== 'group') return

    try {
      this._canvas.offHistory()

      const activeObjectList = activeObject.getObjects()
      if (activeObjectList.length === 0) return

      activeObject.toActiveSelection()
      for (const item of activeObjectList) {
        item.set('id', uuid())
        item.dirty = true
      }
      
      this._canvas.discardActiveObject().renderAll()
      this._canvas.setActiveObject(
        new fabric.ActiveSelection(activeObjectList, { canvas: this._canvas })
      )
      this._canvas.requestRenderAll()
      
      this._editor.emit('layerChanged')
    } catch (error) {
      console.error('그룹 해제 중 오류 발생:', error)
    } finally {
      this._canvas.onHistory()
    }
  }

  group() {
    const activeObj = this._canvas.getActiveObject() as fabric.ActiveSelection
    if (!activeObj || !(activeObj instanceof fabric.ActiveSelection)) return

    const objects = activeObj.getObjects()
    if (objects.length < 2) return

    try {
      this._canvas.offHistory()

      // ActiveSelection의 toGroup() 메서드 사용하여 위치 유지
      const group = activeObj.toGroup()
      group.set('id', uuid())
      group.extensionType = 'group'

      this._canvas.discardActiveObject()
      
      this._canvas.setActiveObject(group)
      this._canvas.requestRenderAll()

      this._editor.emit('layerChanged')
    } catch (error) {
      console.error('그룹 생성 중 오류 발생:', error)
    } finally {
      this._canvas.onHistory()
    }
  }

  dispose() {
    // 더 이상 별도의 키보드 이벤트 리스너가 없으므로 제거할 것 없음
  }
}

export default GroupPlugin
