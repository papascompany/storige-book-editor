import Editor from '../Editor'
import { fabric } from 'fabric'
import { PluginBase, PluginOption } from '../plugin'
import ImageProcessingPlugin from './ImageProcessingPlugin'
import { jsPDF } from 'jspdf'
import { svg2pdf } from 'svg2pdf.js'
import FontPlugin from './FontPlugin'
import { convertFabricObjectToSVGString, core, mmToPx, pxToMm } from '../utils'
import { dlog } from '../utils/debugLog'

class ServicePlugin extends PluginBase {
  name = 'ServicePlugin'
  events = []
  hotkeys = []
  readonly imagePlugin: ImageProcessingPlugin

  /**
   * P0-3 (2026-06-02): PDF 합성 시 이미지 다운스케일 상한(px).
   * 종전 1280/1536/1600/2048 캡은 300 DPI A4(≈2480×3508px) 미달 → 인쇄 부적합 화질.
   * 300 DPI × A4 장변(297mm) ≈ 3508px 로 통일하여 원본급 화질 보존(요구 #11·#12).
   * (svg2pdf callstack 회피용 timeout/try-catch/null 폴백은 기존대로 유지.)
   */
  private static readonly PRINT_MAX_IMAGE_DIMENSION = 3508

  constructor(
    canvas: fabric.Canvas,
    editor: Editor,
    imagePlugin: ImageProcessingPlugin,
    options: PluginOption
  ) {
    super(canvas, editor, options)
    this.imagePlugin = imagePlugin
  }

  /**
   * 여러 캔버스의 PDF를 생성하고 파일로 저장하는 함수
   * @param canvases 대상 캔버스 배열
   * @param editors 각 캔버스에 대응하는 에디터 배열
   * @param fileName 저장할 파일명 (확장자 제외)
   * @param size 사이즈 정보 객체
   * @param cutLine 마지막 페이지에 추가할 칼선 오브젝트 (선택 사항)
   * @param dpi 저장할 PDF의 DPI (기본값 72)
   * @returns Promise<void>
   */
  async saveMultiPagePDF(
    canvases: fabric.Canvas[],
    editors: Editor[],
    fileName: string = 'project',
    size: {
      width: number
      height: number
      cutSize: number
      printSize?: { width: number; height: number }
    },
    cutLine?: fabric.Object,
    dpi: number = 72
  ): Promise<void> {
    await this._createMultiPagePDF(
      canvases,
      editors,
      fileName,
      size,
      cutLine,
      false,
      dpi
    )
  }
  /**
   * SVG 내의 문제가 있는 base64 이미지 데이터를 처리하는 함수
   * 대용량 이미지로 인한 callstack 오류 방지를 위한 최적화 포함
   * @param svgElement SVG 엘리먼트
   */
  private async _processSvgImages(svgElement: Element): Promise<void> {
    try {
      const imageElements = svgElement.querySelectorAll('image')
      console.log(`SVG 내 이미지 처리 시작: ${imageElements.length}개 발견`)

      for (const imageElement of imageElements) {
        const href = imageElement.getAttribute('href') || imageElement.getAttribute('xlink:href')

        if (href && href.startsWith('data:image/')) {
          // MIME 및 인코딩 정보 파싱
          const headerPart = href.substring(0, href.indexOf(','))
          const mimeType = headerPart.split(';')[0].split(':')[1]
          const isBase64Header = /;base64/i.test(headerPart)

          // base64 정규화된 data URL 준비
          const normalizedHref = isBase64Header ? this._normalizeDataUrl(href) : href

          // 대용량 이미지 감지 (2MB 임계값)
          const isLargeImage = normalizedHref.length > 5 * 1024 * 1024
          console.log(
            `이미지 크기: ${(normalizedHref.length / 1024 / 1024).toFixed(2)}MB, 대용량: ${isLargeImage}`
          )

          // base64는 디코딩하지 않고, 이후 캔버스 기반 변환으로 처리 (정규화된 data URL 사용)

          // 허용된 이미지 형식 검증 및 필요시 PNG로 변환
          if (
            !mimeType ||
            !['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'].includes(
              mimeType
            )
          ) {
            console.warn('지원되지 않는 이미지 형식:', mimeType)
            imageElement.remove()
            continue
          }

          // 대용량 이미지에 대한 특별 처리
          if (isLargeImage) {
            console.log('대용량 이미지 압축 처리 시작')
            const compressedImageData = await this._compressLargeImage(normalizedHref, mimeType)
            if (compressedImageData) {
              imageElement.setAttribute('href', compressedImageData)
              imageElement.setAttribute('xlink:href', compressedImageData)
              console.log(
                `이미지 압축 완료: ${(compressedImageData.length / 1024 / 1024).toFixed(2)}MB`
              )
            } else {
              console.warn('대용량 이미지 압축 실패, 이미지 제거')
              imageElement.remove()
            }
            continue
          }

          // JPEG은 PNG로 변환하지 않고 JPEG로 용량 압축해 인라인 크기 축소 (callstack 이슈 회피)
          if (mimeType === 'image/jpeg') {
            const compressedJpeg = await this._compressLargeImage(normalizedHref, 'image/jpeg', 0.8)
            if (compressedJpeg) {
              imageElement.setAttribute('href', compressedJpeg)
              imageElement.setAttribute('xlink:href', compressedJpeg)
            } else {
              // 최후 수단: 해상도 축소 후 JPEG 재인코딩 시도
              const fallbackPng = await this._rasterizeDataUrlToPng(normalizedHref)
              if (fallbackPng && fallbackPng.length < normalizedHref.length) {
                imageElement.setAttribute('href', fallbackPng)
                imageElement.setAttribute('xlink:href', fallbackPng)
              } else {
                imageElement.remove()
              }
            }
            continue
          }

          // PNG 압축 (시그니처 검증 없이 이미지 로드 실패 시 하위 로직에서 제거됨)
          if (mimeType === 'image/png') {
            if (normalizedHref.length > 1024 * 1024 * 5) {
              // 5MB
              const optimizedPng = await this._optimizePngImage(normalizedHref)
              if (optimizedPng) {
                imageElement.setAttribute('href', optimizedPng)
                imageElement.setAttribute('xlink:href', optimizedPng)
              }
            }
            continue
          }

          // SVG/GIF/WEBP → PNG 래스터라이즈 (svg2pdf 호환성 및 재귀 방지)
          if (
            mimeType === 'image/svg+xml' ||
            mimeType === 'image/gif' ||
            mimeType === 'image/webp'
          ) {
            const png = await this._rasterizeDataUrlToPng(normalizedHref)
            if (png) {
              imageElement.setAttribute('href', png)
              imageElement.setAttribute('xlink:href', png)
            } else {
              console.warn('래스터라이즈 실패, 이미지 제거')
              imageElement.remove()
            }
            continue
          }
        }
      }

      console.log('SVG 내 이미지 처리 완료')
    } catch (error) {
      console.warn('SVG 이미지 처리 중 오류:', error)
    }
  }

  /**
   * 여러 캔버스의 PDF를 단일 Blob으로 생성하는 함수
   * @param canvases 대상 캔버스 배열
   * @param editors 각 캔버스에 대응하는 에디터 배열
   * @param fileName 저장할 파일명 (확장자 제외)
   * @param size 사이즈 정보 객체
   * @param cutLine 마지막 페이지에 추가할 칼선 오브젝트 (선택 사항)
   * @param dpi 저장할 PDF의 DPI (기본값 72)
   * @returns Promise<Blob> PDF 데이터가 담긴 Blob 객체
   */
  async saveMultiPagePDFAsBlob(
    canvases: fabric.Canvas[],
    editors: Editor[],
    fileName: string = 'project',
    size: {
      width: number
      height: number
      cutSize: number
      printSize?: { width: number; height: number }
    },
    cutLine?: fabric.Object,
    dpi: number = 72
  ): Promise<Blob> {
    const result = await this._createMultiPagePDF(
      canvases,
      editors,
      fileName,
      size,
      cutLine,
      true,
      dpi
    )
    return result as Blob
  }

  saveJSON(): Promise<string> {
    return new Promise((resolve) => {
      this._editor.hooks.get('beforeSave').callAsync('', () => {
        // overlay export 가능하게
        const objects = this._canvas.getObjects()
        const shouldSave = objects.filter(
          (obj) => obj.extensionType === 'overlay' || obj.id === 'cutline-template'
        )
        for (const item of shouldSave) {
          item && (item.excludeFromExport = false)
        }

        const result = this._canvas.toJSON(core.extendFabricOption)

        console.log('Save JSON:', result)

        this._editor.hooks.get('afterSave').callAsync(result, () => {
          for (const item of shouldSave) {
            item && (item.excludeFromExport = true)
          }

          // afterSave 훅 실행 후 캔버스를 명시적으로 다시 렌더링
          // 모든 객체의 좌표를 재계산하여 상태 복원
          this._canvas.getObjects().forEach((obj) => {
            obj.setCoords()
            obj.dirty = true
          })
          this._canvas.requestRenderAll()

          resolve(JSON.stringify(result))
        })
      })
    })
  }

  beforeSave(...args: any[]): Promise<void> {
    return new Promise((r) => {
      r(...args)
    })
  }

  afterLoad(...args: any[]): Promise<void> {
    return new Promise((r) => {
      r(...args)
    })
  }

  afterSave(...args: any[]): Promise<void> {
    return new Promise((r) => {
      console.log('afterSave: service plugin')
      r(...args)
    })
  }

