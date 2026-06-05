import { fabric } from 'fabric'
import Editor from '../Editor'
import FontFaceObserver from 'fontfaceobserver'
import { PluginBase } from '../plugin'
import { parseColorValue } from '../utils'
import { convertSvgTextToPath } from '../converters/svgTextToPath'
import { validateTextGlyphs as validateGlyphs } from '../converters/validateGlyphs'
import { dlog, dwarn } from '../utils/debugLog'

// FontSource 인터페이스 정의 (src 사용)
interface FontSource {
  name: string
  src: string
}

// 한글 유니코드 정규화 함수들
const normalizeToNFC = (text: string): string => {
  try {
    return text.normalize('NFC')
  } catch (e) {
    dwarn('font', 'NFC 정규화 실패:', text, e)
    return text
  }
}

const normalizeToNFD = (text: string): string => {
  try {
    return text.normalize('NFD')
  } catch (e) {
    dwarn('font', 'NFD 정규화 실패:', text, e)
    return text
  }
}

// NFD와 NFC 둘 다 반환하는 함수 (매칭용)
const getNormalizedVariants = (text: string): string[] => {
  const nfc = normalizeToNFC(text.trim())
  const nfd = normalizeToNFD(text.trim())

  // 중복 제거하여 반환
  return nfc === nfd ? [nfc] : [nfc, nfd]
}

// 기본 폰트 이름 정규화 (NFD 사용 - 서버와 일관성)
const normalizeFontName = (fontName: string): string => {
  try {
    return normalizeToNFD(fontName.trim())
  } catch (e) {
    dwarn('font', '폰트명 정규화 실패:', fontName, e)
    return fontName.trim()
  }
}

// 모든 폰트 정규화는 NFD를 기본으로 사용

// 폰트 테스트용 정규화된 텍스트 생성
const createNormalizedTestText = (): string => {
  const testTexts = [
    'ABCabc123',
    '가나다라마',
    '한글테스트',
    '字体测试',
    'フォント',
    'Test Font',
    '🔤📝' // 이모지도 테스트
  ]

  return testTexts.map((text) => normalizeToNFD(text)).join('')
}

// 폰트 매칭 함수 (NFD/NFC 교차 비교)
const findFontVariantMatch = (targetName: string, loadedFonts: Map<string, any>): string | null => {
  const targetVariants = getNormalizedVariants(targetName)

  for (const [loadedName] of loadedFonts) {
    const loadedVariants = getNormalizedVariants(loadedName)

    // 어떤 조합이라도 일치하면 매칭 성공
    for (const targetVar of targetVariants) {
      for (const loadedVar of loadedVariants) {
        if (targetVar === loadedVar) {
          dlog('font', `✅ 폰트 매칭 성공: ${targetName} → ${loadedName}`)
          return loadedName
        }
      }
    }
  }

  return null
}

// FontPlugin 클래스
class FontPlugin extends PluginBase {
  name = 'FontPlugin'
  hotkeys = []
  events = []
  private fontLoadingStatus = new Map<string, 'loading' | 'loaded' | 'failed'>()
  private loadingQueue = new Map<
    string,
    Array<{ object: fabric.Object; resolve: Function; reject: Function }>
  >()
  // 폰트 이름(정규화 변형 포함) → WOFF2 URL 매핑
  private fontUrlByName = new Map<string, string>()
  // 폰트 바이너리 fetch용 프록시 (문자열: 베이스 URL, 함수: URL 리라이터)
  private fontProxy?: string | ((originalUrl: string) => string)
  // woff2ToTtf API 베이스 URL (예: https://api.papascompany.co.kr/api).
  // 프로덕션에서 에디터는 Vercel(editor.papascompany.co.kr)에서 서빙되므로
  // 상대 경로 '/api/woff2ToTtf' 는 Vercel 오리진으로 잘못 해석되어 404 가 난다.
  // 반드시 NestJS API 오리진을 가리켜야 한다.
  private apiBaseUrl?: string
  // TTF buffer 캐시 (fontFamily별로 캐싱)
  private ttfBufferCache = new Map<string, ArrayBuffer>()
  // TTF buffer 실패(음수) 캐시 — URL 없음/woff2ToTtf 실패한 폰트를 기억해
  // 같은 폰트의 텍스트가 여럿일 때 반복 fetch/실패를 1회로 줄인다(PDF 저장·글리프검증 속도).
  private ttfBufferFailed = new Set<string>()

