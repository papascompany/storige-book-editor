import { fabric } from 'fabric'
import { debounce, throttle } from 'lodash-es'

/**
 * 메모리 최적화를 위한 캐시 관리자
 */
export class CacheManager {
  private static cacheSize = 0
  private static readonly MAX_CACHE_SIZE = 100 * 1024 * 1024  // 100MB
  
  /**
   * 객체의 캐시 접근 시간 업데이트
   * @param obj 대상 객체
   */
  static updateCacheAccessTime(obj: fabric.Object): void {
    if (obj && obj._cacheCanvas) {
      (obj as any)._lastCacheTime = Date.now()
    }
  }
  
  /**
   * 객체에 캐시 시간 설정 (캐시 생성 시 호출)
   * @param obj 대상 객체
   */
  static setCacheTime(obj: fabric.Object): void {
    if (obj) {
      (obj as any)._lastCacheTime = Date.now()
    }
  }
  
  /**
   * 캔버스의 모든 활성 객체들의 캐시 접근 시간 업데이트
   * @param canvas 대상 캔버스
   */
  static updateActiveObjectsCacheTime(canvas: fabric.Canvas): void {
    const activeObjects = canvas.getActiveObjects()
    activeObjects.forEach(obj => {
      this.updateCacheAccessTime(obj)
    })
    
    // 현재 선택된 객체도 업데이트
    const activeObject = canvas.getActiveObject()
    if (activeObject) {
      this.updateCacheAccessTime(activeObject)
    }
  }
  
  /**
   * 캐시 크기 체크 및 정리 (개선된 버전)
   */
  static checkAndCleanCache(canvas: fabric.Canvas) {
    const objects = canvas.getObjects()
    let totalCacheSize = 0
    
    // 현재 활성 객체들의 캐시 시간 업데이트
    this.updateActiveObjectsCacheTime(canvas)
    
    // 캐시 크기 추정 및 캐시가 있는 객체에 타임스탬프 설정
    objects.forEach(obj => {
      if (obj._cacheCanvas) {
        const width = obj._cacheCanvas.width || 0
        const height = obj._cacheCanvas.height || 0
        totalCacheSize += width * height * 4  // RGBA
        
        // 캐시가 있지만 타임스탬프가 없는 경우 현재 시간으로 설정
        if (!(obj as any)._lastCacheTime) {
          this.setCacheTime(obj)
        }
      }
    })
    
    this.cacheSize = totalCacheSize
    
    // 캐시가 너무 크면 오래된 객체부터 캐시 제거
    if (totalCacheSize > this.MAX_CACHE_SIZE) {
      // 캐시가 있는 객체들만 필터링하고 시간순으로 정렬
      const cachedObjects = objects.filter(obj => obj._cacheCanvas && obj.id !== 'workspace')
      const sortedObjects = cachedObjects.sort((a, b) => {
        const aTime = (a as any)._lastCacheTime || 0
        const bTime = (b as any)._lastCacheTime || 0
        return aTime - bTime  // 오래된 것부터 (작은 시간값부터)
      })
      
      let freedSize = 0
      let cleanedCount = 0
      const currentTime = Date.now()
      
      for (const obj of sortedObjects) {
        if (obj._cacheCanvas) {
          const size = (obj._cacheCanvas.width || 0) * (obj._cacheCanvas.height || 0) * 4
          
          // 캐시 삭제
          obj.dirty = true  // 캐시 재생성 필요 표시
          delete obj._cacheCanvas
          delete (obj as any)._lastCacheTime
          
          freedSize += size
          cleanedCount++
          
          // 목표 크기까지 정리되면 중단
          if (totalCacheSize - freedSize < this.MAX_CACHE_SIZE * 0.8) {
            break
          }
        }
      }
    }
  }
  
  /**
   * 특정 객체의 캐시 정보 조회
   * @param obj 대상 객체
   */
  static getCacheInfo(obj: fabric.Object): { hasCache: boolean; age?: number; size?: number } {
    if (!obj._cacheCanvas) {
      return { hasCache: false }
    }
    
    const lastCacheTime = (obj as any)._lastCacheTime || 0
    const age = lastCacheTime ? Date.now() - lastCacheTime : 0
    const size = (obj._cacheCanvas.width || 0) * (obj._cacheCanvas.height || 0) * 4
    
    return {
      hasCache: true,
      age,
      size
    }
  }
  
