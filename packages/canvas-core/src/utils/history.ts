// @ts-nocheck
import { fabric } from 'fabric'
import { core } from './canvas'

declare module 'fabric' {
  namespace fabric {
    interface Canvas {
      historyUndo: string[]
      historyRedo: string[]
      historyNextState: string
      historyProcessing: boolean
      historyLimitedMode: boolean
      historyMaxSteps: number
      isHistoryReady: boolean
      _svgElements: Record<string, fabric.Object> // SVG 요소 추적을 위한 맵 추가
      _guideElements: string[] // 가이드 요소 ID 저장

      _historyInit(): void

      _historyDispose(): void

      _historyNext(): string

      _historyEvents(): { [key: string]: (e: fabric.IEvent) => void }

      _historySaveAction(e?: fabric.IEvent): void

      _loadHistory(history: string, event: string, callback?: () => void): void

      _restoreGuideElements(): void // 가이드 요소 복원 메서드 추가

      registerSvgElement(element: fabric.Object): void // SVG 요소 등록 메서드
      undo(callback?: () => void): void

      redo(callback?: () => void): void

      clearHistory(type?: string): void

      clearUndo(): void

      canUndo(): boolean

      canRedo(): boolean

      onHistory(): void

      offHistory(): void
    }
  }
}

// 캔버스 초기화시 히스토리 기능 포함
fabric.Canvas.prototype.initialize = (function (originalFn) {
  return function (this: fabric.Canvas, ...args) {
    originalFn.call(this, ...args)
    this._historyInit()
    return this
  }
})(fabric.Canvas.prototype.initialize)

// 캔버스 소멸시 히스토리 정리
fabric.Canvas.prototype.dispose = (function (originalFn) {
  return function (this: fabric.Canvas, ...args) {
    originalFn.call(this, ...args)
    this._historyDispose()
    return this
  }
})(fabric.Canvas.prototype.dispose)

// 히스토리 리소스 정리
fabric.Canvas.prototype._historyDispose = function (): void {
  // 이벤트 리스너 제거
  this.off(this._historyEvents())

  // 메모리 정리
  this.historyUndo = []
  this.historyRedo = []
  this.historyNextState = null
  this.isHistoryReady = false
  this._svgElements = {}
  this._guideElements = []
}

// SVG 요소 등록 메서드 추가
fabric.Canvas.prototype.registerSvgElement = function (element: fabric.Object): void {
  // SVG 요소가 추가될 때 특별히 처리하고 추적
  if (!this._svgElements) {
    this._svgElements = {}
  }

  if (element && element.id) {
    // SVG 요소 등록
    this._svgElements[element.id] = element

    // SVG 요소에 특별한 마커 속성 추가
    element.set('_isSvgElement', true)

    // 히스토리에 추가되도록 보장
    if (element.excludeFromExport) {
      element.set('excludeFromExport', false)
    }

    // 히스토리 수동 저장 트리거
    if (this.isHistoryReady && !this.historyProcessing) {
      this._historySaveAction()
    }
  }
}

