/**
 * 환경변수 파싱·검증 — **단일 지점**.
 *
 * 이 예제의 핵심은 **경계**다: 파트너 API 키는 서버에만 있고, 브라우저에는
 * 편집기 URL 과 허용 오리진만 내려간다. 그 경계가 코드에서 보이도록 env 를
 * `server`(비밀) / `browser`(공개) 로 나눠 담는다.
 */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `환경변수 ${name} 가 설정되지 않았습니다. .env.example 를 .env 로 복사해 채운 뒤 ` +
        '`node --env-file=.env src/server.ts` 로 실행하십시오.',
    );
  }
  return value.trim();
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return undefined;
  return value.trim();
}

function integer(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`환경변수 ${name} 는 양의 정수여야 합니다 (받은 값: ${raw})`);
  }
  return parsed;
}

/** origin 만 남긴다 — 경로가 섞이면 postMessage targetOrigin 대조가 어긋난다 */
function originOf(url: string, name: string): string {
  try {
    return new URL(url).origin;
  } catch {
    throw new Error(`환경변수 ${name} 는 절대 URL 이어야 합니다 (받은 값: ${url})`);
  }
}

export interface ExampleEnv {
  /** 🔒 서버 전용 — 브라우저로 절대 내려보내지 않는다 */
  server: {
    apiKey: string;
    baseUrl: string;
  };
  /** 브라우저에 내려가도 되는 값 */
  browser: {
    editorOrigin: string;
    embedUrl: string;
    /** postMessage 수신 화이트리스트 — 편집기 오리진 */
    allowedOrigins: string[];
  };
  port: number;
  hostOrigin: string;
}

export function loadEnv(): ExampleEnv {
  const apiKey = required('STORIGE_API_KEY');
  const baseUrl = required('STORIGE_BASE_URL');
  const editorUrl = required('STORIGE_EDITOR_URL');
  const templateSetId = required('STORIGE_TEMPLATE_SET_ID');
  const port = integer('PORT', 4001);
  const hostOrigin = optional('HOST_ORIGIN') ?? `http://localhost:${port}`;

  const editorOrigin = originOf(editorUrl, 'STORIGE_EDITOR_URL');

  // 편집기가 정식 엔벨로프를 발신하려면 parentOrigin 이 **반드시** 있어야 한다.
  // 없으면 편집기는 postMessage 를 아예 보내지 않는다(콜백 마운트 모드로 간주).
  const embed = new URL('/embed', editorUrl);
  embed.searchParams.set('templateSetId', templateSetId);
  embed.searchParams.set('parentOrigin', originOf(hostOrigin, 'HOST_ORIGIN'));

  // 회원 세션 토큰. 게스트(토큰 없음) 세션은 site 소유가 없어 승격이 404 로 거부된다.
  const token = optional('STORIGE_EDITOR_TOKEN');
  if (token !== undefined) embed.searchParams.set('token', token);

  const orderSeqno = optional('STORIGE_ORDER_SEQNO');
  if (orderSeqno !== undefined) embed.searchParams.set('orderSeqno', orderSeqno);

  const pageCount = optional('STORIGE_PAGE_COUNT');
  if (pageCount !== undefined) embed.searchParams.set('pageCount', pageCount);

  // 재편집: 기존 세션을 다시 연다(templateSetId 는 세션에서 도출된다)
  const sessionId = optional('STORIGE_SESSION_ID');
  if (sessionId !== undefined) embed.searchParams.set('sessionId', sessionId);

  return {
    server: { apiKey, baseUrl },
    browser: {
      editorOrigin,
      embedUrl: embed.toString(),
      allowedOrigins: [editorOrigin],
    },
    port,
    hostOrigin: originOf(hostOrigin, 'HOST_ORIGIN'),
  };
}
