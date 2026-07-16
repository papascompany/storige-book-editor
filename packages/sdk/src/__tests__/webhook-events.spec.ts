/**
 * 웹훅 이벤트 카탈로그·페이로드 + 멱등 헬퍼.
 *
 * ⚠️ **감시 강도가 두 종류로 갈린다** — 뭉뚱그리면 방어를 과신하게 된다:
 *
 *  ① **페이로드 3종**(validation·synthesis·book.finalization): @storige/types 를
 *     **실제 import** 해 컴파일 타임 상호 할당으로 못 박는다 → 서버가 이 타입들을
 *     바꾸면 **자동 red**. (types-parity.spec.ts 와 동일 전략)
 *
 *  ② **이벤트 카탈로그**·SessionWebhookPayload: 정본이 `packages/types` 가 아니라
 *     `apps/api` 안에 있어 **import 경로 자체가 없다** → 값 스냅샷·수기 대조뿐이다.
 *     이건 "SDK 상수를 누가 몰래 바꿨는가"는 잡지만 **서버 변경은 못 잡는다**
 *     (서버가 이벤트를 추가해도 여기는 green). 진짜 교차대조로 승격하려면 서버측
 *     상수를 packages/types 로 옮겨야 한다 = 서버 변경이라 별도 트랙.
 */

import { describe, expect, it } from 'vitest';
import type {
  BookFinalizationWebhookPayload as ServerBookFinalizationPayload,
  SynthesisWebhookPayload as ServerSynthesisPayload,
  ValidationWebhookPayload as ServerValidationPayload,
} from '@storige/types';
import {
  InMemoryWebhookDeduper,
  isSubscribableEvent,
  WEBHOOK_SUBSCRIBABLE_EVENTS,
  WEBHOOK_TEST_EVENT,
  type BookFinalizationWebhookPayload,
  type StorigeWebhookPayload,
  type SynthesisWebhookPayload,
  type ValidationWebhookPayload,
} from '../webhook';

describe('이벤트 카탈로그 (서버 webhook-v2.constants.ts 미러)', () => {
  it('구독 가능 이벤트는 9종이다', () => {
    expect(WEBHOOK_SUBSCRIBABLE_EVENTS).toHaveLength(9);
  });

  it('카탈로그 값이 서버 WEBHOOK_V2_SUBSCRIBABLE_EVENTS 와 1:1 (2026-07-16 채록 스냅샷)', () => {
    // 서버 정본(webhook-v2.constants.ts:65-76) 순서까지 그대로.
    // ⚠️ **이건 서버 드리프트 감시가 아니다.** 정본이 apps/api 에 있어 import 경로가
    //    없으므로 값 스냅샷을 박제할 뿐이다 — 서버가 이벤트를 **추가해도 이 테스트는
    //    green** 이다(수기 추종 필요). 잡아 주는 것은 "SDK 상수의 무단 변경"뿐이다.
    expect([...WEBHOOK_SUBSCRIBABLE_EVENTS]).toEqual([
      'validation.completed',
      'validation.fixable',
      'validation.failed',
      'synthesis.completed',
      'synthesis.failed',
      'session.validated',
      'session.failed',
      'book.finalization.completed',
      'book.finalization.failed',
    ]);
  });

  it('webhook.test 는 구독 목록에 없다(구독 무관 발송)', () => {
    expect(WEBHOOK_TEST_EVENT).toBe('webhook.test');
    expect(WEBHOOK_SUBSCRIBABLE_EVENTS as readonly string[]).not.toContain(WEBHOOK_TEST_EVENT);
  });

  it('isSubscribableEvent 는 카탈로그 밖 문자열을 배제한다', () => {
    expect(isSubscribableEvent('synthesis.completed')).toBe(true);
    expect(isSubscribableEvent('book.finalization.failed')).toBe(true);
    expect(isSubscribableEvent('webhook.test')).toBe(false);
    expect(isSubscribableEvent('future.event')).toBe(false);
    // Object.prototype 상속 키를 오인하지 않는다
    expect(isSubscribableEvent('toString')).toBe(false);
    expect(isSubscribableEvent('constructor')).toBe(false);
  });
});

describe('페이로드 구조 등가성 (@storige/types 드리프트 감시)', () => {
  it('ValidationWebhookPayload ↔ 서버 정본', () => {
    const server: ServerValidationPayload = {
      event: 'validation.fixable',
      jobId: 'job-1',
      sessionId: 'sess-1',
      fileType: 'cover',
      orderSeqno: 7,
      status: 'fixable',
      result: { errors: [] },
      errorMessage: 'x',
      timestamp: '2026-07-16T00:00:00.000Z',
    };
    // 서버 → SDK 할당 가능(필드 누락/타입 불일치 시 tsc red)
    const sdk: ValidationWebhookPayload = server;
    expect(sdk.jobId).toBe('job-1');
  });

  it('SynthesisWebhookPayload ↔ 서버 정본 (outputFiles 포함)', () => {
    const server: ServerSynthesisPayload = {
      event: 'synthesis.completed',
      jobId: 'job-2',
      status: 'completed',
      outputFileUrl: '/storage/outputs/merged.pdf',
      outputFiles: [
        { type: 'cover', url: '/c.pdf', pageCount: 2 },
        { type: 'content', url: '/i.pdf', pageCount: 40 },
      ],
      outputFormat: 'separate',
      queueJobId: 42,
      timestamp: '2026-07-16T00:00:00.000Z',
    };
    const sdk: SynthesisWebhookPayload = server;
    expect(sdk.outputFiles?.[0]?.type).toBe('cover');
  });

  it('BookFinalizationWebhookPayload ↔ 서버 정본 (validationSkipped 포함)', () => {
    const server: ServerBookFinalizationPayload = {
      event: 'book.finalization.completed',
      bookUid: 'bk_1',
      finalizationUid: 'fin_1',
      status: 'completed',
      pageCount: 40,
      outputFileId: 'file-1',
      errorCode: null,
      timestamp: '2026-07-16T00:00:00.000Z',
      isTest: true,
      // Stage 3 배치B additive — 미검증 FINALIZED 표식
      validationSkipped: true,
    };
    const sdk: BookFinalizationWebhookPayload = server;
    expect(sdk.validationSkipped).toBe(true);
  });

  it('SessionWebhookPayload 는 @storige/types 에 없다 — 수기 대조 대상임을 박제', () => {
    // 서버 선언 위치: apps/api/src/webhook/webhook.service.ts:16-25
    // (다른 3종과 달리 공유 타입 패키지에 없어 자동 감시가 불가능하다)
    const payload: StorigeWebhookPayload = {
      event: 'session.validated',
      sessionId: 'sess-9',
      orderSeqno: 3,
      status: 'validated',
      fileType: 'content',
      timestamp: '2026-07-16T00:00:00.000Z',
    };
    expect(payload.event).toBe('session.validated');
  });
});

