/**
 * 사이트 CORS / iframe origin 목록.
 * 입력 중에는 문자열로 두고, 저장할 때만 배열로 나눈다.
 * (입력마다 split 하면 Enter 줄바꿈이 즉시 사라져 두 줄을 넣을 수 없다.)
 */

export function parseOriginList(raw: string | string[] | null | undefined): string[] {
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s).trim()).filter(Boolean);
  }
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formatOriginList(value: string[] | null | undefined): string {
  if (!Array.isArray(value) || value.length === 0) return '';
  return value.filter(Boolean).join('\n');
}
