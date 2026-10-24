// @ts-nocheck
import { fabric } from 'fabric'
import Editor from '../Editor'
import { PluginBase, PluginOption } from '../plugin'
import { v4 as uuid } from 'uuid'
import { UNIT_CONVERSIONS } from '../ruler/constants'
import FontPlugin from './FontPlugin'
import { RenderOptimizer } from '../utils/render'
import { mmToPx } from '../utils'
import { core } from '../utils/canvas'

/**
 * 템플릿 요소 복제 시 보존할 속성 — 직렬화 화이트리스트(core.extendFabricOption) + 런타임 판정 플래그.
 * fabric 5 의 clone() 은 toObject(propertiesToInclude) 기반이라, 목록 없이 부르면 id·extensionType·
 * extension·lockInfo·frameRef·parentLayerId 등 커스텀 속성이 모두 빠진다.
 */
const CLONE_PROPS: string[] = [...core.extendFabricOption, 'isUserAdded']

/** replaceTemplate 선택 인자 */
export interface ReplaceTemplateOptions {
  /** 현재 페이지에 적용된 템플릿의 top-level 객체 id(TemplatePlugin.templateObjectIds). 이 id 의 객체는 템플릿 유래로 제거 */
  currentTemplateIds?: string[]
  /** 옮긴 채움 사진을 새 틀 기하(마스크·배율·위치)에 다시 맞추는 콜백 — 편집기의 틀 채우기 경로를 주입 */
  refitFill?: (fill: fabric.Object, frame: fabric.Object) => unknown
}

interface FillFramePair {
  fill: fabric.Object
  frame: fabric.Object
}

/**
 * SVG 템플릿 관리 플러그인
 * SVG 파일을 로드하고 그룹 분리하여 FabricJS 객체 배열로 변환
 * 사용자가 추가한 요소를 식별하고 템플릿 교체 시 보존하는 기능 포함
 */
class TemplatePlugin extends PluginBase {
  name = 'TemplatePlugin'
  events = ['templateLoaded', 'templateError', 'templateAdded', 'templateSaved', 'templateReplaced']
  hotkeys = []
  cutlineTemplate: fabric.Object | null = null

  // 템플릿 요소 extensionType 목록 (사용자 요소가 아닌 것들)
  private static TEMPLATE_EXTENSION_TYPES = [
    'template-element',
    'printguide',
    'guideline',
    'overlay',
    'outline',
    'background',
    // P1 캘린더(2026-10-17): 날짜 그리드는 템플릿이 배치하는 요소 — 템플릿 교체 시 함께 교체되고
    // isUserAdded=false 로 재오픈 시 유지된다(CalendarPlugin.rehydrate 가 내용만 다시 그림).
    'calendar-grid'
  ]

  // 템플릿 요소 ID 패턴
  private static TEMPLATE_ELEMENT_IDS = [
    'workspace',
    'template-background',
    'page-outline',
    'template-outline',
    'cut-border',
    'safe-zone-border',
    'cutline-template',
    'center-guideline-h',
    'center-guideline-v',
    // P1 캘린더 오버레이 규약(2026-10-17): 링 바인딩·재단 가이드 PNG 는 화면 전용(printExclude/excludeFromExport)
    'ring-overlay',
    'cut-guide'
  ]

  constructor(canvas: fabric.Canvas, editor: Editor, options: PluginOption) {
    super(canvas, editor, options)

    // 객체 추가 시 사용자 요소 마킹
    this._canvas.on('object:added', this.markUserAddedObject.bind(this))
  }

  /**
   * 새로 추가된 객체가 사용자가 추가한 것인지 판단하고 마킹
   */
  private markUserAddedObject(e: fabric.IEvent) {
    const obj = e.target
    if (!obj) return

    // 이미 isUserAdded가 설정되어 있으면 건너뜀
    if (typeof (obj as any).isUserAdded !== 'undefined') return

    // 템플릿 요소가 아닌 경우 사용자 요소로 마킹
    if (!this.isTemplateElement(obj)) {
      (obj as any).isUserAdded = true
    } else {
      (obj as any).isUserAdded = false
    }
  }

  /**
   * 객체가 템플릿 요소인지 판단
   */
  isTemplateElement(obj: fabric.Object): boolean {
    // extensionType으로 판단
    if (obj.extensionType && TemplatePlugin.TEMPLATE_EXTENSION_TYPES.includes(obj.extensionType)) {
      return true
    }

    // ID로 판단
    if (obj.id && TemplatePlugin.TEMPLATE_ELEMENT_IDS.includes(obj.id)) {
      return true
    }

    // ID 패턴으로 판단 (fixed, floating 등)
    if (obj.id && (
      obj.id.includes('fixed') ||
      obj.id.includes('floating') ||
      obj.id.startsWith('background_rect_')
    )) {
      return true
    }

    // excludeFromExport가 true인 경우 (가이드라인 등)
    if (obj.excludeFromExport) {
      return true
    }

    return false
  }

  /**
   * 사용자가 추가한 요소인지 판단
   */
  isUserAddedElement(obj: fabric.Object): boolean {
    // 명시적으로 isUserAdded가 true인 경우
    if ((obj as any).isUserAdded === true) {
      return true
    }

    // 명시적으로 false가 아니고, 템플릿 요소도 아닌 경우
    if ((obj as any).isUserAdded !== false && !this.isTemplateElement(obj)) {
      return true
    }

    return false
  }

  /**
   * 캔버스에서 모든 사용자 요소 추출
   */
  extractUserElements(): fabric.Object[] {
    const allObjects = this._canvas.getObjects()
    return allObjects.filter(obj => this.isUserAddedElement(obj))
  }

