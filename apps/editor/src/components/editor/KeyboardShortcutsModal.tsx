import { useEffect, useMemo } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/useAppStore'
import type { CanvasHotkey, CanvasHotkeyCategory } from '@storige/canvas-core'

/**
 * 키보드 단축키 도움말 모달 (C9 §6-2).
 *
 * 단축키 목록은 **editor.getRegisteredHotkeys() 로 자동 생성**된다 — canvas-core 플러그인이
 * 등록한 hotkeys 가 유일 소스이므로 하드코딩 카탈로그 드리프트가 없다. 플러그인 외부(앱 소유)
 * 단축키(⌘K/⌘S/?/⌘\)만 APP_OWNED static 으로 병합한다.
 *
 * hideInHelp===true 인 hotkey 는 제외(중복 Shift 화살표 변형 등). hideContext(컨텍스트 메뉴
 * 은폐)와는 독립 — 화살표·스포이드는 hideContext:true 지만 도움말엔 노출.
 *
 * 열기: EditorHeader 도움말 버튼 또는 `?` 키. 닫기: 백드롭·ESC·X.
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

/** hotkey 형태(레지스트리 반환 + 앱소유 static 공통 소비 표면). */
type HotkeyLike = Pick<CanvasHotkey, 'input' | 'displayKeys'> & {
  name: string
  category?: CanvasHotkeyCategory
  hideInHelp?: boolean
  pluginName?: string
}

const CATEGORY_ORDER: CanvasHotkeyCategory[] = ['clipboard', 'object', 'arrange', 'move', 'view']
const CATEGORY_TITLE: Record<CanvasHotkeyCategory, string> = {
  clipboard: '클립보드',
  object: '객체',
  arrange: '정렬·순서',
  move: '이동',
  view: '보기·작업',
}
// 균일 카테고리 플러그인은 pluginName 으로 폴백(개별 hotkey category 미지정 시). ObjectPlugin 은
// 혼합(arrange/move/object)이라 hotkey 별 category 를 명시했다.
const PLUGIN_CATEGORY: Record<string, CanvasHotkeyCategory> = {
  CopyPlugin: 'clipboard',
  HistoryPlugin: 'view',
  GroupPlugin: 'object',
  LockPlugin: 'object',
}
// 앱 소유 단축키(플러그인 hotkey 아님 — EditorHeader/FeatureSidebar 핸들러). static 병합.
const APP_OWNED: HotkeyLike[] = [
  { name: '커맨드 팔레트', input: 'cmd+k', category: 'view' },
  { name: '편집 완료 (저장)', input: 'cmd+s', category: 'view' },
  { name: '단축키 도움말', input: '?', category: 'view' },
  { name: '사이드바 접기/펼치기', input: 'cmd+\\', category: 'view' },
]

function keycap(token: string, isMac: boolean): string {
  const t = token.toLowerCase()
  const map: Record<string, string> = {
    cmd: isMac ? '⌘' : 'Ctrl',
    '⌘': isMac ? '⌘' : 'Ctrl',
    ctrl: 'Ctrl',
    control: 'Ctrl',
    shift: '⇧',
    '⇧': '⇧',
    alt: isMac ? '⌥' : 'Alt',
    option: '⌥',
    backspace: '⌫',
    del: 'Delete',
    delete: 'Delete',
    left: '←',
    right: '→',
    up: '↑',
    down: '↓',
    enter: '↵',
    esc: 'Esc',
    escape: 'Esc',
    space: 'Space',
  }
  if (map[t]) return map[t]
  return token.length === 1 ? token.toUpperCase() : token.charAt(0).toUpperCase() + token.slice(1)
}

/** hotkey → 키캡 배열. displayKeys 우선, 없으면 input 파싱(ctrl+/cmd+ 배열은 플랫폼별 1개로 축약). */
export function formatHotkeyKeys(h: HotkeyLike, isMac: boolean): string[] {
  if (h.displayKeys?.length) return h.displayKeys
  const inputs = Array.isArray(h.input) ? h.input : [h.input]
  const chosen =
    inputs.find((i) => (isMac ? i.includes('cmd') || i.includes('⌘') : i.includes('ctrl'))) ??
    inputs[0]
  return chosen
    .split('+')
    .map((tok) => tok.trim())
    .filter(Boolean)
    .map((tok) => keycap(tok, isMac))
}

/**
 * 등록 hotkey + 앱소유를 카테고리별 그룹으로 빌드(순수 함수 — 드리프트 차단 테스트용 export).
 * hideInHelp 제외. category 미지정 시 pluginName 폴백 → 'object' 기본.
 */
export function buildShortcutGroups(
  registered: ReadonlyArray<HotkeyLike>,
  isMac: boolean
): ShortcutGroup[] {
  const byCat = new Map<CanvasHotkeyCategory, Shortcut[]>()
  const add = (cat: CanvasHotkeyCategory, description: string, keys: string[]) => {
    if (!byCat.has(cat)) byCat.set(cat, [])
    byCat.get(cat)!.push({ keys, description })
  }
  for (const h of registered) {
    if (h.hideInHelp) continue
    const cat = h.category ?? (h.pluginName ? PLUGIN_CATEGORY[h.pluginName] : undefined) ?? 'object'
    add(cat, h.name, formatHotkeyKeys(h, isMac))
  }
  for (const a of APP_OWNED) add(a.category ?? 'view', a.name, formatHotkeyKeys(a, isMac))
  return CATEGORY_ORDER.filter((c) => byCat.has(c)).map((c) => ({
    title: CATEGORY_TITLE[c],
    items: byCat.get(c)!,
  }))
}

function KeyCap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 text-[12px] font-semibold rounded-md border border-editor-border bg-editor-surface-low text-editor-text shadow-sm">
      {children}
    </kbd>
  )
}

export default function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  const allEditors = useAppStore((s) => s.allEditors)

  const isMac = useMemo(
    () =>
      typeof navigator !== 'undefined' &&
      /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent),
    []
  )

  const groups = useMemo(() => {
    if (!open) return []
    const ed = allEditors[0] as { getRegisteredHotkeys?: () => ReadonlyArray<HotkeyLike> } | undefined
    const registered = ed?.getRegisteredHotkeys?.() ?? []
    return buildShortcutGroups(registered, isMac)
  }, [open, allEditors, isMac])

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

        {/* 콘텐츠 — 카테고리별 자동 생성 */}
        <div className="overflow-y-auto p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
          {groups.map((group) => (
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
            입력 필드에서는 일부 단축키가 비활성화됩니다. 화살표는 1px, ⇧+화살표는 10px 이동합니다.
          </p>
        </div>
      </div>
    </div>
  )
}
