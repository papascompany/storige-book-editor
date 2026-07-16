/**
 * 웹훅 서명 검증 — SDK 수신기 ↔ 서버 발신 실코드 **페어와이즈 골든 대조**.
 *
 * ## 왜 발신부를 복제하는가
 * apps/api 는 Nest 런타임에 묶여 있어 SDK 테스트에서 import 할 수 없다. 그래서
 * 서버 정본 spec(apps/api/src/webhook/webhook-signature-pairwise.spec.ts)이
 * **수신부 3종을 스냅샷 레플리카로 박제한 것과 정확히 대칭으로**, 여기서는
 * **발신부 2종을 스냅샷 레플리카로 박제**하고 SDK 검증기가 같은 입력에 같은
 * 판정을 내는지 대조한다.
 *
 * ⚠️ 레플리카는 아래 출처의 **한 줄 한 줄 미러**다 — 원본이 바뀌면 여기도 갱신하라.
 * 이 파일이 red 가 되는 날 = 서버 발신 규약이 바뀐 날이다.
 *
 * 발신부 스냅샷 출처 (2026-07-16 채록):
 *  - v1(전역 WEBHOOK_SECRET):
 *      apps/api/src/webhook/webhook.service.ts
 *        buildHeaders():229-238 / generateSignature():245-248
 *        payloadIdentifier():255-260 / generateHmacSignature():268-276
 *  - v2(사이트별 whsec_):
 *      apps/api/src/webhook/v2/webhook-delivery.service.ts attemptHttp():309-405
 *      apps/api/src/webhook/v2/webhook-secret.crypto.ts signWebhookV2():80-90
 *
 * 서버측 대조표 정본: docs/WEBHOOK_SIGNATURE_MATRIX_2026-07-03.md
 */

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIGNATURE_TOLERANCE_SEC,
  verifyWebhookSignature,
  type WebhookVerifyResult,
} from '../webhook';
import { StorigeUsageError } from '../index';

// ────────────────────── 발신부 스냅샷 레플리카 ──────────────────────

type Payload = Record<string, unknown>;

/** webhook.service.ts payloadIdentifier():255-260 미러 (⚠️ `in` 연산자 — 키 존재 검사) */
function v1PayloadIdentifier(payload: Payload): unknown {
  if ('jobId' in payload) return payload.jobId;
  if ('sessionId' in payload && payload.sessionId) return payload.sessionId;
  if ('finalizationUid' in payload) return payload.finalizationUid;
  return '';
}

/**
 * webhook.service.ts buildHeaders():229-238 미러.
 * secret 미지정 = 서버 WEBHOOK_SECRET 미설정 → HMAC 헤더 미전송(레거시만).
 */
function v1Send(
  payload: Payload,
  secret?: string,
  nowMs: number = Date.now(),
): Record<string, string> {
  const identifier = v1PayloadIdentifier(payload);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-storige-event': String(payload.event),
    // generateSignature():245-248 — 시크릿 불참여 base64
    'x-storige-signature': Buffer.from(
      `${identifier}:${payload.event}:${payload.timestamp}`,
    ).toString('base64'),
  };
  if (secret) {
    // generateHmacSignature():268-276
    const t = Math.floor(nowMs / 1000);
    const data = `${t}.${identifier}:${payload.event}:${payload.timestamp}`;
    const v1 = createHmac('sha256', secret).update(data).digest('hex');
    headers['x-storige-signature-hmac'] = `t=${t},v1=${v1}`;
  }
  return headers;
}

/**
 * webhook-delivery.service.ts attemptHttp():309-405 미러.
 *
 * 발신은 저장된 payload **바이트 스냅샷**을 재전송하고 서명만 새 t 로 재계산한다
 * → JSON 왕복(stringify→parse)을 그대로 재현한다(undefined 필드 소실 등 동일 조건).
 */
