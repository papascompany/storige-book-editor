/**
 * 편집 완료 CMYK 변환의 이미지 선변환 (2026-11-23).
 *
 * Ghostscript pdfwrite 는 RGB 이미지를 화소 하나씩 ICC 변환해 느리다(실측 약 100만 화소/초 — 300dpi 전면 이미지 3장,
 * 1,860만 화소 책자 표지가 17초). 그래서 GS 에 넘기기 전에 RGB 래스터 이미지만 sharp(libvips)로 같은 출력 ICC 의
 * CMYK 로 바꿔 둔다(같은 표지 이미지 3장 약 2.5초). 이미 DeviceCMYK 인 이미지는 GS 가 다시 변환하지 않는다.
 * 텍스트·벡터·OutputIntent 는 종전대로 GS 가 처리한다.
 *
 * 규칙(보수적 — 확실히 다룰 수 있는 이미지만 바꾸고, 나머지는 그대로 두어 GS 가 종전처럼 변환한다):
 *  - 대상: /Subtype /Image, /ColorSpace /DeviceRGB, /BitsPerComponent 8, /ImageMask·/Decode·색상키 /Mask 없음.
 *  - 필터: FlateDecode(예측자 없음 또는 PNG 예측자 10~15, Colors 3·Columns=Width) 또는 DCTDecode 단일 필터.
 *  - 결과: DeviceCMYK 8bit, FlateDecode. /SMask(알파)·/Interpolate·/Intent 등 나머지 항목은 유지한다.
 *  - 이미지 하나가 실패하면 그 이미지만 건너뛴다. 바꾼 이미지가 없으면 파일을 다시 쓰지 않는다.
 *  - 호출부는 이 함수 전체가 실패해도 GS 변환을 그대로 진행한다(결과는 같고 느릴 뿐).
 */
import * as fs from 'fs/promises';
import * as zlib from 'zlib';
import sharp, { type Sharp } from 'sharp';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef } from 'pdf-lib';

export interface PreconvertResult {
  /** CMYK 로 바꾼 이미지 수 */
  converted: number;
  /** 대상 조건에 맞지 않거나 실패해 그대로 둔 RGB 계열 이미지 수 */
  skipped: number;
  /** 바꾼 이미지 화소 합 */
  pixels: number;
}

const N = (s: string) => PDFName.of(s);
const SUBTYPE = N('Subtype');
const IMAGE = N('Image');
const COLOR_SPACE = N('ColorSpace');
const DEVICE_RGB = N('DeviceRGB');
const DEVICE_CMYK = N('DeviceCMYK');
const FILTER = N('Filter');
const FLATE = N('FlateDecode');
const DCT = N('DCTDecode');
const DECODE_PARMS = N('DecodeParms');

function num(dict: PDFDict, key: string): number | undefined {
  const v = dict.get(N(key));
  return v instanceof PDFNumber ? v.asNumber() : undefined;
}

/** 단일 필터 이름(배열이면 원소가 하나일 때만). 필터 없음은 null, 다룰 수 없으면 undefined. */
function singleFilter(dict: PDFDict): PDFName | null | undefined {
  const f = dict.get(FILTER);
  if (f === undefined) return null;
  if (f instanceof PDFName) return f;
  if (f instanceof PDFArray && f.size() === 1) {
    const only = f.get(0);
    return only instanceof PDFName ? only : undefined;
  }
  return undefined;
}

