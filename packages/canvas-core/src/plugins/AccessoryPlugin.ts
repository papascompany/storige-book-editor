import Editor from '../Editor'
import { fabric } from 'fabric'
import { PluginBase, PluginOption } from '../plugin'
import { v4 as uuid } from 'uuid'
// 타입 전용 import (빌드시 완전 소거 → paper 를 eager 번들로 재유입시키지 않음).
// 전역 `declare namespace paper` 의 타입(PaperScope/PathItem) 참조 시 ESLint no-undef 를 만족시키기 위함.
// 런타임 값은 아래 getPaper() 의 dynamic import('paper') 로만 로드한다.
import type paper from 'paper'
import { AccessoryPosition, ClippingAccessory } from '../models'
import ImageProcessingPlugin from './ImageProcessingPlugin'

// paper.js 지연 로드 (번들 절단: Track A) — drawMergedWorkspace 최초 호출 시에만 로드.
// paper 타입(paper.PaperScope/paper.PathItem 등)은 전역 `declare namespace paper`로 제공되어
// 정적 import 없이도 타입 참조가 유지된다. 런타임 값(PaperScope 싱글턴)만 dynamic import로 가져온다.
let _paperScope: paper.PaperScope | null = null
async function getPaper(): Promise<paper.PaperScope> {
  if (!_paperScope) {
    _paperScope = (await import('paper')).default
  }
  return _paperScope
}

class AccessoryPlugin extends PluginBase {
  events = []
  hotkeys = []
  name = 'AccessoryPlugin'

  constructor(canvas: fabric.Canvas, editor: Editor, options: PluginOption) {
    super(canvas, editor, options)
  }

