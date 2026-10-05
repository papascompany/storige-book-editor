/**
 * 합성 입력 오류 타입화 — 같은 입력이면 다시 시도해도 결과가 같은 입력 오류를
 * 재시도하지 않는 DomainError 코드(PDF_LOAD_FAILED·FILE_NOT_FOUND·INPUT_URL_REJECTED)로 감싼다.
 *
 * 합성 입력을 확보·적재하는 호출 지점에서만 감싼다(다른 큐는 같은 다운로드·qpdf 모듈을 쓰되 감싸지 않는다).
 * 판정이 서지 않으면(받다 끊긴 입력, 빈 입력, 판독 실패·시간 초과 등) 원래 오류를 그대로 던진다(재시도 대상).
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { DomainError, ErrorCodes } from '../common/errors';
import { UnsafeDownloadUrlError } from './url-safety';
import { probePdfOpenQpdf } from './pdf-metadata-qpdf';
import { qpdfFailureOf } from './pdf-merge-qpdf';

const logger = new Logger('SynthesisInput');

export type SynthesisInputRole = 'cover' | 'content' | 'endpaper' | 'spread';

/** PDF 헤더(`%PDF-`)를 찾는 앞부분 길이(byte). */
export const PDF_HEADER_SCAN_BYTES = 1024;
/** 파일 끝 표지(`%%EOF`)를 찾는 뒷부분 길이(byte). */
export const PDF_EOF_TAIL_BYTES = 1024;

export type SynthesisInputErrorCode =
  | typeof ErrorCodes.PDF_LOAD_FAILED
  | typeof ErrorCodes.FILE_NOT_FOUND
  | typeof ErrorCodes.INPUT_URL_REJECTED;

/** 감싼 오류의 errorMessage(코드별 안내 문구). */
export const SYNTHESIS_INPUT_MESSAGES: Readonly<Record<SynthesisInputErrorCode, string>> = {
  PDF_LOAD_FAILED: 'PDF 로드 실패 (암호화/손상/지원불가)',
  FILE_NOT_FOUND: '파일을 찾을 수 없습니다',
  INPUT_URL_REJECTED: '입력 파일 주소를 사용할 수 없습니다',
};

/** qpdf 병합 실패 뒤 입력 판독 상한. 넘으면 원래 오류(재시도)를 둔다. */
export interface QpdfInputProbeLimits {
  /** 판독 대상 입력 수(경로 중복 제거 뒤 앞에서부터). */
  maxInputs: number;
  /** 판독 1회 시간 상한(ms). */
  perProbeTimeoutMs: number;
  /** 판독 전체 시간 예산(ms). */
  totalBudgetMs: number;
}

export const QPDF_INPUT_PROBE_LIMITS: Readonly<QpdfInputProbeLimits> = {
  maxInputs: 8,
  perProbeTimeoutMs: 15_000,
  totalBudgetMs: 30_000,
};

/**
 * 입력 바이트 모양.
 * - empty     : 0바이트 — 판정하지 않는다(재시도).
 * - no-header : 앞 1024바이트에 `%PDF-` 가 없음 — PDF 가 아니다(받다 끊겨도 헤더는 남으므로 확정).
 * - no-eof    : 헤더는 있으나 뒤 1024바이트에 `%%EOF` 가 없음 — 받다 끊긴 입력일 수 있다(재시도).
 * - complete  : 헤더와 파일 끝 표지가 모두 있음 — 끝까지 받은 입력.
 */
export type PdfInputShape = 'empty' | 'no-header' | 'no-eof' | 'complete';

interface PdfMarkers {
  size: number;
  header: boolean;
  eof: boolean;
}

function containsLatin1(bytes: Uint8Array, marker: string): boolean {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).indexOf(marker, 0, 'latin1') !== -1;
}

/** 앞 1024바이트 안에 `%PDF-` 가 있으면 true. */
export function hasPdfHeader(bytes: Uint8Array): boolean {
  return containsLatin1(bytes.subarray(0, PDF_HEADER_SCAN_BYTES), '%PDF-');
}

/** 마지막 1024바이트 안에 `%%EOF` 가 있으면 true. */
export function hasPdfEofMarker(bytes: Uint8Array): boolean {
  return containsLatin1(bytes.subarray(Math.max(0, bytes.byteLength - PDF_EOF_TAIL_BYTES)), '%%EOF');
}

function shapeOf(markers: PdfMarkers): PdfInputShape {
  if (markers.size === 0) return 'empty';
  if (!markers.header) return 'no-header';
  if (!markers.eof) return 'no-eof';
  return 'complete';
}

/** 입력 바이트 모양(PdfInputShape). */
export function pdfInputShape(bytes: Uint8Array): PdfInputShape {
  return shapeOf({ size: bytes.byteLength, header: hasPdfHeader(bytes), eof: hasPdfEofMarker(bytes) });
}

