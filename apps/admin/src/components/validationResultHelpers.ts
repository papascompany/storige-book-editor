// 검증 결과 표시용 순수 헬퍼 (2026-10-03) — antd·React 미사용.
// 표시는 fail-open: 모르는 코드는 원 코드로, 형식이 맞지 않는 원소·필드는 버리고, 결과 형식을 알 수 없으면 null.
import { WorkerJobType, type WorkerJob } from '@storige/types';
import type { ValidationError, ValidationResult, ValidationWarning } from '../api/worker-jobs';

// Error code translations
export const ERROR_CODE_LABELS: Readonly<Record<string, string>> = {
  UNSUPPORTED_FORMAT: '지원하지 않는 파일 형식',
  FILE_CORRUPTED: '손상된 파일',
  FILE_TOO_LARGE: '파일 크기 초과',
  PAGE_COUNT_INVALID: '페이지 수 오류',
  PAGE_COUNT_EXCEEDED: '페이지 수 초과',
  SIZE_MISMATCH: '사이즈 불일치',
  SADDLE_STITCH_INVALID: '사철 제본 규격 오류',
  POST_PROCESS_CMYK: '후가공 파일 CMYK 사용',
  SPREAD_SIZE_MISMATCH: '스프레드 사이즈 불일치',
};

// Warning code translations
export const WARNING_CODE_LABELS: Readonly<Record<string, string>> = {
  PAGE_COUNT_MISMATCH: '페이지 수 불일치',
  BLEED_MISSING: '재단 여백 없음',
  RESOLUTION_LOW: '해상도 낮음',
  LANDSCAPE_PAGE: '가로형 페이지',
  CENTER_OBJECT_CHECK: '중앙부 객체 확인',
  CMYK_STRUCTURE_DETECTED: 'CMYK 구조 감지',
  MIXED_PDF: '혼합 PDF',
  TRANSPARENCY_DETECTED: '투명도 감지',
  OVERPRINT_DETECTED: '오버프린트 감지',
  TRIMBOX_SIZE_BASIS: '재단 크기(TrimBox) 기준 판형',
};

/** 판정에 영향이 없는 정보성 경고 — 경고 색 대신 정보 색으로 표시한다 */
export const INFO_WARNING_CODES: ReadonlySet<string> = new Set(['TRIMBOX_SIZE_BASIS']);

function labelOf(labels: Readonly<Record<string, string>>, code: string): string {
  return Object.prototype.hasOwnProperty.call(labels, code) ? labels[code] : code;
}

export function errorCodeLabel(code: string): string {
  return labelOf(ERROR_CODE_LABELS, code);
}

export function warningCodeLabel(code: string): string {
  return labelOf(WARNING_CODE_LABELS, code);
}

export function isInfoWarning(code: string): boolean {
  return INFO_WARNING_CODES.has(code);
}

export function countInfoWarnings(warnings: ReadonlyArray<Pick<ValidationWarning, 'code'>>): number {
  return warnings.filter((w) => isInfoWarning(w.code)).length;
}

export interface MmSize {
  width: number;
  height: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** width·height 가 유한한 양수일 때만 크기로 인정한다 */
export function toMmSize(value: unknown): MmSize | null {
  if (!isRecord(value)) return null;
  const { width, height } = value;
  return isPositiveFinite(width) && isPositiveFinite(height) ? { width, height } : null;
}

export function formatMmSize(size: MmSize): string {
  return `${size.width.toFixed(1)} x ${size.height.toFixed(1)} mm`;
}

/** 크기 표시 문자열 — 형식이 맞지 않으면 '-' */
export function formatMmSizeOrDash(value: unknown): string {
  const size = toMmSize(value);
  return size ? formatMmSize(size) : '-';
}

export interface TrimBoxBasisDetail {
  trimBox: MmSize;
  mediaBox: MmSize | null;
}

/** TRIMBOX_SIZE_BASIS 경고의 details(mm) — details.trimBox 가 올바를 때만. sizeBasis 값은 보지 않는다 */
export function trimBoxBasisDetail(
  warning: Pick<ValidationWarning, 'code' | 'details'>,
): TrimBoxBasisDetail | null {
  if (warning.code !== 'TRIMBOX_SIZE_BASIS') return null;
  const details: unknown = warning.details;
  if (!isRecord(details)) return null;
  const trimBox = toMmSize(details.trimBox);
  if (!trimBox) return null;
  return { trimBox, mediaBox: toMmSize(details.mediaBox) };
}

/** 경고 메시지 아래 한 줄 — `재단 크기 … · 원본 페이지(MediaBox) …`(mediaBox 가 없으면 앞 구절만) */
export function trimBoxBasisDetailText(detail: TrimBoxBasisDetail): string {
  const trim = `재단 크기 ${formatMmSize(detail.trimBox)}`;
  return detail.mediaBox ? `${trim} · 원본 페이지(MediaBox) ${formatMmSize(detail.mediaBox)}` : trim;
}

export type ValidationMetadataView = Partial<ValidationResult['metadata']>;

export interface ValidationView {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  metadata: ValidationMetadataView;
}

const RESULT_KEYS = ['isValid', 'errors', 'warnings', 'metadata'] as const;

interface IssueFields {
  code: string;
  message: string;
  details: Record<string, unknown>;
  autoFixable: boolean;
  fixMethod?: string;
}

/** 객체이면서 code 가 문자열인 원소만 남긴다. message·fixMethod 는 문자열일 때만 쓴다 */
function toIssues(value: unknown): IssueFields[] {
  if (!Array.isArray(value)) return [];
  const issues: IssueFields[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.code !== 'string') continue;
    const issue: IssueFields = {
      code: item.code,
      message: typeof item.message === 'string' ? item.message : '',
      details: isRecord(item.details) ? item.details : {},
      autoFixable: item.autoFixable === true,
    };
    if (typeof item.fixMethod === 'string') issue.fixMethod = item.fixMethod;
    issues.push(issue);
  }
  return issues;
}

