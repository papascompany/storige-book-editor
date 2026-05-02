import type { LibraryFont } from '@storige/types'
import { libraryApi } from '@/api/library'

// 하위 호환성을 위한 FontSource 타입 (LibraryFont와 호환)
export interface FontSource {
  name: string
  file: string  // fileUrl을 file로 매핑
}

export const DEFAULT_FONT_FAMILY = '본고딕(Noto Sans) Regular'

// API 베이스 URL (스토리지 파일 접근용)
// 개발 환경에서는 Vite 프록시가 /storage를 제대로 처리하지 못하므로 직접 API 서버에 접근
const STORAGE_BASE_URL = import.meta.env.VITE_API_URL || (
  import.meta.env.DEV ? 'http://localhost:4000' : ''
)

/**
 * 상대 스토리지 URL을 절대 URL로 변환
 */
export const resolveStorageUrl = (url: string): string => {
  // 이미 절대 URL인 경우 그대로 반환
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }
  // 상대 URL인 경우 베이스 URL 추가
  if (url.startsWith('/storage')) {
    return `${STORAGE_BASE_URL}${url}`
  }
  return url
}

// 폰트 목록 (API에서 로드)
let fontList: LibraryFont[] = []
let isLoaded = false
let isLoading = false

/**
 * API에서 폰트 목록 로드
 */
export const loadFonts = async (): Promise<LibraryFont[]> => {
  // 이미 로드된 경우 캐시된 목록 반환
  if (isLoaded) return fontList

  // 이미 로딩 중인 경우 대기
  if (isLoading) {
    return new Promise((resolve) => {
      const checkLoaded = () => {
        if (isLoaded) {
          resolve(fontList)
        } else {
          setTimeout(checkLoaded, 100)
        }
      }
      checkLoaded()
    })
  }

  isLoading = true

  try {
    fontList = await libraryApi.getFonts()
    isLoaded = true
    if (import.meta.env.DEV) {
      console.log(`[FontManager] ${fontList.length}개 폰트 로드 완료`)
    }
  } catch (error) {
    console.error('[FontManager] 폰트 목록 로드 실패:', error)
    fontList = []
    isLoaded = true // 실패해도 로드 완료로 표시 (빈 목록 사용)
  } finally {
    isLoading = false
  }

  return fontList
}

/**
 * 폰트 목록 반환
 */
export const getFontList = (): LibraryFont[] => fontList

/**
 * 하위 호환성을 위한 FontSource 형식 폰트 목록 반환
 */
export const getFontListAsSource = (): FontSource[] => {
  return fontList.map((font) => ({
    name: font.name,
    file: resolveStorageUrl(font.fileUrl),
  }))
}

/**
 * 폰트 URL 반환 (fileUrl 직접 사용)
 */
export const getFontUrl = (fileNameOrUrl: string): string | undefined => {
  // 이미 절대 URL 형식인 경우 그대로 반환
  if (fileNameOrUrl.startsWith('http://') || fileNameOrUrl.startsWith('https://')) {
    return fileNameOrUrl
  }

  // 상대 URL인 경우 절대 URL로 변환
  if (fileNameOrUrl.startsWith('/')) {
    return resolveStorageUrl(fileNameOrUrl)
  }

  // 파일명인 경우 해당 폰트 찾기
  const font = fontList.find((f) => f.fileUrl.includes(fileNameOrUrl))
  return font ? resolveStorageUrl(font.fileUrl) : undefined
}

/**
 * 폰트 이름으로 검색
 */
export const findFontByName = (name: string): LibraryFont | undefined => {
  const normalizedName = name.trim().toLowerCase()
  return fontList.find((font) => font.name.toLowerCase() === normalizedName)
}

/**
 * 폰트 검색
 */
export const searchFonts = (searchTerm: string): LibraryFont[] => {
  if (!searchTerm.trim()) return fontList

  const normalizedTerm = searchTerm.toLowerCase().trim()
  return fontList.filter((font) => font.name.toLowerCase().includes(normalizedTerm))
}

/**
 * 폰트 목록 새로고침 (캐시 무효화)
 */
export const refreshFonts = async (): Promise<LibraryFont[]> => {
  isLoaded = false
  isLoading = false
  return loadFonts()
}

/**
 * 폰트 로드 상태 확인
 */
export const isFontsLoaded = (): boolean => isLoaded