  /**
   * 템플릿 교체 시 사용자 요소 보존
   * @returns 보존된 사용자 요소 배열
   */
  async preserveUserElements(): Promise<fabric.Object[]> {
    const userElements = this.extractUserElements()
    const preservedElements: fabric.Object[] = []

    for (const obj of userElements) {
      // 객체 복제 — 커스텀 속성 보존(CLONE_PROPS). 콜백 안 예외는 reject 로 전달해 promise 가 반드시 정착하게 한다.
      const cloned = await new Promise<fabric.Object>((resolve, reject) => {
        obj.clone((clonedObj: fabric.Object) => {
          try {
            const target = clonedObj as any
            // 사용자 요소 마킹 유지
            target.isUserAdded = true
            // 원본 위치 정보 저장
            target.originalPosition = {
              left: obj.left,
              top: obj.top,
              scaleX: obj.scaleX,
              scaleY: obj.scaleY,
              angle: obj.angle
            }
            resolve(clonedObj)
          } catch (error) {
            reject(error)
          }
        }, CLONE_PROPS)
      })
      preservedElements.push(cloned)
    }

    return preservedElements
  }

  /**
   * 보존된 사용자 요소를 캔버스에 복원
   * @param preservedElements 보존된 요소 배열
   */
  async restoreUserElements(preservedElements: fabric.Object[]): Promise<void> {
    for (const obj of preservedElements) {
      // 원본 위치 정보로 복원
      const originalPosition = (obj as any).originalPosition
      if (originalPosition) {
        obj.set({
          left: originalPosition.left,
          top: originalPosition.top,
          scaleX: originalPosition.scaleX,
          scaleY: originalPosition.scaleY,
          angle: originalPosition.angle
        })
        delete (obj as any).originalPosition
      }

      obj.setCoords()
      this._canvas.add(obj)
    }

    this._canvas.requestRenderAll()
  }

  /**
   * canvasData objects 의 top-level id 목록(workspace 제외) — replaceTemplate 의 currentTemplateIds 입력용.
   * 편집기는 현재 페이지에 적용된 템플릿의 canvasData.objects 로 만들어 넘긴다.
   */
  static templateObjectIds(objects: unknown): string[] {
    if (!Array.isArray(objects)) return []
    const ids: string[] = []
    for (const obj of objects) {
      const id = obj && typeof obj === 'object' ? (obj as { id?: unknown }).id : undefined
      if (typeof id === 'string' && id && id !== 'workspace' && !ids.includes(id)) ids.push(id)
    }
    return ids
  }

  /**
   * 템플릿 교체 (사용자 요소 보존 포함)
   *
   * - 배열 입력 = 편집기 canvasData 의 objects(enliven 결과). 서버 세션 교체와 같은 결과가 되도록
   *   새 템플릿 객체를 그대로(id·type·커스텀 속성 유지) 추가한다. 새 템플릿의 workspace 는 건너뛰고
   *   현재 workspace 를 유지한다. SVG 평탄화(addTemplateToCanvas)는 거치지 않는다.
   * - 단일 그룹/객체 입력 = 기존 SVG 평탄화 경로(addTemplateToCanvas) 유지.
   * - 사용자 요소는 복제하지 않고 원본을 캔버스에 남긴 뒤 새 템플릿 위로 다시 쌓는다(1벌만 유지).
   * - 템플릿 유래 판정: isUserAdded 표시(저장본에는 남지 않음) 외에, 새 템플릿이 같은 id 로 다시 공급하는 객체와
   *   options.currentTemplateIds(현재 페이지 템플릿의 top-level id)에 든 객체를 템플릿 요소로 보고 제거한다.
   * - 채움 사진(extensionType 'fillImage')은 항상 사용자 콘텐츠로 보존한다. 걸려 있던 틀이 제거되면
   *   새 템플릿의 같은 id 틀 → 없으면 순서 짝(같은 id 짝이 없는 옛 틀 k번째 ↔ 같은 id 짝이 없는 새 틀 k번째)으로
   *   옮기고(frameRef·parentLayerId 갱신, 사진 id 유지, 틀 바로 아래로), options.refitFill 로 새 틀 기하에 다시 맞춘다.
   *   짝이 없으면 제자리에 남긴다. 옮긴 틀에 새 템플릿이 채워 둔 견본 사진은 추가하지 않는다(한 틀에 사진 1장).
   * @param newTemplate 새 템플릿 데이터
   * @param options currentTemplateIds·refitFill (모두 선택 — 없으면 종전 판정)
   */
  async replaceTemplate(
    newTemplate: fabric.Group | fabric.Object | fabric.Object[],
    options: ReplaceTemplateOptions = {}
  ): Promise<void> {
    this._canvas.offHistory()

    try {
      const isObjectList = Array.isArray(newTemplate)
      const templateObjects = isObjectList ? this.validateTemplateObjects(newTemplate) : []
      const incomingIds = new Set(TemplatePlugin.templateObjectIds(templateObjects))
      const currentIds = new Set(
        Array.isArray(options.currentTemplateIds)
          ? options.currentTemplateIds.filter((id) => typeof id === 'string' && id && id !== 'workspace')
          : []
      )

      // 1. 사용자 요소 식별
      const allObjects = this._canvas.getObjects()
      const userElements = allObjects.filter((obj) => this.isPreservedOnReplace(obj, incomingIds, currentIds))
      console.log(`📦 보존된 사용자 요소: ${userElements.length}개`)

      // 2. 기존 템플릿 요소 제거 (사용자 요소·workspace 제외)
      const removed = allObjects.filter((obj) => obj.id !== 'workspace' && !userElements.includes(obj))
      removed.forEach((obj) => this._canvas.remove(obj))

      // 3. 새 템플릿 로드
      if (isObjectList) {
        const additions = templateObjects.filter((obj) => obj.id !== 'workspace')
        const pairs = this.pairFillsWithNewFrames(userElements, removed, additions)
        const finalAdditions = this.relinkFills(pairs, userElements, additions)
        await this.addTemplateObjects(finalAdditions, userElements, pairs, options.refitFill)
      } else {
        await this.addTemplateToCanvas(newTemplate)
        // 4. 사용자 요소를 원래 순서대로 새 템플릿 위로
        userElements.forEach((obj) => obj.bringToFront())
      }
      this._canvas.requestRenderAll()
      console.log(`✅ 사용자 요소 복원 완료: ${userElements.length}개`)

      // 5. 이벤트 발생
      this._editor.emit('templateReplaced', { preservedCount: userElements.length })

    } finally {
      this._canvas.onHistory()
    }
  }

