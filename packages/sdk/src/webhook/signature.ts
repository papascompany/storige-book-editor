/**
 * 웹훅 수신 서명 검증 — Storige 발신 정본(WH-001 / v2)의 소비측 구현.
 *
 * ============================================================================
 * 🚨 본문 무결성 한계 — 이 모듈을 쓰기 전에 반드시 읽을 것
 * ============================================================================
 * 서명 대상 data 는 다음 **4개 값**뿐이다:
 *
 *     `${t}.${identifier}:${event}:${timestamp}`
 *
 * 즉 **payload 본문 전체는 서명에 포함되지 않는다**(raw body 해시가 아니다).
 * 서명이 valid 여도 증명되는 것은 "이 secret 을 가진 발신자가 이 identifier·
 * event·timestamp 조합을 t 시각에 서명했다"는 사실뿐이고, 본문의 나머지 필드
 * (status·outputFileUrl·outputFileId·errorCode·pageCount·result…)가 전송 중
 * 변조되지 않았음은 **증명하지 못한다**.
 *
 * ## 귀결 — 수신측이 반드시 지킬 것
 *  ① TLS(https) 를 강제하라. 본문 무결성은 현재 전적으로 전송계층에 의존한다.
 *  ② **부수효과의 권위를 본문에서 취하지 말라.** 결제/발주/상태확정 같은 판단은
 *     본문 값이 아니라 identifier(jobId/sessionId/bookUid)로 **재조회**해서
 *     서버에서 확인한 값으로 하라(MD2Books 파트너가 쓰는 4겹 재조회 패턴).
 *     본문은 "뭔가 바뀌었다"는 **알림 트리거**로만 취급하는 것이 안전하다.
 *  ③ 본문만 믿어도 되는 유일한 경우는 그 값이 부수효과를 만들지 않을 때다
 *     (예: 로그·UI 힌트).
 *
 * 이는 SDK 의 결함이 아니라 **서버 발신 계약의 현재 형태**다. SDK 는 계약을
 * 소비만 하며 바꾸지 않는다(서버 계약 변경은 별도 트랙 — 발신·수신 동시 배포 필요).
 *
 * ============================================================================
 * 서명 규약 실물
 * ============================================================================
 * 발신 정본 2곳이 **동일 알고리즘**을 쓴다 — 차이는 secret 출처뿐이다:
 *
 *  - v1(레거시 전역): apps/api/src/webhook/webhook.service.ts
 *      generateHmacSignature() — secret = process.env.WEBHOOK_SECRET
 *  - v2(사이트별 opt-in): apps/api/src/webhook/v2/webhook-secret.crypto.ts:80
 *      signWebhookV2() — secret = 사이트별 `whsec_...`(webhook_configs)
 *
 * 양쪽 모두:
 *      data  = `${t}.${identifier}:${event}:${timestamp}`
 *      v1hex = HMAC-SHA256(secret, data).hex()
 *      헤더값 = `t=${t},v1=${v1hex}`   (헤더명: X-Storige-Signature-HMAC)
 *
 * → **검증 로직은 하나로 통일된다.** 호출측은 secret 만 알맞게 주입하면 된다.
 *
 * ## `t` vs `timestamp` — 다른 값이다(혼동 주의)
 *  - `t`         = **서명 시각**(unix 초). 헤더 안에 있다. **재시도마다 새 t 로
 *                  재서명**되고 payload 바이트는 불변이다.
 *  - `timestamp` = **이벤트 시각**(ISO 8601 문자열). payload **본문 필드**다.
 *
 * replay 창(toleranceSec)은 반드시 헤더의 `t` 로 판정해야 한다. payload.timestamp
 * 에 신선도 게이트를 걸면 **정상 재시도가 거부된다** — 서버 재시도 체인은
 * 1분/5분/30분이라 마지막 재시도의 payload.timestamp 는 30분 넘게 과거다.
 * (실제로 이 함정을 밟은 수신부 사례가 있다: 대조표
 *  docs/WEBHOOK_SIGNATURE_MATRIX_2026-07-03.md 참조)
 *
 * ## raw body 보존 불필요 — 일반 웹훅 SDK 와 다른 점
 * 서명 data 가 body 해시가 아니라 **파싱된 필드 조립**이므로, 흔한
 * "raw body 를 보존해 서명 검증 후 파싱" 요구가 **없다**. `express.json()`
 * 같은 일반 JSON 파서와 그대로 공존한다(어댑터 주석 참조).
 *
 * ## 런타임
 * 이 서브패스는 **Node 전용**이다(node:crypto 의 createHmac·timingSafeEqual 사용).
 * 웹훅 수신은 서버측 동작이라 이 제약은 실사용에 영향이 없다. npm 런타임 의존성은
 * 여전히 0 이다(node:crypto 는 빌트인).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { StorigeUsageError } from '../index';

// ── 헤더 상수 (발신 정본: webhook-delivery.service.ts:350~ / webhook.service.ts buildHeaders) ──

/** HMAC 서명 헤더 — `t=<unixsec>,v1=<hex64>`. v1·v2 발신 공통 형식. */
export const WEBHOOK_HMAC_SIGNATURE_HEADER = 'X-Storige-Signature-HMAC';