  /**
   * 캐시 통계 정보 조회
   * @param canvas 대상 캔버스
   */
  static getCacheStats(canvas: fabric.Canvas): {
    totalObjects: number
    cachedObjects: number
    totalCacheSize: number
    averageAge: number
  } {
    const objects = canvas.getObjects()
    let cachedCount = 0
    let totalSize = 0
    let totalAge = 0
    const currentTime = Date.now()
    
    objects.forEach(obj => {
      if (obj._cacheCanvas) {
        cachedCount++
        totalSize += (obj._cacheCanvas.width || 0) * (obj._cacheCanvas.height || 0) * 4
        
        const lastCacheTime = (obj as any)._lastCacheTime || 0
        if (lastCacheTime) {
          totalAge += currentTime - lastCacheTime
        }
      }
    })
    
    return {
      totalObjects: objects.length,
      cachedObjects: cachedCount,
      totalCacheSize: totalSize,
      averageAge: cachedCount > 0 ? totalAge / cachedCount : 0
    }
  }
  
  /**
   * 주기적인 메모리 정리
   */
  static startPeriodicCleanup(canvas: fabric.Canvas, interval = 30000) {
    return setInterval(() => {
      CacheManager.checkAndCleanCache(canvas)
    }, interval)
  }
}

/**
 * 렌더링 최적화를 위한 유틸리티 클래스
 */
export class RenderOptimizer {
  private static renderQueue = new Map<string, () => void>()
  private static isProcessing = false
  private static animationFrameId: number | null = null
  
  /**
   * 배치 렌더링을 위한 큐에 추가
   */
  static queueRender(canvas: fabric.Canvas, immediate = false) {
    if (!canvas || !canvas.id) return
    
    RenderOptimizer.renderQueue.set(canvas.id, () => {
      canvas.requestRenderAll()
      
      // 렌더링 시 활성 객체들의 캐시 접근 시간 업데이트
      CacheManager.updateActiveObjectsCacheTime(canvas)
    })
    
    if (immediate) {
      RenderOptimizer.processQueue()
    } else {
      RenderOptimizer.scheduleProcess()
    }
  }
  
  /**
   * 렌더링 큐 처리 스케줄링
   */
  private static scheduleProcess() {
    if (RenderOptimizer.animationFrameId) return
    
    RenderOptimizer.animationFrameId = requestAnimationFrame(() => {
      RenderOptimizer.processQueue()
      RenderOptimizer.animationFrameId = null
    })
  }
  
  /**
   * 큐에 있는 모든 렌더링 처리
   */
  private static processQueue() {
    if (RenderOptimizer.isProcessing || RenderOptimizer.renderQueue.size === 0) return
    
    RenderOptimizer.isProcessing = true
    
    // 모든 렌더링 실행
    RenderOptimizer.renderQueue.forEach(render => render())
    RenderOptimizer.renderQueue.clear()
    
    RenderOptimizer.isProcessing = false
  }
  
  /**
   * 디바운스된 렌더링 함수 생성
   */
  static createDebouncedRender(canvas: fabric.Canvas, delay = 16) {
    return debounce(() => {
      RenderOptimizer.queueRender(canvas)
    }, delay)
  }

  /**
   * 객체 캐시 최적화 (개선된 버전)
   */
  static optimizeObjectCache(obj: fabric.Object) {
    // 텍스트가 아닌 객체는 더 적극적인 캐싱
    if (obj.type !== 'i-text' && obj.type !== 'text' && obj.type !== 'textbox') {
      obj.objectCaching = true
      obj.statefullCache = true  // 상태가 자주 변경되지 않는 객체
      obj.noScaleCache = false
    } else {
      // 텍스트는 좀 더 신중한 캐싱
      obj.objectCaching = true
      obj.statefullCache = false
      obj.noScaleCache = true  // 텍스트는 스케일 변경 시 캐시 재생성
    }
    
    // 캐시 활성화 시 타임스탬프 설정
    CacheManager.setCacheTime(obj)
  }
  
  /**
   * 캔버스의 모든 객체 캐시 최적화 (개선된 버전)
   */
  static optimizeCanvasCache(canvas: fabric.Canvas) {
    try {
      const objects = canvas.getObjects()
      objects.forEach(obj => {
        if (obj.id !== 'workspace') {  // workspace는 제외
          RenderOptimizer.optimizeObjectCache(obj)
        }
      })
    } catch (error) {
      console.warn('❌ 캐시 최적화 중 오류:', error)
    }
  }
  
  /**
   * 캔버스 캐시 관련 이벤트 설정 (비활성화)
   * 현재 타입 문제로 인해 비활성화됨
   */
  private static setupCanvasCacheEvents(canvas: fabric.Canvas) {
    // 현재 비활성화됨 - 타입 문제 해결 후 활성화 예정
  }
  
