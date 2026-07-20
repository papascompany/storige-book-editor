/**
 * 편집기 → 호스트 postMessage 수신 — **검증 로직 단일 지점**.
 *
 * 번들러 없이 브라우저가 그대로 읽는 순수 ESM 이다. 타입은 JSDoc 으로 달아
 * `tsc --noEmit`(checkJs) 검사에 태우고, `src/verify.ts` 가 이 파일을 그대로
 * import 해서 단언한다 — 브라우저가 실행하는 코드와 검증하는 코드가 같아야 한다.
 *
 * ## 🚨 postMessage 는 **아무나 보낼 수 있다**
 * `window.addEventListener('message', ...)` 는 어떤 오리진의 어떤 프레임/탭에서
 * 보낸 메시지도 받는다. 검증 없이 `event.data.payload.sessionId` 를 서버로 넘기면
 * 공격자가 임의 sessionId 를 주입할 수 있다. 그래서 아래 4단 게이트를 **전부** 통과한
 * 메시지만 신뢰한다:
 *
 *   ① event.origin 이 화이트리스트에 **정확히 일치**(endsWith/includes 금지 —
 *      `evil-storige.com` 같은 접미 일치 우회가 뚫린다)
 *   ② event.source 가 **우리가 띄운 iframe** 의 contentWindow (같은 오리진의 다른
 *      프레임·팝업이 끼어드는 것을 막는다)
 *   ③ 봉투 형식 — `{ source:'storige-editor', version:'1', event, payload, timestamp }`
 *   ④ event 가 문자열
 *
 * ②는 **인자를 빼먹어도 꺼지지 않는다**: `expectedSource` 는 필수이고, 없으면
 * `parseEditorMessage` 가 던진다. 게이트를 끄는 유일한 경로는 `SKIP_SOURCE_CHECK`
 * 리터럴을 손으로 적는 것뿐이다(fail-closed — "한 줄 누락 = 무방비"를 없앤다).
 *
 * ## 모르는 이벤트는 무시한다
 * 이벤트 카탈로그는 **additive 로만** 자란다(기존 이벤트명 삭제/의미변경 없음).
 * 모르는 이벤트에서 크래시하면 서버가 이벤트를 하나 추가하는 순간 통합이 깨진다.
 *
 * ## 레거시 `storige:*` 는 신규 연동에서 쓰지 않는다
 * 편집기는 하위호환을 위해 `{ type:'storige:completed' }` 형태를 **함께** 발신한다
 * (parentOrigin 미지정 시 targetOrigin='*'). 신규 연동은 정식 엔벨로프만 듣는다 —
 * 아래 게이트가 자연히 걸러낸다(`source` 필드가 없다).
 */

/** 정식 엔벨로프의 `source` 식별자 */
export const EDITOR_MESSAGE_SOURCE = 'storige-editor';

/** 정식 엔벨로프의 `version` */
export const EDITOR_MESSAGE_VERSION = '1';

/**
 * ② `event.source` 검사를 **의도적으로** 건너뛸 때만 쓰는 명시 리터럴.
 *
 * 게이트를 끄는 유일한 방법이 이 문자열을 **직접 타이핑하는 것**이도록 만든 것이
 * 요점이다. 인자를 빼먹으면 게이트가 조용히 사라지는 대신 `parseEditorMessage` 가
 * **던진다**(fail-closed). 즉 "실수로 꺼짐"이 불가능하고, 코드 리뷰에서
 * `grep skip-source-check` 한 번으로 우회 지점이 전부 드러난다.
 *
 * 정당한 용도는 window 개념이 없는 환경(Node 검증 등)뿐이다. 브라우저에서 이걸 쓰면
 * 편집기 오리진에 열린 **다른 프레임/팝업**이 메시지를 밀어 넣을 수 있다.
 */
export const SKIP_SOURCE_CHECK = 'skip-source-check';

