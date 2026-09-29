// 관리자 편집데이터 관리 — 순수 헬퍼 (2026-09-29). DOM·스토어 접근 없음(단위테스트 대상).
import type {
  ApiErrorCode,
  RetentionInfo,
  StaffOrderMeta,
  StaffSessionItem,
} from '../../api/edit-data';

const DAY_MS = 86_400_000;

type RetentionCarrier = Pick<StaffSessionItem, 'retention'>;
type SessionGateFields = Pick<StaffSessionItem, 'retention' | 'siteId' | 'deletedAt'>;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 로컬 시간대 기준 YYYY-MM-DD */
export function formatYmd(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 남은 일수(D-n). 남은 시간을 일 단위로 올림한다.
 * 24h 이하 남음 → 1, 24h 초과 → 2 … 이미 지났으면 0.
 */
export function remainingDays(until: Date, now: Date): number {
  const ms = until.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / DAY_MS);
}

/** '미설정' | '보관중 · D-n (YYYY-MM-DD)' | '만료 (YYYY-MM-DD)' */
export function retentionLabel(retention: RetentionInfo, now: Date): string {
  const until = parseDate(retention.until);
  if (retention.state === 'expired') {
    return until ? `만료 (${formatYmd(until)})` : '만료';
  }
  if (retention.state === 'active' && until) {
    return `보관중 · D-${remainingDays(until, now)} (${formatYmd(until)})`;
  }
  return '미설정';
}

export function retentionTagColor(retention: RetentionInfo): 'default' | 'green' | 'red' {
  if (retention.state === 'active') return 'green';
  if (retention.state === 'expired') return 'red';
  return 'default';
}

/** 편집·완료·합성·복구 허용 여부 — 보관기간 만료가 아니어야 한다(서버 판정 state 기준) */
export function isEditAllowed(item: RetentionCarrier): boolean {
  return item.retention.state !== 'expired';
}

/** 편집기에서 열기 — 사이트 있음, 삭제 안 됨, 보관기간 안 */
export function canOpenEditor(item: SessionGateFields): boolean {
  return item.siteId != null && !item.deletedAt && isEditAllowed(item);
}

/** 합성/재합성 — 편집기 열기와 같은 조건(서버: SESSION_DELETED / STAFF_SESSION_SITE_REQUIRED / EDIT_RETENTION_EXPIRED) */
export function canSynthesize(item: SessionGateFields): boolean {
  return canOpenEditor(item);
}

/** 완료 처리 — 미완료(draft/editing)·삭제 안 됨·보관기간 안 */
export function canCompleteItem(
  item: SessionGateFields & Pick<StaffSessionItem, 'status'>,
): boolean {
  return item.status !== 'complete' && !item.deletedAt && isEditAllowed(item);
}

/** 삭제 — 서버가 준 canDelete 만 따른다. 보관기간 만료는 막지 않는다 */
export function canDeleteItem(item: Pick<StaffSessionItem, 'canDelete' | 'deletedAt'>): boolean {
  return item.canDelete === true && !item.deletedAt;
}

/** 복구 — canDelete + 삭제된 세션 + 보관기간 안 */
export function canRestoreItem(
  item: Pick<StaffSessionItem, 'canDelete' | 'deletedAt' | 'retention'>,
): boolean {
  return item.canDelete === true && !!item.deletedAt && isEditAllowed(item);
}

/**
 * 편집기 새 탭 URL. 토큰은 fragment(#) 에만 싣는다 — 서버·엣지 로그·Referer 로 가지 않는다.
 * 인자로 받은 발급 토큰만 사용하며 관리자 로그인 토큰은 절대 읽지 않는다.
 */
export function buildEditorUrl(
  editorBaseUrl: string,
  editorPath: string,
  accessToken: string,
  refreshToken: string,
): string {
  const base = editorBaseUrl.replace(/\/+$/, '');
  const hashIdx = editorPath.indexOf('#');
  const path = hashIdx >= 0 ? editorPath.slice(0, hashIdx) : editorPath;
  return `${base}${path}#token=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken)}`;
}

