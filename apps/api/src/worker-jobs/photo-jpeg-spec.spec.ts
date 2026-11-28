/**
 * assertPhotoJpegCoversPages — photo-jpeg 잡 명세 검증(계약 v1.36).
 */
import { UnprocessableEntityException } from '@nestjs/common';
import type { PhotoJpegSpec } from '@storige/types';
import { assertPhotoJpegCoversPages } from './worker-jobs.service';

const spec = (i: number, o: Partial<PhotoJpegSpec> = {}): PhotoJpegSpec => ({
  index: i,
  page: i,
  copies: 1,
  label: `사진 ${i + 1}`,
  filename: `photo_${String(i + 1).padStart(3, '0')}_4x6_x1.jpg`,
  ...o,
});

const codeOf = (fn: () => void): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    if (!(e instanceof UnprocessableEntityException)) return 'OTHER';
    return (e.getResponse() as { code: string }).code;
  }
};

describe('assertPhotoJpegCoversPages', () => {
  it('0..n-1 을 순서대로 덮으면 통과', () => {
    expect(codeOf(() => assertPhotoJpegCoversPages([spec(0), spec(1)], 2))).toBeNull();
  });

  it.each<[string, PhotoJpegSpec[], number]>([
    ['빈 배열', [], 0],
    ['쪽 수 불일치', [spec(0)], 2],
    ['순서 어긋남', [spec(1, { index: 0 }), spec(0, { index: 1 })], 2],
    ['copies 0', [spec(0, { copies: 0 })], 1],
    ['경로 조각', [spec(0, { filename: 'a/b.jpg' })], 1],
    ['점으로 시작', [spec(0, { filename: '.hidden.jpg' })], 1],
    ['중복 이름', [spec(0), spec(1, { filename: spec(0).filename })], 2],
  ])('%s → PHOTO_JPEG_SPEC_INVALID', (_label, photos, total) => {
    expect(codeOf(() => assertPhotoJpegCoversPages(photos, total))).toBe('PHOTO_JPEG_SPEC_INVALID');
  });
});
