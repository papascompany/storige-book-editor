/**
 * v1 도메인 노출 타입 — 서버 view shape 미러(파트너 대면 표면만).
 *
 * 서버 정본: apps/api/src/{books,book-specs}/dto/*.ts,
 * apps/api/src/webhook/v2/{webhook-config,webhook-delivery}.service.ts
 *
 * ⚠️ 날짜 필드는 전부 **ISO 8601 문자열**이다. 서버 인터페이스 일부(웹훅 view)는
 *    `Date` 로 선언돼 있으나 JSON 직렬화를 거치면 문자열이 된다 — SDK 는 서버의
 *    내부 타입이 아니라 **wire 계약**을 반영한다.
 *
 * ⚠️ 내부 UUID(id)·siteId·job id 는 v1 표면에 노출되지 않는다(§2.0 uid 접두 체계).
 */

// ── 공통 ────────────────────────────────────────────────────────────────

/** 키에 내재된 환경 — SDK 파라미터가 아니다(키가 곧 env) */
export type PartnerEnv = 'test' | 'live';

// ── ping ────────────────────────────────────────────────────────────────

/** GET /api/v1/ping */
export interface PingView {
  pong: true;
  /** ISO 8601 */
  serverTime: string;
}

// ── book-specs (§1.2) ───────────────────────────────────────────────────

/** 판형 마스터 — 내부 id·siteId 비노출 */
export interface BookSpecView {
  /** 'bs_...' */
  uid: string;
  name: string;
  coverType: string;
  bindingType: string;
  orientation: 'portrait' | 'landscape';
  innerTrimWidthMm: number;
  innerTrimHeightMm: number;
  bleedMm: number;
  sizeToleranceMm: number;
  pageMin: number;
  pageMax: number;
  pageIncrement: number;
  defaultPaperCode: string | null;
  isActive: boolean;
}

export interface BookSpecListQuery {
  coverType?: string;
  bindingType?: string;
  /** 미지정 시 활성 판형만 노출(외부 대면 기본) */
  isActive?: boolean;
  /** 기본 20. 100 초과값은 서버가 100으로 캡(에러 아님) */
  limit?: number;
  offset?: number;
}

/**
 * 페이지 수 기반 실측 mm — 이 값대로 PDF 를 제작하면 워커 사이즈 검증을
 * ±sizeToleranceMm 내에서 통과한다.
 */
export interface CalculatedSizeView {
  bookSpecUid: string;
  pageCount: number;
  sizeToleranceMm: number;
  bleedMm: number;
  inner: {
    trimWidthMm: number;
    trimHeightMm: number;
    workWidthMm: number;
    workHeightMm: number;
  };
  /** 책등 — 계수 미구성 시 null + warnings */
  spine: {
    widthMm: number;
    paperThicknessMm: number;
    bindingMarginMm: number;
    formula: string;
  } | null;
  /** 표지 펼침면(앞+책등+뒤) — spine 미계산 시 null + warnings */
  cover: {
    trimWidthMm: number;
    trimHeightMm: number;
    workWidthMm: number;
    workHeightMm: number;
  } | null;
  warnings: Array<{ code: string; message: string }>;
}

// ── books (§2.4~2.6·§6) ─────────────────────────────────────────────────

/**
 * 생성 유형 4종.
 *
 * ⚠️ SDK v0.1 이 자산 바인딩 라우트를 제공하는 것은 PDF_UPLOAD 뿐이다.
 *    TEMPLATE·MIX_COVER_TEMPLATE 은 서버측 바인딩(cover/contents) 라우트가
 *    미구현이라 최종화 시 422 TEMPLATE_COVER_NOT_RENDERED 로 막힌다(서버 Stage 5).
 *    EDITOR_SESSION 은 세션 산출물이 자동 연결되므로 수동 자산 투입이 없다.
 */
export type BookCreationType =
  | 'PDF_UPLOAD'
  | 'TEMPLATE'
  | 'MIX_COVER_TEMPLATE'
  | 'EDITOR_SESSION';

export type BookStatus = 'DRAFT' | 'FINALIZED';

/** 자산 유형 5종 */
export type BookAssetType =
  | 'pdf_cover'
  | 'pdf_contents'
  | 'photo'
  | 'cover_binding'
  | 'contents_binding';

/** active=현행, replaced=교체 이력 보존 */
export type BookAssetStatus = 'active' | 'replaced';

export type BookFinalizationStatus =
  | 'PENDING'
  | 'VALIDATING'
  | 'COMPOSING'
  | 'COMPLETED'
  | 'FAILED';

/** 최종화 종료 상태 — 폴링 루프 탈출 조건 */
export const TERMINAL_FINALIZATION_STATUSES: readonly BookFinalizationStatus[] = [
  'COMPLETED',
  'FAILED',
];

