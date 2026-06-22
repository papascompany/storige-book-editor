/**
 * WH-001(2026-06-22) 회귀 — 웹훅 서명 헤더.
 *
 * 기존 base64 서명(X-Storige-Signature)은 항상 전송(계약 호환)하고,
 * WEBHOOK_SECRET 설정 시에만 위조 불가 HMAC 서명(X-Storige-Signature-HMAC, t=,v1= 포맷)을
 * 추가로 함께 보낸다(비파괴). 미설정 시 HMAC 헤더는 생략돼 현행 동작이 보존돼야 한다.
 */
import { createHmac } from 'crypto';
import { WebhookService, SynthesisWebhookPayload } from './webhook.service';

describe('WebhookService — 서명 헤더 (WH-001)', () => {
  const payload: SynthesisWebhookPayload = {
    event: 'synthesis.completed',
    jobId: 'job-uuid-456',
    status: 'completed',
    outputFileUrl: '/storage/outputs/merged.pdf',
    timestamp: '2026-06-22T00:00:00Z',
  } as SynthesisWebhookPayload;

  let prevSecret: string | undefined;
  beforeEach(() => {
    prevSecret = process.env.WEBHOOK_SECRET;
  });
  afterEach(() => {
    if (prevSecret === undefined) delete process.env.WEBHOOK_SECRET;
    else process.env.WEBHOOK_SECRET = prevSecret;
  });

  function build(): Record<string, string> {
    const svc = new WebhookService();
    return (svc as any).buildHeaders(payload);
  }

  it('WEBHOOK_SECRET 미설정: base64 서명만, HMAC 헤더 없음(현행 보존)', () => {
    delete process.env.WEBHOOK_SECRET;
    const h = build();
    expect(h['X-Storige-Signature']).toBeDefined();
    // base64 디코딩 가능해야 함(레거시 계약)
    expect(() => Buffer.from(h['X-Storige-Signature'], 'base64')).not.toThrow();
    expect(h['X-Storige-Signature-HMAC']).toBeUndefined();
  });

  it('WEBHOOK_SECRET 설정: base64 + HMAC(t=,v1=) 병행', () => {
    process.env.WEBHOOK_SECRET = 'test-secret-key';
    const h = build();
    expect(h['X-Storige-Signature']).toBeDefined(); // 레거시 헤더 유지
    const hmac = h['X-Storige-Signature-HMAC'];
    expect(hmac).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it('HMAC 값이 WEBHOOK_SECRET 으로 검증 가능(위조 불가 — 키 없으면 재현 불가)', () => {
    process.env.WEBHOOK_SECRET = 'super-secret';
    const h = build();
    const m = h['X-Storige-Signature-HMAC'].match(/^t=(\d+),v1=([0-9a-f]{64})$/);
    expect(m).not.toBeNull();
    const [, t, v1] = m!;
    // 수신측 검증 재현: 동일 데이터 `${t}.${jobId}:${event}:${timestamp}` 를 같은 키로 HMAC
    const data = `${t}.${payload.jobId}:${payload.event}:${payload.timestamp}`;
    const expected = createHmac('sha256', 'super-secret').update(data).digest('hex');
    expect(v1).toBe(expected);
    // 틀린 키로는 불일치(위조 방어)
    const wrong = createHmac('sha256', 'wrong-key').update(data).digest('hex');
    expect(v1).not.toBe(wrong);
  });
});
