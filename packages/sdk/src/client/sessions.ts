/**
 * Sessions 리소스 — 편집 세션 런처 3라우트 (CONTRACT_FREEZE v1.23, 2026-10-18 ADDITIVE).
 *
 * 연동은 2회 호출로 끝난다:
 *   ① `launch` → 세션 선생성 + 임베드 파라미터(`embed`) 수령 → 호스트가 `/embed` 로 진입
 *   ② 편집 완료(웹훅 `synthesis.*` 또는 `waitForDeliverables`) → `deliverables` 로 파일 수령
 * `synthesize` 는 `duplex-split` 세트의 재합성(세대 `revision` +1) 전용이다.
 *
 * 인증: 사이트 **editor 키**(X-API-Key)만. 워커 키는 403. env(test/live)는 키에 내재.
 * 버킷: launch·synthesize = heavy(100/min), deliverables = general(300/min).
 * 토큰: launch 가 돌려주는 `accessToken`/`refreshToken` 은 shop-session 과 같은 세션 토큰이며
 *       파트너 서버 API 키와 별개다 — 브라우저(iframe)로만 흘려보낸다.
 */

import { StorigeUsageError, TERMINAL_DELIVERABLE_STATUSES } from '../index';
import type {
  SessionDeliverableStatus,
  SessionDeliverables,
  SessionLaunchInput,
  SessionLaunchResult,
  SessionSynthesizeResult,
} from '../types';
import type { HttpClient, RequestOptions } from './http';

/** 산출물 폴링 옵션 */
export interface WaitForDeliverablesOptions extends RequestOptions {
  /** 폴링 간격 시작값(ms). 지수 증가 */
  intervalMs?: number;
  /** 폴링 간격 상한(ms) */
  maxIntervalMs?: number;
  /** 전체 대기 상한(ms). 초과 시 StorigeUsageError */
  timeoutMs?: number;
  /**
   * 탈출 조건. 기본 'ready'.
   *
   * - 'ready'    — `ready` 또는 `failed` 에서 반환(최종 산출물 대기)
   * - 'complete' — 편집이 끝나면(`complete`·`synthesizing`·`ready`·`failed`) 반환.
   *                `duplex-split` 세트에서 편집 완료 직후 `synthesize` 를 부르거나,
   *                합성 대상이 아닌 세트에서 `ready` 가 영영 오지 않을 때 쓴다
   */
  until?: 'ready' | 'complete';
  /** 상태 전이 관찰 훅 */
  onPoll?: (view: SessionDeliverables) => void;
}

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_POLL_MAX_INTERVAL_MS = 15_000;
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;

/** `until:'complete'` 탈출 집합 — editing 만 아니면 된다 */
const EDIT_FINISHED_STATUSES: readonly SessionDeliverableStatus[] = [
  'complete',
  'synthesizing',
  'ready',
  'failed',
];

