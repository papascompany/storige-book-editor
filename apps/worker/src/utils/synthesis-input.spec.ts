/**
 * 합성 입력 오류 타입화(synthesis-input) 고정.
 *
 * 잠그는 계약:
 *  1. 입력 모양: 앞 1024바이트 `%PDF-`, 뒤 1024바이트 `%%EOF`. 빈 입력·표지 없는 입력은 판정하지 않는다.
 *  2. loadInputPdf: PDF 가 아니거나 끝까지 받은 입력을 열 수 없으면 PDF_LOAD_FAILED(고정 문구·{input}·열거되지 않는 cause).
 *  3. toInputFetchError: 입력 주소 거부 → INPUT_URL_REJECTED, 저장소 하위의 없는 파일(상위 디렉터리 있음) → FILE_NOT_FOUND,
 *     그 밖은 원래 오류.
 *  4. toQpdfInputError(qpdf 있을 때): qpdf 종료 코드 2 일 때만 판독, 경로 중복 제거·판독 상한·예산.
 *  5. 감싼 세 코드는 재시도하지 않는 코드로 분류된다.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { DomainError, ErrorCodes } from '../common/errors';
import { classifySynthesisError } from '../processors/synthesis-retry';
import { UnsafeDownloadUrlError } from './url-safety';
import * as qpdfMeta from './pdf-metadata-qpdf';
import { assemblePdf } from './pdf-merge-qpdf';
import {
  fetchInput,
  fileHasPdfEofMarker,
  fileHasPdfHeader,
  hasPdfEofMarker,
  hasPdfHeader,
  loadInputPdf,
  pdfInputShape,
  SYNTHESIS_INPUT_MESSAGES,
  toInputFetchError,
  toQpdfInputError,
} from './synthesis-input';

function binAvailable(bin: string, args: string[]): boolean {
  try {
    execFileSync(bin, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const QPDF_BIN = process.env.QPDF_PATH || 'qpdf';
const HAS_QPDF = binAvailable(QPDF_BIN, ['--version']);

const latin1 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'latin1'));
const CORRUPT_COMPLETE = '%PDF-1.4\nnot a pdf\n%%EOF\n';
const HTML_BODY = '<html><body>Not Found</body></html>\n';

async function goodPdfBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return doc.save();
}

/** 이 함수가 reject 한 값을 돌려준다(resolve 면 실패). */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  const outcome = await promise.then(
    () => ({ resolved: true as const }),
    (err: unknown) => ({ resolved: false as const, err }),
  );
  expect(outcome.resolved).toBe(false);
  return outcome.resolved ? undefined : outcome.err;
}

function expectInputError(err: unknown, code: string, input: string): DomainError {
  expect(err).toBeInstanceOf(DomainError);
  const domain = err as DomainError;
  expect(domain.code).toBe(code);
  expect(domain.message).toBe(SYNTHESIS_INPUT_MESSAGES[code as keyof typeof SYNTHESIS_INPUT_MESSAGES]);
  expect(domain.detail).toEqual({ input });
  return domain;
}