/**
 * 레거시 base64 서명 헤더 — **시크릿 불참여 = 위조 가능**. 신뢰 금지.
 * v1 발신 경로만 보낸다(v2 는 HMAC 전용이라 미전송).
 */
export const WEBHOOK_LEGACY_SIGNATURE_HEADER = 'X-Storige-Signature';

/** 이벤트명 헤더 — payload.event 와 동일값 */
export const WEBHOOK_EVENT_HEADER = 'X-Storige-Event';

/** delivery uid 헤더(`whd_...`) — 수신측 멱등 키. v2 발신 경로만 보낸다. */
export const WEBHOOK_DELIVERY_HEADER = 'X-Storige-Delivery';

/** 재시도 표시 헤더 — v1 인라인 재시도만 붙인다(값 '1') */
export const WEBHOOK_RETRY_HEADER = 'X-Storige-Retry';

/**
 * 기본 replay 허용 창(초) — 헤더 `t` 기준 ±300초.
 *
 * 서버는 재시도마다 새 t 로 재서명하므로 30분 뒤 재시도도 이 창을 통과한다.
 * (창을 좁혀도 정상 트래픽은 안 막힌다 — 좁을수록 캡처-replay 창이 준다)
 */
export const DEFAULT_SIGNATURE_TOLERANCE_SEC = 300;

// ── 결과 타입 ───────────────────────────────────────────────────────────

/**
 * 검증 실패 사유.
 *
 *  - `MISSING_SIGNATURE`          서명 헤더가 아예 없음
 *  - `MALFORMED_SIGNATURE`        HMAC 헤더 형식 불량(`t=`/`v1=` 파싱 실패)
 *  - `TIMESTAMP_OUT_OF_TOLERANCE` 서명 시각 t 가 허용 창 밖(replay 방지)
 *  - `SIGNATURE_MISMATCH`         서명값 불일치(위조 또는 secret/식별자 규칙 불일치)
 *  - `INSECURE_LEGACY_SIGNATURE`  HMAC 헤더 없이 레거시 base64 헤더만 옴 —
 *                                 기본 거부(allowInsecureLegacy 로만 통과)
 */
export type WebhookVerifyFailureReason =
  | 'MISSING_SIGNATURE'
  | 'MALFORMED_SIGNATURE'
  | 'TIMESTAMP_OUT_OF_TOLERANCE'
  | 'SIGNATURE_MISMATCH'
  | 'INSECURE_LEGACY_SIGNATURE';