function v2Send(
  payload: Payload,
  secret: string,
  deliveryUid: string,
  nowMs: number = Date.now(),
): { headers: Record<string, string>; body: string } {
  const body = JSON.stringify(payload); // delivery.payload 컬럼
  const parsed = JSON.parse(body) as {
    jobId?: string;
    sessionId?: string;
    timestamp?: string;
  };
  const identifier = parsed.jobId ?? parsed.sessionId ?? deliveryUid;
  const timestamp = parsed.timestamp ?? '';
  const t = Math.floor(nowMs / 1000);
  // signWebhookV2():80-90 — v1 과 동일 알고리즘, secret 출처만 다름
  const data = `${t}.${identifier}:${payload.event}:${timestamp}`;
  const v1 = createHmac('sha256', secret).update(data).digest('hex');
  return {
    headers: {
      'content-type': 'application/json',
      'x-storige-event': String(payload.event),
      'x-storige-delivery': deliveryUid,
      'x-storige-signature-hmac': `t=${t},v1=${v1}`,
      // ⚠️ v2 는 레거시 base64 헤더를 **보내지 않는다**(HMAC 전용)
    },
    body,
  };
}

// ────────────────────── 픽스처 ──────────────────────

const V2_SECRET = `whsec_${'ab'.repeat(24)}`;
const V1_SECRET = 'global-webhook-secret';

const iso = (offsetMs = 0): string => new Date(Date.now() + offsetMs).toISOString();

function expectValid(result: WebhookVerifyResult): asserts result is Extract<
  WebhookVerifyResult,
  { valid: true }
> {
  if (!result.valid) {
    throw new Error(`검증 실패: ${result.reason} — ${result.message}`);
  }
}

// ────────────────────── 테스트 ──────────────────────

describe('페어와이즈 골든 — v2 발신 실코드 ↔ SDK 검증기', () => {
  it('jobId 페이로드(synthesis) — 발신 서명을 SDK 가 통과시킨다', () => {
    const payload = {
      event: 'synthesis.completed',
      jobId: 'a1b2c3d4-0000-4000-8000-000000000001',
      status: 'completed',
      outputFileUrl: '/storage/outputs/merged.pdf',
      timestamp: iso(),
    };
    const { headers } = v2Send(payload, V2_SECRET, 'whd_1');
    const result = verifyWebhookSignature({ headers, payload, secret: V2_SECRET });
    expectValid(result);
    expect(result.identifier).toBe(payload.jobId);
    expect(result.event).toBe('synthesis.completed');
    expect(result.insecureLegacy).toBe(false);
  });

  it('sessionId 폴백(session.validated) — identifier 2경로', () => {
    const payload = {
      event: 'session.validated',
      sessionId: 'sess-0001',
      orderSeqno: 12,
      status: 'validated',
      timestamp: iso(),
    };
    const { headers } = v2Send(payload, V2_SECRET, 'whd_2');
    const result = verifyWebhookSignature({ headers, payload, secret: V2_SECRET });
    expectValid(result);
    expect(result.identifier).toBe('sess-0001');
  });

  it('delivery uid 폴백(webhook.test) — identifier 3경로', () => {
    const uid = 'whd_3ff0a1';
    // sendTest():431-438 실물 페이로드 형태
    const payload = {
      event: 'webhook.test',
      deliveryUid: uid,
      isTest: true,
      message: 'Storige 웹훅 테스트 발송입니다',
      timestamp: iso(),
    };
    const { headers } = v2Send(payload, V2_SECRET, uid);
    const result = verifyWebhookSignature({ headers, payload, secret: V2_SECRET });
    expectValid(result);
    // jobId/sessionId 가 없으니 X-Storige-Delivery 헤더값으로 서명된다
    expect(result.identifier).toBe(uid);
  });

  it('test env isTest 주입 페이로드({...payload, isTest:true})도 통과 — 본문 확장은 서명과 무관', () => {
    const base = {
      event: 'synthesis.completed',
      jobId: 'job-test-env',
      status: 'completed',
      outputFileUrl: '',
      timestamp: iso(),
    };
    // tryDispatchForSite():146-149 — test env 는 payload 에 isTest 를 얹어 발송
    const payload = { ...base, isTest: true as const };
    const { headers } = v2Send(payload, V2_SECRET, 'whd_4');
    expectValid(verifyWebhookSignature({ headers, payload, secret: V2_SECRET }));
  });

  it('구독 이벤트 9종 전부 — 발신↔검증 정합', () => {
    const events = [
      'validation.completed',
      'validation.fixable',
      'validation.failed',
      'synthesis.completed',
      'synthesis.failed',
      'session.validated',
      'session.failed',
      'book.finalization.completed',
      'book.finalization.failed',
    ];
    for (const event of events) {
      const payload = { event, jobId: `job-${event}`, status: 'x', timestamp: iso() };
      const { headers } = v2Send(payload, V2_SECRET, `whd_${event}`);
      const result = verifyWebhookSignature({ headers, payload, secret: V2_SECRET });
      expectValid(result);
      expect(result.event).toBe(event);
    }
  });

  it('재시도 재서명 규약 — payload.timestamp 가 31분 과거여도 새 t 면 통과', () => {
    // 서버 재시도 체인은 1분/5분/30분 — 마지막 재시도의 payload.timestamp 는
    // 30분 넘게 과거다. tolerance 를 payload.timestamp 에 걸면 정상 재시도가
    // 죽는다(수신부 함정). SDK 는 헤더 t 로만 판정한다.
    const payload = {
      event: 'synthesis.completed',
      jobId: 'job-retry',
      status: 'completed',
      outputFileUrl: '',
      timestamp: iso(-31 * 60_000),
    };
    const { headers } = v2Send(payload, V2_SECRET, 'whd_retry'); // 새 t 로 재서명
    expectValid(verifyWebhookSignature({ headers, payload, secret: V2_SECRET }));
  });
});

