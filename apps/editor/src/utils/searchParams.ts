/**
 * Search params 양방향(snake_case/camelCase) 호환 헬퍼 (Phase A-2, 2026-05-16).
 *
 * 외부 사이트(특히 PHP)는 URL 쿼리를 snake_case 로 쓰는 관행이 강한 반면,
 * 내부 코드와 DTO 는 camelCase 를 사용한다. 본 헬퍼는 camelCase 키와
 * 그에 대응하는 snake_case 키 양쪽을 자동 조회해 둘 다 수용한다.
 *
 * 정책 (PHASE_0_CONTRACT_DECISIONS_2026-05-16.md §3):
 * - 우선순위: camelCase 가 먼저, 없으면 snake_case 폴백.
 * - 둘 다 존재하면 camelCase 채택 + 콘솔 경고.
 *
 * 외부 노출 권장 표기는 snake_case 이나, 사용자는 둘 중 어느 것이든 보낼 수 있다.
 */

/** camelCase → snake_case 변환. 예: templateSetId → template_set_id */
function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())
}

/**
 * URLSearchParams 에서 camelCase 또는 snake_case 키로 값 조회.
 *
 * @param params URLSearchParams 인스턴스
 * @param camelKey camelCase 키 (예: "templateSetId")
 * @returns string | null
 */
export function getParamCompat(
  params: URLSearchParams,
  camelKey: string,
): string | null {
  const camelValue = params.get(camelKey)
  const snakeKey = camelToSnake(camelKey)
  const snakeValue = snakeKey !== camelKey ? params.get(snakeKey) : null

  if (camelValue !== null && snakeValue !== null && camelValue !== snakeValue) {
    // 둘 다 명시되어 있고 값이 다르면 camelCase 우선 + 경고
    console.warn(
      `[searchParams] Both ${camelKey}=${camelValue} and ${snakeKey}=${snakeValue} provided. Using camelCase.`,
    )
  }

  return camelValue ?? snakeValue
}

/**
 * 여러 키를 한 번에 조회. camelCase 키 배열을 받아 { key: value | null } 맵 반환.
 */
export function getParamsCompat<K extends string>(
  params: URLSearchParams,
  camelKeys: readonly K[],
): Record<K, string | null> {
  const result = {} as Record<K, string | null>
  for (const key of camelKeys) {
    result[key] = getParamCompat(params, key)
  }
  return result
}