export interface WebhookVerifySuccess {
  valid: true;
  /** 서명 시각(unix 초). 레거시 통과(insecureLegacy=true)면 서명에 t 가 없어 null. */
  t: number | null;
  /** 서명 data 에 실제로 쓰인 식별자 — 재조회 키로 쓰기 좋다 */
  identifier: string;
  /** 서명 data 에 쓰인 이벤트명 */
  event: string;
  /**
   * ⚠️ true = **시크릿 불참여 레거시 base64 서명**으로 통과했다 = 누구나 위조
   * 가능하다. 인증 근거로 쓰지 말 것. allowInsecureLegacy 를 켠 경우에만 나온다.
   */
  insecureLegacy: boolean;
}

export interface WebhookVerifyFailure {
  valid: false;
  reason: WebhookVerifyFailureReason;
  /** 진단용 한국어 설명 — 수신측 응답 본문에 그대로 싣지 말 것(정보 노출) */
  message: string;
}

export type WebhookVerifyResult = WebhookVerifySuccess | WebhookVerifyFailure;

// ── 식별자 규약 ─────────────────────────────────────────────────────────

/**
 * 서명 data 의 `identifier` 를 어느 발신 경로 규칙으로 재조립할지.
 *
 * ⚠️ **v1 과 v2 는 서명 형식은 같지만 identifier 유도 규칙이 다르다**(실코드 대조).
 *
 * | 페이로드 | v1 발신(webhook.service.ts payloadIdentifier) | v2 발신(webhook-delivery.service.ts attemptHttp) |
 * |---|---|---|
 * | `{jobId:'j1'}`                  | `'j1'`            | `'j1'` (동일) |
 * | `{sessionId:'s1'}`              | `'s1'`            | `'s1'` (동일) |
 * | `{jobId:null, sessionId:'s1'}`  | `'null'` ⚠️        | `'s1'` (**불일치**) |
 * | `{finalizationUid:'fin_1'}`     | `'fin_1'`         | delivery uid (**불일치**) |
 * | 식별자 필드 없음                  | `''`              | delivery uid (**불일치**) |
 *
 * - `'v1'`   전역 WEBHOOK_SECRET 발신 경로 규칙:
 *            `'jobId' in payload` → jobId(값이 null 이어도 문자열 'null')
 *            → truthy sessionId → finalizationUid → `''`
 * - `'v2'`   사이트별 secret 발신 경로 규칙:
 *            `jobId ?? sessionId ?? <X-Storige-Delivery 헤더값>`
 *            (finalizationUid 분기 없음 → book.finalization.* 는 delivery uid 로 서명된다)
 * - `'auto'` (기본) **X-Storige-Delivery 헤더 유무**로 발신 경로를 판별한다:
 *            헤더 있음 → v2, 없음 → v1. 두 발신부의 헤더 세트가 서로 배타적이라
 *            (v2 만 X-Storige-Delivery 를 보내고, v1 만 레거시 base64 를 보낸다)
 *            이 판별은 결정적이다.
 *
 * 판별 헤더를 공격자가 바꿔도 위조로 이어지지 않는다 — 어느 규칙으로 가든
 * 유효한 v1hex 를 만들려면 secret 이 필요하기 때문이다. 규칙 전환은 "어떤 data
 * 문자열을 기대하는가"만 바꾼다.
 */
export type WebhookIdentifierStrategy = 'auto' | 'v1' | 'v2';

// ── 입력 ────────────────────────────────────────────────────────────────

/**
 * 헤더 컨테이너 — express 의 `req.headers`(소문자 키, 값 string|string[]) 와
 * fetch/Next.js 의 `Headers` 인스턴스를 모두 받는다. 조회는 대소문자 무시.
 */
export type WebhookHeaders =
  | Headers
  | Record<string, string | string[] | undefined>;

