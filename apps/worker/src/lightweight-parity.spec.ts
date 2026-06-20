/**
 * 트랙 B-(d) 파리티 회귀 가드.
 *
 * 검증 ON 경로(validateLightweight: 스트림+qpdf+청크 스캔)가 기존 OFF 경로
 * (validate: 전체버퍼+pdf-lib)와 **동일한 결과(errors/warnings/metadata)** 를 내는지
 * test/fixtures/pdf 전 픽스처 × 2 옵션변형으로 deep-equal 대조한다.
 *
 * - OFF = service.validate(path, opts) (env WORKER_LIGHTWEIGHT_VALIDATION 기본 OFF).
 * - ON  = service['validateLightweight'](path, opts) (플래그 무관하게 직접 호출).
 * - qpdf 미설치 환경(일부 CI)에서는 ON 경로가 성립하지 않으므로 describe 를 skip.
 *
 * ⚠️ 로컬엔 gs 가 없어 색상모드는 양 경로 모두 'GS 미가용 → 구조기반 추정' 폴백을 타
 *    동일하다. gs 가 있는 prod 에서도 두 경로 모두 동일 inputPath 로 detectCmykUsage 를
 *    호출하므로 colorMode 파리티가 유지된다(구조 입력 동일성은 streaming 스캐너 파리티로 보장).
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PdfValidatorService } from '../src/services/pdf-validator.service';
import { ValidationOptions } from '../src/dto/validation-result.dto';
import { detectImageResolutionFromPdf } from '../src/utils/ghostscript';
import { scanPdfStreaming } from '../src/utils/streaming-pdf-scan';
import { VALIDATION_CONFIG } from '../src/config/validation.config';

function qpdfAvailable(): boolean {
  try {
    execFileSync(process.env.QPDF_PATH || 'qpdf', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** fixtures/pdf 아래 모든 .pdf 를 재귀 수집. */
function collectPdfs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectPdfs(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) out.push(full);
  }
  return out;
}

const FIXTURE_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'pdf');

// 옵션 변형 — 서로 다른 검증 분기(spine/saddle/방향/스프레드)를 함께 운동시킨다.
function optsVariants(): { label: string; opts: ValidationOptions }[] {
  return [
    {
      label: 'content/perfect',
      opts: {
        fileType: 'content',
        orderOptions: {
          size: { width: 210, height: 297 },
          pages: 10,
          binding: 'perfect',
          bleed: 3,
        },
      } as ValidationOptions,
    },
    {
      label: 'cover/saddle',
      opts: {
        fileType: 'cover',
        orderOptions: {
          size: { width: 210, height: 297 },
          pages: 8,
          binding: 'saddle',
          bleed: 3,
          spineWidth: 5,
        },
      } as unknown as ValidationOptions,
    },
  ];
}

const runOrSkip = qpdfAvailable() ? describe : describe.skip;

runOrSkip('lightweight validation parity (OFF == ON)', () => {
  const service = new PdfValidatorService();
  const fixtures = fs.existsSync(FIXTURE_DIR) ? collectPdfs(FIXTURE_DIR) : [];

  if (fixtures.length === 0) {
    it('fixtures present', () => {
      expect(fixtures.length).toBeGreaterThan(0);
    });
    return;
  }

  for (const file of fixtures) {
    const rel = path.relative(FIXTURE_DIR, file);
    for (const { label, opts } of optsVariants()) {
      it(`${rel} [${label}]`, async () => {
        const off = await service.validate(file, opts);
        const on = await (service as any).validateLightweight(file, opts);
        // metadata·errors·warnings 전부 동일해야 한다(인쇄품질 파리티).
        expect(on).toEqual(off);
      });
    }
  }
});

/**
 * 이미지 해상도 검출 파리티 — fixtures 에 /Subtype /Image 객체가 0개라 위 블록이 전혀
 * 운동시키지 못하는 경로(적대검증 적발). OFF detectImageResolutionFromPdf(버퍼) vs
 * ON scanPdfStreaming(파일).resolution 을 손수 만든 바이트로 직접 대조한다.
 * (둘 다 순수 regex 스캐너 — 유효 PDF/qpdf 불필요. 이미지 DPI 의 페이지치수 소스가
 *  OFF=평문 첫 MediaBox/A4 와 ON 이 동일한지 비트단위 검증.)
 */
describe('image resolution detector parity (OFF detector == streaming scanner)', () => {
  const minDpi = VALIDATION_CONFIG.MIN_ACCEPTABLE_DPI;
  const IMG = (w: number, h: number) =>
    `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /BitsPerComponent 8 /ColorSpace /DeviceRGB /Length 1 >>`;
  const A2 = '/MediaBox [0 0 1190.55 1683.78]';
  const A5 = '/MediaBox [0 0 419.53 595.28]';

  const cases: { name: string; body: string }[] = [
    { name: '평문 A2 MediaBox + 고해상도 이미지', body: `${A2}\n${IMG(1500, 2100)}` },
    { name: '평문 A2 MediaBox + 저해상도 이미지(RESOLUTION_LOW)', body: `${A2}\n${IMG(200, 280)}` },
    { name: 'MediaBox 없음(A4 폴백) + 이미지', body: `${IMG(1500, 2100)}` },
    { name: '첫 MediaBox=A5(바이트순)·다중 + 이미지', body: `${A5}\n...\n${A2}\n${IMG(1500, 2100)}` },
    { name: '다중 이미지(동일크기 dedup + 상이 + <50 skip)', body: `${A2}\n${IMG(1500, 2100)}\n${IMG(1500, 2100)}\n${IMG(800, 1200)}\n${IMG(10, 10)}` },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const content = `%PDF-1.4\n${c.body}\n%%EOF\n`;
      const buf = Buffer.from(content, 'latin1');
      const tmp = path.join(
        os.tmpdir(),
        `imgparity_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`,
      );
      fs.writeFileSync(tmp, buf);
      try {
        const off = await detectImageResolutionFromPdf(new Uint8Array(buf), minDpi);
        const on = (await scanPdfStreaming(tmp, { minDpi })).resolution;
        expect(on).toEqual(off);
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    });
  }
});
