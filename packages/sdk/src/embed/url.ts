/**
 * `/embed` iframe URL 조립 + 오리진 검증.
 *
 * ## `parentOrigin` 은 선택이 아니다
 * 편집기는 `parentOrigin` 이 없으면 **정식 엔벨로프를 아예 발신하지 않고**, 레거시
 * `storige:*` dual-emit 만 `targetOrigin='*'`(와일드카드)로 내보낸다. 그 레거시 payload 에는
 * `sessionId`(= editSessionId)와 `coverFileId`/`contentFileId` 가 그대로 실리는데,
 * `POST /api/worker-jobs/compose-mixed` 가 `@Public` 이라 **editSessionId 는 사실상 권한
 * 토큰**이다 — 임베드 페이지에 스크립트가 하나라도 더 있으면 그 스크립트가 값을 읽는다.
 *
 * 그래서 이 SDK 는 `parentOrigin` 을 **필수**로 받고, 값이 없거나 `'*'` 면 URL 을 만들지
 * 않고 던진다. 와일드카드 폴백으로 가는 길을 SDK 가 열어 주지 않는다.
 */

import { StorigeUsageError } from '../errors';

/** 기본 임베드 경로. 루트 `/` 는 레거시(완료 메시지 미발신) */
export const DEFAULT_EMBED_PATH = '/embed';

/**
 * 오리진 문자열 검증 — 스킴+호스트+포트만 허용한다.
 *
 * 경로·쿼리가 붙은 값은 `event.origin` 정확 일치 비교에서 **영원히 불일치**하므로
 * "이벤트가 안 온다"는 미궁으로 빠진다. 조용히 잘라내지 않고 던지는 이유다.
 */
