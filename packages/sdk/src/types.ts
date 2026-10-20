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
  /**
   * FAILED 진단 — 분기는 errorCode 로 하고 이 값은 진단용이다.
   *  - 검증·합성 잡 실패: `{ stage: 'validate'|'compose', jobStatus, jobErrorCode, result }`. jobErrorCode 는
   *    잡의 오류 코드(예: `PDF_LOAD_FAILED`·`JOB_STALLED`, 없으면 null). result 는 검증 잡이면
   *    `{ errors, warnings }`(각 항목 `code`·`message`·`autoFixable`·`fixMethod`), 그 밖에는 null.
   *  - 내부 처리 실패: `{ code, reason }` — code 는 `TRANSITION_FAILED`·`OUTPUT_URL_MISSING`·
   *    `OUTPUT_REGISTER_FAILED`, reason 은 코드별 고정 문구.
   */
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

// ── sessions (런처 3라우트 — 2026-10-18 ADDITIVE, CONTRACT_FREEZE v1.23) ─────

/**
 * 런처 편집 모드. 생략 시 'both'.
 *
 * 세션 생성 시 템플릿셋 기준으로 고정되며, `/embed` 진입 뒤에는 바꿀 수 없다.
 */
export type SessionLaunchMode = 'both' | 'cover' | 'content';

/** POST /api/v1/sessions/launch 입력 */
export interface SessionLaunchInput {
  /** 파트너 회원 식별 — seqno 는 1 이상 정수(회원 경로, §1-D v1.7 규칙) */
  member: {
    seqno: number;
    id: string;
    name: string;
  };
  /** 편집에 쓸 템플릿셋. 사이트 스코프 또는 hybrid(NULL) 세트만 허용 */
  templateSetId: string;
  /** 파트너 주문번호(1 이상 정수). 있으면 세션·산출물·웹훅에 echo-back */
  orderSeqno?: number;
  /** 기본 'both' */
  mode?: SessionLaunchMode;
  /** https 만. 세션 단위 완료 콜백(사이트 웹훅 config 와 별개) */
  callbackUrl?: string;
  /** 자유형 주문 옵션 — 서버는 shape 을 고정하지 않는다 */
  orderOptions?: Record<string, unknown>;
  /** 최대 500 항목. shape 은 템플릿셋 프로파일이 정한다 */
  items?: unknown[];
  /** 캘린더 프로파일 세트 전용 — 시작 연월 'YYYY-MM' */
  calendar?: { startYm: string };
  /** 최대 500 항목 — 외부 사진 참조 */
  externalPhotos?: unknown[];
}

/**
 * POST /api/v1/sessions/launch 응답(201).
 *
 * `embed` 는 그대로 `@storige/sdk/embed` `mountEditor({ params })` 에 넣을 수 있는
 * 동결 파라미터 집합이다(`sessionId`+`token`+`refreshToken`(+`orderSeqno`) — 신규
 * URL 파라미터 0). 호스트는 여기에 `parentOrigin` 만 더해 `/embed` 로 진입한다.
 */
export interface SessionLaunchResult {
  sessionId: string;
  /** 세션 전용 access token — 편집기 iframe 이 쓴다. 파트너 서버 API 키가 아니다 */
  accessToken: string;
  refreshToken: string;
  /** access token 수명(초). 현재 3600 고정 */
  expiresIn: number;
  embed: {
    sessionId: string;
    token: string;
    refreshToken: string;
    orderSeqno?: number;
  };
}

/**
 * 산출물 상태.
 *
 * - editing      — 편집 중(완료 이벤트 전)
 * - complete     — 편집 완료, 합성 전(또는 합성 대상 아님)
 * - synthesizing — 합성 잡 진행 중
 * - ready        — 최종 산출물 사용 가능
 * - failed       — 합성 실패(예외가 아니라 값 — `production`·`files` 로 진단)
 */
export type SessionDeliverableStatus =
  | 'editing'
  | 'complete'
  | 'synthesizing'
  | 'ready'
  | 'failed';

/** `ready`·`failed` — `waitForDeliverables({ until: 'ready' })` 탈출 조건 */
export const TERMINAL_DELIVERABLE_STATUSES: readonly SessionDeliverableStatus[] = [
  'ready',
  'failed',
];

/** `files[].role` — 템플릿셋 프로파일·pdfOutputMode 에 따라 조합이 달라진다 */
export type DeliverableFileRole = 'single' | 'cover' | 'content' | 'sheet' | 'face' | 'thumbnail';

/**
 * `files[].url` 접근 방식.
 *
 * - api-key — 같은 X-API-Key 로 GET(파트너 서버가 받는다)
 * - signed  — 서명 URL(300초). 브라우저·외부 다운로드에 그대로 전달 가능하나 만료 뒤엔
 *             deliverables 를 재조회해 새 URL 을 받아야 한다
 */