  constructor(
    canvas: fabric.Canvas,
    editor: Editor,
    fontList: FontSource[],
    defaultFont: string,
    apiBaseUrl?: string
  ) {
    super(canvas, editor, {})

    // woff2ToTtf 호출에 사용할 API 베이스 URL 저장 (끝의 슬래시 제거).
    this.apiBaseUrl = apiBaseUrl?.replace(/\/$/, '') || undefined

    dlog('font', 'create fonts', fontList.length)
    this.createFontCSS(fontList)
      .then(() => {
        // CSS 적용 후 기본 폰트와 주요 폰트들을 실제로 로드
        return this.preloadEssentialFonts(fontList, defaultFont)
      })
      .catch((err) => {
        console.error('초기 폰트 로딩 실패:', err)
      })
  }

  // WASM 경로 설정자 제거

  loadFont(font: FontSource): Promise<void> {
    // 기본 NFD로 정규화
    const serverFontName = normalizeFontName(font.name)

    // 이미 로드된 폰트는 스킵
    if (this.fontLoadingStatus.get(serverFontName) === 'loaded') {
      return Promise.resolve()
    }

    // 로딩 중인 폰트는 대기
    if (this.fontLoadingStatus.get(serverFontName) === 'loading') {
      return new Promise((resolve, reject) => {
        if (!this.loadingQueue.has(serverFontName)) {
          this.loadingQueue.set(serverFontName, [])
        }
        this.loadingQueue.get(serverFontName)!.push({ object: null, resolve, reject })
      })
    }

    this.fontLoadingStatus.set(serverFontName, 'loading')

    // 브라우저 네이티브 CSS Font Loading API 사용
    return this.loadFontNative(serverFontName)
      .then(() => {
        this.fontLoadingStatus.set(serverFontName, 'loaded')
        this.processLoadingQueue(serverFontName, true)
      })
      .catch((err) => {
        console.error(`❌ 폰트 로딩 실패: ${serverFontName}`, err)
        this.fontLoadingStatus.set(serverFontName, 'failed')
        this.processLoadingQueue(serverFontName, false, err)
        throw err
      })
  }

  /**
   * 브라우저 네이티브 CSS Font Loading API를 사용한 폰트 로딩
   * FontFaceObserver보다 더 정확하고 신뢰할 수 있음
   */
  private async loadFontNative(fontName: string): Promise<void> {
    if (!document.fonts) {
      // CSS Font Loading API 미지원 브라우저 (폴백)
      dwarn('font', 'CSS Font Loading API 미지원, FontFaceObserver 사용')
      const fontFaceObserver = new FontFaceObserver(fontName)
      const testText = createNormalizedTestText()
      await fontFaceObserver.load(testText, 5000)
      return
    }

    try {
      // 1. 네이티브 API로 폰트 로드 요청
      const testText = createNormalizedTestText()
      const fontSpec = `40px "${fontName}"`

      await document.fonts.load(fontSpec, testText)

      // 2. 폰트가 실제로 사용 가능한지 검증
      const isReady = document.fonts.check(fontSpec)
      if (!isReady) {
        throw new Error(`폰트 로드는 완료되었으나 사용 불가: ${fontName}`)
      }

      // 3. 브라우저가 폰트 메트릭을 완전히 계산할 시간 확보
      // requestAnimationFrame 2회 + 추가 대기
      await new Promise(resolve => requestAnimationFrame(resolve))
      await new Promise(resolve => requestAnimationFrame(resolve))
      await new Promise(resolve => setTimeout(resolve, 30))

      // 4. 최종 검증
      const finalCheck = document.fonts.check(fontSpec)
      if (!finalCheck) {
        throw new Error(`폰트 최종 검증 실패: ${fontName}`)
      }

    } catch (error) {
      console.error(`네이티브 폰트 로딩 실패: ${fontName}`, error)
      throw error
    }
  }

