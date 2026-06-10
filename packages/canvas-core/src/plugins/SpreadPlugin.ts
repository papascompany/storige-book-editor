/**
 * SpreadPlugin
 *
 * 스프레드 캔버스 모드 플러그인
 * - WorkspacePlugin 위에 레이어링
 * - SpreadLayoutEngine (순수 함수)를 사용하여 레이아웃 계산
 * - Fabric.js 오브젝트 생성/갱신 + 이벤트 핸들링
 */

import { fabric } from 'fabric'
import type { IEvent } from 'fabric/fabric-impl'
import Editor from '../Editor'
import { PluginBase, PluginOption } from '../plugin'
import type {
  SpreadSpec,
  SpreadLayout,
  SpreadRegion,
  SpreadRegionPosition,
  SystemObjectType,
  ObjectAnchor,
  SpreadObjectMeta,
} from '@storige/types'
import {
  computeLayout,
  computeResizedLayout,
  resolveRegionAtX,
  computeObjectReposition,
  resolveRegionRef,
} from '../spread/SpreadLayoutEngine'
import {
  getSpineResizeStrategy,
} from '../spread/SpineResizeStrategy'

// ============================================================================
// Plugin Options
// ============================================================================

interface SpreadPluginOptions extends PluginOption {
  spec: SpreadSpec
}

// ============================================================================
// SpreadPlugin Class
// ============================================================================

class SpreadPlugin extends PluginBase {
  name = 'SpreadPlugin'
  events = ['spineWidthChange', 'spreadLayoutUpdate', 'spreadObjectsOutOfBounds', 'spreadRegionFocus', 'spreadSpineOverflow']
  hotkeys = []

  private currentSpec: SpreadSpec
  private currentLayout: SpreadLayout | null = null
  private isLayoutTransaction = false

  // Fabric 오브젝트 참조
  private guideLines: fabric.Line[] = []
  private dimensionLabels: fabric.Text[] = []

  // 이벤트 핸들러 참조
  private _boundHandleObjectModified: ((e: IEvent) => void) | null = null
  private _boundHandleObjectMoving: ((e: IEvent) => void) | null = null

  // 영역 클릭 포커싱 (PDF 핵심: 영역 클릭 → 해당 영역 포커싱 편집)
  private _boundHandleRegionClick: ((e: IEvent) => void) | null = null
  private _focusedRegionPosition: string | null = null
  private _focusOverlay: fabric.Rect | null = null