  /** 교체 시 남길 객체인지 — 채움 사진은 항상 보존, 템플릿 id 목록(새·현재)에 든 객체는 템플릿 유래 */
  private isPreservedOnReplace(obj: fabric.Object, incomingIds: Set<string>, currentIds: Set<string>): boolean {
    if (obj.id === 'workspace') return false
    if (obj.extensionType === 'fillImage') return true
    if (obj.id && (incomingIds.has(obj.id) || currentIds.has(obj.id))) return false
    return this.isUserAddedElement(obj)
  }

  /** 제거된 틀에 걸려 있던 채움 사진 ↔ 새 템플릿 틀 짝 — 같은 id 우선, 다음은 같은 id 짝이 없는 틀끼리 순서대로 */
  private pairFillsWithNewFrames(
    preserved: fabric.Object[],
    removed: fabric.Object[],
    additions: fabric.Object[]
  ): FillFramePair[] {
    const parentOf = (o: fabric.Object) => (o as any).parentLayerId ?? (o as any).frameRef
    const removedFrames = removed.filter((o) => o.extensionType === 'frame' && o.id)
    const newFrames = additions.filter((o) => o.extensionType === 'frame' && o.id)
    if (removedFrames.length === 0 || newFrames.length === 0) return []

    const removedFrameIds = new Set(removedFrames.map((f) => f.id))
    const newFrameIds = new Set(newFrames.map((f) => f.id))
    const oldUnmatched = removedFrames.filter((f) => !newFrameIds.has(f.id))
    const newUnmatched = newFrames.filter((f) => !removedFrameIds.has(f.id))

    const claimed = new Set<fabric.Object>()
    const pairs: FillFramePair[] = []
    for (const fill of preserved) {
      if (fill.extensionType !== 'fillImage') continue
      const parentId = parentOf(fill)
      if (!removedFrameIds.has(parentId)) continue
      let target = newFrames.find((f) => f.id === parentId)
      if (!target) {
        const k = oldUnmatched.findIndex((f) => f.id === parentId)
        target = k >= 0 ? newUnmatched[k] : undefined
      }
      if (target && !claimed.has(target)) {
        claimed.add(target)
        pairs.push({ fill, frame: target })
      }
    }
    return pairs
  }

  /**
   * 짝지은 채움 사진을 새 틀에 연결(frameRef·parentLayerId·틀의 fillImage — 사진 id 는 유지)하고,
   * 새 템플릿 객체 중 이미 차지된 틀의 견본 사진·보존 객체와 id 가 겹치는 객체를 뺀 추가 목록을 돌려준다.
   */
  private relinkFills(pairs: FillFramePair[], preserved: fabric.Object[], additions: fabric.Object[]): fabric.Object[] {
    const claimedFrameIds = new Set(pairs.map((p) => p.frame.id))
    const preservedIds = new Set(preserved.map((o) => o.id).filter(Boolean))
    for (const { fill, frame } of pairs) {
      fill.set({ frameRef: frame.id, parentLayerId: frame.id })
      ;(frame as any).fillImage = fill.id
    }
    return additions.filter((obj) => {
      if (obj.id && preservedIds.has(obj.id)) return false
      if (obj.extensionType === 'fillImage') {
        const parentId = (obj as any).parentLayerId ?? (obj as any).frameRef
        if (parentId && claimedFrameIds.has(parentId)) return false
      }
      return true
    })
  }

  /** replaceTemplate 배열 입력 검증 — 캔버스를 건드리기 전에 실패시킨다 */
  private validateTemplateObjects(objects: fabric.Object[]): fabric.Object[] {
    if (objects.length === 0) {
      throw new Error('추가할 객체가 없습니다.')
    }
    const validObjects = objects.filter((obj) => obj && typeof obj.set === 'function')
    if (validObjects.length === 0) {
      throw new Error('유효한 fabric 객체가 없습니다.')
    }
    return validObjects
  }