  // 객체 로드 후 처리 개선 (plugins/ServicePlugin.ts)
  loadJSON(jsonStr: string | object, callback?: () => void): void {
    this._canvas.offHistory()
    this._canvas.clear()

    // JSON 파싱하여 필요한 폰트 목록 추출
    const extractFontsFromJSON = (json: any): Set<string> => {
      const fonts = new Set<string>()

      const traverse = (obj: any) => {
        if (!obj) return

        // 1. 기본 fontFamily 추출
        if (obj.fontFamily && typeof obj.fontFamily === 'string') {
          fonts.add(obj.fontFamily)
        }

        // 2. styles 속성에서 문자별 fontFamily 추출 (i-text의 혼합 폰트 지원)
        if (obj.styles && typeof obj.styles === 'object') {
          // styles는 { 줄번호: { 문자인덱스: { fontFamily, fontSize, ... } } } 구조
          Object.values(obj.styles).forEach((lineStyles: any) => {
            if (lineStyles && typeof lineStyles === 'object') {
              Object.values(lineStyles).forEach((charStyle: any) => {
                if (charStyle?.fontFamily && typeof charStyle.fontFamily === 'string') {
                  fonts.add(charStyle.fontFamily)
                }
              })
            }
          })
        }

        // 3. 재귀적으로 하위 객체 탐색 (objects 배열)
        if (obj.objects && Array.isArray(obj.objects)) {
          obj.objects.forEach(traverse)
        }

        // 4. 그룹 내부 객체들도 탐색 (_objects 배열)
        if (obj._objects && Array.isArray(obj._objects)) {
          obj._objects.forEach(traverse)
        }
      }

      // JSON 문자열인 경우 파싱
      const jsonObj = typeof json === 'string' ? JSON.parse(json) : json

      // 최상위 objects 배열 탐색
      if (jsonObj.objects && Array.isArray(jsonObj.objects)) {
        jsonObj.objects.forEach(traverse)
      }

      return fonts
    }

    this._editor.hooks.get('beforeLoad').callAsync(jsonStr, async () => {
      try {
        // 필요한 폰트 목록 추출
        const requiredFonts = extractFontsFromJSON(jsonStr)
        dlog('font', '📋 필요한 폰트 목록:', Array.from(requiredFonts))

        // FontPlugin 가져오기
        const fontPlugin = this._editor.getPlugin<FontPlugin>('FontPlugin')

        if (fontPlugin && requiredFonts.size > 0) {
          // 모든 폰트 리소스를 병렬로 로드 (객체 적용 없이)
          const fontLoadPromises = Array.from(requiredFonts).map((fontName) => {
            dlog('font', `🔄 폰트 리소스 로드 시작: ${fontName}`)
            // ⚠️ ensureFontLoaded 가 끝내 resolve/reject 되지 않으면 beforeLoad 가 hang →
            //   loadFromJSON 자체가 호출 안 됨. per-font 5s 타임아웃으로 항상 진행 보장.
            return Promise.race([
              fontPlugin.ensureFontLoaded(fontName),
              new Promise((resolve) => setTimeout(resolve, 5000)),
            ])
              .then(() => {
                dlog('font', `✅ 폰트 리소스 로드 완료: ${fontName}`)
              })
              .catch((err) => {
                console.warn(`⚠️ 폰트 리소스 로드 실패 (계속 진행): ${fontName}`, err)
                // 폰트 로드 실패해도 계속 진행
              })
          })

          // 모든 폰트 로드 대기 (allSettled — 일부 실패해도 전체 진행)
          await Promise.allSettled(fontLoadPromises)
          dlog('font', '✅ 모든 폰트 리소스 로드 완료')
        }

        // 폰트 로드 완료 후 JSON 로드
        // ⚠️ fabric loadFromJSON 콜백은 객체 내 이미지(fillImage/accessory 등) 로드 실패 시
        //   호출되지 않을 수 있다(특히 스프레드 표지). 콜백 미발화 시 afterLoad/콜백 체인이
        //   영원히 멈추므로(=복원 오버레이 hang), once 가드 + 4s 타임아웃으로 항상 후처리 진행.
        let postLoadDone = false
        const onLoaded = () => {
          if (postLoadDone) return
          postLoadDone = true
          // 모든 객체의 좌표 및 상태 강제 업데이트
          const renderType = (this._canvas as any)?.renderType || (this._options as any)?.renderType
          const isEnvelope = renderType === 'envelope'

          // 봉투 타입이 아닌 경우에만 group/image clipPath 제거
          if (!isEnvelope && (this._canvas.clipPath?.type === 'group' || this._canvas.clipPath?.type === 'image')) {
            this._canvas.clipPath = null
          }

          this._canvas.getObjects().forEach((obj) => {
            // overlay 객체 처리
            if (obj.extensionType === 'overlay') {
              obj.visible = true
            }

            // outline 객체는 clipPath 제거 (직렬화 잔여물 청소)
            if (obj.extensionType === 'outline' && obj.clipPath) {
              obj.clipPath = null
            }

            if (obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') {
              obj.set({
                lockScalingX: true,
                lockScalingY: true,
                hasControls: false
              })
            }

            obj.setCoords()
            obj.dirty = true
          })

          console.log('Load JSON:', jsonStr)

          this._editor.hooks.get('afterLoad').callAsync(jsonStr, async () => {
            // afterLoad: 로드된 객체에 폰트 적용
            if (fontPlugin && requiredFonts.size > 0) {
              dlog('font', '🎨 객체에 폰트 적용 시작')

              // 모든 텍스트 객체를 재귀적으로 수집 (그룹 내부 포함)
              const collectTextObjects = (obj: fabric.Object): fabric.Object[] => {
                const results: fabric.Object[] = []

                // 텍스트 객체인 경우 추가
                if (obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') {
                  results.push(obj)
                }

                // 그룹인 경우 내부 객체들도 재귀 탐색
                if (obj.type === 'group' && (obj as any)._objects) {
                  const group = obj as fabric.Group
                  group._objects.forEach((child) => {
                    results.push(...collectTextObjects(child))
                  })
                }

                return results
              }

              // 캔버스의 모든 객체에서 텍스트 객체 수집
              const allTextObjects: fabric.Object[] = []
              this._canvas.getObjects().forEach((obj) => {
                allTextObjects.push(...collectTextObjects(obj))
              })

              console.log(`📝 텍스트 객체 ${allTextObjects.length}개 발견`)

              // 각 텍스트 객체에 기본 폰트 + styles 폰트 모두 적용
              for (const obj of allTextObjects) {
                // 1. 기본 fontFamily 적용
                const baseFontFamily = (obj as any).fontFamily
                if (baseFontFamily && typeof baseFontFamily === 'string' && requiredFonts.has(baseFontFamily)) {
                  try {
                    await fontPlugin.applyFontToObject(obj, baseFontFamily)
                    dlog('font', `✅ 객체에 폰트 적용 완료 (기본): ${baseFontFamily}`)
                  } catch (err) {
                    console.warn(`⚠️ 객체에 폰트 적용 실패 (기본): ${baseFontFamily}`, err)
                  }
                }

                // 2. styles 속성의 각 문자별 폰트도 개별 적용 (혼합 폰트 지원)
                const styles = (obj as any).styles
                if (styles && typeof styles === 'object') {
                  const stylesFontsSet = new Set<string>()

                  // styles에서 사용된 모든 폰트 수집
                  Object.values(styles).forEach((lineStyles: any) => {
                    if (lineStyles && typeof lineStyles === 'object') {
                      Object.values(lineStyles).forEach((charStyle: any) => {
                        if (charStyle?.fontFamily && typeof charStyle.fontFamily === 'string') {
                          stylesFontsSet.add(charStyle.fontFamily)
                        }
                      })
                    }
                  })

                  // styles에서 추출한 각 폰트 적용
                  for (const styleFont of stylesFontsSet) {
                    if (requiredFonts.has(styleFont)) {
                      try {
                        dlog('font', `🔄 객체에 폰트 적용 (styles): ${styleFont}`)
                        // styles 폰트는 이미 ensureFontLoaded로 로드되었지만,
                        // 명시적으로 한 번 더 적용하여 폰트 메트릭 보장
                        await fontPlugin.applyFontToObject(obj, styleFont)
                        dlog('font', `✅ 객체에 폰트 적용 완료 (styles): ${styleFont}`)
                      } catch (err) {
                        console.warn(`⚠️ 객체에 폰트 적용 실패 (styles): ${styleFont}`, err)
                      }
                    }
                  }
                }
              }

              dlog('font', '✅ 모든 객체에 폰트 적용 완료')
            }

            this._canvas.requestRenderAll()
            this._canvas.onHistory()
            if (callback) {
              callback()
            }
          })
        }
        this._canvas.loadFromJSON(jsonStr, onLoaded)
        setTimeout(() => {
          if (!postLoadDone) {
            console.warn('[ServicePlugin] loadFromJSON 콜백 미발화(4s) — afterLoad/콜백 강제 진행')
            onLoaded()
          }
        }, 4000)
      } catch (error) {
        console.error('❌ JSON 로드 중 오류:', error)
        // 에러 발생 시에도 기본 로드는 시도
        this._canvas.loadFromJSON(jsonStr, () => {
          this._editor.hooks.get('afterLoad').callAsync(jsonStr, () => {
            this._canvas.requestRenderAll()
            this._canvas.onHistory()
            if (callback) {
              callback()
            }
          })
        })
      }
    })
  }

