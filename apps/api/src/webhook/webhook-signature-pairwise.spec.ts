/**
 * 웹훅 서명 페어와이즈 골든 테스트 (Phase 0 — 서명 3종 대조표의 실행형)
 *
 * 발신부(WebhookService 실코드) ↔ 수신부 3종(파트너 레포 검증 로직의 "출처 명시 스냅샷")을
 * 한 spec 에서 맞물려 실행해, 현행 호환성과 **문서화된 불일치**를 전부 green 단언으로 박제한다.
 * 정본 대조표: docs/WEBHOOK_SIGNATURE_MATRIX_2026-07-03.md
 *
 * ⚠️ 이 테스트의 "불일치 단언"(expect(...).toBe(false))은 버그 리포트가 아니라 계약 현실이다:
 *   웹훅 v2(opt-in) 게이트 조건 = "발신 실서명 ↔ 수신 검증 페어와이즈 green".
 *   수신부가 코드를 바꾸면(예: bookmoa 가 시크릿 검증 활성) 이 스냅샷과 대조표를 함께 갱신하라.
 *
 * 수신부 스냅샷 출처 (2026-07-03 채록 — 원본 변경 시 여기도 갱신):
 *  - bookmoa-mobile: bookmoa-mobile/api/storige/webhook.js:33-49 (+128-138 게이트)
 *  - Sharesnap:      Sharesnap/src/modules/photobook/services/storigeServer.ts:382-400
 *                    (+ app/api/storige/webhook/route.ts: 서명헤더 누락 && X-Storige-Retry==='1' 통과)
 *  - MD2Books:       MD2Books/app/routes/api.v1.webhooks.storige.ts:27-60 — 서명 미검증(재조회 대체)
 */
import { createHmac } from 'crypto';
import { WebhookService, SynthesisWebhookPayload } from './webhook.service';

// ────────────────────────── 수신부 스냅샷 레플리카 ──────────────────────────

/** bookmoa-mobile verifySignature 스냅샷 (webhook.js:33-49). secret 유무로 HMAC/레거시 분기. */
function bookmoaVerify(
  signatureHeader: string | undefined,
  payload: { jobId?: string | null; sessionId?: string; event: string; timestamp: string },
  secret: string | undefined,
): boolean {
  if (!signatureHeader) return false; // 서명 필수(C-2: retry 우회 제거됨)
  const identifier = payload.jobId ?? payload.sessionId; // ⚠️ nullish — 발신부는 'jobId' in payload
  if (!identifier || !payload.event || !payload.timestamp) return false;
  const data = `${identifier}:${payload.event}:${payload.timestamp}`;
  const expected = secret
    ? createHmac('sha256', secret).update(data).digest('base64') // ⚠️ base64 (발신 HMAC 은 hex+t=)
    : Buffer.from(data, 'utf8').toString('base64');
  const a = Buffer.from(String(signatureHeader));
  const b = Buffer.from(expected);
  return a.length === b.length && a.equals(b); // timingSafeEqual 동치(테스트 용)
}

/** bookmoa-mobile 신선도 게이트 스냅샷 (webhook.js:134-138): Date.parse ±10분. */
function bookmoaFresh(timestamp: string, nowMs: number): boolean {
  const t = Date.parse(timestamp);
  return !Number.isNaN(t) && Math.abs(nowMs - t) <= 10 * 60 * 1000;
}

/** Sharesnap 검증 스냅샷 (storigeServer.ts:382-400 + route.ts 게이트). 시크릿 불참여 순수 base64. */
function sharesnapVerify(
  signatureHeader: string | undefined,
  retryHeader: string | undefined,
  payload: { jobId?: string | null; sessionId?: string; event: string; timestamp: string },
): boolean {
  if (!signatureHeader) return retryHeader === '1'; // ⚠️ 서명 누락 + 재시도 헤더 = 통과(구멍, 문서화)
  const identifier = payload.jobId ?? payload.sessionId;
  if (!identifier || !payload.event || !payload.timestamp) return false;
  const expected = Buffer.from(`${identifier}:${payload.event}:${payload.timestamp}`, 'utf8').toString('base64');
  return signatureHeader === expected;
}

/** MD2Books 스냅샷: 서명 헤더를 읽지 않는다(api.v1.webhooks.storige.ts — 재조회로 권위 대체). */
function md2booksVerify(_signatureHeader: string | undefined): boolean {
  return true; // 어떤 서명값이든(생략 포함) 서명 단계는 통과 — 방어는 jobId 재조회 4겹
}

// ────────────────────────── 테스트 ──────────────────────────