export type DeliverableFileAuth = 'api-key' | 'signed';

/** GET /api/v1/sessions/{id}/deliverables `files[]` 항목 */
export interface DeliverableFile {
  role: DeliverableFileRole;
  /** files.id — 저장소 파일 핸들(있을 때만) */
  fileId?: string;
  /** 생성 잡 id(합성 산출물일 때만) */
  jobId?: string;
  url: string;
  auth: DeliverableFileAuth;
  pageCount?: number;
  /** role 'sheet'·'face' — 0-base 낱장 순번 */
  sheetIndex?: number;
  copies?: number;
  /** ISO 8601 */
  generatedAt?: string;
  /** 서명 URL 만료 시각(auth 'signed' 파일) */
  expiresAt?: string;
}

/**
 * 상품 요약 — 템플릿셋 `productProfile` 이 있는 세트에서만(없으면 null).
 * `editor.complete` payload 의 `product` 키와 같은 shape(§1-D v1.22) + 양면 옵션.
 */
export interface SessionDeliverablesProduct {
  kind: 'sheet' | 'calendar' | (string & {});
  editorType: string;
  canvasCount: number;
  sheetCount: number;
  faces: 1 | 2;
  /** 양면 세트 — 뒷면 뒤집기 방식(프로파일 값 그대로) */
  duplexFlip: 'short-edge' | 'long-edge';
  /** 양면 세트 — 뒷면 회전(도) */
  backRotation: 0 | 180;
}

/**
 * 사진인화 세트의 사진 항목 1건(= 주문 항목 1건) — ADDITIVE 2026-10-19 P2-d(v1.25).
 * 서버 정본 `@storige/types` `PhotoItem` 과 동형(드리프트는 types-parity.spec 이 감시).
 * 편집 세션 `metadata.items` 를 서버가 템플릿셋 프로파일로 정제한 완전형이다 — `sizeCode` 는
 * 세션 사이즈(P2: `sizes[0].code`) 고정, `copies` 는 프로파일 범위로 클램프된 값.
 * sheet-map 세트의 `files[].copies`/`label('사진 N')` 의 원천도 이 항목이다.
 */
export interface SessionDeliverablesItem {
  /** 항목 순번(0부터) */
  index: number;
  /** 앞면 캔버스 인덱스 — chemical i, digital 2i */
  canvasIndex: number;
  /** 업로드 레코드·외부 사진 id(있을 때만 키 존재) */
  sourcePhotoId?: string;
  sizeCode: string;
  /** 1 이상 정수 */
  copies: number;
  border: 'none' | 'white';
  fit: 'paper-full' | 'image-full';
  finish: 'matte' | 'glossy';
  brightnessFix: boolean;
  dateOverlay: boolean;
  grayscale: boolean;
  /** 프로파일 minDpi 미달 경고(완료 차단 없음 — 호스트 판단) */
  lowRes: boolean;
}

/** GET /api/v1/sessions/{id}/deliverables 응답 */
export interface SessionDeliverables {
  sessionId: string;
  /** launch 때 준 값. 없으면 null */
  orderSeqno: number;
  /** 합성 세대 — synthesize 마다 +1. 웹훅 `synthesis.*` 의 `revision` 과 대조 */
  revision: number;
  status: SessionDeliverableStatus;
  product: SessionDeliverablesProduct | null;
  /** 캘린더 프로파일 세트 전용 */
  calendar: {
    startYm: string;
    dataVersion: string | null;
  } | null;
  /**
   * 사진인화(`product.kind 'photo-print'`) 세트에서만 — 세션 `metadata.items` 의 서버 정제본(v1.25).
   * 그 밖의 세트에서는 키 없음. launch `items` 는 기록만 되고 그대로 echo 되지 않는다.
   */
  items?: SessionDeliverablesItem[];
  /** 낱장 세트 — 시트 단위 메타(서버가 shape 을 고정하지 않는다) */
  sheets?: unknown[];
  files: DeliverableFile[];
  /** 제작 단계 메모(운영자 기록) — 없으면 키 없음 */
  production?: {
    status: string;
    note: string | null;
    /** ISO 8601 */
    updatedAt: string;
  };
}

/** POST /api/v1/sessions/{id}/synthesize 응답(201) */
export interface SessionSynthesizeResult {
  /** 합성 잡 id — 웹훅 `synthesis.*` 의 `jobId` 와 같다 */
  jobId: string;
  /** 이 호출로 올라간 합성 세대 — 웹훅 `revision` 과 같다 */
  revision: number;
}
