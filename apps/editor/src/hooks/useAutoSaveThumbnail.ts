import { useCallback } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { storageApi } from '@/api/storage'

// 모바일/터치 환경에서는 fabric retina(DPR=3) 캔버스의 toDataURL이 매우 비싸 iOS Safari
// 메모리 한계와 만나 페이지 크래시 유발 → 모바일에선 캡처 자체를 스킵.
// (useAppStore.ts의 동일 패턴, 모바일 페이지 크래시 fix `60efb05` 참고)
function isTouchEnv(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  try {
    return window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}
const TOUCH_ENV = isTouchEnv()

// dataURL → Blob 변환. fabric.toDataURL이 base64 PNG/JPEG를 반환하므로
// fetch().blob() 대신 직접 atob로 디코딩 (fetch가 dataURL에 대해 일부 환경에서 느림).
function dataURLtoBlob(dataUrl: string): Blob | null {
  const match = dataUrl.match(/^data:(.+?);base64,(.*)$/)
  if (!match) return null
  const mime = match[1]
  const binary = atob(match[2])
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/**
 * BB-Phase 3 follow-up — 자동저장 시점 썸네일 캡처 + 업로드 helper.
 *
 * 흐름
 * 1. 모바일이면 즉시 null 반환 (TOUCH_ENV 가드)
 * 2. 현재 활성 캔버스를 0.25x JPEG(quality 0.7)로 toDataURL
 * 3. dataURL → Blob → /storage/upload/thumbnails 업로드
 * 4. 응답 url 반환 (실패 시 null — autoSave는 그대로 진행)
 *
 * 정책
 * - 단일 페이지(현재 활성)만 캡처. 멀티 페이지 콜라주는 1차 미도입.
 * - 실패는 자동저장 자체를 깨면 안 됨 → catch 후 null 반환.
 * - 0.25x + JPEG 0.7로 일반 A4 페이지 ~10-30KB.
 */
export function useAutoSaveThumbnail() {
  const captureAndUpload = useCallback(async (): Promise<string | null> => {
    if (TOUCH_ENV) return null
    const canvas = useAppStore.getState().canvas
    if (!canvas) return null
    try {
      const dataUrl = canvas.toDataURL({
        format: 'jpeg',
        multiplier: 0.25,
        quality: 0.7,
      })
      const blob = dataURLtoBlob(dataUrl)
      if (!blob) return null
      const result = await storageApi.uploadThumbnail(blob, `version-${Date.now()}.jpg`)
      return result?.url ?? null
    } catch (e) {
      console.warn('[useAutoSaveThumbnail] capture/upload 실패 (무시):', e)
      return null
    }
  }, [])

  return { captureAndUpload }
}
