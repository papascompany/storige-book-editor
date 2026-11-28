import * as fs from 'fs/promises';
import sharp from 'sharp';
import { GS_RASTER_TIMEOUT_MS, runGhostscript } from './ghostscript';

/**
 * PDF 한 페이지 → 인화용 sRGB JPEG(계약 v1.36 photo-jpeg).
 *
 * 1) Ghostscript png16m(RGB, 안티에일리어싱)로 dpi 래스터 — 페이지 상자(MediaBox) 전체. 인화형 세트는 도련 0 이라
 *    MediaBox = 재단 크기다.
 * 2) sharp 로 JPEG(4:4:4 — 색 번짐 없는 크로마, 품질 quality) + sRGB ICC 내장 + 해상도(dpi) 메타.
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
}): Promise<{ width: number; height: number; bytes: number }> {
  const { inputPath, page, dpi, quality, tempPngPath, outputPath } = opts;
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
    const info = await sharp(tempPngPath)
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