// 현재 캔버스 상태를 문자열로 반환 - 최적화된 버전
fabric.Canvas.prototype._historyNext = function (): string {
  // 필터링된 객체 목록 가져오기 - SVG 요소와 가이드 요소를 포함하도록 수정
  const objects = this.getObjects().filter((obj) => {
    // moldIcon은 히스토리에서 제외 (복원 시 동적 생성)
    if (obj.extensionType === 'moldIcon') {
      return false
    }
    // SVG 요소는 항상 포함
    if (obj._isSvgElement) {
      return true
    }

    // 가이드 요소들도 히스토리에 포함 (중요: excludeFromExport를 무시)
    if (
      obj.id === 'cut-border' ||
      obj.id === 'safe-zone-border' ||
      obj.id === 'cutline-template'
    ) {
      if (!this._guideElements) {
        this._guideElements = []
      }
      if (!this._guideElements.includes(obj.id)) {
        this._guideElements.push(obj.id)
      }
      return true // 가이드 요소들은 항상 포함
    }

    // outline은 기본 제외하되, 모양틀 관련(ID가 *_outline)인 경우 포함
    if (obj.extensionType === 'outline') {
      if (obj.id && typeof obj.id === 'string' && obj.id.endsWith('_outline')) {
        return true
      }
      return false
    }

    // 기본 필터링 로직
    return (
      obj.id !== 'workspace' &&
      obj.extensionType !== 'overlay' &&
      obj.type !== 'GuideLine' &&
      !obj.excludeFromExport
    )
  })

  // 필요한 속성만 추출하여 경량화된 상태 객체 생성
  const lightState = {
    objects: objects.map((obj) => {
      const baseProps = {
        id: obj.id,
        type: obj.type,
        left: obj.left,
        top: obj.top,
        width: obj.width,
        height: obj.height,
        scaleX: obj.scaleX,
        scaleY: obj.scaleY,
        angle: obj.angle,
        flipX: obj.flipX,
        flipY: obj.flipY,
        opacity: obj.opacity,
        visible: obj.visible,
        hasControls: obj.hasControls,
        originX: obj.originX,
        originY: obj.originY,
        fill: obj.fill,
        stroke: obj.stroke,
        strokeWidth: obj.strokeWidth,
        fillOpacity: obj.fillOpacity, // 채우기 투명도
        strokeOpacity: obj.strokeOpacity, // 선 투명도
        cmykFill: obj.cmykFill, // CMYK 원본 값
        cmykStroke: obj.cmykStroke, // CMYK 원본 값
        hasMolding: obj.hasMolding,
        hasCutting: obj.hasCutting,
        extensionType: obj.extensionType,
        _isSvgElement: obj._isSvgElement // SVG 요소 플래그 저장
      }

      // 객체 타입에 따라 추가 속성 포함
      if (obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') {
        return {
          ...baseProps,
          text: obj.text,
          fontSize: obj.fontSize,
          fontFamily: obj.fontFamily,
          textAlign: obj.textAlign,
          fontWeight: obj.fontWeight,
          charSpacing: obj.charSpacing,
          lineHeight: obj.lineHeight,
          underline: obj.underline,
          overline: obj.overline,
          linethrough: obj.linethrough,
          styles: obj.styles, // per-character 스타일 저장 (색상, stroke 등)
          fillOpacity: obj.fillOpacity, // 투명도 저장
          strokeOpacity: obj.strokeOpacity // stroke 투명도 저장
        }
      }

      // 이미지인 경우 추가 속성
      if (obj.type === 'image') {
        return {
          ...baseProps,
          src: obj.getSrc?.(),
          crossOrigin: obj.crossOrigin,
          filters: obj.filters
        }
      }

      // 경로인 경우 경로 데이터 포함
      if (obj.type === 'path') {
        return {
          ...baseProps,
          path: obj.path
        }
      }

      // 폴리곤/폴리라인인 경우 points 및 관련 속성 포함
      if (obj.type === 'polygon' || obj.type === 'polyline') {
        return {
          ...baseProps,
          points: obj.points,
          pathOffset: obj.pathOffset
        }
      }

      // SVG 요소인 경우 추가 속성
      if (obj._isSvgElement) {
        // SVG 요소는 기본 속성과 단일 path만 저장 (그룹 내부는 저장하지 않음)
        const svgProps = { ...baseProps }
        if (obj.path) {
          ;(svgProps as any).path = obj.path
        }
        return svgProps
      }

      return baseProps
    }),
    _guideElements: this._guideElements || [], // 가이드 요소 ID 저장
    version: Date.now() // 타임스탬프로 버전 관리 (항상 고유함)
  }

  return JSON.stringify(lightState)
}