describe('페어와이즈 골든 — v1 발신 실코드 ↔ SDK 검증기', () => {
  it('전역 WEBHOOK_SECRET HMAC — X-Storige-Delivery 부재라 auto 가 v1 규칙을 고른다', () => {
    const payload = {
      event: 'validation.completed',
      jobId: 'job-v1',
      fileType: 'cover',
      status: 'completed',
      timestamp: iso(),
    };
    const headers = v1Send(payload, V1_SECRET);
    const result = verifyWebhookSignature({ headers, payload, secret: V1_SECRET });
    expectValid(result);
    expect(result.identifier).toBe('job-v1');
  });

  it('v1 전용 finalizationUid 분기 — v2 규칙으로는 검증되지 않는다(발신 규칙 차이)', () => {
    const payload = {
      event: 'book.finalization.completed',
      bookUid: 'bk_1',
      finalizationUid: 'fin_1',
      status: 'completed',
      validationSkipped: false,
      timestamp: iso(),
    };
    const headers = v1Send(payload, V1_SECRET);

    // auto → delivery 헤더 없음 → v1 규칙 → finalizationUid 로 서명 재현 → 통과
    const auto = verifyWebhookSignature({ headers, payload, secret: V1_SECRET });
    expectValid(auto);
    expect(auto.identifier).toBe('fin_1');

    // 같은 입력을 v2 규칙으로 강제하면: jobId/sessionId 없음 → delivery uid 폴백
    // (헤더 부재 → '') → 다른 data → 불일치. **규칙 선택이 결과를 가른다는 증거**.
    const forcedV2 = verifyWebhookSignature({
      headers,
      payload,
      secret: V1_SECRET,
      identifierStrategy: 'v2',
    });
    expect(forcedV2.valid).toBe(false);
    expect(forcedV2.valid === false && forcedV2.reason).toBe('SIGNATURE_MISMATCH');
  });

  it('[문서화된 발신 기벽] jobId 키가 null 로 존재하면 문자열 "null" 로 서명된다', () => {
    // 발신부는 `'jobId' in payload` (키 존재) → null 을 그대로 템플릿 보간 → 'null'.
    // SDK 는 이 기벽을 **그대로 재현**해야 검증이 맞는다(계약 소비, 교정 아님).
    const payload = {
      event: 'synthesis.completed',
      jobId: null,
      sessionId: 'sess-0002',
      status: 'completed',
      outputFileUrl: '',
      timestamp: iso(),
    };
    const headers = v1Send(payload, V1_SECRET);
    const result = verifyWebhookSignature({ headers, payload, secret: V1_SECRET });
    expectValid(result);
    expect(result.identifier).toBe('null'); // ⚠️ sessionId 가 아니다
  });

  it('식별자 필드가 하나도 없으면 v1 은 빈 문자열로 서명한다', () => {
    const payload = { event: 'session.failed', timestamp: iso() };
    const headers = v1Send(payload, V1_SECRET);
    const result = verifyWebhookSignature({ headers, payload, secret: V1_SECRET });
    expectValid(result);
    expect(result.identifier).toBe('');
  });

  it('v1·v2 는 secret 출처만 다르고 알고리즘이 같다 — 같은 입력이면 같은 서명', () => {
    const payload = {
      event: 'synthesis.completed',
      jobId: 'same-job',
      status: 'completed',
      outputFileUrl: '',
      timestamp: iso(),
    };
    const nowMs = Date.now();
    const secret = 'shared';
    const fromV1 = v1Send(payload, secret, nowMs)['x-storige-signature-hmac'];
    const fromV2 = v2Send(payload, secret, 'whd_x', nowMs).headers['x-storige-signature-hmac'];
    // 형식·값 동일 — 그래서 수신 검증기가 하나로 통일된다
    expect(fromV1).toBe(fromV2);
  });
});

