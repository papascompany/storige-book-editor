import { useEffect } from 'react'
import { AlertTriangle as Warning, X } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { formatItemNames } from '@/utils/requiredEditCheck'

/**
 * L7 (2026-07-11): 필수 편집 요소 미편집 경고 모달 — 비차단(Zakeke 'mandatory to edit' 보수 설계).
 *
 * '편집완료' 직전 requiredEditGate 가 미편집 필수 요소(견본 문구 텍스트/빈 사진틀)를 발견하면
 * 이 모달로 확인을 받는다. 차단이 아니다 — [그래도 완료]로 원 플로우를 그대로 속행한다
 * (editor.complete payload·파트너 postMessage 계약 무변경, 모달은 emit '이전' 단계).
 * [계속 편집]은 완료를 중단하고 첫 미편집 요소를 선택·페이지 이동(발견성).
 *
 * EditorHeader 에 마운트(embed·legacy EditorView 공통) — ObjectDeleteConfirm(S2) 모달 계열 패턴.
 * 상태/응답은 useAppStore.requestRequiredEditConfirm ↔ resolveRequiredEditConfirm promise 배선.
 */
export function RequiredEditConfirmModal() {
  const open = useAppStore((s) => s.requiredEditConfirmOpen)
  const items = useAppStore((s) => s.requiredEditConfirmItems)
  const resolve = useAppStore((s) => s.resolveRequiredEditConfirm)

  // Esc = 계속 편집 (안전한 쪽 기본값)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        resolve('edit')
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, resolve])

  if (!open) return null

  const names = formatItemNames(items)

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50"
      onClick={() => resolve('edit')}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-sm w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-label="필수 편집 요소 확인"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
              <Warning className="w-5 h-5 text-amber-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">아직 편집하지 않은 요소가 있어요</h3>
          </div>
          <button
            type="button"
            onClick={() => resolve('edit')}
            className="w-11 h-11 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-400"
            aria-label="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5">
          <p className="text-sm text-gray-700 leading-relaxed">
            {names} — 총 {items.length}개 요소가 아직 편집되지 않았어요. 이대로 진행하면 견본
            문구나 빈 사진틀이 그대로 인쇄될 수 있습니다.
          </p>
        </div>

        <div className="flex gap-2 px-6 py-4 border-t bg-gray-50">
          <button
            type="button"
            onClick={() => resolve('proceed')}
            className="flex-1 min-h-[44px] rounded-md border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50"
          >
            그래도 완료
          </button>
          <button
            type="button"
            onClick={() => resolve('edit')}
            className="flex-1 min-h-[44px] rounded-md bg-editor-accent text-white font-medium hover:bg-editor-accent-hover"
            autoFocus
          >
            계속 편집
          </button>
        </div>
      </div>
    </div>
  )
}

export default RequiredEditConfirmModal
