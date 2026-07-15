/**
 * 웹훅 발신 시점 SSRF 가드 (SEC/SSRF, 2026-07-16) — 정본 방어선 회귀.
 *
 * allowlist(호스트 문자열) 를 통과해도, 발신 직전 실 IP 해석이 사설/링크로컬/
 * 루프백/메타데이터 대역이면 axios.post 자체가 일어나선 안 된다:
 *  - 공개 DNS 이름 → 내부 IP A레코드(리바인딩)
 *  - IPv4-mapped IPv6 리터럴 / 정수 IP 표기
 * 정상 공개 호스트(공인 IP 해석)는 그대로 발신(무중단).
 *
 * dns/promises.lookup 을 mock 해 결정론화 — 실 네트워크 미사용.
 */
import axios from 'axios';
import { lookup } from 'dns/promises';
import { WebhookService, SynthesisWebhookPayload } from './webhook.service';

jest.mock('axios');
jest.mock('dns/promises', () => ({ lookup: jest.fn() }));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedLookup = lookup as jest.MockedFunction<typeof lookup>;

const payload: SynthesisWebhookPayload = {
  event: 'synthesis.completed',
  jobId: 'job-uuid-ssrf',
  status: 'completed',
  outputFileUrl: '/storage/outputs/merged.pdf',
  timestamp: '2026-07-16T00:00:00Z',
} as SynthesisWebhookPayload;

describe('WebhookService — 발신 시점 SSRF 가드', () => {
  let prevHosts: string | undefined;

  beforeEach(() => {
    prevHosts = process.env.WEBHOOK_ALLOWED_HOSTS;
    // allowlist 를 와일드카드로 열어 발신 시점 가드만 게이트로 남긴다
    process.env.WEBHOOK_ALLOWED_HOSTS = '*';
    mockedAxios.post.mockReset();
    mockedAxios.post.mockResolvedValue({ status: 200, data: 'ok' } as never);
    mockedLookup.mockReset();
  });

  afterEach(() => {
    if (prevHosts === undefined) delete process.env.WEBHOOK_ALLOWED_HOSTS;
    else process.env.WEBHOOK_ALLOWED_HOSTS = prevHosts;
  });

  it('공개 DNS 이름이 내부 IP 로 해석되면 차단 — axios.post 미호출', async () => {
    mockedLookup.mockResolvedValue([
      { address: '169.254.169.254', family: 4 },
    ] as never);
    const svc = new WebhookService();

    const ok = await svc.sendCallback(
      'https://rebind.attacker.example/hook',
      payload,
    );

    expect(ok).toBe(false);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('IPv4-mapped IPv6 리터럴 차단 — DNS 조회 없이 axios.post 미호출', async () => {
    const svc = new WebhookService();
    const ok = await svc.sendCallback(
      'http://[::ffff:169.254.169.254]/latest/meta-data',
      payload,
    );
    expect(ok).toBe(false);
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it('정수 IP 표기(2130706433=127.0.0.1) 차단', async () => {
    const svc = new WebhookService();
    const ok = await svc.sendCallback('http://2130706433/hook', payload);
    expect(ok).toBe(false);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('정상 공개 호스트(공인 IP 해석)는 발신 — axios.post 1회', async () => {
    mockedLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never);
    const svc = new WebhookService();

    const ok = await svc.sendCallback(
      'https://www.bookmoa.com/api/storige/webhook',
      payload,
    );

    expect(ok).toBe(true);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post.mock.calls[0][0]).toBe(
      'https://www.bookmoa.com/api/storige/webhook',
    );
  });
});