describe('서명 거부 경로', () => {
  const payload = {
    event: 'synthesis.completed',
    jobId: 'job-reject',
    status: 'completed',
    outputFileUrl: '',
    timestamp: iso(),
  };

  it('secret 불일치 → SIGNATURE_MISMATCH', () => {
    const { headers } = v2Send(payload, 'attacker-secret', 'whd_r1');
    const result = verifyWebhookSignature({ headers, payload, secret: V2_SECRET });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toBe('SIGNATURE_MISMATCH');
  });

  it('본문 식별자 변조 → SIGNATURE_MISMATCH (identifier 는 서명에 포함되므로 탐지된다)', () => {
    const { headers } = v2Send(payload, V2_SECRET, 'whd_r2');
    const tampered = { ...payload, jobId: 'other-job' };
    const result = verifyWebhookSignature({ headers, payload: tampered, secret: V2_SECRET });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toBe('SIGNATURE_MISMATCH');
  });

  it('서명 헤더 없음 → MISSING_SIGNATURE', () => {
    const result = verifyWebhookSignature({
      headers: { 'x-storige-event': 'synthesis.completed' },
      payload,
      secret: V2_SECRET,
    });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toBe('MISSING_SIGNATURE');
  });

  it.each([
    ['garbage', 'k=v 형태 아님'],
    ['t=abc,v1=' + 'a'.repeat(64), 't 가 정수 아님'],
    ['t=1700000000,v1=zz', 'v1 이 hex64 아님'],
    ['t=1700000000', 'v1 누락'],
    ['v1=' + 'a'.repeat(64), 't 누락'],
    ['t=1700000000,v1=' + 'A'.repeat(64), 'v1 대문자(발신은 소문자 고정)'],
    ['t=99999999999999999999,v1=' + 'a'.repeat(64), 't 가 안전 정수 초과'],
  ])('형식 불량 %s (%s) → MALFORMED_SIGNATURE', (raw) => {
    const result = verifyWebhookSignature({
      headers: { 'x-storige-signature-hmac': raw },
      payload,
      secret: V2_SECRET,
    });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toBe('MALFORMED_SIGNATURE');
  });

  it('미지의 키는 무시하고 t·v1 만 읽는다 (전방 호환)', () => {
    const { headers } = v2Send(payload, V2_SECRET, 'whd_fwd');
    const raw = headers['x-storige-signature-hmac'] as string;
    expectValid(
      verifyWebhookSignature({
        headers: { ...headers, 'x-storige-signature-hmac': `${raw},v2=futurescheme` },
        payload,
        secret: V2_SECRET,
      }),
    );
  });
});

/**
 * 파서 fail-closed — 정본 발신은 `t=<d+>,v1=<hex64>` **하나만** 보낸다.
 * 같은 키가 두 번 오는 것은 100% 비정상이므로 애매함을 남기지 않고 거부한다.
 */
