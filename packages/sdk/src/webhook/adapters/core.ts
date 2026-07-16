/**
 * 어댑터 공통 파이프라인 — 검증 → 멱등 단락 → 핸들러 → 상태코드.
 *
 * express/next 어댑터는 이 파이프라인에 프레임워크별 입출력만 붙인다.
 */

import {
  assertToleranceSec,
  assertWebhookSecret,
  readHeader,
  verifyWebhookSignature,
  WEBHOOK_DELIVERY_HEADER,
  type WebhookHeaders,
  type WebhookIdentifierStrategy,
  type WebhookVerifyFailureReason,
} from '../signature';
import { StorigeUsageError } from '../../index';
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
   *
   * ⚠️ **서명 밖 값이다** — identifier 가 jobId/sessionId 로 정해지는 페이로드에선
   * uid 가 서명 data 에 안 들어간다 → 헤더 변조로 바뀔 수 있다. 위 `identifier`
   * 와 달리 **신뢰 근거가 아니다**. 멱등은 신뢰성 통제이지 인증 통제가 아니다 —
   * dedupe.ts 모듈 JSDoc 필독.
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
 * 어댑터 옵션의 **부팅 시점** 검증 — 팩토리가 호출한다.
 *
 * ## 왜 팩토리인가
 * 오설정(secret 미주입·toleranceSec NaN)을 **첫 웹훅이 도착했을 때**가 아니라
 * `createExpressWebhookHandler(...)` 를 부르는 **모듈 로드 시점**에 터뜨린다.
 * 그러면 배포가 실패하고 즉시 눈에 띈다 — 반대로 런타임까지 미루면 오설정이
 * 원격 요청으로 트리거되는 실패 경로가 되고(P0 실증: 무인증 1요청 프로세스
 * 종료), 파트너는 "웹훅이 안 온다"만 보게 된다.
 *
 * secret 은 **경로 무관하게** 요구한다: 팩토리는 앞으로 올 요청이 HMAC 경로일지
 * 레거시 경로일지 알 수 없으므로, HMAC 이 도착했을 때 필요한 값을 미리 못 박는다.
 * (allowInsecureLegacy 를 쓰더라도 서버가 secret 을 설정하는 순간 HMAC 이 온다.)
 *
 * @throws {StorigeUsageError} secret 이 비문자열/빈 문자열이거나 toleranceSec 이 NaN·Infinity
 */
export function assertWebhookHandlerOptions(
  options: WebhookHandlerOptions,
  context: string,
): void {
  assertWebhookSecret(options.secret, context);
  assertToleranceSec(options.toleranceSec, context);
}

/**
 * 어댑터가 **예기치 못한 예외를 삼킬 때** 쓰는 응답.
 *
 * 핸들러 예외는 파이프라인이 이미 500 HANDLER_FAILED 로 바꾸므로 여기 오지
 * 않는다. 여기 오는 것은 파이프라인 **밖**의 사고다:
 *  - `ADAPTER_MISCONFIGURED` 수신측 설정 오류(StorigeUsageError) — 예: express.json()
 *    미마운트, 팩토리 통과 후 options.secret 이 지워진 경우
 *  - `ADAPTER_ERROR`         그 외 예상 못 한 예외
 *
 * 5xx 라 서버가 재시도한다 → 설정을 고치면 재시도가 통과한다(유실 없음).
 * 파트너는 이 코드를 `GET /api/v1/webhooks/deliveries` 의 lastResponse 에서
 * 그대로 볼 수 있다 — 프로세스가 죽는 것보다 진단이 쉽다.
 *
 * 본문에 message 를 싣지 않는 것은 파이프라인과 같은 원칙이다(서버가 응답을
 * 저장하므로 불필요한 정보 노출을 피한다).
 */
export function adapterFailureOutcome(error: unknown): WebhookProcessOutcome {
  return {
    status: 500,
    body: {
      error: error instanceof StorigeUsageError ? 'ADAPTER_MISCONFIGURED' : 'ADAPTER_ERROR',
    },
  };
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
 *
 * ⚠️ **직접 배선 시 try/catch 로 감싸라.** 오설정(secret·toleranceSec)은 거부가
 * 아니라 StorigeUsageError 다. express 4 는 async rejection 을 next(err) 로
 * 넘기지 않으므로 감싸지 않으면 unhandledRejection → 프로세스 종료가 된다.
 * (SDK 어댑터를 쓰면 이미 감싸져 있다 — {@link adapterFailureOutcome})
 *
 * @throws {StorigeUsageError} 오설정 — 매 요청 검사한다. 팩토리 통과 후 options
 *   가 변조되는 경우까지 덮는 심층 방어이며, 정상 경로에서는 팩토리에서 이미 걸린다.
 */
export async function processWebhookRequest(
  headers: WebhookHeaders,
  payload: unknown,
  options: WebhookHandlerOptions,
): Promise<WebhookProcessOutcome> {
  assertWebhookHandlerOptions(options, 'processWebhookRequest');

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

  // 서명 검증과 **같은 헤더 해석 규칙**을 쓴다(단일 출처) — 두 벌로 갈라지면
  // "서명은 v2 로 검증했는데 dedupe 키는 못 읽는" 식의 어긋남이 조용히 생긴다.
  const deliveryUid = readHeader(headers, WEBHOOK_DELIVERY_HEADER) ?? null;
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
