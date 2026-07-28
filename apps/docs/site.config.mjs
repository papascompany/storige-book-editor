/**
 * site.config.mjs — 문서 포털 매니페스트 (shard ① 소유)
 *
 * ⚠️ 정본 관계: 이 포털은 **신규 정본이 아니다**.
 *    `docs/PLATFORM_INTEGRATION_GUIDE.md` 의 **발행 채널**이며, GUIDE 6페이지는
 *    H2 경계 슬라이스(무변형)만 한다. 포털이 본문을 저술하는 페이지는
 *    `content/*.md` 4종(라우팅·체크리스트·changelog·API 렌더 주석)뿐이고,
 *    이들은 **규범 서술을 담지 않고 GUIDE 앵커로 넘긴다**.
 *
 * ⚠️ ②③ 는 이 파일을 수정하지 않는다. 콘텐츠 경로는 여기에 **미리 전부 등재**돼 있으므로
 *    해당 경로에 파일을 만들기만 하면 된다(없으면 --dev=경고 / strict=exit 1).
 */

/** 사이트 메타. siteUrl 이 빈 문자열이면 llms.txt 는 루트-상대 경로를 쓴다. */
export const SITE = {
  title: 'Storige 파트너 문서',
  shortTitle: 'Storige Docs',
  description:
    'Storige 플랫폼 외부 파트너 연동 문서 — 연동 유형 결정, 공통 기반(인증·한도·에러), Partner API v1 레퍼런스.',
  lang: 'ko',
  /**
   * 배포 도메인이 확정되면 `STORIGE_DOCS_SITE_URL` 로 주입한다.
   * 기본값이 빈 문자열인 이유: 도메인이 오너 미확정이라 절대 URL 을 단정하면 허위 기재가 된다.
   * 값이 주입되면 그 호스트는 guard R1 화이트리스트에 자동 추가된다(build.mjs).
   */
  siteUrl: process.env.STORIGE_DOCS_SITE_URL ?? '',
};

/**
 * guard R1 — 산출물에 등장해도 되는 절대 URL 호스트.
 * 목적은 **내부 IP·내부 호스트가 렌더되는 것을 막는 것**이다(루트 vercel.json 평문 IP 이력).
 * 와일드카드는 선두 `*.` 만 지원한다.
 */
export const HOST_ALLOWLIST = [
  'api.papascompany.co.kr',
  'editor.papascompany.co.kr',
  'admin.papascompany.co.kr',
  '*.example.com',
  'example.com',
  'localhost',
  '127.0.0.1',
  'openapi.vercel.sh',
];

/** guard R2 — 문서상 안전한 루프백/미지정 리터럴만 예외. 그 외 IPv4 는 전부 위반. */
export const IPV4_ALLOWLIST = ['127.0.0.1', '0.0.0.0'];

/**
 * 절 번호 → 포털 라우트 매핑 (GUIDE 원본에 앵커를 심지 않기 위한 대조표).
 * 앵커 id 는 `절번호의 . 을 - 로 치환`한 값이다: §1.2 → `/guide/common/#1-2`.
 * `anchorRef('2.0')` 헬퍼로 링크를 만들 수 있다.
 */
export const SECTION_ROUTES = {
  0: '/guide/',
  1: '/guide/common/',
  2: '/guide/self-editor/',
  3: '/guide/embed/',
  4: '/guide/type3/',
  5: '/reference/',
};

/** '1.2' → '/guide/common/#1-2' (존재 여부는 linkcheck 가 산출물 기준으로 검증한다) */
export function anchorRef(section) {
  const top = String(section).split('.')[0];
  const route = SECTION_ROUTES[top];
  if (!route) throw new Error(`알 수 없는 절 번호: ${section}`);
  return `${route}#${String(section).replace(/\./g, '-')}`;
}

/** GUIDE 원본 경로 (레포 루트 기준). 빌드는 이 파일을 **절대 쓰지 않는다**. */
export const GUIDE_PATH = 'docs/PLATFORM_INTEGRATION_GUIDE.md';