export interface VerifyWebhookSignatureOptions {
  /** 수신 요청 헤더 */
  headers: WebhookHeaders;
  /**
   * **파싱된** payload(JSON.parse 결과). raw body 가 아니다 —
   * 서명이 body 해시가 아니므로 raw 보존이 필요 없다(모듈 상단 참조).
   */
  payload: unknown;
  /**
   * 서명 secret.
   *  - v2(사이트별 opt-in): 웹훅 config 발급/회전 시 1회 노출된 `whsec_...`
   *  - v1(레거시 전역): 서버 WEBHOOK_SECRET 과 공유한 값
   *
   * HMAC 검증에 secret 이 필요한데 빈 문자열이면 **StorigeUsageError 를 던진다**
   * (수신측 설정 실수를 조용한 검증 실패로 위장하지 않는다).
   */
  secret: string;
  /**
   * replay 허용 창(초) — 기본 {@link DEFAULT_SIGNATURE_TOLERANCE_SEC}(300).
   * 헤더 `t` 기준이다(payload.timestamp 아님 — 모듈 상단 참조).
   * `0` 이하면 검사를 건너뛴다 — **권장하지 않는다**(replay 창이 무한해진다).
   */
  toleranceSec?: number;
  /**
   * ⚠️ **위험 옵션.** HMAC 헤더 없이 레거시 base64 헤더(X-Storige-Signature)만
   * 온 요청을 통과시킨다. 그 서명에는 **시크릿이 참여하지 않으므로**
   * `base64(identifier:event:timestamp)` 를 누구나 계산할 수 있다 = **위조 가능**.
   * 발신 실코드 주석도 "보안 검증용으로 신뢰 금지"를 명시한다.
   *
   * 켜더라도 값 자체는 대조하지만(오배송/손상은 걸러진다) **인증 근거는 되지
   * 못한다**. 통과 결과에는 `insecureLegacy: true` 가 실린다 — 호출측은 이 값을
   * 보고 부수효과를 게이팅하라. 기본 false(거부).
   *
   * 올바른 해법은 이 옵션이 아니라 서버측 secret 설정(v1 WEBHOOK_SECRET 또는
   * v2 사이트별 config)으로 HMAC 헤더를 받는 것이다.
   */
  allowInsecureLegacy?: boolean;
  /** identifier 유도 규칙 — 기본 `'auto'`({@link WebhookIdentifierStrategy}) */
  identifierStrategy?: WebhookIdentifierStrategy;
  /** 현재 시각(ms) 주입 — 테스트/클럭 제어용. 기본 `Date.now` */
  now?: () => number;
}

// ── 내부 유틸 ───────────────────────────────────────────────────────────

/**
 * JS 템플릿 리터럴 보간 의미론 재현.
 *
 * 발신부가 `` `${t}.${identifier}:${event}:${timestamp}` `` 로 조립하므로,
 * null/undefined 도 발신부와 **똑같이** 'null'/'undefined' 문자열이 되어야
 * 서명이 맞는다. 발신부의 기벽까지 충실히 재현하는 것이 SDK 의 일이다
 * (SDK 는 계약을 소비하지 교정하지 않는다).
 */
function interpolate(value: unknown): string {
  return `${value}`;
}

function asRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return {};
}

/**
 * 대소문자 무시 헤더 조회 — Headers 인스턴스와 평범한 객체를 모두 지원.
 *
 * @internal 어댑터(adapters/core.ts)가 재사용한다. `webhook/index.ts` 는 이걸
 * re-export 하지 않으므로 공개 API 표면에는 나타나지 않는다 — 헤더 해석 규칙이
 * 두 벌로 갈라져 조용히 어긋나는 것을 막기 위한 단일 출처다.
 */
export function readHeader(headers: WebhookHeaders, name: string): string | undefined {
  const maybeHeaders = headers as Headers;
  if (typeof maybeHeaders.get === 'function') {
    return maybeHeaders.get(name) ?? undefined;
  }
  const record = headers as Record<string, string | string[] | undefined>;
  const lower = name.toLowerCase();
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() !== lower) continue;
    const value = record[key];
    if (Array.isArray(value)) return value[0];
    return value ?? undefined;
  }
  return undefined;
}

