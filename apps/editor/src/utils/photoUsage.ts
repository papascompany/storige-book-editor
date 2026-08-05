/**
 * S-E4 사진 사용 횟수 집계 (2026-08-04).
 *
 * 문서 전 페이지(캔버스)의 이미지 객체를 1패스로 스캔해 자산 키별 사용 횟수를 만든다.
 * 자산 키 = externalPhotoUrl(D1 외부주입 출처) ∪ src(직접 배치·사진틀 채움 공통).
 * 같은 객체가 두 키를 같은 값으로 가지면(외부 사진 직접 배치) 1회만 센다.
 *
 * 패널 쪽 조회는 photoUsageCount(map, keys) — 한 사진이 dataURL(직접 배치)과
 * storage URL(자동편집 채움, useImageStore.storagePhotoUrl 링크) 두 키로 존재할 수
 * 있어 키 배열 합산으로 조회한다.
 *
 * 배지는 화면 전용 — 직렬화 무관(extendFabricOption 등재 불필요).
 */

export interface UsageCanvasLike {
  getObjects: () => unknown[]
}

interface ImageLikeObject {
  type?: string
  src?: string
  getSrc?: () => string
  externalPhotoUrl?: string
  getObjects?: () => unknown[]
  _objects?: unknown[]
  objects?: unknown[]
}

/** 그룹 중첩 탐색 상한 — 순환 참조/비정상 깊이 방어 */
const MAX_DEPTH = 6

function childObjects(obj: ImageLikeObject): unknown[] {
  try {
    if (typeof obj.getObjects === 'function') return obj.getObjects()
  } catch {
    /* dispose 된 그룹 무시 */
  }
  if (Array.isArray(obj._objects)) return obj._objects
  if (Array.isArray(obj.objects)) return obj.objects
  return []
}

/** 객체 하나가 기여하는 자산 키 집합(중복 키는 1회) */
function assetKeysOf(obj: ImageLikeObject): Set<string> {
  const keys = new Set<string>()
  if (typeof obj.externalPhotoUrl === 'string' && obj.externalPhotoUrl) {
    keys.add(obj.externalPhotoUrl)
  }
  if (obj.type === 'image') {
    let src: string | undefined
    try {
      src = typeof obj.getSrc === 'function' ? obj.getSrc() : obj.src
    } catch {
      src = obj.src
    }
    if (typeof src === 'string' && src) keys.add(src)
  }
  return keys
}

/**
 * 전 캔버스 1패스 사용 횟수 집계 — O(objects).
 * 썸네일당 재스캔 금지(구 isPhotoUsed 는 O(사진×객체)) — 300장×50페이지 요건의 핵심.
 */
export function buildPhotoUsageCountMap(
  canvases: Array<UsageCanvasLike | null | undefined>
): Map<string, number> {
  const map = new Map<string, number>()

  for (const canvas of canvases) {
    if (!canvas || typeof canvas.getObjects !== 'function') continue
    let roots: unknown[]
    try {
      roots = canvas.getObjects()
    } catch {
      continue // dispose 된 캔버스 무시
    }

    // 명시적 스택 순회(재귀 금지) — 그룹 내부 이미지 포함
    const stack: Array<{ obj: unknown; depth: number }> = roots.map((obj) => ({ obj, depth: 0 }))
    while (stack.length > 0) {
      const { obj, depth } = stack.pop()!
      if (!obj || typeof obj !== 'object') continue
      const o = obj as ImageLikeObject

      for (const key of assetKeysOf(o)) {
        map.set(key, (map.get(key) ?? 0) + 1)
      }

      if (depth < MAX_DEPTH && o.type !== 'image') {
        for (const child of childObjects(o)) {
          stack.push({ obj: child, depth: depth + 1 })
        }
      }
    }
  }

  return map
}

/** 키 배열(중복·빈값 허용)의 합산 사용 횟수 — 같은 키는 1회만 합산 */
export function photoUsageCount(
  map: Map<string, number>,
  keys: Array<string | null | undefined>
): number {
  let total = 0
  const seen = new Set<string>()
  for (const key of keys) {
    if (!key || seen.has(key)) continue
    seen.add(key)
    total += map.get(key) ?? 0
  }
  return total
}
