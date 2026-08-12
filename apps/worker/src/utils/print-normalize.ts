import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { runGhostscript, GS_PDFWRITE_TIMEOUT_MS } from './ghostscript';

const logger = new Logger('PrintNormalize');

/**
 * R5 (2026-08-11) — 최종 인쇄 산출 정규화 (X-1a 스타일).
 *
 * 국내 인쇄소 입고 표준(감사 §3: 검증은 X-4 수용, **산출은 X-1a 스타일**이 안전)에
 * 맞춰 합성 최종 PDF 를 정규화한다: RGB→CMYK 변환(+타깃 ICC), OutputIntent 부착
 * (GS PDFX 정의), 선택적 투명도 평탄화(CompatibilityLevel 1.3).
 *
 * ## 운영 안전 계약 (유저·관리자 무영향 원칙 — 오너 지시 2026-08-11)
 *  1. **기본 OFF**: PRINT_NORMALIZE=true 가 아니면 완전 no-op — 배포 자체는 무변경.
 *     (⚠️ compose env 매핑 필수 — 매핑 누락=silent no-op 함정은 이 경우 안전 방향)
 *  2. **fail-open**: 정규화 실패(GS 오류·ICC 부재·타임아웃) 시 원본 파일 그대로 유지
 *     — 주문 산출이 정규화 때문에 막히는 일은 없다. 실패는 warn 로그로만 남긴다.
 *  3. **대형 파일 스킵**: PRINT_NORMALIZE_MAX_BYTES(기본 50MB) 초과는 스킵 —
 *     2GB 무손실(qpdf) 트랙과 상호 배타(GS 재증류는 상수 메모리가 아니다).
 *  4. 스팟/오버프린트 보존: PreserveSeparation/DeviceN/OverprintSettings 유지 —
 *     별색 무손실 정책(트랙 B)과 정합. 주석 제거(R4a)도 동일 적용.
 *
 * ## ICC (오너 결정 2026-08-10)
 *  표준 = Japan Color 2001 Coated. Adobe 배포본은 재배포 제한 → 레포 커밋 금지,
 *  VPS `storage/icc/`(컨테이너 /app/storage/icc) 배치 + PRINT_ICC_PROFILE_PATH 주입.
 *  자유배포 폴백 = ECI ISOcoated_v2_300. ICC 미설정/부재 시 정규화 스킵(fail-open).
 */

export interface NormalizeOptions {
  /** 타깃 CMYK ICC 프로파일 절대경로 */
  iccPath: string;
  /** 투명도 평탄화(CompatibilityLevel 1.3 재증류) — 기본 false */
  flatten?: boolean;
  /** OutputIntent 식별자(기본 JC200103 = Japan Color 2001 Coated) */
  outputConditionIdentifier?: string;
  /** OutputIntent 사람용 조건명 */
  outputCondition?: string;
}

/** env 게이트 — 호출 시점 판독(테스트 용이·재기동 없이 compose 반영). */
export function isPrintNormalizeEnabled(): boolean {
  return String(process.env.PRINT_NORMALIZE || '').toLowerCase() === 'true';
}

export function printNormalizeMaxBytes(): number {
  return Number(process.env.PRINT_NORMALIZE_MAX_BYTES) || 50 * 1024 * 1024;
}

export function printIccProfilePath(): string {
  return process.env.PRINT_ICC_PROFILE_PATH || '';
}

function printNormalizeFlatten(): boolean {
  return String(process.env.PRINT_NORMALIZE_FLATTEN || '').toLowerCase() === 'true';
}

/**
 * GS PDFX 정의 PostScript 생성(순수 — 테스트 대상).
 * lib/PDFX_def.ps 샘플 최소본: OutputIntent(ICC 임베드)+식별자.
 * PS 문자열 리터럴 이스케이프: \ ( ) 만 처리하면 충분(경로/식별자 한정 입력).
 */
export function buildPdfxDefPs(opts: NormalizeOptions): string {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const ident = opts.outputConditionIdentifier ?? 'JC200103';
  const cond = opts.outputCondition ?? 'Japan Color 2001 Coated';
  return [
    '%!',
    '% R5 print-normalize PDFX definition (generated at runtime — repo 에 ICC 없음)',
    `/ICCProfile (${esc(opts.iccPath)}) def`,
    '[ /GTS_PDFXVersion (PDF/X-3:2002) /DOCINFO pdfmark',
    '[ /_objdef {icc_PDFX} /type /stream /OBJ pdfmark',
    '[ {icc_PDFX} << /N 4 >> /PUT pdfmark',
    '[ {icc_PDFX} ICCProfile (r) file /PUT pdfmark',
    '[ /_objdef {OutputIntent_PDFX} /type /dict /OBJ pdfmark',
    '[ {OutputIntent_PDFX} <<',
    '  /Type /OutputIntent',
    '  /S /GTS_PDFX',
    `  /OutputCondition (${esc(cond)})`,
    `  /OutputConditionIdentifier (${esc(ident)})`,
    '  /DestOutputProfile {icc_PDFX}',
    '  /RegistryName (http://www.color.org/)',
    '>> /PUT pdfmark',
    '[ {Catalog} << /OutputIntents [ {OutputIntent_PDFX} ] >> /PUT pdfmark',
    '',
  ].join('\n');
}