/**
 * v1 발신 식별자 — apps/api/src/webhook/webhook.service.ts payloadIdentifier 미러.
 *
 * `'jobId' in payload` 는 **키 존재** 검사라 값이 null 이어도 그대로 반환된다
 * → 서명 data 에 문자열 'null' 이 박힌다. 발신부가 jobId 를 null 로 두지 말아야
 * 하는 계약 주의사항이며(대조표 기재), 여기서는 그 현실을 그대로 재현한다.
 */
function resolveIdentifierV1(payload: Record<string, unknown>): string {
  if ('jobId' in payload) return interpolate(payload.jobId);
  if ('sessionId' in payload && payload.sessionId) return interpolate(payload.sessionId);
  if ('finalizationUid' in payload) return interpolate(payload.finalizationUid);
  return '';
}

/**
 * v2 발신 식별자 — apps/api/src/webhook/v2/webhook-delivery.service.ts
 * attemptHttp 미러: `parsed.jobId ?? parsed.sessionId ?? delivery.uid`.
 *
 * ⚠️ v1 과 달리 finalizationUid 분기가 없다 → book.finalization.* 페이로드는
 *    delivery uid(= X-Storige-Delivery 헤더값)로 서명된다.
 */
function resolveIdentifierV2(
  payload: Record<string, unknown>,
  deliveryUid: string | undefined,
): string {
  const jobId = payload.jobId;
  if (jobId !== null && jobId !== undefined) return interpolate(jobId);
  const sessionId = payload.sessionId;
  if (sessionId !== null && sessionId !== undefined) return interpolate(sessionId);
  return deliveryUid ?? '';
}

/** v1 발신 timestamp — `${payload.timestamp}`(부재 시 문자열 'undefined') */
function resolveTimestampV1(payload: Record<string, unknown>): string {
  return interpolate(payload.timestamp);
}

/** v2 발신 timestamp — `parsed.timestamp ?? ''`(부재 시 빈 문자열) */
function resolveTimestampV2(payload: Record<string, unknown>): string {
  const timestamp = payload.timestamp;
  if (timestamp === null || timestamp === undefined) return '';
  return interpolate(timestamp);
}

interface SignedFields {
  identifier: string;
  event: string;
  timestamp: string;
}

function resolveSignedFields(
  strategy: 'v1' | 'v2',
  payload: Record<string, unknown>,
  deliveryUid: string | undefined,
): SignedFields {
  return {
    identifier:
      strategy === 'v2'
        ? resolveIdentifierV2(payload, deliveryUid)
        : resolveIdentifierV1(payload),
    // 발신 양쪽 모두 payload.event 에서 유도한다(v2 는 delivery.event 컬럼이지만
    // dispatch(config, payload.event, ...) 로 채워져 항상 동일값이며, 그 값이 곧
    // X-Storige-Event 헤더다). 헤더 대신 **본문 필드**에 바인딩하는 것은 의도적이다
    // — 핸들러가 소비하는 값과 검증 대상이 어긋나지 않게 한다.
    event: interpolate(payload.event),
    timestamp:
      strategy === 'v2' ? resolveTimestampV2(payload) : resolveTimestampV1(payload),
  };
}

interface ParsedHmacSignature {
  t: number;
  v1: string;
}

/**
 * `t=<unixsec>,v1=<hex64>` 파싱.
 *
 * 미지의 키는 무시한다(전방 호환 — 발신부가 향후 v2= 같은 스킴을 additive 로
 * 추가해도 이 파서는 깨지지 않는다). t·v1 이 없거나 형식이 어긋나면 null.
 */
