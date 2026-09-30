/**
 * Sentry 초기화 (Editor용)
 *
 * Vite 환경변수:
 *  - VITE_SENTRY_DSN — DSN (없으면 silent하게 비활성화)
 *  - VITE_SENTRY_ENVIRONMENT — production/staging/development (기본: import.meta.env.MODE)
 *  - VITE_SENTRY_TRACES_SAMPLE_RATE — 0.0 ~ 1.0 (기본: 0.1)
 *  - VITE_SENTRY_RELEASE — 릴리스 식별자
 *
 * 전송 전처리 훅(beforeBreadcrumb·beforeSend·beforeSendTransaction):
 *   URL·breadcrumb·span 의 자격증명 파라미터 값을 '[Filtered]' 로 정규화한다
 *   (scrubUrl / scrubBreadcrumb / scrubEvent — 순수 함수, 아래 export).
 *
 * 사용:
 *   // main.tsx 가장 위에서
 *   import { initSentry } from './lib/sentry';
 *   initSentry();
 */
import * as Sentry from '@sentry/react';
import type { Breadcrumb, Event } from '@sentry/react';

// ─── 전송 전처리: 자격증명 파라미터 정규화 ─────────────────────────────────────

export const FILTERED = '[Filtered]';

/** 접미사 판정(대소문자 무시): token·guestToken·refresh_token·X-Amz-Signature·x-api-key·editorAuthCode 등. */
const SENSITIVE_SUFFIX =
  /(?:token|secret|password|passwd|signature|authcode|auth_code|api[_-]?key|credential)$/i;
/** URL 파라미터 전용 정확일치 — 객체 키에서는 진단값(EditorError.code 등)을 보존하려고 제외. */
const URL_ONLY_KEYS = /^(?:code|sig|md5)$/i;
/** 객체 키(헤더 등) 전용 정확일치. */
const OBJECT_ONLY_KEYS = /^(?:authorization|cookie|set-cookie)$/i;