describe('discriminated union 좁히기', () => {
  it('event 로 페이로드가 좁혀진다', () => {
    const payloads: StorigeWebhookPayload[] = [
      {
        event: 'synthesis.completed',
        jobId: 'j1',
        status: 'completed',
        outputFileUrl: '/m.pdf',
        timestamp: '2026-07-16T00:00:00.000Z',
      },
      {
        event: 'book.finalization.completed',
        bookUid: 'bk_1',
        finalizationUid: 'fin_1',
        status: 'completed',
        validationSkipped: false,
        timestamp: '2026-07-16T00:00:00.000Z',
      },
      {
        event: 'webhook.test',
        deliveryUid: 'whd_1',
        isTest: true,
        message: 'ping',
        timestamp: '2026-07-16T00:00:00.000Z',
      },
    ];

    const seen: string[] = [];
    for (const payload of payloads) {
      switch (payload.event) {
        case 'synthesis.completed':
          seen.push(payload.outputFileUrl); // ✅ 좁혀짐(컴파일 타임 단언)
          break;
        case 'book.finalization.completed':
          seen.push(payload.finalizationUid);
          break;
        case 'webhook.test':
          seen.push(payload.deliveryUid);
          break;
        default:
          break; // 모르는 이벤트 무시(카탈로그 additive 성장 대비)
      }
    }
    expect(seen).toEqual(['/m.pdf', 'fin_1', 'whd_1']);
  });
});

describe('InMemoryWebhookDeduper (참조 구현 — 프로덕션 부적합)', () => {
  it('최초 claim 은 true, 재배달은 false 로 단락된다', () => {
    const deduper = new InMemoryWebhookDeduper();
    expect(deduper.claim('whd_1')).toBe(true);
    expect(deduper.claim('whd_1')).toBe(false);
    expect(deduper.claim('whd_1')).toBe(false);
  });

  it('서로 다른 delivery 는 독립이다', () => {
    const deduper = new InMemoryWebhookDeduper();
    expect(deduper.claim('whd_1')).toBe(true);
    expect(deduper.claim('whd_2')).toBe(true);
    expect(deduper.size).toBe(2);
  });

  it('서버 재시도 4회(인라인1+큐3)를 1회로 접는다', () => {
    const deduper = new InMemoryWebhookDeduper();
    const uid = 'whd_retry';
    const accepted = [0, 60_000, 300_000, 1_800_000].map(() => deduper.claim(uid));
    expect(accepted).toEqual([true, false, false, false]);
  });

  it('TTL 이 지나면 다시 처리된다(수동 재발송 대비 — 안전성 vs 활성)', () => {
    let now = 1_000_000;
    const deduper = new InMemoryWebhookDeduper({ ttlMs: 1000, now: () => now });
    expect(deduper.claim('whd_ttl')).toBe(true);
    now += 999;
    expect(deduper.claim('whd_ttl')).toBe(false);
    now += 2;
    expect(deduper.claim('whd_ttl')).toBe(true); // 창 밖 → 재처리
  });

  it('release 하면 다음 배달이 다시 처리된다(핸들러 실패 복구 경로)', () => {
    const deduper = new InMemoryWebhookDeduper();
    expect(deduper.claim('whd_rel')).toBe(true);
    deduper.release('whd_rel');
    expect(deduper.claim('whd_rel')).toBe(true);
  });

  it('만료분은 자동 정리된다 — 무한 증가하지 않는다', () => {
    let now = 0;
    const deduper = new InMemoryWebhookDeduper({ ttlMs: 100, now: () => now });
    for (let i = 0; i < 50; i += 1) deduper.claim(`whd_${i}`);
    expect(deduper.size).toBe(50);
    now += 101;
    expect(deduper.size).toBe(0);
  });

  it('maxEntries 를 넘으면 오래된 것부터 버린다(메모리 상한 = 정확도 상한)', () => {
    const deduper = new InMemoryWebhookDeduper({ maxEntries: 3 });
    for (const uid of ['a', 'b', 'c', 'd']) deduper.claim(uid);
    expect(deduper.size).toBe(3);
    // 'a' 는 밀려났으므로 재배달이 단락되지 않는다 — 문서화된 한계
    expect(deduper.claim('a')).toBe(true);
    // 최근 것은 여전히 기억한다
    expect(deduper.claim('d')).toBe(false);
  });

  it('clear 는 전부 잊는다', () => {
    const deduper = new InMemoryWebhookDeduper();
    deduper.claim('whd_x');
    deduper.clear();
    expect(deduper.claim('whd_x')).toBe(true);
  });
});