/**
 * 페이지 매니페스트.
 *  - source.kind='guide'   : GUIDE H2 슬라이스(무변형). withPreamble=true 면 H1 머리말 포함.
 *  - source.kind='content' : content/*.md (②③ 저술)
 *  - source.kind='openapi' : content/api-intro.md + 생성 스펙 렌더
 * nav 는 사이드바 그룹 라벨. summary 는 llms.txt 용 1줄 설명.
 */
export const PAGES = [
  {
    route: '/',
    nav: '시작',
    title: '시작하기',
    summary: '연동 유형 3종 라우팅과 포털 네비게이션.',
    source: { kind: 'content', file: 'content/index.md' },
  },
  {
    route: '/guide/',
    nav: '연동 가이드',
    title: '연동 유형 결정 매트릭스',
    summary: 'GUIDE 머리말 + §0 — 3가지 연동 유형 중 무엇을 쓸지 고르는 결정 매트릭스.',
    source: { kind: 'guide', section: 0, withPreamble: true },
  },
  {
    route: '/guide/common/',
    nav: '연동 가이드',
    title: '공통 기반',
    summary: 'GUIDE §1 — 온보딩, 인증, Base URL, 파일 한도, 보안 모델, 에러·레이트리밋.',
    source: { kind: 'guide', section: 1 },
  },
  {
    route: '/guide/self-editor/',
    nav: '연동 가이드',
    title: '유형 1 — 자체 편집기 + 오프로드',
    summary: 'GUIDE §2 — 자체 편집기를 쓰고 검증/합성만 Storige 로 오프로드하는 연동.',
    source: { kind: 'guide', section: 2 },
  },
  {
    route: '/guide/embed/',
    nav: '연동 가이드',
    title: '유형 2 — 편집기 임베드',
    summary: 'GUIDE §3 — Storige 편집기를 iframe/IIFE 로 임베드하는 연동.',
    source: { kind: 'guide', section: 3 },
  },
  {
    route: '/guide/type3/',
    nav: '연동 가이드',
    title: '유형 3 — 제안 / 미구현',
    summary: 'GUIDE §4 — 임베드 편집 + 외부가 합성 결과만 수신하는 미구현 제안 유형.',
    source: { kind: 'guide', section: 4 },
  },
  {
    route: '/reference/',
    nav: '레퍼런스',
    title: '레퍼런스',
    summary: 'GUIDE §5 — 엔드포인트 표, 웹훅 서명 검증, PDF 검증 규칙, 온보딩 체크리스트, FAQ.',
    source: { kind: 'guide', section: 5 },
  },
  {
    route: '/api/',
    nav: '레퍼런스',
    title: 'Partner API v1 레퍼런스',
    summary: 'Partner Platform API v1 (/api/v1/*) 경로·메서드·요청 스키마·선언된 응답 코드.',
    source: { kind: 'openapi', intro: 'content/api-intro.md' },
  },
  {
    route: '/go-live/',
    nav: '운영',
    title: 'Go-live 체크리스트',
    summary: '프로덕션 전환 전 확인 항목 체크리스트.',
    source: { kind: 'content', file: 'content/go-live.md' },
  },
  {
    route: '/changelog/',
    nav: '운영',
    title: '변경 이력',
    summary: '파트너 대면 표면의 날짜별 변경 이력.',
    source: { kind: 'content', file: 'content/changelog.md' },
  },
];

/** 사이드바 그룹 표시 순서 */
export const NAV_ORDER = ['시작', '연동 가이드', '레퍼런스', '운영'];

/** ③ 소유 — llms.txt 머리말. 없으면 --dev 는 경고, strict 는 exit 1. */
export const LLMS_INTRO = 'content/llms-intro.md';