function parseHmacSignature(raw: string): ParsedHmacSignature | null {
  let t: number | undefined;
  let v1: string | undefined;

  for (const part of raw.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) return null; // k=v 형태가 아님
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') {
      if (!/^\d+$/.test(value)) return null;
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed)) return null;
      t = parsed;
    } else if (key === 'v1') {
      // 발신은 digest('hex') = 소문자 64자 고정
      if (!/^[0-9a-f]{64}$/.test(value)) return null;
      v1 = value;
    }
  }

  if (t === undefined || v1 === undefined) return null;
  return { t, v1 };
}

/**
 * 상수시간 비교 — 타이밍 사이드채널로 서명을 한 바이트씩 맞춰 나가는 공격 차단.
 * timingSafeEqual 은 길이가 다르면 throw 하므로 길이는 먼저 검사한다
 * (길이 노출은 서명 형식이 고정폭이라 새 정보가 아니다).
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function fail(
  reason: WebhookVerifyFailureReason,
  message: string,
): WebhookVerifyFailure {
  return { valid: false, reason, message };
}

// ── 공개 API ────────────────────────────────────────────────────────────

/**
 * Storige 웹훅 서명 검증 (v1·v2 통합 — 형식이 동일하므로 검증기는 하나다).
 *
 * ## 무엇을 검증하는가
 *  ① HMAC 헤더 형식(`t=`,`v1=`)
 *  ② 서명 시각 t 의 replay 창(기본 ±300초)
 *  ③ `HMAC(secret, `${t}.${identifier}:${event}:${timestamp}`)` 상수시간 대조
 *
 * ## 무엇을 검증하지 **못하는가**
 * **payload 본문 무결성.** 서명에 본문이 안 들어간다 — 모듈 상단 "본문 무결성
 * 한계" 필독. 부수효과는 identifier 로 재조회해서 결정하라.
 *
 * @example 기본 사용(v2 사이트별 secret)
 * ```ts
 * import { verifyWebhookSignature } from '@storige/sdk/webhook';
 *
 * const result = verifyWebhookSignature({
 *   headers: req.headers,
 *   payload: req.body,            // 파싱된 JSON — raw body 불필요
 *   secret: process.env.STORIGE_WEBHOOK_SECRET!,
 * });
 *
 * if (!result.valid) {
 *   console.warn('webhook 거부:', result.reason);
 *   return res.status(401).end();
 * }
 * // result.identifier 로 재조회 후 처리
 * ```
 *
 * @throws {StorigeUsageError} HMAC 검증이 필요한데 secret 이 빈 문자열일 때
 *   (수신측 설정 실수 — 검증 실패로 위장하면 공격과 구분이 안 된다)
 */