  addAccessory(
    outline: fabric.Object,
    innerItem: fabric.Object,
    innerPath: fabric.Object,
    accessory: ClippingAccessory,
    distance: number
  ): Promise<fabric.Object> {
    return new Promise((resolve, reject) => {
      try {
        if (!outline) {
          console.error('no item selected')
          return
        }

        const imagePlugin = this._editor.getPlugin<ImageProcessingPlugin>('ImageProcessingPlugin')

        const { svg, position, movingArea, size } = accessory
        const currentAccessoryObj = this._canvas.getObjects().find((obj) => obj.id === 'accessory')

        // load accessory design from svg
        fabric.loadSVGFromURL(svg, async (objects, options) => {
          if (!objects || !options) {
            throw new Error('Failed to load SVG from URL')
          }
          const item: fabric.Object = fabric.util.groupSVGElements(objects, {
            ...options
          })

          console.log('accessory object', item)

          /// the top center of the current;
          const point = this.getPointByPosition(outline, position)

          const width = size.width ?? 0
          const height = size.height ?? 0

          console.log('current point', point, width, height)

          item.setOptions({
            id: 'accessory',
            selectable: true,
            hasBorders: false,
            hasControls: false,
            moveCursor: 'move',
            originX: 'center',
            originY: 'center',
            scaleY: height === 0 ? 1 : height / item.height!,
            scaleX: width === 0 ? 1 : width / item.width!,
            strokeUniform: true,
            absolutePositioned: true,
            editable: false,
            extensionType: 'clipping',
            left: currentAccessoryObj?.left ?? point.x,
            top: currentAccessoryObj?.top ?? point.y
          })

          // save accessory
          item.accessory = accessory

          console.log('accessory', item)
          let movingPath: fabric.Path | undefined

          /// 3 cases for now
          /// [MovingArea] : 'inner' 'outline' 'bottomLine';
          if (movingArea === 'outline' || movingArea === 'bottomLine') {
            if (movingArea === 'bottomLine' && !(position == 'bottomCenter')) {
              reject(`not supported combination of position and movingArea`)
            }

            if (movingArea === 'bottomLine') {
              /// outline 의 가장 낮은 y값을 수직으로 지나는 path. outline 의 너비로 설정
              /// rect 로 경계선을 만들어서 path로 변환
              let gap: number = 0
              if (distance < (item.height! * item.scaleY!) / 2) {
                gap = (item.height! * item.scaleY!) / 2 - distance
              }

              /// only scale Y
              const outerRect = outline.getBoundingRect(true, true)
              const itemRect = item.getBoundingRect(true, true)
              console.log('current outer rect', outerRect, itemRect)
              const pathData = `M ${outerRect.left + outerRect.width / 2} ${outerRect.top + outerRect.height + gap} L ${outerRect.left + (outerRect.width * 3) / 2 - itemRect.width - distance * 4} ${outerRect.top + outerRect.height + gap}`
              movingPath = new fabric.Path(pathData, {
                id: uuid(),
                stroke: 'blue',
                strokeWidth: 0,
                originX: 'center',
                originY: 'center',
                left: currentAccessoryObj?.left ?? point.x,
                top: currentAccessoryObj?.top ?? point.y,
                absolutePositioned: true
              })
            } else if (movingArea === 'outline') {
              let targetItem: fabric.Object
              const plugin = imagePlugin
              let gap = width
              if (accessory.keyholePosition === 'inside') {
                gap = -gap / 2
              } else {
                gap = gap / 3
              }
              const hasAlpha =
                innerItem instanceof fabric.Path || plugin.tellHasAlpha(innerItem.getElement())
              if (hasAlpha) {
                if (accessory.keyholePosition === 'outside') {
                  const sized = new fabric.Path(outline.path, {
                    id: uuid(),
                    top: 0,
                    left: 0,
                    originX: 'center',
                    originY: 'center',
                    stroke: 'white',
                    fill: 'white'
                  })
                  targetItem = (await plugin.objAsImage(sized as any, gap, 1)) as any
                } else {
                  const cloneImage = async (): Promise<unknown> => {
                    return new Promise((resolve) => {
                      innerPath.clone((clone: fabric.Image) => {
                        clone.set({
                          stroke: 'blue',
                          stokeWidth: 0,
                          top: 0,
                          left: 0,
                          originX: 'center',
                          originY: 'center',
                          id: uuid()
                        })
                        resolve(clone as any)
                      })
                    })
                  }
                  targetItem = (await cloneImage()) as any
                }
              } else {
                const scaleY = (outline.height! * outline.scaleY! + gap) / outline.height!
                const scaleX = (outline.width! * outline.scaleX! + gap) / outline.width!
                const cloneImage = async (): Promise<unknown> => {
                  return new Promise((resolve) => {
                    outline.clone((clone: fabric.Image) => {
                      clone.set({
                        stroke: 'blue',
                        stokeWidth: 0,
                        top: 0,
                        left: 0,
                        originX: 'center',
                        originY: 'center',
                        scaleX: scaleX,
                        scaleY: scaleY,
                        id: uuid()
                      })
                      resolve(clone as any)
                    })
                  })
                }
                targetItem = (await cloneImage()) as any
              }

              movingPath = await imagePlugin.getObjectPath(targetItem)
              movingPath?.setOptions({
                id: uuid(),
                fill: 'transparent',
                stroke: 'blue',
                strokeWidth: 2,
                originX: 'center',
                originY: 'center',
                left: 0,
                top: 0,
                absolutePositioned: true
              })
            }
            //currentCanvas.value.add(movingPath as any);
          }

          if (movingArea === 'inner') {
            item.clipPath = outline
          } else {
            item.movingPath = movingPath
          }
          /// stick together accessory and movingPath
          this.bindObject(item)

          item.setCoords()

          resolve(item)
        })
      } catch (e) {
        console.error(e)
        reject(e)
      }
    })
  }

