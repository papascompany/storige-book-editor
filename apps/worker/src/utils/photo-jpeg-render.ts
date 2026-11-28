import * as fs from 'fs/promises';
import sharp from 'sharp';
import { DomainError, ErrorCodes } from '../common/errors';
import { GS_RASTER_TIMEOUT_MS, runGhostscript } from './ghostscript';

/**
 * PDF 한 페이지 → 인화용 sRGB JPEG(계약 v1.36 photo-jpeg).
 *
 * 1) Ghostscript png16m(RGB, 안티에일리어싱)로 dpi 래스터 — 페이지 상자(MediaBox) 전체. 인화형 세트는 도련 0 이라
 *    MediaBox = 재단 크기다.
 * 2) (v1.37) cropMm 이 있으면 쪽 크기(pageSizeMm) 대비 픽셀 비율로 그 영역만 잘라 낸다(인스탁스 사진 창 등).
 * 3) sharp 로 JPEG(4:4:4 — 색 번짐 없는 크로마, 품질 quality) + sRGB ICC 내장 + 해상도(dpi) 메타.
 * 임시 PNG 는 함수 안에서 지운다. 반환값은 산출 JPEG 픽셀 크기.
 */
export async function renderPdfPageToJpeg(opts: {
  inputPath: string;
  /** 1-base 페이지 번호 */
  page: number;
  dpi: number;
  quality: number;
  tempPngPath: string;
  outputPath: string;
  /** (v1.37) 잘라 낼 영역 — 쪽 왼쪽 위 기준 mm */
  cropMm?: { left: number; top: number; width: number; height: number };
  /** cropMm 을 픽셀로 바꿀 때 쓰는 쪽 크기(mm, PDF 쪽 상자) */
  pageSizeMm?: { width: number; height: number };
}): Promise<{ width: number; height: number; bytes: number }> {
  const { inputPath, page, dpi, quality, tempPngPath, outputPath, cropMm, pageSizeMm } = opts;
  try {
    await runGhostscript(
      [
        '-q',
        '-dNOPAUSE',
        '-dBATCH',
        '-dSAFER',
        '-sDEVICE=png16m',
        `-r${dpi}`,
        '-dTextAlphaBits=4',
        '-dGraphicsAlphaBits=4',
        `-dFirstPage=${page}`,
        `-dLastPage=${page}`,
        `-sOutputFile=${tempPngPath}`,
        inputPath,
      ],
      GS_RASTER_TIMEOUT_MS,
    );
    let pipeline = sharp(tempPngPath);
    if (cropMm) {
      if (!pageSizeMm || !(pageSizeMm.width > 0) || !(pageSizeMm.height > 0)) {
        throw new DomainError(ErrorCodes.INVALID_OUTPUT_OPTIONS, 'photo-jpeg: cropMm 에 필요한 쪽 크기를 알 수 없습니다');
      }
      const meta = await sharp(tempPngPath).metadata();
      const imgW = meta.width ?? 0;
      const imgH = meta.height ?? 0;
      const sx = imgW / pageSizeMm.width;
      const sy = imgH / pageSizeMm.height;
      const left = Math.round(cropMm.left * sx);
      const top = Math.round(cropMm.top * sy);
      const width = Math.min(Math.round(cropMm.width * sx), imgW - left);
      const height = Math.min(Math.round(cropMm.height * sy), imgH - top);
      if (left < 0 || top < 0 || width <= 0 || height <= 0) {
        throw new DomainError(ErrorCodes.INVALID_OUTPUT_OPTIONS, 'photo-jpeg: cropMm 이 쪽 밖입니다', {
          cropMm,
          pageSizeMm,
        });
      }
      pipeline = sharp(await sharp(tempPngPath).extract({ left, top, width, height }).toBuffer());
    }
    const info = await pipeline
      .flatten({ background: '#ffffff' })
      .withIccProfile('srgb')
      .withMetadata({ density: dpi })
      .jpeg({ quality, chromaSubsampling: '4:4:4', mozjpeg: false })
      .toFile(outputPath);
    return { width: info.width, height: info.height, bytes: info.size };
  } finally {
    await fs.rm(tempPngPath, { force: true }).catch(() => {});
  }
}
