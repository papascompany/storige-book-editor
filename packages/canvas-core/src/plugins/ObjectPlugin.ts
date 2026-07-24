import Editor from '../Editor'
import { fabric } from 'fabric'
import CanvasHotkey from '../models/CanvasHotkey'
import { PluginBase, PluginOption } from '../plugin'
import { RenderOptimizer } from '../utils/render'

const lockAttrs: string[] = [
  'lockMovementX',
  'lockMovementY',
  'lockRotation',
  'lockScalingX',
  'lockScalingY'
]

class ObjectPlugin extends PluginBase {
  name = 'ObjectPlugin'
  events = []

  constructor(canvas: fabric.Canvas, editor: Editor, options: PluginOption) {
    super(canvas, editor, options)

    this._canvas.on('object:added', (e: fabric.IEvent) => {
      if (
        e.target?.extensionType === 'background'
      ) {
        this.setUnchangeable()
      }
    })
  }

  get hotkeys(): CanvasHotkey[] {
    return [
      {
        name: '뒤로',
        input: '[',
        callback: () => this.down(),
        onlyForActiveObject: true,
        category: 'arrange'
      },
      {
        name: '앞으로',
        input: ']',
        callback: () => this.up(),
        onlyForActiveObject: true,
        category: 'arrange'
      },
      {
        name: '가장 뒤로',
        input: ['ctrl+[', 'cmd+['],
        callback: () => this.downTop(),
        onlyForActiveObject: true,
        category: 'arrange'
      },
      {
        name: '가장 앞으로',
        input: ['ctrl+]', 'cmd+]'],
        callback: () => this.upTop(),
        onlyForActiveObject: true,
        category: 'arrange'
      },
      {
        name: '삭제',
        input: ['backspace', 'del'],
        callback: () => this.del(),
        onlyForActiveObject: true,
        category: 'object',
        displayKeys: ['⌫'] // Backspace/Delete 공통(도움말 표기 단일화)
      },
      // W4 §6-1: 화살표 이동 단일 소스(1px, Shift=10px). ControlsPlugin 의 중복 window keydown
      // 핸들러를 제거하고 이 hotkeys 로 일원화했다 — 기존 이중 등록은 1키에 합산 2px 이동 +
      // Shift+화살표가 ControlsPlugin(잠금 미가드)으로 이동잠금 객체를 10px 미는 보호 우회
      // 결함이 있었다. 여기 nudge 는 잠금 축을 존중하고 setCoords+object:modified(undo 1엔트리)
      // +렌더까지 수행한다. hotkeys 가 유일 소스라 C9 모달 자동생성(§6-2)이 정확해진다.
      // 도움말 모달(§6-2): 대표 엔트리('left'/'shift+left')만 화살표 묶음 displayKeys 로 노출하고
      // 나머지 방향은 hideInHelp 로 축약(등록·동작은 8종 전부 유지). hideContext(컨텍스트 은폐)와
      // hideInHelp(도움말 은폐)는 독립 — 화살표는 컨텍스트엔 숨기고 도움말엔 노출.
      { name: '객체 이동', input: 'left', onlyForActiveObject: true, hideContext: true, category: 'move', displayKeys: ['←→↑↓'], callback: () => this.nudge('left', -1) },
      { name: '우측 이동', input: 'right', onlyForActiveObject: true, hideContext: true, category: 'move', hideInHelp: true, callback: () => this.nudge('left', 1) },
      { name: '상단 이동', input: 'up', onlyForActiveObject: true, hideContext: true, category: 'move', hideInHelp: true, callback: () => this.nudge('top', -1) },
      { name: '하단 이동', input: 'down', onlyForActiveObject: true, hideContext: true, category: 'move', hideInHelp: true, callback: () => this.nudge('top', 1) },
      { name: '객체 이동 (10px)', input: 'shift+left', onlyForActiveObject: true, hideContext: true, category: 'move', displayKeys: ['⇧', '←→↑↓'], callback: () => this.nudge('left', -10) },
      { name: '우측 이동(10px)', input: 'shift+right', onlyForActiveObject: true, hideContext: true, category: 'move', hideInHelp: true, callback: () => this.nudge('left', 10) },
      { name: '상단 이동(10px)', input: 'shift+up', onlyForActiveObject: true, hideContext: true, category: 'move', hideInHelp: true, callback: () => this.nudge('top', -10) },
      { name: '하단 이동(10px)', input: 'shift+down', onlyForActiveObject: true, hideContext: true, category: 'move', hideInHelp: true, callback: () => this.nudge('top', 10) },
      {
        name: '스포이드',
        input: 'i',
        onlyForActiveObject: true,
        hideContext: true,
        category: 'object',
        callback: () => {
          this._editor.emit('eyedropper:trigger')
        }
      }
    ]
  }

