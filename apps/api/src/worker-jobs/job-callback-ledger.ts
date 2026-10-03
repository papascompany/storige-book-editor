import type { Logger } from '@nestjs/common';

/**
 * 잡 종결 웹훅(synthesis.*·validation.*) 발신 장부 — Redis 키 `storige:job-callback:<jobId>:<status>`.
 *
 *  - claim: 발신 직전 'sending'(SENDING_TTL_MS) 을 NX 로 선점한다.
 *      선점 성공 → 'claimed', 이미 'sent' → 'sent', 이미 'sending' → 'inFlight'.
 *  - markSent: 발신 성공(또는 재시도 체인 접수) 뒤 'sent'(SENT_TTL_MS).
 *  - release: 발신 실패 뒤 키 삭제 — 다음 같은 종결 보고가 다시 발신한다.
 *
 * 장부 연산마다 OP_TIMEOUT_MS 시간 제한을 둔다. 제한을 넘기거나 오류가 나거나 클라이언트가 없으면
 * claim 은 'unavailable' 을 돌려주고(호출측은 발신 = fail-open), markSent·release 는 조용히 끝난다.
 * 로그에는 키·jobId·값을 남기지 않는다. 장부 내용은 어떤 API 응답에도 실리지 않는다.
 */

/** 장부가 쓰는 Redis 명령만 좁힌 형태(Bull 큐의 ioredis client 와 호환). */
export interface CallbackLedgerRedis {
  set(key: string, value: string, px: 'PX', ttlMs: number, nx: 'NX'): Promise<'OK' | null>;
  set(key: string, value: string, px: 'PX', ttlMs: number): Promise<'OK' | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
}

export type CallbackClaim = 'claimed' | 'sent' | 'inFlight' | 'unavailable';

const SENDING = 'sending';
const SENT = 'sent';

class LedgerTimeoutError extends Error {}

export class JobCallbackLedger {
  static readonly KEY_PREFIX = 'storige:job-callback:';
  static readonly SENDING_TTL_MS = 60_000;
  static readonly SENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  static readonly OP_TIMEOUT_MS = 400;

  constructor(
    private readonly redis: () => CallbackLedgerRedis | undefined,
    private readonly logger: Pick<Logger, 'warn'>,
    private readonly opTimeoutMs: number = JobCallbackLedger.OP_TIMEOUT_MS,
  ) {}

  static keyOf(jobId: string, status: string): string {
    return `${JobCallbackLedger.KEY_PREFIX}${jobId}:${status}`;
  }

  async claim(jobId: string, status: string): Promise<CallbackClaim> {
    const client = this.client();
    if (!client) return 'unavailable';
    const key = JobCallbackLedger.keyOf(jobId, status);
    try {
      return await this.withTimeout(async () => {
        const first = await client.set(key, SENDING, 'PX', JobCallbackLedger.SENDING_TTL_MS, 'NX');
        if (first === 'OK') return 'claimed';
        const existing = await client.get(key);
        if (existing === SENT) return 'sent';
        if (existing !== null) return 'inFlight';
        // 읽는 사이 만료 — 1회 다시 선점한다.
        const second = await client.set(key, SENDING, 'PX', JobCallbackLedger.SENDING_TTL_MS, 'NX');
        return second === 'OK' ? 'claimed' : 'inFlight';
      });
    } catch (err: unknown) {
      this.warnUnavailable('claim', err);
      return 'unavailable';
    }
  }

  async markSent(jobId: string, status: string): Promise<void> {
    const client = this.client();
    if (!client) return;
    const key = JobCallbackLedger.keyOf(jobId, status);
    try {
      await this.withTimeout(() => client.set(key, SENT, 'PX', JobCallbackLedger.SENT_TTL_MS));
    } catch (err: unknown) {
      this.warnUnavailable('markSent', err);
    }
  }

  async release(jobId: string, status: string): Promise<void> {
    const client = this.client();
    if (!client) return;
    const key = JobCallbackLedger.keyOf(jobId, status);
    try {
      await this.withTimeout(() => client.del(key));
    } catch (err: unknown) {
      this.warnUnavailable('release', err);
    }
  }

  private client(): CallbackLedgerRedis | undefined {
    try {
      const c = this.redis();
      if (!c) this.logger.warn('[job-callback] ledger unavailable op=client reason=no-client');
      return c;
    } catch {
      this.logger.warn('[job-callback] ledger unavailable op=client reason=error');
      return undefined;
    }
  }

  private warnUnavailable(op: string, err: unknown): void {
    const reason = err instanceof LedgerTimeoutError ? 'timeout' : 'error';
    this.logger.warn(`[job-callback] ledger unavailable op=${op} reason=${reason}`);
  }

  private async withTimeout<T>(run: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new LedgerTimeoutError()), this.opTimeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([run(), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