  beforeLoad(): Promise<void> {
    return Promise.resolve()
  }

  /**
   * 폰트 리소스만 로드 (객체에 적용하지 않음)
   * loadJSON 전 사전 로딩용
   */
  public async ensureFontLoaded(name: string): Promise<void> {
    const matchedFont = findFontVariantMatch(name, this.fontLoadingStatus)
    const targetFont = matchedFont || normalizeFontName(name)

    // 이미 로드된 폰트
    if (this.fontLoadingStatus.get(targetFont) === 'loaded') {
      return
    }

    // 로딩 중인 폰트는 대기
    if (this.fontLoadingStatus.get(targetFont) === 'loading') {
      return new Promise((resolve, reject) => {
        if (!this.loadingQueue.has(targetFont)) {
          this.loadingQueue.set(targetFont, [])
        }
        this.loadingQueue.get(targetFont)!.push({ object: null, resolve, reject })
      })
    }

    // 새로운 폰트 로딩 (객체 없이)
    return this.loadFontWithRetry(targetFont, null, 1)
  }

  /**
   * 이미 로드된 폰트를 객체에 안전하게 적용
   * afterLoad에서 실제 객체에 적용할 때 사용
   */
  public async applyFontToObject(object: fabric.Object, name: string): Promise<void> {
    const matchedFont = findFontVariantMatch(name, this.fontLoadingStatus)
    const targetFont = matchedFont || normalizeFontName(name)

    // 폰트가 로드되지 않았으면 먼저 로드
    if (this.fontLoadingStatus.get(targetFont) !== 'loaded') {
      dwarn('font', `폰트가 로드되지 않음, 먼저 로드 시도: ${targetFont}`)
      await this.ensureFontLoaded(targetFont)
    }

    // 1. 폰트 설정
    object.set('fontFamily', targetFont)

    // 2. 브라우저가 폰트 메트릭을 계산할 시간 확보
    // ⚠️ requestAnimationFrame 은 백그라운드/숨김 탭(임베드 iframe 비활성)에서 정지되어
    //   영원히 대기할 수 있다 → 폰트 적용(afterLoad)이 hang → 복원 콜백 미발화.
    //   setTimeout 과 race 하여 RAF 정지 시에도 진행 보장.
    const rafOrTimeout = () =>
      Promise.race([
        new Promise<void>(resolve => requestAnimationFrame(() => resolve())),
        new Promise<void>(resolve => setTimeout(resolve, 200)),
      ])
    await rafOrTimeout()
    await rafOrTimeout()

    // 3. 크기 재계산 (폰트 메트릭이 반영된 후)
    object.initDimensions()
    object.dirty = true
    object.setCoords()

    // 4. 렌더링
    this._canvas.requestRenderAll()
  }

  /**
   * 레거시 호환용: 폰트 로드 + 적용을 한 번에
   * @deprecated 새 코드에서는 ensureFontLoaded()와 applyFontToObject()를 분리해서 사용하세요
   */
  public async applyFont(name: string, object: fabric.Object | null): Promise<void> {
    // 폰트 로드 먼저
    await this.ensureFontLoaded(name)

    // 객체가 있으면 적용
    if (object) {
      await this.applyFontToObject(object, name)
    }
  }