  /**
   * 여러 캔버스의 PDF를 생성하는 함수 (저장 또는 Blob 반환)
   * @param canvases 대상 캔버스 배열
   * @param editors 각 캔버스에 대응하는 에디터 배열
   * @param fileName 저장할 파일명 (확장자 제외)
   * @param size 사이즈 정보 객체
   * @param cutLine 마지막 페이지에 추가할 칼선 오브젝트 (선택 사항)
   * @param returnBlob true인 경우 PDF Blob 반환, false인 경우 파일 저장
   * @param dpi 저장할 PDF의 DPI (기본값 150)
   * @param colorMode
   * @returns Promise<Blob|void> returnBlob이 true이면 PDF Blob 반환, 아니면 void
   */
  private _createMultiPagePDF(
    canvases: fabric.Canvas[],
    editors: Editor[],
    fileName: string = 'project',
    size: {
      width: number
      height: number
      cutSize: number
      printSize?: { width: number; height: number }
    },
    cutLine?: fabric.Object,
    returnBlob: boolean = false,
    dpi: number = 150,
  ): Promise<Blob | void> {
    return new Promise((resolve, reject) => {
      // 봉투 타입인 경우 칼선의 원본 상태를 저장 (모든 캔버스에 대해)
      const isEnvelope = this._options.renderType === 'envelope'
      const envelopeOption = isEnvelope ? (this._options as any)?.envelopeOption : undefined
      const cutlineStates: Array<{ canvas: fabric.Canvas; template: fabric.Object; originalVisible: boolean }> = []
      const canvasStates: Array<{ canvas: fabric.Canvas; editor: Editor; originalState: any }> = []

      const processPages = async () => {
        try {
          // PDF 저장 전 모든 텍스트 객체에 대한 글리프 검증
          console.log('🔍 PDF 저장 시작 - processPages 함수 실행됨')
          const fontPlugin = this._editor.getPlugin<FontPlugin>('FontPlugin')
          dlog('font', '🔍 fontPlugin:', fontPlugin, 'validateTextGlyphs 존재:', typeof fontPlugin?.validateTextGlyphs)
          
          if (fontPlugin && typeof fontPlugin.validateTextGlyphs === 'function') {
            console.log('🔍 PDF 저장 전 글리프 검증 시작...')
            
            const allMissingChars: Map<string, string[]> = new Map() // 폰트명 -> 미지원 문자 배열

            const collectTextObjects = (obj: fabric.Object): fabric.Object[] => {
              const results: fabric.Object[] = []
              if (obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') {
                results.push(obj)
              }
              if (obj.type === 'group' && (obj as any)._objects) {
                const group = obj as fabric.Group
                group._objects.forEach((child) => {
                  results.push(...collectTextObjects(child))
                })
              }
              return results
            }

            // 1) 폰트별 사용 문자 집합 수집(중복 제거) — 텍스트마다 검증하던 것을 폰트당 1회로 축소
            const fontCharSets = new Map<string, Set<string>>()
            for (const canvas of canvases) {
              const textObjects: fabric.Object[] = []
              canvas.getObjects().forEach((obj) => {
                textObjects.push(...collectTextObjects(obj))
              })
              for (const textObj of textObjects) {
                const text = (textObj as any).text || ''
                const fontFamily = (textObj as any).fontFamily || ''
                if (text && fontFamily) {
                  let set = fontCharSets.get(fontFamily)
                  if (!set) {
                    set = new Set<string>()
                    fontCharSets.set(fontFamily, set)
                  }
                  for (const ch of text as string) set.add(ch)
                }
              }
            }

            // 2) 폰트별 고유문자 1회 검증 — 병렬 실행(폰트 TTF 음수캐시와 결합해 반복 fetch 제거)
            await Promise.all(
              Array.from(fontCharSets.entries()).map(async ([fontFamily, charsSet]) => {
                const uniqueChars = Array.from(charsSet).join('')
                try {
                  const validation = await fontPlugin.validateTextGlyphs(uniqueChars, fontFamily)
                  if (validation.hasMissingGlyphs && validation.missingChars.length > 0) {
                    allMissingChars.set(fontFamily, validation.missingChars)
                  }
                } catch (error) {
                  console.warn(`글리프 검증 실패 (폰트: ${fontFamily}):`, error)
                }
              }),
            )
            
            // 미지원 문자가 있는 경우 사용자에게 경고
            if (allMissingChars.size > 0) {
              console.warn('⚠️ PDF 저장 전 미지원 문자 발견:', allMissingChars)
              
              // 경고 메시지 구성
              const fontMessages: string[] = []
              for (const [fontFamily, missingChars] of allMissingChars.entries()) {
                const charList = missingChars.slice(0, 5).map(c => `'${c}'`).join(', ')
                const moreText = missingChars.length > 5 ? ` 외 ${missingChars.length - 5}개` : ''
                fontMessages.push(`${fontFamily}: ${charList}${moreText}`)
              }
              
              const warningMessage = 
                `일부 폰트에서 지원하지 않는 문자가 있습니다:\n\n${fontMessages.join('\n')}\n\n` +
                `이 문자들은 PDF 저장 시 빈 공간으로 나타날 수 있습니다.\n계속 진행하시겠습니까?`
              
              const shouldContinue = window.confirm(warningMessage)
              
              if (!shouldContinue) {
                throw new Error('사용자가 PDF 저장을 취소했습니다 (미지원 문자 발견)')
              }
            } else {
              dlog('font', '✅ 모든 텍스트가 폰트에서 지원됩니다')
            }
          }
          
          // 첫 번째 캔버스 기준으로 PDF 크기 설정
          const firstCanvas = canvases[0]
          const firstWorkspace = firstCanvas.getObjects().find((obj) => obj.id === 'workspace')

          if (!firstWorkspace) {
            throw new Error('첫 번째 캔버스에서 워크스페이스를 찾을 수 없습니다')
          }

          // 스프레드 내지 캔버스는 addInnerPage 경로로 생성되어 unitOptions 가 없을 수 있다.
          // (표지 ServicePlugin 으로 내지 PDF 를 생성하므로 firstCanvas=내지) → 옵셔널 체이닝 + 기본 'mm'.
          const unit = firstCanvas.unitOptions?.unit ?? 'mm'

          console.log('PDF 생성 정보:')
          console.log('- Canvas 단위:', unit)
          console.log('- 전달된 size:', size)
          console.log('- DPI:', dpi)

          // PDF는 항상 mm 단위로 생성
          // 1) 콘텐츠 크기(mm)
          let contentWidth = size.width
          let contentHeight = size.height

          if (unit === 'px') {
            // px를 mm로 변환 (DPI 고려)
            contentWidth = pxToMm(contentWidth, dpi)
            contentHeight = pxToMm(contentHeight, dpi)
          }

          if (isEnvelope) {
            contentWidth = envelopeOption.size.width
            contentHeight = envelopeOption.size.height
          }

          // 2) 페이지 크기(mm) - printSize가 있으면 우선 사용
          let pageWidth = contentWidth
          let pageHeight = contentHeight
          if (size.printSize && size.printSize.width && size.printSize.height) {
            /// print size는 무조건 mm 단위
            pageWidth = size.printSize.width
            pageHeight = size.printSize.height
          }

          const orientation = pageWidth >= pageHeight ? 'l' : 'p'

          // 중앙 배치를 위한 오프셋(mm)
          let offsetX = Math.max(0, (pageWidth - contentWidth) / 2)
          let offsetY = Math.max(0, (pageHeight - contentHeight) / 2)

          // 봉투 타입인 경우 direction에 따라 오프셋 조정
          if (isEnvelope) {
            const envelopeOption = (this._options as any)?.envelopeOption

            if (envelopeOption && envelopeOption.direction) {
              const direction = envelopeOption.direction
              const envelopeCutline = canvases[0].getObjects().find((obj) => obj.id === 'cutline-template')
              let greenZoneObj: fabric.Object | undefined
              if (envelopeCutline && envelopeCutline.type === 'group') {
                greenZoneObj = envelopeCutline.getObjects().find((obj) => obj.stroke === '#009944')
              }

              const greenZoneCenterY = greenZoneObj?.getCenterPoint().y ?? 0

              console.log('봉투 타입 PDF 배치:', { direction, pageWidth, pageHeight, contentWidth, contentHeight })

              switch (direction) {
                case 'top':
                  // 상단 중앙 기준
                  offsetY = 0.5
                  break
                case 'left':
                  // 중단 좌측 기준
                  offsetX = 0
                  if (greenZoneCenterY) {
                    offsetY += pxToMm(greenZoneCenterY, dpi)
                  }
                  break
                default:
                  // 기본값은 중앙 배치
                  break
              }

              console.log('봉투 타입 오프셋:', { offsetX, offsetY })
            }
          }

          // PDF 생성 - 항상 mm 단위 사용
          const pdf: jsPDF = new jsPDF(orientation, 'mm', [pageWidth, pageHeight])

          // 봉투 타입인 경우 칼선을 PDF 생성 시에만 표시
          if (isEnvelope) {
            for (const canvas of canvases) {
              const cutlineTemplate = canvas.getObjects().find((obj) => obj.id === 'cutline-template')
              if (cutlineTemplate) {
                cutlineStates.push({
                  canvas,
                  template: cutlineTemplate,
                  originalVisible: cutlineTemplate.visible ?? false
                })
                cutlineTemplate.set({ visible: true })
                canvas.requestRenderAll()
              }
            }
          }

          // 각 캔버스를 PDF 페이지로 순차적으로 추가 (상태 복원은 나중에)
          for (let i = 0; i < canvases.length; i++) {
            const canvas = canvases[i]
            const editor = editors[i]

            // 캔버스의 원본 상태 저장
            canvas.offHistory()
            const originalState = canvas.toJSON(core.extendFabricOption)

            // 나중에 복원하기 위해 저장
            canvasStates.push({ canvas, editor, originalState })

            console.log(`페이지 ${i + 1}/${canvases.length} 처리 중...`)

            // PDF 저장 전 모든 객체에 순서 정보 부여
            this._assignOrderToAllObjects(canvas)

            // PDF 페이지 준비 및 생성
            await new Promise<void>((resolvePrep, rejectPrep) => {
              this._prepareSaveOperation('', canvas, editor, async (preparedData) => {
                try {
                  const { addedObjects, workspace } = preparedData

                  // 텍스트 객체와 일반 객체 분리
                  const textObjects = canvas
                    .getObjects()
                    .filter((obj) => ['text', 'textbox', 'i-text'].includes(obj.type))

                  const objToAdd = addedObjects.filter((obj) => obj.extensionType !== 'overlay')

                  // 객체 추가
                  canvas.add(...objToAdd)
                  canvas.remove(...textObjects)

                  // 원본 순서에 맞게 재정렬
                  this._restoreObjectOrder(canvas)

                  if (this._options.renderType === 'noBounded') {
                    const bg = canvas.getObjects().find((obj) => obj.id === 'template-background')
                    if (bg) {
                      canvas.remove(bg)
                    }
                  } else if (this._options.renderType === 'mockup') {
                    const mockup = canvas.getObjects().find((obj) => obj.id === 'template-mockup')
                    if (mockup) {
                      canvas.remove(mockup)
                      canvas.clipPath = null
                    }
                  }

                  // 캔버스 배경을 투명으로 설정
                  const originalBg = canvas.backgroundColor
                  canvas.backgroundColor = 'transparent'

                  // 워크스페이스 객체를 투명으로 설정
                  const workspaceObj = canvas.getObjects().find((obj) => obj.id === 'workspace')
                  const originalWorkspaceFill = workspaceObj?.fill
                  if (workspaceObj) {
                    workspaceObj.set({ fill: 'transparent' })
                  }

                  // 원본 clipPath 저장
                  const originalClipPath = canvas.clipPath

                  // 봉투 타입인 경우 clipPath 제거
                  if (isEnvelope) {
                    canvas.clipPath = null
                    console.log(`페이지 ${i + 1}: 봉투 타입 - clipPath 제거`)
                  } else {
                    // page-outline을 clipPath로 설정 (봉투 타입이 아닌 경우만)
                    const pageOutline = canvas.getObjects().find((obj) => obj.id === 'page-outline')
                    if (pageOutline) {
                      // page-outline을 복제하여 clipPath로 설정
                      const clipPathClone = fabric.util.object.clone(pageOutline)
                      clipPathClone.set({
                        absolutePositioned: true,
                        stroke: null,
                        strokeWidth: 0,
                        fill: 'white'
                      })
                      canvas.clipPath = clipPathClone
                      console.log(`페이지 ${i + 1}: page-outline을 clipPath로 적용`)
                    }
                  }

                  // 모양틀 +아이콘은 저장시 노출 금지 (export 제외)
                  const moldIconsForExport = canvas
                    .getObjects()
                    .filter((obj) => (obj as any).extensionType === 'moldIcon')
                  for (const icon of moldIconsForExport) {
                    ; (icon as any).excludeFromExport = true
                  }

                  // 모양틀 outline은 본문 페이지에서 제외하기 위해 임시 제거 (칼선 페이지로 따로 렌더)
                  const moldShapesForPage = canvas
                    .getObjects()
                    .filter((obj) => (obj as any).hasMolding)
                  const outlinesForPage: fabric.Object[] = []
                  for (const shape of moldShapesForPage) {
                    const outline = canvas
                      .getObjects()
                      .find(
                        (obj) =>
                          obj.id === `${shape.id}_outline` &&
                          (obj as any).extensionType === 'outline'
                      )
                    if (outline) {
                      outlinesForPage.push(outline)
                    }
                  }
                  if (outlinesForPage.length > 0) {
                    canvas.remove(...outlinesForPage)
                  }

                  const svgWidth = unit === 'px' ? contentWidth : mmToPx(contentWidth)
                  const svgHeight = unit === 'px' ? contentHeight : mmToPx(contentHeight)
                  const background = canvas.getObjects().find((obj) => obj.id === 'template-background')
                  const backgroundWidth = background ? background.width! * background.scaleX! : 0
                  const backgroundHeight = background ? background.height! * background.scaleY! : 0

                  let viewBoxX = - svgWidth / 2
                  let viewBoxY = - svgHeight / 2
                  if (isEnvelope) {
                    if (envelopeOption.direction === 'left') {
                      viewBoxX += (svgWidth - backgroundWidth)
                    }
                    if (envelopeOption.direction === 'top') {
                      viewBoxY += (svgHeight - backgroundHeight)
                    }
                  }
                  // SVG 생성 - 투명 배경으로 설정
                  const svgData = canvas.toSVG({
                    width: svgWidth ,
                    height: svgHeight,
                    viewBox: {
                      x: viewBoxX,
                      y: viewBoxY,
                      width: svgWidth,
                      height: svgHeight
                    },
                    backgroundColor: 'transparent'
                  } as any)

                  console.log(`페이지 ${i + 1} SVG 생성 완료`)

                  // 봉투의 경우 뚜껑 clipPath 제거

                  const svgElement = new DOMParser().parseFromString(
                    svgData,
                    'image/svg+xml'
                  ).documentElement

                  // SVG에서 배경 요소 제거
                  this._removeSvgBackground(svgElement)

                  // SVG DOM 단순화
                  this._cleanSvg(svgElement)


                  // SVG 내의 문제가 있는 base64 이미지 데이터를 처리
                  await this._processSvgImages(svgElement)

                  // 첫 페이지가 아닌 경우 새 페이지 추가
                  if (i > 0) {
                    pdf.addPage([pageWidth, pageHeight], orientation)
                  }

                  console.log(`페이지 ${i + 1} SVG->PDF 변환:`, { contentWidth, contentHeight, unit, dpi })

                  // DPI 정보를 포함한 SVG2PDF 옵션
                  const svg2pdfOptions = {
                    x: offsetX,
                    y: offsetY,
                    width: contentWidth,
                    height: contentHeight,
                    // DPI 정보를 메타데이터로 추가 (일부 뷰어에서 활용)
                    dpi: dpi
                  }

                  try {
                    await svg2pdf(svgElement, pdf, svg2pdfOptions)
                  } catch (svgError) {
                    console.error(`페이지 ${i + 1} SVG->PDF 변환 중 오류:`, svgError)

                    // 다단계 복구 전략
                    const recovered = await this._handleSvgToPdfError(
                      svgError,
                      svgElement,
                      pdf,
                      svg2pdfOptions
                    )
                    if (!recovered) {
                      throw svgError
                    }
                  }

                  console.log(`페이지 ${i + 1} PDF에 추가 완료`)

                  // 필요시 효과 페이지 추가 (메모리 사용량 고려하여 조건부 실행)
                  if (addedObjects.some((obj) => obj.effects?.length > 0)) {
                    await this._generateEffectPages(
                      pdf,
                      addedObjects,
                      workspace,
                      size,
                      orientation,
                      dpi,
                      pageWidth,
                      pageHeight
                    )
                  }

                  // 페이지별 모양틀 outline을 별도 칼선 페이지로 저장
                  try {
                    await this._addCutlinePageFromOutlines(
                      pdf,
                      canvas,
                      outlinesForPage,
                      size,
                      orientation,
                      pageWidth,
                      pageHeight,
                      dpi
                    )
                  } catch (e) {
                    console.warn('페이지 칼선 생성 중 오류(계속 진행):', e)
                  }

                  // 원본 상태 복원
                  canvas.backgroundColor = originalBg
                  if (workspaceObj) {
                    workspaceObj.set({ fill: originalWorkspaceFill })
                  }
                  // clipPath 복원
                  canvas.clipPath = originalClipPath
                  canvas.remove(...objToAdd)
                  // 텍스트는 벡터/이미지로 대체되므로 재추가하지 않음

                  // PDF 페이지 생성 완료 (상태 복원은 나중에)
                  resolvePrep()
                } catch (error) {
                  console.error('PDF 페이지 생성 중 오류:', error)
                  rejectPrep(error)
                }
              })
            })

            console.log(`페이지 ${i + 1}/${canvases.length} 처리 완료`)

            // 메모리 정리를 위한 지연 및 가비지 컬렉션 유도
            await this._performMemoryCleanup()
          }

          // 칸버스 처리 완료 후 전체 메모리 정리
          await this._performMemoryCleanup(true)

          // 칼선이 있으면 최적화된 방식으로 마지막 페이지 추가
          if (cutLine) {
            await this._addCutLinePage(
              pdf,
              cutLine,
              orientation,
              pageWidth,
              pageHeight,
              dpi
            )
          }

          // 모든 PDF 페이지 추가 완료 후 칼선을 원래 상태로 복원
          if (isEnvelope && cutlineStates.length > 0) {
            for (const state of cutlineStates) {
              state.template.set({ visible: state.originalVisible })
              state.canvas.requestRenderAll()
            }
            console.log('봉투 타입: 모든 PDF 페이지 생성 완료 후 칼선 원래 상태로 복원')
          }

          // 이제 각 캔버스의 상태를 복원
          console.log('캔버스 상태 복원 시작...')
          for (let i = 0; i < canvasStates.length; i++) {
            const { canvas, editor, originalState } = canvasStates[i]
            console.log(`캔버스 ${i + 1}/${canvasStates.length} 상태 복원 중...`)

            try {
              await new Promise<void>((resolveRestore) => {
                canvas.loadFromJSON(originalState, () => {
                  editor.hooks.get('afterSave').callAsync([], () => {
                    canvas.renderAll()
                    canvas.onHistory()
                    resolveRestore()
                  })
                })
              })
            } catch (error) {
              console.error(`캔버스 ${i + 1} 상태 복원 중 오류:`, error)
              canvas.clear()
              canvas.renderAll()
              canvas.onHistory()
            }
          }
          console.log('모든 캔버스 상태 복원 완료')

          // 반환 형식에 따라 처리 (Blob 또는 파일 저장)
          if (returnBlob) {
            // Blob으로 반환
            const pdfBlob = pdf.output('blob')
            resolve(pdfBlob)
          } else {
            // 파일로 저장
            pdf.save(`${fileName}.pdf`)
            resolve()
          }
        } catch (error) {
          console.error('여러 페이지 PDF 처리 중 오류:', error)

          // 오류 발생 시에도 칼선 복원
          if (isEnvelope && cutlineStates.length > 0) {
            for (const state of cutlineStates) {
              state.template.set({ visible: state.originalVisible })
              state.canvas.requestRenderAll()
            }
            console.log('오류 발생: 칼선 원래 상태로 복원 완료')
          }

          // 오류 발생 시에도 캔버스 상태 복원 시도
          console.log('오류 발생: 캔버스 상태 복원 시도...')
          for (const { canvas, originalState } of canvasStates) {
            try {
              canvas.loadFromJSON(originalState, () => {
                canvas.renderAll()
                canvas.onHistory()
              })
            } catch (restoreError) {
              console.error('캔버스 상태 복원 중 오류:', restoreError)
            }
          }

          // 사용자에게 에러 메시지 표시
          let errorMessage = 'PDF 저장 중 오류가 발생했습니다.'
          
          if (error instanceof Error) {
            if (error.message.includes('사용자가 PDF 저장을 취소했습니다')) {
              // 사용자가 취소한 경우는 에러 메시지를 표시하지 않음
              reject(error)
              return
            } else if (error.message.includes('미지원 문자')) {
              errorMessage = error.message
            } else {
              errorMessage = `PDF 저장 중 오류가 발생했습니다: ${error.message}`
            }
          }
          
          // 브라우저에서 알림 표시
          alert(errorMessage)
          
          reject(error)
        }
      }

      processPages()
    })
  }

