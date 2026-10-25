/**
 * saveNowRegistry — 편집 화면의 '즉시 저장' 함수를 모듈 전역 1개로 등록한다(autosaveSuspend 와 같은 관례, 직렬화 없음).
 *
 * embed 화면이 마운트될 때 useEmbedAutoSave 의 `saveNow` 를 등록하고 언마운트 때 해제한다.
 * 캘린더 디자인 적용(calendarSkinApply)처럼 훅 바깥에서 "적용 직전 저장"이 필요한 경로가 `get()` 으로 꺼내 쓴다.
 * 등록된 함수가 없으면(embed 가 아닌 화면) `get()` 은 undefined 다.
 */

export type SaveNowFn = () => Promise<boolean>

let current: SaveNowFn | null = null

/**
 * 즉시 저장 함수를 등록한다. 마지막 등록이 이긴다.
 * @returns 해제 함수 — 그 사이 다른 함수가 등록됐으면 아무것도 하지 않는다(늦은 cleanup 이 새 등록을 지우지 않게)
 */
function register(fn: SaveNowFn): () => void {
  current = fn
  return () => {
    if (current === fn) current = null
  }
}

function get(): SaveNowFn | undefined {
  return current ?? undefined
}

export const saveNowRegistry = { register, get }

/** 테스트 전용 — 모듈 전역 상태 초기화 */
export function __resetSaveNowRegistryForTest(): void {
  current = null
}