  /**
   * TTF 버퍼를 폰트패밀리별로 캐싱하여 반환
   * @param fontFamily - 폰트 패밀리 이름
   * @returns TTF buffer (ArrayBuffer)
   */
  private async getTtfBuffer(fontFamily: string): Promise<ArrayBuffer> {
    // 캐시 확인
    if (this.ttfBufferCache.has(fontFamily)) {
      dlog('font', `✅ TTF buffer cache hit: ${fontFamily}`)
      return this.ttfBufferCache.get(fontFamily)!
    }
    // 음수 캐시: 직전에 실패한 폰트는 네트워크 재시도 없이 즉시 실패 처리
    if (this.ttfBufferFailed.has(fontFamily)) {
      throw new Error(`TTF buffer unavailable (cached miss): ${fontFamily}`)
    }

    dlog('font', `📥 TTF buffer cache miss, fetching: ${fontFamily}`)

    try {
      // 폰트 파일 URL 가져오기 (woff2 / ttf / otf 가능)
      const fontUrl = this._getWoff2FontUrl(fontFamily)
      if (!fontUrl) {
        throw new Error(`WOFF2 font URL not found for: ${fontFamily}`)
      }

      let ttfBuffer: ArrayBuffer

      // Fast-path: 원본이 이미 TTF/OTF 면 opentype.js 가 직접 파싱 가능하므로
      // 서버 변환(woff2ToTtf) 없이 폰트 바이트를 그대로 받아온다.
      // (?query 가 붙은 URL 도 대응하기 위해 확장자를 정규화 후 검사)
      const pathname = fontUrl.split(/[?#]/)[0].toLowerCase()
      const isSfnt = pathname.endsWith('.ttf') || pathname.endsWith('.otf')

      if (isSfnt) {
        dlog('font', `⏩ TTF/OTF 원본 직접 로드 (변환 스킵): ${fontUrl}`)
        ttfBuffer = await this.fetchFontArrayBuffer(fontUrl)
      } else {
        // woff2 → TTF 변환은 서버(NestJS API)에서 수행.
        // ⚠️ 반드시 API 오리진을 향해야 한다. 상대 '/api/woff2ToTtf' 는
        //   프로덕션(Vercel 에디터 오리진)에서 404 가 난다.
        // apiBaseUrl 은 전역 프리픽스 '/api' 까지 포함 (예: https://api.papascompany.co.kr/api).
        // NestJS 라우트는 'library/woff2ToTtf' → 최종 '/api/library/woff2ToTtf'.
        // apiBaseUrl 미주입(레거시/테스트) 시 상대 경로 폴백.
        const base = this.apiBaseUrl ?? '/api'
        const endpoint = `${base}/library/woff2ToTtf`
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            woff2Url: fontUrl
          })
        })

        if (!response.ok) {
          throw new Error(`woff2ToTtf API failed: ${response.status} ${response.statusText}`)
        }

        ttfBuffer = await response.arrayBuffer()
      }

      dlog('font', `✅ TTF buffer received: ${ttfBuffer.byteLength} bytes`)

      // 캐시에 저장
      this.ttfBufferCache.set(fontFamily, ttfBuffer)