  constructor(canvas: fabric.Canvas, editor: Editor, options: SpreadPluginOptions) {
    super(canvas, editor, options)
    this.currentSpec = options.spec
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async mounted(): Promise<void> {
    // init()은 createCanvas의 initPlugins()에서 workspace.init() 이후에 호출됨
    // (가이드/라벨이 workspace 위에 렌더링되어야 하므로)

    // 이벤트 핸들러 등록
    this._boundHandleObjectModified = this.handleObjectModified.bind(this)
    this._boundHandleObjectMoving = this.handleObjectMoving.bind(this)
    this._boundHandleRegionClick = this.handleRegionClick.bind(this)

    this._canvas.on('object:modified', this._boundHandleObjectModified)
    this._canvas.on('object:moving', this._boundHandleObjectMoving)
    this._canvas.on('mouse:down', this._boundHandleRegionClick)

    return super.mounted()
  }

  /**
   * 로드 후처리 — ServicePlugin.loadJSON 의 canvas.clear() 가 책등/영역 가이드·라벨을 함께 제거하므로
   * (IDML/PSD 변환 표지처럼 canvasData 에 가이드 객체가 없으면 영구 소실 → 책등선·영역 라벨 부재)
   * currentLayout 이 있으면 가이드/라벨을 재렌더링한다. init() 은 clearGuides/clearLabels 선행이라
   * 중복 호출에 안전하고, WorkspacePlugin.afterLoad 가 workspace 를 z-최하단에 복원하므로 가이드는
   * 그 위에 정상 노출된다. 일반(비-spread) 편집에는 currentLayout 이 없어 무영향.
   */
  async afterLoad(...args: any[]): Promise<void> {
    if (this.currentLayout) {
      this.init()
    }
    return super.afterLoad(...args)
  }

  async destroyed(): Promise<void> {
    // 이벤트 핸들러 제거
    if (this._boundHandleObjectModified) {
      this._canvas.off('object:modified', this._boundHandleObjectModified)
    }
    if (this._boundHandleObjectMoving) {
      this._canvas.off('object:moving', this._boundHandleObjectMoving)
    }
    if (this._boundHandleRegionClick) {
      this._canvas.off('mouse:down', this._boundHandleRegionClick)
    }

    // 가이드/라벨/포커스 오버레이 제거
    this.clearGuides()
    this.clearLabels()
    this.clearFocusOverlay()

    this._boundHandleObjectModified = null
    this._boundHandleObjectMoving = null
    this._boundHandleRegionClick = null

    return super.destroyed()
  }

  // ============================================================================
  // Coordinate Helpers
  // ============================================================================

  /**
   * 레이아웃 좌표계 → Fabric 캔버스 좌표계 변환을 위한 원점 계산
   *
   * SpreadLayoutEngine은 (0,0)이 콘텐츠 영역 좌상단인 좌표계를 사용.
   * Fabric.js workspace는 originX/Y='center'로 (0,0)이 워크스페이스 중앙.
   * workspace = (totalWidth + cutSize) 크기, 콘텐츠 = totalWidth 크기.
   * 둘 다 중앙 정렬이므로 cutSize가 상쇄되어 콘텐츠 원점 = -totalPx/2.
   */
  private getContentOrigin(): { x: number; y: number } {
    if (!this.currentLayout) return { x: 0, y: 0 }
    return {
      x: -this.currentLayout.totalWidthPx / 2,
      y: -this.currentLayout.totalHeightPx / 2,
    }
  }

  /**
   * Fabric 객체의 바운딩박스를 SpreadLayoutEngine 의 content 좌표계(0..totalWidthPx)로 반환.
   *
   * ⚠️ 좌표계 주의: `getBoundingRect()`(무인자)는 lineCoords = **viewport(줌·팬 적용)** 좌표라
   * 엔진(content 좌표) 비교에 부적합. 반드시 `getBoundingRect(true, true)`(aCoords = scene 좌표,
   * viewport 무관)로 scene 을 얻은 뒤 `- origin` 으로 content 로 변환한다.
   * (AlignPlugin/AccessoryPlugin 도 동일하게 absolute=true 를 사용.)
   */
  private getContentBoundingRect(
    obj: fabric.Object
  ): { left: number; top: number; width: number; height: number } {
    const origin = this.getContentOrigin()
    const br = obj.getBoundingRect(true, true)
    return {
      left: br.left - origin.x,
      top: br.top - origin.y,
      width: br.width,
      height: br.height,
    }
  }

  // ============================================================================
  // Core Methods
  // ============================================================================

  /**
   * 스프레드 초기화
   * spec이 제공되면 갱신, 없으면 생성자에서 설정된 currentSpec 사용
   */
  init(spec?: SpreadSpec): void {
    if (spec) {
      this.currentSpec = spec
    }
    this.currentLayout = computeLayout(this.currentSpec)

    // 기존 가이드/라벨 제거 후 재렌더링 (init 중복 호출 시 중복 방지)
    this.clearGuides()
    this.clearLabels()
    this.renderGuides(this.currentLayout)
    this.renderLabels(this.currentLayout)

    this._editor.emit('spreadLayoutUpdate', { layout: this.currentLayout })
  }

  /**
   * 책등 리사이즈 (Atomic Transaction)
   */
  async resizeSpine(newSpineWidthMm: number): Promise<void> {
    if (!this.currentLayout) {
      console.warn('SpreadPlugin.resizeSpine: currentLayout is null, init() 호출 필요')
      return
    }

    const oldSpineWidthMm = this.currentSpec.spineWidthMm
    console.log(`[SpreadPlugin] resizeSpine: 책등 ${oldSpineWidthMm}mm → ${newSpineWidthMm}mm (변화: ${(newSpineWidthMm - oldSpineWidthMm).toFixed(1)}mm)`)

    if (newSpineWidthMm === oldSpineWidthMm) {
      console.log(`[SpreadPlugin] resizeSpine: 동일한 폭 (${newSpineWidthMm}mm), skip`)
      return
    }

    // 레이아웃 트랜잭션 시작
    this.isLayoutTransaction = true

    try {
      // 1. 렌더링 잠금
      this._canvas.renderOnAddRemove = false

      // 2. 새 레이아웃 계산
      const newLayout = computeResizedLayout(
        this.currentLayout,
        this.currentSpec,
        newSpineWidthMm
      )

      if (newLayout.totalWidthPx === this.currentLayout.totalWidthPx) {
        // 변경 없음
        return
      }

      // 3. WorkspacePlugin.setOptions 호출 (workspace 크기 변경)
      // 주의: size 객체를 완전히 전달해야 함 (shallow merge로 전체 교체되므로)
      const workspacePlugin = this._editor.getPlugin('WorkspacePlugin')
      if (workspacePlugin) {
        await workspacePlugin.setOptions({
          size: {
            width: newLayout.totalWidthMm,
            height: newLayout.totalHeightMm,
            cutSize: this.currentSpec.cutSizeMm,
            safeSize: this.currentSpec.safeSizeMm,
          },
        })
      }

      // 4. 객체 재배치
      this.repositionObjects(this.currentLayout, newLayout)

      // 5. 가이드/라벨 재렌더링
      this.clearGuides()
      this.clearLabels()
      this.renderGuides(newLayout)
      this.renderLabels(newLayout)

      // 6. 레이아웃 갱신
      const oldLayout = this.currentLayout
      this.currentLayout = newLayout
      this.currentSpec = { ...this.currentSpec, spineWidthMm: newSpineWidthMm }

      // 7. 렌더링 잠금 해제
      this._canvas.renderOnAddRemove = true

      // 8. Zoom Auto + 렌더링
      const workspacePlugin2 = this._editor.getPlugin('WorkspacePlugin')
      if (workspacePlugin2) {
        workspacePlugin2.setZoomAuto()
      }
      this._canvas.requestRenderAll()

      // 9. 결과 로그
      const spineRegion = newLayout.regions.find((r) => r.position === 'spine')
      console.log(`[SpreadPlugin] resizeSpine 완료:`)
      console.log(`  - 책등: ${oldSpineWidthMm}mm → ${newSpineWidthMm}mm`)
      console.log(`  - 스프레드 총폭: ${oldLayout.totalWidthMm}mm → ${newLayout.totalWidthMm}mm`)
      console.log(`  - 책등 영역: x=${spineRegion?.x?.toFixed(0)}px, w=${spineRegion?.width?.toFixed(0)}px (${spineRegion?.widthMm}mm)`)

      // 10. 이벤트 발행
      this._editor.emit('spineWidthChange', {
        oldSpineWidth: oldLayout.regions.find((r) => r.position === 'spine')?.widthMm ?? 0,
        newSpineWidth: newSpineWidthMm,
        oldLayout,
        newLayout,
      })

      // 11. 캔버스 밖 객체 경고 (선택 사항)
      this.checkObjectsOutOfBounds(newLayout)

      // 12. 책등 콘텐츠 오버플로우 경고 (책등이 좁아질 때 책등 객체가 표지 침범)
      this.checkSpineOverflow(newLayout)
    } finally {
      // 트랜잭션 종료
      this.isLayoutTransaction = false
    }
  }

  /**
   * 객체 재배치 (resizeSpine 내부 호출)
   */
  private repositionObjects(oldLayout: SpreadLayout, newLayout: SpreadLayout): void {
    const objects = this._canvas.getObjects()
    // 엔진은 content 좌표(0..totalWidthPx)로 계산하므로, fabric(scene, 중앙원점)과의 변환에 사용.
    const origin = this.getContentOrigin()

    for (const obj of objects) {
      // 시스템 객체 skip
      if (obj.meta?.system) {
        continue
      }

      const regionRef = obj.meta?.regionRef ?? null
      const anchor = obj.meta?.anchor ?? { kind: 'canvas', x: 0, y: 0 }

      // 자유 객체: 절대좌표 유지
      if (regionRef === null) {
        // 변경 없음
        continue
      }

      // 영역 객체: 재배치 — content 좌표계로 변환(엔진 입력용).
      const boundingRect = this.getContentBoundingRect(obj)

      if (regionRef === 'spine') {
        // Spine 객체: Strategy 적용
        const oldSpine = oldLayout.regions.find((r) => r.position === 'spine')!
        const newSpine = newLayout.regions.find((r) => r.position === 'spine')!

        const strategy = getSpineResizeStrategy(obj)
        const result = strategy.apply(obj, oldSpine, newSpine)

        // 위치 업데이트 (엔진 출력 content → scene: + origin)
        obj.setPositionByOrigin(
          new fabric.Point(result.x + origin.x, result.y + origin.y),
          'center',
          'center'
        )

        // 스케일 업데이트 (있을 경우)
        if (result.scaleX !== undefined) {
          obj.set('scaleX', result.scaleX)
        }
        if (result.scaleY !== undefined) {
          obj.set('scaleY', result.scaleY)
        }

        obj.setCoords()
      } else if (
        regionRef === 'front-cover' ||
        regionRef === 'front-wing' ||
        regionRef === 'back-cover' ||
        regionRef === 'back-wing'
      ) {
        // 표지/날개(앞·뒤): 영역 앵커 기준 재배치.
        // ⚠️ 무결성 핵심: 뒤표지(back-*)도 반드시 재배치해야 한다. 책등이 커지면 워크스페이스가
        // 중앙 대칭 확장 → getContentOrigin 이동. 뒤표지를 no-op(scene 고정)으로 두면 content
        // 프레임에서 책등 쪽으로 drift(= Δspine/2)하여 바코드/문안이 책등을 침범(오인쇄).
        // computeObjectReposition 은 뒤표지 region.x(불변)+xNorm 으로 content 위치를 보존하고,
        // +origin(이동값)으로 scene 를 좌측 보정 → drift 0.
        const result = computeObjectReposition(
          { regionRef, anchor },
          boundingRect,
          oldLayout,
          newLayout
        )

        // 엔진 출력 content → scene: + origin
        obj.setPositionByOrigin(
          new fabric.Point(result.x + origin.x, result.y + origin.y),
          'center',
          'center'
        )

        obj.setCoords()

        // anchor 갱신
        if (!obj.meta) {
          obj.meta = {}
        }
        obj.meta.anchor = result.anchor
      }
    }
  }

  /**
   * 캔버스 밖 객체 경고 + 자동 재배치 (P1-5)
   *
   * 책등 폭 변경(`resizeSpine`) 후 작업 영역을 벗어난 객체가 있으면:
   *  1. 영역 안으로 위치 자동 클립 (multi-region 정밀 좌표)
   *  2. `spreadObjectsOutOfBounds` 이벤트를 발행해 toast 표시
   *
   * 옵션: autoRelocate=false 로 비활성화 가능 (resizeSpine 호출 시 전달)
   */
  private checkObjectsOutOfBounds(layout: SpreadLayout, autoRelocate: boolean = true): void {
    const origin = this.getContentOrigin()
    const objects = this._canvas.getObjects()
    const minX = origin.x
    const minY = origin.y
    const maxX = origin.x + layout.totalWidthPx
    const maxY = origin.y + layout.totalHeightPx

    const outOfBounds: any[] = []
    for (const obj of objects) {
      if (obj.meta?.system) continue
      // 경계(minX..maxX)는 origin 기반 scene 좌표 → br 도 scene(absolute) 이어야 정합.
      // (무인자 getBoundingRect 는 viewport 좌표라 줌에 따라 오판정.)
      const br = obj.getBoundingRect(true, true)
      const overflowRight = br.left + br.width > maxX
      const overflowLeft = br.left < minX
      const overflowBottom = br.top + br.height > maxY
      const overflowTop = br.top < minY

      if (!overflowLeft && !overflowRight && !overflowTop && !overflowBottom) continue

      outOfBounds.push(obj)

      if (!autoRelocate) continue

      // 자동 재배치: 객체를 영역 안으로 클립
      // - 가로/세로 모두 영역보다 큰 경우 좌상단 정렬
      // - 단순히 left/top 보정 (scale 변경 없음)
      let newLeft = obj.left ?? 0
      let newTop = obj.top ?? 0

      if (overflowRight) {
        const delta = (br.left + br.width) - maxX
        newLeft -= delta
      }
      if (overflowLeft) {
        const delta = minX - br.left
        newLeft += delta
      }
      if (overflowBottom) {
        const delta = (br.top + br.height) - maxY
        newTop -= delta
      }
      if (overflowTop) {
        const delta = minY - br.top
        newTop += delta
      }

      obj.set({ left: newLeft, top: newTop })
      obj.setCoords()
    }

    if (outOfBounds.length > 0) {
      if (autoRelocate) {
        this._canvas.requestRenderAll()
      }
      console.warn(
        `SpreadPlugin: ${outOfBounds.length} objects out of bounds${autoRelocate ? ' (auto-relocated)' : ''}`,
      )
      this._editor.emit('spreadObjectsOutOfBounds', {
        count: outOfBounds.length,
        objects: outOfBounds,
        autoRelocated: autoRelocate,
      })
    }
  }

  /**
   * 책등 콘텐츠 오버플로우 경고 (SF-5).
   *
   * 책등이 좁아질 때 책등 객체(세로쓰기 제목 등)가 책등 영역을 벗어나 앞/뒤표지를 침범하면
   * `spreadSpineOverflow` 이벤트로 알린다. ⚠️ 텍스트 자동 축소는 하지 않는다 — 폰트 렌더링
   * 품질 보존을 위한 의도된 설계(SpineResizeStrategy: 텍스트 스케일 금지). 편집기가 이벤트를
   * 받아 토스트/하이라이트로 사용자에게 책등 폭/배치 조정을 안내하도록 한다.
   * (좌표계: spine.region 은 content 프레임, getContentBoundingRect 도 content → 직접 비교.)
   */
  private checkSpineOverflow(layout: SpreadLayout): void {
    const spine = layout.regions.find((r) => r.position === 'spine')
    if (!spine) return
    const tol = 1 // px 허용오차
    const overflow: fabric.Object[] = []
    for (const obj of this._canvas.getObjects()) {
      if (obj.meta?.system) continue
      if (obj.meta?.regionRef !== 'spine') continue
      const br = this.getContentBoundingRect(obj)
      const exceedsLeft = br.left < spine.x - tol
      const exceedsRight = br.left + br.width > spine.x + spine.width + tol
      if (exceedsLeft || exceedsRight) overflow.push(obj)
    }
    if (overflow.length > 0) {
      console.warn(
        `SpreadPlugin: 책등 콘텐츠 ${overflow.length}개가 책등 영역(${spine.widthMm}mm)을 벗어남 → 표지 침범 위험`,
      )
      this._editor.emit('spreadSpineOverflow', {
        count: overflow.length,
        objects: overflow,
        spineRegion: spine,
        spineWidthMm: spine.widthMm,
      })
    }
  }

  // ============================================================================
  // Rendering
  // ============================================================================

  /**
   * 가이드라인 렌더링 (영역 경계 점선)
   */
  private renderGuides(layout: SpreadLayout): void {
    const origin = this.getContentOrigin()

    layout.guides.forEach((guide, index) => {
      const x = origin.x + guide.x
      const y1 = origin.y + guide.y1
      const y2 = origin.y + guide.y2

      const line = new fabric.Line([x, y1, x, y2], {
        id: `spread-guide-${index}`,
        stroke: '#999',
        strokeWidth: 1,
        strokeDashArray: [5, 5],
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
        excludeFromExport: true, // 시스템 가이드 — 저장/재로드 직렬화 제외(중복·오염 방지)
      })

      if (!line.meta) {
        line.meta = {}
      }
      line.meta.system = 'spreadGuide' as SystemObjectType

      this._canvas.add(line)
      this.guideLines.push(line)
    })
  }

  /**
   * 치수 라벨 렌더링 (영역별 mm 표시)
   */
  private renderLabels(layout: SpreadLayout): void {
    const origin = this.getContentOrigin()

    for (const label of layout.labels) {
      const text = new fabric.Text(label.text, {
        left: origin.x + label.x,
        top: origin.y + label.y,
        fontSize: 14,
        fill: '#666',
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
        originX: 'center',
        originY: 'bottom',
        excludeFromExport: true, // 시스템 라벨 — 저장/재로드 직렬화 제외
      })

      if (!text.meta) {
        text.meta = {}
      }
      text.meta.system = 'dimensionLabel' as SystemObjectType
      text.meta.regionPosition = label.regionPosition

      this._canvas.add(text)
      this.dimensionLabels.push(text)
    }
  }

  /**
   * 가이드라인 제거
   */
  private clearGuides(): void {
    for (const line of this.guideLines) {
      this._canvas.remove(line)
    }
    this.guideLines = []
  }

  /**
   * 치수 라벨 제거
   */
  private clearLabels(): void {
    for (const label of this.dimensionLabels) {
      this._canvas.remove(label)
    }
    this.dimensionLabels = []
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * 객체 이동 완료: regionRef/anchor 자동 갱신
   */
  private handleObjectModified(e: IEvent): void {
    if (this.isLayoutTransaction) {
      // 트랜잭션 중에는 자동 갱신 비활성
      return
    }

    if (!this.currentLayout) {
      return
    }

    const target = e.target
    if (!target || target.meta?.system) {
      return
    }

    // 바운딩 박스 계산 (stroke 포함) — content 좌표계로 변환(엔진 비교용).
    const boundingRect = this.getContentBoundingRect(target)

    // 현재 regionRef
    const currentRegionRef = target.meta?.regionRef ?? null

    // 히스테리시스 적용 판정
    const result = resolveRegionRef(
      this.currentLayout.regions,
      boundingRect,
      currentRegionRef
    )

    // 메타 갱신
    if (!target.meta) {
      target.meta = {}
    }
    target.meta.regionRef = result.regionRef
    target.meta.primaryRegionHint = result.primaryRegionHint
    target.meta.anchor = result.anchor

    // 강등/승격 로그 (디버깅용)
    if (currentRegionRef !== result.regionRef) {
      console.log('SpreadPlugin: regionRef changed', {
        from: currentRegionRef,
        to: result.regionRef,
        hint: result.primaryRegionHint,
      })
    }
  }

  /**
   * 객체 이동 중: 영역 경계/중앙 스냅
   */
  private handleObjectMoving(e: IEvent): void {
    if (this.isLayoutTransaction) {
      return
    }

    if (!this.currentLayout) {
      return
    }

    const target = e.target
    if (!target || target.meta?.system) {
      return
    }

    // TODO: 스냅 가이드 구현
    // - 영역 경계에 스냅
    // - 영역 중앙에 스냅
    // - primaryRegionHint 기준으로 스냅
    // WorkspacePlugin의 스냅 기능을 재사용하거나 별도 구현
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * 현재 레이아웃 조회
   */
  getLayout(): SpreadLayout | null {
    return this.currentLayout
  }

  /**
   * 현재 스펙 조회
   */
  getSpec(): SpreadSpec {
    return this.currentSpec
  }

  /**
   * x 좌표 → 영역 판정 (content 좌표 전제)
   * @deprecated scene 좌표 클릭에는 getRegionAtPoint 를 사용(좌표계 변환 포함).
   */
  getRegionAtX(x: number): SpreadRegion | null {
    if (!this.currentLayout) {
      return null
    }
    return resolveRegionAtX(this.currentLayout.regions, x)
  }

  /**
   * Fabric scene 좌표(포인터) → 영역 판정. scene→content 좌표 변환을 내부 캡슐화.
   */
  getRegionAtPoint(scenePoint: { x: number; y: number }): SpreadRegion | null {
    if (!this.currentLayout) return null
    const origin = this.getContentOrigin()
    const contentX = scenePoint.x - origin.x
    return resolveRegionAtX(this.currentLayout.regions, contentX)
  }

  /** 현재 포커스된 영역 */
  getFocusedRegion(): SpreadRegion | null {
    if (!this.currentLayout || !this._focusedRegionPosition) return null
    return this.currentLayout.regions.find((r) => r.position === this._focusedRegionPosition) ?? null
  }

  /**
   * 영역 포커싱 — 해당 영역에 하이라이트 오버레이를 표시하고 spreadRegionFocus 이벤트 발행.
   * (편집기는 이 이벤트로 활성 영역 표시/신규객체 앵커링 등에 활용 가능)
   */
  focusRegion(position: string): void {
    if (!this.currentLayout) return
    const region = this.currentLayout.regions.find((r) => r.position === position)
    if (!region) return
    this._focusedRegionPosition = position
    this.renderFocusOverlay(region)
    this._editor.emit('spreadRegionFocus', { region })
  }

  /** 영역 포커스 해제 */
  clearFocus(): void {
    if (!this._focusedRegionPosition) return
    this._focusedRegionPosition = null
    this.clearFocusOverlay()
    this._editor.emit('spreadRegionFocus', { region: null })
  }

  /**
   * mouse:down — 빈 영역(시스템/배경) 클릭 시 해당 영역 포커싱. 같은 영역 재클릭 시 해제.
   * 사용자 객체 클릭/팬/alt 드래그에는 개입하지 않음(선택/이동 보존).
   */
  private handleRegionClick(opt: IEvent): void {
    if (!this.currentLayout) return
    // 팬/alt 드래그 중에는 무시(DraggingPlugin 과 충돌 방지)
    const dragging = this._editor.getPlugin('DraggingPlugin') as unknown as { dragMode?: boolean } | null
    if ((opt.e as MouseEvent | undefined)?.altKey || dragging?.dragMode) return
    // 사용자 편집 가능 객체 클릭은 무시(선택 동작 보존). 빈 영역/워크스페이스/시스템 객체만 처리.
    const target = opt.target as (fabric.Object & { id?: string; meta?: { system?: unknown }; excludeFromExport?: boolean }) | undefined
    if (target && !target.meta?.system && !target.excludeFromExport && target.id !== 'workspace') return

    const pointer = this._canvas.getPointer(opt.e)
    const region = this.getRegionAtPoint(pointer)
    if (!region) return
    // 같은 영역 재클릭 → 포커스 해제(토글)
    if (this._focusedRegionPosition === region.position) {
      this.clearFocus()
    } else {
      this.focusRegion(region.position)
    }
  }

  /** 포커스 영역 하이라이트 오버레이 렌더(저장 제외) */
  private renderFocusOverlay(region: SpreadRegion): void {
    this.clearFocusOverlay()
    if (!this.currentLayout) return
    const origin = this.getContentOrigin()
    const rect = new fabric.Rect({
      id: 'spread-focus-overlay',
      left: origin.x + region.x,
      top: origin.y,
      width: region.width,
      height: this.currentLayout.totalHeightPx,
      fill: 'rgba(59,130,246,0.10)',
      stroke: '#3b82f6',
      strokeWidth: 2,
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      excludeFromExport: true,
    })
    if (!rect.meta) rect.meta = {}
    rect.meta.system = 'spreadGuide' as SystemObjectType
    this._canvas.add(rect)
    // 경계선/라벨 위 z-order 유지(워크스페이스 테두리 앞으로)
    const ws = this._editor.getPlugin('WorkspacePlugin') as unknown as { bringBordersToFront?: () => void } | null
    ws?.bringBordersToFront?.()
    this._focusOverlay = rect
    this._canvas.requestRenderAll()
  }

  /** 포커스 오버레이 제거 */
  private clearFocusOverlay(): void {
    if (this._focusOverlay) {
      this._canvas.remove(this._focusOverlay)
      this._focusOverlay = null
      this._canvas.requestRenderAll()
    }
  }
}

export default SpreadPlugin
