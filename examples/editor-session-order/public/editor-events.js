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
 * @param {{ allowedOrigins: readonly string[], expectedSource?: unknown }} options
 *   allowedOrigins: 편집기 오리진 화이트리스트(정확 일치).
 *   expectedSource: 우리가 띄운 iframe 의 contentWindow. 생략하면 ② 검사를 건너뛴다
 *                   (Node 검증처럼 window 가 없는 환경 전용 — 브라우저에선 반드시 넘겨라).
 * @returns {ParseResult}
 */
export function parseEditorMessage(message, options) {
  // ① 오리진 정확 일치
  if (!options.allowedOrigins.includes(message.origin)) {
    return { ok: false, reason: 'ORIGIN_NOT_ALLOWED' };
  }

  // ② 우리가 띄운 iframe 인가
  if (options.expectedSource !== undefined && message.source !== options.expectedSource) {
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
 * `editor.complete` payload 에서 승격에 필요한 sessionId 를 꺼낸다.
 *
 * payload 는 편집기가 채우는 값이므로 형태를 가정하지 말고 확인한다.
 * (동결 payload 는 `{ sessionId, orderSeqno, editCode, pages, pageCount, files:{...}, savedAt }`
 *  이며 pricing/size 는 설정된 템플릿셋에서만 additive 로 실린다.)
 *
 * @param {unknown} payload
 * @returns {{ sessionId: string, orderSeqno?: number, pageCount?: number } | null}
 */
export function readCompletePayload(payload) {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = /** @type {Record<string, unknown>} */ (payload);
  if (typeof p.sessionId !== 'string' || p.sessionId === '') return null;
  return {
    sessionId: p.sessionId,
    ...(typeof p.orderSeqno === 'number' ? { orderSeqno: p.orderSeqno } : {}),
    ...(typeof p.pageCount === 'number' ? { pageCount: p.pageCount } : {}),
  };
}