export function verifyWebhookSignature(
  options: VerifyWebhookSignatureOptions,
): WebhookVerifyResult {
  const { headers, payload, secret } = options;
  const toleranceSec = options.toleranceSec ?? DEFAULT_SIGNATURE_TOLERANCE_SEC;
  const allowInsecureLegacy = options.allowInsecureLegacy ?? false;
  const nowMs = (options.now ?? Date.now)();

  const record = asRecord(payload);
  const hmacHeader = readHeader(headers, WEBHOOK_HMAC_SIGNATURE_HEADER);
  const legacyHeader = readHeader(headers, WEBHOOK_LEGACY_SIGNATURE_HEADER);
  const deliveryUid = readHeader(headers, WEBHOOK_DELIVERY_HEADER);

  // 발신 경로 판별 — X-Storige-Delivery 는 v2 만 보낸다(위 전략 표 참조)
  const requested = options.identifierStrategy ?? 'auto';
  const strategy: 'v1' | 'v2' =
    requested === 'auto' ? (deliveryUid !== undefined ? 'v2' : 'v1') : requested;

  // ── HMAC 헤더 부재 경로 ──
  if (hmacHeader === undefined) {
    if (legacyHeader === undefined) {
      return fail(
        'MISSING_SIGNATURE',
        `서명 헤더가 없습니다 (${WEBHOOK_HMAC_SIGNATURE_HEADER} 부재)`,
      );
    }
    if (!allowInsecureLegacy) {
      return fail(
        'INSECURE_LEGACY_SIGNATURE',
        `레거시 base64 서명(${WEBHOOK_LEGACY_SIGNATURE_HEADER})만 도착했습니다 — ` +
          '이 서명은 시크릿이 참여하지 않아 위조 가능하므로 기본 거부합니다. ' +
          '서버에 웹훅 secret 을 설정해 HMAC 헤더를 받으십시오(권장). ' +
          '위험을 감수하고 통과시키려면 allowInsecureLegacy: true.',
      );
    }
    return verifyLegacySignature(legacyHeader, record, strategy, deliveryUid);
  }

  // ── HMAC 검증 경로(정본) ──
  if (secret.length === 0) {
    throw new StorigeUsageError(
      'verifyWebhookSignature: HMAC 서명 검증에 secret 이 필요합니다 (빈 문자열). ' +
        'v2 는 웹훅 config 발급 시 1회 노출된 whsec_... 값을, v1 은 서버 WEBHOOK_SECRET 과 ' +
        '공유한 값을 주입하십시오.',
    );
  }

  const parsed = parseHmacSignature(hmacHeader);
  if (parsed === null) {
    return fail(
      'MALFORMED_SIGNATURE',
      `${WEBHOOK_HMAC_SIGNATURE_HEADER} 형식이 't=<unix초>,v1=<hex64>' 가 아닙니다`,
    );
  }

  // replay 방지 — **서명 시각 t** 기준(payload.timestamp 아님)
  if (toleranceSec > 0) {
    const skewSec = Math.abs(nowMs / 1000 - parsed.t);
    if (skewSec > toleranceSec) {
      return fail(
        'TIMESTAMP_OUT_OF_TOLERANCE',
        `서명 시각이 허용 창을 벗어났습니다 (오차 ${Math.round(skewSec)}초 > ${toleranceSec}초)`,
      );
    }
  }

  const fields = resolveSignedFields(strategy, record, deliveryUid);
  const data = `${parsed.t}.${fields.identifier}:${fields.event}:${fields.timestamp}`;
  const expected = createHmac('sha256', secret).update(data).digest('hex');

  if (!constantTimeEquals(parsed.v1, expected)) {
    return fail(
      'SIGNATURE_MISMATCH',
      '서명이 일치하지 않습니다 (secret 불일치, 본문 변조, 또는 identifier 규칙 불일치)',
    );
  }

  return {
    valid: true,
    t: parsed.t,
    identifier: fields.identifier,
    event: fields.event,
    insecureLegacy: false,
  };
}

/**
 * ⚠️ 레거시 base64 대조 — **인증이 아니다**.
 *
 * `base64(identifier:event:timestamp)` 는 시크릿 없이 누구나 계산할 수 있다.
 * 여기서 값을 맞춰 보는 것은 오배송/손상 검출 이상의 의미가 없으며, 결과에
 * insecureLegacy: true 를 실어 호출측이 이를 인지하게 한다.
 */
function verifyLegacySignature(
  legacyHeader: string,
  payload: Record<string, unknown>,
  strategy: 'v1' | 'v2',
  deliveryUid: string | undefined,
): WebhookVerifyResult {
  const fields = resolveSignedFields(strategy, payload, deliveryUid);
  const data = `${fields.identifier}:${fields.event}:${fields.timestamp}`;
  const expected = Buffer.from(data, 'utf8').toString('base64');

  if (!constantTimeEquals(legacyHeader, expected)) {
    return fail('SIGNATURE_MISMATCH', '레거시 base64 서명이 일치하지 않습니다');
  }

  return {
    valid: true,
    // 레거시 서명에는 서명 시각이 없다 → replay 창 판정 자체가 불가능하다.
    t: null,
    identifier: fields.identifier,
    event: fields.event,
    insecureLegacy: true,
  };
}
