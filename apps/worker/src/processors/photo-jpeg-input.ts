import { PhotoJpegSynthesisJobData } from '@storige/types';
import { DomainError, ErrorCodes } from '../common/errors';

/**
 * 합성 mode 'photo-jpeg' 잡 데이터 검증(다운로드 전, 순수 함수, 계약 v1.36).
 *
 * api `worker-jobs.service` 의 assertPhotoJpegCoversPages 와 같은 규칙을 워커 로컬로 다시 구현한다(패키지 경계).
 * - photos 비어있음 / dpi·quality 범위 밖 / copies ≥1 정수 아님 / 파일 이름 규칙 위반·중복 → INVALID_OUTPUT_OPTIONS
 * - index·page ≠ 순번 / photos 수 ≠ totalExpectedPages → PAGE_COUNT_MISMATCH
 * 두 코드 모두 synthesis-retry 의 비재시도 입력 오류(즉시 FAILED).
 */

/** 영숫자로 시작, 영숫자·점·밑줄·하이픈, `.jpg` 끝 — 경로 조각(`/`, `..` 시작) 불가 */
export const PHOTO_JPEG_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.jpg$/;
export const PHOTO_JPEG_DPI_RANGE = { min: 72, max: 1200 } as const;
export const PHOTO_JPEG_QUALITY_RANGE = { min: 1, max: 100 } as const;

function invalidOptions(message: string, detail?: Record<string, unknown>): DomainError {
  return new DomainError(ErrorCodes.INVALID_OUTPUT_OPTIONS, message, detail);
}

function isIntIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function assertPhotoJpegJobInput(
  data: Pick<PhotoJpegSynthesisJobData, 'photos' | 'dpi' | 'quality' | 'totalExpectedPages'>,
): void {
  const { photos, dpi, quality, totalExpectedPages } = data;

  if (!Array.isArray(photos) || photos.length === 0) {
    throw invalidOptions('photo-jpeg: photos 가 비어 있습니다');
  }
  if (!isIntIn(dpi, PHOTO_JPEG_DPI_RANGE.min, PHOTO_JPEG_DPI_RANGE.max)) {
    throw invalidOptions('photo-jpeg: dpi 범위 밖', { dpi });
  }
  if (!isIntIn(quality, PHOTO_JPEG_QUALITY_RANGE.min, PHOTO_JPEG_QUALITY_RANGE.max)) {
    throw invalidOptions('photo-jpeg: quality 범위 밖', { quality });
  }
  if (photos.length !== totalExpectedPages) {
    throw new DomainError(ErrorCodes.PAGE_COUNT_MISMATCH, 'photo-jpeg: 사진 수 ≠ 기대 페이지 수', {
      photos: photos.length,
      expected: totalExpectedPages,
    });
  }
  const names = new Set<string>();
  photos.forEach((photo, i) => {
    if (photo?.index !== i || photo?.page !== i) {
      throw new DomainError(ErrorCodes.PAGE_COUNT_MISMATCH, 'photo-jpeg: index/page 가 순서와 다릅니다', {
        position: i,
        index: photo?.index,
        page: photo?.page,
      });
    }
    if (!isIntIn(photo.copies, 1, Number.MAX_SAFE_INTEGER)) {
      throw invalidOptions('photo-jpeg: copies 가 1 이상 정수가 아닙니다', { position: i, copies: photo.copies });
    }
    if (typeof photo.filename !== 'string' || !PHOTO_JPEG_FILENAME_RE.test(photo.filename)) {
      throw invalidOptions('photo-jpeg: 파일 이름 규칙 위반', { position: i });
    }
    if (names.has(photo.filename)) {
      throw invalidOptions('photo-jpeg: 파일 이름 중복', { position: i, filename: photo.filename });
    }
    names.add(photo.filename);
    if (photo.cropMm !== undefined) {
      const c = photo.cropMm;
      const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
      if (!c || !fin(c.left) || !fin(c.top) || !fin(c.width) || !fin(c.height) || c.left < 0 || c.top < 0 || c.width <= 0 || c.height <= 0) {
        throw invalidOptions('photo-jpeg: cropMm 이 올바르지 않습니다', { position: i });
      }
    }
  });
}
