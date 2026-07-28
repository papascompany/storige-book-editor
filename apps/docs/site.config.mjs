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
 * 아직 저술되지 않은 **전방 참조** 앵커.
 * `--dev` 에서만 경고로 낮추고 **strict 에서는 그대로 빌드를 깨뜨린다**.
 *
 * ⚠️ 비어 있는 것이 정상 상태다. 값이 남아 있으면 그 앵커는 `--dev` 에서 영구 면제되어
 *    **진짜로 깨진 링크가 경고로 강등**된다. 대상 절이 실제로 저술되는 즉시 반드시 지운다.
 *    (GUIDE §2.0 은 저술 완료 — `/guide/self-editor/#2-0` 를 여기서 제거했다.)
 */
export const PENDING_ANCHORS = [];

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
   * 요청 스키마 속성 설명 치환 — 서버 원문을 파트너 대면 마크업(코드 스팬·강조)으로 옮긴다.
   * **사실을 바꾸지 않는다.** 사실이 틀렸으면 서버 원문(`@ApiProperty` description)을 고치는 게
   * 근본 수정이고, 여기는 표현만 담당한다.
   *
   * ⚠️ 오버라이드는 스펙 원문을 **무조건** 덮어쓴다 — 원문이 나중에 고쳐져도 여기가 이긴다.
   *    그래서 키마다 그 시점의 **원문 스냅샷(`expectedSource`)** 을 함께 등재해야 하고,
   *    렌더 시 스펙 원문과 대조해 다르면 **빌드를 깨뜨린다**(render-openapi.mjs).
   *    스테일한 서술이 조용히 발행되는 경로(허위 문서화)를 기계적으로 봉쇄하는 장치다.
   *    `expectedSource` 는 서버 원문 그대로(마크업 없이) 적고, 공백만 정규화해 비교한다.
   */
  descriptionOverrides: {
    'CreateBookDto.bookSpecUid': {
      text: '판형(book-specs) uid(`bs_...`). 생략하면 판형 없이 DRAFT 로 생성된다. 존재하지 않거나 비활성이거나 다른 테넌트의 판형이면 404 `ERR_BOOK_SPEC_NOT_FOUND`.',
      expectedSource:
        'book_specs uid(bs_...). 생략하면 판형 없이 DRAFT 로 생성한다. 존재하지 않거나 비활성이거나 다른 테넌트의 판형이면 404 ERR_BOOK_SPEC_NOT_FOUND',
    },
    'CreateBookDto.sessionId': {
      text: '`EDITOR_SESSION` 승격에 사용할 편집 세션 식별자(`creationType=EDITOR_SESSION` 이면 **필수**). 서버가 세션의 완료(`COMPLETE`) 상태와 테넌트 소유를 검증한 뒤, 세션 산출 PDF 를 `pdf_contents` 자산으로 **자동 연결한** DRAFT 도서를 생성한다 — 자산 투입 라우트를 따로 호출하지 않는다. 거부: 누락 400 `ERR_VALIDATION_FAILED` · 미존재/타테넌트/소유 사이트 없음 404 `ERR_NOT_FOUND` · 미완료·산출물 없음 409 `ERR_SESSION_NOT_PROMOTABLE`.',
      expectedSource:
        'EDITOR_SESSION 승격에 사용할 편집 세션 식별자(creationType=EDITOR_SESSION 이면 필수). 서버가 세션의 완료(COMPLETE) 상태와 테넌트 소유를 검증한 뒤, 세션 산출 PDF 를 pdf_contents 자산으로 자동 연결한 DRAFT 도서를 생성한다. 누락 400 ERR_VALIDATION_FAILED / 미존재·타테넌트·소유 사이트 없음 404 ERR_NOT_FOUND / 미완료·산출물 없음 409 ERR_SESSION_NOT_PROMOTABLE',
    },
    'CreateBookDto.templateSetId': {
      text: '`TEMPLATE`/`MIX_COVER_TEMPLATE` 바인딩용 templateSet 식별자. 두 creationType 은 **생성(201 DRAFT)까지만** 되고 최종화가 422 `ERR_ASSETS_INCOMPLETE`(`TEMPLATE_COVER_NOT_RENDERED`)로 거부되므로, 현재 이 값은 저장·바인딩되지 않는다.',
      expectedSource:
        'TEMPLATE/MIX_COVER_TEMPLATE 바인딩용 templateSet 식별자. 두 creationType 은 생성(201 DRAFT)까지만 되고 최종화가 422 ERR_ASSETS_INCOMPLETE(TEMPLATE_COVER_NOT_RENDERED) 로 거부되므로, 현재 이 값은 저장·바인딩되지 않는다.',
    },
  },

  /**
   * 요약문 치환 — 내부 설계서 절 참조(§9-10) 제거. 그 외 summary 는 원문 그대로 렌더.
   * descriptionOverrides 와 동일한 `{ text, expectedSource }` 계약을 따른다(드리프트 시 빌드 실패).
   */
  summaryOverrides: {
    BooksController_downloadPdf: {
      text: '최종 PDF 다운로드 (소유 검증 스트림) — FINALIZED 전용',
      expectedSource: '최종 PDF 다운로드(소유검증 스트림) — FINALIZED 전용(§9-10)',
    },
  },

  /**
   * enum 값별 주석. 미구현 값을 있는 것처럼 두지 않기 위한 강제 표기(계약 §4-10).
   * ⚠️ 이 주석은 **요청 스키마 표**(= 생성 시점) 안에 붙는다. 거부 시점을 반드시 명시하라 —
   *    두 값은 생성 자체는 201 DRAFT 로 성공하고, 막히는 곳은 최종화다.
   * 등재한 값이 스펙 enum 에 없으면 빌드가 깨진다(고아 주석 방지).
   */
  enumNotes: {
    'CreateBookDto.creationType': {
      TEMPLATE:
        '생성은 201 DRAFT 로 되지만 **최종화**가 422 `ERR_ASSETS_INCOMPLETE`(`TEMPLATE_COVER_NOT_RENDERED`)로 거부된다',
      MIX_COVER_TEMPLATE:
        '생성은 201 DRAFT 로 되지만 **최종화**가 422 `ERR_ASSETS_INCOMPLETE`(`TEMPLATE_COVER_NOT_RENDERED`)로 거부된다',
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