  bindObject(obj: fabric.Object): void {
    console.log('bindObject', obj)
    if (!obj || !obj.accessory) return

    if (obj.accessory.movingArea === 'inner') {
      console.log('bindObject within inner')
      this._canvas.on('object:moving', (e) => {
        if (e.target.id === obj.id) {
          const workspace = this._getWorkspace()
          if (!workspace) return
          
          const containerBounds = workspace.getBoundingRect(true)
          const objBounds = obj.getBoundingRect(true)

          // 왼쪽 경계 체크
          if (objBounds.left < containerBounds.left) {
            obj.left += containerBounds.left - objBounds.left
          }

          // 위쪽 경계 체크
          if (objBounds.top < containerBounds.top) {
            obj.top += containerBounds.top - objBounds.top
          }

          // 오른쪽 경계 체크
          if (objBounds.left + objBounds.width > containerBounds.left + containerBounds.width) {
            obj.left -=
              objBounds.left + objBounds.width - (containerBounds.left + containerBounds.width)
          }

          // 아래쪽 경계 체크
          if (objBounds.top + objBounds.height > containerBounds.top + containerBounds.height) {
            obj.top -=
              objBounds.top + objBounds.height - (containerBounds.top + containerBounds.height)
          }

          obj.setCoords()
        }
      })
    } else {
      // movingPath가 없거나 path가 없는 경우 안전하게 처리
      if (!obj.movingPath || !obj.movingPath.path) {
        console.warn('movingPath가 없습니다. 바인딩을 건너뜁니다.', obj.id)
        return
      }

      try {
        const pathPoints = this.convertAllPathToXY(obj.movingPath)
        if (pathPoints.length === 0) {
          console.warn('pathPoints가 비어있습니다. 바인딩을 건너뜁니다.', obj.id)
          return
        }
        
        // 더 엄격한 숫자 유효성 검사
        const isValidNumber = (value: any): value is number => {
          return typeof value === 'number' && !isNaN(value) && isFinite(value)
        }
        
        // pathPoints 배열의 각 점들이 유효한지 확인
        const validPoints = pathPoints.filter(point => isValidNumber(point.x) && isValidNumber(point.y))
        console.log('valid points count:', validPoints.length, 'total points:', pathPoints.length)
        
        if (validPoints.length === 0) {
          console.warn('유효한 pathPoints가 없습니다.')
          return
        }

        /// 최초의 가까운곳으로 이동 - 현재 위치가 유효한 경우에만
        console.log('obj position check:', obj.left, obj.top, typeof obj.left, typeof obj.top, isNaN(obj.left), isNaN(obj.top))
        
        if (isValidNumber(obj.left) && isValidNumber(obj.top)) {
          // 유효한 점들만 사용하여 가장 가까운 점 찾기
          const firstClosestPoint = this.findClosestPoint(validPoints, obj.left, obj.top)

          if (isValidNumber(firstClosestPoint.x) && isValidNumber(firstClosestPoint.y)) {
            obj.set({
              left: firstClosestPoint.x,
              top: firstClosestPoint.y
            })

            obj.setCoords()
          } else {
            console.warn('closestPoint가 유효하지 않습니다:', firstClosestPoint)
          }
        } else {
          // left, top이 NaN이거나 undefined인 경우 기본값 설정
          console.warn('객체 위치가 유효하지 않습니다. 기본 위치로 설정합니다.', obj.id, obj.left, obj.top)
          
          // validPoints의 첫 번째 점을 기본 위치로 사용
          if (validPoints.length > 0) {
            obj.set({
              left: validPoints[0].x,
              top: validPoints[0].y
            })
            obj.setCoords()
          }
        }

        this._canvas.on('object:moving', (e) => {
          if (e.target.id === obj.id && isValidNumber(e.target.left) && isValidNumber(e.target.top)) {
            /// 가까운곳으로 이동
            const closestPoint = this.findClosestPoint(
              validPoints,
              e.target.left,
              e.target.top
            )

            // closestPoint도 유효한지 확인
            if (isValidNumber(closestPoint.x) && isValidNumber(closestPoint.y)) {
              obj.set({
                left: closestPoint.x,
                top: closestPoint.y
              })

              obj.setCoords()
            }
          }
        })
      } catch (error) {
        console.error('bindObject 처리 중 오류:', error, obj.id)
        // 에러가 발생해도 객체를 제거하지 않고 계속 진행
      }
    }
  }

