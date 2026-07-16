/**
 * 어댑터 공통 파이프라인 — 검증 → 멱등 단락 → 핸들러 → 상태코드.
 *
 * express/next 어댑터는 이 파이프라인에 프레임워크별 입출력만 붙인다.
 */

import {
  verifyWebhookSignature,
  type WebhookHeaders,
  type WebhookIdentifierStrategy,
  type WebhookVerifyFailureReason,
} from '../signature';
import type { WebhookDeduper } from '../dedupe';
import type { StorigeWebhookPayload } from '../events';

/** 핸들러에 함께 넘기는 검증된 메타데이터 */
export interface WebhookHandlerContext {
  /** 서명에 포함돼 **신뢰 가능한** 이벤트명 */
  event: string;
  /**
   * 서명에 포함돼 **신뢰 가능한** 식별자(jobId/sessionId/finalizationUid/uid).
   * 본문은 서명 밖이므로, 부수효과를 만들 값은 이걸로 재조회해서 얻어라.
   */
  identifier: string;
  /**
   * delivery uid(whd_...). **null 이면 멱등 단락이 수행되지 않았다** —
   * v1 발신 경로는 X-Storige-Delivery 를 보내지 않기 때문이다(dedupe.ts 참조).
   */
  deliveryUid: string | null;
  /** 서명 시각(unix 초). 레거시 통과 시 null. */
  t: number | null;
  /** ⚠️ true = 위조 가능한 레거시 base64 로 통과 — 부수효과를 게이팅하라 */
  insecureLegacy: boolean;
}

export type WebhookHandler = (
  payload: StorigeWebhookPayload,
  context: WebhookHandlerContext,
) => void | Promise<void>;

export interface WebhookHandlerOptions {
  /**
   * 서명 secret — v2 는 config 발급 시 1회 노출된 `whsec_...`,
   * v1 은 서버 WEBHOOK_SECRET 과 공유한 값.
   */
  secret: string;
  /**
   * 검증 통과 후 호출된다. 던지면 500 을 반환하고(서버가 재시도한다)
   * deduper.release 가 있으면 선점을 풀어 재처리를 허용한다.
   */
  handler: WebhookHandler;
  /**
   * 중복 배달 단락기. 서버가 같은 배달을 최대 4회 보내므로 **강력히 권장**한다.
   * 미지정 시 단락 없이 매 배달마다 핸들러가 호출된다(핸들러 자체가 멱등해야 함).
   */
  deduper?: WebhookDeduper;
  /** replay 창(초) — 기본 300 */
  toleranceSec?: number;
  /** ⚠️ 위조 가능한 레거시 base64 허용 — 기본 false. signature.ts JSDoc 필독. */
  allowInsecureLegacy?: boolean;
  /** identifier 유도 규칙 — 기본 'auto'(헤더로 발신 경로 자동 판별) */
  identifierStrategy?: WebhookIdentifierStrategy;
  /**
   * 핸들러 예외 관측 훅 — 로깅용. 여기서 던지는 예외는 무시된다.
   * (관측 실패가 웹훅 응답을 바꾸면 안 된다)
   */
  onError?: (error: unknown, context: WebhookHandlerContext) => void;
  /** 현재 시각(ms) 주입 — 테스트용 */
  now?: () => number;
}

/** 어댑터가 반환할 HTTP 응답 */
export interface WebhookProcessOutcome {
  status: number;
  body: Record<string, unknown>;
}

/**
 * 검증 실패 → HTTP 상태 매핑.
 *
 * 서버는 비-2xx 를 실패로 보고 재시도한다(1분/5분/30분). 그래서:
 *  - 위조/오설정은 4xx 로 거부해도 **안전하다**(재시도 3회 후 EXHAUSTED 로 종결).
 *  - 클럭 스큐로 인한 TIMESTAMP_OUT_OF_TOLERANCE 는 4xx 로 돌려주는 편이 낫다 —
 *    재시도는 **새 t 로 재서명**되므로 다음 시도에 정상 통과할 수 있다.
 */
