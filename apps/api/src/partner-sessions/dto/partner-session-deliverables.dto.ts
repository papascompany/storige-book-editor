import type { ProductCompleteSummary, ProductBackRotation, ProductDuplexFlip, SheetSpec } from '@storige/types';

/**
 * Partner API v1 — 1-call 런처(P2-b, 2026-10-18) 산출물 조회·재합성 응답 shape.
 * 정본: docs/PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md §8.1
 *
 * 내부 UUID 중 sessionId·jobId·fileId 는 호출 측이 후속 라우트(파일 다운로드·잡 조회)에 쓰므로 노출한다.
 * siteId·memberSeqno 는 비노출.
 */

/** 세션 산출 상태 — 세션 status + 파트너 가시 최신 SYNTHESIZE 잡 status 로 5단계 요약 */
export type PartnerSessionDeliverableStatus =
  | 'editing'
  | 'complete'
  | 'synthesizing'
  | 'ready'
  | 'failed';

export type PartnerSessionFileRole = 'single' | 'thumbnail' | 'sheet';

/** 파일 회수 인증 — 'api-key': 파트너 키(X-API-Key) 필요, 'signed': URL 자체 서명(TTL 안에서 무인증) */
export type PartnerSessionFileAuth = 'api-key' | 'signed';

export interface PartnerSessionFileView {
  role: PartnerSessionFileRole;
  /** 상대 URL — API origin 에 붙여 호출(signed 는 nginx /storage-signed/… 경로) */
  url: string;
  auth: PartnerSessionFileAuth;
  /** files.id — 편집기 산출 단일 PDF·썸네일(api-key 파일만) */
  fileId?: string;
  /** 잡 산출물(signed)만 — 산출 잡 id */
  jobId?: string;
  /** role='sheet' — 세트 순번(0-base, 편집기 페이지 순서). sheet-map 잡은 SheetSpec.index 와 같다 */
  sheetIndex?: number;
  pageCount?: number;
  /** P2-c(additive) role='sheet' + sheet-map 잡만 — 해당 시트 SheetSpec.copies(명시된 경우) */
  copies?: number;
  /** P2-c(additive) role='sheet' + sheet-map 잡만 — 해당 시트 SheetSpec.label(명시된 경우) */
  label?: string;
  /** ISO 8601 */
  generatedAt?: string;
  /** signed 만 — 서명 만료(ISO 8601) */
  expiresAt?: string;
}

export interface PartnerSessionProductView extends ProductCompleteSummary {
  duplexFlip: ProductDuplexFlip;
  backRotation: ProductBackRotation;
}

export interface PartnerSessionCalendarView {
  /** 'YYYY-MM' */
  startYm: string;
  dataVersion: string | null;
}

/** GET /api/v1/sessions/:id/deliverables 응답 data */
export interface PartnerSessionDeliverablesView {
  sessionId: string;
  status: PartnerSessionDeliverableStatus;
  /** 산출 회차(완료·재합성마다 +1, 런처 세션은 0 에서 시작) */
  revision: number;
  orderSeqno: number;
  /** 템플릿셋 productProfile(없으면 세션 스냅샷) 요약. NULL 세트(프로파일 없음)는 null */
  product: PartnerSessionProductView | null;
  calendar: PartnerSessionCalendarView | null;
  files: PartnerSessionFileView[];
  /**
   * P2-c(2026-10-18, additive) 최신 파트너 가시 합성 잡이 `options.mode==='sheet-map'` 일 때만 — API 가 잡 발행 시
   * 저장한 시트 앞/뒤 매핑(SheetSpec[], 0-base 페이지·회전·단면 null). duplex-split·잡 없음이면 키 없음.
   */
  sheets?: SheetSpec[];
  /** 세션 metadata.production 그대로(없으면 키 없음) */
  production?: unknown;
}

/** POST /api/v1/sessions/:id/synthesize 응답 data */
export interface PartnerSessionSynthesizeView {
  jobId: string;
  revision: number;
}
