/**
 * 중복 배달 단락(멱등) — `X-Storige-Delivery`(whd_...) 기반.
 *
 * ============================================================================
 * 수신측 멱등은 선택이 아니라 필수다
 * ============================================================================
 * 서버는 같은 delivery 를 **최대 4회** 보낸다:
 *   인라인 최초 1회 + 전용 큐 재시도 3회(1분 / 5분 / 30분)
 *   — apps/api/src/webhook/v2/webhook-v2.constants.ts
 *     WEBHOOK_RETRY_DELAYS_MS / WEBHOOK_MAX_QUEUE_RETRIES
 * 여기에 수동 재발송(POST /api/v1/webhooks/deliveries/:uid/retry)이 더해질 수
 * 있다. 재시도는 **payload 바이트가 불변**이고 서명만 새 t 로 재계산되므로,
 * "서명이 유효하다"만으로는 첫 배달인지 4번째인지 구분할 수 없다.
 *
 * 판별 키는 **X-Storige-Delivery 헤더값(whd_...)** 이다. 같은 delivery 의 모든
 * 재시도는 같은 uid 를 쓴다(webhook-delivery.service.ts — uid 는 행 생성 시
 * 1회 발급되고 재시도가 재사용한다).
 *
 * ⚠️ jobId 로 dedupe 하지 말 것: 한 job 이 서로 다른 이벤트(validation.completed
 *    → synthesis.completed)를 각각 발신하므로 jobId 기준 단락은 **정상 이벤트를
 *    삼킨다**. uid 는 배달 1건에 1:1 이다.
 *
 * ⚠️ v1 발신 경로(전역 secret)는 X-Storige-Delivery 를 **보내지 않는다** →
 *    이 헬퍼로 dedupe 할 수 없다. v1 수신측은 (event, identifier) 조합 등
 *    자체 키를 쓰거나, v2 config 등록으로 전환해야 한다.
 */

/**
 * 중복 배달 판별기 — 저장소는 사용자가 주입한다(Redis/DB 등).
 *
 * ## 구현 계약
 * `claim` 은 **원자적 check-and-set** 이어야 한다. "조회 후 저장" 2단계로
 * 구현하면 동시 배달에서 둘 다 true 를 받아 멱등이 깨진다.
 *
 * @example Redis 구현 (SET NX EX 로 원자성 확보)
 * ```ts
 * const deduper: WebhookDeduper = {
 *   async claim(uid) {
 *     // NX: 없을 때만 세팅 → 세팅됐으면 최초 관측
 *     return (await redis.set(`storige:whd:${uid}`, '1', 'EX', 86400, 'NX')) === 'OK';
 *   },
 *   async release(uid) {
 *     await redis.del(`storige:whd:${uid}`);
 *   },
 * };
 * ```
 *
 * @example DB 구현 (uid UNIQUE 제약이 원자성을 준다)
 * ```ts
 * const deduper: WebhookDeduper = {
 *   async claim(uid) {
 *     try { await db.insert({ uid }); return true; }
 *     catch (e) { if (isUniqueViolation(e)) return false; throw e; }
 *   },
 *   async release(uid) { await db.delete({ uid }); },
 * };
 * ```
 */
export interface WebhookDeduper {
  /**
   * delivery uid 선점.
   *
   * @returns `true` = 최초 관측 → 처리 진행 / `false` = 이미 본 배달 → 단락
   */
  claim(deliveryUid: string): boolean | Promise<boolean>;

  /**
   * 선점 해제 — 핸들러가 **실패**해 다음 재시도에서 다시 처리돼야 할 때 호출된다.
   *
   * ## 이 메서드를 구현하는지가 전달 보장을 가른다
   *  - **구현함(권장) = at-least-once**: 핸들러가 던지면 선점을 풀고 5xx 를
   *    반환한다 → 서버 재시도가 다시 처리한다. 단, 핸들러가 부분적으로 부수효과를
   *    남긴 뒤 던졌다면 그 부분은 재실행된다 → 핸들러 자체도 멱등해야 한다.
   *  - **구현 안 함 = at-most-once**: 선점이 남아 있어 이후 재시도가 전부
   *    단락된다 → **핸들러가 한 번 실패하면 그 이벤트는 영영 유실된다**.
   *    유실보다 중복이 나쁜 경우에만 의도적으로 생략하라.
   *
   * 어댑터는 이 메서드가 있으면 핸들러 예외 시 best-effort 로 호출한다
   * (release 자체가 실패해도 원래 예외를 덮지 않는다).
   */
  release?(deliveryUid: string): void | Promise<void>;
}