/** POST /api/v1/books 입력 */
export interface CreateBookInput {
  creationType: BookCreationType;
  /** 'bs_...'. 생략 시 판형 미연결 DRAFT(최종화 시 validate skip 가능) */
  bookSpecUid?: string;
  /** 양의 정수. 생략 시 최종화에서 확정 */
  pageCount?: number;
  /** EDITOR_SESSION 승격 원본 세션 참조 */
  sessionId?: string;
  /** TEMPLATE/MIX_COVER_TEMPLATE 바인딩 templateSet */
  templateSetId?: string;
  title?: string;
  /** 파트너측 자체 참조 ID(자유) */
  partnerRef?: string;
}

export interface BookView {
  /** 'bk_...' */
  uid: string;
  env: PartnerEnv;
  creationType: BookCreationType;
  status: BookStatus;
  /** 미연결 시 null */
  bookSpecUid: string | null;
  pageCount: number | null;
  title: string | null;
  partnerRef: string | null;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  updatedAt: string;
  /** ISO 8601 */
  finalizedAt: string | null;
}

export interface BookListQuery {
  status?: BookStatus;
  creationType?: BookCreationType;
  limit?: number;
  offset?: number;
}

export interface BookAssetView {
  assetType: BookAssetType;
  /** files.id — 파트너 파일 핸들 */
  fileId: string | null;
  sortOrder: number;
  status: BookAssetStatus;
  /** ISO 8601 */
  createdAt: string;
}

export interface BookFinalizationView {
  /** 'fin_...' */
  uid: string;
  /** 'bk_...' */
  bookUid: string;
  status: BookFinalizationStatus;
  /** FAILED 재호출 시 +1 */
  attempt: number;
  /** COMPLETED 시 확정 */
  pageCount: number | null;
  /**
   * 대조 판형이 없어(book_spec 미연결 or pageCount 미확정) 워커 validate 를
   * 건너뛰고 최종화됐다 — 파트너는 이 플래그로 미검증 FINALIZED 를 인지하고
   * 자체 게이팅한다.
   */
  validationSkipped: boolean;
  /** 최종 PDF files.id — books.downloadPdf(uid) 로 스트림 */
  outputFileId: string | null;
  /** 실패 시 ERR_* — message 가 아니라 이 코드로 분기 */
  errorCode: string | null;
  /** 검증 errors/warnings 스냅샷(FAILED 진단) */
  errorDetail: Record<string, unknown> | null;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  startedAt: string | null;
  /** ISO 8601 */
  completedAt: string | null;
}

// ── webhooks (§1.5) ─────────────────────────────────────────────────────

export type WebhookConfigStatus = 'active' | 'disabled';

export interface WebhookConfigView {
  url: string;
  env: PartnerEnv;
  events: string[];
  status: WebhookConfigStatus;
  /** secret 앞 일부 마스킹 — 대조 확인용 */
  secretPrefix: string;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  updatedAt: string;
  /**
   * 생성/회전 응답에만 존재하는 **1회 노출** 값 — 재조회 불가.
   * 받은 즉시 안전한 저장소에 보관해야 한다.
   */
  secret?: string;
}

export interface PutWebhookConfigInput {
  /** 사이트 등록 도메인만 허용(위반 시 422 ERR_WEBHOOK_URL_FORBIDDEN) */
  url: string;
  /** 미지정/빈 배열 = 전체 구독 */
  events?: string[];
  /** true 면 secret 재발급 — 응답에 신규 secret 1회 노출 */
  rotateSecret?: boolean;
}

export type WebhookDeliveryStatus = 'PENDING' | 'DELIVERED' | 'RETRYING' | 'EXHAUSTED';

export interface WebhookDeliveryView {
  uid: string;
  event: string;
  env: PartnerEnv;
  status: WebhookDeliveryStatus;
  isTest: boolean;
  attempts: number;
  lastStatusCode: number | null;
  /** 응답 본문이 아니라 간략 사유 코드만 노출(성공/미시도 = null) */
  lastFailureReason: string | null;
  /** ISO 8601 */
  nextRetryAt: string | null;
  /** ISO 8601 */
  deliveredAt: string | null;
  /** ISO 8601 */
  createdAt: string;
  /** 상세 조회에서만 — 발송 당시 페이로드 */
  payload?: unknown;
}

export interface WebhookDeliveryListQuery {
  event?: string;
  status?: WebhookDeliveryStatus;
  /** ISO 8601 — 이후 생성분만. 파싱 불가 값은 400 */
  since?: string | Date;
  limit?: number;
  offset?: number;
}
