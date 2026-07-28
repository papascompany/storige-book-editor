/**
 * 편집기 → 호스트 메시지의 **검증 단일 지점**.
 *
 * ## 🚨 postMessage 는 아무나 보낼 수 있다
 * `window.addEventListener('message', …)` 는 어떤 오리진의 어떤 프레임/탭이 보낸
 * 메시지도 받는다. 검증 없이 `event.data.payload.sessionId` 를 서버로 넘기면 공격자가
 * 임의 sessionId 를 주입할 수 있다(`compose-mixed` 가 `@Public` 이라 editSessionId 는
 * 사실상 권한 토큰이다). 그래서 아래 4단 게이트를 **전부** 통과한 것만 신뢰한다:
 *
 *   ① `event.origin` 이 화이트리스트에 **정확히 일치**
 *      (endsWith/includes 금지 — `evil-storige.com` 접미 일치 우회가 뚫린다)
 *   ② `event.source` 가 **우리가 띄운 iframe 의 contentWindow**
 *      (같은 오리진의 다른 프레임·팝업이 끼어드는 것을 막는다)
 *   ③ 봉투 형식 `{source:'storige-editor', version:'1', event, payload, timestamp}`
 *   ④ `event` 가 문자열
 *
 * ## ②는 "빼먹으면 꺼지는" 게이트가 아니다 (fail-closed)
 * `expectedSource` 는 **필수 인자**이고 생략하면 `parseEditorMessage` 가 던진다.
 * 게이트를 끄는 유일한 경로는 {@link SKIP_SOURCE_CHECK} 리터럴을 손으로 적는 것뿐이라,
 * 코드 리뷰에서 `grep skip-source-check` 한 번으로 우회 지점이 전부 드러난다.
 * (`mountEditor` 를 쓰면 SDK 가 iframe 을 소유하므로 이 인자를 **넘길 일 자체가 없다**.)
 *
 * ## 레거시 `storige:*` dual-emit 은 여기서 자연히 걸러진다
 * `{type:'storige:completed'}` 형태에는 `source` 필드가 없어 ③에서 탈락한다.
 * 레거시는 `parentOrigin` 미지정 시 `targetOrigin='*'` 로 나가므로 신규 연동에 혼입되면
 * 안 된다.
 */

import {
  EDITOR_MESSAGE_SOURCE,
  EMBED_MESSAGE_VERSION,
  type CompleteAction,
  type EditorCompletePayload,
  type EditorEnvelope,
} from './protocol';

/**
 * ② `event.source` 검사를 **의도적으로** 건너뛸 때만 쓰는 명시 리터럴.
 *
 * 정당한 용도는 window 개념이 없는 환경(Node 측 검증·테스트 하네스)뿐이다. 브라우저에서
 * 이걸 쓰면 편집기 오리진에 열린 **다른 프레임/팝업**이 메시지를 밀어 넣을 수 있다.
 */
export const SKIP_SOURCE_CHECK = 'skip-source-check';

/** MessageEvent 에서 검증에 필요한 최소 형태(실제 `MessageEvent` 가 그대로 대입된다) */
export interface EditorMessageLike {
  readonly origin: string;
  readonly source?: unknown;
  readonly data?: unknown;
}

export type EditorMessageRejectReason =
  | 'ORIGIN_NOT_ALLOWED'
  | 'SOURCE_WINDOW_MISMATCH'
  | 'NOT_EDITOR_ENVELOPE'
  | 'VERSION_MISMATCH';

export type ParseEditorMessageResult =
  | { ok: true; envelope: EditorEnvelope }
  | { ok: false; reason: EditorMessageRejectReason };

export interface ParseEditorMessageOptions {
  /** 편집기 오리진 화이트리스트 — **정확 일치** */
  allowedOrigins: readonly string[];
  /**
   * **필수.** 우리가 띄운 iframe 의 `contentWindow`.
   *
   * 아직 로드 전이라 `null` 이면 ②에서 정상적으로 불일치 처리된다. 생략하면 던진다 —
   * 한 줄 빠뜨렸다고 게이트가 사라지면 안 된다. 진짜로 건너뛰려면
   * {@link SKIP_SOURCE_CHECK} 를 **명시**하라.
   */
  expectedSource: object | null | typeof SKIP_SOURCE_CHECK;
}

