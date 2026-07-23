import Editor from '../Editor'
import { PluginBase, PluginOption } from '../plugin'
import { fabric } from 'fabric'

/** 분배 보호 판정에 쓰는 이동 관련 플래그 표면 (fabric.Object 커스텀 확장 포함) */
interface DistributeProtectionFlags {
  movable?: boolean
  lockMovementX?: boolean
  lockMovementY?: boolean
}

class AlignPlugin extends PluginBase {
  name = 'AlignPlugin'

  hotkeys = []
  events: string[] = []

  // E2 §3-2a: editMode(관리자) 면제 판정을 위해 options 수신 (additive — 미전달 시 {}
  // 로 기존 시그니처 하위호환. createCanvas 가 mergedOptions 를 전달한다.)
  constructor(canvas: fabric.Canvas, editor: Editor, options: PluginOption = {}) {
    super(canvas, editor, options)
  }

  /**
   * 분배 이동 보호 판정 (E2 §3-2a) — CopyPlugin.isCloneProtected 와 동형 구조의 단독
   * 함수이되, 분배는 '이동' 행위이므로 이동 관련 플래그(movable, lockMovementX/Y)만
   * 본다. 복제 판정(deleteable/contentEditable/lockInfo)과 혼용하지 않는다 — 규칙
   * 이원화 방지. editMode(관리자)는 제외 없이 현행 유지(CopyPlugin _options.editMode
   * 규약과 동형).
   *
   * 배경: _distribute 의 setPositionByOrigin 은 lockMovementX/Y·movable=false 를
   * 우회하므로, 위치고정 객체가 다중 선택에 포함되면(L1 에서 선택 자체는 허용)
   * 관리자 보호를 뚫고 이동된다 — 여기서 제외해 L1~L7 보호 게이팅을 지킨다.
   */
  isDistributeProtected(obj: fabric.Object): boolean {
    if (this._options?.editMode) return false
    const o = obj as fabric.Object & DistributeProtectionFlags
    return o.movable === false || o.lockMovementX === true || o.lockMovementY === true
  }

  center(object: fabric.Object) {
    const workspace = this._getWorkspace()
    const center = workspace.getCenterPoint()
    return this._canvas._centerObject(object, center)
  }

  setV(type: 'top' | 'center' | 'bottom') {
    const objects = this._canvas.getActiveObjects()

    if (!objects || objects.length === 0) {
      return
    }

    // 캔버스에서 현재 변경 상태 추적 시작
    this._canvas.offHistory()

    /// 그룹 아이템일 경우
    if (objects.length > 1) {
      // 모든 객체의 경계를 구해서 정렬 기준점 계산
      const bounds = objects.map(obj => obj.getBoundingRect(true))
      
      let targetY = 0
      if (type === 'top') {
        targetY = Math.min(...bounds.map(b => b.top))
      } else if (type === 'center') {
        const totalCenterY = bounds.reduce((sum, b) => sum + b.top + b.height / 2, 0)
        targetY = totalCenterY / objects.length
      } else if (type === 'bottom') {
        targetY = Math.max(...bounds.map(b => b.top + b.height))
      }

      // 각 객체를 정렬
      objects.forEach((item, index) => {
        const bound = bounds[index]
        let newY = targetY

        if (type === 'top') {
          newY = targetY + bound.height / 2
        } else if (type === 'center') {
          newY = targetY
        } else if (type === 'bottom') {
          newY = targetY - bound.height / 2
        }

        this._canvas._centerObject(item, new fabric.Point(item.getCenterPoint().x, newY))
        item.setCoords()
        item.dirty = true
      })

      // 캔버스를 한 번 렌더링하여 객체 위치 업데이트 반영
      this._canvas.requestRenderAll()

      // ActiveSelection을 새로 생성하여 바운딩 박스 크기를 올바르게 업데이트
      this._canvas.discardActiveObject()
      const newActiveSelection = new fabric.ActiveSelection(objects, { canvas: this._canvas })
      this._canvas.setActiveObject(newActiveSelection)
      
      // 새로운 ActiveSelection의 좌표 설정
      newActiveSelection.setCoords()
      
      // 선택 박스 업데이트를 위해 다시 렌더링
      this._canvas.requestRenderAll()

      // modified 이벤트 발생 - 상태 변경 알림
      this._canvas.fire('object:modified', { target: newActiveSelection })
    } else {
      const bound = this._getWorkspace().getBoundingRect(true)
      const object = objects[0]
      const objectBound = object.getBoundingRect(true)

      let point = 0
      if (type === 'top') {
        point = bound.top + objectBound.height / 2
      } else if (type === 'center') {
        point = bound.top + bound.height / 2
      } else if (type === 'bottom') {
        point = bound.top + bound.height - objectBound.height / 2
      }

      this._canvas._centerObject(object, new fabric.Point(object.getCenterPoint().x, point))
      object.setCoords()
      object.dirty = true // 객체를 dirty로 표시하여 강제 업데이트

      // modified 이벤트 발생 - 상태 변경 알림
      this._canvas.fire('object:modified', { target: object })
    }

    // 캔버스 렌더링 및 히스토리 추적 재개
    this._canvas.requestRenderAll()
    this._canvas.onHistory()
  }