  /**
   * 재귀 깊이를 줄이기 위해 SVG DOM을 정리하고 단순화합니다.
   * @param svgElement SVG 엘리먼트
   */
  private _cleanSvg(svgElement: Element): void {
    let changesMade
    let pass = 0
    const maxPasses = 10 // 무한 루프 방지를 위한 최대 실행 횟수

    do {
      changesMade = false
      pass++

      // 비어있는 <g> 요소 제거
      svgElement.querySelectorAll('g').forEach((g) => {
        if (!g.hasChildNodes()) {
          g.remove()
          changesMade = true
        }
      })

      // 불필요한 <g> 요소 펼치기 (자식 요소들을 부모로 이동)
      // transform이나 style과 같이 자식에게 영향을 주는 속성이 없는 그룹을 대상으로 합니다.
      svgElement.querySelectorAll('g').forEach((g) => {
        if (g.attributes.length === 0 && g.parentElement) {
          // 자식들을 g 요소 앞으로 이동
          while (g.firstChild) {
            g.parentElement.insertBefore(g.firstChild, g)
          }
          // 이제 비어있는 g 요소 제거
          g.remove()
          changesMade = true
        }
      })
    } while (changesMade && pass < maxPasses)
  }

  // 칼선 페이지 추가 최적화 메서드
  private async _addCutLinePage(
    pdf: jsPDF,
    cutLine: fabric.Object,

    orientation: 'p' | 'l',
    pageWidth: number,
    pageHeight: number,
    dpi: number
  ): Promise<void> {
    try {
      // 새 페이지 추가
      pdf.addPage([pageWidth, pageHeight], orientation)

      const cutLineClone = fabric.util.object.clone(cutLine)
      cutLineClone.set({
        scaleX: 1,
        scaleY: 1,
        originX: 'left',
        originY: 'top',
        fill: 'transparent'
      })

      if (cutLineClone.type === 'group' && cutLineClone.getObjects().length > 0) {
        cutLineClone.forEachObject((obj) => {
          obj.set({
            fill: 'transparent'
          })
        })
      }

      // SVG 생성 - 최적화된 옵션 사용
      const cutLineSvgData = convertFabricObjectToSVGString(cutLineClone)

      const cutLineSvgElement = new DOMParser().parseFromString(
        cutLineSvgData,
        'image/svg+xml'
      ).documentElement

      // SVG를 PDF에 렌더링
      // Canvas 단위 확인하여 px인 경우 mm로 변환, mm 단위에서도 DPI 고려
      const cutlineWidth = pxToMm(cutLine.width, dpi)
      const cutlineHeight = pxToMm(cutLine.height, dpi)

      console.log('cutlineWidth', pageWidth, pageWidth - cutlineWidth, pageHeight - cutlineHeight)

      const cutlineSvg2pdfOptions = {
        x: (pageWidth - cutlineWidth) / 2,
        y: (pageHeight - cutlineHeight) / 2,
        width: cutlineWidth,
        height: cutlineHeight,
        loadExternalStyleSheets: false
      }

      try {
        await svg2pdf(cutLineSvgElement, pdf, cutlineSvg2pdfOptions)
      } catch (svgError) {
        console.error('칼선 SVG->PDF 변환 중 오류:', svgError)
        // 다단계 복구 전략 적용
        const recovered = await this._handleSvgToPdfError(
          svgError,
          cutLineSvgElement,
          pdf,
          cutlineSvg2pdfOptions
        )
        if (!recovered) {
          console.warn('칼선 변환 실패, 칼선 없이 진행')
          // 칼선 변환 실패는 전체 과정을 중단하지 않음
        }
      }
    } catch (error) {
      console.error('칼선 페이지 추가 중 오류:', error)
      // 오류가 발생해도 기존 PDF는 저장 진행
    }
  }

