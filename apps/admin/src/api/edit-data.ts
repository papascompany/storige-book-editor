import type { AxiosResponse } from 'axios';
import { axiosInstance } from '../lib/axios';

/**
 * 관리자 편집데이터 관리 API 클라이언트 (2026-09-29) — /api/admin/edit-data/*.
 *
 * 관리자 JWT 전용 라우트. 사이트 스코프(SITE_ADMIN/SITE_MANAGER)는 서버가 강제하며,
 * 이 클라이언트의 siteId 는 필터 파라미터일 뿐이다.
 * 편집기용 토큰(openEditorSession 응답)은 세션 1건 전용 단기 권한이며 관리자 JWT 와 무관하다.
 */

const BASE = '/admin/edit-data';

// ---------------------------------------------------------------------------
// 계약 타입
// ---------------------------------------------------------------------------

export type RetentionState = 'unset' | 'active' | 'expired';

export interface RetentionInfo {
  /** 사이트 편집데이터 보관기간(일). null = 미설정 */
  days: number | null;
  /** 보관 종료 시각(ISO). 미설정이면 null */
  until: string | null;
  state: RetentionState;
  anchor: 'createdAt';
}

/** 서버 실값 — file_edit_sessions.status */
export type StaffSessionStatus = 'draft' | 'editing' | 'complete';

export interface StaffOrderMeta {
  productName?: string | null;
  title?: string | null;
  quantity?: number | string | null;
  /** 서버 매핑 형식이 문자열 또는 {width,height} 일 수 있어 둘 다 허용한다 */
  size?: string | { width?: number | null; height?: number | null } | null;
}

export interface StaffSessionItem {
  id: string;
  siteId: string | null;
  siteName: string | null;
  orderSeqno: number | null;
  memberSeqno: number | null;
  memberId: string | null;
  orderMeta: StaffOrderMeta | null;
  isGuest: boolean;
  status: StaffSessionStatus;
  mode: string;
  templateSetId: string | null;
  templateSetName: string | null;
  coverFileId: string | null;
  contentFileId: string | null;
  contentPdfFileId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  deletedAt: string | null;
  retention: RetentionInfo;
  /** 관리자 편집(session.update) 이후 편집완료가 되지 않음 → 합성 시 OUTPUT_STALE */
  staffEditedAfterComplete: boolean;
  /** 현재 관리자·이 세션 사이트 기준 삭제/복구 가능 여부(서버 판정) */
  canDelete: boolean;
}

export type SessionDeletedFilter = 'exclude' | 'only' | 'include';

export interface StaffSessionListParams {
  siteId?: string;
  status?: StaffSessionStatus;
  orderSeqno?: number;
  memberSeqno?: number;
  retention?: RetentionState;
  deleted?: SessionDeletedFilter;
  page?: number;
  /** 서버 상한 100 */
  limit?: number;
}

export interface StaffSessionListResponse {
  items: StaffSessionItem[];
  total: number;
  page: number;
  limit: number;
}

export interface StaffJobItem {
  id: string;
  jobType: string;
  status: string;
  capability: string | null;
  staffInitiated: boolean;
  createdAt: string;
  completedAt: string | null;
  hasOutput: boolean;
}

