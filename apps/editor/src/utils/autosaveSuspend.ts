/**
 * L4-② (2026-07-11): PDF 생성 중 자동저장 suspend — 런타임 전역 플래그(직렬화 없음, §8 불변).
 *
 * 문제: ServicePlugin._createMultiPagePDF 는 PDF 생성 창 동안 printExclude(및 moldIcon 동류)
 * 객체를 excludeFromExport=true 로 임시 플래깅한다. fabric 의 toJSON 은 excludeFromExport
 * 객체를 직렬화에서 제외하므로, 이 창에서 자동저장(디바운스/인터벌/로컬백업)이 발화하면
 * 해당 객체가 세션 canvasData 에서 **영구 누락**된다(pre-existing 계열).
 *
 * 해법: PDF 생성 진입점(saveMultiPagePDFAsBlob/saveMultiPagePDF 호출부)을
 * runWithAutosaveSuspended 로 감싸고, 자동저장 경로는 suspend 중이면 **스킵이 아니라
 * 지연 등록**(deferUntilAutosaveResumed) — 생성 완료 직후 1회 실행된다(키 dedupe).
 *
 * 모듈 스코프 전역: 캔버스 인스턴스가 여러 개(스프레드)여도 PDF 생성은 세션 단위 직렬
 * 작업이므로 단일 카운터로 충분하다. 중첩 suspend 는 depth 카운팅으로 안전.
 */

let depth = 0
const pending = new Map<string, () => void>()

/** 현재 PDF 생성 등으로 자동저장이 유예 중인지 */
export function isAutosaveSuspended(): boolean {
  return depth > 0
}

/**
 * suspend 중이면 재개 시 1회 실행하도록 등록(같은 key 는 마지막 것만), 아니면 즉시 실행.
 * 자동저장 경로 전용 — "스킵하지 말고 지연 재시도" 계약의 구현부.
 */
export function deferUntilAutosaveResumed(key: string, fn: () => void): void {
  if (depth === 0) {
    fn()
    return
  }
  pending.set(key, fn)
}

/**
 * fn(PDF 생성 창)을 suspend 상태로 실행. 성공/실패 무관 finally 에서 해제하고,
 * 최외곽 창이 닫힐 때 지연 등록분을 1회씩 flush 한다.
 */
export async function runWithAutosaveSuspended<T>(fn: () => Promise<T> | T): Promise<T> {
  depth++
  try {
    return await fn()
  } finally {
    depth--
    if (depth === 0 && pending.size > 0) {
      const fns = Array.from(pending.values())
      pending.clear()
      for (const f of fns) {
        try {
          f()
        } catch (e) {
          console.error('[autosaveSuspend] 지연 자동저장 실행 실패:', e)
        }
      }
    }
  }
}

/** 테스트 전용 — 모듈 전역 상태 초기화 */
export function __resetAutosaveSuspendForTest(): void {
  depth = 0
  pending.clear()
}
