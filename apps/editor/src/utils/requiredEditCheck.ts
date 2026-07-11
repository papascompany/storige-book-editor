/**
 * L7 (2026-07-11) — 필수 편집 요소(requiredEdit) 미편집 판정 유틸 (순수함수).
 *
 * Zakeke 'mandatory to edit' 패턴(LAYER_UX_REDESIGN_2026-07-06.md §5):
 * 템플릿 제작자(admin)가 requiredEdit=true 로 지정한 텍스트/사진틀을 고객이 바꾸지
 * 않고 편집완료하면 견본 문구('이름을 입력하세요' 등)가 그대로 인쇄되는 사고를
 * **비차단 경고 모달**로 예방한다. '그래도 완료' 로 진행 가능 — editor.complete
 * payload/파트너 postMessage 계약 무변경(모달은 emit 이전 단계).
 *
 * 판정 규약 (default-permissive — requiredEdit undefined/false = 비필수):
 *   - 텍스트: requiredEdit===true && requiredEditTouched!==true → 미편집.
 *     스냅샷 비교 대신 requiredEditTouched 영속 마킹(text:changed 시 세팅,
 *     extendFabricOption 등재)을 쓰는 이유: 재편집(세션 복원) 시 '복원된 현재 내용'
 *     기준 스냅샷으로는 이미 고객이 바꾼 세션도 무변경으로 오판정돼 재경고된다.
 *   - 사진틀(frame): fillImage(채워진 사진 id) 존재 여부 — 상태 자체가 증거라
 *     touched 마킹 불필요.
 *
 * 이 파일은 store/fabric 임포트 없는 순수 모듈 — vitest 단위 테스트 대상.
 * store 연동(attach 시점·완료 게이트)은 requiredEditGate.ts 가 담당.
 */

export type RequiredEditKind = 'text' | 'frame'

/** 완료 경고 모달에 표시할 미편집 필수 요소 1건 */
export interface UneditedRequiredItem {
  /** allCanvas 기준 페이지 인덱스 ([계속 편집] 시 페이지 이동·선택에 사용) */
  canvasIndex: number
  objectId: string
  label: string
  kind: RequiredEditKind
}

/** applyObjectPermissions(objectPermissions.ts)의 TEXT_TYPES 와 동일 규약 */
const TEXT_TYPES = ['text', 'textbox', 'i-text']

interface RequiredEditObjectShape {
  id?: string
  type?: string
  extensionType?: string
  name?: string
  text?: string
  requiredEdit?: boolean
  requiredEditTouched?: boolean
  fillImage?: string
  getObjects?: () => unknown[]
}

/**
 * requiredEdit 지정이 의미 있는 타입인지 판별.
 * 텍스트류('text'|'textbox'|'i-text') 또는 사진틀(extensionType==='frame')만 대상.
 * 그 외 타입은 null — ControlBar 지정 UI 비활성 + 판정 제외(안전 기본값).
 */
export function requiredEditKindOf(obj: unknown): RequiredEditKind | null {
  const o = obj as RequiredEditObjectShape | null | undefined
  if (!o) return null
  if (o.extensionType === 'frame') return 'frame'
  if (TEXT_TYPES.includes(o.type || '')) return 'text'
  return null
}

/** 미편집 필수 요소인가 — requiredEdit===true && (텍스트: touched 미마킹 / 프레임: 사진 미채움) */
export function isUneditedRequired(obj: unknown): boolean {
  const o = obj as RequiredEditObjectShape | null | undefined
  if (!o || o.requiredEdit !== true) return false
  const kind = requiredEditKindOf(o)
  if (kind === 'frame') return !o.fillImage
  if (kind === 'text') return o.requiredEditTouched !== true
  return false
}

/**
 * 텍스트 편집 발생 시 영속 touched 마킹. requiredEdit 텍스트에만 세팅(그 외 no-op).
 * 반환값: 마킹이 실제 발생했는가.
 */