describe('HMAC 파서 fail-closed (중복 키 = 헤더 병합 스머글링 표면)', () => {
  const payload = {
    event: 'synthesis.completed',
    jobId: 'job-parser',
    status: 'completed',
    outputFileUrl: '',
    timestamp: iso(),
  };

  const verify = (raw: string): WebhookVerifyResult =>
    verifyWebhookSignature({
      headers: { 'x-storige-delivery': 'whd_p', 'x-storige-signature-hmac': raw },
      payload,
      secret: V2_SECRET,
    });

  it('v1 중복 → MALFORMED (종전엔 뒤 값이 앞을 덮어써 통과했다)', () => {
    const nowMs = Date.now();
    const valid = v2Send(payload, V2_SECRET, 'whd_p', nowMs).headers['x-storige-signature-hmac'] as string;
    const v1Valid = valid.split(',')[1] as string; // 'v1=<hex64>'
    const t = valid.split(',')[0] as string;
    const result = verify(`${t},v1=${'0'.repeat(64)},${v1Valid}`);
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toBe('MALFORMED_SIGNATURE');
  });

  it('t 중복 → MALFORMED', () => {
    const nowMs = Date.now();
    const valid = v2Send(payload, V2_SECRET, 'whd_p', nowMs).headers['x-storige-signature-hmac'] as string;
    const result = verify(`t=${Math.floor(nowMs / 1000) - 1},${valid}`);
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toBe('MALFORMED_SIGNATURE');
  });

  it('프록시가 중복 헤더를 ", " 로 병합해도 거부한다 — 유효 서명이 섞여 있어도', () => {
    const nowMs = Date.now();
    const real = v2Send(payload, V2_SECRET, 'whd_p', nowMs).headers['x-storige-signature-hmac'] as string;
    const forged = `t=${Math.floor(nowMs / 1000)},v1=${'f'.repeat(64)}`;
    // Headers 의 append 의미론: 같은 이름 중복 → ", " 결합. 그 결과가 이 형태다.
    const merged = new Headers();
    merged.append('x-storige-signature-hmac', forged);
    merged.append('x-storige-signature-hmac', real);
    const combined = merged.get('x-storige-signature-hmac') as string;
    expect(combined).toContain(', '); // 병합이 실제로 일어났음을 박제

    const result = verify(combined);
    expect(result.valid).toBe(false);
    // 공백 때문에 뒤쪽을 '미지의 키'로 흘려보내면 앞쪽(위조)만 채택되는 fail-open
    // 이 된다 — trim + 중복 거부라야 여기서 막힌다.
    expect(result.valid === false && result.reason).toBe('MALFORMED_SIGNATURE');
  });

  it('정상 단일 서명은 그대로 통과한다(과잉 차단 없음)', () => {
    const { headers } = v2Send(payload, V2_SECRET, 'whd_p');
    expectValid(verifyWebhookSignature({ headers, payload, secret: V2_SECRET }));
  });
});

