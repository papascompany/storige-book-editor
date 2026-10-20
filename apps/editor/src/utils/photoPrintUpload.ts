import { useSettingsStore } from '@/stores/useSettingsStore'
import { showToast } from '@/stores/useToastStore'
import { isPhotoPrintProfile } from '@/utils/productProfile'

/**
 * photoPrintUpload.ts — 사진인화 업로드 한도(P2-d, 2026-10-19; checkMobileFileSize 패턴)
 *
 * 프로파일 `photoPrint.upload { maxPhotos, maxMb }` 를 selectFiles 직후에 강제한다.
 * - 현재 사진 수 + 선택 파일 수 > maxPhotos → 토스트 + false
 * - 파일 1개라도 size > maxMb(MB) → 토스트 + false
 * - 프로파일 NULL·비사진인화 세트 = 항상 true(no-op, 기존 동작 바이트 동일)
 */

const MB = 1024 * 1024

export function photoCountLimitMessage(maxPhotos: number, current: number): string {
  return `사진은 최대 ${maxPhotos}장까지 추가할 수 있습니다. (현재 ${current}장)`
}

export function photoSizeLimitMessage(maxMb: number, sizeMb: string): string {
  return `이미지가 너무 큽니다 (${sizeMb}MB). 이 상품은 ${maxMb}MB 이하만 지원합니다.`
}

/**
 * 자동배치(AppImage autofill) 입력 수량 한도 — 외부 주입 ∪ 내 업로드 사진 수가 maxPhotos 를 넘으면 토스트 + false.
 * 프로파일 NULL·비사진인화 세트 = 항상 true(no-op).
 */
export function checkPhotoPrintPhotoCount(photoCount: number): boolean {
  const profile = useSettingsStore.getState().productProfile
  if (!isPhotoPrintProfile(profile)) return true
  const { maxPhotos } = profile.photoPrint.upload
  if (!Number.isFinite(maxPhotos) || maxPhotos < 1) return true
  const count = Number.isFinite(photoCount) && photoCount > 0 ? Math.floor(photoCount) : 0
  if (count <= maxPhotos) return true
  showToast(photoCountLimitMessage(maxPhotos, count), 'error', 5000)
  return false
}

/**
 * @param files 선택한 파일 목록(selectFiles 결과)
 * @param currentPhotoCount 이미 추가된 사진 수(내 업로드 + 외부 주입 사진)
 * @returns 진행 가능하면 true. false 면 호출자가 중단한다(토스트는 여기서 띄운다)
 */
export function checkPhotoPrintUploadLimit(
  files: ReadonlyArray<File> | FileList | null | undefined,
  currentPhotoCount: number,
): boolean {
  const profile = useSettingsStore.getState().productProfile
  if (!isPhotoPrintProfile(profile)) return true
  const list: File[] = files ? Array.from(files as ArrayLike<File>) : []
  if (list.length === 0) return true
  const { maxPhotos, maxMb } = profile.photoPrint.upload
  const current = Number.isFinite(currentPhotoCount) && currentPhotoCount > 0 ? Math.floor(currentPhotoCount) : 0

  if (Number.isFinite(maxPhotos) && maxPhotos >= 1 && current + list.length > maxPhotos) {
    showToast(photoCountLimitMessage(maxPhotos, current), 'error', 5000)
    return false
  }
  if (Number.isFinite(maxMb) && maxMb > 0) {
    const limitBytes = maxMb * MB
    const tooBig = list.find((f) => f.size > limitBytes)
    if (tooBig) {
      showToast(photoSizeLimitMessage(maxMb, (tooBig.size / MB).toFixed(1)), 'error', 5000)
      return false
    }
  }
  return true
}
