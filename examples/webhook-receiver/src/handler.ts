/**
 * 이벤트 핸들러 — 검증을 통과한 웹훅으로 **무엇을 할 것인가**.
 *
 * ============================================================================
 * 이 파일이 지키는 두 가지 규칙
 * ============================================================================
 *
 * ## ① 본문의 권위를 믿지 마라 — 서명은 본문을 덮지 않는다
 * 서명 대상은 `${t}.${identifier}:${event}:${timestamp}` **4개 값뿐**이다.
 * `status`·`outputFileId`·`errorCode`·`pageCount` 같은 나머지 본문 필드는
 * **서명 밖**이라 전송 중 변조돼도 탐지되지 않는다(본문 무결성은 현재 전적으로
 * TLS 에 의존한다).
 *
 * → 결제·발주·상태확정 같은 **부수효과의 근거는 본문이 아니라 재조회**에서 취하라.
 *   본문은 "뭔가 바뀌었다"는 **알림 트리거**로만 쓰는 것이 안전하다.
 *   (본문만 믿어도 되는 경우는 그 값이 부수효과를 만들지 않을 때뿐이다 — 로그·UI 힌트)
 *
 * ## ② SDK 의 uid 단락은 **신뢰성** 통제이지 **인증** 통제가 아니다
 * dedupe 키인 `X-Storige-Delivery` 는 서명 밖 헤더다(identifier 가 jobId/sessionId 로
 * 정해지는 페이로드에서는 uid 가 서명 data 에 들어가지 않는다). 유효 서명 1건을
 * 캡처한 공격자는 **uid 헤더만 바꿔** 같은 서명을 replay 창 안에서 반복 재생할 수
 * 있다 — 단락은 uid 가 다르니 걸리지 않고, 서명은 uid 를 안 덮으니 그대로 유효하다.
 *
 * → 부작용이 있는 핸들러는 **자체 도메인 멱등을 병행**하라. 아래 `DomainIdempotency`
 *   가 그 자리다: 주문 uid·(finalizationUid, event) 같은 **본인 도메인 키**로
 *   "이미 처리했는가"를 판정하고, 상태 전이는 조건부 갱신(CAS)으로 한다.
 *   SDK 의 uid 단락은 그 위에 얹는 1차 필터(서버 재시도 접기)다.
 */

import type { WebhookHandler, WebhookHandlerContext } from '@storige/sdk/webhook';
import type { StorigeWebhookPayload } from '@storige/sdk/webhook';
import type { StorigeClient } from '@storige/sdk/client';

/**
 * 도메인 멱등 저장소 — "이 도메인 키를 이미 처리했는가".
 *
 * ⚠️ 운영에서는 **DB 유니크 제약**이나 Redis `SET NX` 처럼 원자적 check-and-set 으로
 *    구현하라. "조회 후 저장" 2단계는 동시 배달에서 둘 다 통과한다.
 */
export interface DomainIdempotency {
  /** @returns true = 최초 처리(진행) / false = 이미 처리함(단락) */
  claim(domainKey: string): boolean | Promise<boolean>;
}

/** 데모용 인메모리 구현 — 프로세스 재시작·다중 인스턴스에서 무력하다 */
export class InMemoryDomainIdempotency implements DomainIdempotency {
  private readonly seen = new Set<string>();

  claim(domainKey: string): boolean {
    if (this.seen.has(domainKey)) return false;
    this.seen.add(domainKey);
    return true;
  }

  get size(): number {
    return this.seen.size;
  }
}

export interface HandlerDeps {
  processed: DomainIdempotency;
  /**
   * 본문 대신 서버에 되물을 클라이언트.
   *
   * 생략하면 재조회를 건너뛴다(데모 편의) — 그 경우 로그에 그 사실을 남긴다.
   * **운영에서는 반드시 넘겨라.**
   */
  client?: StorigeClient | undefined;
  log?: ((message: string) => void) | undefined;
}