  setH(type: 'left' | 'center' | 'right') {
    const objects = this._canvas.getActiveObjects()

    if (!objects || objects.length === 0) {
      return
    }

    // 캔버스에서 현재 변경 상태 추적 시작
    this._canvas.offHistory()

    /// 그룹 아이템일 경우
    if (objects.length > 1) {
      // 모든 객체의 경계를 구해서 정렬 기준점 계산
      const bounds = objects.map(obj => obj.getBoundingRect(true))
      
      let targetX = 0
      if (type === 'left') {
        targetX = Math.min(...bounds.map(b => b.left))
      } else if (type === 'center') {
        const totalCenterX = bounds.reduce((sum, b) => sum + b.left + b.width / 2, 0)
        targetX = totalCenterX / objects.length
      } else if (type === 'right') {
        targetX = Math.max(...bounds.map(b => b.left + b.width))
      }

      // 각 객체를 정렬
      objects.forEach((item, index) => {
        const bound = bounds[index]
        let newX = targetX

        if (type === 'left') {
          newX = targetX + bound.width / 2
        } else if (type === 'center') {
          newX = targetX
        } else if (type === 'right') {
          newX = targetX - bound.width / 2
        }

        this._canvas._centerObject(item, new fabric.Point(newX, item.getCenterPoint().y))
        item.setCoords()
        item.dirty = true
      })

      // 캔버스를 한 번 렌더링하여 객체 위치 업데이트 반영
      this._canvas.requestRenderAll()

      // ActiveSelection을 새로 생성하여 바운딩 박스 크기를 올바르게 업데이트
      this._canvas.discardActiveObject()
      const newActiveSelection = new fabric.ActiveSelection(objects, { canvas: this._canvas })
      this._canvas.setActiveObject(newActiveSelection)
      
      // 새로운 ActiveSelection의 좌표 설정
      newActiveSelection.setCoords()
      
      // 선택 박스 업데이트를 위해 다시 렌더링
      this._canvas.requestRenderAll()

      // modified 이벤트 발생 - 상태 변경 알림
      this._canvas.fire('object:modified', { target: newActiveSelection })
    } else {
      const bound = this._getWorkspace().getBoundingRect(true)
      const object = objects[0]
      const objectBound = object.getBoundingRect(true)

      let point = 0
      if (type === 'left') {
        point = bound.left + objectBound.width / 2
      } else if (type === 'center') {
        point = bound.left + bound.width / 2
      } else if (type === 'right') {
        point = bound.left + bound.width - objectBound.width / 2
      }

      this._canvas._centerObject(object, new fabric.Point(point, object.getCenterPoint().y))
      object.setCoords()
      object.dirty = true // 객체를 dirty로 표시하여 강제 업데이트

      // modified 이벤트 발생 - 상태 변경 알림
      this._canvas.fire('object:modified', { target: object })
    }

    // 캔버스 렌더링 및 히스토리 추적 재개
    this._canvas.requestRenderAll()
    this._canvas.onHistory()
  }