export interface StaffGrantItem {
  id: string;
  operatorId: string;
  issuedByUserId: string | null;
  capabilities: string[];
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface OpenEditorSessionBody {
  allowDelete?: boolean;
  /** 300..28800, 서버 기본 3600 */
  ttlSeconds?: number;
  reason?: string;
}

export interface EditorSessionResponse {
  success: boolean;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  grantId: string;
  grantExpiresAt: string;
  capabilities: string[];
  sessionId: string;
  /** '/embed?sessionId=<id>&adminEdit=session' — 토큰은 포함하지 않는다 */
  editorPath: string;
}

export type SynthesizeOutputMode = 'separate' | 'content-only' | 'single';

export interface SynthesizeBody {
  outputMode?: SynthesizeOutputMode;
  notifyPartner?: boolean;
  allowStale?: boolean;
  reason?: string;
}

export interface SynthesizeResponse {
  success: boolean;
  job: { id: string; status: string; jobType: string };
}

export interface RetentionReportSite {
  siteId: string | null;
  siteName?: string | null;
  editRetentionDays?: number | null;
  total: number;
  active: number;
  expired: number;
  expiredDeleted: number;
  unset: number;
  purge: 'disabled';
}

export interface StaffAuditItem {
  id?: string;
  siteId: string | null;
  sessionId: string | null;
  operatorId: string;
  actorUserId: string | null;
  action: string;
  route: string | null;
  statusCode: number | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface StaffAuditParams {
  siteId?: string;
  sessionId?: string;
  /** 서버 상한 200 */
  limit?: number;
  /** ISO — 이 시각 이전 행 */
  before?: string;
}

export type SessionFileKind = 'cover' | 'content' | 'contentPdf';

export interface DownloadedFile {
  blob: Blob;
  /** Content-Disposition 에서 얻은 파일명(없으면 null) */
  filename: string | null;
}

/** 계약 오류 코드 (adminOpsContract) + 결과물 스트리밍 공용 코드 */
export type ApiErrorCode =
  | 'STAFF_ROLE_REQUIRED'
  | 'STAFF_DELETE_NOT_ALLOWED'
  | 'SESSION_NOT_FOUND'
  | 'GRANT_NOT_FOUND'
  | 'JOB_NOT_FOUND'
  | 'EDIT_RETENTION_EXPIRED'
  | 'STAFF_SESSION_SITE_REQUIRED'
  | 'SESSION_DELETED'
  | 'SESSION_ALREADY_COMPLETE'
  | 'OUTPUT_STALE'
  | 'SESSION_ASSEMBLY_INCOMPLETE'
  | 'STAFF_AUDIT_UNAVAILABLE'
  | 'STAFF_BASELINE_UNAVAILABLE'
  | 'PARTNER_OPERATOR_UNAVAILABLE'
  | 'JOB_NOT_COMPLETED'
  | 'OUTPUT_NOT_FOUND'
  | 'FILE_NOT_ON_DISK'
  | 'TENANT_FORBIDDEN'
  | 'FILE_NOT_FOUND'
  | 'STREAM_ERROR';

// ---------------------------------------------------------------------------
// 내부 유틸
// ---------------------------------------------------------------------------

function toQuery(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    sp.append(key, String(value));
  }
  const q = sp.toString();
  return q ? `?${q}` : '';
}

/** 목록 응답이 배열 또는 { items } / { data } 래핑 중 무엇이든 배열로 정규화 */
function toList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const obj = data as { items?: unknown; data?: unknown; sites?: unknown };
    if (Array.isArray(obj.items)) return obj.items as T[];
    if (Array.isArray(obj.data)) return obj.data as T[];
    if (Array.isArray(obj.sites)) return obj.sites as T[];
  }
  return [];
}

function readContentDispositionFilename(res: AxiosResponse<Blob>): string | null {
  const raw: unknown = res.headers?.['content-disposition'];
  if (typeof raw !== 'string' || !raw) return null;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(raw);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      // fall through to plain filename
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(raw);
  return plain?.[1]?.trim() || null;
}

/**
 * blob 응답의 오류 본문은 Blob 으로 오므로 JSON 으로 복원해 error.response.data 에 되돌린다
 * (호출부가 code/message 를 일관되게 읽도록).
 */
async function getBlob(url: string): Promise<DownloadedFile> {
  try {
    const res = await axiosInstance.get<Blob>(url, { responseType: 'blob' });
    return { blob: res.data, filename: readContentDispositionFilename(res) };
  } catch (err: unknown) {
    const response = (err as { response?: { data?: unknown } } | null)?.response;
    if (response && typeof Blob !== 'undefined' && response.data instanceof Blob) {
      try {
        const text = await response.data.text();
        response.data = JSON.parse(text) as unknown;
      } catch {
        // 본문이 JSON 이 아니면 그대로 둔다
      }
    }
    throw err;
  }
}