// 히스토리 이벤트 핸들러 - 최적화된 버전
fabric.Canvas.prototype._historyEvents = function (): {
  [key: string]: (e: fabric.IEvent) => void
} {
  return {
    'object:added': (e: fabric.IEvent) => {
      // SVG 요소는 특별히 처리
      if (e.target && e.target._isSvgElement) {
        this._historySaveAction(e)
        return
      }

      // 히스토리에서 제외할 객체 타입 필터링
      if (
        e.target &&
        (e.target.extensionType === 'overlay' ||
          e.target.excludeFromExport ||
          e.target.type === 'GuideLine')
      ) {
        return
      }

      // outline 객체는 기본적으로 제외하지만, 칼선/모양틀 관련 outline은 포함
      if (e.target && e.target.extensionType === 'outline') {
        // ID가 {parentId}_outline 패턴인 경우, 부모 객체 확인
        if (e.target.id && e.target.id.endsWith('_outline')) {
          const parentId = e.target.id.replace('_outline', '')
          const parentShape = this.getObjects().find(obj => obj.id === parentId)
          
          // 부모가 칼선(hasCutting) 또는 모양틀(hasMolding)인 경우 히스토리에 포함
          if (parentShape && (parentShape.hasCutting || parentShape.hasMolding || parentShape.isMold)) {
            // 칼선/모양틀 관련 outline은 히스토리에 포함
          } else {
            // 일반 outline은 제외
            return
          }
        } else {
          // ID 패턴이 맞지 않는 일반 outline은 제외
          return
        }
      }

      // cutLine과 safeLine은 ID 추적
      if (
        e.target &&
        (e.target.id === 'cut-border' ||
          e.target.id === 'safe-zone-border' ||
          e.target.id === 'cutline-template')
      ) {
        if (!this._guideElements) {
          this._guideElements = []
        }
        if (!this._guideElements.includes(e.target.id)) {
          this._guideElements.push(e.target.id)
        }
      }

      this._historySaveAction(e)
    },
    'object:removed': (e: fabric.IEvent) => {
      // SVG 요소는 특별히 처리
      if (e.target && e.target._isSvgElement) {
        // SVG 맵에서 제거
        if (this._svgElements && e.target.id) {
          delete this._svgElements[e.target.id]
        }
        this._historySaveAction(e)
        return
      }

      if (
        e.target &&
        (e.target.extensionType === 'overlay' ||
          e.target.excludeFromExport ||
          e.target.type === 'GuideLine')
      ) {
        return
      }

      // outline 객체는 기본적으로 제외하지만, 칼선/모양틀 관련 outline은 포함
      if (e.target && e.target.extensionType === 'outline') {
        // ID가 {parentId}_outline 패턴인 경우, 부모 객체 확인
        if (e.target.id && e.target.id.endsWith('_outline')) {
          const parentId = e.target.id.replace('_outline', '')
          const parentShape = this.getObjects().find(obj => obj.id === parentId)
          
          // 부모가 칼선(hasCutting) 또는 모양틀(hasMolding)인 경우 히스토리에 포함
          if (parentShape && (parentShape.hasCutting || parentShape.hasMolding || parentShape.isMold)) {
            // 칼선/모양틀 관련 outline은 히스토리에 포함
          } else {
            // 일반 outline은 제외
            return
          }
        } else {
          // ID 패턴이 맞지 않는 일반 outline은 제외
          return
        }
      }
      this._historySaveAction(e)
    },
    'object:modified': (e: fabric.IEvent) => {
      // SVG 요소는 특별히 처리
      if (e.target && e.target._isSvgElement) {
        this._historySaveAction(e)
        return
      }

      if (
        e.target &&
        (e.target.extensionType === 'overlay' ||
          e.target.excludeFromExport ||
          e.target.type === 'GuideLine')
      ) {
        return
      }

      // outline 객체는 기본적으로 제외하지만, 칼선/모양틀 관련 outline은 포함
      if (e.target && e.target.extensionType === 'outline') {
        // ID가 {parentId}_outline 패턴인 경우, 부모 객체 확인
        if (e.target.id && e.target.id.endsWith('_outline')) {
          const parentId = e.target.id.replace('_outline', '')
          const parentShape = this.getObjects().find(obj => obj.id === parentId)
          
          // 부모가 칼선(hasCutting) 또는 모양틀(hasMolding)인 경우 히스토리에 포함
          if (parentShape && (parentShape.hasCutting || parentShape.hasMolding || parentShape.isMold)) {
            // 칼선/모양틀 관련 outline은 히스토리에 포함
          } else {
            // 일반 outline은 제외
            return
          }
        } else {
          // ID 패턴이 맞지 않는 일반 outline은 제외
          return
        }
      }
      this._historySaveAction(e)
    }
  }
}

