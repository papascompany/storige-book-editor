/**
 * 환경변수 파싱·검증 — **단일 지점**.
 *
 * 코드 곳곳에서 `process.env.X` 를 직접 읽지 않는다. 부팅 시 한 번 읽고 검증한
 * 값만 흘려보내면, 오설정이 "첫 API 호출 때 401" 이 아니라 **기동 실패**로 즉시
 * 드러난다(웹훅 예제의 secret 검증과 같은 원칙).
 *
 * ⚠️ `process.env.STORIGE_API_KEY!` 같은 non-null 단언은 **타입만** 속인다 —
 *    런타임 값은 그대로 undefined 다. 아래 `required()` 처럼 실제로 검사하라.
 */

/** 필수 값 — 없으면 기동 실패 */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `환경변수 ${name} 가 설정되지 않았습니다. .env.example 를 .env 로 복사해 채운 뒤 ` +
        '`node --env-file=.env src/main.ts` 로 실행하십시오.',
    );
  }
  return value.trim();
}

/** 선택 값 — 빈 문자열은 미설정으로 취급 */
function optional(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return undefined;
  return value.trim();
}

/** 정수 — 파싱 실패를 NaN 으로 흘리지 않는다(NaN 은 조용히 검사를 무력화한다) */
function integer(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`환경변수 ${name} 는 양의 정수여야 합니다 (받은 값: ${raw})`);
  }
  return parsed;
}

function flag(name: string): boolean {
  return optional(name) === '1';
}

export interface ExampleEnv {
  apiKey: string;
  baseUrl: string;
  coverFileId: string | undefined;
  contentsFileId: string | undefined;
  coverPdfPath: string | undefined;
  contentsPdfPath: string | undefined;
  bookSpecUid: string | undefined;
  pageCount: number;
  partnerRef: string;
  outputPdfPath: string;
  skipPolling: boolean;
}

export function loadEnv(): ExampleEnv {
  const env: ExampleEnv = {
    apiKey: required('STORIGE_API_KEY'),
    baseUrl: required('STORIGE_BASE_URL'),
    coverFileId: optional('STORIGE_COVER_FILE_ID'),
    contentsFileId: optional('STORIGE_CONTENTS_FILE_ID'),
    coverPdfPath: optional('STORIGE_COVER_PDF_PATH'),
    contentsPdfPath: optional('STORIGE_CONTENTS_PDF_PATH'),
    bookSpecUid: optional('STORIGE_BOOK_SPEC_UID'),
    pageCount: integer('STORIGE_PAGE_COUNT', 24),
    partnerRef: optional('STORIGE_PARTNER_REF') ?? `demo-${Date.now()}`,
    outputPdfPath: optional('STORIGE_OUTPUT_PDF_PATH') ?? './out/final.pdf',
    skipPolling: flag('STORIGE_SKIP_POLLING'),
  };

  if (env.coverFileId === undefined && env.coverPdfPath === undefined) {
    throw new Error(
      'STORIGE_COVER_FILE_ID(권장) 또는 STORIGE_COVER_PDF_PATH 중 하나는 있어야 합니다',
    );
  }
  if (env.contentsFileId === undefined && env.contentsPdfPath === undefined) {
    throw new Error(
      'STORIGE_CONTENTS_FILE_ID(권장) 또는 STORIGE_CONTENTS_PDF_PATH 중 하나는 있어야 합니다',
    );
  }

  return env;
}