export function normalizeOrigin(label: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new StorigeUsageError(
      `${label} 는 필수입니다 — 'https://app.example.com' 형태의 오리진을 넘기십시오.`,
    );
  }
  const raw = value.trim();
  if (raw === '*') {
    throw new StorigeUsageError(
      `${label} 에 '*' 를 쓸 수 없습니다 — 와일드카드 targetOrigin 은 세션 식별자를 ` +
        '임베드 페이지의 모든 스크립트에 노출합니다. 정확한 오리진을 지정하십시오.',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new StorigeUsageError(
      `${label} 가 올바른 오리진이 아닙니다: ${raw} (예: 'https://app.example.com')`,
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new StorigeUsageError(
      `${label} 는 http/https 만 허용합니다: ${raw}`,
    );
  }
  const withoutTrailingSlash = raw.replace(/\/+$/, '');
  if (withoutTrailingSlash !== parsed.origin) {
    throw new StorigeUsageError(
      `${label} 는 스킴+호스트+포트만 담아야 합니다(경로·쿼리·해시 금지). ` +
        `받은 값: ${raw} / 오리진: ${parsed.origin}`,
    );
  }
  return parsed.origin;
}

/**
 * `/embed` URL 파라미터 (camelCase / snake_case 양쪽 허용 — 편집기 `getParamCompat`).
 *
 * SDK 는 camelCase 로 직렬화한다. `parentOrigin` 은 여기 없다 — SDK 가 최상위 옵션에서
 * 받아 **강제로** 실어 준다.
 */
export interface EmbedUrlParams {
  /** shop-session `accessToken` — 필수 */
  token: string;
  /** 401 자동갱신용. cross-origin iframe 이라 HttpOnly 쿠키가 무용하므로 권장 */
  refreshToken?: string;
  /** 신규 편집 필수. 재편집에서는 세션 metadata 에서 도출되나 함께 보내면 조회 1콜 절약 */
  templateSetId?: string;
  /** 재편집 키 */
  sessionId?: string;
  orderSeqno?: number | string;
  mode?: 'cover' | 'content' | 'both' | 'template';
  pageCount?: number;
  paperType?: string;
  bindingType?: string;
  quantity?: number;
  productId?: string;
  productName?: string;
  title?: string;
  /** 메타 스냅샷일 뿐 캔버스 규격을 바꾸지 않는다(규격 권위 = 템플릿셋·주문 옵션) */
  width?: number;
  height?: number;
  coverFileId?: string;
  contentFileId?: string;
  callbackUrl?: string;
  apiBaseUrl?: string;
  /** `1` 또는 DEV 에서만 sample 폴백 — 프로덕션에서 켜지 말 것 */
  allowSampleFallback?: boolean;
}

export interface BuildEmbedUrlOptions {
  /** 편집기 오리진(정확 일치 게이트에도 쓰인다) */
  editorOrigin: string;
  /** **필수** — 호스트 페이지 오리진. 편집기는 이 오리진으로만 postMessage 한다 */
  parentOrigin: string;
  params: EmbedUrlParams;
  /** 기본 `/embed`. 루트 `/` 는 레거시라 거부한다 */
  path?: string;
  /** 계약 확장 대비 통과용. `parentOrigin` 을 여기 넣는 것은 금지(던진다) */
  extraParams?: Readonly<Record<string, string | number | boolean>>;
}

const PARENT_ORIGIN_KEYS = new Set(['parentOrigin', 'parent_origin']);

function serialize(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}

/**
 * `/embed` URL 을 만든다. iframe 을 직접 렌더하는 호스트(SSR 등)도 이 함수를 쓰면
 * `parentOrigin` 누락·와일드카드·레거시 루트 경로를 똑같이 차단받는다.
 */
export function buildEmbedUrl(options: BuildEmbedUrlOptions): string {
  const editorOrigin = normalizeOrigin('editorOrigin', options.editorOrigin);
  const parentOrigin = normalizeOrigin('parentOrigin', options.parentOrigin);

  const params = options.params;
  if (params === null || typeof params !== 'object') {
    throw new StorigeUsageError('params 는 필수입니다.');
  }
  if (typeof params.token !== 'string' || params.token.trim() === '') {
    throw new StorigeUsageError(
      'params.token 은 필수입니다 — 파트너 백엔드가 shop-session 으로 발급한 accessToken 을 넘기십시오.',
    );
  }
  const hasTemplateSet =
    typeof params.templateSetId === 'string' && params.templateSetId !== '';
  const hasSession =
    typeof params.sessionId === 'string' && params.sessionId !== '';
  if (!hasTemplateSet && !hasSession) {
    throw new StorigeUsageError(
      'params.templateSetId(신규 편집) 또는 params.sessionId(재편집) 중 하나는 필수입니다.',
    );
  }

  const path = options.path ?? DEFAULT_EMBED_PATH;
  if (!path.startsWith('/')) {
    throw new StorigeUsageError(`path 는 '/' 로 시작해야 합니다: ${path}`);
  }
  // 🚨 오리진 탈출 차단 — `startsWith('/')` 만으로는 부족하다.
  // `//evil.com/x`(protocol-relative)와 `/\evil.com`(백슬래시)은 둘 다 '/' 로 시작하지만
  // `new URL(path, editorOrigin)` 이 **오리진째** 바꿔 놓는다. 그러면 iframe src 가 공격자
  // 오리진이 되어 token·refreshToken 이 그 URL 쿼리로 나가고, mount 가 `new URL(url).origin`
  // 으로 수신 화이트리스트를 재도출하므로 인바운드 게이트까지 공격자 오리진에 정박한다.
  if (path.startsWith('//') || path.startsWith('/\\')) {
    throw new StorigeUsageError(
      `path 는 편집기 오리진 내부 경로여야 합니다 — 오리진을 바꾸는 형태는 거부합니다: ${path}`,
    );
  }
  if (path === '/') {
    throw new StorigeUsageError(
      "path='/' 는 레거시 라우트라 편집완료 메시지를 발신하지 않습니다 — '/embed' 를 쓰십시오.",
    );
  }

  const url = new URL(path, `${editorOrigin}/`);
  // 조립 후 최종 단언 — 위 문자열 검사를 우회하는 미지의 형태가 있어도 여기서 fail-closed.
  if (url.origin !== editorOrigin) {
    throw new StorigeUsageError(
      `path 가 편집기 오리진을 벗어났습니다(${url.origin} ≠ ${editorOrigin}): ${path}`,
    );
  }

  const entries: Array<[string, string | number | boolean | undefined]> = [
    ['token', params.token],
    ['refreshToken', params.refreshToken],
    ['templateSetId', params.templateSetId],
    ['sessionId', params.sessionId],
    ['orderSeqno', params.orderSeqno],
    ['mode', params.mode],
    ['pageCount', params.pageCount],
    ['paperType', params.paperType],
    ['bindingType', params.bindingType],
    ['quantity', params.quantity],
    ['productId', params.productId],
    ['productName', params.productName],
    ['title', params.title],
    ['width', params.width],
    ['height', params.height],
    ['coverFileId', params.coverFileId],
    ['contentFileId', params.contentFileId],
    ['callbackUrl', params.callbackUrl],
    ['apiBaseUrl', params.apiBaseUrl],
    ['allowSampleFallback', params.allowSampleFallback],
  ];

  for (const [key, value] of entries) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, serialize(value));
  }

  if (options.extraParams) {
    for (const [key, value] of Object.entries(options.extraParams)) {
      if (PARENT_ORIGIN_KEYS.has(key)) {
        throw new StorigeUsageError(
          'extraParams 로 parentOrigin 을 덮어쓸 수 없습니다 — 최상위 parentOrigin 옵션을 쓰십시오.',
        );
      }
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, serialize(value));
    }
  }

  // 마지막에 넣어 extraParams 가 어떤 경로로도 이 값을 흔들지 못하게 한다.
  url.searchParams.set('parentOrigin', parentOrigin);

  return url.toString();
}