  /**
   * 현재 캔버스의 모양틀 outline 들을 수집해 별도의 칼선 전용 페이지를 추가
   */
  private async _addCutlinePageFromOutlines(
    pdf: jsPDF,
    canvas: fabric.Canvas,
    outlines: fabric.Object[],
    bound: {
      width: number
      height: number
      cutSize: number
      printSize?: { width: number; height: number }
    },
    orientation: 'p' | 'l',
    pageWidth: number,
    pageHeight: number,
    dpi: number
  ): Promise<void> {
    try {
      const workspace = canvas.getObjects().find((obj) => obj.id === 'workspace')
      if (!workspace) return

      if (!outlines || outlines.length === 0) return

      // 임시 캔버스 생성하여 동일 크기에 모아 SVG 생성
      const tempCanvas = new fabric.Canvas(document.createElement('canvas'))
      tempCanvas.setDimensions({
        width: (workspace.width || 0) * (workspace.scaleX || 1),
        height: (workspace.height || 0) * (workspace.scaleY || 1)
      })
      tempCanvas.backgroundColor = 'transparent'

      const wsClone = fabric.util.object.clone(workspace)
      wsClone.set({
        left: tempCanvas.width! / 2,
        top: tempCanvas.height! / 2,
        originX: 'center',
        originY: 'center',
        fill: 'transparent',
        stroke: 'none'
      })
      tempCanvas.add(wsClone)

      // outline 클론을 원래 위치에 배치
      for (const outline of outlines) {
        const oClone = fabric.util.object.clone(outline)
        if (workspace.left !== undefined && workspace.top !== undefined) {
          const relativeLeft = (outline.left || 0) - (workspace.left || 0)
          const relativeTop = (outline.top || 0) - (workspace.top || 0)
          oClone.set({
            left: (wsClone.left || 0) + relativeLeft,
            top: (wsClone.top || 0) + relativeTop,
            selectable: false,
            evented: false,
            strokeUniform: true
          })
        }
        // 칼선 전용 스타일 약간 보정
        oClone.set({
          fill: '',
          stroke: (outline as any).stroke || '#e30413',
          strokeWidth: (outline as any).strokeWidth || 1.5
        })
        tempCanvas.add(oClone)
      }

      // SVG로 변환
      const cutSvgData = tempCanvas.toSVG({
        width: tempCanvas.width,
        height: tempCanvas.height,
        viewBox: { x: 0, y: 0, width: tempCanvas.width, height: tempCanvas.height },
        backgroundColor: 'transparent'
      } as any)

      const cutSvgElement = new DOMParser().parseFromString(
        cutSvgData,
        'image/svg+xml'
      ).documentElement

      // 페이지 추가 및 mm 기준 배치
      const canvasUnit = (canvas as any).unitOptions?.unit
      let w: number, h: number
      if (canvasUnit === 'px') {
        w = pxToMm(bound.width, dpi)
        h = pxToMm(bound.height, dpi)
      } else {
        w = bound.width
        h = bound.height
      }

      pdf.addPage([w, h], orientation)

      const offsetX = Math.max(0, (pageWidth - w) / 2)
      const offsetY = Math.max(0, (pageHeight - h) / 2)

      try {
        await svg2pdf(cutSvgElement, pdf, {
          x: offsetX,
          y: offsetY,
          width: w,
          height: h,
          loadExternalStyleSheets: false
        })
      } catch (svgError) {
        console.warn('칼선(outlines) SVG->PDF 변환 오류:', svgError)
        // fallback: 이미지로 추가
        try {
          const imageDataUrl = await this._svgToImageFallback(cutSvgElement)
          if (imageDataUrl) {
            pdf.addImage(imageDataUrl, 'PNG', offsetX, offsetY, w, h)
          }
        } catch (e) {
          console.warn('칼선(outlines) fallback 실패:', e)
        }
      }

      tempCanvas.dispose()
    } catch (error) {
      console.error('모양틀 outline 칼선 페이지 생성 중 오류:', error)
    }
  }

  /**
   * 저장 작업 공통 준비 메소드
   * @param params 추가 파라미터
   * @param canvas 캔버스 객체
   * @param editor 에디터 객체
   * @param callback 준비 완료 후 실행될 콜백 함수
   */
  private _prepareSaveOperation(
    params: any,
    canvas: fabric.Canvas,
    editor: Editor,
    callback: (preparedData: {
      addedObjects: fabric.Object[]
      workspace: fabric.Object
    }) => Promise<void>
  ): void {
    editor.hooks.get('beforeSave').callAsync(params, async () => {
      // 저장 전 처리: 오버레이 요소를 mask로 추가

      try {
        const addedObjects = await this._prepareObjectsForSvgExport(canvas)

        // 워크스페이스 객체 가져오기
        const workspace = canvas.getObjects().find((obj) => obj.id === 'workspace')

        if (!workspace) {
          throw new Error('워크스페이스를 찾을 수 없습니다')
        }

        // 준비된 데이터와 함께 콜백 실행
        callback({
          addedObjects,
          workspace
        })
      } catch (e) {
        console.error('저장 작업 준비 중 오류:', e)
        throw e
      }
    })
  }

  /**
   * PDF에 효과별 페이지 추가 (모든 페이지 크기 일관성 유지)
   * @param pdf PDF 객체
   * @param addedObjects 추가된 객체 배열
   * @param option SVG 옵션
   * @param workspace 워크스페이스 객체
   * @param bound 바운드 정보
   * @param orientation 페이지 방향
   */
  private async _generateEffectPages(
    pdf: jsPDF,
    addedObjects: fabric.Object[],
    workspace: fabric.Object,
    bound: { width: number; height: number },
    orientation: 'p' | 'l',
    dpi: number,
    pageWidth: number,
    pageHeight: number
  ): Promise<void> {
    // 효과별 객체 분류
    const embossObjects = addedObjects.filter((obj) => obj.effects?.includes('emboss') ?? false)
    const cuttingObjects = addedObjects.filter((obj) => obj.effects?.includes('cutting') ?? false)
    const goldObjects = addedObjects.filter((obj) => obj.effects?.includes('gold') ?? false)

    // 효과 페이지 추가 함수
    const addEffectPage = async (effectObjects: fabric.Object[]) => {
      if (effectObjects.length === 0) return

      // 임시 캔버스 생성 - 워크스페이스 크기와 동일하게 설정
      const tempCanvas = new fabric.Canvas(document.createElement('canvas'))
      tempCanvas.setDimensions({
        width: workspace.width! * workspace.scaleX!,
        height: workspace.height! * workspace.scaleY!
      })

      // 캔버스 배경을 투명으로 설정
      tempCanvas.backgroundColor = 'transparent'

      // 워크스페이스 복제 및 추가 - 캔버스 정중앙에 위치시킴
      const workspaceClone = fabric.util.object.clone(workspace)
      workspaceClone.set({
        left: tempCanvas.width! / 2,
        top: tempCanvas.height! / 2,
        originX: 'center',
        originY: 'center',
        fill: 'transparent', // 워크스페이스도 투명으로 설정
        stroke: 'none'
      })
      tempCanvas.add(workspaceClone)

      // 효과 객체 추가 - 원래 위치 유지
      effectObjects.forEach((obj) => {
        // 객체 위치 조정 - 워크스페이스 중앙 기준으로 상대적 위치 계산
        const objClone = fabric.util.object.clone(obj)
        if (workspace.left !== undefined && workspace.top !== undefined) {
          const relativeLeft = obj.left! - workspace.left
          const relativeTop = obj.top! - workspace.top

          objClone.set({
            left: workspaceClone.left! + relativeLeft,
            top: workspaceClone.top! + relativeTop
          })
        }
        tempCanvas.add(objClone)
      })

      // SVG 추출 - 투명 배경으로 설정
      const effectSvgData = tempCanvas.toSVG({
        width: tempCanvas.width,
        height: tempCanvas.height,
        viewBox: {
          x: 0,
          y: 0,
          width: tempCanvas.width,
          height: tempCanvas.height
        }
      })

      const effectSvgElement = new DOMParser().parseFromString(
        effectSvgData,
        'image/svg+xml'
      ).documentElement

      // SVG에서 모든 배경 관련 요소 제거
      this._removeSvgBackground(effectSvgElement)

      // SVG DOM 단순화
      this._cleanSvg(effectSvgElement)


      // SVG 내의 문제가 있는 base64 이미지 데이터를 처리
      await this._processSvgImages(effectSvgElement)

      // 새 페이지 추가 - 워크스페이스 크기에 맞게, 동일한 방향 유지
      // Canvas 단위 확인하여 px인 경우 mm로 변환된 크기 사용
      const canvasUnit = workspace.canvas?.unitOptions?.unit
      let addPageWidth, addPageHeight

      if (canvasUnit === 'px') {
        addPageWidth = pxToMm(bound.width, dpi)
        addPageHeight = pxToMm(bound.height, dpi)
      } else {
        addPageWidth = bound.width
        addPageHeight = bound.height
      }

      pdf.addPage([addPageWidth, addPageHeight], orientation)

      // 효과 렌더링 - Canvas 단위 확인하여 px인 경우 mm로 변환, mm 단위에서도 DPI 고려
      let effectWidth, effectHeight

      if (canvasUnit === 'px') {
        effectWidth = pxToMm(bound.width, dpi)
        effectHeight = pxToMm(bound.height, dpi)
      } else {
        // mm 단위에서도 DPI 정보 유지
        effectWidth = bound.width
        effectHeight = bound.height
      }

      // 중앙 배치 오프셋(mm)
      let offsetX = Math.max(0, (pageWidth - effectWidth) / 2)
      let offsetY = Math.max(0, (pageHeight - effectHeight) / 2)

      // 봉투 타입인 경우 direction에 따라 오프셋 조정
      const isEnvelope = this._options.renderType === 'envelope'
      if (isEnvelope) {
        const envelopeOption = (this._options as any)?.envelopeOption

        if (envelopeOption && envelopeOption.direction) {
          const direction = envelopeOption.direction

          switch (direction) {
            case 'top':
              // 상단 중앙 기준
              offsetX = Math.max(0, (pageWidth - effectWidth) / 2)
              offsetY = 0
              break
            case 'bottom':
              // 하단 중앙 기준
              offsetX = Math.max(0, (pageWidth - effectWidth) / 2)
              offsetY = Math.max(0, pageHeight - effectHeight)
              break
            case 'left':
              // 중단 좌측 기준
              offsetX = 0
              offsetY = Math.max(0, (pageHeight - effectHeight) / 2)
              break
            case 'right':
              // 중단 우측 기준
              offsetX = Math.max(0, pageWidth - effectWidth)
              offsetY = Math.max(0, (pageHeight - effectHeight) / 2)
              break
          }

          console.log('효과 페이지 봉투 타입 오프셋:', { direction, offsetX, offsetY })
        }
      }

      const effectSvg2pdfOptions = {
        x: offsetX,
        y: offsetY,
        width: effectWidth,
        height: effectHeight,
        dpi: dpi,
        loadExternalStyleSheets: false
      }

      try {
        await svg2pdf(effectSvgElement, pdf, effectSvg2pdfOptions)
      } catch (svgError) {
        console.error('효과 SVG->PDF 변환 중 오류:', svgError)
        // 다단계 복구 전략 적용
        const recovered = await this._handleSvgToPdfError(
          svgError,
          effectSvgElement,
          pdf,
          effectSvg2pdfOptions
        )
        if (!recovered) {
          console.warn('효과 페이지 변환 실패, 해당 효과 페이지 제외하고 진행')
          // 효과 페이지 변환 실패는 전체 과정을 중단하지 않음
        }
      }

      /*      // 효과명 표시 - 위치 조정, 방향에 따라 다른 위치 사용
            const marginX = 10
            const marginY = 10
            pdf.setFontSize(12)
            pdf.setTextColor(200, 0, 0)
            pdf.text(`${effectName} Effect Layer`, marginX, marginY)*/

      // 메모리 정리
      tempCanvas.dispose()
    }

    // 각 효과 페이지 추가
    if (embossObjects.length > 0) {
      await addEffectPage(embossObjects)
    }

    if (cuttingObjects.length > 0) {
      await addEffectPage(cuttingObjects)
    }

    if (goldObjects.length > 0) {
      await addEffectPage(goldObjects)
    }
  }