  /**
   * W4 §6-1: 화살표 키 이동의 단일 구현. 잠금 축(lockMovementX/Y) 존중(키보드 이동은 fabric
   * 이 자동 차단하지 않아 .set 우회를 직접 가드) + setCoords + object:modified(undo 1엔트리)
   * + 렌더. ControlsPlugin 의 중복 window keydown 핸들러 제거로 이 경로가 유일 소스가 됐다.
   */
  private nudge(axis: 'left' | 'top', delta: number) {
    const activeObject = this._canvas.getActiveObject()
    if (!activeObject) return
    if (axis === 'left' && activeObject.lockMovementX) return
    if (axis === 'top' && activeObject.lockMovementY) return
    const cur = axis === 'left' ? activeObject.left ?? 0 : activeObject.top ?? 0
    activeObject.set(axis, cur + delta)
    activeObject.setCoords()
    this._canvas.fire('object:modified', { target: activeObject })
    this._canvas.requestRenderAll()
  }

  up() {
    const actives = this._canvas.getActiveObjects()
    if (actives && actives.length === 1) {
      this._canvas.offHistory()

      const activeObject = this._canvas.getActiveObjects()[0]
      if (activeObject) {
        // lockLayerOrder 체크 - fillImage는 단독으로 이동 불가
        if ((activeObject as any).lockLayerOrder) {
          console.log('🔒 레이어 순서 이동이 잠긴 객체입니다')
          this._canvas.onHistory()
          return
        }
        
        activeObject.bringForward()
        
        // fillImage가 있으면 함께 이동
        const fillImage = this._canvas.getObjects().find((obj: fabric.Object) => 
          obj.extensionType === 'fillImage' && (obj as any).parentLayerId === activeObject.id
        )
        if (fillImage) {
          fillImage.bringForward()
        }
      }
      
      this.setUnchangeable()
      this._canvas.onHistory()
      RenderOptimizer.queueRender(this._canvas)

      this._editor.emit('layerChanged')
    }
  }

  upTop() {
    const actives = this._canvas.getActiveObjects()
    if (actives && actives.length === 1) {
      this._canvas.offHistory()
      const activeObject = this._canvas.getActiveObjects()[0]
      if (activeObject) {
        // lockLayerOrder 체크 - fillImage는 단독으로 이동 불가
        if ((activeObject as any).lockLayerOrder) {
          console.log('🔒 레이어 순서 이동이 잠긴 객체입니다')
          this._canvas.onHistory()
          return
        }
        
        activeObject.bringToFront()
        
        // fillImage가 있으면 함께 이동
        const fillImage = this._canvas.getObjects().find((obj: fabric.Object) => 
          obj.extensionType === 'fillImage' && (obj as any).parentLayerId === activeObject.id
        )
        if (fillImage) {
          fillImage.bringToFront()
        }
      }
      
      this.setUnchangeable()
      this._canvas.onHistory()
      RenderOptimizer.queueRender(this._canvas)

      this._editor.emit('layerChanged')
    }
  }

  down() {
    const actives = this._canvas.getActiveObjects()
    if (actives && actives.length === 1) {
      this._canvas.offHistory()

      const activeObject = this._canvas.getActiveObjects()[0]
      if (activeObject) {
        // lockLayerOrder 체크 - fillImage는 단독으로 이동 불가
        if ((activeObject as any).lockLayerOrder) {
          console.log('🔒 레이어 순서 이동이 잠긴 객체입니다')
          this._canvas.onHistory()
          return
        }
        
        activeObject.sendBackwards()
        
        // fillImage가 있으면 함께 이동
        const fillImage = this._canvas.getObjects().find((obj: fabric.Object) => 
          obj.extensionType === 'fillImage' && (obj as any).parentLayerId === activeObject.id
        )
        if (fillImage) {
          fillImage.sendBackwards()
        }
      }
      
      this.setUnchangeable()
      this._canvas.onHistory()
      RenderOptimizer.queueRender(this._canvas)

      this._editor.emit('layerChanged')
    }
  }