  /**
   * 무거운 작업 전 렌더링 일시 중지
   */
  static pauseRendering(canvas: fabric.Canvas) {
    canvas.renderOnAddRemove = false
    canvas.skipOffscreen = true
  }
  
  /**
   * 렌더링 재개
   */
  static resumeRendering(canvas: fabric.Canvas, render = true) {
    canvas.renderOnAddRemove = false  // 여전히 false 유지 (수동 제어)
    canvas.skipOffscreen = true
    
    if (render) {
      RenderOptimizer.queueRender(canvas, true)
    }
  }
  
  /**
   * 대량 객체 추가 최적화
   */
  static batchAdd(canvas: fabric.Canvas, objects: fabric.Object[], callback?: () => void) {
    RenderOptimizer.pauseRendering(canvas)
    
    objects.forEach(obj => {
      RenderOptimizer.optimizeObjectCache(obj)
      canvas.add(obj)
    })
    
    RenderOptimizer.resumeRendering(canvas, true)
    
    if (callback) {
      requestAnimationFrame(callback)
    }
  }
}

/**
 * 텍스트 크기 재계산을 위한 유틸리티 클래스
 */
export class TextSizeCalculator {
  /**
   * 텍스트 객체의 크기 재계산
   * @param textObject 텍스트 객체
   * @param immediate 즉시 렌더링 여부
   */
  static recalculateTextSize(textObject: fabric.Text | fabric.IText | fabric.Textbox, immediate = false): void {
    try {
      // 1. 캐시 클리어
      textObject._clearCache()
      
      // 2. 텍스트 크기 재측정 강제 실행
      if (typeof (textObject as any).initDimensions === 'function') {
        (textObject as any).initDimensions()
      }
      
      // 3. 텍스트 메트릭 재계산
      if (typeof (textObject as any)._measureText === 'function') {
        (textObject as any)._measureText()
      }
      
      // 4. dirty 플래그 설정 
      textObject.dirty = true
      
      // 5. 바운딩 박스 강제 재계산
      textObject.setCoords()
      
      // 6. 캔버스 객체 컬렉션에서 재정렬 (필요시)
      if (textObject.canvas) {
        textObject.canvas.fire('object:modified', { target: textObject })
      }
      
    } catch (error) {
      console.warn('❌ 텍스트 크기 재계산 중 오류:', error)
      
      // 기본적인 재계산만 수행
      textObject.dirty = true
      textObject.setCoords()
    }
    
    if (immediate && textObject.canvas) {
      // 즉시 렌더링
      textObject.canvas.requestRenderAll()
    } else if (textObject.canvas) {
      // 캔버스 렌더링 요청 (디바운스된 방식)
      requestAnimationFrame(() => {
        textObject.canvas?.requestRenderAll()
      })
    }
  }

  /**
   * 캔버스의 모든 텍스트 객체 크기 재계산 (개선된 버전)
   * @param canvas 대상 캔버스
   * @param fontPlugin 폰트 플러그인 (선택사항)
   */
  static async recalculateAllTextSizes(
    canvas: fabric.Canvas, 
    fontPlugin?: any
  ): Promise<void> {
    const textObjects = canvas.getObjects().filter((obj) => 
      ['text', 'textbox', 'i-text'].includes(obj.type!)
    ) as (fabric.Text | fabric.IText | fabric.Textbox)[]

    if (textObjects.length === 0) {
      return
    }

    // 1단계: 모든 폰트를 병렬로 로드
    const fontLoadPromises: Promise<void>[] = []
    const fontFamilies = new Set<string>()

    for (const textObj of textObjects) {
      const fontFamily = textObj.fontFamily
      
      if (fontPlugin && fontFamily && typeof fontPlugin.applyFont === 'function') {
        // 중복 폰트 로딩 방지
        if (!fontFamilies.has(fontFamily)) {
          fontFamilies.add(fontFamily)
          
          const loadPromise = fontPlugin.applyFont(fontFamily, null)
            .then(() => {
              // 폰트 로드 성공 (로그 제거)
            })
            .catch((error: any) => {
              console.warn(`폰트 로드 실패: ${fontFamily}`, error)
            })
          
          fontLoadPromises.push(loadPromise)
        }
      }
    }

    // 모든 폰트 로딩 대기
    if (fontLoadPromises.length > 0) {
      await Promise.allSettled(fontLoadPromises)
      
      // 폰트 로딩 후 브라우저가 폰트를 완전히 적용할 시간 제공
      await this.waitForFontRendering()
    }

    // 2단계: 모든 텍스트 객체의 폰트 설정 및 크기 재계산
    for (const textObj of textObjects) {
      const fontFamily = textObj.fontFamily
      
      // 폰트가 로드되었는지 재확인
      if (fontFamily && !(await this.checkFontLoaded(fontFamily))) {
        console.warn(`폰트 로딩 확인 실패, 폴백 폰트 적용: ${fontFamily}`)
        textObj.set({ fontFamily: 'Arial, sans-serif' })
      }
      
      // 텍스트 크기 재계산
      this.recalculateTextSize(textObj)
    }

    // 3단계: 최종 렌더링
    await new Promise(resolve => {
      requestAnimationFrame(() => {
        canvas.requestRenderAll()
        resolve(undefined)
      })
    })
  }