const FAILURE_STATUS: Record<WebhookVerifyFailureReason, number> = {
  MISSING_SIGNATURE: 400,
  MALFORMED_SIGNATURE: 400,
  INSECURE_LEGACY_SIGNATURE: 400,
  TIMESTAMP_OUT_OF_TOLERANCE: 400,
  // 인증 실패 — 서명은 왔으나 secret/식별자 규칙이 맞지 않는다
  SIGNATURE_MISMATCH: 401,
};

/**
 * 검증 → 멱등 → 핸들러 파이프라인.
 *
 * 응답 본문에는 **사유 코드만** 싣고 사람이 읽는 message 는 싣지 않는다
 * (서버가 lastResponse 로 저장하므로 불필요한 정보 노출을 피한다).
 */
export async function processWebhookRequest(
  headers: WebhookHeaders,
  payload: unknown,
  options: WebhookHandlerOptions,
): Promise<WebhookProcessOutcome> {
  const verification = verifyWebhookSignature({
    headers,
    payload,
    secret: options.secret,
    ...(options.toleranceSec !== undefined ? { toleranceSec: options.toleranceSec } : {}),
    ...(options.allowInsecureLegacy !== undefined
      ? { allowInsecureLegacy: options.allowInsecureLegacy }
      : {}),
    ...(options.identifierStrategy !== undefined
      ? { identifierStrategy: options.identifierStrategy }
      : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });

  if (!verification.valid) {
    return {
      status: FAILURE_STATUS[verification.reason],
      body: { error: verification.reason },
    };
  }

  const deliveryUid = readDeliveryUid(headers);
  const context: WebhookHandlerContext = {
    event: verification.event,
    identifier: verification.identifier,
    deliveryUid,
    t: verification.t,
    insecureLegacy: verification.insecureLegacy,
  };

  // 멱등 선점 — uid 가 없으면(v1 발신) 단락 자체가 불가능하다
  const deduper = options.deduper;
  const canDedupe = deduper !== undefined && deliveryUid !== null;
  if (canDedupe) {
    const claimed = await deduper.claim(deliveryUid);
    if (!claimed) {
      // 이미 처리한 배달 — 200 으로 확인해 서버 재시도 체인을 끊는다.
      // (4xx/5xx 를 주면 서버가 계속 재시도한다)
      return { status: 200, body: { received: true, duplicate: true } };
    }
  }

  try {
    await options.handler(payload as StorigeWebhookPayload, context);
  } catch (error) {
    // 선점을 풀어 다음 재시도가 다시 처리하게 한다(at-least-once).
    // release 가 없으면 선점이 남아 이후 재시도가 전부 단락된다 = 이벤트 유실
    // (at-most-once — dedupe.ts release JSDoc 의 문서화된 트레이드오프).
    if (canDedupe && deduper.release !== undefined) {
      try {
        await deduper.release(deliveryUid);
      } catch {
        // release 실패가 원래 예외를 덮으면 진단이 불가능해진다 — 삼킨다.
        // (이 경우 해당 배달은 사실상 at-most-once 로 퇴화한다)
      }
    }
    if (options.onError !== undefined) {
      try {
        options.onError(error, context);
      } catch {
        // 관측 훅의 실패가 응답을 바꾸면 안 된다
      }
    }
    // 5xx → 서버가 재시도한다(1분/5분/30분)
    return { status: 500, body: { error: 'HANDLER_FAILED' } };
  }

  return { status: 200, body: { received: true } };
}

function readDeliveryUid(headers: WebhookHeaders): string | null {
  const maybeHeaders = headers as Headers;
  if (typeof maybeHeaders.get === 'function') {
    return maybeHeaders.get('X-Storige-Delivery');
  }
  const record = headers as Record<string, string | string[] | undefined>;
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() !== 'x-storige-delivery') continue;
    const value = record[key];
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  }
  return null;
}