/**
 * 수신 메시지를 검증해 정식 엔벨로프만 통과시킨다.
 *
 * @throws {TypeError} `expectedSource` 를 생략한 경우(= 설정 실수. fail-closed)
 */
export function parseEditorMessage(
  message: EditorMessageLike,
  options: ParseEditorMessageOptions,
): ParseEditorMessageResult {
  // ⓪ 사용 오류 먼저 — 게이트가 "조용히 꺼지는" 경로를 없앤다.
  //    reason 으로 돌려주면 호출측이 `if (!parsed.ok) return;` 로 삼켜서
  //    "이벤트가 안 온다"로만 보인다. 배포가 아니라 개발 첫 메시지에서 터뜨린다.
  if (
    options === null ||
    typeof options !== 'object' ||
    !('expectedSource' in options) ||
    options.expectedSource === undefined
  ) {
    throw new TypeError(
      'parseEditorMessage: options.expectedSource 는 필수입니다. ' +
        'iframe.contentWindow 를 넘기거나, 의도적으로 건너뛰려면 ' +
        `expectedSource: '${SKIP_SOURCE_CHECK}' 를 명시하십시오.`,
    );
  }

  // ① 오리진 정확 일치
  if (!options.allowedOrigins.includes(message.origin)) {
    return { ok: false, reason: 'ORIGIN_NOT_ALLOWED' };
  }

  // ② 우리가 띄운 iframe 인가 (명시적 우회 리터럴일 때만 건너뛴다)
  //
  // ⚠️ `expectedSource === null` 은 **아무것도 통과시키지 않는다**. 단순 `!==` 비교만
  //    하면 iframe 미로드(contentWindow=null) 구간에 `source:null` 메시지 —
  //    닫힌 윈도우·worker·MessagePort 발신 — 가 `null !== null === false` 로 게이트를
  //    통과해 버린다(fail-open). "대조할 창이 아직 없다"는 곧 "신뢰할 근거가 없다"이므로
  //    거부가 옳다.
  if (options.expectedSource !== SKIP_SOURCE_CHECK) {
    if (
      options.expectedSource === null ||
      message.source !== options.expectedSource
    ) {
      return { ok: false, reason: 'SOURCE_WINDOW_MISMATCH' };
    }
  }

  // ③ 봉투 형식
  const data = message.data;
  if (typeof data !== 'object' || data === null) {
    return { ok: false, reason: 'NOT_EDITOR_ENVELOPE' };
  }
  const candidate = data as Record<string, unknown>;
  if (candidate.source !== EDITOR_MESSAGE_SOURCE) {
    // 레거시 `{type:'storige:completed'}` 도 여기서 걸린다(source 필드 없음)
    return { ok: false, reason: 'NOT_EDITOR_ENVELOPE' };
  }
  if (candidate.version !== EMBED_MESSAGE_VERSION) {
    // 미래 버전은 조용히 무시한다 — 해석 규칙이 다를 수 있어 추측하면 안 된다
    return { ok: false, reason: 'VERSION_MISMATCH' };
  }

  // ④ event 는 문자열
  if (typeof candidate.event !== 'string') {
    return { ok: false, reason: 'NOT_EDITOR_ENVELOPE' };
  }

  return {
    ok: true,
    envelope: {
      source: EDITOR_MESSAGE_SOURCE,
      version: EMBED_MESSAGE_VERSION,
      event: candidate.event,
      payload: candidate.payload,
      ...(typeof candidate.timestamp === 'string'
        ? { timestamp: candidate.timestamp }
        : {}),
    },
  };
}

// ── 페이로드 판독 ───────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * `editor.complete` payload 판독 — **`guestToken` 값은 결과에 담지 않는다**.
 *
 * payload 는 편집기가 채우는 값이므로 형태를 가정하지 않고 확인한다.
 * `sessionId` 가 없으면 `null` 을 돌려준다(후속 처리 대상이 아님).
 */