// 히스토리 초기화 - 개선된 버전
fabric.Canvas.prototype._historyInit = function (): void {
  this.historyUndo = []
  this.historyRedo = []
  this.extraProps = core.extendFabricOption
  this.historyNextState = null
  this.isHistoryReady = false
  this._svgElements = {}
  this._guideElements = []

  // 히스토리 제한 설정 — 모바일은 더 작게 (메모리 절감, iOS Safari 크래시 방지)
  this.historyLimitedMode = true
  const isCoarsePointer = (() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    try { return window.matchMedia('(pointer: coarse)').matches } catch { return false }
  })()
  this.historyMaxSteps = isCoarsePointer ? 15 : 50

  // 이벤트 연결
  this.on(this._historyEvents())

  // 초기 상태 기록 - 타이머로 약간 지연시켜 초기화가 완료된 후 실행
  setTimeout(() => {
    this.historyNextState = this._historyNext()
    this.isHistoryReady = true
  }, 100)
}

// 히스토리 저장 액션 - 수정된 버전
fabric.Canvas.prototype._historySaveAction = function (e?: fabric.IEvent): void {
  // 히스토리 처리 중이거나 초기화되지 않은 경우 무시
  if (this.historyProcessing || !this.isHistoryReady) return

  const json = this._historyNext()

  // 첫번째 액션 또는 이전 상태와 다른 경우만 저장
  if (!this.historyNextState || json !== this.historyNextState) {
    // 디버그 로그는 production 에서 메모리/console 압박 — 제거
    // (필요 시 historyDebug 플래그 도입)

    // 이전 상태가 있는 경우에만 undo 스택에 저장
    if (this.historyNextState) {
      this.historyUndo.push(this.historyNextState)
    }

    // 히스토리 제한 로직
    if (this.historyLimitedMode && this.historyUndo.length > this.historyMaxSteps) {
      this.historyUndo.shift() // 가장 오래된 히스토리 제거
    }

    // Redo 스택 초기화 (새 액션이 발생하면 이전 redo는 무효화)
    this.historyRedo = []

    // 현재 상태 업데이트
    this.historyNextState = json

    // 이벤트 발생
    this.fire('history:append', { json: json })
  }
}

// 가이드 요소 복원 메서드
fabric.Canvas.prototype._restoreGuideElements = function (): void {
  console.log('_restoreGuideElements called, guideElements:', this._guideElements)
  
  // 워크스페이스 플러그인 찾기
  const workspacePlugin = this.getObjects().find((obj) => obj.id === 'workspace')?.__workspacePlugin
  
  // 에디터 참조 찾기
  const editor = this.__editor
  
  // 히스토리 이벤트 차단 (되돌리기 중 생성되는 가이드로 히스토리 오염 방지)
  const prevProcessing = this.historyProcessing
  this.historyProcessing = true

  if (workspacePlugin) {
    console.log('Found workspacePlugin, calling border creation methods')
    // 워크스페이스 플러그인 메서드 호출
    if (typeof workspacePlugin.createOrUpdateCutBorder === 'function') {
      workspacePlugin.createOrUpdateCutBorder()
    }

    if (typeof workspacePlugin.createOrUpdateSafeSize === 'function') {
      workspacePlugin.createOrUpdateSafeSize()
    }
  } else if (editor) {
    console.log('WorkspacePlugin not found, trying editor events')
    // 편집기 인스턴스를 통해 가이드 요소 복원
    const workspacePluginFromEditor = editor.getPlugin('WorkspacePlugin')
    if (workspacePluginFromEditor) {
      console.log('Found WorkspacePlugin from editor')
      if (typeof workspacePluginFromEditor.createOrUpdateCutBorder === 'function') {
        workspacePluginFromEditor.createOrUpdateCutBorder()
      }
      if (typeof workspacePluginFromEditor.createOrUpdateSafeSize === 'function') {
        workspacePluginFromEditor.createOrUpdateSafeSize()
      }
    } else {
      // 이벤트로 복원 시도
      editor.emit('restoreGuideElements')
    }
  } else {
    console.warn('Neither workspacePlugin nor editor found for guide element restoration')
  }

  // 히스토리 이벤트 재개
  this.historyProcessing = prevProcessing
}

