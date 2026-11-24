import type { ExternalPhoto } from '@storige/types'
import { adaptUploadedPhotoMeta, type AutofillResult, type UploadedPhotoMeta } from '@/utils/photoPlacement'

/**
 * photoPrintBatchUpload.ts — 사진인화 세트의 툴바 "업로드" (여러 장 선택 → 빈 사진틀 순서대로 채움)
 *
 * 일반 업로드(uploadSimple)는 사진을 캔버스에 낱개 이미지로 올린다. 사진인화에서는 그 이미지가
 * 사진틀과 이어지지 않아 ① 한 장씩만 고를 수 있고 ② 항목 sourcePhotoId 가 비고 ③ 페이퍼풀(cover)이
 * 아닌 contain 으로 놓였다. 이 흐름은 파일마다 storage 에 등록(registerUploadedPhoto — url·fileId 기록)한 뒤
 * 자동편집 엔진(autofillPhotosIntoFrames → fillImageIntoFrame)으로 빈 틀을 채워 세 가지를 한 번에 맞춘다.
 *
 * 부수효과(파일 선택·업로드·채움)는 deps 로 주입한다 — 순서·집계만 여기서 결정한다(테스트 대상).
 * 틀이 모자라 남은 사진은 '내 업로드'에 남아 이후 페이지 추가·자동편집으로 쓸 수 있다.
 */

export interface PhotoPrintBatchDeps {
  /** 파일 선택(multiple). 취소면 빈 배열 */
  selectFiles: () => Promise<File[]>
  /** 선택 직후 한도 검사(maxPhotos/maxMb). false 면 중단 — 토스트는 호출된 쪽이 띄운다 */
  checkLimit: (files: File[]) => boolean
  /** 파일별 검사(모바일 용량 등). false 인 파일만 건너뛴다 */
  checkFile: (file: File) => boolean
  /** storage 등록. 실패면 undefined */
  register: (file: File) => Promise<UploadedPhotoMeta | undefined>
  /** 등록된 사진으로 빈 사진틀 채우기 */
  autofill: (photos: ExternalPhoto[]) => Promise<AutofillResult>
}

export interface PhotoPrintBatchResult {
  selected: number
  /** 파일 검사에서 빠진 수 */
  skipped: number
  /** storage 등록 실패 수 */
  uploadFailed: number
  /** 채운 사진틀 수 */
  filled: number
  /** 틀이 모자라 배치하지 못한 사진 수('내 업로드'에 남음) */
  unplaced: number
  /** 불러오기·채우기 실패 수 */
  fillFailed: number
  /** 채운 뒤 남은 빈 사진틀 수 */
  remainingFrames: number
}

/** 선택 취소·한도 초과면 null(아무것도 하지 않음) */
export async function runPhotoPrintBatchUpload(deps: PhotoPrintBatchDeps): Promise<PhotoPrintBatchResult | null> {
  const files = await deps.selectFiles()
  if (files.length === 0) return null
  if (!deps.checkLimit(files)) return null

  let skipped = 0
  let uploadFailed = 0
  const metas: UploadedPhotoMeta[] = []
  // 순차 등록 — 공개 업로드 경로는 IP 당 분당 횟수 제한이 있어 동시 요청으로 몰지 않는다.
  for (const file of files) {
    if (!deps.checkFile(file)) {
      skipped++
      continue
    }
    const meta = await deps.register(file)
    if (meta?.url) metas.push(meta)
    else uploadFailed++
  }

  if (metas.length === 0) {
    return { selected: files.length, skipped, uploadFailed, filled: 0, unplaced: 0, fillFailed: 0, remainingFrames: 0 }
  }

  const r = await deps.autofill(adaptUploadedPhotoMeta(metas))
  return {
    selected: files.length,
    skipped,
    uploadFailed,
    filled: r.filledCount,
    unplaced: r.remainingPhotos,
    fillFailed: r.failedPhotos,
    remainingFrames: r.remainingFrames,
  }
}

/** 결과 토스트 문구와 수준 */
export function photoPrintBatchMessage(r: PhotoPrintBatchResult): { text: string; level: 'success' | 'warning' | 'info' } {
  const parts: string[] = []
  if (r.filled > 0) parts.push(`사진 ${r.filled}장을 넣었습니다.`)
  if (r.unplaced > 0) parts.push(`빈 칸이 모자라 ${r.unplaced}장이 남았습니다. 페이지를 추가한 뒤 '이미지' 메뉴의 '사진 자동편집'으로 넣을 수 있습니다.`)
  const failed = r.uploadFailed + r.fillFailed
  if (failed > 0) parts.push(`${failed}장은 올리지 못했습니다. 잠시 후 다시 시도해 주세요.`)
  if (r.skipped > 0) parts.push(`${r.skipped}장은 용량이 커서 건너뛰었습니다.`)
  if (r.filled > 0 && r.remainingFrames > 0) parts.push(`빈 칸 ${r.remainingFrames}개가 남아 있습니다.`)
  if (parts.length === 0) return { text: '채울 빈 칸이 없습니다.', level: 'info' }
  const level = failed > 0 || r.skipped > 0 || r.unplaced > 0 || r.filled === 0 ? 'warning' : 'success'
  return { text: parts.join(' '), level }
}