describe('replay 방지 (헤더 t 기준)', () => {
  const payload = {
    event: 'synthesis.completed',
    jobId: 'job-replay',
    status: 'completed',
    outputFileUrl: '',
    timestamp: iso(),
  };

  it('기본 창은 300초', () => {
    expect(DEFAULT_SIGNATURE_TOLERANCE_SEC).toBe(300);
  });

  it('창 밖(과거) → TIMESTAMP_OUT_OF_TOLERANCE', () => {
    const nowMs = Date.now();
    const { headers } = v2Send(payload, V2_SECRET, 'whd_t1', nowMs);
    const result = verifyWebhookSignature({
      headers,
      payload,
      secret: V2_SECRET,
      now: () => nowMs + 301_000,
    });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toBe('TIMESTAMP_OUT_OF_TOLERANCE');
  });

  it('창 밖(미래 t) 도 거부한다', () => {
    const nowMs = Date.now();
    const { headers } = v2Send(payload, V2_SECRET, 'whd_t2', nowMs + 400_000);
    const result = verifyWebhookSignature({
      headers,
      payload,
      secret: V2_SECRET,
      now: () => nowMs,
    });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toBe('TIMESTAMP_OUT_OF_TOLERANCE');
  });

  it('창 안이면 통과', () => {
    const nowMs = Date.now();
    const { headers } = v2Send(payload, V2_SECRET, 'whd_t3', nowMs);
    expectValid(
      verifyWebhookSignature({
        headers,
        payload,
        secret: V2_SECRET,
        now: () => nowMs + 299_000,
      }),
    );
  });

  it('toleranceSec 를 좁히면 그만큼만 허용', () => {
    const nowMs = Date.now();
    const { headers } = v2Send(payload, V2_SECRET, 'whd_t4', nowMs);
    const result = verifyWebhookSignature({
      headers,
      payload,
      secret: V2_SECRET,
      toleranceSec: 10,
      now: () => nowMs + 11_000,
    });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toBe('TIMESTAMP_OUT_OF_TOLERANCE');
  });

  it('toleranceSec <= 0 이면 검사를 건너뛴다(비권장 — replay 창 무한)', () => {
    const nowMs = Date.now();
    const { headers } = v2Send(payload, V2_SECRET, 'whd_t5', nowMs);
    expectValid(
      verifyWebhookSignature({
        headers,
        payload,
        secret: V2_SECRET,
        toleranceSec: 0,
        now: () => nowMs + 86_400_000, // 하루 뒤에도 통과
      }),
    );
  });

  /**
   * 🚨 침묵하는 replay OFF — `NaN > 0` 이 false 라 검사가 통째로 스킵됐다.
   * secret:'' 는 던지는데 이건 조용히 지나가는 **비대칭**이 문제였다.
   */
  it.each([
    ['NaN (Number(process.env.X) 의 전형)', Number('abc')],
    ['NaN 리터럴', NaN],
    ['Infinity (skew > Infinity 는 항상 false — 같은 결과)', Infinity],
    ['-Infinity', -Infinity],
    ['문자열 "300" (환경변수 미변환)', '300'],
  ])('toleranceSec 이 %s 면 StorigeUsageError — 보호가 침묵으로 꺼지지 않는다', (_name, tolerance) => {
    const { headers } = v2Send(payload, V2_SECRET, 'whd_nan');
    expect(() =>
      verifyWebhookSignature({
        headers,
        payload,
        secret: V2_SECRET,
        toleranceSec: tolerance as number,
      }),
    ).toThrow(StorigeUsageError);
  });

  it('🚨 회귀 잠금: NaN tolerance 로 10년 전 서명이 통과하지 않는다', () => {
    const nowMs = Date.now();
    const decadeAgo = nowMs - 10 * 365 * 24 * 60 * 60 * 1000;
    const { headers } = v2Send(payload, V2_SECRET, 'whd_ancient', decadeAgo);
    // 수정 전: NaN 검사 스킵 → 서명은 유효하므로 **통과**했다(캡처 replay 무제한)
    expect(() =>
      verifyWebhookSignature({
        headers,
        payload,
        secret: V2_SECRET,
        toleranceSec: NaN,
        now: () => nowMs,
      }),
    ).toThrow(StorigeUsageError);
  });

  it('미지정·null 은 기본값 경로 — 보호는 켜진 채다(과잉 차단 없음)', () => {
    const nowMs = Date.now();
    const { headers } = v2Send(payload, V2_SECRET, 'whd_default', nowMs);
    for (const tolerance of [undefined, null]) {
      const result = verifyWebhookSignature({
        headers,
        payload,
        secret: V2_SECRET,
        toleranceSec: tolerance as number | undefined,
        now: () => nowMs + 301_000,
      });
      // 기본 300초가 적용됐다는 증거 — 던지지도, 통과시키지도 않는다
      expect(result.valid === false && result.reason).toBe('TIMESTAMP_OUT_OF_TOLERANCE');
    }
  });

  it('tolerance 검사는 서명 대조보다 먼저다 — 만료된 위조도 만료로 보고한다', () => {
    const nowMs = Date.now();
    const { headers } = v2Send(payload, 'wrong-secret', 'whd_t6', nowMs);
    const result = verifyWebhookSignature({
      headers,
      payload,
      secret: V2_SECRET,
      now: () => nowMs + 999_000,
    });
    expect(result.valid === false && result.reason).toBe('TIMESTAMP_OUT_OF_TOLERANCE');
  });
});

