/**
 * 템플릿셋 폼 "상품 프로파일(JSON)" 섹션의 텍스트 ↔ ProductProfile 변환 (P1 캘린더, 2026-10-17).
 *
 * - 빈 문자열/공백 → null(프로파일 미사용 = 기존 동작). 저장 payload 는 `productProfile: null`.
 * - JSON 파싱 오류·`validateProductProfile` 오류는 errors 로 돌려주고 value 는 null.
 *   폼 rule validator 가 errors 를 그대로 보여 준다(서버 DTO 와 같은 types 함수 = 단일 출처).
 */
import { validateProductProfile, type ProductProfile } from '@storige/types';

export interface ParsedProductProfile {
  value: ProductProfile | null;
  errors: string[];
}

export function parseProductProfileJson(text: string | null | undefined): ParsedProductProfile {
  const trimmed = (text ?? '').trim();
  if (trimmed === '') return { value: null, errors: [] };

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { value: null, errors: [`JSON 파싱 오류: ${detail}`] };
  }

  const errors = validateProductProfile(raw);
  if (errors.length > 0) return { value: null, errors };
  return { value: raw as ProductProfile, errors: [] };
}

/** 폼 textarea 초기값 — null 은 빈 문자열, 값은 2칸 들여쓰기 JSON */
export function stringifyProductProfile(profile: ProductProfile | null | undefined): string {
  if (profile === null || profile === undefined) return '';
  return JSON.stringify(profile, null, 2);
}
