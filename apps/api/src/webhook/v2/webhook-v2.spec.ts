/**
 * 웹훅 v2 (Stage 2 작업 5) 단위 계약 spec.
 *
 *  ① HMAC 서명 벡터 고정 — t=,v1= 정본 형식(WH-001 데이터 규약), 사이트별 secret
 *  ② secret at-rest 암호화(AES-256-GCM) 왕복 + 오키 복호화 거부
 *  ③ 재시도 스케줄 1/5/30분 + 3회 소진 EXHAUSTED + DELIVERED 멱등 단락
 *  ④ delivery 조회 테넌트 격리 (타 사이트 uid = 404)
 *  ⑤ config CRUD — secret 은 생성/회전 응답 1회만 노출
 *  ⑥ env 키 미설정 시 v2 전면 비활성(DB 조회 0 — 기존 경로 무영향)
 */
import { randomBytes } from 'crypto';
import { ErrV1 } from '@storige/types';
import axios from 'axios';
import { WebhookConfig } from '../entities/webhook-config.entity';
import { WebhookDelivery } from '../entities/webhook-delivery.entity';
import { WebhookConfigService } from './webhook-config.service';
import {
  WebhookDeliveryService,
  webhookDeliveryBackoffMs,
} from './webhook-delivery.service';
import {
  decryptWebhookSecret,
  encryptWebhookSecret,
  generateWebhookSecret,
  signWebhookV2,
} from './webhook-secret.crypto';
import {
  WEBHOOK_MAX_QUEUE_RETRIES,
  WEBHOOK_RETRY_DELAYS_MS,
} from './webhook-v2.constants';
import { PartnerApiException } from '../../partner-api/http/partner-api.exceptions';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const ENC_KEY = Buffer.alloc(32, 7); // 테스트 전용 고정 키

// ── 인메모리 repo 스텁 (where 부분일치 필터 — 테넌트 격리 검증에 충분) ──
function makeRepo<T extends { id: string }>() {
  const rows: T[] = [];
  const matches = (row: T, where: Record<string, unknown>) =>
    Object.entries(where).every(
      ([k, v]) => (row as Record<string, unknown>)[k] === v,
    );
  return {
    rows,
    create: jest.fn((data: Partial<T>) => ({ ...data }) as T),
    save: jest.fn(async (entity: T) => {
      const idx = rows.findIndex((r) => r.id === entity.id);
      if (idx >= 0) rows[idx] = entity;
      else rows.push(entity);
      return entity;
    }),
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      rows.find((r) => matches(r, where)) ?? null,
    ),
    findAndCount: jest.fn(
      async ({ where }: { where: Record<string, unknown> }) => {
        const hit = rows.filter((r) => matches(r, where));
        return [hit, hit.length] as const;
      },
    ),
    // 조건부 UPDATE(CAS) — matched-rows 기준 affected (manualRetry 원자화 검증용)
    update: jest.fn(
      async (
        where: Record<string, unknown>,
        patch: Record<string, unknown>,
      ) => {
        const hit = rows.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, patch));
        return { affected: hit.length };
      },
    ),
    delete: jest.fn(async ({ id }: { id: string }) => {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx >= 0) rows.splice(idx, 1);
    }),
  };
}

type ConfigRepo = ReturnType<typeof makeRepo<WebhookConfig>>;
type DeliveryRepo = ReturnType<typeof makeRepo<WebhookDelivery>>;

function makeServices(opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true;
  const v2Config = { enabled, encKey: enabled ? ENC_KEY : null };
  const configRepo: ConfigRepo = makeRepo<WebhookConfig>();
  const deliveryRepo: DeliveryRepo = makeRepo<WebhookDelivery>();
  const queue = { add: jest.fn(async () => undefined) };
  const configService = new WebhookConfigService(
    configRepo as never,
    v2Config,
    undefined,
  );
  const deliveryService = new WebhookDeliveryService(
    deliveryRepo as never,
    configRepo as never,
    configService,
    v2Config,
    queue as never,
  );
  return { configService, deliveryService, configRepo, deliveryRepo, queue };
}