describe('레거시 base64 (시크릿 불참여 — 위조 가능)', () => {
  const payload = {
    event: 'synthesis.completed',
    jobId: 'job-legacy',
    status: 'completed',
    outputFileUrl: '/x.pdf',
    timestamp: iso(),
  };

  it('HMAC 없이 레거시만 오면 **기본 거부** — INSECURE_LEGACY_SIGNATURE', () => {
    const headers = v1Send(payload); // 서버 WEBHOOK_SECRET 미설정 상태
    expect(headers['x-storige-signature-hmac']).toBeUndefined();
    const result = verifyWebhookSignature({ headers, payload, secret: V1_SECRET });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toBe('INSECURE_LEGACY_SIGNATURE');
  });

  it('allowInsecureLegacy: true 에서만 통과하고 insecureLegacy 표식이 붙는다', () => {
    const headers = v1Send(payload);
    const result = verifyWebhookSignature({
      headers,
      payload,
      secret: V1_SECRET,
      allowInsecureLegacy: true,
    });
    expectValid(result);
    expect(result.insecureLegacy).toBe(true);
    expect(result.t).toBeNull(); // 레거시 서명엔 서명 시각이 없다 → replay 판정 불가
    expect(result.identifier).toBe('job-legacy');
  });

  it('시크릿 없이 위조 가능함을 실증한다 — 공격자가 계산한 base64 가 그대로 통과', () => {
    const forged = {
      event: 'synthesis.completed',
      jobId: 'attacker-job',
      status: 'completed',
      outputFileUrl: 'https://attacker.example/evil.pdf',
      timestamp: iso(),
    };
    // 공격자는 secret 없이 base64 를 계산할 수 있다
    const forgedSignature = Buffer.from(
      `${forged.jobId}:${forged.event}:${forged.timestamp}`,
    ).toString('base64');
    const result = verifyWebhookSignature({
      headers: { 'x-storige-signature': forgedSignature },
      payload: forged,
      secret: V1_SECRET,
      allowInsecureLegacy: true,
    });
    // 통과한다 — 이것이 이 옵션을 **기본 거부**로 둔 이유다
    expectValid(result);
    expect(result.insecureLegacy).toBe(true);
  });

  it('레거시 값이 틀리면 opt-in 이어도 거부한다(오배송/손상 검출)', () => {
    const result = verifyWebhookSignature({
      headers: { 'x-storige-signature': 'bm90LWEtdmFsaWQtc2lnbmF0dXJl' },
      payload,
      secret: V1_SECRET,
      allowInsecureLegacy: true,
    });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toBe('SIGNATURE_MISMATCH');
  });

  it('HMAC 헤더가 함께 오면 레거시는 무시하고 HMAC 을 쓴다', () => {
    const headers = v1Send(payload, V1_SECRET);
    expect(headers['x-storige-signature']).toBeDefined();
    const result = verifyWebhookSignature({ headers, payload, secret: V1_SECRET });
    expectValid(result);
    expect(result.insecureLegacy).toBe(false); // HMAC 경로로 통과
    expect(result.t).not.toBeNull();
  });

  it('레거시 헤더를 위조로 덧붙여도 HMAC 검증을 우회하지 못한다', () => {
    const headers = v1Send(payload, V1_SECRET);
    const result = verifyWebhookSignature({
      headers: { ...headers, 'x-storige-signature-hmac': `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` },
      payload,
      secret: V1_SECRET,
      allowInsecureLegacy: true, // 켜져 있어도 HMAC 헤더가 있으면 HMAC 경로다
    });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toBe('SIGNATURE_MISMATCH');
  });
});

describe('identifier 전략 판별', () => {
  it('auto: X-Storige-Delivery 있으면 v2 규칙', () => {
    const payload = { event: 'webhook.test', deliveryUid: 'whd_auto', timestamp: iso() };
    const { headers } = v2Send(payload, V2_SECRET, 'whd_auto');
    const result = verifyWebhookSignature({ headers, payload, secret: V2_SECRET });
    expectValid(result);
    expect(result.identifier).toBe('whd_auto'); // uid 폴백 = v2 규칙의 증거
  });

  it('auto: X-Storige-Delivery 없으면 v1 규칙', () => {
    const payload = { event: 'book.finalization.completed', finalizationUid: 'fin_auto', timestamp: iso() };
    const headers = v1Send(payload, V1_SECRET);
    const result = verifyWebhookSignature({ headers, payload, secret: V1_SECRET });
    expectValid(result);
    expect(result.identifier).toBe('fin_auto'); // finalizationUid = v1 규칙의 증거
  });

  it('명시 전략은 auto 판별을 덮어쓴다', () => {
    const payload = { event: 'synthesis.completed', jobId: 'j', timestamp: iso() };
    const { headers } = v2Send(payload, V2_SECRET, 'whd_ov');
    // v1·v2 규칙이 같은 결과를 내는 페이로드라 강제해도 통과한다
    expectValid(
      verifyWebhookSignature({
        headers,
        payload,
        secret: V2_SECRET,
        identifierStrategy: 'v1',
      }),
    );
  });
});