export function readCompletePayload(
  payload: unknown,
): EditorCompletePayload | null {
  const p = asRecord(payload);
  if (p === null) return null;
  const sessionId = readString(p.sessionId);
  if (sessionId === undefined) return null;

  const hasGuestToken = typeof p.guestToken === 'string' && p.guestToken !== '';
  // 게스트를 회원으로 오판하면 승격 404, 회원을 게스트로 오판하면 로그인 유도 —
  // 후자가 훨씬 싸다. 그래서 guestToken 만 있고 needsAuth 가 없어도 게스트로 본다.
  const needsAuth = p.needsAuth === true || hasGuestToken;

  const filesRecord = asRecord(p.files) ?? {};
  const files: EditorCompletePayload['files'] = {};
  for (const key of [
    'coverFileId',
    'contentFileId',
    'cover',
    'content',
    'thumbnailUrl',
    'thumbnail',
  ] as const) {
    const v = readString(filesRecord[key]);
    if (v !== undefined) files[key] = v;
  }

  const pagesRecord = asRecord(p.pages);
  const initial = readNumber(pagesRecord?.initial);
  const final = readNumber(pagesRecord?.final);

  const sizeRecord = asRecord(p.size);
  const sizeWidth = readNumber(sizeRecord?.width);
  const sizeHeight = readNumber(sizeRecord?.height);

  const orderSeqno = readNumber(p.orderSeqno);
  const editCode = readString(p.editCode);
  const pageCount = readNumber(p.pageCount);
  const savedAt = readString(p.savedAt);
  const pricing = asRecord(p.pricing);

  return {
    needsAuth,
    action: needsAuth ? 'require-login' : 'promote',
    hasGuestToken,
    sessionId,
    files,
    ...(orderSeqno !== undefined ? { orderSeqno } : {}),
    ...(editCode !== undefined ? { editCode } : {}),
    ...(initial !== undefined && final !== undefined
      ? { pages: { initial, final } }
      : {}),
    ...(pageCount !== undefined ? { pageCount } : {}),
    ...(pricing !== null ? { pricing } : {}),
    ...(sizeWidth !== undefined && sizeHeight !== undefined
      ? { size: { width: sizeWidth, height: sizeHeight, unit: 'mm' as const } }
      : {}),
    ...(savedAt !== undefined ? { savedAt } : {}),
  };
}

/**
 * `editor.complete` 를 받고 **무엇을 할지** 판정한다.
 *
 * 분기 규칙이 두 벌로 갈라지지 않도록 하는 단일 지점이다.
 */
export function decideCompleteAction(
  done: EditorCompletePayload | null,
): CompleteAction {
  if (done === null) return 'ignore';
  return done.needsAuth ? 'require-login' : 'promote';
}

/**
 * payload 에서 게스트 토큰 **값**을 꺼낸다 — 패키지 내부 전용이다.
 *
 * `mount.ts` 가 쓰기 위해 모듈에서만 export 하고 **`./embed` 공개 표면에서는 제외**한다
 * (`index.ts` 재수출 목록에 없다). `mountEditor` 가 이 값을 비공개 슬롯에 넣고, 밖으로는
 * `EditorHandle.consumeGuestToken()` 1회성 소비로만 흘린다.
 */
export function extractGuestToken(payload: unknown): string | null {
  const p = asRecord(payload);
  if (p === null) return null;
  const token = p.guestToken;
  return typeof token === 'string' && token !== '' ? token : null;
}

/** `editor.state` 응답 payload → 상태 스냅샷(requestId 제거) */
export function readStatePayload(payload: unknown): {
  ready: boolean;
  dirty: boolean;
  sessionId: string | null;
} {
  const p = asRecord(payload) ?? {};
  return {
    ready: p.ready === true,
    dirty: p.dirty === true,
    sessionId: readString(p.sessionId) ?? null,
  };
}

/** 응답 payload 의 requestId 추출(없으면 null) */
export function readRequestId(payload: unknown): string | null {
  const p = asRecord(payload);
  if (p === null) return null;
  return readString(p.requestId) ?? null;
}
