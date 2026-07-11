/**
 * L5-② (2026-07-11): 레이어 행 미니 썸네일 — 캐시(stale-while-revalidate) + 안전 생성.
 *
 * 미리캔버스 행 규약(LAYER_UX_REDESIGN_2026-07-06.md §0-4·§5 2차): 텍스트 행은
 * 내용 미리보기 유지, 이미지·도형류(image/frame 채워진 것/shape/svg 계열)만
 * 타입 아이콘 자리를 24px 급 미니 썸네일로 대체. 실패/미생성 시 아이콘 fallback.
 *
 * 성능 설계(행 렌더마다 toDataURL 금지):
 * - 캐시: 객체 id 키 Map — set()=fresh, invalidate()=stale 마킹(URL 은 보존해
 *   재생성 전까지 이전 썸네일 계속 표시 = stale-while-revalidate, 아이콘 깜빡임 방지).
 * - 무효화: canvas 'object:modified' 시에만(SidePanel 에서 배선).
 * - 생성: requestIdleCallback 디바운스 + 패스당 상한(THUMBS_PER_IDLE_PASS).
 * - 순수 뷰 상태 — 직렬화/저장 무접촉, canvas-core 공개 API 불변(§8).
 */
import { SelectionType } from '@storige/canvas-core'

/** 썸네일 출력 목표 크기(px). 표시 24px 의 2배(레티나 대비). */
export const THUMB_TARGET_PX = 48

/** idle 패스 1회당 최대 생성 수 — 100p 문서 첫 오픈 시 프레임 독점 방지 */
export const THUMBS_PER_IDLE_PASS = 8

// ---------------------------------------------------------------------------
// 캐시
// ---------------------------------------------------------------------------

interface ThumbEntry {
  url: string
  fresh: boolean
}

export interface ThumbCache {
  /** fresh 값만 반환. 미생성/stale 이면 undefined ('' = 생성 시도했으나 썸네일 없음 = 음성 캐시). */
  get(id: string): string | undefined
  /** fresh 여부와 무관하게 마지막 값 반환(stale-while-revalidate 표시용). */
  getStale(id: string): string | undefined
  /** 생성 결과 기록(fresh). url='' 은 "생성 불가 — 아이콘 유지" 음성 캐시. */
  set(id: string, url: string): void
  /** object:modified 무효화 — URL 은 보존하고 fresh 만 해제. */
  invalidate(id: string): void
  /** 목록에 없는 id 제거(페이지 전환·삭제 후 무한 성장 방지). */
  prune(liveIds: ReadonlySet<string>): void
  size(): number
}

export function createThumbCache(): ThumbCache {
  const map = new Map<string, ThumbEntry>()
  return {
    get(id: string): string | undefined {
      const entry = map.get(id)
      return entry && entry.fresh ? entry.url : undefined
    },
    getStale(id: string): string | undefined {
      return map.get(id)?.url
    },
    set(id: string, url: string): void {
      map.set(id, { url, fresh: true })
    },
    invalidate(id: string): void {
      const entry = map.get(id)
      if (entry) entry.fresh = false
    },
    prune(liveIds: ReadonlySet<string>): void {
      for (const id of map.keys()) {
        if (!liveIds.has(id)) map.delete(id)
      }
    },
    size(): number {
      return map.size
    },
  }
}

// ---------------------------------------------------------------------------
// 대상 판정·배율 (순수)
// ---------------------------------------------------------------------------

/**
 * 썸네일 대상 타입 — 이미지·도형류만(미리캔버스 규약).
 * 텍스트(내용 미리보기 유지)·QR/바코드·템플릿 요소는 아이콘 유지.
 * group 은 SVG 임포트가 group 으로 들어오므로 포함(svg 계열).
 */
export function isThumbEligibleType(type: SelectionType | string): boolean {
  switch (type) {
    case SelectionType.image:
    case SelectionType.background:
    case SelectionType.shape:
    case SelectionType.frame:
    case SelectionType.group:
      return true
    default:
      return false
  }
}

/**
 * toDataURL 배율 — 원본 크기 무관 소형 래스터(대형 이미지 원본 인코딩 금지).
 * 미세 도형의 과도 업스케일은 2배로 캡.
 */
export function thumbMultiplier(width: number, height: number, target: number = THUMB_TARGET_PX): number {
  const base = Math.max(1, width || 0, height || 0)
  return Math.min(target / base, 2)
}

// ---------------------------------------------------------------------------
// 생성 (fabric 구조적 타입 — 단위테스트에서 fabric 인스턴스 불요)
// ---------------------------------------------------------------------------

/** fabric.Object 서브셋 — 썸네일 생성에 필요한 최소 표면 */
export interface FabricThumbSource {
  id?: string
  width?: number
  height?: number
  extensionType?: string
  parentLayerId?: string
  isEditing?: boolean
  clipPath?: { id?: string; absolutePositioned?: boolean }
  toDataURL?: (options: {
    format?: string
    multiplier?: number
    withoutTransform?: boolean
    enableRetinaScaling?: boolean
  }) => string
  getElement?: () => HTMLImageElement | HTMLCanvasElement | undefined
}