describe('입력 방어', () => {
  const payload = { event: 'synthesis.completed', jobId: 'j', timestamp: iso() };

  it('Headers 인스턴스(Next.js/fetch)를 받는다', () => {
    const { headers } = v2Send(payload, V2_SECRET, 'whd_h');
    expectValid(
      verifyWebhookSignature({ headers: new Headers(headers), payload, secret: V2_SECRET }),
    );
  });

  it('헤더 대소문자를 가리지 않는다', () => {
    const { headers } = v2Send(payload, V2_SECRET, 'whd_case');
    const upper: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) upper[k.toUpperCase()] = v;
    expectValid(verifyWebhookSignature({ headers: upper, payload, secret: V2_SECRET }));
  });

  it('배열 헤더값(express 중복 헤더)은 첫 값을 쓴다', () => {
    const { headers } = v2Send(payload, V2_SECRET, 'whd_arr');
    expectValid(
      verifyWebhookSignature({
        headers: {
          ...headers,
          'x-storige-signature-hmac': [headers['x-storige-signature-hmac'] as string, 'garbage'],
        },
        payload,
        secret: V2_SECRET,
      }),
    );
  });

  it.each([
    ['빈 문자열', ''],
    ['undefined (env 미주입 — process.env.X! 의 런타임 실체)', undefined],
    ['null', null],
    ['숫자', 123],
    ['객체(Buffer 오전달 등)', {}],
  ])('secret 이 %s 면 StorigeUsageError — 검증 실패로 위장하지 않는다', (_name, secret) => {
    const { headers } = v2Send(payload, V2_SECRET, 'whd_nosecret');
    // 🚨 수정 전에는 undefined 에서 `secret.length` TypeError 가 났다 → express 4 는
    //    async rejection 을 next(err) 로 안 넘김 → unhandledRejection → 프로세스 종료.
    //    유효 서명이 필요 없는 경로였다(HMAC 헤더 값은 아무거나면 성립).
    expect(() =>
      verifyWebhookSignature({ headers, payload, secret: secret as string }),
    ).toThrow(StorigeUsageError);
  });

  it('secret 오설정은 서명 파싱보다 먼저 걸린다 — 형식 불량 헤더로도 크래시하지 않는다', () => {
    // 공격자가 보내는 것: 유효 서명이 아니라 **아무 문자열**
    expect(() =>
      verifyWebhookSignature({
        headers: { 'x-storige-signature-hmac': 'anything-goes' },
        payload,
        secret: undefined as unknown as string,
      }),
    ).toThrow(StorigeUsageError); // TypeError 가 아니다
  });

  it('레거시 경로는 secret 없이도 성립한다 — 시크릿이 서명에 불참여하므로', () => {
    // secret 단언을 "필요해지는 지점"(HMAC 경로)에 둔 이유. 서버 WEBHOOK_SECRET
    // 미설정 상태(레거시만 발신)에서 opt-in 한 수신측을 강제로 깨지 않는다.
    const legacyOnly = v1Send(payload);
    const result = verifyWebhookSignature({
      headers: legacyOnly,
      payload,
      secret: undefined as unknown as string,
      allowInsecureLegacy: true,
    });
    expectValid(result);
    expect(result.insecureLegacy).toBe(true);
  });

  it('payload 가 객체가 아니면 서명이 맞을 수 없다 → 거부(크래시 금지)', () => {
    const { headers } = v2Send(payload, V2_SECRET, 'whd_nonobj');
    for (const bad of [null, undefined, 'string', 42, ['a']]) {
      const result = verifyWebhookSignature({ headers, payload: bad, secret: V2_SECRET });
      expect(result.valid).toBe(false);
    }
  });
});

describe('본문 무결성 한계 (계약 현실 — 이 단언이 깨지는 날 = 서버 계약이 바뀐 날)', () => {
  it('⚠️ 서명에 안 들어간 본문 필드는 변조해도 탐지되지 않는다', () => {
    const payload = {
      event: 'synthesis.completed',
      jobId: 'job-integrity',
      status: 'completed',
      outputFileUrl: '/storage/outputs/real.pdf',
      timestamp: iso(),
    };
    const { headers } = v2Send(payload, V2_SECRET, 'whd_int');

    // 서명 data 는 `${t}.${jobId}:${event}:${timestamp}` 뿐 —
    // outputFileUrl/status 등은 덮이지 않는다. 중간자가 바꿔치기해도 valid 다.
    const tampered = {
      ...payload,
      outputFileUrl: 'https://attacker.example/evil.pdf',
      status: 'failed',
    };
    const result = verifyWebhookSignature({ headers, payload: tampered, secret: V2_SECRET });
    expectValid(result); // ⚠️ 통과한다

    // → 그래서 SDK 는 "본문을 신뢰하지 말고 identifier 로 재조회하라"를
    //   모듈 JSDoc·README 에 명시한다. identifier 만은 서명에 포함되므로 신뢰 가능.
    expect(result.identifier).toBe('job-integrity');
  });
});
