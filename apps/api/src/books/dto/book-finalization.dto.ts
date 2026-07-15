import type { BookFinalizationStatus } from '../books.constants';

/**
 * 최종화 노출 shape — Partner API v1 Stage 3 W3.
 *
 * 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §2.6·§6.3
 *
 * - 폴링 표면 GET /api/v1/books/:uid/finalization + POST 응답 공용.
 * - 내부 UUID(id)·validate_job_id·compose_job_id 는 비노출(내부 오케스트레이션 은닉, §2.0).
 * - outputFileId(files.id)는 노출 — GET /api/v1/books/:uid/pdf 로 소유검증 스트림(§9-10).
 * - status/errorCode 로 분기(파트너 계약: message 문자열 파싱 금지, §3.2).
 */
export interface BookFinalizationView {
  /** 최종화 이력 외부 식별자 'fin_...' */
  uid: string;
  /** 도서 외부 식별자 'bk_...' */
  bookUid: string;
  status: BookFinalizationStatus;
  /** 실패 후 재시도 이력(FAILED 재호출 시 +1) */
  attempt: number;
  /** 확정 페이지 수 — COMPLETED 시 채움 */
  pageCount: number | null;
  /**
   * [P1-2] 워커 validate 를 건너뛰고 최종화(예정)됨 — book_spec 미연결 or pageCount
   * 미확정으로 대조 판형이 없어 조건부 validate 를 skip 했을 때 true(§6.3 조건부 계약).
   * 파트너는 이 플래그로 미검증 FINALIZED 를 인지하고 자체 게이팅한다.
   */
  validationSkipped: boolean;
  /** 최종 PDF files.id — GET /api/v1/books/:uid/pdf 로 소유검증 후 스트림 */
  outputFileId: string | null;
  /** 실패 시 ERR_* (§3 카탈로그) */
  errorCode: string | null;
  /** 검증 errors/warnings 스냅샷(FAILED 진단) */
  errorDetail: Record<string, unknown> | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}