/** 브라우저 다운로드 트리거 (blob → a[download]) */
export function saveDownloadedFile(file: DownloadedFile, fallbackName: string): void {
  const url = window.URL.createObjectURL(file.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename || fallbackName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// 13개 라우트
// ---------------------------------------------------------------------------

export const editDataApi = {
  /** 1. GET /sessions — 서버 페이지네이션 */
  async listSessions(params: StaffSessionListParams = {}): Promise<StaffSessionListResponse> {
    const r = await axiosInstance.get<StaffSessionListResponse>(
      `${BASE}/sessions${toQuery({
        siteId: params.siteId,
        status: params.status,
        orderSeqno: params.orderSeqno,
        memberSeqno: params.memberSeqno,
        retention: params.retention,
        deleted: params.deleted,
        page: params.page,
        limit: params.limit,
      })}`,
    );
    const data = r.data;
    return {
      items: toList<StaffSessionItem>(data),
      total: typeof data?.total === 'number' ? data.total : 0,
      page: typeof data?.page === 'number' ? data.page : params.page ?? 1,
      limit: typeof data?.limit === 'number' ? data.limit : params.limit ?? 20,
    };
  },

  /** 2. GET /sessions/:id/jobs */
  async listJobs(sessionId: string): Promise<StaffJobItem[]> {
    const r = await axiosInstance.get<unknown>(
      `${BASE}/sessions/${encodeURIComponent(sessionId)}/jobs`,
    );
    return toList<StaffJobItem>(r.data);
  },

  /** 3. GET /jobs/:jobId/output — 스코프 검사된 결과물 스트림 */
  downloadJobOutput(jobId: string): Promise<DownloadedFile> {
    return getBlob(`${BASE}/jobs/${encodeURIComponent(jobId)}/output`);
  },

  /** 4. GET /sessions/:id/files/:kind — 세션이 직접 참조하는 입력 파일 */
  downloadSessionFile(sessionId: string, kind: SessionFileKind): Promise<DownloadedFile> {
    return getBlob(
      `${BASE}/sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(kind)}`,
    );
  },

  /** 5. POST /sessions/:id/editor-session — 세션 1건 전용 단기 편집 권한 발급 */
  async openEditorSession(
    sessionId: string,
    body: OpenEditorSessionBody = {},
  ): Promise<EditorSessionResponse> {
    const r = await axiosInstance.post<EditorSessionResponse>(
      `${BASE}/sessions/${encodeURIComponent(sessionId)}/editor-session`,
      body,
    );
    return r.data;
  },

  /** 6. GET /sessions/:id/grants — 관리자 발급 편집 권한 */
  async listGrants(sessionId: string): Promise<StaffGrantItem[]> {
    const r = await axiosInstance.get<unknown>(
      `${BASE}/sessions/${encodeURIComponent(sessionId)}/grants`,
    );
    return toList<StaffGrantItem>(r.data);
  },

  /** 7. POST /grants/:grantId/revoke (멱등) */
  async revokeGrant(grantId: string): Promise<void> {
    await axiosInstance.post(`${BASE}/grants/${encodeURIComponent(grantId)}/revoke`);
  },

  /** 8. POST /sessions/:id/complete */
  async complete(sessionId: string): Promise<void> {
    await axiosInstance.post(`${BASE}/sessions/${encodeURIComponent(sessionId)}/complete`);
  },

  /** 9. DELETE /sessions/:id — 소프트 삭제(보관기간 만료 후에도 허용) */
  async remove(sessionId: string): Promise<void> {
    await axiosInstance.delete(`${BASE}/sessions/${encodeURIComponent(sessionId)}`);
  },

  /** 10. POST /sessions/:id/restore (멱등) */
  async restore(sessionId: string): Promise<void> {
    await axiosInstance.post(`${BASE}/sessions/${encodeURIComponent(sessionId)}/restore`);
  },

  /** 11. POST /sessions/:id/synthesize — 항상 새 잡을 만든다(재합성 = 재호출) */
  async synthesize(sessionId: string, body: SynthesizeBody = {}): Promise<SynthesizeResponse> {
    const r = await axiosInstance.post<SynthesizeResponse>(
      `${BASE}/sessions/${encodeURIComponent(sessionId)}/synthesize`,
      body,
    );
    return r.data;
  },

  /** 12. GET /retention-report — 읽기 전용 */
  async retentionReport(siteId?: string): Promise<RetentionReportSite[]> {
    const r = await axiosInstance.get<unknown>(`${BASE}/retention-report${toQuery({ siteId })}`);
    return toList<RetentionReportSite>(r.data);
  },

  /** 13. GET /audit — 관리자(origin='staff') 감사 기록 */
  async audit(params: StaffAuditParams = {}): Promise<StaffAuditItem[]> {
    const r = await axiosInstance.get<unknown>(
      `${BASE}/audit${toQuery({
        siteId: params.siteId,
        sessionId: params.sessionId,
        limit: params.limit,
        before: params.before,
      })}`,
    );
    return toList<StaffAuditItem>(r.data);
  },
};
