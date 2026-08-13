import { fabric } from 'fabric'
import Editor from '../Editor'
import { ImageFilters, ImageFiltersWithParams, ImageFilterType } from '../models'
import { PluginBase } from '../plugin'

/**
 * Type guard to check if object is a fabric.Image
 * @param obj - Any fabric object
 * @returns Boolean indicating if object is a fabric.Image
 */
function isFabricImage(obj: any): obj is fabric.Image {
  return obj instanceof fabric.Image && typeof obj.applyFilters === 'function'
}

class FilterPlugin extends PluginBase {
  name = 'FilterPlugin'
  hotkeys = []
  events = []
  private _tempFiltersStore: Map<string, any> | null = null

  constructor(canvas: fabric.Canvas, editor: Editor) {
    super(canvas, editor, {})
  }

  public changeFilter(name: ImageFilterType, object: fabric.Object, params: {}) {
    if (!ImageFilters.includes(name) && !ImageFiltersWithParams.includes(name)) {
      throw new Error('Invalid filter type')
    }

    // 안전하게 filters 속성에 접근
    if (!('filters' in object)) {
      console.warn('Object does not support filters')
      return
    }

    object.filters = object.filters || []

    if (name === 'None') {
      this.clearFilter(object)
      return
    }

    console.log('changeFilter', name, object, params)
    if (this.hasFilter(name, object)) {
      this.removeFilter(name, object)
    } else {
      this.applyFilter(name, object, params)
    }
  }

  public clearFilter(object: fabric.Object) {
    // fabric.Image 타입인지 확인
    if (!isFabricImage(object)) {
      console.warn('Cannot apply filters to non-image objects')
      return
    }

    object.filters = []
    object.applyFilters()
    this._canvas.renderAll()
  }

  public hasFilter(name: ImageFilterType, object: fabric.Object): boolean {
    // filters 속성이 없으면 false 반환
    if (!object.filters) return false

    return object.filters.some((filter: any) => filter.type === name)
  }

  public applyFilter(name: ImageFilterType, object: fabric.Object, params: { [key: string]: any }) {
    if (!ImageFilters.includes(name) && !ImageFiltersWithParams.includes(name)) {
      throw new Error('Invalid filter type')
    }

    // fabric.Image 타입이 아니면 리턴
    if (!isFabricImage(object)) {
      console.warn('Cannot apply filters to non-image objects')
      return
    }

    const fabricType = this.getFabricFilterType(name)
    const Filter = fabric.Image.filters[fabricType as keyof fabric.IAllFilters]
    if (Filter) {
      const filterObj = new Filter(name)

      if (params) {
        for (const key in params) {
          filterObj[key as keyof fabric.IBaseFilter] = params[key]
        }
      }

      object.filters.push(filterObj)
    }
    object.applyFilters()
    this._canvas.renderAll()
  }

  public removeFilter(name: ImageFilterType, object: fabric.Object) {
    if (!ImageFilters.includes(name) && !ImageFiltersWithParams.includes(name)) {
      throw new Error('Invalid filter type')
    }

    // fabric.Image 타입이 아니면 리턴
    if (!isFabricImage(object)) {
      console.warn('Cannot remove filters from non-image objects')
      return
    }

    object.filters = object.filters.filter((filter: any) => filter.type !== name)
    object.applyFilters()
    this._canvas.renderAll()
  }

  emboss(object: fabric.Object) {
    object.effects ??= []
    this.overlayEffect(object, { effect: 'emboss', color: '#d3d3d3' })
  }

  gold(object: fabric.Object) {
    object.effects ??= []
    this.overlayEffect(object, { effect: 'gold', color: '#FFD700' })
  }

  /** 금박과 동일 경로, 실버 팔레트 (화면 표시) */
  silver(object: fabric.Object) {
    object.effects ??= []
    this.overlayEffect(object, { effect: 'silver', color: '#C0C8D4' })
  }

  cutting(object: fabric.Object) {
    object.effects ??= []
    this.overlayEffect(object, { effect: 'cutting', color: '#dbecea' })
  }

