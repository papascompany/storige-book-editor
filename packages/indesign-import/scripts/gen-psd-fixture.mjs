// 테스트용 명함 PSD 생성(ag-psd) — 실제 PSD 샘플 없이 PSD 리더를 검증하기 위함.
// 90×50mm @ 300dpi = 1063×591px. 배경 라스터 + 로고 라스터 + 텍스트 레이어.
import { writePsd } from 'ag-psd';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const W = 1063;
const H = 591;

function fill(w, h, [r, g, b, a]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { width: w, height: h, data };
}

const psd = {
  width: W,
  height: H,
  imageResources: {
    resolutionInfo: {
      horizontalResolution: 300, horizontalResolutionUnit: 'PPI', widthUnit: 'Inches',
      verticalResolution: 300, verticalResolutionUnit: 'PPI', heightUnit: 'Inches',
    },
  },
  imageData: fill(W, H, [20, 40, 120, 255]),
  children: [
    { name: '배경', left: 0, top: 0, imageData: fill(W, H, [20, 40, 120, 255]) },
    { name: '로고', left: 60, top: 60, imageData: fill(240, 240, [230, 180, 40, 255]) },
    {
      name: '이름',
      left: 80, top: 360,
      text: {
        text: '홍길동\nHong Gildong',
        transform: [1, 0, 0, 1, 80, 360],
        style: { font: { name: 'ArialMT' }, fontSize: 48, fillColor: { r: 255, g: 255, b: 255 } },
      },
    },
  ],
};

const buf = writePsd(psd, { generateThumbnail: false });
const out = resolve(__dirname, '../fixtures/card-sample.psd');
writeFileSync(out, Buffer.from(buf));
console.log('PSD fixture →', out, Buffer.from(buf).byteLength, 'bytes');