  downTop() {
    const actives = this._canvas.getActiveObjects()
    if (actives && actives.length === 1) {
      this._canvas.offHistory()

      const activeObject = this._canvas.getActiveObjects()[0]
      if (activeObject) {
        // lockLayerOrder 체크 - fillImage는 단독으로 이동 불가
        if ((activeObject as any).lockLayerOrder) {
          console.log('🔒 레이어 순서 이동이 잠긴 객체입니다')
          this._canvas.onHistory()
          return
        }
        
        activeObject.sendToBack()
        
        // fillImage가 있으면 함께 이동
        const fillImage = this._canvas.getObjects().find((obj: fabric.Object) => 
          obj.extensionType === 'fillImage' && (obj as any).parentLayerId === activeObject.id
        )
        if (fillImage) {
          fillImage.sendToBack()
        }
      }
      
      this.setUnchangeable()
      this._canvas.onHistory()
      RenderOptimizer.queueRender(this._canvas)

      this._editor.emit('layerChanged')
    }
  }

  setAsObjectClipPath(object: fabric.Object) {
    // 새로운 클립패스 객체 생성
    object.clone((clonedObject: fabric.Object) => {
      clonedObject.id = 'template-outline'
      clonedObject.selectable = false
      clonedObject.evented = false
      clonedObject.hasControls = false
      clonedObject.lockMovementX = true
      clonedObject.lockMovementY = true
      clonedObject.editable = false
      clonedObject.fill = 'white'
      clonedObject.extensionType = 'template-element'
      clonedObject.absolutePositioned = true
      clonedObject.setCoords()

      this._canvas.add(clonedObject)
      RenderOptimizer.queueRender(this._canvas)
    })
  }

  del(object?: fabric.Object) {
    this._canvas.offHistory()
    const canvas = this._canvas
    let activeObject = object !== undefined ? [object] : canvas.getActiveObjects()

    if (activeObject && activeObject.length > 0) {
      // lid 객체 삭제 방지 - editMode가 아닐 때
      const lidObjects = activeObject.filter((obj) => (obj as any).extensionType === 'lid')
      if (lidObjects.length > 0 && !this._options.editMode) {
        canvas.onHistory()
        return
      }

      // P1-5 (2026-06-02): 삭제 잠금 강제.
      // editMode(관리자)가 아닐 때, lockInfo.isLocked 또는 deleteable===false 객체는 삭제 차단.
      // (휴지통 버튼·Delete/Backspace 단축키 모두 이 경로를 거치므로 일괄 보호.)
      if (!this._options.editMode) {
        const isProtected = (obj: fabric.Object) =>
          (obj as any)?.lockInfo?.isLocked === true || (obj as any)?.deleteable === false
        activeObject = activeObject.filter((obj) => !isProtected(obj))
        if (activeObject.length === 0) {
          canvas.onHistory()
          return
        }
      }

      // 모든 선택된 객체에 대해 연관된 fillImage 찾기 및 제거
      activeObject.forEach((obj) => {
        if (obj && obj.id) {
          const activeObjectId = obj.id
          const allObjects: fabric.Object[] = canvas.getObjects()
          
          // fillImage 제거 (부모가 삭제되면 fillImage도 삭제)
          const fillImage = allObjects.find((item: fabric.Object) => 
            item.extensionType === 'fillImage' && (item as any).parentLayerId === activeObjectId
          )
          if (fillImage) {
            fillImage.clipPath = undefined
            canvas.remove(fillImage)
          }

          // 연관된 모양틀 요소들 찾기 및 제거 (outline과 moldIcon)
          const associatedObjects = allObjects.filter((item: fabric.Object) => {
            if (!item || !item.id || typeof item.id !== 'string' || typeof activeObjectId !== 'string') {
              return false
            }
            
            // 정확한 패턴 매칭: {activeObjectId}_outline 또는 {activeObjectId}_moldIcon
            return (
              item.id === `${activeObjectId}_outline` ||
              item.id === `${activeObjectId}_moldIcon` ||
              (item.id.startsWith(`${activeObjectId}_`) && item.extensionType !== 'fillImage') // 기타 연관 요소들 (fillImage는 이미 처리됨)
            )
          })

          // 연관된 객체들 제거
          associatedObjects.forEach((item) => {
            item.clipPath = undefined
            canvas.remove(item)
          })
        }
      })

      // 모양틀에 채워진 이미지가 삭제되는 경우 + 아이콘 다시 표시
      activeObject.forEach((obj) => {
        if (obj && obj.clipPath && obj.clipPath.id) {
          // 이 객체가 모양틀에 채워진 이미지인지 확인
          const moldShape = canvas.getObjects().find((item) => 
            item.id === obj.clipPath?.id && 
            (item.extensionType === 'template-element' || item.hasMolding)
          )
          
          if (moldShape) {
            // 해당 모양틀의 + 아이콘을 다시 표시
            const moldIcon = canvas.getObjects().find((item) => 
              item.extensionType === 'moldIcon' && 
              item.id === `${moldShape.id}_moldIcon`
            )
            
            if (moldIcon) {
              moldIcon.set('visible', true)
            }
          }
        }
      })

      // 선택된 객체 제거
      canvas.remove(...activeObject)
      canvas.discardActiveObject()

      canvas.onHistory()
      RenderOptimizer.queueRender(canvas)

      this._editor.emit('layerChanged')
    }
  }