  afterLoad(...args): Promise<void> {
    const imagesToBind = this._canvas.getObjects().filter((obj) => obj.fillImage)

    for (const image of imagesToBind) {
      const fore = this._canvas.getObjects().find((obj) => obj.id === image.fillImage)
      if (fore) {
        console.log('bind image')
        //this.setOverlay(fore, image)
      }
    }

    return super.afterLoad(...args)
  }

  /**
   * 저장 전 임시로 필터를 제거하는 beforeSave 메서드
   * object.effects 배열은 유지하여 효과 식별을 보존합니다.
   */
  async beforeSave(...args): Promise<void> {
    // 필터가 적용된 객체 정보를 임시 저장할 Map
    this._tempFiltersStore = new Map()

    // 캔버스의 모든 객체 순회
    const allObjects = this._canvas.getObjects()

    // 효과가 적용된 객체 찾기
    for (const obj of allObjects) {
      // effects 배열이 있고 내용이 있는 경우에만 처리
      if (obj.effects && obj.effects.length > 0) {
        if (obj instanceof fabric.Image) {
          // 이미지 객체인 경우: 필터 백업 후 제거
          if (obj.filters && obj.filters.length > 0) {
            // 객체 ID와 필터 배열 저장
            this._tempFiltersStore.set(obj.id, [...obj.filters])

            // 필터 제거 (effects 배열은 유지)
            obj.filters = []
            obj.applyFilters()
          }
        } else if (
          (obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') &&
          obj.originalFill !== undefined
        ) {
          // 텍스트 객체인 경우: 원래 색상 및 현재 색상 백업
          this._tempFiltersStore.set(obj.id, {
            originalFill: obj.originalFill,
            currentFill: obj.fill
          })

          // 원래 색상으로 복원 (effects 배열은 유지)
          obj.set('fill', obj.originalFill)
        }
      }
    }

    // 캔버스 다시 렌더링
    this._canvas.requestRenderAll()

    return super.beforeSave(...args)
  }

  /**
   * 저장 후 임시로 제거했던 필터를 복원하는 afterSave 메서드
   */
  async afterSave(...args: any[]): Promise<void> {
    // 임시 저장소가 없으면 아무것도 하지 않음
    return new Promise((r) => {

      console.log('afterSave: filter plugin')
      if (!this._tempFiltersStore || this._tempFiltersStore?.size === 0) {
        console.log('no temp filters store')
        r(...args)
        return
      }
  
      // 캔버스의 모든 객체 순회
      const allObjects = this._canvas.getObjects()
  
      // 효과가 적용되었던 객체 복원
      for (const obj of allObjects) {
        // 객체 ID가 임시 저장소에 있는 경우 처리
        if (obj.id && this._tempFiltersStore.has(obj.id)) {
          if (obj instanceof fabric.Image) {
            // 이미지 객체인 경우: 필터 복원
            obj.filters = this._tempFiltersStore.get(obj.id)
            obj.applyFilters()
          } else if (obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') {
            // 텍스트 객체인 경우: 패턴 채우기 복원
            const storedData = this._tempFiltersStore.get(obj.id)
            obj.set('fill', storedData.currentFill)
            obj.originalFill = storedData.originalFill
          }
        }
      }
  
      // 임시 저장소 비우기
      this._tempFiltersStore.clear()
      this._tempFiltersStore = null
  
      // 캔버스 다시 렌더링
      this._canvas.requestRenderAll()
      r(...args)
    })
  }

  /**
   * 객체에 효과를 적용하는 overlayEffect 메서드
   * - 이미지 객체: 직접 필터 적용
   * - 텍스트 객체: 패턴 기반 채우기 적용
   */
  async overlayEffect(object: fabric.Object, options: { effect: string; color: string }) {
    // 효과 배열 초기화 (없는 경우)
    object.effects ??= []
    try {
      // 이미 해당 효과가 적용되어 있는지 확인하고, 있으면 제거
      if (object.effects.includes(options.effect)) {
        // 텍스트 객체인 경우
        if (object.type === 'text' || object.type === 'i-text' || object.type === 'textbox') {
          // 원본 채우기 색상 복원 (있는 경우)
          if (object.originalFill !== undefined) {
            object.set('fill', object.originalFill)
            delete object.originalFill
          }
        }
        // 이미지 객체인 경우
        else if (object instanceof fabric.Image) {
          // 효과 제거: 해당 효과 이름의 필터만 제거
          this.removeEffectFilter(object, options.effect)
          // 변경 내용 적용
          object.applyFilters()
        }

        // 효과 배열에서 제거
        object.effects = object.effects.filter((effect) => effect !== options.effect)

        // 변경 내용 적용
        this._canvas.requestRenderAll()
        return
      }

      // 히스토리 기록 일시 중지
      this._canvas.offHistory()

      // 텍스트 객체 처리
      if (object.type === 'text' || object.type === 'i-text' || object.type === 'textbox') {
        // 원본 채우기 색상 저장 (아직 저장되지 않은 경우)
        if (object.originalFill === undefined) {
          object.originalFill = object.fill
        }

        // 효과별 패턴 생성 및 적용
        const pattern = await this.createEffectPatternForText(options.effect)
        if (pattern) {
          object.set('fill', pattern)
        }
      }
      // 이미지 객체 처리
      else if (object instanceof fabric.Image) {
        // 효과별 필터 적용
        switch (options.effect) {
          case 'gold':
            this.applyGoldFilter(object)
            break
          case 'silver':
            this.applySilverFilter(object)
            break
          case 'emboss':
            this.applyEmbossFilter(object)
            break
          case 'cutting':
            this.applyCuttingFilter(object)
            break
          default:
            // 기본 색상 필터
            this.applyColorFilter(object, options.color)
        }

        // 필터 적용
        object.applyFilters()
      }
      // 지원하지 않는 객체 타입
      else {
        console.warn('지원하지 않는 객체 타입입니다.')
        this._canvas.onHistory()
        return
      }

      // 효과 이름 등록
      object.effects.push(options.effect)

      // 변경 내용 적용
      this._canvas.requestRenderAll()

      // 히스토리 기록 재개
      this._canvas.onHistory()
    } catch (e) {
      console.error(`${options.effect} 효과 적용 중 오류:`, e)
      this._canvas.onHistory() // 에러 발생 시에도 히스토리 기록 재개
    }
  }

  /**
   * 골드 효과 필터 적용
   */
  private applyGoldFilter(image: fabric.Image) {
    // 기존 필터 보존
    const existingFilters = image.filters || []

    // 골드 효과 관련 필터들
    const goldFilter = new fabric.Image.filters.BlendColor({
      color: '#FFD700', // 골드 색상
      mode: 'multiply',
      alpha: 0.7,
      // 효과 식별을 위한 커스텀 속성 추가
      effectType: 'gold'
    } as any)

    const saturationFilter = new fabric.Image.filters.Saturation({
      saturation: 0.3, // 채도 약간 증가
      effectType: 'gold'
    } as any)

    // 새 필터 추가
    image.filters = [...existingFilters, goldFilter, saturationFilter]
  }

  private applySilverFilter(image: fabric.Image) {
    const existingFilters = image.filters || []
    const silverFilter = new fabric.Image.filters.BlendColor({
      color: '#C0C8D4',
      mode: 'multiply',
      alpha: 0.65,
      effectType: 'silver',
    } as any)
    const saturationFilter = new fabric.Image.filters.Saturation({
      saturation: -0.25,
      effectType: 'silver',
    } as any)
    image.filters = [...existingFilters, silverFilter, saturationFilter]
  }

  /**
   * 엠보싱 효과 필터 적용
   */
  private applyEmbossFilter(image: fabric.Image) {
    // 기존 필터 보존
    const existingFilters = image.filters || []

    // 엠보싱 효과 관련 필터들
    const grayscaleFilter = new fabric.Image.filters.Grayscale({
      effectType: 'emboss'
    })

    const brightnessFilter = new fabric.Image.filters.Brightness({
      brightness: 0.1, // 약간 밝게
      effectType: 'emboss'
    } as any)

    const contrastFilter = new fabric.Image.filters.Contrast({
      contrast: 0.15, // 약간 대비 증가
      effectType: 'emboss'
    } as any)

    // 새 필터 추가
    image.filters = [...existingFilters, grayscaleFilter, brightnessFilter, contrastFilter]
  }

  /**
   * 커팅 효과 필터 적용
   */
  private applyCuttingFilter(image: fabric.Image) {
    // 기존 필터 보존
    const existingFilters = image.filters || []

    // 커팅 효과 관련 필터들
    const colorFilter = new fabric.Image.filters.BlendColor({
      color: '#dbecea', // 민트 그린 색상
      mode: 'lighten',
      alpha: 0.7,
      effectType: 'cutting'
    } as any)

    const brightnessFilter = new fabric.Image.filters.Brightness({
      brightness: 0.1, // 약간 밝게
      effectType: 'cutting'
    } as any)

    // 새 필터 추가
    image.filters = [...existingFilters, colorFilter, brightnessFilter]
  }

  /**
   * 기본 색상 필터 적용
   */
  private applyColorFilter(image: fabric.Image, color: string) {
    // 기존 필터 보존
    const existingFilters = image.filters || []

    // 색상 필터
    const colorFilter = new fabric.Image.filters.BlendColor({
      color: color,
      mode: 'multiply',
      alpha: 0.5,
      effectType: 'color'
    } as any)

    // 새 필터 추가
    image.filters = [...existingFilters, colorFilter]
  }

  /**
   * 텍스트 객체용 효과 패턴 생성 (단순화된 버전)
   */
  private async createEffectPatternForText(effectType: string): Promise<fabric.Pattern | null> {
    // 패턴 캔버스 생성
    const patternCanvas = document.createElement('canvas')
    const size = 64 // 작은 사이즈로 충분 (단순 색상이므로)
    patternCanvas.width = size
    patternCanvas.height = size
    const ctx = patternCanvas.getContext('2d')

    if (!ctx) {
      console.error('캔버스 컨텍스트를 생성할 수 없습니다.')
      return null
    }

    // 효과별 색상 설정 (이미지 필터와 동일한 색상)
    let color
    switch (effectType) {
      case 'gold':
        color = '#FFD700' // 황금색
        break
      case 'silver':
        color = '#C0C8D4'
        break
      case 'emboss':
        color = '#CCCCCC' // 밝은 회색
        break
      case 'cutting':
        color = '#dbecea' // 민트 그린
        break
      default:
        color = '#333333' // 기본 색상
    }

    // 단순 색상 채우기
    ctx.fillStyle = color
    ctx.fillRect(0, 0, size, size)

    // 패턴 객체 생성 및 반환
    return new fabric.Pattern({
      source: patternCanvas as any,
      repeat: 'repeat'
    })
  }

  /**
   * 특정 효과의 필터만 제거
   */
  private removeEffectFilter(image: fabric.Image, effectType: string) {
    // 기존 필터 배열이 없으면 무시
    if (!image.filters) return

    // 지정된 효과 타입의 필터만 제외하고 나머지 유지
    image.filters = image.filters.filter((filter) => {
      return (filter as any).effectType !== effectType
    })
  }
  // 정리할 인스턴스 리스너가 없어 dispose 는 PluginBase 의 no-op 을 상속한다.
  // (과거 override 는 항상 비어 있던 eventHandlers Map 을 순회하는 dead code 였고,
  //  존재하지 않는 super.dispose() 를 호출해 Editor.dispose 에서 TypeError 를 냈다.)

  private getFabricFilterType(type: string): string {
    return type.charAt(0).toUpperCase() + type.slice(1)
  }
}

export default FilterPlugin