describe('synthesis-input', () => {
  let tmpDir: string;
  let storageRoot: string;
  let uploadsDir: string;
  let goodPath: string;
  let corruptPath: string;
  let htmlPath: string;
  let truncatedPath: string;
  let emptyPath: string;
  let encryptedPath: string;
  let warnSpy: jest.SpyInstance;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'synthesis-input-spec-'));
    storageRoot = path.join(tmpDir, 'storage');
    uploadsDir = path.join(storageRoot, 'uploads');
    await fs.mkdir(uploadsDir, { recursive: true });
    const good = await goodPdfBytes();
    goodPath = path.join(uploadsDir, 'good.pdf');
    corruptPath = path.join(uploadsDir, 'corrupt.pdf');
    htmlPath = path.join(uploadsDir, 'page.html');
    truncatedPath = path.join(uploadsDir, 'truncated.pdf');
    emptyPath = path.join(uploadsDir, 'empty.pdf');
    encryptedPath = path.join(uploadsDir, 'encrypted.pdf');
    await fs.writeFile(goodPath, good);
    await fs.writeFile(corruptPath, latin1(CORRUPT_COMPLETE));
    await fs.writeFile(htmlPath, HTML_BODY);
    await fs.writeFile(truncatedPath, good.subarray(0, 64));
    await fs.writeFile(emptyPath, new Uint8Array(0));
    if (HAS_QPDF) {
      // 열기 암호(사용자 암호 u) AES-256 사본.
      execFileSync(QPDF_BIN, ['--encrypt', 'u', 'o', '256', '--', goodPath, encryptedPath], { stdio: 'ignore' });
    }
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('입력 모양', () => {
    it('hasPdfEofMarker: 마지막 1024바이트 안의 %%EOF 만 본다', () => {
      expect(hasPdfEofMarker(latin1('%PDF-1.4\nx\n%%EOF\n'))).toBe(true);
      expect(hasPdfEofMarker(latin1('%PDF-1.4\nx\n'))).toBe(false);
      expect(hasPdfEofMarker(latin1(`%PDF-1.4\n%%EOF\n${'x'.repeat(2000)}`))).toBe(false);
      expect(hasPdfEofMarker(new Uint8Array(0))).toBe(false);
    });

    it('hasPdfHeader: 앞 1024바이트 안의 %PDF- 만 본다', () => {
      expect(hasPdfHeader(latin1('%PDF-1.7\n'))).toBe(true);
      expect(hasPdfHeader(latin1(`${'x'.repeat(100)}%PDF-1.7\n`))).toBe(true);
      expect(hasPdfHeader(latin1(`${'x'.repeat(2000)}%PDF-1.7\n`))).toBe(false);
      expect(hasPdfHeader(new Uint8Array(0))).toBe(false);
    });

    it('pdfInputShape', () => {
      expect(pdfInputShape(new Uint8Array(0))).toBe('empty');
      expect(pdfInputShape(latin1(HTML_BODY))).toBe('no-header');
      expect(pdfInputShape(latin1('%PDF-1.4\n1 0 obj\n'))).toBe('no-eof');
      expect(pdfInputShape(latin1(CORRUPT_COMPLETE))).toBe('complete');
    });

    it('fileHasPdfEofMarker·fileHasPdfHeader: 일반 파일만 읽는다(없는 경로·디렉터리는 false)', async () => {
      expect(await fileHasPdfEofMarker(goodPath)).toBe(true);
      expect(await fileHasPdfHeader(goodPath)).toBe(true);
      expect(await fileHasPdfEofMarker(truncatedPath)).toBe(false);
      expect(await fileHasPdfHeader(truncatedPath)).toBe(true);
      expect(await fileHasPdfHeader(htmlPath)).toBe(false);
      expect(await fileHasPdfEofMarker(path.join(uploadsDir, 'missing.pdf'))).toBe(false);
      expect(await fileHasPdfHeader(path.join(uploadsDir, 'missing.pdf'))).toBe(false);
      expect(await fileHasPdfEofMarker(uploadsDir)).toBe(false);
      expect(await fileHasPdfHeader(uploadsDir)).toBe(false);
    });

    it('일반 파일이 아닌 경로(FIFO)는 열지 않고 false', async () => {
      const fifo = path.join(tmpDir, 'pipe.pdf');
      try {
        execFileSync('mkfifo', [fifo], { stdio: 'ignore' });
      } catch {
        return; // mkfifo 가 없는 환경
      }
      expect(await fileHasPdfEofMarker(fifo)).toBe(false);
      expect(await fileHasPdfHeader(fifo)).toBe(false);
    });
  });

  describe('loadInputPdf', () => {
    it('정상 PDF 는 문서를 돌려준다', async () => {
      const doc = await loadInputPdf(await goodPdfBytes(), 'cover');
      expect(doc.getPageCount()).toBe(1);
    });

    it('끝까지 받은 입력을 열 수 없으면 PDF_LOAD_FAILED(원래 오류는 cause, 직렬화에는 없음)', async () => {
      const err = await rejectionOf(loadInputPdf(latin1(CORRUPT_COMPLETE), 'content'));
      const domain = expectInputError(err, ErrorCodes.PDF_LOAD_FAILED, 'content');
      expect(domain.cause).toBeInstanceOf(Error);
      expect(Object.keys(domain)).not.toContain('cause');
      expect(JSON.stringify(domain)).not.toContain('cause');
      expect(JSON.stringify(domain)).not.toContain('Pages');
    });

    it('PDF 헤더가 없는 입력(HTML 본문)은 PDF_LOAD_FAILED', async () => {
      const err = await rejectionOf(loadInputPdf(latin1(HTML_BODY), 'cover'));
      expectInputError(err, ErrorCodes.PDF_LOAD_FAILED, 'cover');
    });

    it('감쌀 때 서버 로그에 [SYNTH_INPUT] 1줄과 원래 오류 메시지 1줄을 남긴다', async () => {
      await rejectionOf(loadInputPdf(latin1(HTML_BODY), 'cover'));
      const lines = warnSpy.mock.calls.map((call: unknown[]) => String(call[0]));
      expect(lines).toContain('[SYNTH_INPUT] input=cover code=PDF_LOAD_FAILED cause=Error');
      expect(lines.some((l) => l.includes('code=PDF_LOAD_FAILED') && l.includes('No PDF header found'))).toBe(true);
    });

    (HAS_QPDF ? it : it.skip)('열기 암호 PDF 는 PDF_LOAD_FAILED', async () => {
      const err = await rejectionOf(loadInputPdf(new Uint8Array(await fs.readFile(encryptedPath)), 'content'));
      expectInputError(err, ErrorCodes.PDF_LOAD_FAILED, 'content');
    });

    it.each([
      ['파일 끝 표지가 없는 입력(정상 PDF 앞 64바이트)', 'truncated'],
      ['빈 입력', 'empty'],
    ])('%s 은 원래 오류를 그대로 던진다', async (_t, kind) => {
      const bytes = kind === 'empty' ? new Uint8Array(0) : (await goodPdfBytes()).subarray(0, 64);
      const err = await rejectionOf(loadInputPdf(bytes, 'content'));
      expect(err).not.toBeInstanceOf(DomainError);
    });

    it('메모리 할당 실패는 원래 오류를 그대로 던진다', async () => {
      const allocation = new RangeError('Array buffer allocation failed');
      jest.spyOn(PDFDocument, 'load').mockRejectedValue(allocation);
      const err = await rejectionOf(loadInputPdf(latin1(CORRUPT_COMPLETE), 'content'));
      expect(err).toBe(allocation);
    });
  });

  describe('toInputFetchError', () => {
    async function enoent(target: string): Promise<unknown> {
      return fs.readFile(target).then(
        () => {
          throw new Error(`exists: ${target}`);
        },
        (err: unknown) => err,
      );
    }

    it.each([
      ['invalid-url', 'Invalid download URL: ::::'],
      ['blocked-scheme', 'Blocked URL scheme: ftp:'],
      ['blocked-address', 'Blocked private/link-local address: 127.0.0.1'],
    ] as const)('입력 주소 거부(%s) → INPUT_URL_REJECTED', async (reason, message) => {
      const original = new UnsafeDownloadUrlError(reason, message);
      const err = await toInputFetchError(original, 'ftp://x/a.pdf', 'endpaper', storageRoot);
      const domain = expectInputError(err, ErrorCodes.INPUT_URL_REJECTED, 'endpaper');
      expect(domain.cause).toBe(original);
    });

    it('저장소 하위의 없는 파일(상위 디렉터리 있음) → FILE_NOT_FOUND', async () => {
      const missing = path.join(uploadsDir, 'missing.pdf');
      const original = await enoent(missing);
      const err = await toInputFetchError(original, missing, 'content', storageRoot);
      const domain = expectInputError(err, ErrorCodes.FILE_NOT_FOUND, 'content');
      expect(JSON.stringify(domain)).not.toContain(uploadsDir);
    });

    it('저장소 상대 참조(storage/…)의 없는 파일도 같은 기준', async () => {
      const original = await enoent(path.join(uploadsDir, 'missing.pdf'));
      const err = await toInputFetchError(original, 'storage/uploads/missing.pdf', 'cover', storageRoot);
      expectInputError(err, ErrorCodes.FILE_NOT_FOUND, 'cover');
    });

    it.each([
      ['상위 디렉터리가 없는 경로', (): string => path.join(storageRoot, 'nodir', 'missing.pdf')],
      ['저장소 루트 바로 아래', (): string => path.join(storageRoot, 'missing.pdf')],
      ['저장소 밖(상위 디렉터리 있음)', (): string => path.join(tmpDir, 'missing.pdf')],
    ])('%s 의 없는 파일 → 원래 오류', async (_t, target) => {
      const original = await enoent(target());
      expect(await toInputFetchError(original, target(), 'content', storageRoot)).toBe(original);
    });

    it.each(['https://files.example.com/a.pdf', 'api://file-1'])(
      '원격 참조(%s)의 ENOENT → 원래 오류',
      async (ref) => {
        const original = await enoent(path.join(uploadsDir, 'missing.pdf'));
        expect(await toInputFetchError(original, ref, 'content', storageRoot)).toBe(original);
      },
    );

    it.each([
      ['이름 확인 실패', (): Error => new Error('DNS resolve failed for host: files.example.com')],
      [
        'EACCES',
        (): Error =>
          Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES', path: path.join(uploadsDir, 'a.pdf') }),
      ],
      [
        'HTTP 404',
        (): Error => Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } }),
      ],
    ])('%s → 원래 오류', async (_t, makeError) => {
      const original = makeError();
      expect(await toInputFetchError(original, path.join(uploadsDir, 'a.pdf'), 'cover', storageRoot)).toBe(original);
    });

    it('fetchInput: 성공은 그대로, 실패는 분류된 오류로 reject', async () => {
      await expect(fetchInput('/x', 'cover', storageRoot, async () => 7)).resolves.toBe(7);
      const err = await rejectionOf(
        fetchInput('ftp://x/a.pdf', 'cover', storageRoot, async () => {
          throw new UnsafeDownloadUrlError('blocked-scheme', 'Blocked URL scheme: ftp:');
        }),
      );
      expectInputError(err, ErrorCodes.INPUT_URL_REJECTED, 'cover');
    });
  });

  (HAS_QPDF ? describe : describe.skip)('qpdf 판독', () => {
    /** 실제 qpdf 병합 실패 오류를 만든다. */
    async function mergeFailure(files: string[], output?: string): Promise<unknown> {
      const out = output ?? path.join(tmpDir, `out-${Math.random().toString(36).slice(2)}.pdf`);
      return assemblePdf(
        files.map((file) => ({ file })),
        out,
      ).then(
        () => {
          throw new Error('merge succeeded');
        },
        (err: unknown) => err,
      );
    }

    it('로컬 qpdf 에서 열기 암호 PDF 의 --show-npages 종료 코드는 2', () => {
      let status: number | null = 0;
      try {
        execFileSync(QPDF_BIN, ['--show-npages', '--', encryptedPath], { stdio: 'ignore' });
      } catch (err: unknown) {
        status = (err as { status?: number | null }).status ?? null;
      }
      expect(status).toBe(2);
    });

    it('probePdfOpenQpdf: 정상 → readable·쪽수, 손상·열기 암호 → unreadable', async () => {
      expect(await qpdfMeta.probePdfOpenQpdf(goodPath)).toEqual({ result: 'readable', pageCount: 1 });
      expect(await qpdfMeta.probePdfOpenQpdf(corruptPath)).toEqual({ result: 'unreadable' });
      expect(await qpdfMeta.probePdfOpenQpdf(encryptedPath)).toEqual({ result: 'unreadable' });
    });

    it('probePdfOpenQpdf: 시간 초과는 unknown', async () => {
      expect(await qpdfMeta.probePdfOpenQpdf(goodPath, 1)).toEqual({ result: 'unknown' });
    });

    it.each([
      ['끝까지 받은 손상 파일', (): string => corruptPath],
      ['열기 암호 파일', (): string => encryptedPath],
      ['PDF 헤더가 없는 파일', (): string => htmlPath],
    ])('%s → PDF_LOAD_FAILED', async (_t, bad) => {
      const original = await mergeFailure([goodPath, bad()]);
      const err = await toQpdfInputError(original, [
        { path: goodPath, input: 'cover' },
        { path: bad(), input: 'content' },
      ]);
      const domain = expectInputError(err, ErrorCodes.PDF_LOAD_FAILED, 'content');
      expect(domain.cause).toBe(original);
    });

    it('PDF 헤더가 없는 파일은 판독 없이 판정한다', async () => {
      const probe = jest.spyOn(qpdfMeta, 'probePdfOpenQpdf');
      const original = await mergeFailure([htmlPath]);
      const err = await toQpdfInputError(original, [{ path: htmlPath, input: 'endpaper' }]);
      expectInputError(err, ErrorCodes.PDF_LOAD_FAILED, 'endpaper');
      expect(probe).not.toHaveBeenCalled();
    });

    it.each([
      ['파일 끝 표지가 없는 파일(정상 PDF 앞 64바이트)', (): string => truncatedPath],
      ['빈 파일', (): string => emptyPath],
      ['없는 경로', (): string => path.join(uploadsDir, 'gone.pdf')],
    ])('%s → 원래 오류', async (_t, bad) => {
      const original = await mergeFailure([goodPath, bad()]);
      const err = await toQpdfInputError(original, [
        { path: goodPath, input: 'cover' },
        { path: bad(), input: 'content' },
      ]);
      expect(err).toBe(original);
    });

    it('입력이 모두 정상이면 원래 오류(산출 경로 오류 등)', async () => {
      const original = await mergeFailure([goodPath], path.join(tmpDir, 'nodir', 'out.pdf'));
      expect(await toQpdfInputError(original, [{ path: goodPath, input: 'content' }])).toBe(original);
    });

    it.each([
      ['시간 초과·시그널 종료', { qpdfExitCode: null, qpdfKilled: true }],
      ['실행 실패(종료 코드 없음)', { qpdfExitCode: null, qpdfKilled: false }],
      ['종료 코드 2 지만 시그널 종료', { qpdfExitCode: 2, qpdfKilled: true }],
    ])('%s로 실패한 병합은 입력을 판독하지 않고 다음 시도로 넘긴다', async (_t, props) => {
      const probe = jest.spyOn(qpdfMeta, 'probePdfOpenQpdf');
      const original = Object.assign(new Error('qpdf assemble(2 parts) 실패'), props);
      expect(await toQpdfInputError(original, [{ path: corruptPath, input: 'content' }])).toBe(original);
      expect(probe).not.toHaveBeenCalled();
    });

    it('runQpdf 가 던진 오류가 아니면 판독하지 않는다', async () => {
      const probe = jest.spyOn(qpdfMeta, 'probePdfOpenQpdf');
      const original = new Error('other');
      expect(await toQpdfInputError(original, [{ path: corruptPath, input: 'content' }])).toBe(original);
      expect(probe).not.toHaveBeenCalled();
    });

    it('같은 경로는 한 번만 판독하고, 판독 수는 상한(8) 이하다', async () => {
      const probe = jest.spyOn(qpdfMeta, 'probePdfOpenQpdf');
      const original = await mergeFailure([goodPath, truncatedPath]);
      const same = Array.from({ length: 20 }, () => ({ path: goodPath, input: 'endpaper' as const }));
      expect(await toQpdfInputError(original, same)).toBe(original);
      expect(probe).toHaveBeenCalledTimes(1);

      probe.mockClear();
      const distinct: string[] = [];
      for (let i = 0; i < 12; i++) {
        const copy = path.join(uploadsDir, `copy-${i}.pdf`);
        await fs.copyFile(goodPath, copy);
        distinct.push(copy);
      }
      const many = [...distinct.map((p) => ({ path: p, input: 'endpaper' as const })), { path: corruptPath, input: 'content' as const }];
      expect(await toQpdfInputError(original, many)).toBe(original);
      expect(probe).toHaveBeenCalledTimes(8);
      for (const call of probe.mock.calls) expect(call[1]).toBeLessThanOrEqual(15_000);
    });

    it('판독 예산을 넘기면 원래 오류', async () => {
      const probe = jest.spyOn(qpdfMeta, 'probePdfOpenQpdf');
      const original = await mergeFailure([corruptPath]);
      const err = await toQpdfInputError(original, [{ path: corruptPath, input: 'content' }], {
        maxInputs: 8,
        perProbeTimeoutMs: 15_000,
        totalBudgetMs: 0,
      });
      expect(err).toBe(original);
      expect(probe).not.toHaveBeenCalled();
    });
  });

  it('감싼 세 코드는 재시도하지 않는 코드로 분류된다', () => {
    for (const code of [ErrorCodes.PDF_LOAD_FAILED, ErrorCodes.FILE_NOT_FOUND, ErrorCodes.INPUT_URL_REJECTED]) {
      expect(classifySynthesisError(new DomainError(code, 'm', { input: 'cover' })).retryable).toBe(false);
    }
  });
});
