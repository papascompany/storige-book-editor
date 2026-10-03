/**
 * 종결 웹훅 발신 장부(JobCallbackLedger) — Map 기반 가짜 Redis.
 */
import { CallbackLedgerRedis, JobCallbackLedger } from './job-callback-ledger';

class FakeRedis implements CallbackLedgerRedis {
  readonly store = new Map<string, string>();
  readonly set = jest.fn(
    async (key: string, value: string, _px: 'PX', _ttl: number, nx?: 'NX'): Promise<'OK' | null> => {
      if (nx === 'NX' && this.store.has(key)) return null;
      this.store.set(key, value);
      return 'OK';
    },
  ) as unknown as CallbackLedgerRedis['set'] & jest.Mock;
  readonly get = jest.fn(async (key: string) => this.store.get(key) ?? null);
  readonly del = jest.fn(async (key: string) => (this.store.delete(key) ? 1 : 0));
}

describe('JobCallbackLedger', () => {
  let redis: FakeRedis;
  let warn: jest.Mock;
  let ledger: JobCallbackLedger;
  const KEY = 'storige:job-callback:job-1:COMPLETED';

  beforeEach(() => {
    redis = new FakeRedis();
    warn = jest.fn();
    ledger = new JobCallbackLedger(() => redis, { warn });
  });

  it('키 형식은 storige:job-callback:<jobId>:<status>', () => {
    expect(JobCallbackLedger.keyOf('job-1', 'COMPLETED')).toBe(KEY);
  });

  it('빈 키 claim → claimed, sending 을 PX 60000 NX 로 기록', async () => {
    await expect(ledger.claim('job-1', 'COMPLETED')).resolves.toBe('claimed');
    expect(redis.set).toHaveBeenCalledWith(KEY, 'sending', 'PX', 60_000, 'NX');
    expect(redis.store.get(KEY)).toBe('sending');
  });

  it("키 값이 'sent' 면 sent, 'sending' 이면 inFlight", async () => {
    redis.store.set(KEY, 'sent');
    await expect(ledger.claim('job-1', 'COMPLETED')).resolves.toBe('sent');
    redis.store.set(KEY, 'sending');
    await expect(ledger.claim('job-1', 'COMPLETED')).resolves.toBe('inFlight');
  });

  it('선점 실패 뒤 읽는 사이 키가 만료되면 1회 다시 선점한다', async () => {
    (redis.set as jest.Mock).mockResolvedValueOnce(null);
    await expect(ledger.claim('job-1', 'COMPLETED')).resolves.toBe('claimed');
    expect(redis.set).toHaveBeenCalledTimes(2);
  });

  it('markSent 는 sent 를 PX 7일로 기록, release 는 키를 지운다', async () => {
    await ledger.markSent('job-1', 'COMPLETED');
    expect(redis.set).toHaveBeenCalledWith(KEY, 'sent', 'PX', 604_800_000);
    expect(redis.store.get(KEY)).toBe('sent');
    await ledger.release('job-1', 'COMPLETED');
    expect(redis.del).toHaveBeenCalledWith(KEY);
    expect(redis.store.has(KEY)).toBe(false);
  });

  it('client 가 없으면 unavailable 과 warn 1줄', async () => {
    const noClient = new JobCallbackLedger(() => undefined, { warn });
    await expect(noClient.claim('job-1', 'COMPLETED')).resolves.toBe('unavailable');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('set 이 throw 하면 unavailable 과 warn 1줄(jobId·키 미기록)', async () => {
    (redis.set as jest.Mock).mockRejectedValueOnce(new Error('redis down'));
    await expect(ledger.claim('job-1', 'COMPLETED')).resolves.toBe('unavailable');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('[job-callback] ledger unavailable op=claim reason=error');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('job-1');
  });

  it('응답이 시간 제한을 넘기면 unavailable(reason=timeout)', async () => {
    const slow = new JobCallbackLedger(() => redis, { warn }, 20);
    (redis.set as jest.Mock).mockImplementationOnce(() => new Promise<'OK'>(() => undefined));
    await expect(slow.claim('job-1', 'COMPLETED')).resolves.toBe('unavailable');
    expect(warn).toHaveBeenCalledWith('[job-callback] ledger unavailable op=claim reason=timeout');
  });

  it('markSent·release 오류는 삼키고 warn 만 남긴다', async () => {
    (redis.set as jest.Mock).mockRejectedValueOnce(new Error('x'));
    redis.del.mockRejectedValueOnce(new Error('y'));
    await expect(ledger.markSent('job-1', 'COMPLETED')).resolves.toBeUndefined();
    await expect(ledger.release('job-1', 'COMPLETED')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('기본 시간 제한은 400ms, SENDING TTL 60초', () => {
    expect(JobCallbackLedger.OP_TIMEOUT_MS).toBe(400);
    expect(JobCallbackLedger.SENDING_TTL_MS).toBe(60_000);
  });
});