/**
 * 아직 저술되지 않은 **전방 참조** 앵커 (shard ② 가 GUIDE 에 신설할 절).
 * `--dev` 에서만 경고로 낮추고 **strict 에서는 그대로 빌드를 깨뜨린다** —
 * ② 가 §2.0 을 실제로 신설했는지 기계적으로 확인하는 게이트다.
 * ② 작업이 끝나면 이 배열은 비어야 한다.
 */
export const PENDING_ANCHORS = ['/guide/self-editor/#2-0'];

/**
 * OpenAPI 렌더 정책 (계약 §3-G 를 **코드로 강제**하는 설정).
 *
 * 절대 렌더하지 않는 것: info.description(내부 설계서 경로) · securitySchemes 원문
 * (bearerFormat:"JWT" 는 오도) · multipart/form-data 스키마(스펙이 `{fileId}` 로 오기)
 * · 응답 스키마/예시(서버에 `@ApiResponse({type})` 0건 → **존재하지 않는다**).
 */
export const OPENAPI = {
  /** 스펙의 `servers` 가 비어 있어(`[]`) 포털이 명시 보완한다. */
  baseUrl: 'https://api.papascompany.co.kr',

  /** 경로 프리픽스 → 그룹 라벨 (등재 순서가 곧 렌더 순서) */
  groups: [
    { prefix: '/api/v1/ping', label: '연결 확인' },
    { prefix: '/api/v1/book-specs', label: '판형 (book-specs)' },
    { prefix: '/api/v1/books', label: '도서 (books)' },
    { prefix: '/api/v1/webhooks', label: '웹훅 (webhooks)' },
  ],

  /**
   * 요청 스키마 속성 설명 치환 — 내부 스프린트 표기(`W4 스텁`·`시드 게이트`)를
   * 파트너가 읽을 수 있는 중립 문구로 바꾼다. **사실을 바꾸지 않는다**.
   * 미치환분이 남으면 guard R3 가 산출물에서 잡아 빌드를 깨뜨린다(침묵 통과 불가).
   */
  descriptionOverrides: {
    'CreateBookDto.bookSpecUid':
      '판형(book-specs) uid(`bs_...`). 생략하면 판형 없이 DRAFT 로 생성된다. 존재하지 않거나 비활성이거나 다른 테넌트의 판형이면 404 `ERR_BOOK_SPEC_NOT_FOUND`.',
    'CreateBookDto.sessionId':
      '`EDITOR_SESSION` 승격 시 참조할 편집 세션 식별자. 현재 배치는 **참조 저장까지만** 동작한다 — 세션 완료·소유 실검증과 세션 산출 PDF 의 자동 연결은 아직 제공되지 않는다.',
    'CreateBookDto.templateSetId':
      '`TEMPLATE`/`MIX_COVER_TEMPLATE` 바인딩용 templateSet 식별자. 두 creationType 은 현재 **미구현(서버가 422 응답)** 이라 이 필드는 동작하지 않는다.',
  },

  /** 요약문 치환 — 내부 설계서 절 참조(§9-10) 제거. 그 외 summary 는 원문 그대로 렌더. */
  summaryOverrides: {
    BooksController_downloadPdf: '최종 PDF 다운로드 (소유 검증 스트림) — FINALIZED 전용',
  },

  /** enum 값별 주석. 미구현 값을 있는 것처럼 두지 않기 위한 강제 표기(계약 §4-10). */
  enumNotes: {
    'CreateBookDto.creationType': {
      TEMPLATE: '미구현 — 서버가 422 로 거부한다',
      MIX_COVER_TEMPLATE: '미구현 — 서버가 422 로 거부한다',
    },
  },

  /**
   * 멀티파트 업로드 오퍼레이션. 스펙의 multipart 스키마는 실제 컨트롤러
   * (`FileInterceptor('file')`)와 **불일치**하므로 렌더하지 않고 경고 + GUIDE 링크로 대체한다.
   */
  multipartNoticeHref: '/guide/self-editor/#2-0',

  /** 응답 섹션 고정 라벨 — "전체 응답 목록"이 아니라 "선언된 응답"임을 못박는다. */
  responsesLabel: '선언된 응답',
};