      return ttfBuffer
    } catch (err) {
      // 실패 폰트 기록 → 같은 폰트 재요청 시 즉시 단락(반복 fetch 방지)
      this.ttfBufferFailed.add(fontFamily)
      throw err
    }
  }

  /**
   * 텍스트 객체를 path 객체로 변환
   * SVG 기반 벡터화 (convertSvgTextToPath 사용)
   *
   * ### 지원 기능:
   * - ✅ 회전 (angle), 기울임 (skewX, skewY), 반전 (flipX, flipY)
   * - ✅ 혼합 스타일 (runs) - fontSize, fontWeight, fill 등
   * - ✅ 다중 줄 텍스트
   *
   * @param textObj - 변환할 텍스트 객체 (Text, IText, Textbox)
   * @returns 벡터화된 Group 객체 (실패 시 null)
   */
  public async convertTextToPath(
    textObj: fabric.Text | fabric.IText | fabric.Textbox
  ): Promise<fabric.Object | null> {
    try {
      dlog('font', `🔄 SVG 기반 텍스트 벡터화 시작: "${textObj.text}" (${textObj.fontFamily})`)

      // 1. textObj를 SVG로 변환
      const svgString = textObj.toSVG()

      // 2. 기본 폰트와 styles 속성의 모든 폰트 수집
      const fontFamily = textObj.fontFamily || 'Arial'
      const fontsToLoad = new Set<string>([fontFamily])

      // styles 속성에서 사용된 폰트도 수집
      const styles = (textObj as any).styles
      if (styles && typeof styles === 'object') {
        Object.values(styles).forEach((lineStyles: any) => {
          if (lineStyles && typeof lineStyles === 'object') {
            Object.values(lineStyles).forEach((charStyle: any) => {
              if (charStyle?.fontFamily && typeof charStyle.fontFamily === 'string') {
                fontsToLoad.add(charStyle.fontFamily)
              }
            })
          }
        })
      }

      dlog('font', `📦 벡터화에 필요한 폰트: ${Array.from(fontsToLoad).join(', ')}`)

      // 3. 모든 폰트의 TTF buffer를 미리 로드 (캐싱됨)
      // 이렇게 하면 toSVG()에서 생성된 SVG 내의 각 tspan의 font-family가
      // convertSvgTextToPath에서 올바르게 처리될 수 있도록 준비됨
      for (const font of fontsToLoad) {
        try {
          await this.getTtfBuffer(font)
          dlog('font', `✅ TTF buffer loaded for vectorization: ${font}`)
        } catch (err) {
          dwarn('font', `⚠️ TTF buffer 로드 실패, 스킵: ${font}`, err)
        }
      }

      // 4. 기본 폰트의 TTF buffer (convertSvgTextToPath에 전달)
      const mainTtfBuffer = await this.getTtfBuffer(fontFamily)

      // 5. SVG text → path 변환
      // 주의: convertSvgTextToPath는 현재 단일 폰트만 지원
      // styles 속성의 다른 폰트들은 SVG의 tspan 요소에 font-family로 인라인 포함되며,
      // 브라우저 렌더링 시 이미 로드된 폰트가 사용됨
      dlog('font', '🔄 Converting SVG text to paths...')
      const { svg: pathSvg } = await convertSvgTextToPath(mainTtfBuffer, svgString)

      // 4. Fabric.js로 로드
      return new Promise((resolve, reject) => {
        fabric.loadSVGFromString(pathSvg, (objects) => {
          if (!objects || objects.length === 0) {
            console.error('❌ No objects loaded from SVG')
            reject(new Error('Failed to load SVG'))
            return
          }

          const group = new fabric.Group(objects)
          dlog('font', `✅ 텍스트 벡터화 완료: "${textObj.text}"`)
          resolve(group)
        })
      })
    } catch (error) {
      console.error('텍스트 벡터화 중 오류:', error)
      return null
    }
  }

  private buildProxiedUrl(originalUrl: string): string {
    if (!this.fontProxy) return originalUrl
    if (typeof this.fontProxy === 'function') {
      return this.fontProxy(originalUrl)
    }
    const hasQuery = this.fontProxy.includes('?')
    const joiner = hasQuery ? '&' : '?'
    return `${this.fontProxy}${joiner}url=${encodeURIComponent(originalUrl)}`
  }

  private async fetchFontArrayBuffer(originalUrl: string): Promise<ArrayBuffer> {
    const url = this.buildProxiedUrl(originalUrl)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`폰트 다운로드 실패: ${response.status} ${response.statusText} (${url})`)
    }
    return await response.arrayBuffer()
  }

  // 필수 폰트들을 미리 로드하는 함수
  private async preloadEssentialFonts(fontList: FontSource[], defaultFont: string): Promise<void> {

    try {
      // 기본 폰트를 fontList에서 찾기 (정확한 매칭)
      const normalizedDefaultFont = normalizeFontName(defaultFont)
      const defaultFontInfo = fontList.find((font) => {
        const normalizedFontName = normalizeFontName(font.name)
        return normalizedFontName === normalizedDefaultFont
      })

      if (defaultFontInfo) {
        // 기본 폰트를 실제로 로드
        await this.loadFont(defaultFontInfo)
      } else {
        dwarn('font', `❌ 기본 폰트를 fontList에서 찾을 수 없음: ${defaultFont}`)
      }
    } catch (err) {
      console.error('필수 폰트 로딩 중 오류:', err)
    }
  }

  private applyFallbackFont(object: fabric.Object): void {
    object.set('fontFamily', 'Arial, sans-serif')
    object.setCoords()
    this._canvas.requestRenderAll()
  }

  private async processLoadingQueue(fontName: string, success: boolean, error?: any): Promise<void> {
    const queue = this.loadingQueue.get(fontName)
    if (!queue) return

    // 대기 중인 모든 요청 처리
    for (const { object, resolve, reject } of queue) {
      if (success) {
        // 폰트 로드 성공
        if (object) {
          // 객체가 있으면 안전하게 적용
          try {
            await this.applyFontToObject(object, fontName)
            resolve()
          } catch (err) {
            console.error('폰트 적용 중 오류:', err)
            this.applyFallbackFont(object)
            reject(err)
          }
        } else {
          // 객체 없음 (폰트 리소스만 로드)
          resolve()
        }
      } else {
        // 폰트 로드 실패
        if (object) {
          this.applyFallbackFont(object)
        }
        reject(error)
      }
    }

    this.loadingQueue.delete(fontName)
  }

  private async loadFontWithRetry(
    name: string,
    object: fabric.Object | null,
    retries: number
  ): Promise<void> {
    this.fontLoadingStatus.set(name, 'loading')

    for (let i = 0; i < retries; i++) {
      try {
        // 1. 네이티브 API로 폰트 리소스 로딩
        await this.loadFontNative(name)

        this.fontLoadingStatus.set(name, 'loaded')

        // 2. 객체가 있으면 폰트 적용 (선택적)
        if (object) {
          await this.applyFontToObject(object, name)
        }

        // 3. 대기열의 다른 요청들도 처리
        await this.processLoadingQueue(name, true)
        return
      } catch (err) {
        dwarn('font', `폰트 로딩 시도 ${i + 1}/${retries} 실패:`, name, err)

        if (i === retries - 1) {
          // 최종 실패 시 처리
          this.fontLoadingStatus.set(name, 'failed')
          if (object) {
            this.applyFallbackFont(object)
          }
          await this.processLoadingQueue(name, false, err)
          throw new Error(`폰트 로딩 최종 실패: ${name}`)
        } else {
          // 지수적 백오프로 재시도 대기
          await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, i)))
        }
      }
    }
  }

  private createFontCSS(arr: FontSource[]): Promise<void> {
    return new Promise((resolve) => {
      let code = ''
      arr.forEach((item) => {
        if (
          ['arial', 'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy'].includes(
            item.name.toLowerCase()
          )
        )
          return

        // 기본 NFD로 정규화하고 모든 정규화 변형(NFD/NFC)을 맵에 저장
        const serverFontName = normalizeFontName(item.name)
        const nameVariants = getNormalizedVariants(item.name)
        for (const variant of nameVariants) {
          this.fontUrlByName.set(variant, item.src)
        }

        code += `
      @font-face {
        font-family: '${serverFontName}';
        src: url('${item.src}') format('woff2');
        font-display: swap;
        font-style: normal;
        font-weight: normal;
      }
      `
      })

      if (!code) {
        resolve()
        return
      }

      const styleId = 'dynamic-font-faces'
      let style = document.getElementById(styleId) as HTMLStyleElement | null
      if (!style) {
        style = document.createElement('style')
        style.id = styleId
        document.head.appendChild(style)
      }

      style.textContent = code

      dlog('font', '📝 폰트 CSS 생성 완료 (NFD 기본 사용)')

      // CSS가 완전히 적용될 시간을 충분히 제공
      requestAnimationFrame(() => {
        // 브라우저가 CSS를 파싱하고 폰트 정보를 준비할 시간 제공
        setTimeout(() => {
          dlog('font', '📝 폰트 CSS 적용 대기 완료')
          resolve()
        }, 300) // 100ms에서 300ms로 증가
      })
    })
  }

  /**
   * 텍스트가 현재 폰트에서 지원되는지 검증 (클라이언트 측 처리)
   * @param text 검증할 텍스트
   * @param fontFamily 폰트 이름
   * @returns 검증 결과 { hasMissingGlyphs: boolean, missingChars: string[] }
   */
  public async validateTextGlyphs(
    text: string,
    fontFamily: string
  ): Promise<{ hasMissingGlyphs: boolean; missingChars: string[] }> {
    try {
      dlog('font', `🔍 [validateTextGlyphs] 시작 - 폰트: "${fontFamily}", 텍스트 길이: ${text.length}`)

      // 1. TTF buffer 가져오기 (캐싱됨)
      const ttfBuffer = await this.getTtfBuffer(fontFamily)
      dlog('font', `✅ TTF buffer retrieved: ${ttfBuffer.byteLength} bytes`)

      // 2. 클라이언트 측 글리프 검증 실행
      const result = await validateGlyphs(ttfBuffer, text)

      dlog('font', `✅ [validateTextGlyphs] 검증 완료 - 미지원 문자 수: ${result.missingChars.length}`)
      if (result.missingChars.length > 0) {
        dlog('font', `⚠️ [validateTextGlyphs] 미지원 문자:`, result.missingChars)
      }

      return {
        hasMissingGlyphs: result.hasMissingGlyphs,
        missingChars: result.missingChars
      }
    } catch (error) {
      console.error('글리프 검증 오류:', error)
      return { hasMissingGlyphs: false, missingChars: [] }
    }
  }

  /**
   * 폰트 이름으로 WOFF2 파일 URL 찾기
   */
  private _getWoff2FontUrl(fontFamily: string): string | null {
    // 0) 맵에 저장된 폰트 URL 우선 조회 (정규화 변형 모두 시도)
    const variants = getNormalizedVariants(fontFamily)
    for (const variant of variants) {
      const mapped = this.fontUrlByName.get(variant)
      if (mapped) {
        return mapped
      }
    }

    // 1) 현재 로드된 폰트들의 CSS에서 WOFF2 파일 URL 추출 (폴백)
    const normalizedFontName = normalizeFontName(fontFamily)

    // CSS에서 @font-face 규칙 찾기
    const styleSheets = Array.from(document.styleSheets)
    for (const sheet of styleSheets) {
      try {
        const rules = Array.from(sheet.cssRules || sheet.rules)
        for (const rule of rules) {
          if (rule.type === CSSRule.FONT_FACE_RULE) {
            const fontFace = rule as CSSFontFaceRule
            const fontFamilyValue = fontFace.style.getPropertyValue('font-family')

            if (fontFamilyValue.includes(normalizedFontName)) {
              // src 속성에서 WOFF2 URL 추출
              const src = fontFace.style.getPropertyValue('src')
              const woff2Match = src.match(/url\(['"]?([^'")]+\.woff2[^'")]*)/i)
              if (woff2Match) {
                return woff2Match[1]
              }
            }
          }
        }
      } catch (e) {
        // CORS 오류 등으로 접근할 수 없는 스타일시트는 무시

      }
    }

    return null
  }
}

export default FontPlugin
