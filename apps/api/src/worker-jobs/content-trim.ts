/**
 * 합성·채움 입력 내지의 기대 재단(contentTrim) — 워커가 내지 재단선 영역을 `재단 + 도련×2` 로 정리할 때 쓰는 값.
 *
 * 실리는 곳: synthesis 잡 `job.options.contentTrim` + Bull 페이로드 `contentTrim`,
 * attach-page-pad(fix-pagecount) 잡 `convertOptions.contentTrim`. 값이 없으면 키 자체를 붙이지 않는다.
 *
 * 출처
 *  - templateSet: 재단 = width×height, 도련 = bleedMm. tolMm 은 보내지 않는다(워커 기본값).
 *    내지 펼침면(regionScope 'inner') 세트는 대상이 아니다.
 *  - bookSpec: 재단 = innerTrimWidth/HeightMm, 도련 = bleedMm, tolMm = sizeToleranceMm.
 *
 * 도출은 잡 생성을 막지 않는다(deriveContentTrimFailOpen — 예외·무효 값은 키 없음 + warn).
 */

/** 워커 TRIMBOX_MIN_TRIM_MM 과 같은 경계 */
export const CONTENT_TRIM_MIN_TRIM_MM = 10;
/** 워커 TRIMBOX_MAX_BLEED_MM 과 같은 경계 */
export const CONTENT_TRIM_MAX_BLEED_MM = 5;
export const CONTENT_TRIM_MAX_TOL_MM = 5;

export type ContentTrimSource = 'templateSet' | 'bookSpec';

/** X1 공유 계약(api ↔ worker) */
export interface ContentTrim {
  trimWidthMm: number;
  trimHeightMm: number;
  bleedMm: number;
  tolMm?: number;
  source: ContentTrimSource;
}

export type ContentTrimSkipReason =
  | 'no-session'
  | 'no-template-set'
  | 'no-book-spec'
  | 'inner-spread'
  | 'invalid'
  | 'lookup-error';

export interface ContentTrimResult {
  contentTrim?: ContentTrim;
  skip?: ContentTrimSkipReason;
}

/** 로그 route 값 */
export type ContentTrimRoute = 'synthesize' | 'compose-mixed' | 'attach-page-pad' | 'finalization';

/** 도출 입력 — 템플릿셋 컬럼 */
export interface ContentTrimTemplateSetInput {
  width?: unknown;
  height?: unknown;
  bleedMm?: unknown;
}

/** 도출 입력 — 템플릿 행의 spreadConfig */
export interface ContentTrimTemplateDetail {
  spreadConfig?: unknown;
}

/** 도출 입력 — bookSpec 컬럼 */
export interface ContentTrimBookSpecInput {
  innerTrimWidthMm?: unknown;
  innerTrimHeightMm?: unknown;
  bleedMm?: unknown;
  sizeToleranceMm?: unknown;
}

const SOURCES: readonly ContentTrimSource[] = ['templateSet', 'bookSpec'];

function finiteNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * 계약 키만 담은 새 객체. trim ≥ 10 · 0 ≤ bleed ≤ 5 · source 유효가 아니면 undefined.
 * tolMm 은 0~5 의 수일 때만 포함한다(아니면 그 키만 뺀다). 기본값은 넣지 않는다.
 */
export function normalizeContentTrim(raw: unknown): ContentTrim | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const trimWidthMm = finiteNumber(r.trimWidthMm);
  const trimHeightMm = finiteNumber(r.trimHeightMm);
  const bleedMm = finiteNumber(r.bleedMm);
  const source = r.source;
  if (trimWidthMm === undefined || trimWidthMm < CONTENT_TRIM_MIN_TRIM_MM) return undefined;
  if (trimHeightMm === undefined || trimHeightMm < CONTENT_TRIM_MIN_TRIM_MM) return undefined;
  if (bleedMm === undefined || bleedMm < 0 || bleedMm > CONTENT_TRIM_MAX_BLEED_MM) return undefined;
  if (typeof source !== 'string' || !(SOURCES as readonly string[]).includes(source)) return undefined;
  const tolMm = finiteNumber(r.tolMm);
  return {
    trimWidthMm,
    trimHeightMm,
    bleedMm,
    ...(tolMm !== undefined && tolMm >= 0 && tolMm <= CONTENT_TRIM_MAX_TOL_MM ? { tolMm } : {}),
    source: source as ContentTrimSource,
  };
}

