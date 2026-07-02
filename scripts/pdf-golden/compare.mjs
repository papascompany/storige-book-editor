#!/usr/bin/env node
/**
 * PDF 골든 비교 엔진 (Phase 0 / 2026-07-03) — 렌더·변환 파이프라인 변경의 출력 불변 검증.
 *
 * 왜: Track A(canvas-core 지연로딩)처럼 "출력 로직 무변경" 을 표방하는 변경이 실제로
 * PDF 산출을 바꾸지 않았는지 자동 판정한다. 저장소에 골든/픽셀 diff 인프라가 없었으므로 신설.
 * 재사용 대상: Track A 검증 + 향후 모든 PDF 렌더 변경(jspdf/svg2pdf/pdf-lib/합성 파이프라인).
 *
 * 비교 계층(의존성 없는 것부터):
 *  1) 페이지 수(qpdf --show-npages): 누락/추가 페이지를 잡는다. 버전 안정.
 *  2) 정규화 콘텐츠 해시(qpdf --qdf --deterministic-id, 파일 출력): 비결정 메타(/ID·/CreationDate·
 *     /ModDate·XMP 타임스탬프)를 제거·정규화 후 sha256. Track A 처럼 byte-identical(모듈로 메타)
 *     이면 해시 일치 → 확실한 통과. (스트리밍 stdout 은 비결정이라 반드시 파일로 출력해 해시.)
 *  3) (옵션) 픽셀 diff: pdftoppm(poppler)+pixelmatch+pngjs 있으면 150dpi 래스터 픽셀 비교.
 *     없으면 건너뛰고 경고(1·2 만으로도 지연로딩류 회귀는 충분히 잡힘).
 *
 * 필수 시스템 도구: qpdf. 옵션: pdftoppm(픽셀 계층). gs 불필요.
 * ⚠️ qpdf 는 경고 시 exit 3(성공)이므로 exit 3 을 성공으로 취급한다.
 *
 * 사용:
 *   node scripts/pdf-golden/compare.mjs <baseline.pdf> <candidate.pdf> [--pixel] [--threshold 0]
 *   종료코드 0 = 일치(통과), 1 = 불일치(반려), 2 = 실행 오류(도구 부재 등).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);

/** qpdf 실행 — exit 3(경고)을 성공으로 취급. stdout 반환(파일 출력 모드는 빈 문자열). */
async function qpdfRun(args, { encoding = 'utf8' } = {}) {
  try {
    const { stdout } = await execFileAsync('qpdf', args, { maxBuffer: 256 * 1024 * 1024, encoding });
    return stdout;
  } catch (e) {
    if (e && e.code === 3) return e.stdout ?? ''; // qpdf: 성공 with warnings
    throw e;
  }
}

async function hasTool(bin, versionFlag = '--version') {
  try {
    await execFileAsync(bin, [versionFlag]);
    return true;
  } catch (e) {
    // 일부 도구(pdftoppm)는 -v 로 버전을 stderr 에 내고 nonzero 로 끝남 → 실행 자체가 되면 있다고 본다.
    return e && e.code !== 'ENOENT';
  }
}

async function pageCount(pdf) {
  const out = await qpdfRun(['--show-npages', pdf]);
  return parseInt(String(out).trim(), 10);
}