describe('웹훅 서명 페어와이즈 (발신 실코드 ↔ 수신 3종 스냅샷)', () => {
  let prevSecret: string | undefined;
  beforeEach(() => {
    prevSecret = process.env.WEBHOOK_SECRET;
  });
  afterEach(() => {
    if (prevSecret === undefined) delete process.env.WEBHOOK_SECRET;
    else process.env.WEBHOOK_SECRET = prevSecret;
  });

  /** 발신부 실코드로 헤더 생성 (webhook.service.ts buildHeaders) */
  function send(payload: SynthesisWebhookPayload): Record<string, string> {
    const svc = new WebhookService();
    return (svc as any).buildHeaders(payload);
  }

  function freshPayload(overrides: Partial<SynthesisWebhookPayload> = {}): SynthesisWebhookPayload {
    return {
      event: 'synthesis.completed',
      jobId: 'a1b2c3d4-0000-4000-8000-000000000001',
      status: 'completed',
      outputFileUrl: '/storage/outputs/merged.pdf',
      timestamp: new Date().toISOString(),
      ...overrides,
    } as SynthesisWebhookPayload;
  }

  // ── 현행 호환(v1 base64 기준선) — 전부 PASS 여야 무중단 ──

  it('레거시 base64 → bookmoa(시크릿 미설정, 현행 운영): 검증 통과 + 신선도 통과', () => {
    const payload = freshPayload();
    const h = send(payload);
    expect(bookmoaVerify(h['X-Storige-Signature'], payload, undefined)).toBe(true);
    expect(bookmoaFresh(payload.timestamp, Date.now())).toBe(true);
  });

  it('레거시 base64 → Sharesnap: 검증 통과', () => {
    const payload = freshPayload();
    const h = send(payload);
    expect(sharesnapVerify(h['X-Storige-Signature'], undefined, payload)).toBe(true);
  });

  it('레거시 base64 → MD2Books: 서명 미검증(재조회 대체) — 항상 통과', () => {
    const payload = freshPayload();
    const h = send(payload);
    expect(md2booksVerify(h['X-Storige-Signature'])).toBe(true);
    expect(md2booksVerify(undefined)).toBe(true); // 헤더 생략도 동일
  });

  it('세션 계열(sessionId, jobId 키 부재) 레거시 서명 → bookmoa/Sharesnap 통과', () => {
    const payload = {
      event: 'session.validated',
      sessionId: 'sess-0001',
      timestamp: new Date().toISOString(),
    } as unknown as SynthesisWebhookPayload;
    const h = send(payload);
    expect(bookmoaVerify(h['X-Storige-Signature'], payload as any, undefined)).toBe(true);
    expect(sharesnapVerify(h['X-Storige-Signature'], undefined, payload as any)).toBe(true);
  });

  // ── 문서화된 불일치 (P0-1) — "이 단언이 깨지는 날 = 수신부가 바뀐 날" ──

  it('[문서화된 불일치] bookmoa 가 STORIGE_WEBHOOK_SECRET 를 설정하면: 발신 어느 헤더로도 검증 불가(전량 401 경로)', () => {
    process.env.WEBHOOK_SECRET = 'shared-secret';
    const payload = freshPayload();
    const h = send(payload);
    // (a) 레거시 헤더: bookmoa 는 HMAC-base64 를 기대 → 불일치
    expect(bookmoaVerify(h['X-Storige-Signature'], payload, 'shared-secret')).toBe(false);
    // (b) HMAC 헤더를 레거시 헤더 자리에 넣어도: t=,v1= hex ≠ HMAC-base64 → 불일치
    expect(bookmoaVerify(h['X-Storige-Signature-HMAC'], payload, 'shared-secret')).toBe(false);
    // (c) bookmoa 는 X-Storige-Signature-HMAC 헤더를 읽는 코드 자체가 없다(정찰 grep 0건)
    //     → "시크릿만 맞추면 된다"는 오답. opt-in 은 수신부 재작성 선행 필수(계획서 §2.3).
  });

  it('[문서화된 불일치] identifier 연산자 차이: jobId 키가 null 로 존재하면 발신(in)≠수신(??) → 검증 실패', () => {
    const payload = freshPayload({ jobId: null as unknown as string, sessionId: 'sess-0002' } as any);
    const h = send(payload);
    // 발신: 'jobId' in payload → identifier = null → "null:event:ts" 서명
    // 수신: jobId ?? sessionId → identifier = 'sess-0002' → 다른 데이터 → 불일치
    expect(bookmoaVerify(h['X-Storige-Signature'], payload as any, undefined)).toBe(false);
    // 발신부는 jobId 를 null 로 두지 말 것(키 자체를 생략) — 계약 주의사항으로 대조표에 기재.
  });

  it('[문서화된 구멍] Sharesnap: 서명 헤더 누락 + X-Storige-Retry=1 이면 무검증 통과', () => {
    const payload = freshPayload();
    expect(sharesnapVerify(undefined, '1', payload)).toBe(true); // 위조 재시도 벡터
    expect(sharesnapVerify(undefined, undefined, payload)).toBe(false); // 재시도 아니면 차단
  });

  // ── WH-001 HMAC 발신 형식 자체 검증 (소비 수신부 0 — 순수 additive) ──

  it('WH-001 HMAC 발신 형식: t=unix초,v1=hex64 — 수신측 재현식으로 검증 가능', () => {
    process.env.WEBHOOK_SECRET = 'v2-secret';
    const payload = freshPayload();
    const h = send(payload);
    const m = h['X-Storige-Signature-HMAC'].match(/^t=(\d+),v1=([0-9a-f]{64})$/);
    expect(m).not.toBeNull();
    const [, t, v1] = m!;
    const data = `${t}.${payload.jobId}:${payload.event}:${payload.timestamp}`;
    expect(v1).toBe(createHmac('sha256', 'v2-secret').update(data).digest('hex'));
  });
});