// 히스토리 되돌리기 (Undo) - 디버깅 개선
fabric.Canvas.prototype.undo = function (callback?: () => void): void {
  console.log('Undo called, history stack:', this.historyUndo.length, 'redo stack:', this.historyRedo.length)

  if (this.historyUndo.length === 0) {
    console.warn('No more undo steps available.')
    return
  }

  this.historyProcessing = true

  // 현재 상태를 Redo 스택에 저장
  console.log('Saving current state to redo stack')
  this.historyRedo.push(this.historyNextState)

  // Undo 스택에서 이전 상태 가져오기
  const history = this.historyUndo.pop()
  console.log('Restoring state from undo stack, remaining undo steps:', this.historyUndo.length)
  this.historyNextState = history

  // 이전 상태 로드
  this._loadHistory(history, 'history:undo', () => {
    // 가이드 요소 복원
    this._restoreGuideElements()

    if (callback && typeof callback === 'function') {
      callback()
    }
  })
}

// 히스토리 다시하기 (Redo)
fabric.Canvas.prototype.redo = function (callback?: () => void): void {
  console.log('Redo called, history stack:', this.historyRedo.length)

  if (this.historyRedo.length === 0) {
    console.warn('No more redo steps available.')
    return
  }

  this.historyProcessing = true

  // 현재 상태를 Undo 스택에 저장
  this.historyUndo.push(this.historyNextState)

  // Redo 스택에서 다음 상태 가져오기
  const history = this.historyRedo.pop()
  this.historyNextState = history

  // 다음 상태 로드
  this._loadHistory(history, 'history:redo', () => {
    // 가이드 요소 복원
    this._restoreGuideElements()

    if (callback && typeof callback === 'function') {
      callback()
    }
  })
}

// 히스토리 로드 - 완전히 개선된 버전
fabric.Canvas.prototype._loadHistory = function (
  history: string,
  event: string,
  callback?: () => void
): void {
  try {
    const that = this
    const jsonHistory = JSON.parse(history)

    // 가이드 요소 ID 복원
    if (jsonHistory._guideElements) {
      this._guideElements = jsonHistory._guideElements
    }

    // 현재 객체 맵핑 (ID 기준)
    const currentObjectsMap = {}
    that.getObjects().forEach((obj) => {
      if (obj.id && obj.id !== 'workspace') {
        currentObjectsMap[obj.id] = obj
      }
    })

    // 히스토리 객체 맵핑 (ID 기준)
    const historyObjectsMap = {}
    if (jsonHistory.objects) {
      jsonHistory.objects.forEach((obj) => {
        if (obj.id && obj.id !== 'workspace') {
          historyObjectsMap[obj.id] = obj
        }
      })
    }

    // 1. 삭제할 객체 처리: 현재 있지만 히스토리에 없는 객체
    const objectsToRemove = []
    Object.keys(currentObjectsMap).forEach((id) => {
      // 가이드 요소는 삭제하지 않음 - 더 포괄적으로 체크
      const isGuideElement = id === 'cut-border' || 
                             id === 'safe-zone-border' || 
                             id === 'cutline-template' ||
                             id.includes('cutline-template')
      
      if (!historyObjectsMap[id] && !isGuideElement) {
        objectsToRemove.push(currentObjectsMap[id])
      }
    })

    // 한 번에 여러 객체 삭제 (성능 최적화)
    if (objectsToRemove.length > 0) {
      that.remove(...objectsToRemove)
    }

    // 2. 업데이트할 객체: 현재도 있고 히스토리에도 있는 객체
    Object.keys(historyObjectsMap).forEach((id) => {
      if (currentObjectsMap[id]) {
        const historyObj = historyObjectsMap[id]
        const currentObj = currentObjectsMap[id]

        // 객체 속성 업데이트
        currentObj.set(historyObj)

        // 폴리곤/폴리라인의 기하 정보 우선 적용 (points/pathOffset)
        if ((historyObj.type === 'polygon' || historyObj.type === 'polyline')) {
          if (historyObj.points) {
            currentObj.set({ points: historyObj.points })
          }
          if (historyObj.pathOffset) {
            currentObj.set({ pathOffset: historyObj.pathOffset })
          }
        }

        // SVG 요소인 경우 특별 처리
        if (historyObj._isSvgElement) {
          currentObj.set('_isSvgElement', true)

          // SVG 맵에 추가
          this._svgElements[id] = currentObj
        }

        currentObj.setCoords()
      }
    })

    // 3. 추가할 객체: 히스토리에 있지만 현재 없는 객체
    const objectsToAdd = []
    Object.keys(historyObjectsMap).forEach((id) => {
      if (!currentObjectsMap[id]) {
        objectsToAdd.push(historyObjectsMap[id])
      }
    })

    // 객체 추가 처리
    if (objectsToAdd.length > 0) {
      // 비동기 처리를 위한 객체 추가 함수
      const addObjectsAsync = () => {
        return new Promise<void>((resolve) => {
          fabric.util.enlivenObjects(
            objectsToAdd,
            (enlivenedObjects) => {
              enlivenedObjects.forEach((obj) => {
                // SVG 요소인 경우 특별 처리
                if (obj._isSvgElement) {
                  this._svgElements[obj.id] = obj
                }

                that.add(obj)

                // 추가된 객체에 대해 좌표/치수 재계산 보장
                try {
                  if (
                    obj &&
                    (obj.type === 'polygon' ||
                      obj.type === 'polyline' ||
                      obj.type === 'path' ||
                      obj.type === 'group')
                  ) {
                    obj.setCoords()
                  }
                } catch (e) {
                  console.warn('setCoords failed on enlivened object', e)
                }
              })
              resolve()
            },
            'fabric'
          )
        })
      }

      // 객체 추가 후 완료 처리
      addObjectsAsync().then(() => {
        that.renderAll()
        that.historyProcessing = false
        that.fire(event)
        if (callback && typeof callback === 'function') callback()
      })
    } else {
      // 추가할 객체가 없는 경우 바로 완료 처리
      that.renderAll()
      that.historyProcessing = false
      that.fire(event)
      if (callback && typeof callback === 'function') callback()
    }
  } catch (err) {
    console.error('Error loading history:', err)
    this.historyProcessing = false
    if (callback && typeof callback === 'function') callback()
  }
}

