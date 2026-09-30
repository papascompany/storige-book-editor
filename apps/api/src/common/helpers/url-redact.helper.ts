/**
 * 요청 URL 의 토큰류 쿼리 값을 가린다(요청 로그·오류 수집 공용, 2026-09-30).
 *
 * 편집기 게스트 저장·버전 경로는 CORS 제약 때문에 게스트 토큰을 쿼리로 보낸다.
 * 요청 로그(pino-http)와 SentryExceptionFilter 가 req.url 을 그대로 남기므로,
 * 값만 `[Filtered]` 로 바꾸고 경로·다른 파라미터는 그대로 둔다(진단 가치 유지).
 */
const TOKEN_QUERY_KEYS = [
  'guestToken',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'uploadToken',
];

const TOKEN_QUERY_RE = new RegExp(`([?&](?:${TOKEN_QUERY_KEYS.join('|')})=)[^&#]*`, 'gi');

export function redactUrlTokens(url: unknown): unknown {
  if (typeof url !== 'string' || !url.includes('=')) return url;
  return url.replace(TOKEN_QUERY_RE, '$1[Filtered]');
}