  drawMergedWorkspace = async () => {
    const workspace = this._getWorkspace()
    const accessoryObj = this._canvas.getObjects().find((obj) => obj.id === 'accessory')
    const group: fabric.Object = await this.getWorkspaceWithAc(workspace, accessoryObj)

    if (!group) {
      console.error('No group')
      return
    }

    const paper = await getPaper()
    paper.setup(new paper.Size(1, 1))
    paper.view.autoUpdate = false

    const wcPath = this.svgPathArrayToPaperPath(workspace as fabric.Path, paper)
    let acPath = new paper.Path()
    const acHeight = (group.height! * group.scaleY!) / 2
    const acWidth = accessoryObj.width! * accessoryObj.scaleX!

    if (accessoryObj.accessory.movingArea === 'bottomLine') {
      acPath.moveTo([0, 0])
      acPath.lineTo([0, acHeight])
      acPath.lineTo([acWidth, acHeight])
      acPath.lineTo([acWidth, 0])
      acPath.closePath()
    } else if (accessoryObj.accessory.movingArea === 'outline') {
      acPath = new paper.Path.Circle({
        center: [accessoryObj.accessory.size.width / 2, accessoryObj.accessory.size.height / 2],
        radius: accessoryObj.accessory.size.width / 2
      })
    }

    const outlineBound = workspace!.getBoundingRect(true, true)
    const acBound = accessoryObj.getBoundingRect(true, true)
    const centerX = acBound.left - outlineBound.left
    let centerY = acBound.top - outlineBound.top - acHeight + acBound.height

    if (accessoryObj.accessory.movingArea === 'outline') {
      centerY = acBound.top - outlineBound.top
      console.log(outlineBound, centerY)
    }

    acPath.translate([centerX, centerY])

    acPath.strokeColor = new paper.Color('black')
    wcPath.strokeColor = new paper.Color('black')
    acPath.strokeWidth = 1
    wcPath.strokeWidth = 1

    const centerOf = group.getCenterPoint()

    if (!workspace) {
      console.error('No workspace')
      return
    }

    const merged = wcPath.unite(acPath)

    /// union two items
    const mergedWorkspace = new fabric.Path(merged.pathData, {
      id: 'mergedWorkspace',
      top: centerOf.y,
      left: centerOf.x,
      originX: 'center',
      originY: 'center',
      width: group.width,
      height: group.height,
      fill: 'white',
      stroke: 'black',
      strokeWidth: 1,
      strokeUniform: true,
      absolutePositioned: true,
      selectable: false,
      hasControls: false,
      evented: false,
      editable: false,
      extensionType: 'clipping'
    })

    // remove old workspace
    const prev = this._canvas.getObjects().find((obj) => obj.id === 'mergedWorkspace')
    prev && this._canvas.remove(prev)

    this._canvas.add(mergedWorkspace)

    mergedWorkspace.sendToBack()
    workspace.sendToBack()
  }

  afterLoad(...args: any[]): Promise<void> {
    return new Promise((resolve) => {
      const accessoryObjects = this._canvas.getObjects().filter((obj) => obj.accessory)

      if (accessoryObjects.length > 0) {
        console.log('has accessoryObjects. start binding')
        accessoryObjects.forEach((obj) => {
          this.bindObject(obj)
        })
      }

      // lid 재적용: 저장된 캔버스를 불러올 때 clipPath를 다시 구성
      const lid = this._canvas
        .getObjects()
        .find((o: fabric.Object) => (o as any).extensionType === 'lid') as fabric.Object | undefined
      if (lid) {
        try {
          this.applyLidClipPath(lid)
        } catch (e) {
          console.warn('failed to re-apply lid clipPath on load', e)
        }
      }

      // 좌표 재계산 후 즉시 렌더 보장
      this._canvas.getObjects().forEach((obj) => obj.setCoords())
      this._canvas.requestRenderAll()

      resolve(...args)
    })
  }

  afterSave(...args: any[]): Promise<void> {
    return new Promise((resolve) => {
      // 저장 후 악세사리 객체들의 바인딩을 다시 설정
      console.log('afterSave: accessory plugin')
      const accessoryObjects = this._canvas.getObjects().filter((obj) => obj.accessory)

      if (accessoryObjects.length > 0) {
        console.log('afterSave: rebinding accessory objects')

        accessoryObjects.forEach((obj) => {
          this.bindObject(obj)
        })
      } else {
        console.log('no accessory objects')
      }

      resolve(...args)
    })
  }

  mounted(): Promise<void> {
    console.log(`mounted material plugin`)
    this._canvas.on('mouse:down', this.startDrag)
    this._canvas.on('mouse:up', this.endDrag)
    return super.mounted()
  }

  destroyed(): Promise<void> {
    this._canvas.off('mouse:down', this.startDrag)
    this._canvas.off('mouse:up', this.endDrag)
    return super.destroyed()
  }

  private startDrag = (e: fabric.IEvent) => {
    if (e.target && e.target.id === 'accessory') {
      console.log('start dragging')
      e.target.dragging = true
    }
  }

  private endDrag = () => {
    const accessoryObj = this._canvas.getObjects().find((obj) => obj.id === 'accessory')

    if (accessoryObj && accessoryObj.dragging) {
      this.drawMergedWorkspace().then(() => {
        accessoryObj.dragging = false
      })
    }
  }

