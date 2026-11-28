import { spawnSync } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PDFDocument, rgb } from 'pdf-lib';
import sharp from 'sharp';
import { renderPdfPageToJpeg } from './photo-jpeg-render';

const HAS_GS = spawnSync(process.env.GHOSTSCRIPT_PATH || 'gs', ['--version']).status === 0;
const MM = 72 / 25.4;

/** 2쪽 PDF — 54×86mm(인스탁스 미니), 1쪽 빨강·2쪽 파랑 */
async function makePdf(file: string): Promise<void> {
  const doc = await PDFDocument.create();
  for (const color of [rgb(1, 0, 0), rgb(0, 0, 1)]) {
    const page = doc.addPage([54 * MM, 86 * MM]);
    page.drawRectangle({ x: 0, y: 0, width: 54 * MM, height: 86 * MM, color });
  }
  await fs.writeFile(file, await doc.save());
}

(HAS_GS ? describe : describe.skip)('renderPdfPageToJpeg (gs 실제 실행)', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'photo-jpeg-'));
    await makePdf(path.join(dir, 'in.pdf'));
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('지정 페이지를 dpi 크기의 sRGB JPEG(4:4:4, density) 로 낸다', async () => {
    const out = path.join(dir, 'photo_002_instax-mini_x3.jpg');
    const tmp = path.join(dir, 'p2.png');
    const r = await renderPdfPageToJpeg({ inputPath: path.join(dir, 'in.pdf'), page: 2, dpi: 300, quality: 95, tempPngPath: tmp, outputPath: out });

    // 54mm·86mm @300dpi = 638 × 1016 px (반올림 ±1)
    expect(Math.abs(r.width - 638)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.height - 1016)).toBeLessThanOrEqual(1);
    expect(r.bytes).toBeGreaterThan(0);

    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.density).toBe(300);
    expect(meta.chromaSubsampling).toBe('4:4:4');
    expect(meta.hasProfile).toBe(true);
    expect(meta.channels).toBe(3);

    // 2쪽(파랑)을 렌더했는지 — 가운데 픽셀
    const { data } = await sharp(out).extract({ left: 300, top: 500, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect(data[2]).toBeGreaterThan(200);
    expect(data[0]).toBeLessThan(60);

    // 임시 PNG 정리
    await expect(fs.stat(tmp)).rejects.toThrow();
  });

  it('(v1.37) cropMm — 인스탁스 사진 창 46×62mm(4,4) 만 잘라 낸다', async () => {
    // 1쪽: 흰 바탕 + 사진 창(4,4,46×62mm)만 초록 — PDF 좌표는 왼쪽 아래 원점
    const doc = await PDFDocument.create();
    const page = doc.addPage([54 * MM, 86 * MM]);
    page.drawRectangle({ x: 0, y: 0, width: 54 * MM, height: 86 * MM, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: 4 * MM, y: (86 - 4 - 62) * MM, width: 46 * MM, height: 62 * MM, color: rgb(0, 0.6, 0) });
    const input = path.join(dir, 'instax.pdf');
    await fs.writeFile(input, await doc.save());

    const out = path.join(dir, 'photo_001_instax-mini_x1.jpg');
    const r = await renderPdfPageToJpeg({
      inputPath: input,
      page: 1,
      dpi: 300,
      quality: 95,
      tempPngPath: path.join(dir, 'crop.png'),
      outputPath: out,
      cropMm: { left: 4, top: 4, width: 46, height: 62 },
      pageSizeMm: { width: 54, height: 86 },
    });
    // 46mm·62mm @300dpi = 543 × 732 px (반올림 ±1)
    expect(Math.abs(r.width - 543)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.height - 732)).toBeLessThanOrEqual(1);
    // 모서리까지 초록(흰 테두리 없음)
    for (const [x, y] of [[2, 2], [r.width - 3, 2], [2, r.height - 3], [r.width - 3, r.height - 3]]) {
      const { data } = await sharp(out).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
      expect(data[1]).toBeGreaterThan(110);
      expect(data[0]).toBeLessThan(60);
    }
  });
});