function isInnerSpreadConfig(config: unknown): boolean {
  return (
    typeof config === 'object' &&
    config !== null &&
    !Array.isArray(config) &&
    (config as { regionScope?: unknown }).regionScope === 'inner'
  );
}

/**
 * 템플릿셋 출처 contentTrim. 템플릿 중 하나라도 내지 펼침면(regionScope 'inner')이면 'inner-spread',
 * templateDetails 가 배열이 아니면 'invalid'. tolMm 은 넣지 않는다.
 */
export function buildContentTrimFromTemplateSet(
  templateSet: ContentTrimTemplateSetInput,
  templateDetails: ReadonlyArray<ContentTrimTemplateDetail | null | undefined> | null | undefined,
): ContentTrimResult {
  if (!Array.isArray(templateDetails)) return { skip: 'invalid' };
  if (templateDetails.some((d) => isInnerSpreadConfig(d?.spreadConfig))) {
    return { skip: 'inner-spread' };
  }
  const contentTrim = normalizeContentTrim({
    trimWidthMm: templateSet.width,
    trimHeightMm: templateSet.height,
    bleedMm: templateSet.bleedMm,
    source: 'templateSet',
  });
  return contentTrim ? { contentTrim } : { skip: 'invalid' };
}

/** bookSpec 출처 contentTrim — tolMm = sizeToleranceMm */
export function buildContentTrimFromBookSpec(spec: ContentTrimBookSpecInput): ContentTrimResult {
  const contentTrim = normalizeContentTrim({
    trimWidthMm: spec.innerTrimWidthMm,
    trimHeightMm: spec.innerTrimHeightMm,
    bleedMm: spec.bleedMm,
    tolMm: spec.sizeToleranceMm,
    source: 'bookSpec',
  });
  return contentTrim ? { contentTrim } : { skip: 'invalid' };
}

/** 도출 로그에 쓰는 최소 logger */
export interface ContentTrimLogger {
  log(message: string): void;
  warn(message: string): void;
}

function errorNameOf(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  return name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) || 'unknown';
}

/**
 * contentTrim 도출 공통 래퍼(fail-open). derive 의 예외·무효 값은 키 없음(undefined)으로 돌려주고
 * warn 1줄을 남긴다. 이 함수는 예외를 던지지 않는다 — 잡 생성은 그대로 진행한다.
 *  - 성공: log `[content-trim] attach route=… source=… trim=WxH bleed=B`
 *  - 생략: warn `[content-trim] skip route=… reason=…[ err=<Error.name>]`
 * 로그에 세션·템플릿셋·bookSpec id 는 남기지 않는다.
 */
export async function deriveContentTrimFailOpen(
  route: ContentTrimRoute,
  logger: ContentTrimLogger,
  derive: () => ContentTrimResult | Promise<ContentTrimResult>,
): Promise<ContentTrim | undefined> {
  let result: ContentTrimResult;
  let errName: string | undefined;
  try {
    result = await derive();
  } catch (err) {
    result = { skip: 'lookup-error' };
    errName = errorNameOf(err);
  }
  const contentTrim = result?.contentTrim ? normalizeContentTrim(result.contentTrim) : undefined;
  try {
    if (contentTrim) {
      logger.log(
        `[content-trim] attach route=${route} source=${contentTrim.source} ` +
          `trim=${contentTrim.trimWidthMm}x${contentTrim.trimHeightMm} bleed=${contentTrim.bleedMm}`,
      );
    } else {
      const reason: ContentTrimSkipReason = result?.skip ?? 'invalid';
      logger.warn(
        `[content-trim] skip route=${route} reason=${reason}${errName ? ` err=${errName}` : ''}`,
      );
    }
  } catch {
    // 로그 실패는 잡 생성에 영향을 주지 않는다.
  }
  return contentTrim;
}