  /**
   * canvasData 객체를 변환 없이 캔버스에 추가(템플릿 교체용).
   * 새 템플릿이 공급한 객체는 모두 템플릿 요소(isUserAdded=false)로 표시한다 —
   * 템플릿 JSON 에 남은 isUserAdded 값과 무관하게, 다음 교체 때 사용자 요소로 오판되지 않게 한다.
   * 옮긴 채움 사진은 새 틀 바로 아래로 두고 refitFill 로 새 틀 기하에 맞춘다(실패는 경고 후 진행).
   */
  private async addTemplateObjects(
    additions: fabric.Object[],
    userElements: fabric.Object[],
    pairs: FillFramePair[],
    refitFill?: ReplaceTemplateOptions['refitFill']
  ): Promise<void> {
    additions.forEach((obj) => {
      (obj as any).isUserAdded = false
    })

    await this.preloadTemplateFonts(additions)

    RenderOptimizer.batchAdd(this._canvas, additions)
    // 사용자 요소를 원래 순서대로 새 템플릿 위로
    userElements.forEach((obj) => obj.bringToFront())

    for (const { fill, frame } of pairs) {
      const frameIndex = this._canvas.getObjects().indexOf(frame)
      if (frameIndex >= 0) fill.moveTo(frameIndex)
      if (refitFill) {
        try {
          await refitFill(fill, frame)
        } catch (error) {
          console.warn('⚠️ 채움 사진 새 틀 맞춤 실패 (연결만 유지):', frame.id, error)
        }
      }
      fill.setCoords()
    }

    await new Promise<void>((resolve) => {
      this._editor.hooks.get('afterLoad').callAsync('', () => resolve())
    })
  }