  /**
   * SVG 저장을 위해 객체 준비
   * - 각 오버레이에 대한 마스크 객체 생성 및 추가
   * @returns 추가된 마스크 객체 배열
   */
  private async _prepareObjectsForSvgExport(canvas: fabric.Canvas): Promise<fabric.Object[]> {
    const objects = canvas.getObjects()
    const objectsToAdd: Array<{ obj: fabric.Object; originalIndex: number }> = []

    // 비동기 작업 처리를 위한 Promise 배열
    const promises: Promise<{ obj: fabric.Object | null; originalIndex: number }>[] = []

    // page-outline-clip 제거 시 원본 clipPath 복원
    // fillImage나 molding 객체의 경우, 원래 clipPath(shape)가 page-outline-clip로 덮어씌워졌을 수 있음
    const objsHasClipPath = objects.filter(
      (obj) => obj.clipPath && obj.clipPath.id === 'page-outline-clip'
    )

    for (const obj of objsHasClipPath) {
      console.log('page-outline-clip 제거:', obj.id)
      
      // fillImage인 경우, parentLayerId로 원본 shape를 찾아 clipPath로 복원
      if (obj.extensionType === 'fillImage') {
        // parentLayerId가 없으면 id에서 추출 (예: 'shape123_fillImage' -> 'shape123')
        const parentLayerId = (obj as any).parentLayerId || (typeof obj.id === 'string' && obj.id.endsWith('_fillImage') ? obj.id.replace('_fillImage', '') : null)
        if (parentLayerId) {
          const parentShape = objects.find(o => o.id === parentLayerId)
          if (parentShape && (parentShape as any).hasMolding) {
            console.log(`fillImage ${obj.id}의 원본 clipPath 복원 (shape: ${parentShape.id})`)
            obj.clipPath = parentShape
            continue // page-outline-clip를 원본 clipPath(parentShape)로 교체
          }
        }
      }
      
      // 일반적인 경우: page-outline-clip만 제거
      obj.clipPath = null
    }

    // 텍스트를 포함한 그룹 찾기
    const hasTextInGroup = (group: fabric.Group): boolean => {
      if (!group._objects) return false
      return group._objects.some((obj) => {
        if (obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') {
          return true
        }
        // 중첩된 그룹도 체크
        if (obj.type === 'group') {
          return hasTextInGroup(obj as fabric.Group)
        }
        return false
      })
    }

    objects.forEach((obj, index) => {
      // 텍스트가 포함된 그룹인 경우 텍스트를 그룹에서 추출하여 벡터화
      if (obj.type === 'group' && hasTextInGroup(obj as fabric.Group) && !obj.excludeFromExport) {
        const promise = this._vectorizeTextInGroup(obj as fabric.Group)
          .then((vectorizedTexts) => {
            if (vectorizedTexts && vectorizedTexts.length > 0) {
              console.log(`그룹에서 ${vectorizedTexts.length}개 텍스트 추출 완료:`, obj.id)

              // 추출된 텍스트 객체들을 objectsToAdd에 추가
              for (const vectorizedObj of vectorizedTexts) {
                vectorizedObj.set('originalIndex', obj.originalIndex)
                objectsToAdd.push({ obj: vectorizedObj, originalIndex: index })
              }

              // 그룹 자체는 유지 (텍스트만 제거된 상태)
              return { obj: null, originalIndex: index }
            }
            return { obj: null, originalIndex: index }
          })
          .catch((e) => {
            console.error('그룹 내 텍스트 벡터화 오류:', e)
            return { obj: null, originalIndex: index }
          })

        promises.push(promise)
      }
      // 개별 텍스트 객체 처리
      else if (
        (obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') &&
        !obj.excludeFromExport
      ) {
        const promise = this._convertTextToSvg(obj)
          .then((vectorObj) => {
            if (vectorObj) {
              console.log('텍스트 객체 생성됨:', vectorObj)
              // 원본 순서 정보를 새 객체에 저장
              vectorObj.set('originalIndex', obj.originalIndex)
              // 원본 텍스트 제거 (중요!)
              canvas.remove(obj)
              return { obj: vectorObj, originalIndex: index }
            }
            return { obj: null, originalIndex: index }
          })
          .catch((e) => {
            console.error('SVG 텍스트 생성 오류:', e)
            return { obj: null, originalIndex: index }
          })

        promises.push(promise)
      }

      if (obj.effects && obj.effects.length > 0) {
        const promise = this._createMaskForEffects(obj)
          .then((maskObj) => {
            if (maskObj) {
              console.log('마스크 객체 생성됨:', maskObj.id)
              return { obj: maskObj, originalIndex: index }
            }
            return { obj: null, originalIndex: index }
          })
          .catch((e) => {
            console.error('마스크 생성 오류:', e)
            return { obj: null, originalIndex: index }
          })

        promises.push(promise)
      }
    })

    const results = await Promise.all(promises)

    // 원래 순서대로 정렬하여 레이어 순서 보존
    results
      .filter(result => result.obj !== null)
      .sort((a, b) => a.originalIndex - b.originalIndex)
      .forEach(result => {
        objectsToAdd.push({ obj: result.obj!, originalIndex: result.originalIndex })
      })

    console.log('레이어 순서 보존된 객체들:', objectsToAdd.map(item => ({ id: item.obj.id, index: item.originalIndex })))
    console.log('추가된 객체 수:', objectsToAdd.length)
    canvas.renderAll()
    return objectsToAdd.map(item => item.obj)
  }


  /**
   * PDF 저장 전 모든 객체에 순서 정보 부여
   * @param canvas 캔버스 객체
   */
  private _assignOrderToAllObjects(canvas: fabric.Canvas): void {
    const objects = canvas.getObjects()

    // 모든 객체에 순서 정보 부여
    objects.forEach((obj, index) => {
      obj.set('originalIndex', index)
    })

    console.log('모든 객체에 순서 정보 부여 완료')
  }

  /**
   * 원본 순서에 맞게 캔버스 객체들을 재정렬
   * @param canvas 캔버스 객체
   */
  private _restoreObjectOrder(canvas: fabric.Canvas): void {
    const objects = canvas.getObjects()

    // 모든 객체가 originalIndex를 가지고 있어야 하므로 이를 기준으로 정렬
    const reorderedObjects = objects.sort((a, b) => {
      const indexA = a.originalIndex ?? 999999 // originalIndex가 없는 경우 맨 뒤로
      const indexB = b.originalIndex ?? 999999
      return indexA - indexB
    })

    // 캔버스에서 모든 객체 제거 후 순서대로 다시 추가
    canvas.remove(...objects)
    canvas.add(...reorderedObjects)

    console.log('객체 순서 재정렬 완료')
  }

  private async _convertTextToImage(textObj: fabric.Object): Promise<fabric.Object> {
    return new Promise((resolve, reject) => {
      const center = textObj.getCenterPoint()
      const multiplier = 2

      // 빈 캔버스 생성
      const canvas = document.createElement('canvas')
      const width = textObj.width! * textObj.scaleX!
      const height = textObj.height! * textObj.scaleY!

      canvas.width = width * multiplier
      canvas.height = height * multiplier

      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('Failed to get 2d context from canvas'))
        return
      }

      // 텍스트 객체를 캔버스 엘리먼트로 변환
      const textCanvas = textObj.toCanvasElement({
        multiplier: multiplier,
        enableRetinaScaling: false,
        withoutTransform: true
      })

      // 빈 캔버스에 텍스트 이미지 그리기
      context.drawImage(textCanvas, 0, 0, width * multiplier, height * multiplier)

      // 캔버스를 데이터 URL로 변환
      const dataURL = canvas.toDataURL('image/png', 1)

      // 원본 텍스트 객체를 이미지로 교체
      fabric.Image.fromURL(dataURL, (img) => {
        img.set({
          left: center.x,
          top: center.y,
          originX: 'center',
          originY: 'center',
          scaleX: 1 / multiplier,
          scaleY: 1 / multiplier,
          extensionType: 'text',
          angle: textObj.angle,
          flipX: textObj.flipX,
          flipY: textObj.flipY,
          opacity: textObj.opacity
        })

        img.setCoords()

        resolve(img as any)
      })
    })
  }

  private async _convertTextToSvg(textObj: fabric.Object): Promise<fabric.Object> {
    try {
      // FontPlugin의 새로운 path 변환 기능 사용
      const fontPlugin = this._editor.getPlugin('FontPlugin')
      if (fontPlugin && typeof fontPlugin.convertTextToPath === 'function') {
        const pathObj = await fontPlugin.convertTextToPath(
          textObj as fabric.Text | fabric.IText | fabric.Textbox
        )

        if (pathObj) {
          dlog('font', `✅ FontPlugin으로 텍스트 path 변환 성공: "${(textObj as any).text}"`)
          return pathObj
        }
      }

      console.log(
        `⚠️ FontPlugin WOFF2 벡터화 실패, 이미지 변환으로 폴백: "${(textObj as any).text}"`
      )

      // 폴백: 이미지 변환 (WOFF2 벡터화 실패 시)
      return this._convertTextToImage(textObj)
    } catch (error) {
      console.error('텍스트 SVG 변환 중 오류:', error)
      // 최종 폴백
      return this._convertTextToImage(textObj)
    }
  }

  /**
   * 그룹 내의 텍스트 객체를 찾아서 그룹에서 제외하고 벡터화
   * @param group 그룹 객체
   * @returns 벡터화된 텍스트 객체 배열 (캔버스에 직접 추가될 예정)
   */
  private async _vectorizeTextInGroup(group: fabric.Group): Promise<fabric.Object[]> {
    try {
      dlog('plugin', `🔄 그룹 내 텍스트 추출 및 벡터화 시작: ${group.id}`)

      if (!group._objects || group._objects.length === 0) {
        console.log('⚠️ 그룹 내 객체가 없음')
        return []
      }

      const vectorizedObjects: fabric.Object[] = []
      const textsToVectorize: fabric.Object[] = []

      // 텍스트 객체들을 수집 (중첩 그룹 포함)
      for (const obj of group._objects) {
        if (obj.type === 'group') {
          // 중첩된 그룹도 재귀적으로 처리
          const nestedVectorized = await this._vectorizeTextInGroup(obj as fabric.Group)
          vectorizedObjects.push(...nestedVectorized)
        } else if (obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') {
          console.log(`  ↳ 텍스트 발견: "${(obj as any).text}"`)
          textsToVectorize.push(obj)
        }
      }

      // 텍스트들을 그룹에서 제거하고 벡터화
      for (const obj of textsToVectorize) {
        console.log(`  ↳ 텍스트 벡터화 및 그룹에서 제거: "${(obj as any).text}"`)

        // 그룹에서 제거 (removeWithUpdate가 자동으로 절대 좌표로 변환)
        group.removeWithUpdate(obj)

        console.log(`  ↳ 절대 좌표로 변환됨: left=${obj.left}, top=${obj.top}, scaleX=${obj.scaleX}, scaleY=${obj.scaleY}`)

        // 벡터화
        const vectorizedObj = await this._convertTextToSvg(obj)
        vectorizedObj.setCoords()

        vectorizedObjects.push(vectorizedObj)
      }

      if (vectorizedObjects.length > 0) {
        console.log(`✅ 그룹에서 ${vectorizedObjects.length}개 텍스트 추출 및 벡터화 완료: ${group.id}`)
      }

      return vectorizedObjects
    } catch (error) {
      console.error('그룹 내 텍스트 벡터화 중 오류:', error)
      return []
    }
  }

  /**
   * 오버레이 객체로부터 마스크 객체 생성
   * 클립패스를 복제하여 색상 적용
   */
  private async _createMaskForEffects(obj: fabric.Object): Promise<fabric.Object> {
    return new Promise((resolve) => {
      const processEffect = async () => {
        const effect = obj.effects[0]
        const effectColor =
          effect === 'gold'
            ? '#FFD700'
            : effect === 'cutting'
              ? '#dbecea'
              : effect === 'emboss'
                ? '#d3d3d3'
                : '#000000'

        const overlayMask = await this.imagePlugin.fillObjectWithColor(obj, effectColor)

        overlayMask.setOptions({
          id: obj.id + `_${effect}`,
          effects: [effect],
          extensionType: 'overlay'
        })

        resolve(overlayMask)
      }

      processEffect()
    })
  }

  // SVG에서 모든 배경 관련 요소 제거
  private _removeSvgBackground(svgElement: Element): void {
    // SVG 루트 요소의 배경 관련 속성 제거
    svgElement.removeAttribute('style')
    svgElement.removeAttribute('background-color')
    svgElement.removeAttribute('background')

    // 배경 역할을 하는 rect 요소들 제거 (워크스페이스 배경 등)
    const rects = svgElement.querySelectorAll('rect')
    rects.forEach((rect) => {
      const fill = rect.getAttribute('fill')
      const width = rect.getAttribute('width')
      const height = rect.getAttribute('height')
      const x = rect.getAttribute('x')
      const y = rect.getAttribute('y')

      // 전체 영역을 덮는 배경 rect이거나 흰색 배경인 경우 제거
      if (
        (fill &&
          (fill === 'white' ||
            fill === '#ffffff' ||
            fill === '#FFFFFF' ||
            fill === 'rgb(255,255,255)')) ||
        (x === '0' && y === '0' && width && height) // 전체 영역을 덮는 rect
      ) {
        rect.remove()
      }
    })

    // defs 내의 배경 관련 요소들 제거
    const defs = svgElement.querySelector('defs')
    if (defs) {
      const backgroundDefs = defs.querySelectorAll('linearGradient, radialGradient, pattern')
      backgroundDefs.forEach((def) => {
        const id = def.getAttribute('id')
        if (id && id.includes('background')) {
          def.remove()
        }
      })
    }
  }

  /**
   * base64 본문을 안전하게 정규화
   * - 공백/개행 제거
   * - URL-safe 문자 교정('-'→'+', '_'→'/')
   * - 패딩 '=' 보정
   */
  private _normalizeBase64(data: string): string {
    try {
      let s = data.replace(/\s+/g, '')
      s = s.replace(/-/g, '+').replace(/_/g, '/')
      const pad = s.length % 4
      if (pad === 1) {
        // 잘못된 길이 → 더 진행하지 않고 원본 반환하여 상위 로직에서 캔버스 기반 처리로 우회
        return s
      }
      if (pad > 0) {
        s = s + '='.repeat(4 - pad)
      }
      return s
    } catch {
      return data
    }
  }

  /**
   * data URL 내 base64 본문 정규화
   */
  private _normalizeDataUrl(dataUrl: string): string {
    try {
      const idx = dataUrl.indexOf(',')
      if (idx < 0) return dataUrl
      const header = dataUrl.slice(0, idx)
      const body = dataUrl.slice(idx + 1)
      const normalizedBody = this._normalizeBase64(body)
      return `${header},${normalizedBody}`
    } catch {
      return dataUrl
    }
  }

  /**
   * 대용량 이미지를 압축하여 메모리 사용량 감소
   * @param dataUrl 원본 이미지 data URL
   * @param mimeType 이미지 MIME 타입
   * @param quality 압축 품질 (0.1-1.0)
   * @returns 압축된 이미지 data URL
   */
  private async _compressLargeImage(
    dataUrl: string,
    mimeType: string,
    quality = 0.85
  ): Promise<string | null> {
    try {
      return new Promise<string | null>((resolve) => {
        let img: HTMLImageElement | null = new Image()
        let timeoutId: number | null = null

        const cleanup = () => {
          if (timeoutId) {
            clearTimeout(timeoutId)
            timeoutId = null
          }
          if (img) {
            img.onload = null
            img.onerror = null
            img = null
          }
        }

        timeoutId = window.setTimeout(() => {
          console.warn('대용량 이미지 압축 타임아웃')
          cleanup()
          resolve(null)
        }, 30000) // 30초 타임아웃

        img.onload = () => {
          try {
            const canvas = document.createElement('canvas')
            const ctx = canvas.getContext('2d')
            if (!ctx || !img) {
              resolve(null)
              return
            }

            // P0-3: 300 DPI 인쇄 화질 보존 — 포맷 구분 없이 인쇄 등급 상한 적용
            const maxSize = ServicePlugin.PRINT_MAX_IMAGE_DIMENSION
            let { width, height } = img

            if (width > maxSize || height > maxSize) {
              const ratio = Math.min(maxSize / width, maxSize / height)
              width = Math.floor(width * ratio)
              height = Math.floor(height * ratio)
              console.log(`이미지 크기 조정: ${img.width}x${img.height} -> ${width}x${height}`)
            }

            canvas.width = width
            canvas.height = height

            // 고품질 렌더링 설정
            ctx.imageSmoothingEnabled = true
            ctx.imageSmoothingQuality = 'high'

            ctx.clearRect(0, 0, width, height)
            ctx.drawImage(img, 0, 0, width, height)

            // 투명도 여부 감지 (알파 채널 존재 시 PNG 유지)
            const hasTransparency =
              mimeType === 'image/png' ||
              mimeType === 'image/webp' ||
              mimeType === 'image/svg+xml' ||
              mimeType === 'image/gif'

            const outputType = hasTransparency ? 'image/png' : 'image/jpeg'
            const compressedDataUrl =
              outputType === 'image/png'
                ? canvas.toDataURL('image/png', quality)
                : canvas.toDataURL('image/jpeg', quality)

            console.log(
              `압축 결과 (${hasTransparency ? 'alpha 유지 PNG' : 'JPEG'}): ` +
              `${(dataUrl.length / 1024 / 1024).toFixed(2)}MB -> ${(compressedDataUrl.length / 1024 / 1024).toFixed(2)}MB`
            )

            resolve(compressedDataUrl)
          } catch (error) {
            console.warn('대용량 이미지 압축 중 오류:', error)
            resolve(null)
          } finally {
            cleanup()
          }
        }

        img.onerror = () => {
          console.warn('대용량 이미지 로드 실패')
          cleanup()
          resolve(null)
        }

        img.src = dataUrl
      })
    } catch (error) {
      console.warn('대용량 이미지 압축 중 오류:', error)
      return null
    }
  }

  /**
   * PNG 이미지 최적화 (품질 저하 없이 크기 감소)
   * @param dataUrl 원본 PNG data URL
   * @returns 최적화된 PNG data URL
   */
  private async _optimizePngImage(dataUrl: string): Promise<string | null> {
    try {
      return new Promise<string | null>((resolve) => {
        let img: HTMLImageElement | null = new Image()
        let timeoutId: number | null = null

        const cleanup = () => {
          if (timeoutId) {
            clearTimeout(timeoutId)
            timeoutId = null
          }
          if (img) {
            img.onload = null
            img.onerror = null
            img = null
          }
        }

        timeoutId = window.setTimeout(() => {
          console.warn('PNG 최적화 타임아웃')
          cleanup()
          resolve(null)
        }, 15000)

        img.onload = () => {
          try {
            const canvas = document.createElement('canvas')
            const ctx = canvas.getContext('2d')
            if (!ctx || !img) {
              resolve(null)
              return
            }

            // P0-3: PNG 무손실 — 300 DPI 인쇄 등급 상한으로 통일(종전 1280은 인쇄 부적합)
            const maxSize = ServicePlugin.PRINT_MAX_IMAGE_DIMENSION
            let { width, height } = img

            if (width > maxSize || height > maxSize) {
              const ratio = Math.min(maxSize / width, maxSize / height)
              width = Math.floor(width * ratio)
              height = Math.floor(height * ratio)
            }

            canvas.width = width
            canvas.height = height

            ctx.imageSmoothingEnabled = true
            ctx.imageSmoothingQuality = 'high'
            ctx.clearRect(0, 0, width, height)
            ctx.drawImage(img, 0, 0, width, height)

            const optimizedDataUrl = canvas.toDataURL('image/png')
            resolve(optimizedDataUrl)
          } catch (error) {
            console.warn('PNG 최적화 중 오류:', error)
            resolve(null)
          } finally {
            cleanup()
          }
        }

        img.onerror = () => {
          console.warn('PNG 이미지 로드 실패')
          cleanup()
          resolve(null)
        }

        img.src = dataUrl
      })
    } catch (error) {
      console.warn('PNG 최적화 중 오류:', error)
      return null
    }
  }

  /**
   * 이미지를 PNG로 래스터라이즈 (SVG, GIF, WEBP 지원)
   * 대용량 이미지 처리 개선
   * @param dataUrl 원본 이미지 data URL
   * @returns PNG data URL 또는 null
   */
  private async _rasterizeDataUrlToPng(dataUrl: string): Promise<string | null> {
    try {
      return new Promise<string | null>((resolve) => {
        let img: HTMLImageElement | null = new Image()
        let timeoutId: number | null = null

        const cleanup = () => {
          if (timeoutId) {
            clearTimeout(timeoutId)
            timeoutId = null
          }
          if (img) {
            img.onload = null
            img.onerror = null
            img = null
          }
        }

        // 대용량 이미지를 고려한 긴 타임아웃
        timeoutId = window.setTimeout(() => {
          console.warn('이미지 래스터라이즈 타임아웃')
          cleanup()
          resolve(null)
        }, 20000)

        img.onload = () => {
          try {
            const canvas = document.createElement('canvas')
            const ctx = canvas.getContext('2d')
            if (!ctx || !img) {
              resolve(null)
              return
            }

            // P0-3: SVG/GIF/WEBP 래스터라이즈 — 300 DPI 인쇄 등급 상한으로 통일(종전 1600)
            const maxSize = ServicePlugin.PRINT_MAX_IMAGE_DIMENSION
            let { width, height } = img
            if (!width || !height) {
              width = maxSize
              height = maxSize
            }
            if (width > maxSize || height > maxSize) {
              const ratio = Math.min(maxSize / width, maxSize / height)
              width = Math.floor(width * ratio)
              height = Math.floor(height * ratio)
              console.log(
                `래스터라이즈 크기 조정: ${img.width}x${img.height} -> ${width}x${height}`
              )
            }

            canvas.width = width
            canvas.height = height

            // 고품질 렌더링 설정
            ctx.imageSmoothingEnabled = true
            ctx.imageSmoothingQuality = 'high'

            ctx.clearRect(0, 0, width, height)
            ctx.drawImage(img, 0, 0, width, height)

            const png = canvas.toDataURL('image/png')
            console.log(`래스터라이즈 완료: ${(png.length / 1024 / 1024).toFixed(2)}MB`)
            resolve(png)
          } catch (e) {
            console.warn('이미지 래스터라이즈 오류:', e)
            resolve(null)
          } finally {
            cleanup()
          }
        }

        img.onerror = () => {
          console.warn('이미지 래스터라이즈 로드 실패')
          cleanup()
          resolve(null)
        }

        img.src = dataUrl
      })
    } catch (e) {
      console.warn('이미지 래스터라이즈 오류:', e)
      return null
    }
  }

  /**
   * SVG to PDF 변환 오류에 대한 다단계 복구 전략
   * @param error 발생한 오류
   * @param svgElement SVG 엘리먼트
   * @param pdf PDF 문서
   * @param options svg2pdf 옵션
   * @returns 복구 성공 여부
   */
  private async _handleSvgToPdfError(
    error: any,
    svgElement: Element,
    pdf: jsPDF,
    options: any
  ): Promise<boolean> {
    const errorMessage = error.message?.toLowerCase() || ''
    console.log('SVG->PDF 오류 복구 시도:', errorMessage)

    // 전략 1: 이미지 관련 오류 - 이미지 제거 후 재시도
    if (
      errorMessage.includes('image') ||
      errorMessage.includes('callstack') ||
      errorMessage.includes('maximum')
    ) {
      console.log('전략 1: 모든 이미지 제거 후 재시도')
      try {
        const clonedSvg = svgElement.cloneNode(true) as Element
        const allImages = clonedSvg.querySelectorAll('image')
        allImages.forEach((img) => img.remove())
        await svg2pdf(clonedSvg, pdf, options)
        console.log('전략 1 성공: 이미지 제거 후 변환 완료')
        return true
      } catch (retryError) {
        console.warn('전략 1 실패:', retryError)
      }
    }

    // 전략 2: 복잡한 요소 제거 - 필터, 마스크, 클립패스 등
    console.log('전략 2: 복잡한 SVG 요소 제거 후 재시도')
    try {
      const simplifiedSvg = await this._simplifySvgForPdf(svgElement)
      await svg2pdf(simplifiedSvg, pdf, options)
      console.log('전략 2 성공: 단순화된 SVG 변환 완료')
      return true
    } catch (retryError) {
      console.warn('전략 2 실패:', retryError)
    }

    // 전략 3: Canvas를 통한 래스터화 -> PDF 추가
    console.log('전략 3: SVG -> Canvas -> Image -> PDF 변환 시도')
    try {
      const imageDataUrl = await this._svgToImageFallback(svgElement)
      if (imageDataUrl) {
        pdf.addImage(imageDataUrl, 'PNG', options.x, options.y, options.width, options.height)
        console.log('전략 3 성공: 래스터화 후 변환 완료')
        return true
      }
    } catch (retryError) {
      console.warn('전략 3 실패:', retryError)
    }

    console.error('모든 복구 전략 실패')
    return false
  }

  /**
   * SVG를 PDF 변환에 더 적합하도록 단순화
   * @param svgElement 원본 SVG 엘리먼트
   * @returns 단순화된 SVG 엘리먼트
   */
  private async _simplifySvgForPdf(svgElement: Element): Promise<Element> {
    const clonedSvg = svgElement.cloneNode(true) as Element

    // 문제가 될 수 있는 요소들 제거
    const problematicSelectors = [
      'filter',
      'mask',
      'clipPath',
      'pattern',
      'marker',
      'symbol',
      'use',
      'foreignObject'
    ]

    problematicSelectors.forEach((selector) => {
      const elements = clonedSvg.querySelectorAll(selector)
      elements.forEach((element) => element.remove())
    })

    // 문제가 될 수 있는 속성들 제거
    const problematicAttributes = [
      'filter',
      'mask',
      'clip-path',
      'marker-start',
      'marker-mid',
      'marker-end'
    ]

    const allElements = clonedSvg.querySelectorAll('*')
    allElements.forEach((element) => {
      problematicAttributes.forEach((attr) => {
        element.removeAttribute(attr)
      })
    })

    console.log('SVG 단순화 완료')
    return clonedSvg
  }

  /**
   * SVG를 Canvas를 통해 이미지로 변환하는 fallback 메서드
   * @param svgElement SVG 엘리먼트
   * @returns 이미지 data URL
   */
  private async _svgToImageFallback(svgElement: Element): Promise<string | null> {
    try {
      return new Promise<string | null>((resolve) => {
        const serializer = new XMLSerializer()
        const svgString = serializer.serializeToString(svgElement)
        const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
        const svgUrl = URL.createObjectURL(svgBlob)

        let img: HTMLImageElement | null = new Image()
        let timeoutId: number | null = null

        const cleanup = () => {
          if (timeoutId) {
            clearTimeout(timeoutId)
            timeoutId = null
          }
          if (img) {
            img.onload = null
            img.onerror = null
            img = null
          }
          URL.revokeObjectURL(svgUrl)
        }

        timeoutId = window.setTimeout(() => {
          console.warn('SVG -> Image 변환 타임아웃')
          cleanup()
          resolve(null)
        }, 15000)

        img.onload = () => {
          try {
            const canvas = document.createElement('canvas')
            const ctx = canvas.getContext('2d')
            if (!ctx || !img) {
              resolve(null)
              return
            }

            // 고해상도 렌더링
            const scale = 2
            canvas.width = img.width * scale
            canvas.height = img.height * scale

            ctx.scale(scale, scale)
            ctx.imageSmoothingEnabled = true
            ctx.imageSmoothingQuality = 'high'

            ctx.drawImage(img, 0, 0)

            const imageDataUrl = canvas.toDataURL('image/png')
            console.log(
              `SVG -> Image fallback 성공: ${(imageDataUrl.length / 1024 / 1024).toFixed(2)}MB`
            )
            resolve(imageDataUrl)
          } catch (error) {
            console.warn('SVG -> Image 변환 중 오류:', error)
            resolve(null)
          } finally {
            cleanup()
          }
        }

        img.onerror = () => {
          console.warn('SVG 이미지 로드 실패')
          cleanup()
          resolve(null)
        }

        img.src = svgUrl
      })
    } catch (error) {
      console.warn('SVG -> Image fallback 오류:', error)
      return null
    }
  }

  /**
   * 메모리 정리 및 가비지 컬렉션 유도
   * @param aggressive 공격적인 정리 여부
   */
  private async _performMemoryCleanup(aggressive = false): Promise<void> {
    // 마이크로태스크 큐 정리
    await new Promise((resolve) => setTimeout(resolve, 0))

    if (aggressive) {
      // 더 긴 대기시간으로 가비지 컬렉션 유도
      await new Promise((resolve) => setTimeout(resolve, 200))

      // 전역 가비지 컬렉션 힌트 (개발 환경에서만)
      if (typeof window !== 'undefined' && 'gc' in window) {
        try {
          ; (window as any).gc()
          console.log('수동 가비지 컬렉션 실행')
        } catch (e) {
          // 가비지 컬렉션이 사용 불가능한 경우 무시
        }
      }
    } else {
      // 일반적인 정리
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
}

export default ServicePlugin