function decodeParms(dict: PDFDict, doc: PDFDocument): PDFDict | undefined {
  let p = dict.get(DECODE_PARMS);
  if (p instanceof PDFRef) p = doc.context.lookup(p);
  if (p instanceof PDFArray && p.size() === 1) p = p.get(0);
  if (p instanceof PDFRef) p = doc.context.lookup(p);
  return p instanceof PDFDict ? p : undefined;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * Flate + PNG 예측자(10~15) 스트림은 PNG IDAT 와 같은 형식(zlib, 행마다 필터 바이트)이다 —
 * IHDR(8bit truecolor)로 감싸 sharp 가 직접 디코드하게 한다(직접 역예측 구현 불필요).
 */
export function wrapAsPng(idat: Uint8Array, width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', Buffer.from(idat)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 이미지 스트림을 sharp 입력으로 바꾼다. 다룰 수 없으면 null. */
export function sharpInputFor(
  stream: PDFRawStream,
  doc: PDFDocument,
): { input: Sharp; width: number; height: number } | null {
  const dict = stream.dict;
  if (dict.get(SUBTYPE) !== IMAGE) return null;
  if (dict.get(COLOR_SPACE) !== DEVICE_RGB) return null;
  if (num(dict, 'BitsPerComponent') !== 8) return null;
  if (dict.get(N('ImageMask')) !== undefined) return null;
  if (dict.get(N('Decode')) !== undefined) return null;
  // 색상키 마스킹(/Mask [r g b ...])은 RGB 값 기준이라 CMYK 로 바꾸면 틀어진다. 스텐실 마스크(스트림 참조)는 무관.
  if (dict.get(N('Mask')) instanceof PDFArray) return null;
  const width = num(dict, 'Width');
  const height = num(dict, 'Height');
  if (!width || !height || width <= 0 || height <= 0) return null;

  const filter = singleFilter(dict);
  const bytes = stream.getContents();
  if (filter === DCT) {
    return { input: sharp(Buffer.from(bytes), { limitInputPixels: false }), width, height };
  }
  if (filter !== FLATE) return null;

  const parms = decodeParms(dict, doc);
  const predictor = parms ? num(parms, 'Predictor') ?? 1 : 1;
  if (predictor === 1) {
    const raw = zlib.inflateSync(Buffer.from(bytes));
    if (raw.length < width * height * 3) return null;
    return {
      input: sharp(raw.subarray(0, width * height * 3), { raw: { width, height, channels: 3 }, limitInputPixels: false }),
      width,
      height,
    };
  }
  if (predictor >= 10 && predictor <= 15) {
    const colors = parms ? num(parms, 'Colors') ?? 1 : 1;
    const bpc = parms ? num(parms, 'BitsPerComponent') ?? 8 : 8;
    const columns = parms ? num(parms, 'Columns') ?? 1 : 1;
    if (colors !== 3 || bpc !== 8 || columns !== width) return null;
    return { input: sharp(wrapAsPng(bytes, width, height), { limitInputPixels: false }), width, height };
  }
  return null; // TIFF 예측자(2) 등
}

/**
 * pdfPath 의 RGB 이미지를 iccPath(CMYK 출력 프로파일) 기준 DeviceCMYK 로 바꿔 제자리 저장한다.
 * 입력 RGB 는 sRGB 로 간주한다(편집기 산출 PDF 는 프로파일 없는 DeviceRGB).
 */
export async function preconvertRgbImagesToCmyk(pdfPath: string, iccPath: string): Promise<PreconvertResult> {
  const result: PreconvertResult = { converted: 0, skipped: 0, pixels: 0 };
  const doc = await PDFDocument.load(await fs.readFile(pdfPath), { updateMetadata: false });

  const targets: Array<[PDFRef, PDFRawStream]> = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.get(SUBTYPE) === IMAGE) targets.push([ref, obj]);
  }

  for (const [ref, stream] of targets) {
    const cs = stream.dict.get(COLOR_SPACE);
    let src: ReturnType<typeof sharpInputFor> = null;
    try {
      src = sharpInputFor(stream, doc);
    } catch {
      src = null;
    }
    if (!src) {
      if (cs !== DEVICE_CMYK && cs !== N('DeviceGray')) result.skipped += 1;
      continue;
    }
    try {
      const { data, info } = await src.input
        .removeAlpha()
        .withIccProfile(iccPath, { attach: false })
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (info.channels !== 4 || info.width !== src.width || info.height !== src.height) {
        result.skipped += 1;
        continue;
      }
      const dict = stream.dict.clone(doc.context);
      dict.set(COLOR_SPACE, DEVICE_CMYK);
      dict.set(FILTER, FLATE);
      dict.delete(DECODE_PARMS);
      // GS 가 어차피 다시 압축하므로 빠른 압축 레벨을 쓴다.
      const contents = zlib.deflateSync(data, { level: 1 });
      doc.context.assign(ref, PDFRawStream.of(dict, contents));
      result.converted += 1;
      result.pixels += src.width * src.height;
    } catch {
      result.skipped += 1;
    }
  }

  if (result.converted > 0) {
    const tmp = `${pdfPath}.precmyk`;
    await fs.writeFile(tmp, await doc.save({ useObjectStreams: false }));
    await fs.rename(tmp, pdfPath);
  }
  return result;
}