export const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  EDIT_RETENTION_EXPIRED: '보관기간이 지나 작업할 수 없습니다',
  STAFF_SESSION_SITE_REQUIRED: '사이트가 없는 이전 세션은 편집기·합성을 지원하지 않습니다',
  STAFF_DELETE_NOT_ALLOWED: '삭제 권한이 없습니다',
  STAFF_AUDIT_UNAVAILABLE: '감사 기록을 저장할 수 없어 중단했습니다',
  STAFF_BASELINE_UNAVAILABLE: '편집 전 스냅샷을 저장할 수 없어 중단했습니다',
  SESSION_ALREADY_COMPLETE: '이미 완료된 세션입니다',
  OUTPUT_STALE:
    '관리자 편집 후 편집완료가 되지 않았습니다. 편집기에서 편집완료로 PDF를 다시 만든 뒤 합성하세요',
  SESSION_DELETED: '삭제된 세션입니다. 먼저 복구하세요',
  SESSION_ASSEMBLY_INCOMPLETE: '합성에 필요한 파일이 없습니다',
  STAFF_ROLE_REQUIRED: '관리자 권한이 필요합니다',
  SESSION_NOT_FOUND: '세션을 찾을 수 없습니다',
  GRANT_NOT_FOUND: '편집 권한을 찾을 수 없습니다',
  JOB_NOT_FOUND: '작업을 찾을 수 없습니다',
  PARTNER_OPERATOR_UNAVAILABLE: '편집 권한을 발급할 수 없습니다. 잠시 후 다시 시도하세요',
  JOB_NOT_COMPLETED: '작업이 아직 완료되지 않았습니다',
  OUTPUT_NOT_FOUND: '결과 파일을 찾을 수 없습니다',
  FILE_NOT_ON_DISK: '결과 파일을 찾을 수 없습니다',
  TENANT_FORBIDDEN: '이 사이트의 데이터에 접근할 권한이 없습니다',
  FILE_NOT_FOUND: '파일을 찾을 수 없습니다',
  STREAM_ERROR: '파일을 내려받는 중 오류가 발생했습니다. 다시 시도하세요',
};

/** 목록 라우트 404 = 새 API 미배포(배포 창) */
export const LIST_UNAVAILABLE_MESSAGE = '서버 업데이트 중입니다. 잠시 후 새로고침하세요';

export function errorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code)
    ? ERROR_MESSAGES[code as ApiErrorCode]
    : null;
}

export interface ParsedApiError {
  status: number | null;
  code: string | null;
  message: string | null;
}

/** axios 오류에서 status/code/message 추출 (Nest 예외 본문 {code,message} 또는 {message:{code}} 모두) */
export function parseApiError(err: unknown): ParsedApiError {
  const response = (err as { response?: { status?: unknown; data?: unknown } } | null)?.response;
  const status = typeof response?.status === 'number' ? response.status : null;
  const data = response?.data;
  let code: string | null = null;
  let message: string | null = null;
  if (data && typeof data === 'object') {
    const d = data as { code?: unknown; message?: unknown };
    if (typeof d.code === 'string') code = d.code;
    if (typeof d.message === 'string') {
      message = d.message;
    } else if (Array.isArray(d.message)) {
      message = d.message.filter((m): m is string => typeof m === 'string').join(', ') || null;
    } else if (d.message && typeof d.message === 'object') {
      const inner = d.message as { code?: unknown; message?: unknown };
      if (!code && typeof inner.code === 'string') code = inner.code;
      if (typeof inner.message === 'string') message = inner.message;
    }
  }
  return { status, code, message };
}

/** 사용자 표시용 오류 문구. listContext=true 면 404 를 '서버 업데이트 중'으로 안내 */
export function describeApiError(
  err: unknown,
  fallback: string,
  options: { listContext?: boolean } = {},
): string {
  const parsed = parseApiError(err);
  const mapped = errorMessage(parsed.code);
  if (mapped) return mapped;
  if (options.listContext && parsed.status === 404) return LIST_UNAVAILABLE_MESSAGE;
  return parsed.message || fallback;
}

/** orderMeta → 제작 스펙 요약 */
export function orderMetaSummary(meta: StaffOrderMeta | null | undefined): string {
  if (!meta) return '-';
  const parts: string[] = [];
  if (meta.productName) parts.push(meta.productName);
  if (meta.title) parts.push(meta.title);
  const size = meta.size;
  if (typeof size === 'string' && size) {
    parts.push(size);
  } else if (size && typeof size === 'object' && size.width && size.height) {
    parts.push(`${size.width}×${size.height}mm`);
  }
  if (meta.quantity !== null && meta.quantity !== undefined && meta.quantity !== '') {
    parts.push(`${meta.quantity}부`);
  }
  return parts.length ? parts.join(' · ') : '-';
}

/**
 * 사이트 폼 제출 payload — editRetentionDays 는 사용자가 건드린 경우에만 보낸다
 * (배포 창에 구 API 가 모르는 키로 400 나는 것 방지). 비운 값은 null(=미설정)로 보낸다.
 */
export function withEditRetentionDays<T extends { editRetentionDays?: number | null }>(
  values: T,
  touched: boolean,
): Omit<T, 'editRetentionDays'> & { editRetentionDays?: number | null } {
  const { editRetentionDays, ...rest } = values;
  if (!touched) return rest;
  const normalized =
    typeof editRetentionDays === 'number' && Number.isFinite(editRetentionDays)
      ? editRetentionDays
      : null;
  return { ...rest, editRetentionDays: normalized };
}