  private getWorkspaceWithAc = async (
    workspace: fabric.Object,
    accessoryObj: fabric.Object
  ): Promise<fabric.Group> => {
    return new Promise((resolve, reject) => {
      try {
        workspace.clone((outline: fabric.Object) => {
          outline.set({
            fill: 'white'
          })

          if (!accessoryObj || !accessoryObj.accessory) {
            reject('No accessory')
            return
          }

          accessoryObj.clone((ac: fabric.Object) => {
            const groupItems = [outline]
            if (accessoryObj.accessory.movingArea === 'bottomLine') {
              // path 데이터를 치환
              const acRect = ac.getBoundingRect(true, true)

              const col = new fabric.Rect({
                id: uuid(),
                left: acRect.left + 0.5,
                top: acRect.top + acRect.height,
                width: acRect.width,
                height: (outline.height! * outline.scaleY!) / 2 + acRect.height,
                scaleX: 1,
                scaleY: 1,
                fill: 'white',
                stroke: 'blue',
                strokeWidth: 0,
                originX: 'left',
                originY: 'bottom'
              })

              groupItems.push(col)
            } else {
              groupItems.push(ac)
            }

            const group = new fabric.Group(groupItems)
            resolve(group)
          })
        })
      } catch (e) {
        reject(e)
      }
    })
  }

  private svgPathArrayToPaperPath = (pathObj: fabric.Path, paper: paper.PaperScope): paper.PathItem => {
    // Paper.js Path 객체 생성
    const paperPath = new paper.Path()
    const scaleY = pathObj.scaleY!
    const scaleX = pathObj.scaleX!

    const parsed = pathObj.path.map((path: fabric.Point) => {
      return path.toString()
    })

    parsed.forEach((command) => {
      const type = command.charAt(0)
      const args = command
        .slice(2)
        .trim()
        .split(/[\s,]+/)
        .map(Number)

      switch (type) {
        case 'M': // Move to
          paperPath.moveTo([args[0] * scaleX, args[1] * scaleY])
          break
        case 'L': // Line to
          paperPath.lineTo([args[0] * scaleX, args[1] * scaleY])
          break
        case 'C': // Cubic Bezier curve
          paperPath.cubicCurveTo(
            [args[0] * scaleX, args[1] * scaleY],
            [args[2] * scaleX, args[3] * scaleY],
            [args[4] * scaleX, args[5] * scaleY]
          )
          break
        case 'Q': // Quadratic Bezier curve
          paperPath.quadraticCurveTo(
            [args[0] * scaleX, args[1] * scaleY],
            [args[2] * scaleX, args[3] * scaleY]
          )
          break
        case 'A': // Arc to
          // Paper.js does not directly support arc, need to convert it
          // For simplicity, this example does not handle 'A' command.
          // You may need to convert arc to cubic Bezier curves manually.
          break
        case 'Z': // Close path
          paperPath.closePath()
          break
        default:
          console.warn(`Unsupported SVG command: ${type}`)
          break
      }
    })

    return paperPath
  }

  private convertAllPathToXY = (
    path: fabric.Path
  ): {
    x: number
    y: number
  }[] => {
    const points: { x: number; y: number }[] = []
    const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    if (!path.path) return []

    const pathString = this.pathArrayToString(path.path)

    pathElement.setAttribute('d', pathString)
    const length = pathElement.getTotalLength()

    // path 속성들이 유효한지 확인
    const pathWidth = path.width || 0
    const pathHeight = path.height || 0
    const pathScaleX = path.scaleX || 1
    const pathScaleY = path.scaleY || 1

    for (let i = 0; i < length; i++) {
      const point = pathElement.getPointAtLength(i)
      
      const calculatedPoint = {
        x: point.x - (pathWidth * pathScaleX) / 2,
        y: point.y - (pathHeight * pathScaleY) / 2
      }
      
      points.push(calculatedPoint)
    }

    return points
  }

  // 경로 상의 가장 가까운 점 찾기
  private findClosestPoint = (
    points: { x: number; y: number }[],
    x: number,
    y: number
  ): {
    x: number
    y: number
  } => {
    let closestPoint = points[0]
    let minDistance = Infinity

    points.forEach((point) => {
      const distance = Math.sqrt((point.x - x) ** 2 + (point.y - y) ** 2)
      if (distance < minDistance) {
        minDistance = distance
        closestPoint = point
      }
    })

    return closestPoint
  }

  private pathArrayToString = (pathArray: any[]): string => {
    return pathArray.map((segment) => segment.join(' ')).join(' ')
  }

  // 객체의 상단 중앙 좌표 계산 함수
  private getPointByPosition(
    object: fabric.Object,
    position: AccessoryPosition
  ): { x: number; y: number } {
    const boundingRect = object.getCenterPoint()
    const { x, y } = boundingRect
    let pX: number, pY: number
    if (position === 'topCenter') {
      pX = x
      pY = y - (object.height! * object.scaleY!) / 2
    } else if (position === 'center') {
      pX = x
      pY = y
    } else if (position === 'bottomCenter') {
      pX = x
      pY = y + (object.height! * object.scaleY!) / 2
    } else {
      throw new Error('Not Supported Position')
    }

    return { x: pX, y: pY }
  }

