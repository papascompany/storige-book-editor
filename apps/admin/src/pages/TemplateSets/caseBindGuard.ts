/**
 * 템플릿셋 저장 전 싸바리(hardcover_wrap) × caseBind 충돌 판정 (N-TD-2a, 2026-10-06).
 *
 * 편집기는 coverType 이 hardcover_wrap 이어도 caseBind 가 하나라도 있으면 싸바리 편집 모드를
 * 끈다(apps/editor/src/utils/hardcoverWrap.ts resolveHardcoverWrapMode 의 CASE_BIND 사유).
 * hasCaseBind 판정은 useEditorContents 와 같다:
 *   템플릿셋 coverConfig.caseBind 유효 || 표지 템플릿 spreadConfig.spec.caseBind 유효.
 *
 * admin 폼은 hardcover_wrap 세트에서 싸바리 입력 세 칸 중 하나라도 비어 있지 않으면(0 포함)
 * 빈 칸을 0 으로 채운 유효 caseBind 를 저장한다. 그래서 '입력 non-null' 이 곧 '저장 후 caseBind 유효'다.
 *
 * 이 함수는 판정만 한다. 저장을 막지 않으며(오너 결정: confirm 경고), 저장 데이터 구성도 바꾸지 않는다.
 */
import { assemblePrintTemplates, isValidCaseBind, type CaseBindSpec, type PrintTemplateLike } from '@storige/types';

export const HARDCOVER_WRAP_COVER_TYPE = 'hardcover_wrap';

/** caseBind 가 어디서 왔는지 — templateSet: 폼 싸바리 입력, coverTemplate: 표지 템플릿 spec.caseBind */
export type CaseBindSource = 'templateSet' | 'coverTemplate';

export interface CaseBindGuardTemplate extends PrintTemplateLike {
  spreadConfig?: {
    regionScope?: string | null;
    conversionMode?: string | null;
    spec?: {
      coverWidthMm?: number;
      coverHeightMm?: number;
      caseBind?: Partial<CaseBindSpec> | null;
    } | null;
    innerSpec?: { pageWidthMm?: number; pageHeightMm?: number } | null;
  } | null;
}

export interface CaseBindGuardInput {
  /** 폼 coverType 원값(trim 전) */
  coverType: unknown;
  /** 폼 싸바리 입력 세 칸(합지 두께·접힘 여분·wrap 여분) 원값 */
  caseBindInputs: readonly unknown[];
  /** 세트에 연결된 템플릿(순서 유지) — 표지 기본값은 편집기와 같이 assemblePrintTemplates 로 고른다 */
  templates: readonly CaseBindGuardTemplate[];
}

export interface CaseBindGuardResult {
  /** true 면 저장 시 싸바리 편집 모드가 꺼진다 → 저장 전 확인 필요 */
  blocked: boolean;
  sources: CaseBindSource[];
}

export function detectCaseBindOnHardcoverWrap(input: CaseBindGuardInput): CaseBindGuardResult {
  const coverType = typeof input.coverType === 'string' ? input.coverType.trim() : '';
  if (coverType !== HARDCOVER_WRAP_COVER_TYPE) return { blocked: false, sources: [] };

  const sources: CaseBindSource[] = [];
  if (input.caseBindInputs.some((v) => v !== undefined && v !== null)) {
    sources.push('templateSet');
  }
  const coverTemplate = assemblePrintTemplates(input.templates).coverDefault;
  if (isValidCaseBind(coverTemplate?.spreadConfig?.spec?.caseBind)) {
    sources.push('coverTemplate');
  }
  return { blocked: sources.length > 0, sources };
}
