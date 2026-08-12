import * as fs from 'fs/promises';
import {
  buildNormalizeArgs,
  buildPdfxDefPs,
  maybeNormalizeForPrint,
  isPrintNormalizeEnabled,
} from './print-normalize';

jest.mock('./ghostscript', () => ({
  runGhostscript: jest.fn().mockResolvedValue(''),
  GS_PDFWRITE_TIMEOUT_MS: 60_000,
}));
jest.mock('fs/promises');

const mockedFs = fs as jest.Mocked<typeof fs>;
const { runGhostscript } = require('./ghostscript');

/**
 * R5 인쇄 산출 정규화 — 운영 안전 계약 잠금.
 * 핵심: 기본 OFF no-op · 모든 실패 fail-open(원본 무접촉) · 대형 스킵.
 */

const ENV_KEYS = [
  'PRINT_NORMALIZE',
  'PRINT_NORMALIZE_FLATTEN',
  'PRINT_NORMALIZE_MAX_BYTES',
  'PRINT_ICC_PROFILE_PATH',
  'PRINT_ICC_IDENTIFIER',
  'PRINT_ICC_CONDITION',
];

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of ENV_KEYS) delete process.env[k];
  // 자동 목은 undefined 반환 — finally 의 `unlink().catch()` 체인이 성립하도록 promise 부여
  mockedFs.unlink.mockResolvedValue(undefined);
});

describe('buildNormalizeArgs', () => {
  const opts = { iccPath: '/app/storage/icc/JapanColor2001Coated.icc' };

  it('X-1a 스타일 핵심 플래그를 전부 포함한다', () => {
    const args = buildNormalizeArgs('/in.pdf', '/out.pdf', '/def.ps', opts);
    expect(args).toContain('-sColorConversionStrategy=CMYK');
    expect(args).toContain('-sProcessColorModel=DeviceCMYK');
    expect(args).toContain(`-sOutputICCProfile=${opts.iccPath}`);
    expect(args).toContain('-dPDFX');
    // -dSAFER 가 PDFX def 의 ICC file 읽기를 차단(invalidfileaccess 실증) — 명시 허용 필수
    expect(args).toContain(`--permit-file-read=${opts.iccPath}`);
    // 보존(트랙 B 정합)·주석 제거(R4a 정합)
    expect(args).toContain('-dPreserveSeparation=true');
    expect(args).toContain('-dPreserveOverprintSettings=true');
    expect(args).toContain('-dPreserveDeviceN=true');
    expect(args).toContain('-dPreserveAnnots=false');
    // 기본은 평탄화 안 함(1.4)
    expect(args).toContain('-dCompatibilityLevel=1.4');
    // pdfxDef 가 입력 PDF 보다 먼저(pdfmark 선행 실행)
    expect(args.indexOf('/def.ps')).toBeLessThan(args.indexOf('/in.pdf'));
  });

  it('flatten=true 면 1.3 재증류(투명도 평탄화)', () => {
    const args = buildNormalizeArgs('/in.pdf', '/out.pdf', '/def.ps', {
      ...opts,
      flatten: true,
    });
    expect(args).toContain('-dCompatibilityLevel=1.3');
  });
});

describe('buildPdfxDefPs', () => {
  it('ICC 경로·식별자·OutputIntent pdfmark 를 포함한다', () => {
    const ps = buildPdfxDefPs({
      iccPath: '/app/storage/icc/JapanColor2001Coated.icc',
    });
    expect(ps).toContain('/ICCProfile (/app/storage/icc/JapanColor2001Coated.icc) def');
    expect(ps).toContain('(JC200103)');
    expect(ps).toContain('(Japan Color 2001 Coated)');
    expect(ps).toContain('/OutputIntents');
    expect(ps).toContain('/GTS_PDFX');
  });

  it('경로의 PS 특수문자(괄호·역슬래시)를 이스케이프한다', () => {
    const ps = buildPdfxDefPs({ iccPath: '/tmp/(x)\\y.icc' });
    expect(ps).toContain('(/tmp/\\(x\\)\\\\y.icc)');
  });
});

