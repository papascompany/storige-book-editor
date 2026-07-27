import { useCallback } from 'react'
import type { LibraryFont } from '@storige/types'
import type { FontSource } from '@/utils/fontManager'
import { resolveStorageUrl } from '@/utils/fontManager'

// Simple logger for font preview
// ⚠️ info 는 간접 참조(객체 메서드)라 빌드의 pure(console.log) 제거가 닿지 않는다 →
//    DEV 게이트를 직접 건다. error 는 운영에서도 남긴다(진단 신호).
const logger = {
  info: (message: string) => {
    if (import.meta.env.DEV) console.log(`[FontPreview] ${message}`)
  },
  error: (message: string, error?: unknown) => console.error(`[FontPreview] ${message}`, error),
}

export const SAMPLE_TEXT = '가나다라'

// Global cache for loaded fonts
const loadedFonts = new Set<string>()
const loadingFonts = new Set<string>()
const errorFonts = new Set<string>()

// Check if font is loaded
export const isFontLoaded = (fontName: string): boolean => {
  return loadedFonts.has(fontName)
}

// Check if font is loading
export const isFontLoadingGlobal = (fontName: string): boolean => {
  return loadingFonts.has(fontName)
}

// Check if font has error
export const hasFontErrorGlobal = (fontName: string): boolean => {
  return errorFonts.has(fontName)
}

/**
 * 폰트 URL 추출 (LibraryFont 또는 FontSource 지원)
 */
const getFontUrlFromFont = (font: LibraryFont | FontSource): string | undefined => {
  // LibraryFont: fileUrl 사용 (상대 URL은 절대 URL로 변환)
  if ('fileUrl' in font) {
    return resolveStorageUrl(font.fileUrl)
  }
  // FontSource: file이 URL인 경우 (이미 변환되어 있어야 함)
  if (font.file.startsWith('http') || font.file.startsWith('/')) {
    return resolveStorageUrl(font.file)
  }
  return undefined
}

// Load a font
export const loadFont = async (font: LibraryFont | FontSource): Promise<boolean> => {
  const fontName = font.name

  // Already loaded
  if (loadedFonts.has(fontName)) {
    return true
  }

  // Has error
  if (errorFonts.has(fontName)) {
    return false
  }

  // Already loading
  if (loadingFonts.has(fontName)) {
    // Wait for loading to complete
    return new Promise((resolve) => {
      const checkLoaded = () => {
        if (loadedFonts.has(fontName)) {
          resolve(true)
        } else if (errorFonts.has(fontName)) {
          resolve(false)
        } else if (loadingFonts.has(fontName)) {
          setTimeout(checkLoaded, 50)
        } else {
          resolve(false)
        }
      }
      checkLoaded()
    })
  }

  const fontUrl = getFontUrlFromFont(font)
  if (!fontUrl) {
    logger.error(`Failed to get URL for font: ${fontName}`)
    errorFonts.add(fontName)
    return false
  }

  loadingFonts.add(fontName)

  try {
    const fontFace = new FontFace(fontName, `url(${fontUrl})`)
    const loadedFont = await fontFace.load()
    document.fonts.add(loadedFont)
    loadedFonts.add(fontName)
    logger.info(`Font loaded: ${fontName}`)
    return true
  } catch (error) {
    logger.error(`Failed to load font: ${fontName}`, error)
    errorFonts.add(fontName)
    return false
  } finally {
    loadingFonts.delete(fontName)
  }
}

// Hook for font preview
export const useFontPreview = () => {
  const loadFontPreview = useCallback(async (font: LibraryFont | FontSource): Promise<boolean> => {
    return loadFont(font)
  }, [])

  const isFontLoading = useCallback((fontName: string): boolean => {
    return loadingFonts.has(fontName)
  }, [])

  const hasFontError = useCallback((fontName: string): boolean => {
    return errorFonts.has(fontName)
  }, [])

  return {
    loadFontPreview,
    isFontLoading,
    hasFontError,
  }
}

export default useFontPreview
