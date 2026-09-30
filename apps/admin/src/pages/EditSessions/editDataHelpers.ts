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

// ---------------------------------------------------------------------------
// 파트너 주문 연결 세션 안전장치 (2026-09-30, 3-B 운영 원칙)
// 파트너는 고객 편집완료 때 받은 파일 id 를 자기 주문에 저장해 재합성·다운로드에 쓴다.
// 관리자 편집·완료·삭제·합성은 그 저장값을 바꾸지 않으므로 사전 통지 + 사후 통지(세션 id·새 파일 id·UTC)가 필요하다.
// ---------------------------------------------------------------------------

/** 파트너 주문에 연결된 세션(주문번호 있음) */
export function isOrderLinked(item: Pick<StaffSessionItem, 'orderSeqno'>): boolean {
  return (
    typeof item.orderSeqno === 'number' && Number.isFinite(item.orderSeqno) && item.orderSeqno > 0
  );
}

export type OrderLinkedAction = 'open' | 'complete' | 'delete' | 'synthesize';

export interface OrderLinkedConfirmCopy {
  title: string;
  /** 작업이 파트너 주문에 미치는 영향 */
  effect: string;
  /** 사전·사후 통지 안내 */
  notice: string;
  /** 확인 체크박스 문구 — 체크해야 진행 버튼이 켜진다 */
  ackLabel: string;
  okText: string;
  danger: boolean;
}

const ORDER_LINKED_ACTIONS: Record<
  OrderLinkedAction,
  Pick<OrderLinkedConfirmCopy, 'title' | 'effect' | 'okText' | 'danger'>
> = {
  open: {
    title: '파트너 주문에 연결된 세션을 편집기에서 열까요?',
    effect:
      '저장하면 세션 내용이 바뀌고, 편집기에서 편집완료를 눌러야 새 PDF와 새 파일 id가 생깁니다. 파트너 주문은 고객 편집완료 때 받은 파일 id를 계속 쓰므로, 편집완료 뒤 통지 정보를 전달하지 않으면 파트너 재합성·다운로드에 관리자 수정분이 빠집니다.',
    okText: '편집기에서 열기',
    danger: false,
  },
  complete: {
    title: '파트너 주문에 연결된 세션을 완료 처리할까요?',
    effect:
      '세션을 편집완료 상태로 바꾸고 검증 등 후속 처리를 실행합니다. 표지·내지 PDF는 새로 만들지 않으므로, 편집기에서 수정했다면 여기서 완료하지 말고 편집기에서 편집완료를 누르세요(여기서 완료하면 파트너에 보낼 새 파일 id가 없습니다). 첨부 내지 자동 임포지션 등 후속 작업이 있는 상품은 첨부 내지 파일 id가 잠시 뒤 바뀔 수 있으니 작업이 끝난 뒤 통지 정보를 복사하세요.',
    okText: '완료 처리',
    danger: false,
  },
  delete: {
    title: '파트너 주문에 연결된 세션을 삭제할까요?',
    effect:
      '삭제하면 저장된 세션 id로 여는 재편집과 세션 기반 합성이 "세션을 찾을 수 없음"(404)이 됩니다. 파트너가 주문번호로 편집기를 열면 빈 새 세션이 만들어질 수 있습니다. 보관기간 안에는 [삭제 리스트]에서 복구할 수 있고, 통지 정보도 [삭제 리스트]에서 복사합니다.',
    okText: '삭제',
    danger: true,
  },
  synthesize: {
    title: '파트너 주문에 연결된 세션을 합성할까요?',
    effect:
      '관리자 합성 결과는 새 작업으로 보관되며 세션의 파일 id는 바뀌지 않습니다. 파트너 알림(기본 꺼짐)을 켜면 파트너 콜백·웹훅과 파트너 조회의 최신 합성 결과로 전달되며, 파트너 주문 반영 여부는 파트너 처리 방식에 따릅니다.',
    okText: '계속',
    danger: false,
  },
};

/** 통지 대상 표기 — 사이트명 → siteId → 사이트 없는 레거시 세션 */
function noticeTarget(item: Pick<StaffSessionItem, 'siteName' | 'siteId'>): string | null {
  return item.siteName || item.siteId || null;
}