async function seedConfig(
  configRepo: ConfigRepo,
  overrides: Partial<WebhookConfig> = {},
): Promise<WebhookConfig> {
  const { secret } = generateWebhookSecret();
  const config = Object.assign(new WebhookConfig(), {
    id: 'cfg-1',
    siteId: 'site-a',
    env: 'live' as const,
    url: 'https://partner.bookmoa.com/hook',
    secretEnc: encryptWebhookSecret(secret, ENC_KEY),
    secretPrefix: secret.slice(0, 12),
    events: [],
    status: 'active' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
  await configRepo.save(config);
  return config;
}

afterEach(() => {
  jest.clearAllMocks();
});

// ────────────────────────── ① 서명 벡터 고정 ──────────────────────────

describe('signWebhookV2 — HMAC 서명 벡터 고정 (t=,v1= 정본 형식)', () => {
  it('고정 입력 → 고정 hex (회귀 = 파트너 검증 코드 전체 파손)', () => {
    const sig = signWebhookV2(
      'whsec_testvector',
      'job-123',
      'synthesis.completed',
      '2026-07-15T00:00:00.000Z',
      1752537600,
    );
    expect(sig).toBe(
      't=1752537600,v1=6c2cae19cef5fb3a8747109ec0e83168fddb1dd1c61889a3e31112f05bdef5bd',
    );
  });

  it('형식: t=<unixsec>,v1=<64 hex> — WH-001 발신 정본과 동일 포맷', () => {
    const sig = signWebhookV2('s', 'id', 'e', 'ts', 1);
    expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it('다른 secret → 다른 서명 (사이트별 secret 격리)', () => {
    const a = signWebhookV2('secret-a', 'id', 'e', 'ts', 1);
    const b = signWebhookV2('secret-b', 'id', 'e', 'ts', 1);
    expect(a).not.toBe(b);
  });
});

// ────────────────────── ② at-rest 암호화 왕복 ──────────────────────────

describe('webhook secret at-rest 암호화 (AES-256-GCM)', () => {
  it('암호화 → 복호화 왕복 + 평문 미노출 + VARCHAR(256) 수용', () => {
    const { secret, secretPrefix } = generateWebhookSecret();
    expect(secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(secretPrefix).toBe(secret.slice(0, 12));

    const enc = encryptWebhookSecret(secret, ENC_KEY);
    expect(enc).not.toContain(secret.slice(6)); // 암호문에 평문 미포함
    expect(enc.length).toBeLessThanOrEqual(256);
    expect(decryptWebhookSecret(enc, ENC_KEY)).toBe(secret);
  });

  it('다른 키로는 복호화 실패 (GCM 무결성)', () => {
    const enc = encryptWebhookSecret('whsec_x', ENC_KEY);
    expect(() => decryptWebhookSecret(enc, randomBytes(32))).toThrow();
  });
});

// ─────────────── ③ 재시도 스케줄 + EXHAUSTED + 멱등 단락 ───────────────

describe('재시도 1/5/30분 + 3회 소진 EXHAUSTED', () => {
  it('backoff 전략: 큐 실패 1회→5분, 2회→30분 (인라인 실패→1분은 큐 delay)', () => {
    expect(WEBHOOK_RETRY_DELAYS_MS).toEqual([60_000, 300_000, 1_800_000]);
    expect(webhookDeliveryBackoffMs(1)).toBe(300_000);
    expect(webhookDeliveryBackoffMs(2)).toBe(1_800_000);
  });

  it('인라인 실패 → RETRYING + 큐 인큐(delay 1분, attempts 3, 커스텀 backoff)', async () => {
    const { deliveryService, configRepo, queue } = makeServices();
    const config = await seedConfig(configRepo);
    mockedAxios.post.mockRejectedValue(new Error('conn refused'));

    const delivery = await deliveryService.dispatch(
      config,
      'synthesis.completed',
      { event: 'synthesis.completed', jobId: 'j1', timestamp: 'ts' },
      false,
    );

    expect(delivery.status).toBe('RETRYING');
    expect(delivery.attempts).toBe(1);
    expect(delivery.nextRetryAt).not.toBeNull();
    expect(queue.add).toHaveBeenCalledWith(
      { deliveryId: delivery.id, baseAttempts: 1 },
      expect.objectContaining({
        delay: 60_000,
        attempts: WEBHOOK_MAX_QUEUE_RETRIES,
        backoff: { type: 'webhook-delivery-backoff' },
      }),
    );
  });

  it('큐 재시도 3회 소진 → EXHAUSTED (nextRetryAt=null)', async () => {
    const { deliveryService, configRepo, deliveryRepo } = makeServices();
    const config = await seedConfig(configRepo);
    mockedAxios.post.mockRejectedValue(new Error('down'));

    const delivery = await deliveryService.dispatch(
      config,
      'synthesis.completed',
      { event: 'synthesis.completed', jobId: 'j1', timestamp: 'ts' },
      false,
    );
    const data = { deliveryId: delivery.id, baseAttempts: 1 };

    // 재시도 1·2 — 미최종: RETRYING 유지 + throw(Bull backoff 재예약 신호)
    await expect(deliveryService.processQueueAttempt(data)).rejects.toThrow();
    await expect(deliveryService.processQueueAttempt(data)).rejects.toThrow();
    let row = deliveryRepo.rows.find((r) => r.id === delivery.id)!;
    expect(row.status).toBe('RETRYING');
    expect(row.attempts).toBe(3);

    // 재시도 3 — 소진: EXHAUSTED 확정
    await expect(deliveryService.processQueueAttempt(data)).rejects.toThrow();
    row = deliveryRepo.rows.find((r) => r.id === delivery.id)!;
    expect(row.status).toBe('EXHAUSTED');
    expect(row.attempts).toBe(4); // 인라인 1 + 큐 3
    expect(row.nextRetryAt).toBeNull();
  });

  it('DELIVERED 멱등 단락 — 동일 잡 재배달 시 재발송 없음', async () => {
    const { deliveryService, configRepo, deliveryRepo } = makeServices();
    const config = await seedConfig(configRepo);
    mockedAxios.post.mockResolvedValue({ status: 200, data: 'ok' });

    const delivery = await deliveryService.dispatch(
      config,
      'synthesis.completed',
      { event: 'synthesis.completed', jobId: 'j1', timestamp: 'ts' },
      false,
    );
    expect(delivery.status).toBe('DELIVERED');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);

    await deliveryService.processQueueAttempt({
      deliveryId: delivery.id,
      baseAttempts: 1,
    });
    expect(mockedAxios.post).toHaveBeenCalledTimes(1); // 단락 — 추가 발송 0
    expect(
      deliveryRepo.rows.find((r) => r.id === delivery.id)!.attempts,
    ).toBe(1);
  });

  it('EXHAUSTED → 수동 retry → PENDING 재진입(성공 시 DELIVERED), 그 외 상태는 409', async () => {
    const { deliveryService, configRepo, deliveryRepo } = makeServices();
    await seedConfig(configRepo);
    mockedAxios.post.mockResolvedValue({ status: 200, data: 'ok' });

    const exhausted = Object.assign(new WebhookDelivery(), {
      id: 'd-ex',
      uid: 'whd_exhausted1',
      configId: 'cfg-1',
      siteId: 'site-a',
      env: 'live' as const,
      event: 'synthesis.completed',
      isTest: false,
      payload: JSON.stringify({ jobId: 'j1', event: 'synthesis.completed', timestamp: 'ts' }),
      status: 'EXHAUSTED' as const,
      attempts: 4,
      lastStatusCode: 500,
      lastResponse: null,
      nextRetryAt: null,
      deliveredAt: null,
      createdAt: new Date(),
    });
    await deliveryRepo.save(exhausted);

    const view = await deliveryService.manualRetry('site-a', 'live', 'whd_exhausted1');
    expect(view.status).toBe('DELIVERED');
    expect(view.attempts).toBe(5);

    // DELIVERED 상태는 재시도 불가 — 409 ERR_DELIVERY_NOT_RETRYABLE
    await expect(
      deliveryService.manualRetry('site-a', 'live', 'whd_exhausted1'),
    ).rejects.toMatchObject({ errorCode: ErrV1.ERR_DELIVERY_NOT_RETRYABLE });
  });
});

// ─────────────── [P1-2] delivery stuck 복구 + [렌즈2 P2-1] retry race ───────

describe('[P1-2] 인큐 실패에도 delivery 행 존속 + stale 행 수동 복구', () => {
  const seedStuck = async (
    deliveryRepo: DeliveryRepo,
    overrides: Partial<WebhookDelivery>,
  ): Promise<WebhookDelivery> => {
    const row = Object.assign(new WebhookDelivery(), {
      id: 'd-stuck',
      uid: 'whd_stuck1',
      configId: 'cfg-1',
      siteId: 'site-a',
      env: 'live' as const,
      event: 'synthesis.completed',
      isTest: false,
      payload: JSON.stringify({ jobId: 'j1', event: 'synthesis.completed', timestamp: 'ts' }),
      status: 'RETRYING' as const,
      attempts: 1,
      lastStatusCode: null,
      lastResponse: null,
      nextRetryAt: null,
      deliveredAt: null,
      createdAt: new Date(),
      ...overrides,
    });
    await deliveryRepo.save(row);
    return row;
  };

  it('queue.add throw 시에도 dispatch 는 throw 없이 RETRYING 행을 저장한다', async () => {
    const { deliveryService, configRepo, deliveryRepo, queue } = makeServices();
    const config = await seedConfig(configRepo);
    mockedAxios.post.mockRejectedValue(new Error('conn refused'));
    queue.add.mockRejectedValue(new Error('redis down'));

    const delivery = await deliveryService.dispatch(
      config,
      'synthesis.completed',
      { event: 'synthesis.completed', jobId: 'j1', timestamp: 'ts' },
      false,
    );

    const row = deliveryRepo.rows.find((r) => r.id === delivery.id)!;
    expect(row.status).toBe('RETRYING'); // 행 존속 — 상태/nextRetryAt 기록 보장
    expect(row.attempts).toBe(1);
    expect(row.nextRetryAt).not.toBeNull();
  });

  it('stale RETRYING(nextRetryAt+10분 경과) → 수동 retry 재진입 허용', async () => {
    const { deliveryService, configRepo, deliveryRepo } = makeServices();
    await seedConfig(configRepo);
    await seedStuck(deliveryRepo, {
      nextRetryAt: new Date(Date.now() - 11 * 60_000),
    });
    mockedAxios.post.mockResolvedValue({ status: 200, data: 'ok' });

    const view = await deliveryService.manualRetry('site-a', 'live', 'whd_stuck1');
    expect(view.status).toBe('DELIVERED');
    expect(view.attempts).toBe(2);
  });

  it('신선한 RETRYING(재시도 예정 미경과) → 여전히 409', async () => {
    const { deliveryService, configRepo, deliveryRepo } = makeServices();
    await seedConfig(configRepo);
    await seedStuck(deliveryRepo, {
      nextRetryAt: new Date(Date.now() + 60_000), // 정상 진행 중 체인
    });

    await expect(
      deliveryService.manualRetry('site-a', 'live', 'whd_stuck1'),
    ).rejects.toMatchObject({ errorCode: ErrV1.ERR_DELIVERY_NOT_RETRYABLE });
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('stale PENDING(createdAt 폴백 +10분 경과) 허용 / 신선한 PENDING 409', async () => {
    const { deliveryService, configRepo, deliveryRepo } = makeServices();
    await seedConfig(configRepo);
    mockedAxios.post.mockResolvedValue({ status: 200, data: 'ok' });

    await seedStuck(deliveryRepo, {
      id: 'd-p1',
      uid: 'whd_pend_stale',
      status: 'PENDING' as const,
      attempts: 0,
      createdAt: new Date(Date.now() - 11 * 60_000),
    });
    await seedStuck(deliveryRepo, {
      id: 'd-p2',
      uid: 'whd_pend_fresh',
      status: 'PENDING' as const,
      attempts: 0,
      createdAt: new Date(),
    });

    const view = await deliveryService.manualRetry('site-a', 'live', 'whd_pend_stale');
    expect(view.status).toBe('DELIVERED');

    await expect(
      deliveryService.manualRetry('site-a', 'live', 'whd_pend_fresh'),
    ).rejects.toMatchObject({ errorCode: ErrV1.ERR_DELIVERY_NOT_RETRYABLE });
  });

  it('[렌즈2 P2-1] 이중 POST race — CAS affected=0 이면 409 + 발송 없음', async () => {
    const { deliveryService, configRepo, deliveryRepo } = makeServices();
    await seedConfig(configRepo);
    await seedStuck(deliveryRepo, { status: 'EXHAUSTED' as const, attempts: 4 });

    // 경합 패자 시뮬레이션 — 상태 CAS(WHERE id+status)가 0행 매칭
    deliveryRepo.update.mockResolvedValueOnce({ affected: 0 });

    await expect(
      deliveryService.manualRetry('site-a', 'live', 'whd_stuck1'),
    ).rejects.toMatchObject({ errorCode: ErrV1.ERR_DELIVERY_NOT_RETRYABLE });
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});

// ─────────── [P2-1] delivery 뷰 — 응답 본문 파트너 비노출 ─────────────

describe('[P2-1] 파트너 뷰에 수신측 응답 본문 비노출 (SSRF 반출 채널 축소)', () => {
  it('실패 응답 본문은 DB 에만 저장 — 뷰는 사유 코드(HTTP_ERROR)만', async () => {
    const { deliveryService, configRepo, deliveryRepo } = makeServices();
    const config = await seedConfig(configRepo);
    mockedAxios.post.mockRejectedValue({
      message: 'Request failed with status code 500',
      response: { status: 500, data: 'internal-admin-page-html' },
    });

    const delivery = await deliveryService.dispatch(
      config,
      'synthesis.completed',
      { event: 'synthesis.completed', jobId: 'j1', timestamp: 'ts' },
      false,
    );

    // DB 행은 운영 진단용 본문 유지
    const row = deliveryRepo.rows.find((r) => r.id === delivery.id)!;
    expect(row.lastResponse).toContain('internal-admin-page-html');

    // 파트너 뷰(상세 포함)에는 본문 필드 자체가 없다
    const view = await deliveryService.getDelivery('site-a', 'live', delivery.uid);
    expect(view).not.toHaveProperty('lastResponse');
    expect(JSON.stringify(view)).not.toContain('internal-admin-page-html');
    expect(view.lastStatusCode).toBe(500);
    expect(view.lastFailureReason).toBe('HTTP_ERROR');
  });

  it('네트워크 실패 → REQUEST_FAILED / 성공 → null', async () => {
    const { deliveryService, configRepo } = makeServices();
    const config = await seedConfig(configRepo);

    mockedAxios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const failed = await deliveryService.dispatch(
      config,
      'synthesis.completed',
      { event: 'synthesis.completed', jobId: 'j1', timestamp: 'ts' },
      false,
    );
    const failedView = await deliveryService.getDelivery(
      'site-a',
      'live',
      failed.uid,
    );
    expect(failedView.lastFailureReason).toBe('REQUEST_FAILED');
    expect(failedView).not.toHaveProperty('lastResponse');

    mockedAxios.post.mockResolvedValueOnce({ status: 200, data: 'ok' });
    const ok = await deliveryService.dispatch(
      config,
      'synthesis.completed',
      { event: 'synthesis.completed', jobId: 'j2', timestamp: 'ts' },
      false,
    );
    const okView = await deliveryService.getDelivery('site-a', 'live', ok.uid);
    expect(okView.lastFailureReason).toBeNull();
    expect(okView).not.toHaveProperty('lastResponse');
  });
});

// ───────────────────── ④ delivery 테넌트 격리 ─────────────────────────

describe('delivery 조회 테넌트 격리', () => {
  it('타 사이트 uid 는 실재해도 404 (목록도 자기 사이트만)', async () => {
    const { deliveryService, deliveryRepo } = makeServices();
    const mine = Object.assign(new WebhookDelivery(), {
      id: 'd-1',
      uid: 'whd_mine',
      configId: null,
      siteId: 'site-a',
      env: 'live' as const,
      event: 'synthesis.completed',
      isTest: false,
      payload: '{}',
      status: 'DELIVERED' as const,
      attempts: 1,
      lastStatusCode: 200,
      lastResponse: null,
      nextRetryAt: null,
      deliveredAt: new Date(),
      createdAt: new Date(),
    });
    const theirs = Object.assign(new WebhookDelivery(), {
      ...mine,
      id: 'd-2',
      uid: 'whd_theirs',
      siteId: 'site-b',
    });
    await deliveryRepo.save(mine);
    await deliveryRepo.save(theirs);

    // 자기 것: 조회 가능
    await expect(
      deliveryService.getDelivery('site-a', 'live', 'whd_mine'),
    ).resolves.toMatchObject({ uid: 'whd_mine' });

    // 타 사이트 uid: 404 (존재 은닉)
    await expect(
      deliveryService.getDelivery('site-a', 'live', 'whd_theirs'),
    ).rejects.toMatchObject({ errorCode: ErrV1.ERR_NOT_FOUND });

    // 수동 retry 도 동일 스코프
    await expect(
      deliveryService.manualRetry('site-a', 'live', 'whd_theirs'),
    ).rejects.toMatchObject({ errorCode: ErrV1.ERR_NOT_FOUND });

    // 목록: 자기 사이트 것만
    const { items, total } = await deliveryService.listDeliveries(
      'site-a',
      'live',
      {},
      { limit: 20, offset: 0 },
    );
    expect(total).toBe(1);
    expect(items.map((i) => i.uid)).toEqual(['whd_mine']);
  });
});

// ────────────────── ⑤ config CRUD — secret 1회 노출 ───────────────────

describe('config CRUD — secret 은 생성/회전 응답 1회만 노출', () => {
  it('생성: secret 노출 / 조회: 마스킹만 / 갱신: 미노출 / 회전: 새 secret 1회', async () => {
    const { configService, configRepo } = makeServices();

    const created = await configService.upsert('site-a', 'live', {
      url: 'https://partner.bookmoa.com/hook',
      events: ['synthesis.completed'],
    });
    expect(created.secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(created.secretPrefix).toBe(created.secret!.slice(0, 12));

    // DB 에는 평문 미보관 — 암호문만
    expect(configRepo.rows[0].secretEnc).not.toContain(created.secret!.slice(6));

    const fetched = await configService.get('site-a', 'live');
    expect(fetched.secret).toBeUndefined();
    expect(fetched.secretPrefix).toBe(created.secretPrefix);

    const updated = await configService.upsert('site-a', 'live', {
      url: 'https://partner.bookmoa.com/hook2',
    });
    expect(updated.secret).toBeUndefined(); // 갱신은 secret 유지·미노출
    expect(updated.url).toBe('https://partner.bookmoa.com/hook2');

    const rotated = await configService.upsert('site-a', 'live', {
      url: 'https://partner.bookmoa.com/hook2',
      rotateSecret: true,
    });
    expect(rotated.secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(rotated.secret).not.toBe(created.secret);
  });

  it('허용되지 않는 URL → 422 ERR_WEBHOOK_URL_FORBIDDEN / 미지 이벤트 → 400', async () => {
    const { configService } = makeServices();

    await expect(
      configService.upsert('site-a', 'live', { url: 'https://evil.example.com/x' }),
    ).rejects.toMatchObject({ errorCode: ErrV1.ERR_WEBHOOK_URL_FORBIDDEN });

    await expect(
      configService.upsert('site-a', 'live', {
        url: 'https://partner.bookmoa.com/hook',
        events: ['no.such.event'],
      }),
    ).rejects.toMatchObject({ errorCode: ErrV1.ERR_VALIDATION_FAILED });

    await expect(
      configService.upsert('site-a', 'live', { url: 'ftp://bookmoa.com/x' }),
    ).rejects.toMatchObject({ errorCode: ErrV1.ERR_WEBHOOK_URL_FORBIDDEN });
  });

  it('config 미존재 GET/DELETE → 404 ERR_WEBHOOK_CONFIG_NOT_FOUND', async () => {
    const { configService } = makeServices();
    await expect(configService.get('site-a', 'live')).rejects.toMatchObject({
      errorCode: ErrV1.ERR_WEBHOOK_CONFIG_NOT_FOUND,
    });
    await expect(configService.remove('site-a', 'live')).rejects.toMatchObject({
      errorCode: ErrV1.ERR_WEBHOOK_CONFIG_NOT_FOUND,
    });
  });
});

// ──────────── ⑥ env 키 미설정 = v2 전면 비활성(무중단) ────────────────

describe('WEBHOOK_CONFIG_ENC_KEY 미설정 — v2 비활성 + 기존 경로 무영향', () => {
  it('발신측: config DB 조회조차 없음(타이밍 불변) → null(레거시 폴스루)', async () => {
    const { deliveryService, configRepo } = makeServices({ enabled: false });
    const result = await deliveryService.tryDispatchForSite('site-a', 'live', {
      event: 'synthesis.completed',
      jobId: 'j1',
      status: 'completed',
      outputFileUrl: '',
      timestamp: 'ts',
    } as never);
    expect(result).toBeNull();
    expect(configRepo.findOne).not.toHaveBeenCalled();
  });

  it('config upsert → 503 ERR_SERVICE_UNAVAILABLE', async () => {
    const { configService } = makeServices({ enabled: false });
    await expect(
      configService.upsert('site-a', 'live', {
        url: 'https://partner.bookmoa.com/hook',
      }),
    ).rejects.toMatchObject({ errorCode: ErrV1.ERR_SERVICE_UNAVAILABLE });
  });

  it('테스트 발송 → 503 (읽기 deliveries 는 영향 없음)', async () => {
    const { deliveryService } = makeServices({ enabled: false });
    await expect(deliveryService.sendTest('site-a', 'live')).rejects.toBeInstanceOf(
      PartnerApiException,
    );
    // 읽기는 동작
    const { total } = await deliveryService.listDeliveries(
      'site-a',
      'live',
      {},
      { limit: 20, offset: 0 },
    );
    expect(total).toBe(0);
  });
});

// ─────────────── 구독 필터 + opt-in 경계 (발신 진입점) ─────────────────

describe('tryDispatchForSite — opt-in 경계', () => {
  it('config 없는 사이트 → null (호출측이 기존 v1 경로 폴스루)', async () => {
    const { deliveryService } = makeServices();
    const result = await deliveryService.tryDispatchForSite('site-x', 'live', {
      event: 'synthesis.completed',
      jobId: 'j1',
      status: 'completed',
      outputFileUrl: '',
      timestamp: 'ts',
    } as never);
    expect(result).toBeNull();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('구독 목록에 없는 이벤트 → 발송/이력 없이 스킵', async () => {
    const { deliveryService, configRepo, deliveryRepo } = makeServices();
    await seedConfig(configRepo, { events: ['synthesis.completed'] });

    const result = await deliveryService.tryDispatchForSite('site-a', 'live', {
      event: 'validation.failed',
      jobId: 'j1',
      fileType: 'cover',
      status: 'failed',
      timestamp: 'ts',
    } as never);
    expect(result).toEqual({ delivered: false });
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(deliveryRepo.rows).toHaveLength(0);
  });

  it('구독 이벤트 → v2 발송: HMAC 전용 헤더 + X-Storige-Delivery + 바이트 스냅샷', async () => {
    const { deliveryService, configRepo, deliveryRepo } = makeServices();
    const config = await seedConfig(configRepo, { events: [] }); // 빈 배열=전체
    mockedAxios.post.mockResolvedValue({ status: 200, data: 'ok' });

    const payload = {
      event: 'synthesis.completed',
      jobId: 'j1',
      status: 'completed',
      outputFileUrl: '/storage/x.pdf',
      timestamp: '2026-07-15T00:00:00.000Z',
    };
    const result = await deliveryService.tryDispatchForSite(
      'site-a',
      'live',
      payload as never,
    );
    expect(result).toEqual({ delivered: true });

    const [url, body, options] = mockedAxios.post.mock.calls[0] as [
      string,
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe(config.url);
    expect(body).toBe(JSON.stringify(payload)); // 바이트 스냅샷 그대로
    expect(options.headers['X-Storige-Event']).toBe('synthesis.completed');
    expect(options.headers['X-Storige-Delivery']).toMatch(/^whd_[0-9a-f]{32}$/);
    expect(options.headers['X-Storige-Signature-HMAC']).toMatch(
      /^t=\d+,v1=[0-9a-f]{64}$/,
    );
    // v2 는 HMAC 전용 — 레거시 base64 서명 헤더 미전송
    expect(options.headers['X-Storige-Signature']).toBeUndefined();
    expect(deliveryRepo.rows).toHaveLength(1);
    expect(deliveryRepo.rows[0].status).toBe('DELIVERED');
  });

  // 배치1 정합화 — env 통합(S2-1): test env 발신은 delivery.isTest + 페이로드
  // isTest:true 를 함께 반영한다. live 페이로드 바이트 불변은 위 테스트가 고정.
  it('env=test 발신 → delivery.isTest=true + 페이로드 isTest:true 반영', async () => {
    const { deliveryService, configRepo, deliveryRepo } = makeServices();
    await seedConfig(configRepo, { env: 'test' as const, events: [] });
    mockedAxios.post.mockResolvedValue({ status: 200, data: 'ok' });

    const payload = {
      event: 'synthesis.completed',
      jobId: 'j-test',
      status: 'completed',
      outputFileUrl: '/storage/x.pdf',
      timestamp: '2026-07-15T00:00:00.000Z',
    };
    const result = await deliveryService.tryDispatchForSite(
      'site-a',
      'test',
      payload as never,
    );
    expect(result).toEqual({ delivered: true });

    const [, body] = mockedAxios.post.mock.calls[0] as [string, string];
    expect(JSON.parse(body)).toEqual({ ...payload, isTest: true });
    expect(deliveryRepo.rows).toHaveLength(1);
    expect(deliveryRepo.rows[0].isTest).toBe(true);
    expect(deliveryRepo.rows[0].env).toBe('test');
  });
});
