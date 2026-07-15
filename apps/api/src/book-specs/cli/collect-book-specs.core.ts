/**
 * book_specs 수집 정규화 코어 (순수 함수 — DB/부팅 비의존).
 *
 * collect-book-specs.cli.ts(dry-run 전용 CLI)가 소비하고,
 * book-specs.spec.ts 가 픽스처로 정규화 규칙을 검증한다.
 * ⚠️ 이 모듈은 DB 에 어떤 쓰기도 하지 않는다 — SQL 문자열 생성까지만.
 */
import { createHash } from 'crypto';

export interface TemplateSetRow {
  id: string;
  name: string;
  type: string;
  width: number | string;
  height: number | string;
  bleed_mm: number | string | null;
  size_tolerance_mm: number | string | null;
  page_count_range: string | number[] | null;
  cover_type: string | null;
  product_specs: string | Record<string, unknown> | null;
  site_id: string | null;
  is_active: 0 | 1;
}

export interface BindingTypeRow {
  code: string;
  min_pages: number | null;
  max_pages: number | null;
  page_multiple: number | null;
}

export interface PaperTypeRow {
  code: string;
  category: string;
  is_active: 0 | 1;
  sort_order: number;
}

export interface BookSpecCandidate {
  uid: string;
  siteId: string | null;
  name: string;
  coverType: string;
  bindingType: string;
  orientation: 'portrait' | 'landscape';
  innerTrimWidthMm: number;
  innerTrimHeightMm: number;
  bleedMm: number;
  sizeToleranceMm: number;
  pageMin: number;
  pageMax: number;
  pageIncrement: number;
  defaultPaperCode: string | null;
  templateSetId: string;
  sortOrder: number;
  /** 출처 templateSet id 목록(중복 병합 시 복수) */
  sources: string[];
  /** 사람 검토용 플래그 — DB 에 들어가지 않음 */
  reviewFlags: string[];
}

export interface Anomaly {
  templateSetId: string;
  name: string;
  code: string;
  detail: string;
}

export interface CollectResult {
  candidates: BookSpecCandidate[];
  anomalies: Anomaly[];
  excluded: number;
}

interface ParsedProductSpecs {
  size?: { width?: number; height?: number; unit?: string };
  binding?: string;
  orientation?: string;
}

export function parseJsonColumn<T>(value: string | T | null): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/** uid = 'bs_' + md5 12hex — 동일 입력이면 재실행에도 동일(멱등 검토 용이) */
export function shortHashUid(parts: string[]): string {
  return 'bs_' + createHash('md5').update(parts.join('|')).digest('hex').slice(0, 12);
}

/** pageCountRange 배열에서 min/max/최빈 간격 도출 */
export function derivePageRules(
  range: number[],
): { min: number; max: number; increment: number } | null {
  const sorted = [...new Set(range.filter((n) => Number.isInteger(n) && n > 0))].sort(
    (a, b) => a - b,
  );
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return { min: sorted[0], max: sorted[0], increment: 2 };
  const gaps = new Map<number, number>();
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    gaps.set(gap, (gaps.get(gap) ?? 0) + 1);
  }
  const increment = [...gaps.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return { min: sorted[0], max: sorted[sorted.length - 1], increment };
}

/**
 * template_sets → book_specs 후보 정규화 (헤더의 정규화 규칙 참조).
 * 순수 함수 — 입력 행만으로 후보/이상치/제외를 산출한다.
 */
