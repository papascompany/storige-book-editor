/**
 * 환경변수 파싱·검증 — **단일 지점**.
 *
 * 이 예제의 핵심은 **경계**다. env 를 `server`(비밀) / `browser`(공개)로 나눠 담아
 * 그 경계가 코드에서 보이게 한다.
 *
 * ## 🔒 편집기 토큰은 `browser` 가 아니라 `server` 에 있다
 * 회원 JWT(`STORIGE_EDITOR_TOKEN`)는 **세션 자격증명**이다. 최종적으로 iframe URL 에
 * 실려 브라우저에 도달하기는 하지만, 그건 *인증된 그 요청자 자신의* 토큰일 때만
 * 정당하다. 그래서 embed URL 조립은 서버가 하고(`buildEmbedUrl`), 그 결과는
 * **세션 게이트 뒤**(`GET /api/config`)에서만 나간다.
 *
 * 초판에서는 토큰이 박힌 embedUrl 이 `browser` 버킷에 들어 있었다 — 무인증
 * `/api/config` 가 그대로 뱉었고, 파트너가 정적 토큰만 로그인 토큰으로 갈아끼우면
 * 곧바로 무인증 토큰 자판기가 되는 모양이었다. 버킷을 옮긴 것이 그 수정이다.
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
    /**
     * 🔒 회원 세션 토큰(JWT). **인증된 요청자에게, 그 요청자 몫으로만** 실린다.
     * undefined = 게스트 모드(편집은 되지만 승격은 404).
     */
    editorToken: string | undefined;
    /**
     * 판형(book_spec) 참조. 승격 시 함께 넘기지 않으면 워커 구조 검증을 건너뛴
     * **미검증 FINALIZED** 가 만들어진다 → `src/promote.ts` 참조.
     */
    bookSpecUid: string | undefined;
  };
  /** 인증 없이도 내려갈 수 있는 값만 — **토큰이 들어오면 안 되는 버킷**이다 */
  browser: {
    editorOrigin: string;
    /** postMessage 수신 화이트리스트 — 편집기 오리진 */
    allowedOrigins: string[];
  };
  /**
   * iframe src 조립 — **서버측**. 토큰을 인자로 받는 이유가 곧 설계다:
   * "요청자가 누구인지" 정해진 뒤에야 URL 을 만들 수 있다.
   */
  buildEmbedUrl(token: string | undefined): string;
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
  const parentOrigin = originOf(hostOrigin, 'HOST_ORIGIN');

  const orderSeqno = optional('STORIGE_ORDER_SEQNO');
  const pageCount = optional('STORIGE_PAGE_COUNT');
  const sessionId = optional('STORIGE_SESSION_ID');

  const buildEmbedUrl = (token: string | undefined): string => {
    // 편집기가 정식 엔벨로프를 발신하려면 parentOrigin 이 **반드시** 있어야 한다.
    // 없으면 편집기는 postMessage 를 아예 보내지 않는다(콜백 마운트 모드로 간주).
    const embed = new URL('/embed', editorUrl);
    embed.searchParams.set('templateSetId', templateSetId);
    embed.searchParams.set('parentOrigin', parentOrigin);

    // 회원 세션 토큰. 없으면 게스트 세션이 되고, 게스트 세션은 site 소유가 없어
    // 승격이 404 로 거부된다(편집 자체는 된다).
    if (token !== undefined) embed.searchParams.set('token', token);

    if (orderSeqno !== undefined) embed.searchParams.set('orderSeqno', orderSeqno);
    if (pageCount !== undefined) embed.searchParams.set('pageCount', pageCount);
    // 재편집: 기존 세션을 다시 연다(templateSetId 는 세션에서 도출된다)
    if (sessionId !== undefined) embed.searchParams.set('sessionId', sessionId);

    return embed.toString();
  };

  return {
    server: {
      apiKey,
      baseUrl,
      editorToken: optional('STORIGE_EDITOR_TOKEN'),
      bookSpecUid: optional('STORIGE_BOOK_SPEC_UID'),
    },
    browser: {
      editorOrigin,
      allowedOrigins: [editorOrigin],
    },
    buildEmbedUrl,
    port,
    hostOrigin: parentOrigin,
  };
}
