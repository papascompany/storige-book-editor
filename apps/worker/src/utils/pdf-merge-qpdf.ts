/**
 * qpdf 기반 파일-기반 PDF 병합/페이지추출 (트랙 B-(f) — 합성/변환 2GB 상수메모리).
 *
 * 기존 합성은 pdf-lib `PDFDocument.create()+copyPages()+save()` 로 여러 입력 PDF를 한
 * 메모리 그래프에 적재 → >1GB content 에서 OOM. qpdf `--empty --pages` 는 페이지 내용을
 * 재해석/재렌더하지 않고 객체를 그대로 이어붙이므로 (1) 상수 메모리(파일기반),
 * (2) 페이지 치수·별색(Separation/DeviceN)·오버프린트 등 인쇄 속성 무손실 — GS pdfwrite
 * 재렌더보다 안전하다. 페이지 순서는 인자 순서대로 정확히 보존된다.
 *
 * ⚠️ 신규 ON 경로 전용. 기존 pdf-lib/GS 경로(OFF)는 수정하지 않는다(파리티 기준).
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import { PDFDocument } from 'pdf-lib';
import { Logger } from '@nestjs/common';

const execFileAsync = promisify(execFile);
const logger = new Logger('PdfMergeQpdf');

const QPDF_PATH = process.env.QPDF_PATH || 'qpdf';
const QPDF_TIMEOUT_MS = Number(process.env.QPDF_MERGE_TIMEOUT_MS || 300000); // 2GB 병합 여유
const QPDF_MAX_BUFFER = 64 * 1024 * 1024; // stdout/stderr (메시지용, 본문 아님)

/** 병합 구성요소: 파일 + (선택) qpdf 페이지범위 표기("1-3","z","1,3,5-z" 등, 1-based, z=마지막). */
export interface MergePart {
  file: string;
  /** qpdf 페이지범위. 미지정 시 전체 페이지(qpdf 기본). */
  range?: string;
}

/**
 * parts 를 순서대로 이어붙여 output 으로 저장. (qpdf --empty --pages f1 [r1] f2 [r2] ... -- out)
 * 페이지 순서/치수/인쇄속성 보존, 상수 메모리.
 */
export async function assemblePdf(parts: MergePart[], output: string): Promise<void> {
  if (!parts.length) throw new Error('assemblePdf: parts 가 비어 있습니다.');
  const args: string[] = ['--empty', '--pages'];
  for (const p of parts) {
    args.push(p.file);
    if (p.range) args.push(p.range);
  }
  args.push('--', output);
  await runQpdf(args, `assemble(${parts.length} parts → ${output})`);
}

/** 여러 PDF 전체를 순서대로 병합. */
export async function mergePdfs(files: string[], output: string): Promise<void> {
  await assemblePdf(files.map((file) => ({ file })), output);
}

/** 한 PDF 에서 페이지범위만 추출. range 예: "1", "z"(마지막), "1-3", "2,4,6". */
export async function extractPages(
  input: string,
  range: string,
  output: string,
): Promise<void> {
  await assemblePdf([{ file: input, range }], output);
}

async function runQpdf(args: string[], ctx: string): Promise<void> {
  try {
    await execFileAsync(QPDF_PATH, args, {
      timeout: QPDF_TIMEOUT_MS,
      maxBuffer: QPDF_MAX_BUFFER,
    });
  } catch (err: any) {
    // qpdf 종료코드 3 = 경고만(스트림길이 복구 등) — 출력은 정상 생성됨. 0/3 외엔 치명.
    const code = typeof err?.code === 'number' ? err.code : undefined;
    if (code === 3) {
      logger.debug(`qpdf ${ctx} 경고(비치명, code=3)`);
      return;
    }
    throw new Error(`qpdf ${ctx} 실패(code=${code}): ${err?.message ?? err}`);
  }
}

/** 출력 파일이 실제로 생성됐고 비어있지 않은지 확인(병합 무결성 가드). */
export async function assertNonEmpty(output: string): Promise<number> {
  const stat = await fs.stat(output);
  if (!stat.size) throw new Error(`qpdf 산출물이 비어 있습니다: ${output}`);
  return stat.size;
}

/**
 * 빈 페이지 1장 PDF 생성(pdf-lib, 소형이라 메모리 안전). compose-mixed 의 null 면지/빈 표지용.
 * 기존 OFF 경로가 PDFDocument.create()+addPage([w,h]) 로 만들던 빈 페이지와 동일 치수(pt).
 */
export async function createBlankPdf(
  widthPt: number,
  heightPt: number,
  output: string,
): Promise<void> {
  const doc = await PDFDocument.create();
  doc.addPage([widthPt, heightPt]);
  const bytes = await doc.save();
  await fs.writeFile(output, bytes);
}