export interface InMemoryWebhookDeduperOptions {
  /**
   * 기억 창(ms) — 기본 24시간.
   *
   * 서버 재시도 체인은 최대 ~36분(1+5+30)이라 24시간이면 충분히 덮는다.
   * v1 멱등 스냅샷 TTL(24h)과 같은 값으로 맞췄다. 창을 벗어난 뒤 도착한
   * 수동 재발송은 **다시 처리된다**(안전성 vs 활성 트레이드오프).
   */
  ttlMs?: number;
  /**
   * 최대 보관 개수 — 기본 10,000. 초과하면 가장 오래된 항목부터 버린다.
   * 무한 증가(메모리 누수)를 막기 위한 상한이며, 버려진 uid 가 다시 오면
   * 중복 처리된다.
   */
  maxEntries?: number;
  /** 현재 시각(ms) 주입 — 테스트용. 기본 `Date.now` */
  now?: () => number;
}

/**
 * 🚧 **참조용 인메모리 구현 — 프로덕션 부적합**.
 *
 * 로컬 개발·테스트·단일 프로세스 데모용이다. 프로덕션에서 쓰면 안 되는 이유:
 *
 *  ① **다중 인스턴스에서 무력화된다.** 프로세스마다 별도 Map 을 가지므로
 *     인스턴스 A 가 처리한 배달을 인스턴스 B 가 다시 처리한다. 오토스케일·
 *     블루그린·서버리스(요청마다 새 격리)에서는 사실상 dedupe 가 없는 것과 같다.
 *  ② **재시작하면 전부 잊는다.** 배포·크래시 직후 도착한 재시도는 중복 처리된다.
 *  ③ **메모리 상한이 곧 정확도 상한이다.** maxEntries 를 넘으면 오래된 uid 를
 *     버리므로 그 uid 의 재배달은 단락되지 않는다.
 *
 * → 프로덕션은 **공유 저장소 기반**으로 주입하라({@link WebhookDeduper} 의
 *   Redis `SET NX EX` / DB UNIQUE 예제 참조).
 */
export class InMemoryWebhookDeduper implements WebhookDeduper {
  /** uid → 만료 시각(ms). 삽입 순서 = 만료 순서(TTL 균일)라 앞에서부터 정리 가능. */
  private readonly seen = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: InMemoryWebhookDeduperOptions = {}) {
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
    this.maxEntries = options.maxEntries ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  claim(deliveryUid: string): boolean {
    const now = this.now();
    this.pruneExpired(now);

    const expiresAt = this.seen.get(deliveryUid);
    if (expiresAt !== undefined && expiresAt > now) return false; // 이미 본 배달

    // delete → set 으로 삽입 순서를 갱신한다(Map 은 기존 키 재대입 시 순서 유지).
    // 순서가 곧 만료 순서라는 불변식이 pruneExpired 의 조기 중단을 떠받친다.
    this.seen.delete(deliveryUid);
    this.seen.set(deliveryUid, now + this.ttlMs);
    this.evictOverflow();
    return true;
  }

  release(deliveryUid: string): void {
    this.seen.delete(deliveryUid);
  }

  /** 현재 기억 중인 배달 수 — 테스트/관측용 */
  get size(): number {
    this.pruneExpired(this.now());
    return this.seen.size;
  }

  /** 전부 잊는다 — 테스트용 */
  clear(): void {
    this.seen.clear();
  }

  /** 만료분 정리 — 삽입 순서=만료 순서라 첫 미만료에서 멈춘다(O(만료 개수)) */
  private pruneExpired(now: number): void {
    for (const [uid, expiresAt] of this.seen) {
      if (expiresAt > now) break;
      this.seen.delete(uid);
    }
  }

  private evictOverflow(): void {
    while (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next();
      if (oldest.done === true) break;
      this.seen.delete(oldest.value);
    }
  }
}