  /**
   * 폰트 렌더링 완료 대기
   * 브라우저가 폰트를 완전히 적용하도록 여러 렌더링 사이클 대기
   */
  private static async waitForFontRendering(): Promise<void> {
    // 3번의 렌더링 사이클 대기 (숨김 탭/오프스크린 iframe 에서 RAF 정지 → setTimeout 과 race)
    for (let i = 0; i < 3; i++) {
      await Promise.race([
        new Promise<void>(resolve => requestAnimationFrame(() => resolve())),
        new Promise<void>(resolve => setTimeout(resolve, 200)),
      ])
    }
    
    // 추가로 100ms 대기
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  /**
   * 폰트 로딩 상태를 더 정확하게 체크 (개선된 버전)
   * @param fontFamily 폰트 패밀리
   */
  static async checkFontLoaded(fontFamily: string): Promise<boolean> {
    // document.fonts API 사용 가능한 경우
    if ('fonts' in document) {
      try {
        // 폰트가 이미 로드되었는지 확인
        const loaded = await document.fonts.load(`16px "${fontFamily}"`).then(() => true).catch(() => false)
        
        if (loaded) {
          // 폰트가 실제로 사용 가능한지 추가 확인
          const fontFaceSet = document.fonts
          for (const fontFace of fontFaceSet) {
            if (fontFace.family === fontFamily || fontFace.family === `"${fontFamily}"`) {
              return fontFace.status === 'loaded'
            }
          }
        }
      } catch (e) {
        console.warn('document.fonts API 사용 중 오류:', e)
      }
    }
    
    // 폴백: Canvas를 사용한 폰트 체크
    return new Promise((resolve) => {
      const testString = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ한글테스트0123456789'
      
      // 임시 캔버스로 폰트 측정
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      
      if (!ctx) {
        resolve(false)
        return
      }
      
      // 기본 폰트로 측정
      ctx.font = '32px serif'
      const defaultWidth = ctx.measureText(testString).width
      
      // 대상 폰트로 측정
      ctx.font = `32px "${fontFamily}", serif`
      const testWidth = ctx.measureText(testString).width
      
      // 폰트가 로드되었는지 확인 (크기가 다르면 로드된 것으로 간주)
      if (Math.abs(testWidth - defaultWidth) > 0.1) {
        resolve(true)
      } else {
        // 폰트가 로드되지 않은 경우 여러 번 재시도
        let retryCount = 0
        const maxRetries = 5
        
        const checkFont = () => {
          ctx.font = `32px "${fontFamily}", serif`
          const retryWidth = ctx.measureText(testString).width
          
          if (Math.abs(retryWidth - defaultWidth) > 0.1) {
            resolve(true)
          } else if (++retryCount < maxRetries) {
            setTimeout(checkFont, 100 * retryCount) // 점진적으로 대기 시간 증가
          } else {
            resolve(false)
          }
        }
        
        setTimeout(checkFont, 100)
      }
    })
  }

  /**
   * 단일 텍스트 객체에 대한 폰트 로딩 및 크기 재계산
   * @param textObject 텍스트 객체
   * @param fontPlugin 폰트 플러그인
   */
  static async recalculateSingleTextSize(
    textObject: fabric.Text | fabric.IText | fabric.Textbox,
    fontPlugin?: any
  ): Promise<void> {
    const fontFamily = textObject.fontFamily
    
    if (fontPlugin && fontFamily && typeof fontPlugin.applyFont === 'function') {
      try {
        await fontPlugin.applyFont(fontFamily, textObject)
        await this.waitForFontRendering()
      } catch (error) {
        console.warn(`폰트 로딩 실패: ${fontFamily}`, error)
        textObject.set({ fontFamily: 'Arial, sans-serif' })
      }
    }
    
    this.recalculateTextSize(textObject, true)
  }
} 