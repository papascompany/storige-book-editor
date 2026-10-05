/**
 * 템플릿셋 목록 '내지 설정' 셀의 쪽 추가 단위(pageStep) 표시 문자열.
 *
 * 편집기 normalizePageStep 과 같은 기준이다. 2 이상 정수만 단위로 보고('4쪽'),
 * null·undefined·1·그 밖의 값은 제약 없음으로 '-' 를 돌려준다.
 */
export function pageStepLabel(raw: unknown): string {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 2) return '-';
  return `${n}쪽`;
}