// 히스토리 초기화
fabric.Canvas.prototype.clearHistory = function (type?: string): void {
  if (!type) {
    this.historyUndo = []
    this.historyRedo = []
    this.fire('history:clear')
  } else {
    // 현재 상태만 유지하고 나머지 초기화
    const currentState = this.historyNextState
    this.historyUndo = []
    this.historyRedo = []
    this.historyNextState = currentState
    this.fire('history:clear')
  }
}

// Undo 스택만 초기화
fabric.Canvas.prototype.clearUndo = function (): void {
  this.historyUndo = []
}

// Undo 가능 여부 확인
fabric.Canvas.prototype.canUndo = function (): boolean {
  return this.historyUndo.length > 0
}

// Redo 가능 여부 확인
fabric.Canvas.prototype.canRedo = function (): boolean {
  return this.historyRedo.length > 0
}

// 히스토리 처리 활성화
fabric.Canvas.prototype.onHistory = function (): void {
  this.historyProcessing = false

  // 현재 상태를 저장 (히스토리 처리 재개 시)
  if (this.isHistoryReady) {
    const currentState = this._historyNext()

    // 이전 상태와 현재 상태가 다를 경우에만 저장
    if (this.historyNextState !== currentState) {
      // 이전 상태를 Undo 스택에 추가
      if (this.historyNextState) {
        this.historyUndo.push(this.historyNextState)
      }

      // 현재 상태 업데이트
      this.historyNextState = currentState

      // Redo 스택 초기화 (새 상태가 추가되면 이전 redo는 무효화)
      this.historyRedo = []

      // 이벤트 발생
      this.fire('history:append', { json: currentState })
    }
  }
}

// 히스토리 처리 비활성화
fabric.Canvas.prototype.offHistory = function (): void {
  this.historyProcessing = true
}

// WorkspacePlugin 연결을 위한 참조 설정
// 이 함수는 WorkspacePlugin 초기화 시에 호출되어야 함
export function connectWorkspacePlugin(canvas: fabric.Canvas, workspacePlugin: any): void {
  const workspace = canvas.getObjects().find((obj) => obj.id === 'workspace')

  if (workspace) {
    // 워크스페이스 객체에 플러그인 참조 설정
    workspace.__workspacePlugin = workspacePlugin
  }

  // 캔버스에 에디터 참조 설정
  if (workspacePlugin._editor) {
    canvas.__editor = workspacePlugin._editor
  }
}
