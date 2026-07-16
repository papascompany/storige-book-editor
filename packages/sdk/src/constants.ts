/**
 * v1 계약 상수 — 서버 실측값 미러.
 *
 * 각 상수에 서버 정본 위치를 명기한다. 서버가 값을 바꾸면 여기도 바꿔야 하는
 * 수작업 미러이므로, 파트너 대면 의미가 있는 값만 최소로 둔다.
 */

// ── 업로드 상한(S-2) ────────────────────────────────────────────────────

/**
 * 직접(멀티파트) 업로드 상한 100MB.
 * 정본: apps/api/src/books/books.constants.ts:19 BOOK_ASSET_DIRECT_UPLOAD_MAX_BYTES
 * (multer limits.fileSize 로도 강제 — 초과 시 413 ERR_FILE_TOO_LARGE)
 */
export const DIRECT_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

/**
 * presigned 업로드 표면 상한 2GB — 초과분 자산은 이 경로로 올린 뒤 fileId 참조.
 * 정본: apps/api/src/files/presigned-upload.service.ts:37 MAX_EXPECTED_SIZE
 */
export const PRESIGNED_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * 편집기가 presigned 로 전환하는 임계 50MB — **참조용**(SDK 는 강제하지 않음).
 * 정본: apps/editor/src/api/storage.ts:8 PRESIGNED_THRESHOLD
 */
export const EDITOR_PRESIGNED_THRESHOLD_BYTES = 50 * 1024 * 1024;

/**
 * 직접 업로드 허용 MIME — PDF 단독.
 * 정본: apps/api/src/books/books.constants.ts BOOK_ASSET_DIRECT_UPLOAD_MIME
 *
 * ⚠️ photo 자산도 이 필터를 통과해야 한다 — 즉 이미지를 멀티파트로 직접 올리면
 *    415 다. 사진은 사실상 fileId 참조 경로 전용(README·addPhoto 주석 참조).
 */
export const DIRECT_UPLOAD_ALLOWED_MIME: readonly string[] = ['application/pdf'];

// ── 레이트리밋(§5.2) ────────────────────────────────────────────────────

/**
 * general 버킷 기본 300 req/min (per API Key).
 * 정본: apps/api/src/partner-api/partner-api.config.ts (PARTNER_API_RATE_LIMIT_GENERAL_PER_MIN)
 */
export const RATE_LIMIT_GENERAL_PER_MIN = 300;

/**
 * heavy 버킷(업로드/최종화/PDF 다운로드) 기본 100 req/min (per API Key).
 * 정본: apps/api/src/partner-api/partner-api.config.ts (PARTNER_API_RATE_LIMIT_HEAVY_PER_MIN)
 */
export const RATE_LIMIT_HEAVY_PER_MIN = 100;

/**
 * 429 Retry-After 폴백(초) — 헤더 부재/파싱불가 시 사용.
 * 정본: apps/api/src/partner-api/partner-api.constants.ts RETRY_AFTER_FALLBACK_SECONDS
 *
 * ⚠️ 서버는 X-RateLimit-* 잔량 헤더를 보내지 않는다 → 선제 회피 불가.
 *    SDK 는 429 를 받은 뒤 Retry-After 를 준수하는 **반응형** 대응만 한다.
 */
export const RETRY_AFTER_FALLBACK_SECONDS = 60;

// ── 멱등성(§4.1) ────────────────────────────────────────────────────────

/**
 * 멱등 스냅샷 TTL 24h — 이 창 안에서 같은 키 재호출은 최초 응답이 재전달된다.
 * 정본: apps/api/src/partner-api/partner-api.config.ts (PARTNER_API_IDEMPOTENCY_TTL_HOURS)
 */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Idempotency-Key 길이 상한 128자(1자 미만/초과 = 400).
 * 정본: apps/api/src/partner-api/idempotency/partner-idempotency.interceptor.ts
 */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

/** 멱등 헤더명 */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/** 멱등 재전달 표시 응답 헤더 — 값 'true' 면 최초 응답의 스냅샷이다 */
export const IDEMPOTENCY_REPLAYED_HEADER = 'Idempotency-Replayed';

// ── 페이지네이션(§5.1) ──────────────────────────────────────────────────

/** 목록 기본 limit */
export const PAGINATION_DEFAULT_LIMIT = 20;

/** 목록 최대 limit — **초과값은 서버가 100으로 캡**(에러 아님) */
export const PAGINATION_MAX_LIMIT = 100;

// ── 재시도 정책 ─────────────────────────────────────────────────────────

/**
 * 기본 재시도 설정 — 지수 백오프 + full jitter.
 *
 * 정책(§ http.ts shouldRetry 참조):
 *  - 429           → Retry-After 준수(백오프 무시)
 *  - 5xx           → 지수 백오프 + jitter (멱등키 재사용 안전: 서버가 5xx 시
 *                    선점을 해제하므로 스냅샷이 남지 않는다)
 *  - 409 ERR_IDEMPOTENCY_IN_PROGRESS → 짧은 백오프 후 재시도
 *  - 그 외 4xx     → 재시도 금지
 */
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_BACKOFF_BASE_MS = 500;
export const DEFAULT_BACKOFF_MAX_MS = 8_000;

/** 409 IN_PROGRESS 전용 짧은 백오프 — 원 요청 완료를 짧게 기다린다 */
export const IDEMPOTENCY_IN_PROGRESS_BACKOFF_MS = 250;

/** 요청 기본 타임아웃 — 대용량 업로드/PDF 다운로드는 호출측에서 늘린다 */
export const DEFAULT_TIMEOUT_MS = 60_000;

// ── 경로 ────────────────────────────────────────────────────────────────

/**
 * v1 경로 접두 — 서버 글로벌 prefix 'api'(main.ts setGlobalPrefix) +
 * @PartnerV1Controller 의 'v1'. baseUrl 은 오리진만 주면 된다.
 */
export const V1_PATH_PREFIX = '/api/v1';