/** 표시에 쓰는 메타데이터 필드만 타입을 확인해 옮긴다(맞지 않는 값은 없는 것으로 본다) */
function toMetadata(value: unknown): ValidationMetadataView {
  if (!isRecord(value)) return {};
  const metadata: ValidationMetadataView = {};
  const pageCount = finiteOrUndefined(value.pageCount);
  if (pageCount !== undefined) metadata.pageCount = pageCount;
  const pageSize = toMmSize(value.pageSize);
  if (pageSize) metadata.pageSize = pageSize;
  if (typeof value.hasBleed === 'boolean') metadata.hasBleed = value.hasBleed;
  const bleedSize = finiteOrUndefined(value.bleedSize);
  if (bleedSize !== undefined) metadata.bleedSize = bleedSize;
  const spineSize = finiteOrUndefined(value.spineSize);
  if (spineSize !== undefined) metadata.spineSize = spineSize;
  const resolution = finiteOrUndefined(value.resolution);
  if (resolution !== undefined) metadata.resolution = resolution;
  if (typeof value.colorMode === 'string') metadata.colorMode = value.colorMode;
  const trimBox = toMmSize(value.trimBox);
  if (trimBox) metadata.trimBox = trimBox;
  return metadata;
}

/**
 * 잡 result 에서 검증 결과를 꺼낸다. 워커는 `{ result: {...} }` 로 감싸 저장하고, 감싸지 않은 형태도 받는다.
 * 결과 키(isValid·errors·warnings·metadata)가 하나도 없으면 null. isValid 가 boolean 이 아니면
 * status 가 COMPLETED 이고 에러가 없을 때 통과로 본다. 예외를 던지지 않는다.
 */
export function extractValidationResult(raw: unknown, status?: string): ValidationView | null {
  if (!isRecord(raw)) return null;
  const inner = isRecord(raw.result) ? raw.result : raw;
  if (!RESULT_KEYS.some((key) => key in inner)) return null;
  const errors = toIssues(inner.errors);
  const warnings = toIssues(inner.warnings);
  const isValid =
    typeof inner.isValid === 'boolean' ? inner.isValid : status === 'COMPLETED' && errors.length === 0;
  return { isValid, errors, warnings, metadata: toMetadata(inner.metadata) };
}

/** 워커 작업 상세의 검증 결과 카드 — VALIDATE 잡이고 결과 형식을 알 수 있을 때만 */
export function validationForJob(
  job: Pick<WorkerJob, 'jobType' | 'status' | 'result'>,
): ValidationView | null {
  if (job.jobType !== WorkerJobType.VALIDATE) return null;
  return extractValidationResult(job.result, String(job.status));
}

/** 결과가 남는 검증 잡 상태 — 세션 작업 목록에서 '검증 결과' 펼침을 둘 행 */
const VALIDATION_RESULT_STATUSES: ReadonlySet<string> = new Set(['COMPLETED', 'FIXABLE', 'FAILED']);

export function canExpandValidationResult(job: { jobType: string; status: string }): boolean {
  return job.jobType === WorkerJobType.VALIDATE && VALIDATION_RESULT_STATUSES.has(job.status);
}