/** 비결정 메타를 제거·정규화한 콘텐츠 해시. 반드시 파일 출력(스트리밍은 비결정). */
async function normalizedHash(pdf) {
  const dir = await mkdtemp(join(tmpdir(), 'golden-n-'));
  const outPath = join(dir, 'norm.qdf');
  try {
    await qpdfRun([
      '--qdf',
      '--deterministic-id',
      '--object-streams=disable',
      '--normalize-content=y',
      pdf,
      outPath,
    ]);
    const text = (await readFile(outPath)).toString('latin1');
    const scrubbed = text
      .split('\n')
      .filter(
        (line) =>
          !/\/CreationDate|\/ModDate|xmp:(CreateDate|ModifyDate|MetadataDate)|<xmpMM:/i.test(line),
      )
      .join('\n');
    return createHash('sha256').update(scrubbed, 'latin1').digest('hex');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** (옵션) pdftoppm + pixelmatch 픽셀 diff. 도구/라이브러리 부재 시 {skipped:true}. */
async function pixelDiff(baseline, candidate, threshold) {
  if (!(await hasTool('pdftoppm', '-v'))) return { skipped: true, reason: 'pdftoppm(poppler) 미설치' };
  let pixelmatch, PNG;
  try {
    pixelmatch = (await import('pixelmatch')).default;
    PNG = (await import('pngjs')).PNG;
  } catch {
    return { skipped: true, reason: 'pixelmatch/pngjs 미설치 (pnpm add -Dw pixelmatch pngjs 후 활성화)' };
  }
  const render = async (pdf) => {
    const dir = await mkdtemp(join(tmpdir(), 'golden-r-'));
    await execFileAsync('pdftoppm', ['-png', '-r', '150', pdf, join(dir, 'p')]);
    const files = (await readdir(dir)).filter((f) => f.endsWith('.png')).sort();
    return { dir, files };
  };
  const a = await render(baseline);
  const b = await render(candidate);
  try {
    if (a.files.length !== b.files.length) {
      return { skipped: false, match: false, reason: `래스터 페이지 수 상이 ${a.files.length} vs ${b.files.length}` };
    }
    let totalDiff = 0;
    const perPage = [];
    for (let i = 0; i < a.files.length; i++) {
      const imgA = PNG.sync.read(await readFile(join(a.dir, a.files[i])));
      const imgB = PNG.sync.read(await readFile(join(b.dir, b.files[i])));
      if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
        perPage.push({ page: i + 1, diff: -1, note: `치수 상이 ${imgA.width}x${imgA.height} vs ${imgB.width}x${imgB.height}` });
        totalDiff += 1;
        continue;
      }
      const diff = pixelmatch(imgA.data, imgB.data, null, imgA.width, imgA.height, { threshold: 0.1 });
      perPage.push({ page: i + 1, diff });
      totalDiff += diff;
    }
    return { skipped: false, match: totalDiff <= threshold, totalDiff, perPage };
  } finally {
    await rm(a.dir, { recursive: true, force: true });
    await rm(b.dir, { recursive: true, force: true });
  }
}

export async function comparePdfs(baseline, candidate, { pixel = false, threshold = 0 } = {}) {
  const findings = [];
  const [pcA, pcB] = await Promise.all([pageCount(baseline), pageCount(candidate)]);
  if (pcA !== pcB) findings.push(`페이지 수 상이: baseline ${pcA} vs candidate ${pcB}`);

  const [ha, hb] = await Promise.all([normalizedHash(baseline), normalizedHash(candidate)]);
  const byteIdentical = ha === hb;
  if (!byteIdentical) findings.push(`정규화 콘텐츠 해시 상이 (${ha.slice(0, 12)} vs ${hb.slice(0, 12)})`);

  let pixelResult = null;
  if (pixel) {
    pixelResult = await pixelDiff(baseline, candidate, threshold);
    if (pixelResult && pixelResult.skipped) findings.push(`픽셀 diff 건너뜀: ${pixelResult.reason}`);
    else if (pixelResult && !pixelResult.match)
      findings.push(`픽셀 diff 초과: ${pixelResult.totalDiff ?? pixelResult.reason}`);
  }

  // 페이지 수 + 정규화 해시 일치면 통과(byte-identical modulo 메타). 픽셀은 보조(건너뛰어도 통과).
  const blockingFindings = findings.filter((f) => !f.startsWith('픽셀 diff 건너뜀'));
  const pass = byteIdentical && pcA === pcB && blockingFindings.length === 0;
  return { pass, byteIdentical, pageCount: { baseline: pcA, candidate: pcB }, pixel: pixelResult, findings };
}

// ── CLI ── (경로 공백 시 file:// 문자열 비교가 인코딩 불일치로 깨지므로 pathToFileURL 사용)
const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const pixel = args.includes('--pixel');
  const tIdx = args.indexOf('--threshold');
  const threshold = tIdx >= 0 ? Number(args[tIdx + 1]) : 0;
  const positional = args.filter((a, i) => !a.startsWith('--') && !(tIdx >= 0 && i === tIdx + 1));
  const [baseline, candidate] = positional;
  if (!baseline || !candidate) {
    console.error('사용: node scripts/pdf-golden/compare.mjs <baseline.pdf> <candidate.pdf> [--pixel] [--threshold N]');
    process.exit(2);
  }
  if (!(await hasTool('qpdf'))) {
    console.error('qpdf 미설치 — brew install qpdf');
    process.exit(2);
  }
  try {
    const r = await comparePdfs(baseline, candidate, { pixel, threshold });
    console.log(`페이지: ${r.pageCount.baseline} → ${r.pageCount.candidate}`);
    console.log(`정규화 해시 일치(byte-identical modulo 메타): ${r.byteIdentical ? 'YES' : 'NO'}`);
    if (r.pixel && !r.pixel.skipped) console.log(`픽셀 diff 총합: ${r.pixel.totalDiff ?? r.pixel.reason}`);
    if (r.findings.length) {
      console.log('\n발견:');
      for (const f of r.findings) console.log('  - ' + f);
    }
    console.log(`\n판정: ${r.pass ? 'PASS ✅ (출력 불변)' : 'FAIL ❌ (출력 변화 감지)'}`);
    process.exit(r.pass ? 0 : 1);
  } catch (e) {
    console.error('비교 실행 오류:', e.message);
    process.exit(2);
  }
}
