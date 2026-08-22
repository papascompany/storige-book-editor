import type {
  EditSessionResponse,
  EditSessionVersionReason,
  EditSessionVersionSummary,
} from '@/api/edit-sessions'

/**
 * P1-4 (2026-08-22) — 서버 세션 버전 스냅샷(file_edit_session_versions) 표시/복원 순수 헬퍼.
 * UI(HistoryPanel) 와 임베드 복원 핸들러(embed.tsx) 가 공유한다. DOM/스토어 의존 없음.
 */

/** 스냅샷 사유 → 사용자 문구/톤. shrink 는 R2 절단 복구의 핵심 시점이라 강조한다. */
export function describeVersionReason(reason: EditSessionVersionReason | string | null | undefined): {
  label: string
  tone: 'neutral' | 'warning' | 'info'
} {
  switch (reason) {
    case 'shrink':
      return { label: '페이지 감소 직전', tone: 'warning' }
    case 'restore':
      return { label: '복원 직전', tone: 'info' }
    case 'autosave':
      return { label: '자동 저장', tone: 'neutral' }
    default:
      return { label: '저장 시점', tone: 'neutral' }
  }
}

/**
 * 장 수 문구. 서버 pageCount 는 **캔버스 수**(표지·펼침면 각 1장) — 물리 페이지가 아니므로 '장' 으로 표기한다.
 * pageCount 는 "그 시점에 보관된(덮어쓰이기 직전) 장 수", nextPageCount 는 "그때 새로 덮어쓴 장 수".
 * 줄어든 경우만 드러낸다(R2 절단 복구의 단서).
 */
export function formatVersionPages(v: Pick<EditSessionVersionSummary, 'pageCount' | 'nextPageCount'>): string {
  const base = `${v.pageCount}장`
  if (v.nextPageCount != null && v.nextPageCount < v.pageCount) {
    return `${base} → 이후 ${v.nextPageCount}장으로 줄어듦`
  }
  return base
}

/** 목록 정렬 — 최신순. 서버도 DESC 지만 방어적으로 한 번 더(동률은 원래 순서 유지). */
export function sortVersionsNewestFirst<T extends { createdAt: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

/**
 * 복원 응답 세션과 직전 세션을 병합한다.
 *  - 게스트 토큰: 응답에 없으면(또는 null) 직전 세션의 토큰을 유지 — 이후 자동저장(updateGuest)이 끊기지 않게.
 *  - canvasData: 응답의 것이 정본(복원본).
 */
export function mergeRestoredSession(
  prev: EditSessionResponse | null,
  restored: EditSessionResponse,
): EditSessionResponse {
  return {
    ...(prev ?? {}),
    ...restored,
    guestToken: restored.guestToken ?? prev?.guestToken ?? null,
  } as EditSessionResponse
}

/** 복원본 canvasData 의 페이지(캔버스) 수 — 배열이 아니면(단일 캔버스) 1, 없으면 null. */
export function restoredCanvasCount(canvasData: unknown): number | null {
  if (Array.isArray(canvasData)) return canvasData.length
  if (canvasData && typeof canvasData === 'object') return 1
  return null
}