describe('maybeNormalizeForPrint — 운영 안전 계약', () => {
  it('기본(플래그 미설정)은 완전 no-op — 파일시스템·GS 무접촉', async () => {
    expect(isPrintNormalizeEnabled()).toBe(false);
    const r = await maybeNormalizeForPrint('/x/merged.pdf');
    expect(r).toEqual({ applied: false, reason: 'disabled' });
    expect(runGhostscript).not.toHaveBeenCalled();
    expect(mockedFs.copyFile).not.toHaveBeenCalled();
  });

  it('ON 이어도 ICC 미설정이면 스킵(fail-open)', async () => {
    process.env.PRINT_NORMALIZE = 'true';
    const r = await maybeNormalizeForPrint('/x/merged.pdf');
    expect(r).toEqual({ applied: false, reason: 'no_icc' });
    expect(runGhostscript).not.toHaveBeenCalled();
  });

  it('ICC 파일 부재면 스킵(fail-open)', async () => {
    process.env.PRINT_NORMALIZE = 'true';
    process.env.PRINT_ICC_PROFILE_PATH = '/icc/missing.icc';
    mockedFs.access.mockRejectedValueOnce(new Error('ENOENT'));
    const r = await maybeNormalizeForPrint('/x/merged.pdf');
    expect(r).toEqual({ applied: false, reason: 'icc_missing' });
  });

  it('대형 파일은 스킵 — 2GB 무손실 트랙 우선', async () => {
    process.env.PRINT_NORMALIZE = 'true';
    process.env.PRINT_ICC_PROFILE_PATH = '/icc/jc.icc';
    mockedFs.access.mockResolvedValueOnce(undefined);
    mockedFs.stat.mockResolvedValueOnce({ size: 60 * 1024 * 1024 } as any);
    const r = await maybeNormalizeForPrint('/x/merged.pdf');
    expect(r).toEqual({ applied: false, reason: 'too_large' });
    expect(runGhostscript).not.toHaveBeenCalled();
  });

  it('GS 실패 시 원본 무접촉(fail-open) — copyFile 호출 없음', async () => {
    process.env.PRINT_NORMALIZE = 'true';
    process.env.PRINT_ICC_PROFILE_PATH = '/icc/jc.icc';
    mockedFs.access.mockResolvedValueOnce(undefined);
    mockedFs.stat.mockResolvedValueOnce({ size: 1024 } as any);
    mockedFs.writeFile.mockResolvedValueOnce(undefined);
    runGhostscript.mockRejectedValueOnce(new Error('gs boom'));

    const r = await maybeNormalizeForPrint('/x/merged.pdf');
    expect(r).toEqual({ applied: false, reason: 'gs_failed' });
    expect(mockedFs.copyFile).not.toHaveBeenCalled();
  });

  it('정규화 산출이 0바이트면 실패 처리(원본 유지)', async () => {
    process.env.PRINT_NORMALIZE = 'true';
    process.env.PRINT_ICC_PROFILE_PATH = '/icc/jc.icc';
    mockedFs.access.mockResolvedValueOnce(undefined);
    mockedFs.stat
      .mockResolvedValueOnce({ size: 1024 } as any) // 입력 크기
      .mockResolvedValueOnce({ size: 0 } as any); // 산출 크기
    mockedFs.writeFile.mockResolvedValueOnce(undefined);

    const r = await maybeNormalizeForPrint('/x/merged.pdf');
    expect(r).toEqual({ applied: false, reason: 'gs_failed' });
    expect(mockedFs.copyFile).not.toHaveBeenCalled();
  });

  it('성공 시 원자적 교체(copyFile tmp→원본) + applied=true', async () => {
    process.env.PRINT_NORMALIZE = 'true';
    process.env.PRINT_ICC_PROFILE_PATH = '/icc/jc.icc';
    mockedFs.access.mockResolvedValueOnce(undefined);
    mockedFs.stat
      .mockResolvedValueOnce({ size: 1024 } as any)
      .mockResolvedValueOnce({ size: 900 } as any);
    mockedFs.writeFile.mockResolvedValueOnce(undefined);
    mockedFs.copyFile.mockResolvedValueOnce(undefined);

    const r = await maybeNormalizeForPrint('/x/merged.pdf');
    expect(r).toEqual({ applied: true });
    expect(runGhostscript).toHaveBeenCalledTimes(1);
    const dest = mockedFs.copyFile.mock.calls[0][1];
    expect(dest).toBe('/x/merged.pdf');
  });
});