export function collectBookSpecCandidates(
  templateSets: TemplateSetRow[],
  bindingTypes: BindingTypeRow[],
  paperTypes: PaperTypeRow[],
): CollectResult {
  const bindingByCode = new Map(bindingTypes.map((b) => [b.code, b]));
  // 기본 용지: 본문(body) 카테고리의 최우선 sort_order (계수 검토는 오너 몫)
  const defaultBodyPaper =
    [...paperTypes]
      .filter((p) => p.category === 'body' && p.is_active === 1)
      .sort((a, b) => a.sort_order - b.sort_order)[0] ?? null;

  const candidates = new Map<string, BookSpecCandidate>();
  const anomalies: Anomaly[] = [];
  let excluded = 0;

  for (const ts of templateSets) {
    const flags: string[] = [];
    const specs = parseJsonColumn<ParsedProductSpecs>(ts.product_specs);

    // 판형 치수 — width/height 컬럼이 정본
    const w = Number(ts.width);
    const h = Number(ts.height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      anomalies.push({
        templateSetId: ts.id,
        name: ts.name,
        code: 'INVALID_TRIM',
        detail: `width/height 비정상 (${ts.width}×${ts.height}) — 후보 제외`,
      });
      excluded++;
      continue;
    }
    if (
      specs?.size?.width !== undefined &&
      specs?.size?.height !== undefined &&
      (Number(specs.size.width) !== w || Number(specs.size.height) !== h)
    ) {
      anomalies.push({
        templateSetId: ts.id,
        name: ts.name,
        code: 'SPECS_SIZE_MISMATCH',
        detail: `productSpecs.size(${specs.size.width}×${specs.size.height}) ≠ 컬럼(${w}×${h}) — 컬럼 우선 채택`,
      });
      flags.push('SPECS_SIZE_MISMATCH');
    }

    // 제본 — productSpecs.binding → 'none' 은 책 판형 아님
    let bindingType = specs?.binding ?? null;
    if (bindingType === 'none') {
      excluded++;
      continue;
    }
    if (!bindingType) {
      bindingType = 'perfect';
      flags.push('BINDING_ASSUMED_PERFECT');
    }
    if (!bindingByCode.has(bindingType)) {
      anomalies.push({
        templateSetId: ts.id,
        name: ts.name,
        code: 'UNKNOWN_BINDING_CODE',
        detail: `binding '${bindingType}' 이 binding_types 에 없음 — 계수 검토 필요`,
      });
      flags.push('UNKNOWN_BINDING_CODE');
    }

    // 커버 종류
    let coverType = ts.cover_type;
    if (!coverType) {
      coverType = 'softcover_variable_spine';
      flags.push('COVER_TYPE_ASSUMED');
    }

    // 페이지 규칙 — pageCountRange → binding_types 폴백
    const range = parseJsonColumn<number[]>(ts.page_count_range) ?? [];
    let pageRules = derivePageRules(Array.isArray(range) ? range : []);
    if (!pageRules) {
      const bt = bindingByCode.get(bindingType);
      pageRules = {
        min: bt?.min_pages ?? 2,
        max: bt?.max_pages ?? 400,
        increment: bt?.page_multiple ?? 2,
      };
      flags.push('PAGE_RULES_FROM_BINDING_FALLBACK');
    }

    const orientation: 'portrait' | 'landscape' = w > h ? 'landscape' : 'portrait';
    const uid = shortHashUid([ts.name, `${w}x${h}`, coverType, bindingType, ts.site_id ?? 'global']);

    const existing = candidates.get(uid);
    if (existing) {
      existing.sources.push(ts.id);
      continue;
    }

    candidates.set(uid, {
      uid,
      siteId: ts.site_id,
      name: ts.name,
      coverType,
      bindingType,
      orientation,
      innerTrimWidthMm: w,
      innerTrimHeightMm: h,
      bleedMm: Number(ts.bleed_mm ?? 3),
      // templateSet 계약값 승계 — 라우트는 templateSetId 연결 시 이 값을 우선 노출.
      // (워커 LEGACY_SIZE_TOLERANCE_MM=1 은 무접촉 폴백 상수 — 여기서 참조하지 않음)
      sizeToleranceMm: Number(ts.size_tolerance_mm ?? 1),
      pageMin: pageRules.min,
      pageMax: pageRules.max,
      pageIncrement: pageRules.increment,
      defaultPaperCode: defaultBodyPaper?.code ?? null,
      templateSetId: ts.id,
      sortOrder: (candidates.size + 1) * 10,
      sources: [ts.id],
      reviewFlags: flags,
    });
  }

  return { candidates: [...candidates.values()], anomalies, excluded };
}

function sqlString(value: string | null): string {
  if (value === null) return 'NULL';
  return `'${value.replace(/'/g, "''")}'`;
}

/** 시드 SQL 초안 생성 — 출력 전용, 실행은 오너 승인 후 수동 */
export function toInsertSql(c: BookSpecCandidate): string {
  const spineFormula = JSON.stringify({ paperCode: c.defaultPaperCode, bindingCode: c.bindingType });
  return (
    `INSERT INTO book_specs (id, uid, site_id, name, cover_type, binding_type, orientation, ` +
    `inner_trim_width_mm, inner_trim_height_mm, bleed_mm, size_tolerance_mm, ` +
    `page_min, page_max, page_increment, spine_formula, default_paper_code, template_set_id, sort_order)\n` +
    `VALUES (UUID(), ${sqlString(c.uid)}, ${sqlString(c.siteId)}, ${sqlString(c.name)}, ` +
    `${sqlString(c.coverType)}, ${sqlString(c.bindingType)}, ${sqlString(c.orientation)}, ` +
    `${c.innerTrimWidthMm}, ${c.innerTrimHeightMm}, ${c.bleedMm}, ${c.sizeToleranceMm}, ` +
    `${c.pageMin}, ${c.pageMax}, ${c.pageIncrement}, ${sqlString(spineFormula)}, ` +
    `${sqlString(c.defaultPaperCode)}, ${sqlString(c.templateSetId)}, ${c.sortOrder})\n` +
    `ON DUPLICATE KEY UPDATE uid = uid; -- 멱등: 기존 행 보존`
  );
}