  /**
   * 가로 균등 분배 (E1 §5-4 — ControlBar 트랙 T 구현을 공개 API 로 이관, 동작 동일).
   * 이동가능 객체 3개 이상 선택 시 x 축 center 기준 정렬 후 첫/끝 고정, 중간 객체를
   * center-to-center 간격 균등으로 재배치한다 (분배 기준은 D-E2-2 확정: center-to-center
   * 유지). 보호객체(isDistributeProtected)는 참여 집합에서 제외 — E2 §3-2a.
   */
  distributeH() {
    this._distribute('horizontal')
  }

  /** 세로 균등 분배 — distributeH 와 동일 규약 (y 축). */
  distributeV() {
    this._distribute('vertical')
  }

  /**
   * 균등 분배 공통 구현 — ControlBar.tsx 의 기존 distribute 로직 이동(offHistory/onHistory
   * 쌍·object:modified 발화 시맨틱 유지). fabric 프라이빗 _centerObject 의존은
   * setPositionByOrigin(center) 공개 API 로 정리(중심 기준 배치 동일).
   */
  private _distribute(axis: 'horizontal' | 'vertical') {
    const objects = this._canvas.getActiveObjects()
    if (!objects || objects.length < 3) return

    // E2 §3-2a: 보호객체는 분배 참여 집합에서 통째로 제외(기준점 후보로도 미사용).
    // 제외 후 잔여 이동가능 객체 < 3 → no-op (기존 length < 3 가드와 동일 지점 판정
    // — offHistory 이전이라 히스토리 중단 부작용 없음).
    const movables = objects.filter((o) => !this.isDistributeProtected(o))
    if (movables.length < 3) return

    this._canvas.offHistory()
    try {
      const objs = [...movables]
      const bounds = objs.map((o) => o.getBoundingRect(true))
      const horizontal = axis === 'horizontal'

      // 축 기준 center 로 정렬 후 첫/끝 사이 균등 분배
      const indexed = objs.map((o, i) => ({ o, b: bounds[i] }))
      indexed.sort((a, b) =>
        horizontal
          ? a.b.left + a.b.width / 2 - (b.b.left + b.b.width / 2)
          : a.b.top + a.b.height / 2 - (b.b.top + b.b.height / 2)
      )
      const first = indexed[0]
      const last = indexed[indexed.length - 1]
      const start = horizontal
        ? first.b.left + first.b.width / 2
        : first.b.top + first.b.height / 2
      const end = horizontal ? last.b.left + last.b.width / 2 : last.b.top + last.b.height / 2
      const step = (end - start) / (indexed.length - 1)

      indexed.forEach((entry, idx) => {
        if (idx === 0 || idx === indexed.length - 1) return
        const newCenter = start + step * idx
        const centerPoint = entry.o.getCenterPoint()
        const point = horizontal
          ? new fabric.Point(newCenter, centerPoint.y)
          : new fabric.Point(centerPoint.x, newCenter)
        entry.o.setPositionByOrigin(point, 'center', 'center')
        entry.o.setCoords()
        entry.o.dirty = true
      })

      // ActiveSelection 재생성으로 바운딩 박스 갱신 (setV/setH 다중 정렬과 동일 패턴).
      // ⚠️ 재생성에는 보호객체 포함 **선택 전체**를 유지한다 — 제외는 '이동'에만 적용
      // (E2 §3-2a: 제외 객체가 선택에 남아 있어도 위치 불변이면 무해).
      this._canvas.discardActiveObject()
      const newSel = new fabric.ActiveSelection([...objects], { canvas: this._canvas })
      this._canvas.setActiveObject(newSel)
      newSel.setCoords()
      this._canvas.requestRenderAll()
      this._canvas.fire('object:modified', { target: newSel })
    } finally {
      this._canvas.onHistory()
    }
  }

  dispose() {}
}

export default AlignPlugin
