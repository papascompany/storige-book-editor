// PoC CLI: IDML 샘플 → 변환 결과 요약 출력 + JSON 저장.
// 사용: node scripts/convert-sample.mjs <file.idml>
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIdml } from '../src/idml/reader.mjs';
import { toSpreadTemplate } from '../src/convert/toSpreadTemplate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');
const input = resolve(pkgRoot, process.argv[2] || 'fixtures/cover-sample.idml');

const buf = await readFile(input);
const doc = await parseIdml(buf);
const result = toSpreadTemplate(doc, { name: 'MA-348 표지(가져옴)' });

const { spec } = result;
console.log('━━━ IDML → 표지 펼침면 변환 결과 ━━━');
console.log('입력:', input.split('/').slice(-1)[0]);
console.log('');
console.log('● 감지된 spec (mm)');
console.log(`   표지 한 면(coverWidth) : ${spec.coverWidthMm}`);
console.log(`   표지 높이(coverHeight) : ${spec.coverHeightMm}`);
console.log(`   책등(spineWidth, 가변)  : ${spec.spineWidthMm}`);
console.log(`   날개(wing)             : ${spec.wingEnabled ? spec.wingWidthMm : '없음'}`);
console.log(`   재단여백(cutSize)       : ${spec.cutSizeMm}`);
console.log(`   ⇒ 총폭(totalWidth)      : ${result.totalWidthMm}  (= cover×2 + spine ${spec.wingEnabled ? '+ wing×2' : ''})`);
console.log('');

console.log('● 페이지 구성');
for (const p of doc.pages) {
  console.log(`   page "${p.name}": ${ (p.widthPt/72*25.4).toFixed(1) }mm × ${ (p.heightPt/72*25.4).toFixed(1) }mm  (left@${(p.leftSpreadPt/72*25.4).toFixed(1)}mm)`);
}
console.log('');

console.log('● 추출 객체:', result.objects.length, '개');
const byType = {};
const byRegion = {};
for (const o of result.objects) {
  byType[o._idml.srcType] = (byType[o._idml.srcType] || 0) + 1;
  const r = o.meta.regionRef || '(자유/배경)';
  byRegion[r] = (byRegion[r] || 0) + 1;
}
console.log('   타입별 :', JSON.stringify(byType));
console.log('   영역별 :', JSON.stringify(byRegion));
console.log('');

console.log('● 텍스트 객체 샘플');
for (const o of result.objects.filter((o) => o.type === 'textbox' && o.text).slice(0, 6)) {
  console.log(`   [${o.meta.regionRef || '자유'}] "${o.text.replace(/\n/g,' ⏎ ')}"  ${o.fontSize ? Math.round(o.fontSize) + 'px' : ''} ${o.fontFamily || ''}  fill=${o.fill}`);
}
console.log('');

console.log('● 경고/손실');
for (const w of result.warnings) console.log('   ⚠️', w);
console.log('');

const outPath = resolve(pkgRoot, 'fixtures/cover-sample.output.json');
await writeFile(outPath, JSON.stringify(result.draftTemplateDto, null, 2), 'utf-8');
console.log('● draft CreateTemplateDto 저장 →', outPath.split('/').slice(-2).join('/'));
console.log(`   canvasData.objects: ${result.draftTemplateDto.canvasData.objects.length}, canvas ${result.draftTemplateDto.canvasData.width}×${result.draftTemplateDto.canvasData.height}px`);