/** 주문 연결 세션 확인 창 문구 */
export function orderLinkedConfirmCopy(
  action: OrderLinkedAction,
  item: Pick<StaffSessionItem, 'siteName' | 'siteId' | 'orderSeqno'>,
): OrderLinkedConfirmCopy {
  const target = noticeTarget(item);
  const order = item.orderSeqno ?? '-';
  // orderSeqno 는 파트너에 따라 실제 주문번호가 아니다(bookmoa: 장바구니 초안 id) — 파트너는 세션 id 로 주문을 찾는다.
  const notice = target
    ? `${target} 주문번호 ${order}가 붙은 세션입니다(파트너에 따라 장바구니 단계 번호일 수 있습니다). 작업 전에 세션 id를 넣어 ${target}에 알리면 파트너가 실제 주문 여부를 회신합니다. 작업을 마치면 [통지 정보 복사]로 세션 id·새 파일 id·시각(UTC)을 전달하세요.`
    : `주문번호 ${order}가 붙은 사이트 없는 이전 세션입니다. 통지할 파트너를 먼저 확인해 작업 전에 세션 id를 넣어 알리고, 작업을 마치면 [통지 정보 복사]로 세션 id·새 파일 id·시각(UTC)을 전달하세요.`;
  return {
    ...ORDER_LINKED_ACTIONS[action],
    notice,
    ackLabel: target ? `${target}에 사전 통지했습니다` : '해당 파트너에 사전 통지했습니다',
  };
}

/** 사후 통지 안내 — 주문 연결 세션 작업 성공 뒤 표시. 삭제는 행이 [삭제 리스트]로 옮겨 간다 */
export function orderLinkedAfterActionMessage(
  action: Exclude<OrderLinkedAction, 'synthesize'>,
  item: Pick<StaffSessionItem, 'siteName' | 'siteId'>,
): string {
  const target = noticeTarget(item) ?? '해당 파트너';
  if (action === 'delete') {
    return `파트너 주문 연결 세션을 삭제했습니다. [삭제 리스트]의 [통지 정보 복사]로 ${target}에 세션 id·삭제 시각(UTC)을 알리세요.`;
  }
  if (action === 'open') {
    return `파트너 주문 연결 세션입니다. 편집기에서 편집완료한 뒤 [통지 정보 복사]로 ${target}에 세션 id·새 파일 id·시각(UTC)을 알리세요.`;
  }
  return `파트너 주문 연결 세션입니다. 작업을 마치면 [통지 정보 복사]로 ${target}에 세션 id·파일 id·시각(UTC)을 알리세요.`;
}

/** ISO 초 단위 UTC (밀리초 제거). 해석 불가면 null */
export function toUtcIsoSeconds(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const NOTICE_STATUS_LABEL: Record<string, string> = {
  draft: '초안',
  editing: '편집중',
  complete: '편집완료',
};

/**
 * 파트너 사후 통지용 텍스트. 목록 행이 아니라 복사 직전에 다시 읽은 세션 값으로 만든다
 * (편집기 새 탭에서 편집완료하면 파일 id 가 바뀌므로).
 */
export function buildPartnerNoticeText(
  item: Pick<
    StaffSessionItem,
    | 'id'
    | 'siteId'
    | 'siteName'
    | 'orderSeqno'
    | 'status'
    | 'completedAt'
    | 'updatedAt'
    | 'deletedAt'
    | 'coverFileId'
    | 'contentFileId'
    | 'contentPdfFileId'
    | 'staffEditedAfterComplete'
  >,
  now: Date,
): string {
  const statusLabel = NOTICE_STATUS_LABEL[item.status] ?? item.status;
  const completedAt = toUtcIsoSeconds(item.completedAt);
  const deletedAt = toUtcIsoSeconds(item.deletedAt);
  const lines = [
    '[Storige 관리자 작업 통지]',
    `사이트: ${item.siteName || '-'}${item.siteId ? ` (${item.siteId})` : ''}`,
    `세션 주문번호(orderSeqno): ${item.orderSeqno ?? '-'}`,
    `세션 ID: ${item.id}`,
    `상태: ${deletedAt ? `삭제됨 (${deletedAt})` : statusLabel}`,
    `편집완료 시각(UTC): ${completedAt ?? '-'}`,
    `최종 수정 시각(UTC): ${toUtcIsoSeconds(item.updatedAt) ?? '-'}`,
    `표지 파일 ID: ${item.coverFileId || '-'}`,
    `내지 파일 ID: ${item.contentFileId || '-'}`,
    `첨부 내지 파일 ID: ${item.contentPdfFileId || '-'}`,
  ];
  if (item.staffEditedAfterComplete) {
    lines.push(
      '주의: 관리자 편집 뒤 편집완료가 되지 않아 위 파일 ID는 편집 전 PDF입니다. 편집기에서 편집완료 후 다시 복사하세요.',
    );
  }
  lines.push('작업 내용: (직접 기재)', `작성 시각(UTC): ${toUtcIsoSeconds(now) ?? '-'}`);
  return lines.join('\n');
}