const PLAIN_PARAM = /(^|[?&#;\s])([A-Za-z0-9_.\-]+)=([^&#\s"'<>]*)/g;
// 값은 인코딩 구분자(%26·%23·%3F) 직전까지 — 값 안의 다른 %XX(예: %2B) 는 값의 일부로 본다.
const ENCODED_PARAM =
  /(%3F|%26|%23)([A-Za-z0-9_.\-]+)%3D((?:[^%&#\s"'<>]|%(?!26|23|3F)[0-9A-F]{2})*)/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const JWT_LIKE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const JSON_PAIR = /("([A-Za-z0-9_.\-]+)"\s*:\s*)"(?:[^"\\]|\\.)*"/g;
// JSON 직렬화 문자열 판정용 변형: 역슬래시는 이스케이프 시작이므로 값에 포함하지 않는다.
const PLAIN_PARAM_SERIALIZED = /(^|[?&#;\s])([A-Za-z0-9_.\-]+)=([^&#\s"'<>\\]*)/g;
const ENCODED_PARAM_SERIALIZED =
  /(%3F|%26|%23)([A-Za-z0-9_.\-]+)%3D((?:[^%&#\s"'<>\\]|%(?!26|23|3F)[0-9A-F]{2})*)/gi;

const MAX_DEPTH = 5;

/** URL 쿼리/fragment 파라미터 키 판정(대소문자 무시). */
export function isSensitiveParamKey(key: string): boolean {
  return SENSITIVE_SUFFIX.test(key) || URL_ONLY_KEYS.test(key);
}

/** 객체 키 판정(대소문자 무시) — `code`·`md5`·`sig` 정확일치는 제외(진단값 보존). */
export function isSensitiveObjectKey(key: string): boolean {
  return SENSITIVE_SUFFIX.test(key) || OBJECT_ONLY_KEYS.test(key);
}

/**
 * 문자열(URL·자유 텍스트) 안의 자격증명 파라미터 값을 마스킹한다. 비문자열·빈 문자열은 그대로 반환.
 * 비민감 파라미터·경로·순서는 보존하고, 결과에 다시 적용해도 같다(멱등).
 */
export function scrubUrl(value: unknown): unknown {
  return typeof value === 'string' ? scrubString(value) : value;
}

interface ParamPatterns {
  plain: RegExp;
  encoded: RegExp;
}

const TEXT_PATTERNS: ParamPatterns = { plain: PLAIN_PARAM, encoded: ENCODED_PARAM };
const SERIALIZED_PATTERNS: ParamPatterns = {
  plain: PLAIN_PARAM_SERIALIZED,
  encoded: ENCODED_PARAM_SERIALIZED,
};

function scrubString(value: string, patterns: ParamPatterns = TEXT_PATTERNS): string {
  if (value === '') return value;
  try {
    return value
      .replace(patterns.plain, (m: string, pre: string, key: string) =>
        isSensitiveParamKey(key) ? `${pre}${key}=${FILTERED}` : m,
      )
      .replace(patterns.encoded, (m: string, pre: string, key: string) =>
        isSensitiveParamKey(key) ? `${pre}${key}%3D${FILTERED}` : m,
      )
      .replace(BEARER, `Bearer ${FILTERED}`)
      .replace(JWT_LIKE, FILTERED)
      .replace(JSON_PAIR, (m: string, head: string, key: string) =>
        isSensitiveObjectKey(key) ? `${head}"${FILTERED}"` : m,
      );
  } catch {
    return FILTERED;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function scrubDeepInner(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > MAX_DEPTH) return '[Object]';
  if (seen.has(value)) return '[Circular]';
  if (value instanceof Error) return { name: value.name, message: scrubString(value.message) };
  const isArray = Array.isArray(value);
  if (!isArray && !isPlainObject(value)) return value;
  seen.add(value);
  try {
    if (isArray) return (value as unknown[]).map((item) => scrubDeepInner(item, depth + 1, seen));
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveObjectKey(key) ? FILTERED : scrubDeepInner(item, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/**
 * 값을 깊게 정규화한 **새 값**을 만든다(입력 불변). 문자열은 scrubUrl, plain object 의 민감 키는
 * '[Filtered]', Error 는 { name, message }, 그 밖의 인스턴스는 그대로. 깊이 5 초과는 '[Object]',
 * 순환 참조는 '[Circular]'.
 */
export function scrubDeep(value: unknown): unknown {
  return scrubDeepInner(value, 0, new WeakSet<object>());
}

function scrubRecord(value: Record<string, unknown>): Record<string, unknown> {
  const out = scrubDeep(value);
  return isPlainObject(out) ? out : {};
}

/** breadcrumb 사본을 반환한다. 처리 중 예외 시 null(=breadcrumb 폐기). */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  try {
    const out: Breadcrumb = { ...breadcrumb };
    if (typeof out.message === 'string') out.message = scrubString(out.message);
    if (out.data && typeof out.data === 'object') {
      const raw = out.data as Record<string, unknown>;
      // console breadcrumb 의 원본 인자는 전송하지 않는다(message 는 위에서 정리됨).
      const source =
        out.category === 'console'
          ? Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'arguments'))
          : raw;
      out.data = scrubRecord(source);
    }
    return out;
  } catch {
    return null;
  }
}

/** transaction 의 span(v7 은 Span 인스턴스 — description·data·attributes·tags 가 setter/필드). */
interface SpanLike {
  description?: unknown;
  data?: unknown;
  attributes?: unknown;
  tags?: unknown;
}

function scrubSpan(span: unknown): void {
  if (span === null || typeof span !== 'object') return;
  const s = span as SpanLike;
  if (typeof s.description === 'string') s.description = scrubString(s.description);
  if (s.data !== null && typeof s.data === 'object') s.data = scrubDeep(s.data);
  // 직렬화 시 data 와 attributes 가 병합되므로(attributes 우선) 둘 다 정리한다.
  if (s.attributes !== null && typeof s.attributes === 'object') s.attributes = scrubDeep(s.attributes);
  if (s.tags !== null && typeof s.tags === 'object') s.tags = scrubDeep(s.tags);
  // 판정은 실제 전송 형태(JSON 직렬화) 기준: 정리 후에도 값이 남으면 예외 → scrubEvent 가 spans 를 제거.
  // 직렬화 이스케이프(\" \n 등)가 이미 정리된 값 뒤에 붙어도 남은 값으로 보지 않도록 판정용 패턴을 쓴다.
  const serialized: unknown = JSON.stringify(span);
  if (typeof serialized === 'string' && scrubString(serialized, SERIALIZED_PATTERNS) !== serialized) {
    throw new Error('span normalization incomplete');
  }
}

/** scrubEvent 진행 표시 — 예외 경로에서 아직 정리되지 않은 필드를 판단한다. */
interface ScrubProgress {
  records: boolean;
}

function scrubEventInPlace(e: Event, progress: ScrubProgress): void {
  // localStorage 에 백업된 거대 페이로드는 다른 단계의 결과와 무관하게 먼저 제외
  if (e.extra) delete e.extra.canvasData;
  if (e.extra) e.extra = scrubRecord(e.extra);
  if (e.contexts) e.contexts = scrubRecord(e.contexts) as Event['contexts'];
  if (e.tags) {
    for (const [key, v] of Object.entries(e.tags)) {
      if (typeof v === 'string') e.tags[key] = scrubString(v);
    }
  }
  progress.records = true;

  const req = e.request;
  if (req) {
    if (typeof req.url === 'string') req.url = scrubString(req.url);
    const qs: unknown = req.query_string;
    if (typeof qs === 'string') {
      req.query_string = scrubString(qs);
    } else if (Array.isArray(qs)) {
      req.query_string = qs.map((pair: unknown): [string, string] => {
        if (Array.isArray(pair) && typeof pair[0] === 'string') {
          const key: string = pair[0];
          return [key, isSensitiveParamKey(key) ? FILTERED : scrubString(String(pair[1] ?? ''))];
        }
        return ['', FILTERED];
      });
    } else if (isPlainObject(qs)) {
      const out: Record<string, string> = {};
      for (const [key, v] of Object.entries(qs)) {
        out[key] = isSensitiveParamKey(key) ? FILTERED : scrubString(String(v ?? ''));
      }
      req.query_string = out;
    }
    if (req.headers && typeof req.headers === 'object') {
      const headers: Record<string, string> = {};
      for (const [key, v] of Object.entries(req.headers)) {
        headers[key] = isSensitiveObjectKey(key) ? FILTERED : scrubString(String(v ?? ''));
      }
      req.headers = headers;
    }
    delete req.cookies;
    if (req.data !== undefined) req.data = scrubDeep(req.data);
  }

  if (typeof e.transaction === 'string') e.transaction = scrubString(e.transaction);
  if (typeof e.message === 'string') e.message = scrubString(e.message);
  if (e.logentry && typeof e.logentry.message === 'string') {
    e.logentry.message = scrubString(e.logentry.message);
  }
  if (e.exception && Array.isArray(e.exception.values)) {
    for (const ex of e.exception.values) {
      if (ex && typeof ex.value === 'string') ex.value = scrubString(ex.value);
    }
  }

  if (Array.isArray(e.breadcrumbs)) {
    e.breadcrumbs = e.breadcrumbs
      .map((b) => scrubBreadcrumb(b))
      .filter((b): b is Breadcrumb => b !== null);
  }

  if (Array.isArray(e.spans)) {
    for (const span of e.spans as unknown[]) scrubSpan(span);
  }
}

type DroppableField = 'request' | 'breadcrumbs' | 'spans' | 'extra' | 'contexts' | 'tags';

function dropField(event: Event, field: DroppableField): void {
  try {
    delete event[field];
  } catch {
    /* 삭제 불가 속성 — 무시 */
  }
}

/**
 * error/transaction 이벤트를 제자리에서 정리하고 같은 참조를 반환한다(이벤트를 버리지 않음).
 * 내부 예외 시 extra.canvasData 와 request·breadcrumbs·spans 를 제거하고, extra·contexts·tags 가
 * 아직 정리 전이었다면 그것들도 제거한 뒤 반환한다.
 */
export function scrubEvent<T extends Event>(event: T): T {
  const progress: ScrubProgress = { records: false };
  try {
    scrubEventInPlace(event, progress);
  } catch {
    try {
      if (event.extra) delete event.extra.canvasData;
    } catch {
      /* 삭제 불가 속성 — 아래에서 extra 제거 시도 */
    }
    dropField(event, 'request');
    dropField(event, 'breadcrumbs');
    dropField(event, 'spans');
    if (!progress.records) {
      dropField(event, 'extra');
      dropField(event, 'contexts');
      dropField(event, 'tags');
    }
  }
  return event;
}

let initialized = false;

export function initSentry(): boolean {
  if (initialized) return true;

  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    console.log('[Sentry/editor] DSN not configured — error tracking disabled');
    return false;
  }

  try {
    Sentry.init({
      dsn,
      environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
      release: import.meta.env.VITE_SENTRY_RELEASE || 'storige-editor@local',

      tracesSampleRate: parseFloat(
        import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || '0.1',
      ),

      // Session Replay (선택, 무거우므로 낮은 비율)
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: parseFloat(
        import.meta.env.VITE_SENTRY_REPLAYS_ON_ERROR || '0.1',
      ),

      integrations: [
        Sentry.browserTracingIntegration(),
        // 에러 발생 시 세션 재현 (옵션, 패키지 크기 영향)
      ],

      // 전송 전 전처리: URL·breadcrumb·span 의 자격증명 파라미터 정규화 + 거대 페이로드(canvasData) 제외
      beforeBreadcrumb(breadcrumb) {
        return scrubBreadcrumb(breadcrumb);
      },
      beforeSend(event) {
        return scrubEvent(event);
      },
      beforeSendTransaction(event) {
        return scrubEvent(event);
      },

      ignoreErrors: [
        // 브라우저 확장이 일으키는 흔한 노이즈
        'Non-Error promise rejection captured',
        'ResizeObserver loop limit exceeded',
        'ResizeObserver loop completed with undelivered notifications',
        // Fabric/카메라/마이크 권한 거부
        'AbortError',
        'NotAllowedError',
        // 네트워크 일시 단절
        'Failed to fetch',
        'NetworkError',
        'Load failed',
      ],
    });

    initialized = true;
    console.log(
      `[Sentry/editor] Initialized for ${import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE}`,
    );
    return true;
  } catch (err) {
    console.error('[Sentry/editor] Initialization failed:', err);
    return false;
  }
}

export { Sentry };