  lock(object: fabric.Object) {
    this._canvas.offHistory()
    console.log(object)
    object.hasControls = false
    object.selectable = false
    lockAttrs.forEach((attr: string) => {
      object[attr] = true
    })
    RenderOptimizer.queueRender(this._canvas)
    this._canvas.onHistory()

    this._editor.emit('layerChanged')
  }

  unlock(object: fabric.Object) {
    this._canvas.offHistory()
    object.hasControls = true
    object.selectable = true
    lockAttrs.forEach((attr: string) => {
      object[attr] = false
    })
    RenderOptimizer.queueRender(this._canvas)
    this._canvas.onHistory()

    this._editor.emit('layerChanged')
  }

  visible(object: fabric.Object) {
    object.visible = true
    this._editor.emit('layerChanged')
  }

  invisible(object: fabric.Object) {
    object.visible = false
    this._editor.emit('layerChanged')
  }

  afterLoad(...args): Promise<void> {
    return new Promise((resolve) => {
      this._canvas.on('object:added', this.setUnchangeable.bind(this))
      resolve(...args)
    })
  }

  dispose() {
    this._canvas.off('object:added', this.setUnchangeable.bind(this))
  }

  /**
   * editMode 변경 시 lid 객체의 selectable 속성 업데이트
   */
  updateLidObjectsSelectability(editMode: boolean) {
    const allObjects = this._canvas.getObjects()
    const lidObjects = allObjects.filter((obj: fabric.Object) => (obj as any).extensionType === 'lid')
    
    lidObjects.forEach((lidObject: fabric.Object) => {
      lidObject.set({
        selectable: editMode,
        editable: editMode,
        hasControl: editMode,
      } as any)
    })
    
    if (lidObjects.length > 0) {
      this._canvas.requestRenderAll()
    }
  }

  setUnchangeable() {
    const allObjects = this._canvas.getObjects()
    const workspace = this._getWorkspace()
    const background = allObjects.find((item: fabric.Object) => item.extensionType === 'background')
    const templateBackground = allObjects.find(
      (item: fabric.Object) => item.id === 'template-background'
    )
    const templateOutline = allObjects.find(
      (item: fabric.Object) => item.id === 'template-outline' || item.id === 'page-outline'
    )

    templateOutline && templateOutline.bringToFront()
    background && background.sendToBack()
    templateBackground && templateBackground.sendToBack()
    workspace && workspace.sendToBack()

    // fillImage를 부모 객체 바로 위에 위치시키기
    const fillImages = allObjects.filter((obj: fabric.Object) => obj.extensionType === 'fillImage')
    fillImages.forEach((fillImage: fabric.Object) => {
      const parentId = (fillImage as any).parentLayerId
      if (parentId) {
        const parent = this._canvas.getObjects().find((obj: fabric.Object) => obj.id === parentId)
        if (parent) {
          const parentIndex = this._canvas.getObjects().indexOf(parent)
          const currentIndex = this._canvas.getObjects().indexOf(fillImage)
          if (currentIndex !== parentIndex + 1) {
            fillImage.moveTo(parentIndex + 1)
          }
        }
      }
    })

    const alwaysAbove = ['overlay', 'outline', 'printguide', 'guideline']

    allObjects.forEach((obj: fabric.Object) => {
      if (alwaysAbove.includes(obj.extensionType) || obj.alwaysTop === true) {
        obj.bringToFront()
      }
    })

    this.updateLidObjectsSelectability(this._options.editMode)

    this._canvas.requestRenderAll()

  }
}

export default ObjectPlugin