  /** 새 템플릿 텍스트(그룹 내부 포함) 폰트 사전 로드 — 폰트별 5초 상한, 실패해도 진행 */
  private async preloadTemplateFonts(objects: fabric.Object[]): Promise<void> {
    const fontPlugin = this._editor.getPlugin<FontPlugin>('FontPlugin')
    if (!fontPlugin) return

    const fonts = new Set<string>()
    const collect = (obj: fabric.Object) => {
      if ((obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') && typeof (obj as any).fontFamily === 'string') {
        fonts.add((obj as any).fontFamily)
      }
      if (obj.type === 'group' && (obj as fabric.Group)._objects) {
        (obj as fabric.Group)._objects.forEach(collect)
      }
    }
    objects.forEach(collect)
    if (fonts.size === 0) return

    await Promise.allSettled(
      Array.from(fonts).map((fontName) =>
        Promise.race([
          fontPlugin.ensureFontLoaded(fontName),
          new Promise((resolve) => setTimeout(resolve, 5000))
        ]).catch((err) => {
          console.warn(`⚠️ 템플릿 폰트 사전 로드 실패 (계속 진행): ${fontName}`, err)
        })
      )
    )
  }

  async readSVGFromFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()

      reader.onload = (event) => {
        const svgString = event.target.result as string
        resolve(svgString)
      }

      reader.onerror = (error) => {
        reject(error)
      }

      // SVG 파일을 텍스트로 읽기
      reader.readAsText(file)
    })
  }

  /**
   * SVG 파일을 로드하여 FabricJS 객체로 변환
   * @param pageGroup SVG 파일 또는 객체 배열
   */
  async addTemplateToCanvas(pageGroup: fabric.Group | fabric.Object | fabric.Object[]) {
    // 입력 데이터 검증 및 정규화
    let fabricGroup: fabric.Group | fabric.Object

    if (Array.isArray(pageGroup)) {
      if (pageGroup.length === 0) {
        throw new Error('추가할 객체가 없습니다.')
      }

      // 배열의 모든 객체가 유효한 fabric 객체인지 확인
      const validObjects = pageGroup.filter((obj) => obj && typeof obj.set === 'function')
      if (validObjects.length === 0) {
        throw new Error('유효한 fabric 객체가 없습니다.')
      }

      console.log(`처리할 객체 수: ${validObjects.length}개`)

      // 여러 객체를 하나의 그룹으로 만들기 (기존 로직 활용)
      fabricGroup = new fabric.Group(validObjects, {
        id: `template_group_${Date.now()}`,
        left: 0,
        top: 0,
        originX: 'center',
        originY: 'center'
      })
    } else {
      // 단일 객체인 경우
      if (!pageGroup || typeof pageGroup.set !== 'function') {
        console.error('유효하지 않은 fabric 객체:', pageGroup)
        throw new Error('유효하지 않은 fabric 객체입니다.')
      }

      if (pageGroup.type === 'group' && pageGroup._objects?.length === 0) {
        throw new Error('추가할 객체가 없습니다.')
      }

      fabricGroup = pageGroup
    }

    this._canvas.offHistory()

    // 워크스페이스 객체 가져오기
    const workspace = this._getWorkspace()
    if (!workspace) {
      throw new Error('워크스페이스를 찾을 수 없습니다.')
    }

    const workspaceWidth = workspace.width! * workspace.scaleX!
    const workspaceHeight = workspace.height! * workspace.scaleY!
    const workspaceCenter = workspace.getCenterPoint()

    console.log('처리할 fabricGroup:', fabricGroup)

    // 그룹의 객체들 가져오기
    const groupObjects = fabricGroup.type === 'group' ? fabricGroup._objects : [fabricGroup]

    fabricGroup.set({
      evented: false,
      enableRetinaScaling: true,  // 고해상도 디스플레이에서 선명한 렌더링
      clipPath: null,
      top: workspaceCenter.y,
      left: workspaceCenter.x,
      originX: 'center',
      originY: 'center'
    })

    const addedObjects = await this.ungroupItems(fabricGroup, groupObjects, {
      width: workspaceWidth,
      height: workspaceHeight
    }) // 첫 번째 그룹은 flat하게 처리

    // 모든 객체 선택
    if (addedObjects.length > 0) {
      this._canvas.setActiveObject(
        new fabric.ActiveSelection(addedObjects, { canvas: this._canvas })
      )
    }

    // 대량 객체 추가 최적화
    RenderOptimizer.batchAdd(this._canvas, addedObjects)
    this._canvas.discardActiveObject()

    const templateBackground = this._canvas
      .getObjects()
      .find((obj: fabric.Object) => obj.id === 'template-background')

    const workspaceObj = this._getWorkspace()
    templateBackground?.sendToBack()

    workspaceObj?.sendToBack()
    if (templateBackground) {
      const renderType = (this._options as any)?.renderType || (this._canvas as any)?.renderType
      const isNoBounded = renderType === 'noBounded'
      const isEnvelope = renderType === 'envelope'

      if (!isNoBounded && !isEnvelope) {
        // 작업사이즈에 맞춰 다시 리사이즈
        templateBackground.set({
          scaleX: workspaceWidth / templateBackground.width!,
          scaleY: workspaceHeight / templateBackground.height!,
          dirty: true
        })
      } else if (isEnvelope) {
        // 봉투 타입의 경우 출력사이즈 (this._options.envelopeOption.size)에 맞춰 리사이즈
        const dpi = (this._options as any)?.dpi || UNIT_CONVERSIONS.DEFAULT_DPI;
        (templateBackground as any).preventAutoResize = true
        const { width, height } = this._options.envelopeOption.size
        const backgroundBound = templateBackground.getBoundingRect(true, true)
        workspaceObj?.set({
          left: backgroundBound!.width - mmToPx(width, dpi),
          top: backgroundBound!.height - mmToPx(height, dpi),
          width: mmToPx(width, dpi)!,
          height: mmToPx(height, dpi)!,
        })
      } else {
        (templateBackground as any).preventAutoResize = true
      }

      if (templateBackground.type === 'group' && templateBackground.getObjects().length > 0) {
        this._canvas.clipPath = templateBackground.getObjects()[templateBackground.getObjects().length - 1]
      } else {
        this._canvas.clipPath = templateBackground
      }

      this._canvas.fill = 'transparent'
      this._canvas.backgroundColor = 'transparent'

      workspaceObj?.set({
        fill: 'transparent',
        backgroundColor: 'transparent',
        dirty: true
      })

      workspaceObj?.setCoords()
      //this._editor.emit('background:size-changed', backgroundWidth, backgroundHeight)
    }

    this._editor.hooks.get('afterLoad').callAsync('', () => {
      this._canvas.requestRenderAll()
      this._canvas.onHistory()
    })
  }

  setCutTemplate = async (svgData: string | File, cutSizePx: number): Promise<fabric.Object> => {
    return new Promise((resolve, reject) => {
      this._canvas.offHistory()

      const processTemplate = async () => {
        try {
          // svgData가 File 객체인 경우 문자열로 변환
          let svgString: string
          if (svgData instanceof File) {
            svgString = await this.readSVGFromFile(svgData)
          } else if (typeof svgData === 'string') {
            svgString = svgData.trim()
          } else {
            reject(new Error('SVG 데이터는 문자열 또는 File 객체여야 합니다.'))
            return
          }

          // 바로 fabric.loadSVGFromString 사용
          fabric.loadSVGFromString(svgString, (objects, options) => {
            if (!objects || objects.length === 0) {
              reject(new Error('SVG 파일을 로드할 수 없습니다.'))
              return
            }
            this.createCutlineTemplate(objects, options, cutSizePx, resolve)
          })
        } catch (error) {
          reject(error)
        }
      }

      processTemplate()
    })
  }

  /**
   * cutline 템플릿 생성 (공통 로직)
   */
  private createCutlineTemplate(
    objects: fabric.Object[],
    options: any,
    cutSizePx: number,
    resolve: (value: fabric.Object) => void
  ) {
    // 이전 cutline-template 제거
    const prev = this._canvas
      .getObjects()
      .find((obj: fabric.Object) => obj.id === 'cutline-template')
    if (prev) {
      this.cutlineTemplate = null
      this._canvas.remove(prev)
      console.log('delete previous cutline', prev)
    }

    let svgObject: fabric.Object
    if (this._options.renderType === 'envelope') {
      const redLines = objects.filter((obj) => obj.stroke === "#E4007F")
      svgObject = new fabric.Group([...redLines, ...objects.filter((obj) => obj.stroke !== "#E4007F")], {
        ...options
      })
    } else if (objects.length === 1) {
      svgObject = objects[0]
    }

    if (!svgObject) {
      svgObject = fabric.util.groupSVGElements(objects, {
        ...options
      })
    }

    const scale = this._options.unit === 'mm' ? (this._options.dpi || UNIT_CONVERSIONS.DEFAULT_DPI) / 72 : 1
    const isEnvelope = this._options.renderType === 'envelope'

    svgObject.set({
      originX: 'center',
      originY: 'center',
      left: 0,
      top: 0,
      fill: null,
      selectable: false,
      evented: false,
      hasControls: false,
      lockMovementX: true,
      lockMovementY: true,
      excludeFromExport: true,
      extensionType: 'printguide',
      editable: false,
      scaleX: scale,
      scaleY: scale,
      visible: !isEnvelope  // 봉투 타입인 경우 기본적으로 숨김
    })
    svgObject.id = 'cutline-template'
    this.cutlineTemplate = svgObject
    this._canvas.add(svgObject)
    svgObject.bringToFront()
    this._canvas.onHistory()

    resolve(svgObject)
  }

  afterSave(...args: any[]): Promise<void> {
    return new Promise((r) => {
      r(...args)
    })
  }

  beforeSave(...args): Promise<void> {
    return new Promise((r) => {
      r(...args)
    })
  }

  afterLoad(...args): Promise<void> {
    return new Promise((r) => {
      const allObjects = this._canvas.getObjects()
      allObjects.forEach((obj) => {
        if (obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') {
          if (!obj.hasControls) {
            obj.set({
              hasControls: true,
              lockScalingX: false,
              lockScalingY: false,
              lockUniScaling: false,
            })
          }
        }
      })
      r(...args)
    })
  }

  beforeLoad(...args): Promise<void> {
    return new Promise((r) => {
      r(...args)
    })
  }

  mounted(): Promise<void> {
    return super.mounted()
  }

  async ungroupItems(
    group: fabric.Group | fabric.Object,
    groupObjects: fabric.Object[],
    workspaceSize: { width: number; height: number }
  ): Promise<fabric.Object[]> {
    return new Promise((resolve) => {
      // 비동기 작업을 처리하는 즉시 실행 함수
      (async () => {
        // 그룹이 단일 객체인 경우 그대로 처리
        if (group.type !== 'group') {
          // 단일 객체를 배열로 반환
          resolve([group])
          return
        }

        // 1. 필요한 폰트 목록 추출
        const requiredFonts = new Set<string>()

        groupObjects.forEach((item) => {
          // 텍스트 객체에서 폰트 추출
          if (item.type === 'text' || item.type === 'i-text' || item.type === 'textbox') {
            const fontFamily = (item as any).fontFamily
            if (fontFamily && typeof fontFamily === 'string') {
              requiredFonts.add(fontFamily)
            }
          }

          // 중첩된 그룹 내부의 텍스트 객체도 확인
          if (item.type === 'group' && (item as fabric.Group)._objects) {
            const nestedObjects = (item as fabric.Group)._objects
            nestedObjects.forEach((nestedItem) => {
              if (
                nestedItem.type === 'text' ||
                nestedItem.type === 'i-text' ||
                nestedItem.type === 'textbox'
              ) {
                const fontFamily = (nestedItem as any).fontFamily
                if (fontFamily && typeof fontFamily === 'string') {
                  requiredFonts.add(fontFamily)
                }
              }
            })
          }
        })

        console.log('📋 템플릿에 필요한 폰트 목록:', Array.from(requiredFonts))

        // 2. FontPlugin을 사용해 필요한 폰트 미리 로드
        if (requiredFonts.size > 0) {
          const fontPlugin = this._editor.getPlugin<FontPlugin>('FontPlugin')

          if (fontPlugin) {
            const fontLoadPromises = Array.from(requiredFonts).map((fontName) => {
              console.log(`🔄 템플릿 폰트 사전 로드 시작: ${fontName}`)
              return fontPlugin
                .applyFont(fontName, null)
                .then(() => {
                  console.log(`✅ 템플릿 폰트 사전 로드 완료: ${fontName}`)
                })
                .catch((err) => {
                  console.warn(`⚠️ 템플릿 폰트 사전 로드 실패 (계속 진행): ${fontName}`, err)
                })
            })

            // 모든 폰트 로드 대기
            await Promise.all(fontLoadPromises)
            console.log('✅ 템플릿의 모든 폰트 사전 로드 완료')
          }
        }

        // outline 객체를 제외한 실제 렌더링 객체 개수 확인

        // 그룹의 원래 값들 저장 (원래 템플릿 배경으로 계산)
        const mainItem = groupObjects[0]

        if ((groupObjects.length === 1 && (!groupObjects[0].id.includes('default') || this._options.renderType === 'noBounded'))) {
          const centerOf = groupObjects[0].getCenterPoint()
          // 흰색 배경 rect 추가 (기존 로직)
          const backgroundRect = new fabric.Rect({
            id: `background_rect_${Date.now()}`,
            left: centerOf.x,
            top: centerOf.y,
            originX: 'center',
            originY: 'center',
            width: workspaceSize.width,
            height: workspaceSize.height,
            fill: 'white',
            stroke: null
          })

          // 배경 rect를 0번째 위치에 삽입
          groupObjects.unshift(backgroundRect)
          console.log('단일 객체에 흰색 배경 rect 추가됨')
        }

        const groupWidth = mainItem.width! * mainItem.scaleX!
        const groupHeight = mainItem.height! * mainItem.scaleY!


        const groupCenter = mainItem.getCenterPoint()
        const groupLeft = group.left! + groupCenter.x
        const groupTop = group.top! + groupCenter.y

        // 워크스페이스 크기
        const workspaceWidth = workspaceSize.width
        const workspaceHeight = workspaceSize.height

        // 스케일 계산 (워크스페이스 너비에 맞춤)
        const scaleX = workspaceWidth / groupWidth
        const scaleY = workspaceHeight / groupHeight
        let scale = Math.min(scaleX, scaleY)

        // envelope 타입의 경우 우측 하단 배치를 위한 오프셋 계산
        const offsetX = 0
        const offsetY = 0

        // 봉투의 경우 envelopeOption에 따라 스케일 및 오프셋 계산
        if (this._options.renderType === 'envelope') {
          const envelopeOption = (this._options as any)?.envelopeOption

          // envelopeOption이 있는 경우
          const { direction, size } = envelopeOption

          console.log('봉투 옵션 적용:', envelopeOption)
          const dpi = this._options.dpi || UNIT_CONVERSIONS.DEFAULT_DPI
          const totalWidth = mmToPx(size.width, dpi)
          const totalHeight = mmToPx(size.height, dpi)

          if (envelopeOption) {
            // direction에 따라 스케일 계산
            if (direction === 'left' || direction === 'right') {
              // 가로 방향: 높이에 맞춤
              scale = totalHeight / groupHeight
            } else {
              // 세로 방향(top/bottom): 너비에 맞춤
              scale = totalWidth / groupWidth
            }
          }
        }

        // 그룹 객체들을 순서대로 처리 (flat화)
        const addedObjects: fabric.Object[] = []
        let pendingClones = groupObjects.length

        // 각 객체를 순서대로 처리하여 flat하게 만들기
        groupObjects.forEach((item, index) => {
          item.clone(async (clonedItem: fabric.Object) => {
            // 원본 객체의 그룹 정보 보존
            const originalGroupId = (item as any).groupId
            const originalGroupIndex = (item as any).groupIndex

            // 객체 타입 감지
            const objectType = this.determineObjectType(clonedItem)

            // clipPath용 빈 객체는 건너뛰기
            if (objectType === 'clippath') {
              console.log('clipPath용 빈 객체 건너뛰기:', clonedItem)
              pendingClones--
              if (pendingClones === 0) {
                resolve(addedObjects.filter((obj) => obj !== undefined))
              }
              return
            }

            // 고유 ID 설정
            if (index === 0) {
              clonedItem.set({
                id: 'template-background'
              })
            } else {
              // 조건부로 ID 설정: item.id가 특별한 패턴을 가지지 않고, clonedItem.id가 아직 없다면 UUID 할당
              // outline, fixed, floating 등의 ID는 아래의 특정 로직에서 처리됨
              if (!item.id?.match(/outline|fixed|floating/)) {
                if (!clonedItem.id) {
                  // Preserves original ID if it exists and is not special
                  clonedItem.set('id', uuid())
                }
              }
            }

            // 그룹 내 상대적 위치 계산
            const relativeX = item.left! - groupLeft
            const relativeY = item.top! - groupTop

            // 워크스페이스 중앙 기준으로 상대 위치 계산 + envelope 오프셋 적용
            const newLeft = relativeX * scale + offsetX
            const newTop = relativeY * scale + offsetY

            // 공통 속성 설정 (그룹 정보 포함)
            const renderType = (this._options as any)?.renderType
            const isNoBounded = renderType === 'noBounded'
            const isBackground = clonedItem?.id === 'template-background'

            let computedScaleX = (item.scaleX || 1) * scale
            let computedScaleY = (item.scaleY || 1) * scale

            // noBounded의 배경 객체는 DPI를 고려하여 스케일 보정
            if (isNoBounded && isBackground) {
              const currentDpi =
                (this._options as any)?.dpi
              const displayDpi = UNIT_CONVERSIONS.DEFAULT_DPI // 화면 표시는 고정 DPI 사용
              const unit = (this._options as any)?.unit

              // 화면 표시(mm 변환)는 displayDpi(기본 150)를 기준으로 하므로,
              // 실제 작업 DPI와의 비율만큼 스케일을 보정해 일관된 실측(mm) 표시를 유지
              const dpiScale = currentDpi / displayDpi

              if (unit === 'mm') {
                console.log('noBounded 배경 DPI 보정 적용', { currentDpi, displayDpi, dpiScale })
                computedScaleX = dpiScale
                computedScaleY = dpiScale
              } else {
                // px 단위에서는 기존 동작 유지
                console.log('noBounded 배경(px) - 스케일 1 유지')
                computedScaleX = 1
                computedScaleY = 1
              }
            }

            const commonProps = {
              left: newLeft,
              top: newTop,
              scaleX: computedScaleX,
              scaleY: computedScaleY,
              strokeUniform: false,
              fill: clonedItem.fill,
              stroke: clonedItem.stroke,
              // 그룹 정보 보존
              groupId: originalGroupId,
              groupIndex: originalGroupIndex
            }

            // 객체 타입에 따른 추가 속성 설정
            if (objectType === 'text') {
              // 텍스트 객체를 IText로 변환 (편집 기능이 더 잘 작동함)
              const textValue = (clonedItem as any).text || ''
              const fontFamily = (clonedItem as any).fontFamily

              // 변환된 텍스트 객체로 교체
              clonedItem = new fabric.IText(textValue, {
                ...commonProps,
                fontSize: (clonedItem as any).fontSize || 24,
                fontFamily: fontFamily,
                textAlign: (clonedItem as any).textAlign || 'left',
                fontStyle: (clonedItem as any).fontStyle || 'normal',
                fontWeight: (clonedItem as any).fontWeight || 'normal',
                fill: clonedItem.fill || '#000000',
                stroke: clonedItem.stroke,
                strokeWidth: (clonedItem as any).strokeWidth,
                charSpacing: (clonedItem as any).charSpacing,
                lineHeight: (clonedItem as any).lineHeight,
                underline: (clonedItem as any).underline,
                overline: (clonedItem as any).overline,
                linethrough: (clonedItem as any).linethrough,
                // 편집 관련 속성
                editable: true,
                selectable: true,
                // Canvas-Editor 특화 속성
                extensionType: 'text',
                id: clonedItem.id,
                // 텍스트 스케일을 항상 1로 고정하여 fontSize 기준 일관된 크기 유지
                scaleX: 1,
                scaleY: 1,
                // 스케일링 동작 설정
                lockUniScaling: true,
                centeredScaling: false, // 반대편 모서리를 기준으로 스케일링
              })

              // 폰트를 미리 로드했으므로 텍스트 크기 재계산 불필요
              // TextSizeCalculator.recalculateSingleTextSize 호출 제거
              console.log(`📝 텍스트 객체 생성 완료 (폰트 사전 로드됨): ${fontFamily}`)
            } else if (objectType === 'image') {
              // 이미지 객체 속성
              clonedItem.set({
                ...commonProps,
                crossOrigin: 'anonymous'
              })
            } else if (objectType === 'path') {
              // 패스 객체 속성
              clonedItem.set({
                ...commonProps,
                extensionType: 'shape',
                strokeLineCap: (clonedItem as fabric.Path).strokeLineCap || 'round',
                strokeLineJoin: (clonedItem as fabric.Path).strokeLineJoin || 'round'
              })
            } else if (objectType === 'group') {
              // 중첩된 그룹: 그룹으로 유지하고, 공통 속성 적용
              clonedItem.set({
                // clonedItem은 이미 fabric.Group 객체임
                ...commonProps // 크기 조정 및 위치 적용
                // id는 위의 일반 ID 설정 로직 또는 아래의 특수 ID 로직에서 처리됨
              })
            } else {
              // 기본 도형 객체 속성 (rect, circle, polygon 등)
              clonedItem.set({
                ...commonProps
              })

              // 선택. 아이템들의 클립패스 또는 전체
              // clonedItem이 첫 번째 그룹의 직계 자식인 경우에만 clipPath 설정
              if (item?.id === 'outline') {
                clonedItem.set({
                  id: 'page-outline', // ID 일관성 유지
                  selectable: false,
                  evented: false,
                  hasControls: false,
                  lockMovementX: true,
                  lockMovementY: true,
                  editable: false,
                  fill: 'transparent',
                  absolutePositioned: true,
                  extensionType: 'template-element'
                })
                //this._canvas.clipPath = clonedItem;
              }
            }
            if (item?.id?.includes('fixed')) {
              clonedItem.set({
                selectable: false,
                evented: false,
                hasControls: false,
                lockMovementX: true,
                lockMovementY: true,
                editable: false,
                extensionType: 'template-element'
              })
            }
            if (item?.id?.includes('floating')) {
              clonedItem.set({
                evented: true,
                alwaysTop: true,
                extensionType: 'template-element'
              })
            }

            if (clonedItem?.id === 'template-background') {
              clonedItem.set({
                selectable: false,
                evented: false,
                hasControls: false,
                lockMovementX: true,
                lockMovementY: true,
                editable: false,
                extensionType: 'template-element',
                originX: 'center',
                originY: 'center',
                left: 0,
                top: 0
              })

              if (!clonedItem.fill) {
                clonedItem.set({
                  fill: 'white'
                })
              }
            }

            // 중심점 기준으로 위치 설정
            const centerOf = clonedItem.getCenterPoint()
            clonedItem.set({
              left: centerOf.x,
              top: centerOf.y,
              originX: 'center',
              originY: 'center'
            })

            // 원본 객체에 clipPath가 있으면 스케일 조정 후 클론된 객체에도 적용
            // if (item.clipPath) {
            //   console.log('원본 객체 clipPath 발견:', item.id)

            //   // 원본 객체의 clipPath 위치와 크기 조정
            //   const originalClipPath = item.clipPath as fabric.Object

            //   // 클론된 객체에 조정된 clipPath 적용
            //   clonedItem.clipPath = originalClipPath
            //   console.log(`클론된 객체에 clipPath 적용 완료: ${clonedItem.id}`)
            // }

            clonedItem.setCoords()
            addedObjects[index] = clonedItem // 순서 유지를 위해 인덱스 사용

            // 모든 클론 처리가 완료되면 결과를 resolve
            pendingClones--
            if (pendingClones === 0) {
              // 순서가 유지된 배열에서 undefined 제거
              const validObjects = addedObjects.filter((obj) => obj !== undefined)

              resolve(validObjects)
            }
          }, CLONE_PROPS) // 커스텀 속성(id·extensionType 등) 보존 — 원본 id 가 있으면 uuid 를 새로 붙이지 않는다
        })

        // 경우에 따라 groupObjects가 비어있을 수 있으므로, 이 경우 바로 resolve
        if (groupObjects.length === 0) {
          resolve(addedObjects)
        }

      })()
    })
  }

  /**
   * 객체의 타입을 결정하는 헬퍼 메서드
   * @param object fabric 객체
   * @returns 객체 타입 문자열
   */
  private determineObjectType(object: fabric.Object): string {
    // 그룹 객체 확인
    if (object.type === 'group') {
      return 'group'
    }

    // 텍스트 관련 객체 확인
    if (object.type === 'text' || object.type === 'i-text' || object.type === 'textbox') {
      return 'text'
    }

    // 이미지 객체 확인
    if (object.type === 'image') {
      return 'image'
    }

    // 패스 객체 확인 (Adobe Illustrator에서 많이 사용)
    if (object.type === 'path' || object.type === 'path-group') {
      return 'path'
    }

    // SVG 그룹에서 온 특정 텍스트 객체는 때때로 잘못 감지될 수 있음
    // 텍스트 내용이 있는지 추가 확인
    if ('text' in object && (object as any).text) {
      return 'text'
    }

    // Adobe Illustrator에서 생성된 빈 clipPath용 rect 객체 확인
    if (
      object.type === 'rect' &&
      (object.width === 0 || object.height === 0) &&
      !object.fill &&
      !object.stroke
    ) {
      console.warn('clipPath용 빈 rect 객체 감지:', object)
      return 'clippath'
    }

    // 기본 도형 객체들 (rect, circle, ellipse, polygon, polyline 등)
    if (
      object.type === 'rect' ||
      object.type === 'circle' ||
      object.type === 'ellipse' ||
      object.type === 'polygon' ||
      object.type === 'polyline' ||
      object.type === 'triangle'
    ) {
      return 'shape'
    }

    // 기타 객체는 기본적으로 shape로 처리
    return 'shape'
  }
}

export default TemplatePlugin
