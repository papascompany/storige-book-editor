import { PhotoJpegSpec } from '@storige/types';
import { DomainError, ErrorCodes } from '../common/errors';
import { assertPhotoJpegJobInput } from './photo-jpeg-input';

const spec = (i: number, over: Partial<PhotoJpegSpec> = {}): PhotoJpegSpec => ({
  index: i,
  page: i,
  copies: 1,
  label: `사진 ${i + 1}`,
  filename: `photo_${String(i + 1).padStart(3, '0')}_4x6_x1.jpg`,
  ...over,
});

const codeOf = (fn: () => void): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof DomainError ? e.code : 'NOT_DOMAIN';
  }
};

describe('assertPhotoJpegJobInput (photo-jpeg v1.36)', () => {
  const base = { dpi: 300, quality: 95 };

  it('순서대로 정확히 덮는 명세는 통과', () => {
    expect(codeOf(() => assertPhotoJpegJobInput({ ...base, photos: [spec(0), spec(1)], totalExpectedPages: 2 }))).toBeNull();
  });

  it.each<[string, Parameters<typeof assertPhotoJpegJobInput>[0], string]>([
    ['빈 photos', { ...base, photos: [], totalExpectedPages: 0 }, ErrorCodes.INVALID_OUTPUT_OPTIONS],
    ['dpi 범위 밖', { dpi: 50, quality: 95, photos: [spec(0)], totalExpectedPages: 1 }, ErrorCodes.INVALID_OUTPUT_OPTIONS],
    ['quality 범위 밖', { dpi: 300, quality: 0, photos: [spec(0)], totalExpectedPages: 1 }, ErrorCodes.INVALID_OUTPUT_OPTIONS],
    ['사진 수 ≠ 페이지 수', { ...base, photos: [spec(0)], totalExpectedPages: 2 }, ErrorCodes.PAGE_COUNT_MISMATCH],
    ['page 순서 어긋남', { ...base, photos: [spec(0), spec(1, { page: 0 })], totalExpectedPages: 2 }, ErrorCodes.PAGE_COUNT_MISMATCH],
    ['copies 0', { ...base, photos: [spec(0, { copies: 0 })], totalExpectedPages: 1 }, ErrorCodes.INVALID_OUTPUT_OPTIONS],
    ['경로 조각 파일 이름', { ...base, photos: [spec(0, { filename: '../x.jpg' })], totalExpectedPages: 1 }, ErrorCodes.INVALID_OUTPUT_OPTIONS],
    ['jpg 아닌 확장자', { ...base, photos: [spec(0, { filename: 'photo_001.png' })], totalExpectedPages: 1 }, ErrorCodes.INVALID_OUTPUT_OPTIONS],
    [
      '파일 이름 중복',
      { ...base, photos: [spec(0), spec(1, { filename: spec(0).filename })], totalExpectedPages: 2 },
      ErrorCodes.INVALID_OUTPUT_OPTIONS,
    ],
  ])('%s → %s', (_label, input, code) => {
    expect(codeOf(() => assertPhotoJpegJobInput(input))).toBe(code);
  });
});