/**
 * 편집기가 발신하는 이벤트 9종(동결 8종 + pricingChange ADDITIVE).
 *
 * ⚠️ 이 목록은 **참조용**이다. 여기 없는 이벤트가 와도 무시할 뿐 오류로 다루지 않는다.
 * @type {readonly string[]}
 */
export const EDITOR_EVENTS = Object.freeze([
  'editor.ready',
  'editor.save',
  'editor.complete',
  'editor.cancel',
  'editor.error',
  'editor.needAuth',
  'editor.state',
  'editor.saved',
  'editor.pricingChange',
]);

/**
 * @typedef {object} EditorEnvelope
 * @property {'storige-editor'} source
 * @property {'1'} version
 * @property {string} event
 * @property {unknown} payload
 * @property {string} [timestamp]
 */

/**
 * @typedef {'ORIGIN_NOT_ALLOWED'
 *   | 'SOURCE_WINDOW_MISMATCH'
 *   | 'NOT_EDITOR_ENVELOPE'
 *   | 'VERSION_MISMATCH'} RejectReason
 */

/**
 * @typedef {{ ok: true, envelope: EditorEnvelope } | { ok: false, reason: RejectReason }} ParseResult
 */

/**
 * 수신 메시지를 검증해 정식 엔벨로프만 통과시킨다.
 *
 * @param {{ origin: string, source?: unknown, data?: unknown }} message  MessageEvent(테스트에선 평범한 객체)
 * @param {{ allowedOrigins: readonly string[], expectedSource: object | null | 'skip-source-check' }} options
 *   allowedOrigins: 편집기 오리진 화이트리스트(정확 일치).
 *   expectedSource: **필수**. 우리가 띄운 iframe 의 `contentWindow`.
 *                   아직 로드 전이라 `null` 이면 ②에서 정상적으로 불일치 처리된다.
 *                   생략하면 던진다 — 한 줄 빠뜨렸다고 게이트가 사라지면 안 된다.
 *                   진짜로 건너뛰려면 {@link SKIP_SOURCE_CHECK} 를 **명시**하라.
 * @returns {ParseResult}
 * @throws {TypeError} expectedSource 를 생략한 경우(= 설정 실수. fail-closed)
 */
