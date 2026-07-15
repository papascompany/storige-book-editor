import { createHash } from 'crypto';

/**
 * canonical JSON(오브젝트 키 재귀 정렬) SHA-256 — 멱등 request_hash (설계서 §4.1).
 *
 * 키 순서만 다른 동일 본문은 동일 hash 가 되어 재전달 대상이 되고,
 * 실질 값이 다르면 422 ERR_IDEMPOTENCY_KEY_MISMATCH 로 거부된다.
 */
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortValue(source[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(sortValue(value ?? null));
  return serialized ?? 'null';
}

export function canonicalBodyHash(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}
