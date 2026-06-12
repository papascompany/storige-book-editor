/**
 * ScreenshotPlugin
 *
 * 캔버스 스크린샷 및 썸네일 생성 플러그인
 */

import { fabric } from 'fabric'
import Editor from '../Editor'
import CanvasHotkey from '../models/CanvasHotkey'
import { PluginBase, PluginOption } from '../plugin'
import { core } from '../utils'

/**
 * 스크린샷 옵션
 */
export interface ScreenshotOptions {
  format?: 'png' | 'jpeg' | 'webp'
  quality?: number
  multiplier?: number
  left?: number
  top?: number
  width?: number
  height?: number
  enableRetinaScaling?: boolean
}

/**
 * 썸네일 옵션
 */
export interface ThumbnailOptions extends ScreenshotOptions {
  maxWidth?: number
  maxHeight?: number
  backgroundColor?: string
}

/**
 * DataURL 내보내기 옵션
 */
export interface ExportOptions extends ScreenshotOptions {
  includeWorkspaceOnly?: boolean
}

class ScreenshotPlugin extends PluginBase {
  name = 'ScreenshotPlugin'
  events = ['screenshot:taken', 'thumbnail:generated']
  hotkeys: CanvasHotkey[] = []

  constructor(canvas: fabric.Canvas, editor: Editor, options: PluginOption = {}) {
    super(canvas, editor, options)
  }

  /**
   * 캔버스 스크린샷 촬영
   */
  takeScreenshot(options: ScreenshotOptions = {}): string {
    const {
      format = 'png',
      quality = 1,
      multiplier = 1,
      left,
      top,
      width,
      height,
      enableRetinaScaling = false
    } = options

    const dataURL = this._canvas.toDataURL({
      format,
      quality,
      multiplier,
      left,
      top,
      width,
      height,
      enableRetinaScaling
    })

    this._editor.emit('screenshot:taken', dataURL)
    return dataURL
  }

  /**
   * 워크스페이스 영역만 스크린샷
   */
  takeWorkspaceScreenshot(options: ScreenshotOptions = {}): string | null {
    const workspace = this._getWorkspace()
    if (!workspace) {
      console.warn('워크스페이스를 찾을 수 없습니다')
      return null
    }

    const bound = workspace.getBoundingRect()

    return this.takeScreenshot({
      ...options,
      left: bound.left,
      top: bound.top,
      width: bound.width,
      height: bound.height
    })
  }

  /**
   * 썸네일 생성
   */
  async generateThumbnail(options: ThumbnailOptions = {}): Promise<string> {
    const {
      maxWidth = 200,
      maxHeight = 200,
      backgroundColor,
      format = 'png',
      quality = 0.8
    } = options

    const workspace = this._getWorkspace()

    // 원본 캔버스에서 데이터 추출
    let sourceWidth = this._canvas.width || 800
    let sourceHeight = this._canvas.height || 600

    if (workspace) {
      const bound = workspace.getBoundingRect()
      sourceWidth = bound.width
      sourceHeight = bound.height
    }

    // 비율 계산
    const ratio = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight)
    const targetWidth = Math.floor(sourceWidth * ratio)
    const targetHeight = Math.floor(sourceHeight * ratio)

    // 임시 캔버스 생성
    const tempCanvasEl = document.createElement('canvas')
    tempCanvasEl.width = targetWidth
    tempCanvasEl.height = targetHeight

    const ctx = tempCanvasEl.getContext('2d')
    if (!ctx) {
      throw new Error('Canvas 2D context를 얻을 수 없습니다')
    }

    // 배경색 설정
    if (backgroundColor) {
      ctx.fillStyle = backgroundColor
      ctx.fillRect(0, 0, targetWidth, targetHeight)
    }

    // 원본 캔버스 이미지 가져오기
    let sourceDataURL: string

    if (workspace) {
      const bound = workspace.getBoundingRect()
      sourceDataURL = this._canvas.toDataURL({
        format,
        quality: 1,
        left: bound.left,
        top: bound.top,
        width: bound.width,
        height: bound.height
      })
    } else {
      sourceDataURL = this._canvas.toDataURL({
        format,
        quality: 1
      })
    }

    // 이미지 로드 및 리사이즈
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight)
        const thumbnailDataURL = tempCanvasEl.toDataURL(`image/${format}`, quality)
        this._editor.emit('thumbnail:generated', thumbnailDataURL)
        resolve(thumbnailDataURL)
      }
      img.onerror = () => {
        reject(new Error('썸네일 생성 실패: 이미지 로드 오류'))
      }
      img.src = sourceDataURL
    })
  }

  /**
   * DataURL로 내보내기
   */
  exportToDataURL(options: ExportOptions = {}): string {
    const { includeWorkspaceOnly = false, ...screenshotOptions } = options

    if (includeWorkspaceOnly) {
      const result = this.takeWorkspaceScreenshot(screenshotOptions)
      return result || ''
    }

    return this.takeScreenshot(screenshotOptions)
  }

  /**
   * JSON에서 임시 캔버스 생성 후 스크린샷
   */
  async generateThumbnailFromJSON(
    json: object,
    options: ThumbnailOptions = {}
  ): Promise<string> {
    const {
      maxWidth = 200,
      maxHeight = 200,
      backgroundColor = '#ffffff',
      format = 'png',
      quality = 0.8
    } = options

    // 임시 캔버스 엘리먼트 생성
    const tempCanvasEl = document.createElement('canvas')
    tempCanvasEl.id = `temp-screenshot-${Date.now()}`
    tempCanvasEl.style.display = 'none'
    document.body.appendChild(tempCanvasEl)

    try {
      // fabric 캔버스 생성
      const tempCanvas = new fabric.Canvas(tempCanvasEl.id, {
        width: maxWidth,
        height: maxHeight,
        backgroundColor
      })

      // JSON 로드 (교차출처 이미지 crossOrigin 주입 — 썸네일 toDataURL taint 방어)
      const loadInput = core.ensureImageCrossOrigin(json)
      await new Promise<void>((resolve, reject) => {
        tempCanvas.loadFromJSON(loadInput, () => {
          tempCanvas.renderAll()
          resolve()
        })
      })

      // 워크스페이스 찾기 및 영역 계산
      const workspace = tempCanvas.getObjects().find((obj) => obj.id === 'workspace')

      let dataURL: string

      if (workspace) {
        const bound = workspace.getBoundingRect()

        // 비율 유지하며 리사이즈
        const ratio = Math.min(maxWidth / bound.width, maxHeight / bound.height)

        tempCanvas.setDimensions({
          width: Math.floor(bound.width * ratio),
          height: Math.floor(bound.height * ratio)
        })

        tempCanvas.setViewportTransform([ratio, 0, 0, ratio, -bound.left * ratio, -bound.top * ratio])
        tempCanvas.renderAll()

        dataURL = tempCanvas.toDataURL({
          format,
          quality
        })
      } else {
        dataURL = tempCanvas.toDataURL({
          format,
          quality
        })
      }

      // 정리
      tempCanvas.dispose()

      return dataURL
    } finally {
      // DOM에서 임시 캔버스 제거
      if (tempCanvasEl.parentNode) {
        tempCanvasEl.parentNode.removeChild(tempCanvasEl)
      }
    }
  }

  dispose(): void {
    // 정리할 리소스 없음
  }
}

export default ScreenshotPlugin