export function createStorigeWebhookHandler(deps: HandlerDeps): WebhookHandler {
  const log = deps.log ?? console.log;

  return async (payload: StorigeWebhookPayload, ctx: WebhookHandlerContext): Promise<void> => {
    // 레거시 base64 서명으로 통과한 요청 — 시크릿이 참여하지 않아 **위조 가능**하다.
    // 기본 설정(allowInsecureLegacy:false)에서는 여기 오지 않지만, 켠 경우를 대비해
    // 부수효과를 게이팅한다.
    if (ctx.insecureLegacy) {
      log('⚠️ 위조 가능한 레거시 서명 — 부수효과 없이 로그만 남긴다');
      return;
    }

    switch (payload.event) {
      // ── 도서 최종화(Partner API v1 의 주 이벤트) ─────────────────────
      case 'book.finalization.completed': {
        // 도메인 키 = (이벤트, 최종화 uid). SDK 의 delivery uid 단락과 **별개**로
        // 한 번 더 막는다 — uid 헤더를 바꾼 재생은 여기서 걸린다.
        if (!(await deps.processed.claim(`${payload.event}:${payload.finalizationUid}`))) {
          log(`· 도메인 멱등 단락 — ${payload.finalizationUid} 는 이미 처리했다`);
          return;
        }

        if (deps.client === undefined) {
          log(
            `▶ ${payload.event} bookUid=${payload.bookUid} (재조회 생략 — ` +
              'STORIGE_API_KEY 미설정. 운영에서는 반드시 재조회하라)',
          );
          return;
        }

        // 🔑 본문의 status 를 믿지 않고 서버에 되묻는다.
        //    bookUid 는 본문 값이지만, 서버가 **자기 테넌트의 도서만** 돌려주고
        //    상태도 서버가 준 값을 쓰므로 결정의 권위는 서버에 있다.
        const fin = await deps.client.books.getFinalization(payload.bookUid);
        if (fin.status !== 'COMPLETED') {
          log(`· 본문은 completed 였지만 서버는 ${fin.status} — 서버를 따른다`);
          return;
        }

        if (fin.validationSkipped) {
          // 대조 판형이 없어 워커 구조 검증을 건너뛴 채 최종화됐다 = 미검증 FINALIZED.
          // 자동 발주로 흘리지 말고 자체 검수 게이트를 태워라.
          log(`⚠️ validationSkipped — ${payload.bookUid} 는 미검증 FINALIZED. 수동 검수 대기열로`);
          return;
        }

        // 여기서부터가 실제 부수효과다(주문 확정·PDF 인계 등).
        // 상태 전이는 조건부 갱신(CAS)으로: `WHERE status='PENDING'` 같은 조건을 걸어라.
        log(`✓ ${payload.bookUid} 최종화 완료 — pageCount=${fin.pageCount} file=${fin.outputFileId}`);
        break;
      }

      case 'book.finalization.failed': {
        if (!(await deps.processed.claim(`${payload.event}:${payload.finalizationUid}`))) return;
        // 분기는 errorCode 로 — message 문자열 파싱 금지
        log(`✗ ${payload.bookUid} 최종화 실패 — errorCode=${payload.errorCode}`);
        break;
      }

      // ── 워커 잡(편집기/오프로드 경로) ────────────────────────────────
      case 'validation.completed':
      case 'validation.fixable':
      case 'validation.failed': {
        if (!(await deps.processed.claim(`${payload.event}:${payload.jobId}`))) return;
        log(`▶ ${payload.event} job=${payload.jobId} fileType=${payload.fileType}`);
        break;
      }

      case 'synthesis.completed':
      case 'synthesis.failed': {
        if (!(await deps.processed.claim(`${payload.event}:${payload.jobId}`))) return;
        log(`▶ ${payload.event} job=${payload.jobId} output=${payload.outputFileUrl || '(없음)'}`);
        break;
      }

      case 'session.validated':
      case 'session.failed': {
        if (!(await deps.processed.claim(`${payload.event}:${payload.sessionId}`))) return;
        log(`▶ ${payload.event} session=${payload.sessionId}`);
        break;
      }

      // ── 테스트 발송 — 구독 목록과 무관하게 온다 ──────────────────────
      case 'webhook.test':
        log(`▶ webhook.test — ${payload.message} (배선 확인용, 부수효과 없음)`);
        break;

      default:
        // 🚨 **모르는 이벤트에서 던지지 마라.** 던지면 500 → 서버가 4회 재시도하고
        //    그 뒤 EXHAUSTED 로 남는다(내 로그도 파트너 대시보드도 빨개진다).
        //    카탈로그는 additive 로만 자라므로 조용히 무시하는 것이 계약이다.
        log(`· 미지의 이벤트 무시 — ${(payload as { event?: string }).event}`);
    }
  };
}

export type { WebhookHandlerContext };