/** 열 수 없을 때 입력 오류로 확정하는 모양인지(PDF 아님 또는 끝까지 받은 입력). */
function isDecisiveShape(shape: PdfInputShape): boolean {
  return shape === 'no-header' || shape === 'complete';
}

/** 일반 파일이면 앞·뒤 1024바이트만 읽어 표지를 확인한다. 일반 파일이 아니거나 읽기 오류면 null. */
async function readPdfFileMarkers(filePath: string): Promise<PdfMarkers | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    const size = stat.size;
    if (size === 0) return { size, header: false, eof: false };
    const handle = await fs.open(filePath, 'r');
    try {
      const headLength = Math.min(size, PDF_HEADER_SCAN_BYTES);
      const head = Buffer.alloc(headLength);
      await handle.read(head, 0, headLength, 0);
      const tailLength = Math.min(size, PDF_EOF_TAIL_BYTES);
      const tail = Buffer.alloc(tailLength);
      await handle.read(tail, 0, tailLength, size - tailLength);
      return { size, header: hasPdfHeader(head), eof: hasPdfEofMarker(tail) };
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/** 일반 파일이고 앞 1024바이트에 `%PDF-` 가 있으면 true. 그 밖(일반 파일 아님·읽기 오류 포함)은 false. */
export async function fileHasPdfHeader(filePath: string): Promise<boolean> {
  return (await readPdfFileMarkers(filePath))?.header === true;
}

/** 일반 파일이고 마지막 1024바이트에 `%%EOF` 가 있으면 true. 그 밖(일반 파일 아님·읽기 오류 포함)은 false. */
export async function fileHasPdfEofMarker(filePath: string): Promise<boolean> {
  return (await readPdfFileMarkers(filePath))?.eof === true;
}

/**
 * LIGHTWEIGHT_SYNTHESIS 경로(stream-download downloadToTempFile)의 로컬 저장소 루트.
 * resolveLocalPath 와 같은 기준(WORKER_STORAGE_PATH + '/storage')이다.
 */
export function lightweightStorageRoot(): string {
  return path.resolve(process.env.WORKER_STORAGE_PATH || '../api', 'storage');
}

function readProp(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

const LOG_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const CAUSE_MESSAGE_MAX = 500;

function causeName(err: unknown): string {
  const name = readProp(err, 'name');
  return typeof name === 'string' && LOG_NAME_PATTERN.test(name) ? name : '-';
}

function causeMessage(err: unknown): string {
  const message = readProp(err, 'message');
  const text = typeof message === 'string' ? message : String(err);
  return text.replace(/\s+/g, ' ').trim().slice(0, CAUSE_MESSAGE_MAX);
}

/**
 * 입력 오류 DomainError 를 만든다. 원래 오류는 열거되지 않는 cause 로 붙인다(toJSON·payload 에 실리지 않음).
 * 서버 로그: [SYNTH_INPUT] 1줄(코드·입력 역할·원래 오류 이름) + 원래 오류 메시지 1줄.
 */
function wrapInputError(code: SynthesisInputErrorCode, input: SynthesisInputRole, cause: unknown): DomainError {
  const wrapped = new DomainError(code, SYNTHESIS_INPUT_MESSAGES[code], { input });
  Object.defineProperty(wrapped, 'cause', { value: cause, enumerable: false, configurable: true, writable: true });
  logger.warn(`[SYNTH_INPUT] input=${input} code=${code} cause=${causeName(cause)}`);
  logger.warn(`합성 입력 오류 원문 input=${input} code=${code}: ${causeMessage(cause)}`);
  return wrapped;
}

function isAllocationFailure(err: unknown): boolean {
  if (!(err instanceof RangeError)) return false;
  return /allocation failed/i.test(err.message);
}

/**
 * 입력 PDF 바이트를 pdf-lib 기본 옵션으로 적재하고 쪽수를 읽어 본다.
 * 실패하면: 메모리 할당 실패·빈 입력·받다 끊긴 입력(헤더 있고 `%%EOF` 없음)은 원래 오류를,
 * PDF 가 아니거나(헤더 없음) 끝까지 받은 입력이면 PDF_LOAD_FAILED 를 throw 한다.
 */
export async function loadInputPdf(bytes: Uint8Array, input: SynthesisInputRole): Promise<PDFDocument> {
  try {
    const doc = await PDFDocument.load(bytes);
    // 문서 카탈로그·쪽 트리가 없으면 적재는 되고 쪽수 접근에서 실패한다 — 열 수 없는 입력과 같게 본다.
    doc.getPageCount();
    return doc;
  } catch (err: unknown) {
    if (isAllocationFailure(err)) throw err;
    if (!isDecisiveShape(pdfInputShape(bytes))) throw err;
    throw wrapInputError(ErrorCodes.PDF_LOAD_FAILED, input, err);
  }
}

function isLocalRef(ref: string): boolean {
  return ref.startsWith('/') || ref.startsWith('./') || ref.startsWith('storage/');
}

/** 저장소 루트 하위(루트 바로 아래 제외)의 없는 파일이고, 그 상위 디렉터리가 있으면 true. */
async function isMissingStorageFile(err: unknown, ref: string, storageRoot: string): Promise<boolean> {
  if (readProp(err, 'code') !== 'ENOENT') return false;
  const errPath = readProp(err, 'path');
  if (typeof errPath !== 'string' || !isLocalRef(ref)) return false;

  const root = path.resolve(storageRoot);
  const target = path.resolve(errPath);
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return false;
  }
  const parent = path.dirname(target);
  if (parent === root) return false;
  try {
    return (await fs.stat(parent)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 입력 확보 오류를 분류한다.
 * - UnsafeDownloadUrlError → INPUT_URL_REJECTED
 * - 로컬 참조의 ENOENT 이고 경로가 저장소 루트 하위(루트 바로 아래 제외)이며 상위 디렉터리가 있음 → FILE_NOT_FOUND
 * - 그 밖(이름 확인 실패·HTTP 오류·EACCES·원격 입력의 임시파일 오류 등) → 원래 오류 그대로
 */
export async function toInputFetchError(
  err: unknown,
  ref: string,
  input: SynthesisInputRole,
  storageRoot: string,
): Promise<unknown> {
  if (err instanceof UnsafeDownloadUrlError) {
    return wrapInputError(ErrorCodes.INPUT_URL_REJECTED, input, err);
  }
  if (await isMissingStorageFile(err, ref, storageRoot)) {
    return wrapInputError(ErrorCodes.FILE_NOT_FOUND, input, err);
  }
  return err;
}

/** 입력 확보 호출(fetch)만 감싼다. 실패하면 toInputFetchError 결과를 throw 한다. */
export async function fetchInput<T>(
  ref: string,
  input: SynthesisInputRole,
  storageRoot: string,
  fetch: () => Promise<T>,
): Promise<T> {
  try {
    return await fetch();
  } catch (err: unknown) {
    throw await toInputFetchError(err, ref, input, storageRoot);
  }
}

export interface QpdfInputRef {
  path: string;
  input: SynthesisInputRole;
}

/**
 * qpdf 병합 실패를 입력 오류로 분류한다. throw 하지 않는다.
 * qpdf 종료 코드 2 이고 시간 초과·시그널 종료가 아닐 때만 판독하고, 그 밖은 원래 오류를 돌려준다.
 * 1. 입력을 경로 기준으로 중복 제거하고 앞에서 limits.maxInputs 개만 본다.
 * 2. 앞·뒤 1024바이트로 먼저 거른다: PDF 헤더가 없는 일반 파일 → 바로 PDF_LOAD_FAILED.
 *    빈 파일·`%%EOF` 없음·일반 파일 아님·읽기 오류는 판독하지 않는다.
 * 3. 끝까지 받은 입력만 `qpdf --show-npages` 로 판독한다(1회 상한 perProbeTimeoutMs, 전체 예산 totalBudgetMs).
 *    열 수 없으면(unreadable) PDF_LOAD_FAILED. 예산을 넘기면 원래 오류.
 */
export async function toQpdfInputError(
  err: unknown,
  inputs: ReadonlyArray<QpdfInputRef>,
  limits: QpdfInputProbeLimits = QPDF_INPUT_PROBE_LIMITS,
): Promise<unknown> {
  const failure = qpdfFailureOf(err);
  if (!failure || failure.exitCode !== 2 || failure.killed) return err;

  const startedAt = Date.now();
  const unique = new Map<string, QpdfInputRef>();
  for (const ref of inputs) {
    const key = path.resolve(ref.path);
    if (!unique.has(key)) unique.set(key, ref);
  }
  const examined = Array.from(unique.values()).slice(0, Math.max(0, limits.maxInputs));

  const complete: QpdfInputRef[] = [];
  for (const ref of examined) {
    const markers = await readPdfFileMarkers(ref.path);
    if (!markers) continue;
    const shape = shapeOf(markers);
    if (shape === 'no-header') return wrapInputError(ErrorCodes.PDF_LOAD_FAILED, ref.input, err);
    if (shape === 'complete') complete.push(ref);
  }

  for (const ref of complete) {
    const remaining = limits.totalBudgetMs - (Date.now() - startedAt);
    if (remaining <= 0) return err;
    const probe = await probePdfOpenQpdf(ref.path, Math.min(limits.perProbeTimeoutMs, remaining));
    if (probe.result === 'unreadable') return wrapInputError(ErrorCodes.PDF_LOAD_FAILED, ref.input, err);
  }
  return err;
}
