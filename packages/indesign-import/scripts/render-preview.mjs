// 변환 결과(draft DTO)를 SVG→PNG 로 렌더해 추출 정확도를 눈으로 검증.
// SVG 생성은 공용 buildPreviewSvg() 재사용(브라우저 admin 미리보기와 동일 로직).
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPreviewSvg } from '../src/preview/svg.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');
const dto = JSON.parse(await readFile(resolve(pkgRoot, 'fixtures/cover-sample.output.json'), 'utf-8'));

const svg = buildPreviewSvg(dto, { width: 1100 });
const svgPath = resolve(pkgRoot, 'fixtures/cover-sample.preview.svg');
await writeFile(svgPath, svg, 'utf-8');

let pngPath = null;
try {
  const sharp = (await import('sharp')).default;
  pngPath = resolve(pkgRoot, 'fixtures/cover-sample.preview.png');
  await sharp(Buffer.from(svg)).png().toFile(pngPath);
} catch (e) {
  console.log('sharp PNG 변환 생략:', e.message);
}
console.log('SVG:', svgPath);
if (pngPath) console.log('PNG:', pngPath);