export class SessionsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * POST /api/v1/sessions/launch — 세션 선생성 + 임베드 파라미터 발급(201). heavy 버킷.
   *
   * JSON 본문이라 Idempotency-Key 가 **자동 부여**된다 — 네트워크 재시도가 세션을
   * 중복 생성하지 않는다. 파트너 주문 단위로 키를 고정하려면 `options.idempotencyKey`
   * 를 명시한다(같은 키 + 같은 본문 = 같은 세션 재응답).
   *
   * 응답 `embed` 는 `@storige/sdk/embed` `mountEditor({ params })` 에 그대로 넣는다.
   *
   * @throws StorigeApiError ERR_VALIDATION_FAILED(400) — member.seqno<1·templateSetId 누락·
   *         callbackUrl 이 https 아님·items/externalPhotos 500 초과 등
   * @throws StorigeApiError ERR_FORBIDDEN(403) — 워커 키 등 사이트 editor 키가 아님
   * @throws StorigeApiError ERR_NOT_FOUND(404) — 템플릿셋 없음/타 사이트 스코프
   * @throws StorigeApiError ERR_SERVICE_UNAVAILABLE(503) — 런처 킬스위치 off
   */
  async launch(input: SessionLaunchInput, options?: RequestOptions): Promise<SessionLaunchResult> {
    return this.http.request<SessionLaunchResult>({
      method: 'POST',
      path: '/sessions/launch',
      json: input,
      options,
    });
  }

  /**
   * GET /api/v1/sessions/{id}/deliverables — 산출물 조회. general 버킷.
   *
   * `files[].auth` 가 'api-key' 면 같은 X-API-Key 로 GET, 'signed' 면 서명 URL(300초).
   * 서명 URL 이 만료되면 이 라우트를 다시 불러 새 URL 을 받는다.
   *
   * @throws StorigeApiError ERR_NOT_FOUND(404) — 없음/타 site/타 env(존재 은닉)
   */
  async deliverables(id: string, options?: RequestOptions): Promise<SessionDeliverables> {
    return this.http.request<SessionDeliverables>({
      method: 'GET',
      path: `/sessions/${encodeURIComponent(id)}/deliverables`,
      options,
    });
  }

  /**
   * POST /api/v1/sessions/{id}/synthesize — 재합성 착수(201, `revision` +1). heavy 버킷.
   *
   * 본문이 없어(JSON none) Idempotency-Key 가 자동 부여된다. 완료는 웹훅
   * `synthesis.completed/failed`(payload `revision` 으로 세대 대조) 또는
   * `waitForDeliverables` 로 받는다.
   *
   * @throws StorigeApiError ERR_SESSION_NOT_COMPLETE(409) — 편집 완료 전
   * @throws StorigeApiError ERR_OUTPUT_MODE_UNSUPPORTED(422) — 템플릿셋 pdfOutputMode 가
   *         'duplex-split' 이 아님(재합성 대상 아님)
   * @throws StorigeApiError ERR_NOT_FOUND(404) — 없음/타 site/타 env
   * @throws StorigeApiError ERR_SERVICE_UNAVAILABLE(503) — 런처 킬스위치 off
   */
  async synthesize(id: string, options?: RequestOptions): Promise<SessionSynthesizeResult> {
    return this.http.request<SessionSynthesizeResult>({
      method: 'POST',
      path: `/sessions/${encodeURIComponent(id)}/synthesize`,
      options,
    });
  }

  /**
   * 산출물 상태가 `until` 조건에 닿을 때까지 폴링.
   *
   * ⚠️ **웹훅 병행을 권장한다**(books.waitForFinalization 과 같은 이유) — 웹훅이 정본
   *    알림 경로이고 폴링은 유실·지연 시 백스톱이다. deliverables 는 general(300/min)
   *    버킷이라 여유가 있으나 다수 세션 동시 폴링은 리밋에 닿는다.
   *
   * `failed` 는 **예외가 아니라 값으로** 반환한다 — `status` 로 분기한다.
   */
  async waitForDeliverables(
    id: string,
    options: WaitForDeliverablesOptions = {},
  ): Promise<SessionDeliverables> {
    const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const maxIntervalMs = options.maxIntervalMs ?? DEFAULT_POLL_MAX_INTERVAL_MS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
    const until = options.until ?? 'ready';
    if (until !== 'ready' && until !== 'complete') {
      throw new StorigeUsageError(`until 은 'ready' 또는 'complete' 여야 합니다 (받은 값: ${String(until)})`);
    }
    const exitStatuses = until === 'ready' ? TERMINAL_DELIVERABLE_STATUSES : EDIT_FINISHED_STATUSES;
    const deadline = Date.now() + timeoutMs;

    let attempt = 0;
    for (;;) {
      const view = await this.deliverables(id, {
        signal: options.signal,
        headers: options.headers,
        retry: options.retry,
      });
      options.onPoll?.(view);

      if (exitStatuses.includes(view.status)) return view;

      if (Date.now() >= deadline) {
        throw new StorigeUsageError(
          `산출물 대기 시간(${timeoutMs}ms) 초과 — 마지막 status=${view.status}(until=${until}). ` +
            '웹훅 수신으로 전환하거나 timeoutMs 를 늘리세요',
        );
      }

      const delay = Math.min(intervalMs * 2 ** attempt, maxIntervalMs);
      const remaining = deadline - Date.now();
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(delay, remaining))));
      attempt += 1;
    }
  }
}