/**
 * 정규화 GS 인자(순수 — 테스트 대상).
 * PRINT_PRESERVE/SANITIZE 는 ghostscript.ts 내부 상수와 의도 동일하나, 이 함수는
 * 단독 검증 가능해야 하므로 플래그를 명시 나열한다(값 드리프트는 스펙이 잠근다).
 */
export function buildNormalizeArgs(
  inputPath: string,
  outputPath: string,
  pdfxDefPath: string,
  opts: NormalizeOptions,
): string[] {
  return [
    '-q',
    '-dNOPAUSE',
    '-dBATCH',
    '-dSAFER',
    '-sDEVICE=pdfwrite',
    // 평탄화 = 1.3 재증류(투명도 미지원 레벨로 강제 → GS 가 평탄화 수행)
    `-dCompatibilityLevel=${opts.flatten ? '1.3' : '1.4'}`,
    // 보존(트랙 B 정합): 별색/DeviceN/오버프린트
    '-dPreserveOverprintSettings=true',
    '-dPreserveSeparation=true',
    '-dPreserveDeviceN=true',
    // R4a 정합: 주석/폼 제거
    '-dPreserveAnnots=false',
    // X-1a 스타일 색 정규화: RGB/Gray→CMYK, 타깃 ICC
    '-sColorConversionStrategy=CMYK',
    '-sProcessColorModel=DeviceCMYK',
    `-sOutputICCProfile=${opts.iccPath}`,
    // PDF/X 마킹(OutputIntent 는 pdfxDef 의 pdfmark 가 수행)
    '-dPDFX',
    `-sOutputFile=${outputPath}`,
    pdfxDefPath,
    inputPath,
  ];
}

export interface NormalizeOutcome {
  applied: boolean;
  /** 스킵/실패 사유(applied=false 일 때) */
  reason?: 'disabled' | 'no_icc' | 'icc_missing' | 'too_large' | 'gs_failed';
}

/**
 * 최종 인쇄 산출 정규화 — **in-place**(성공 시 원자적 교체).
 * 모든 실패는 fail-open(원본 유지 + warn 로그). 산출 경로 6곳이 1줄로 호출한다.
 */
export async function maybeNormalizeForPrint(
  localPath: string,
): Promise<NormalizeOutcome> {
  if (!isPrintNormalizeEnabled()) return { applied: false, reason: 'disabled' };

  const iccPath = printIccProfilePath();
  if (!iccPath) {
    logger.warn('PRINT_NORMALIZE=true 이나 PRINT_ICC_PROFILE_PATH 미설정 — 스킵(fail-open)');
    return { applied: false, reason: 'no_icc' };
  }

  try {
    await fs.access(iccPath);
  } catch {
    logger.warn(`ICC 프로파일 부재: ${iccPath} — 스킵(fail-open)`);
    return { applied: false, reason: 'icc_missing' };
  }

  try {
    const stat = await fs.stat(localPath);
    if (stat.size > printNormalizeMaxBytes()) {
      logger.warn(
        `정규화 스킵: ${stat.size}B > ${printNormalizeMaxBytes()}B (대형 — 무손실 트랙 우선)`,
      );
      return { applied: false, reason: 'too_large' };
    }
  } catch {
    return { applied: false, reason: 'gs_failed' };
  }

  const tag = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tmpOut = path.join(os.tmpdir(), `norm_${tag}.pdf`);
  const tmpDef = path.join(os.tmpdir(), `pdfx_${tag}.ps`);
  try {
    const opts: NormalizeOptions = {
      iccPath,
      flatten: printNormalizeFlatten(),
      outputConditionIdentifier: process.env.PRINT_ICC_IDENTIFIER || undefined,
      outputCondition: process.env.PRINT_ICC_CONDITION || undefined,
    };
    await fs.writeFile(tmpDef, buildPdfxDefPs(opts), 'latin1');
    await runGhostscript(
      buildNormalizeArgs(localPath, tmpOut, tmpDef, opts),
      GS_PDFWRITE_TIMEOUT_MS,
    );

    // 산출 무결성 최소 확인: 0바이트/부재 시 실패 처리(fail-open)
    const outStat = await fs.stat(tmpOut);
    if (outStat.size === 0) throw new Error('normalized output is empty');

    // 원자적 교체 — 실패 시 원본 그대로
    await fs.copyFile(tmpOut, localPath);
    logger.log(
      `print-normalize 적용: ${path.basename(localPath)} (${outStat.size}B, flatten=${opts.flatten})`,
    );
    return { applied: true };
  } catch (err: any) {
    logger.warn(
      `print-normalize 실패 — 원본 유지(fail-open): ${err?.message ?? err}`,
    );
    return { applied: false, reason: 'gs_failed' };
  } finally {
    await fs.unlink(tmpOut).catch(() => {});
    await fs.unlink(tmpDef).catch(() => {});
  }
}