  // lid용 clipPath 계산 및 적용
  public applyLidClipPath = (currentShape?: fabric.Object): void => {
    const canvas = this._canvas

    // 대상 lid 도형 탐색
    const lidShape =
      currentShape ||
      (canvas
        .getObjects()
        .find((o: fabric.Object) => (o as any).extensionType === 'lid') as fabric.Object | undefined)

    if (!lidShape) {
      console.warn('applyLidClipPath: no lid shape found')
      return
    }

    // template-background 탐색
    const templateBackground = canvas
      .getObjects()
      .find((o: fabric.Object) => (o as any).id === 'template-background') as fabric.Object | undefined

    if (!templateBackground) {
      console.warn('applyLidClipPath: template-background not found')
      return
    }

    const clipPath = this.buildLidClipPath(templateBackground, lidShape)
    canvas.clipPath = clipPath
  }

  public clearLidClipPath = (): void => {
    const canvas = this._canvas
    const templateBackground = canvas
      .getObjects()
      .find((o: fabric.Object) => (o as any).id === 'template-background') as fabric.Object | undefined
    if (templateBackground) {
      canvas.clipPath = templateBackground
    } else {
      canvas.clipPath = undefined
    }
  }

  private buildLidClipPath = (templateBackground: fabric.Object, currentShape: fabric.Object): fabric.Path => {
    const bgWidth = (templateBackground.width || 0) * (templateBackground.scaleX || 1)
    const bgHeight = (templateBackground.height || 0) * (templateBackground.scaleY || 1)
    const shapeWidth = (currentShape.width || 0) * (currentShape.scaleX || 1)
    const shapeHeight = (currentShape.height || 0) * (currentShape.scaleY || 1)
    const bgLeft = templateBackground.left || 0
    const bgTop = templateBackground.top || 0

    const isHorizontal = shapeHeight > shapeWidth

    const hw = bgWidth / 2
    const hh = bgHeight / 2

    const baseLength = isHorizontal ? shapeHeight : shapeWidth
    const fallbackBase = Math.min(bgWidth, bgHeight)

    const shortRadiusRatio = isHorizontal ? 0.06 : 0.023

    const shortR = Math.min(
      isHorizontal ? Math.max(0, (baseLength || fallbackBase) * shortRadiusRatio) : shapeHeight,
      hw,
      hh
    )
    const longR = Math.min(
      isHorizontal ? shapeWidth : Math.max(0, (baseLength || fallbackBase) * shortRadiusRatio),
      hw,
      hh
    )

    const k = 0.5522847498307936

    const parts: string[] = []

    if (isHorizontal) {
      parts.push(`M ${-hw + longR} ${-hh}`)
      parts.push(`H ${hw}`)
      parts.push(`V ${hh}`)
      parts.push(`H ${-hw + longR}`)
      parts.push(`C ${-hw + longR * (1 - k)} ${hh} ${-hw} ${hh - shortR * k} ${-hw} ${hh - shortR}`)
      parts.push(`V ${-hh + shortR}`)
      parts.push(`C ${-hw} ${-hh + shortR * k} ${-hw + longR * (1 - k)} ${-hh} ${-hw + longR} ${-hh}`)
    } else {
      parts.push(`M ${-hw + longR} ${-hh}`)
      parts.push(`H ${hw - longR}`)
      parts.push(`C ${hw - longR * (1 - k)} ${-hh} ${hw} ${-hh + shortR * k} ${hw} ${-hh + shortR}`)
      parts.push(`V ${hh}`)
      parts.push(`H ${-hw}`)
      parts.push(`V ${-hh + shortR}`)
      parts.push(`C ${-hw} ${-hh + shortR * k} ${-hw + longR * (1 - k)} ${-hh} ${-hw + longR} ${-hh}`)
    }

    parts.push('Z')

    const pathString = parts.join(' ')
    const clipPath = new fabric.Path(pathString)
    clipPath.set({
      absolutePositioned: true,
      originX: 'center',
      originY: 'center',
      left: bgLeft,
      top: bgTop,
      fill: 'white',
      stroke: undefined,
      strokeWidth: 0
    })

    return clipPath
  }
}

export default AccessoryPlugin
