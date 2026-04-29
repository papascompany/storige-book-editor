import { useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 키보드 단축키 도움말 모달.
 *
 * 단축키 목록은 canvas-core plugins(HistoryPlugin, CopyPlugin, GroupPlugin, ObjectPlugin,
 * LockPlugin) 및 editor 측(FeatureSidebar Cmd+\ 등)에서 등록된 것을 카테고리별로 수동 정리.
 * 새 단축키 추가 시 여기에 함께 갱신.
 *
 * 열기: EditorHeader 도움말 버튼 클릭 또는 `?` 키.
 * 닫기: 백드롭 클릭, ESC, X 버튼.
 */

interface KeyboardShortcutsModalProps {
  open: boolean
  onClose: () => void
}

interface Shortcut {
  keys: string[]
  description: string
}

interface ShortcutGroup {
  title: string
  items: Shortcut[]
}

// 단축키 카탈로그 — Mac 표기 우선 (⌘ 사용). Windows는 Ctrl로 자동 대체될 수 있음.
const GROUPS: ShortcutGroup[] = [
  {
    title: '작업',
    items: [
      { keys: ['⌘', 'S'], description: '편집 완료 (저장)' },
      { keys: ['⌘', 'Z'], description: '실행 취소' },
      { keys: ['⌘', '⇧', 'Z'], description: '다시 실행' },
      { keys: ['?'], description: '단축키 도움말 (현재 모달)' },
    ],
  },
  {
    title: '객체',
    items: [
      { keys: ['⌘', 'C'], description: '복사' },
      { keys: ['⌘', 'V'], description: '붙여넣기' },
      { keys: ['⌘', 'D'], description: '복제' },
      { keys: ['Delete'], description: '삭제' },
      { keys: ['Backspace'], description: '삭제' },
      { keys: ['⌘', 'G'], description: '그룹화' },
      { keys: ['⌘', '⌫'], description: '그룹 해제' },
      { keys: ['⌘', 'L'], description: '잠금/해제 토글' },
      { keys: ['I'], description: '스포이드 (색상 추출)' },
    ],
  },
  {
    title: '이동·정렬',
    items: [
      { keys: ['←', '→', '↑', '↓'], description: '객체 이동 (1px)' },
      { keys: ['['], description: '한 단계 뒤로' },
      { keys: [']'], description: '한 단계 앞으로' },
      { keys: ['⌘', '['], description: '가장 뒤로 보내기' },
      { keys: ['⌘', ']'], description: '가장 앞으로 가져오기' },
    ],
  },
  {
    title: 'UI',
    items: [
      { keys: ['⌘', '\\'], description: '사이드바 접기/펼치기' },
    ],
  },
]

function KeyCap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 text-[12px] font-semibold rounded-md border border-editor-border bg-editor-surface-low text-editor-text shadow-sm">
      {children}
    </kbd>
  )
}

export default function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  // ESC 키로 닫기
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-modal-title"
    >
      {/* 백드롭 */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* 카드 */}
      <div
        className={cn(
          'relative bg-editor-panel border border-editor-border rounded-lg shadow-2xl',
          'w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col'
        )}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-editor-border">
          <h2 id="shortcuts-modal-title" className="text-base font-semibold text-editor-text">
            키보드 단축키
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="p-1 rounded-md text-editor-text-muted hover:bg-editor-hover hover:text-editor-text transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 콘텐츠 — 그룹별 단축키 */}
        <div className="overflow-y-auto p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="text-[12px] font-bold tracking-wider uppercase text-editor-text-muted mb-2">
                {group.title}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {group.items.map((s, i) => (
                  <li
                    key={`${group.title}-${i}`}
                    className="flex items-center justify-between gap-3 py-1"
                  >
                    <span className="text-[13px] text-editor-text">{s.description}</span>
                    <span className="flex items-center gap-1 flex-shrink-0">
                      {s.keys.map((k, j) => (
                        <span key={j} className="flex items-center gap-1">
                          {j > 0 && <span className="text-editor-text-muted text-xs">+</span>}
                          <KeyCap>{k}</KeyCap>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* 푸터 */}
        <div className="px-5 py-3 border-t border-editor-border bg-editor-surface-low/50">
          <p className="text-[11px] text-editor-text-muted">
            Windows에선 ⌘ 대신 <KeyCap>Ctrl</KeyCap>을 사용하세요. 입력 필드에서는 일부 단축키가 비활성화됩니다.
          </p>
        </div>
      </div>
    </div>
  )
}
