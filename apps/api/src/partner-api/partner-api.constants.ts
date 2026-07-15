/**
 * Partner API v1 상수 (설계서 §4/§5/§7).
 *
 * env 스코프: Stage 2 부터 인증 컨텍스트(req.user.env — partner_api_keys.env)가
 * 정본. PARTNER_ENV_LIVE 는 sites 레거시 키(단일 env 체계) 경로의 기본값으로만
 * 남는다 — 가드·멱등·감사 3곳의 실사용은 `user.env ?? PARTNER_ENV_LIVE`.
 */

/** sites 레거시 키(단일 env)의 기본 env — v1 신규 키는 req.user.env 가 정본 */
export const PARTNER_ENV_LIVE = 'live' as const;

export type PartnerEnv = 'test' | 'live';

/**
 * live 전용 라우트 메타데이터 키 (@PartnerLiveOnly — Stage 2 작업 3).
 * test 키가 마킹된 라우트 호출 시 403 ERR_ENV_MISMATCH.
 * 현 Stage 1 표면(GET 조회)은 전부 양 env 허용 — 발화 지점은 Stage 3+(finalization 등).
 */
export const PARTNER_LIVE_ONLY_KEY = 'partnerLiveOnly';

/** 멱등 캐시 헤더명 (설계서 §4.1) */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/** 멱등 재전달 표시 응답 헤더 (설계서 §4.1) */
export const IDEMPOTENCY_REPLAYED_HEADER = 'Idempotency-Replayed';

/** 파트너 API 설정 주입 토큰 (env 중앙화 — partner-api.config.ts 참조) */
export const PARTNER_API_CONFIG = Symbol('PARTNER_API_CONFIG');

/** 레이트리밋 버킷 메타데이터 키 (@PartnerRateBucket) */
export const PARTNER_RATE_BUCKET_KEY = 'partnerRateBucket';

/** 레이트리밋 버킷 — general 300/min, heavy(업로드/최종화) 100/min (설계서 §5.2) */
export type PartnerRateBucket = 'general' | 'heavy';

/**
 * 429 Retry-After 폴백(초) — per-Key 가드(PartnerRateLimitedException)가 아닌
 * 429(전역 per-IP ThrottlerGuard 등)가 v1 필터로 들어왔고 가드가 헤더를 미리
 * 세팅하지 않은 경우의 기본값. 전역 스로틀 윈도우(60초)와 동일.
 */
export const RETRY_AFTER_FALLBACK_SECONDS = 60;
