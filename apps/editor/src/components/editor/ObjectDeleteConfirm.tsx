import { useEffect } from 'react'
import { Trash2 as Trash, AlertTriangle as Warning, X } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'

/**
 * S2 (공유 계층, 2026-06-23): 객체 삭제 확인 모달 + DEL/Backspace 핫키 인터셉터.
 *
 * ⚠️ 아키텍처(R1 — 외부 임베더 회귀 방지):
 *   DEL/Backspace 객체삭제 핫키는 **canvas-core 의 hotkeys-js**(document keydown, bubble)가 처리한다.
 *   거기에 모달을 넣으면 모달 UI 가 없는 외부 임베더(ShareSnap/100p/MD2Books)가 깨지므로,
 *   삭제 확인은 **상품 앱(editor)이 소유**한다. 본 컴포넌트가 document 캡처단계(capture=true)에서
 *   키를 먼저 가로채 stopImmediatePropagation 으로 hotkeys-js 도달을 막고 확인 모달을 띄운다.
 *   실제 삭제는 기존 ObjectPlugin.del() 재사용(삭제잠금·lid·fillImage 가드 그대로) = canvas-core 0 변경.
 *
 * App 루트에 1회 마운트. 비캔버스 라우트/미선택 시 가드로 no-op.
 */
export function ObjectDeleteConfirm() {
  const open = useAppStore((s) => s.deleteConfirmOpen)
  const count = useAppStore((s) => s.deleteConfirmCount)
  const requestDeleteSelection = useAppStore((s) => s.requestDeleteSelection)
  const confirmDeleteSelection = useAppStore((s) => s.confirmDeleteSelection)
  const cancelDeleteSelection = useAppStore((s) => s.cancelDeleteSelection)

  // DEL/Backspace 캡처단계 인터셉터 (canvas-core hotkeys-js 보다 먼저 실행)
  useEffect(() => {
    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return

      // 1) 입력 필드/편집 영역에서 타이핑 중이면 통과(문자 삭제) — 객체삭제로 가로채지 않음
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        (t && t.isContentEditable)
      ) {
        return
      }

      const { canvas, deleteConfirmOpen } = useAppStore.getState()
      if (!canvas) return

      // 2) 캔버스 텍스트(IText/Textbox) 편집 중이면 통과(글자 삭제는 fabric 이 처리)
      const active = canvas.getActiveObject?.() as { isEditing?: boolean } | null
      if (active && active.isEditing) return

      // 3) 선택된 객체가 없으면 통과
      const sel = canvas.getActiveObjects?.() ?? []
      if (!sel.length) return

      // 4) 이미 모달이 열려 있으면 중복 트리거 방지
      if (deleteConfirmOpen) {
        e.preventDefault()
        e.stopImmediatePropagation()
        return
      }

      // → 핫키를 가로채 hotkeys-js 도달 차단 후 확인 모달
      e.preventDefault()
      e.stopImmediatePropagation()
      requestDeleteSelection()
    }

    // capture=true: hotkeys-js(document bubble)보다 먼저 실행되어 가로챌 수 있다.
    document.addEventListener('keydown', onKeyDownCapture, true)
    return () => document.removeEventListener('keydown', onKeyDownCapture, true)
  }, [requestDeleteSelection])

  // 모달 내 Enter=확인 / Esc=취소 (접근성)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelDeleteSelection()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        confirmDeleteSelection()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, confirmDeleteSelection, cancelDeleteSelection])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onClick={cancelDeleteSelection}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-sm w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
              <Trash className="w-5 h-5 text-red-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">객체 삭제</h3>
          </div>
          <button
            type="button"
            onClick={cancelDeleteSelection}
            className="w-11 h-11 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-400"
            aria-label="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5">
          <div className="flex items-start gap-3">
            <Warning className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-sm text-gray-700 leading-relaxed">
              선택한 객체{count > 1 ? ` ${count}개` : ''}를 삭제합니다. 이 작업은 되돌리기로만
              복구할 수 있습니다. 계속할까요?
            </p>
          </div>
        </div>

        <div className="flex gap-2 px-6 py-4 border-t bg-gray-50">
          <button
            type="button"
            onClick={cancelDeleteSelection}
            className="flex-1 min-h-[44px] rounded-md border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={confirmDeleteSelection}
            className="flex-1 min-h-[44px] rounded-md bg-red-600 text-white font-medium hover:bg-red-700"
            autoFocus
          >
            삭제
          </button>
        </div>
      </div>
    </div>
  )
}

export default ObjectDeleteConfirm