export function parseEditorMessage(message, options) {
  // ⓪ 사용 오류 먼저 — 게이트가 "조용히 꺼지는" 경로를 없앤다.
  //    reason 으로 돌려주면 호출측이 `if (!parsed.ok) return;` 로 삼켜서
  //    "이벤트가 안 온다"로만 보인다. 배포가 아니라 개발 첫 메시지에서 터뜨린다.
  if (!('expectedSource' in options) || options.expectedSource === undefined) {
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
  if (options.expectedSource !== SKIP_SOURCE_CHECK && message.source !== options.expectedSource) {
    return { ok: false, reason: 'SOURCE_WINDOW_MISMATCH' };
  }

  // ③ 봉투 형식
  const data = message.data;
  if (typeof data !== 'object' || data === null) {
    return { ok: false, reason: 'NOT_EDITOR_ENVELOPE' };
  }
  const candidate = /** @type {Record<string, unknown>} */ (data);
  if (candidate.source !== EDITOR_MESSAGE_SOURCE) {
    // 레거시 `{ type:'storige:completed' }` 도 여기서 걸린다(source 필드 없음)
    return { ok: false, reason: 'NOT_EDITOR_ENVELOPE' };
  }
  if (candidate.version !== EDITOR_MESSAGE_VERSION) {
    // 미래 버전은 조용히 무시한다 — 해석 규칙이 다를 수 있어 추측하면 안 된다
    return { ok: false, reason: 'VERSION_MISMATCH' };
  }

  // ④ event 는 문자열
  if (typeof candidate.event !== 'string') {
    return { ok: false, reason: 'NOT_EDITOR_ENVELOPE' };
  }

  return {
    ok: true,
    envelope: /** @type {EditorEnvelope} */ ({
      source: EDITOR_MESSAGE_SOURCE,
      version: EDITOR_MESSAGE_VERSION,
      event: candidate.event,
      payload: candidate.payload,
      timestamp: typeof candidate.timestamp === 'string' ? candidate.timestamp : undefined,
    }),
  };
}

/**
 * @typedef {object} CompletePayload
 * @property {string} sessionId
 * @property {boolean} needsAuth
 *   **게스트 세션 신호.** true 면 이 세션은 소유 사이트가 없어(NULL-site) 승격이
 *   404 로 거부된다 → 승격을 시도하지 말고 로그인을 유도하라.
 * @property {boolean} hasGuestToken
 *   payload 에 `guestToken` 이 실려 왔는가. **값 자체는 일부러 돌려주지 않는다** —
 *   게스트 세션 자격증명이라 로그·DOM 으로 새면 그 세션을 남이 이어 편집할 수 있다.
 * @property {number} [orderSeqno]
 * @property {number} [pageCount]
 */

/**
 * `editor.complete` payload 에서 승격 판단에 필요한 값을 꺼낸다.
 *
 * payload 는 편집기가 채우는 값이므로 형태를 가정하지 말고 확인한다.
 * (동결 payload 는 `{ sessionId, orderSeqno, editCode, pages, pageCount, files:{...}, savedAt }`
 *  이며 게스트 완료 시 `{ needsAuth:true, guestToken }` 이 **인라인으로** 함께 온다.
 *  pricing/size 는 설정된 템플릿셋에서만 additive 로 실린다.)
 *
 * ## 🚨 `needsAuth` 를 무시하면 반드시 실패한다
 * 편집기는 게스트 완료 시 `editor.complete`(needsAuth:true) 를 **먼저** 보내고
 * `editor.needAuth` 를 그 **뒤에** 보낸다. 즉 `editor.needAuth` 를 기다렸다가 분기하면
 * 이미 늦었다 — 그 사이에 승격을 때려 404 를 받는다. 분기 근거는 **이 필드**다.
 *
 * @param {unknown} payload
 * @returns {CompletePayload | null}
 */
export function readCompletePayload(payload) {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = /** @type {Record<string, unknown>} */ (payload);
  if (typeof p.sessionId !== 'string' || p.sessionId === '') return null;
  return {
    sessionId: p.sessionId,
    // guestToken 이 있는데 needsAuth 가 빠진 형태도 게스트로 본다(fail-closed):
    // 게스트를 회원으로 오판하면 승격 404, 회원을 게스트로 오판하면 로그인 유도 —
    // 후자가 훨씬 싸다.
    needsAuth: p.needsAuth === true || typeof p.guestToken === 'string',
    hasGuestToken: typeof p.guestToken === 'string' && p.guestToken !== '',
    ...(typeof p.orderSeqno === 'number' ? { orderSeqno: p.orderSeqno } : {}),
    ...(typeof p.pageCount === 'number' ? { pageCount: p.pageCount } : {}),
  };
}

/**
 * @typedef {'promote' | 'require-login' | 'ignore'} CompleteAction
 */

/**
 * `editor.complete` 를 받고 **무엇을 할지** 판정한다.
 *
 * 호스트 페이지가 이 함수를 그대로 쓰고 `verify.ts` 가 이 함수를 단언한다 —
 * 분기 규칙이 두 벌로 갈라지지 않게 하기 위한 단일 지점이다.
 *
 * @param {CompletePayload | null} done  {@link readCompletePayload} 결과
 * @returns {CompleteAction}
 *   `promote`       회원 세션 — 서버로 sessionId 를 넘겨 승격한다
 *   `require-login` 게스트 세션 — 승격하면 404 다. 로그인시킨 뒤 재개하라
 *   `ignore`        sessionId 없는 payload — 승격을 시도조차 하지 않는다
 */
export function decideCompleteAction(done) {
  if (done === null) return 'ignore';
  if (done.needsAuth) return 'require-login';
  return 'promote';
}
