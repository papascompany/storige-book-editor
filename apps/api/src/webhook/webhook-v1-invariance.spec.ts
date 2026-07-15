/**
 * 기존 v1 발신 바이트 불변 스냅샷 (Stage 2 절대 불변 게이트).
 *
 * webhook_configs 가 **없는** 사이트(=기존 파트너 전원)의 발신은 Stage 2
 * 변경(sendCallback context 파라미터 추가) 이후에도 v2 미도입 시절과
 * 바이트/헤더 단위로 동일해야 한다:
 *
 *  - 기준선: v2 서비스 미주입 WebhookService (= Stage 2 이전 실물 경로)
 *  - 대상: v2 서비스 주입 + config 없음(tryDispatchForSite→null) + siteId 전달
 *  → 두 경로의 axios 호출(URL·payload·headers·timeout)이 완전 동일해야 green.
 *
 * 추가 고정:
 *  - context 미전달 호출(기존 시그니처)은 v2 조회조차 없음
 *  - WEBHOOK_SECRET 유무 각각에서 헤더 집합 동일(Date.now 고정으로 HMAC 까지 동일)
 */
import axios from 'axios';
import { WebhookService, SynthesisWebhookPayload } from './webhook.service';
import type { WebhookDeliveryService } from './v2/webhook-delivery.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const payload: SynthesisWebhookPayload = {
  event: 'synthesis.completed',
  jobId: 'job-uuid-999',
  status: 'completed',
  outputFileUrl: '/storage/outputs/merged.pdf',
  timestamp: '2026-07-15T00:00:00Z',
} as SynthesisWebhookPayload;

const CALLBACK_URL = 'https://www.bookmoa.com/api/storige/webhook';

/** config 없는 사이트를 흉내내는 v2 스텁 — 실물 시그니처와 동일 반환 계약 */
function makeNoConfigV2Stub() {
  return {
    tryDispatchForSite: jest.fn(async () => null),
    hasActiveConfig: jest.fn(async () => false),
  } as unknown as WebhookDeliveryService & {
    tryDispatchForSite: jest.Mock;
    hasActiveConfig: jest.Mock;
  };
}

type CapturedCall = [
  string,
  unknown,
  { headers: Record<string, string>; timeout: number },
];

async function captureAxiosCall(
  service: WebhookService,
  context?: { siteId?: string | null },
): Promise<CapturedCall> {
  mockedAxios.post.mockClear();
  mockedAxios.post.mockResolvedValue({ status: 200, data: 'ok' });
  const ok = await service.sendCallback(CALLBACK_URL, payload, context);
  expect(ok).toBe(true);
  expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  return mockedAxios.post.mock.calls[0] as unknown as CapturedCall;
}

describe('v1 발신 바이트 불변 — config 없는 사이트 경로 스냅샷', () => {
  let prevSecret: string | undefined;
  let prevHosts: string | undefined;
  beforeEach(() => {
    prevSecret = process.env.WEBHOOK_SECRET;
    prevHosts = process.env.WEBHOOK_ALLOWED_HOSTS;
    delete process.env.WEBHOOK_SECRET;
    delete process.env.WEBHOOK_ALLOWED_HOSTS;
  });
  afterEach(() => {
    if (prevSecret === undefined) delete process.env.WEBHOOK_SECRET;
    else process.env.WEBHOOK_SECRET = prevSecret;
    if (prevHosts === undefined) delete process.env.WEBHOOK_ALLOWED_HOSTS;
    else process.env.WEBHOOK_ALLOWED_HOSTS = prevHosts;
    jest.restoreAllMocks();
  });

  it('기준선(v2 미주입) == 대상(v2 주입+config 없음+siteId 전달) — URL·payload·headers·timeout 동일', async () => {
    const baseline = new WebhookService(); // Stage 2 이전 실물 경로
    const v2Stub = makeNoConfigV2Stub();
    const candidate = new WebhookService(undefined, v2Stub);

    const [baseUrl, basePayload, baseOptions] = await captureAxiosCall(baseline);
    const [candUrl, candPayload, candOptions] = await captureAxiosCall(
      candidate,
      { siteId: 'site-without-config' },
    );

    // v2 opt-in 판정은 일어나되(스텁 1회 호출) 결과는 null → 레거시 폴스루
    expect(v2Stub.tryDispatchForSite).toHaveBeenCalledTimes(1);

    // 발신 바이트/헤더/옵션 완전 동일
    expect(candUrl).toBe(baseUrl);
    expect(candPayload).toEqual(basePayload);
    expect(candPayload).toBe(payload); // 직렬화 대상 객체 자체가 동일(바이트 동일)
    expect(candOptions).toEqual(baseOptions);
    expect(Object.keys(candOptions.headers).sort()).toEqual(
      ['Content-Type', 'X-Storige-Event', 'X-Storige-Signature'].sort(),
    );
    // v2 전용 헤더가 레거시 경로에 새지 않는다
    expect(candOptions.headers['X-Storige-Delivery']).toBeUndefined();
    expect(candOptions.headers['X-Storige-Signature-HMAC']).toBeUndefined();
  });

  it('WEBHOOK_SECRET 설정 시에도 동일 (Date.now 고정 — HMAC 값까지 일치)', async () => {
    process.env.WEBHOOK_SECRET = 'global-legacy-secret';
    jest.spyOn(Date, 'now').mockReturnValue(1752537600000);

    const baseline = new WebhookService();
    const candidate = new WebhookService(undefined, makeNoConfigV2Stub());

    const [, , baseOptions] = await captureAxiosCall(baseline);
    const [, , candOptions] = await captureAxiosCall(candidate, {
      siteId: 'site-without-config',
    });

    expect(candOptions).toEqual(baseOptions);
    expect(Object.keys(candOptions.headers).sort()).toEqual(
      [
        'Content-Type',
        'X-Storige-Event',
        'X-Storige-Signature',
        'X-Storige-Signature-HMAC',
      ].sort(),
    );
  });

  it('context 미전달(기존 시그니처 호출)은 v2 조회 자체가 없다', async () => {
    const v2Stub = makeNoConfigV2Stub();
    const service = new WebhookService(undefined, v2Stub);
    await captureAxiosCall(service);
    expect(v2Stub.tryDispatchForSite).not.toHaveBeenCalled();
  });

  it('hasV2Config: siteId 없음/v2 미주입이면 DB 접근 없이 false (기존 스킵 판정 보존)', async () => {
    const legacy = new WebhookService();
    await expect(legacy.hasV2Config('site-a')).resolves.toBe(false);
    await expect(legacy.hasV2Config(null)).resolves.toBe(false);

    const v2Stub = makeNoConfigV2Stub();
    const service = new WebhookService(undefined, v2Stub);
    await expect(service.hasV2Config(undefined)).resolves.toBe(false);
    expect(v2Stub.hasActiveConfig).not.toHaveBeenCalled();
    await expect(service.hasV2Config('site-a')).resolves.toBe(false);
    expect(v2Stub.hasActiveConfig).toHaveBeenCalledWith('site-a', 'live');
  });
});