/**
 * 사진틀/모양틀의 채움 이미지 동반 객체 탐색.
 * 연결 규약 3종 모두 수용(코드베이스 공존): FrameInteractionPlugin=parentLayerId,
 * ImageProcessingPlugin.fillImageToMold=clipPath.id + `${id}_fillImage` id 규약.
 */
export function findFillCompanion(
  obj: FabricThumbSource,
  allObjects: readonly FabricThumbSource[]
): FabricThumbSource | undefined {
  const id = obj.id
  if (!id) return undefined
  return allObjects.find(
    (o) =>
      o !== obj &&
      o.extensionType === 'fillImage' &&
      (o.parentLayerId === id || o.clipPath?.id === id || o.id === `${id}_fillImage`)
  )
}

/** 이미지 엘리먼트를 정사각 cover-crop 으로 소형 래스터화 — fabric 무접촉(오염 0). */
function imageElementThumb(
  el: HTMLImageElement | HTMLCanvasElement | undefined,
  target: number = THUMB_TARGET_PX
): string | null {
  if (!el) return null
  const srcW = 'naturalWidth' in el ? el.naturalWidth || el.width : el.width
  const srcH = 'naturalHeight' in el ? el.naturalHeight || el.height : el.height
  if (!srcW || !srcH) return null
  try {
    const out = document.createElement('canvas')
    out.width = target
    out.height = target
    const ctx = out.getContext('2d')
    if (!ctx) return null
    // cover-crop: 짧은 변 기준 중앙 크롭
    const side = Math.min(srcW, srcH)
    const sx = (srcW - side) / 2
    const sy = (srcH - side) / 2
    ctx.drawImage(el, sx, sy, side, side, 0, 0, target, target)
    return out.toDataURL('image/png')
  } catch {
    // CORS taint·미로딩 등 — 아이콘 fallback
    return null
  }
}

/**
 * 단일 객체 미니 썸네일 생성. 실패·비대상은 null(호출부가 아이콘 유지).
 *
 * 안전성 설계:
 * - 이미지 계열(getElement 보유): 원본 엘리먼트를 직접 drawImage — fabric 렌더
 *   파이프라인 완전 우회(캔버스 상태 오염 0, 선택/renderAll 부작용 없음).
 * - 사진틀(frame): 채움 이미지(fillImage 동반 객체)가 있을 때만 그 사진을 썸네일.
 *   빈 틀은 null(스펙: '채워진 것'만).
 * - 도형/그룹: fabric 5.5.2 Object#toCanvasElement 는 별도 StaticCanvas 에 그리고
 *   group/canvas/shadow/transform 을 전부 복원함을 dist 소스로 확인(선택 상태·메인
 *   캔버스 renderAll 무접촉). 단 absolutePositioned clipPath 는 임시 캔버스에서
 *   좌표가 어긋나 공백이 나오므로 제외.
 * - withoutTransform: 회전/스케일 제거 원형 래스터 — 회전체의 거대 AABB 방지.
 */
export function generateObjectThumbnail(
  obj: FabricThumbSource,
  allObjects: readonly FabricThumbSource[]
): string | null {
  try {
    if (obj.isEditing === true) return null

    // 사진틀/모양틀: 채움 이미지가 있으면 그 사진으로(채워진 것만 — 미리캔버스 규약)
    const companion = findFillCompanion(obj, allObjects)
    if (companion) {
      return imageElementThumb(companion.getElement?.())
    }
    if (obj.extensionType === 'frame') {
      // 빈 사진틀 — 아이콘 유지
      return null
    }

    // 이미지 계열: 원본 엘리먼트 직접 래스터(가장 싸고 오염 0)
    if (typeof obj.getElement === 'function') {
      const fromElement = imageElementThumb(obj.getElement())
      if (fromElement) return fromElement
    }

    // 도형/그룹/SVG: 객체 단독 toDataURL (소형 배율 + 변환 제거)
    if (typeof obj.toDataURL !== 'function') return null
    if (obj.clipPath?.absolutePositioned === true) return null
    const url = obj.toDataURL({
      format: 'png',
      multiplier: thumbMultiplier(obj.width ?? 0, obj.height ?? 0),
      withoutTransform: true,
      enableRetinaScaling: false,
    })
    return typeof url === 'string' && url.startsWith('data:') ? url : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// idle 스케줄러 (requestIdleCallback 디바운스 — 미지원 브라우저 setTimeout fallback)
// ---------------------------------------------------------------------------

/** idle 시점 1회 실행 예약. 반환된 함수로 취소(디바운스는 호출부 cleanup 에서).
 *  Safari 등 requestIdleCallback 미지원은 setTimeout fallback. */
export function scheduleIdle(cb: () => void, timeout = 500): () => void {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(cb, { timeout })
    return () => {
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(handle)
    }
  }
  const timer = setTimeout(cb, 150)
  return () => clearTimeout(timer)
}
