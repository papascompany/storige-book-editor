import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import sharp from 'sharp';
import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFRef } from 'pdf-lib';
import { preconvertRgbImagesToCmyk } from './cmyk-image-preconvert';

/** 테스트는 sharp 내장 CMYK 프로파일을 출력 ICC 로 쓴다(운영 ICC 는 저장소에 없다). */
const ICC = 'cmyk';
const W = 8;
const H = 4;

function solidRgb(r: number, g: number, b: number): Buffer {
  const buf = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) buf.set([r, g, b], i * 3);
  return buf;
}

/** jsPDF 형식: Flate + PNG 예측자(행마다 필터 바이트 0). */
function pngPredicted(raw: Buffer): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < H; y++) rows.push(Buffer.concat([Buffer.from([0]), raw.subarray(y * W * 3, (y + 1) * W * 3)]));
  return zlib.deflateSync(Buffer.concat(rows));
}

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'precmyk-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function writePdf(build: (doc: PDFDocument) => Promise<Record<string, PDFRef>>): Promise<{ file: string; refs: Record<string, PDFRef> }> {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  const refs = await build(doc);
  const file = path.join(dir, 'in.pdf');
  await fs.writeFile(file, await doc.save({ useObjectStreams: false }));
  return { file, refs };
}

function imageStream(doc: PDFDocument, contents: Buffer, extra: Record<string, unknown>): PDFRef {
  const stream = doc.context.stream(contents, {
    Type: 'XObject',
    Subtype: 'Image',
    Width: W,
    Height: H,
    BitsPerComponent: 8,
    ...extra,
  });
  return doc.context.register(stream);
}

async function imageDict(file: string, ref: PDFRef) {
  const doc = await PDFDocument.load(await fs.readFile(file));
  return (doc.context.lookup(ref) as PDFRawStream).dict;
}

async function decodedImage(file: string, ref: PDFRef): Promise<{ stream: PDFRawStream; pixels: Buffer }> {
  const doc = await PDFDocument.load(await fs.readFile(file));
  const stream = doc.context.lookup(ref) as PDFRawStream;
  return { stream, pixels: zlib.inflateSync(Buffer.from(stream.getContents())) };
}

describe('preconvertRgbImagesToCmyk', () => {
  it('Flate+PNG 예측자 RGB 이미지를 DeviceCMYK Flate 로 바꾼다 — 빨강은 M·Y 가 높고 C 가 낮다', async () => {
    const { file, refs } = await writePdf(async (doc) => ({
      img: imageStream(doc, pngPredicted(solidRgb(255, 0, 0)), {
        ColorSpace: 'DeviceRGB',
        Filter: 'FlateDecode',
        DecodeParms: { BitsPerComponent: 8, Colors: 3, Columns: W, Predictor: 14 },
      }),
    }));

    const r = await preconvertRgbImagesToCmyk(file, ICC);
    expect(r).toEqual({ converted: 1, skipped: 0, pixels: W * H });

    const { stream, pixels } = await decodedImage(file, refs.img);
    expect(stream.dict.get(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceCMYK'));
    expect(stream.dict.get(PDFName.of('Filter'))).toBe(PDFName.of('FlateDecode'));
    expect(stream.dict.get(PDFName.of('DecodeParms'))).toBeUndefined();
    expect(pixels.length).toBe(W * H * 4);
    const [c, m, y] = pixels;
    expect(c).toBeLessThan(40);
    expect(m).toBeGreaterThan(180);
    expect(y).toBeGreaterThan(180);
  });

  it('예측자 없는 Flate 와 JPEG(DCT) RGB 이미지도 바꾸고, SMask 는 그대로 둔다', async () => {
    const jpeg = await sharp(solidRgb(0, 0, 255), { raw: { width: W, height: H, channels: 3 } }).jpeg().toBuffer();
    const { file, refs } = await writePdf(async (doc) => {
      const mask = imageStream(doc, zlib.deflateSync(Buffer.alloc(W * H, 128)), {
        ColorSpace: 'DeviceGray',
        Filter: 'FlateDecode',
      });
      return {
        mask,
        flate: imageStream(doc, zlib.deflateSync(solidRgb(0, 255, 0)), {
          ColorSpace: 'DeviceRGB',
          Filter: 'FlateDecode',
          SMask: mask,
        }),
        jpeg: imageStream(doc, jpeg, { ColorSpace: 'DeviceRGB', Filter: 'DCTDecode' }),
      };
    });

    const r = await preconvertRgbImagesToCmyk(file, ICC);
    expect(r).toEqual({ converted: 2, skipped: 0, pixels: 2 * W * H });

    const flate = await decodedImage(file, refs.flate);
    expect(flate.stream.dict.get(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceCMYK'));
    expect(flate.stream.dict.get(PDFName.of('SMask'))).toEqual(refs.mask);
    const jpg = await decodedImage(file, refs.jpeg);
    expect(jpg.stream.dict.get(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceCMYK'));
    expect(jpg.pixels.length).toBe(W * H * 4);
    const mask = await decodedImage(file, refs.mask);
    expect(mask.stream.dict.get(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceGray'));
  });

  it('색상키 /Mask 배열이 있는 RGB 이미지는 건너뛰고, 바꾼 것이 없으면 파일을 다시 쓰지 않는다', async () => {
    const { file, refs } = await writePdf(async (doc) => ({
      img: imageStream(doc, zlib.deflateSync(solidRgb(10, 20, 30)), {
        ColorSpace: 'DeviceRGB',
        Filter: 'FlateDecode',
        Mask: [0, 0, 0, 0, 0, 0],
      }),
    }));
    const before = await fs.readFile(file);

    const r = await preconvertRgbImagesToCmyk(file, ICC);
    expect(r).toEqual({ converted: 0, skipped: 1, pixels: 0 });
    expect(Buffer.compare(before, await fs.readFile(file))).toBe(0);
    const { stream } = await decodedImage(file, refs.img);
    expect(stream.dict.get(PDFName.of('Mask'))).toBeInstanceOf(PDFArray);
  });

  it('깨진 이미지 데이터는 그 이미지만 건너뛰고 나머지는 바꾼다', async () => {
    const { file, refs } = await writePdf(async (doc) => ({
      broken: imageStream(doc, Buffer.from('not zlib'), {
        ColorSpace: 'DeviceRGB',
        Filter: 'FlateDecode',
        DecodeParms: { BitsPerComponent: 8, Colors: 3, Columns: W, Predictor: 15 },
      }),
      ok: imageStream(doc, zlib.deflateSync(solidRgb(200, 200, 200)), { ColorSpace: 'DeviceRGB', Filter: 'FlateDecode' }),
    }));

    const r = await preconvertRgbImagesToCmyk(file, ICC);
    expect(r).toEqual({ converted: 1, skipped: 1, pixels: W * H });
    expect((await imageDict(file, refs.broken)).get(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceRGB'));
    expect((await decodedImage(file, refs.ok)).stream.dict.get(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceCMYK'));
  });
});