export function markRequiredEditTouched(obj: unknown): boolean {
  const o = obj as RequiredEditObjectShape | null | undefined
  if (!o) return false
  if (o.requiredEdit !== true) return false
  if (requiredEditKindOf(o) !== 'text') return false
  if (o.requiredEditTouched === true) return false
  o.requiredEditTouched = true
  return true
}

/** 모달 표시용 라벨 — name 우선, 텍스트는 내용 앞 12자, 폴백은 종류명 */
function labelOf(o: RequiredEditObjectShape, kind: RequiredEditKind): string {
  if (typeof o.name === 'string' && o.name.trim()) return o.name.trim()
  if (kind === 'text' && typeof o.text === 'string' && o.text.trim()) {
    const t = o.text.trim().replace(/\s+/g, ' ')
    return t.length > 12 ? `${t.slice(0, 12)}…` : t
  }
  return kind === 'frame' ? '사진틀' : '텍스트'
}

/** objectPermissions.forEachObjectDeep 과 동일 규약 — group 자식까지 깊이 순회 */
function forEachDeep(objects: unknown[], fn: (obj: RequiredEditObjectShape) => void): void {
  for (const obj of objects) {
    const o = obj as RequiredEditObjectShape
    fn(o)
    if (o.type === 'group' && typeof o.getObjects === 'function') {
      forEachDeep(o.getObjects(), fn)
    }
  }
}

interface CanvasLike {
  getObjects: () => unknown[]
}

/**
 * 전 페이지 캔버스에서 미편집 필수 요소 수집 (완료 직전 판정 진입점).
 * group 내부의 requiredEdit 텍스트도 검출한다(그룹 은폐 구멍 방지).
 */
export function collectUneditedRequired(
  canvases: ReadonlyArray<CanvasLike | null | undefined>,
): UneditedRequiredItem[] {
  const items: UneditedRequiredItem[] = []
  canvases.forEach((canvas, canvasIndex) => {
    if (!canvas || typeof canvas.getObjects !== 'function') return
    forEachDeep(canvas.getObjects(), (o) => {
      if (!isUneditedRequired(o)) return
      const kind = requiredEditKindOf(o) as RequiredEditKind
      items.push({
        canvasIndex,
        objectId: o.id || '',
        label: labelOf(o, kind),
        kind,
      })
    })
  })
  return items
}

/** 모달 본문용 이름 요약 — 최대 max 개 + '외 N개' */
export function formatItemNames(items: ReadonlyArray<UneditedRequiredItem>, max = 3): string {
  const names = items.slice(0, max).map((i) => `'${i.label}'`)
  const rest = items.length - Math.min(items.length, max)
  return rest > 0 ? `${names.join(', ')} 외 ${rest}개` : names.join(', ')
}

interface TrackableCanvas {
  on: (event: string, handler: (e: { target?: unknown }) => void) => void
  __requiredEditTrackingAttached?: boolean
}

/**
 * 캔버스에 requiredEdit touched 추적 리스너 부착 (멱등 — 캔버스당 1회).
 * fabric 'text:changed' 발화 시 shouldTrack() 이 true 면(고객 컨텍스트) 대상 텍스트에
 * requiredEditTouched 를 마킹한다. shouldTrack 을 이벤트 시점마다 평가하므로
 * editMode/customerPreview 전환에도 안전(관리자 authoring·미리보기 타이핑은 미마킹).
 */
export function attachRequiredEditTracking(
  canvas: TrackableCanvas | null | undefined,
  shouldTrack: () => boolean,
): void {
  if (!canvas || typeof canvas.on !== 'function') return
  if (canvas.__requiredEditTrackingAttached) return
  canvas.__requiredEditTrackingAttached = true
  canvas.on('text:changed', (e) => {
    if (!shouldTrack()) return
    if (e?.target) markRequiredEditTouched(e.target)
  })
}
