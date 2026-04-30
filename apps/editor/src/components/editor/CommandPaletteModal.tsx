import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Search,
  Type,
  Image as ImageIcon,
  Shapes,
  PaintBucket,
  Frame,
  QrCode,
  Pencil,
  Scissors,
  LayoutTemplate,
  Undo2,
  Redo2,
  Check,
  Ruler,
  Sun,
  Moon,
  Monitor,
  HelpCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Cog,
  type LucideIcon,
} from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { useUiPrefStore } from '@/stores/useUiPrefStore'
import { useEditorStore } from '@/stores/useEditorStore'
import { HistoryPlugin } from '@storige/canvas-core'
import type { AppMenu } from '@/types/menu'
import { cn } from '@/lib/utils'

/**
 * Cmd+K 커맨드 팔레트.
 *
 * 액션 카탈로그는 인라인 정의 (ToolBar/EditorHeader 등에 흩어진 액션을 한곳에 모음).
 * 각 액션은 run() 호출 시 해당 store action을 트리거하고 모달을 닫는다.
 *
 * 검색: case-insensitive substring (label + keywords).
 * 키보드: ↑↓로 이동, Enter로 실행, ESC로 닫기.
 */

interface CommandAction {
  id: string
  group: '도구' | '작업' | 'UI'
  label: string
  hint?: string
  keywords?: string[]
  icon?: LucideIcon
  run: (ctx: ActionContext) => void
}

interface ActionContext {
  close: () => void
}

interface CommandPaletteModalProps {
  open: boolean
  onClose: () => void
  /** 편집완료 핸들러 (EditorHeader에서 주입) */
  onFinish?: () => void
  /** 불러오기 핸들러 */
  onOpenWorkspace?: () => void
  /** 단축키 도움말 모달 열기 */
  onOpenShortcuts?: () => void
}

function buildActions(props: Pick<CommandPaletteModalProps, 'onFinish' | 'onOpenWorkspace' | 'onOpenShortcuts'>): CommandAction[] {
  // 도구 메뉴 — ToolBar.tsx의 ALL_MENUS와 동일 형태 (편의상 직접 정의)
  const TOOL_MENUS: { type: AppMenu['type']; label: string; icon: LucideIcon; keywords?: string[] }[] = [
    { type: 'TEXT', label: '텍스트', icon: Type, keywords: ['text', '글', 'ㅌㅅ'] },
    { type: 'IMAGE', label: '이미지', icon: ImageIcon, keywords: ['image', 'photo', '사진'] },
    { type: 'SHAPE', label: '요소', icon: Shapes, keywords: ['shape', 'element', '도형', '클립아트', 'clipart'] },
    { type: 'BACKGROUND', label: '배경', icon: PaintBucket, keywords: ['background', 'bg'] },
    { type: 'TEMPLATE', label: '템플릿', icon: LayoutTemplate, keywords: ['template'] },
    { type: 'FRAME', label: '프레임', icon: Frame, keywords: ['frame', '액자'] },
    { type: 'CLIPPING', label: '모양컷', icon: Scissors, keywords: ['clipping', 'cut'] },
    { type: 'SMART_CODE', label: 'QR/바코드', icon: QrCode, keywords: ['qr', 'barcode'] },
    { type: 'EDIT', label: '편집도구', icon: Pencil, keywords: ['edit', 'tool'] },
  ]

  const tools: CommandAction[] = TOOL_MENUS.map((m) => ({
    id: `tool-${m.type}`,
    group: '도구',
    label: `${m.label} 도구 열기`,
    hint: m.label,
    keywords: m.keywords,
    icon: m.icon,
    run: ({ close }) => {
      useAppStore.getState().tapMenu({ type: m.type, label: m.label, icon: m.icon })
      close()
    },
  }))

  const editing: CommandAction[] = [
    {
      id: 'undo',
      group: '작업',
      label: '실행 취소',
      hint: '⌘Z',
      keywords: ['undo'],
      icon: Undo2,
      run: ({ close }) => {
        useAppStore.getState().getPlugin?.<HistoryPlugin>('HistoryPlugin')?.undo()
        close()
      },
    },
    {
      id: 'redo',
      group: '작업',
      label: '다시 실행',
      hint: '⌘⇧Z',
      keywords: ['redo'],
      icon: Redo2,
      run: ({ close }) => {
        useAppStore.getState().getPlugin?.<HistoryPlugin>('HistoryPlugin')?.redo()
        close()
      },
    },
    {
      id: 'finish',
      group: '작업',
      label: '편집완료 (저장)',
      hint: '⌘S',
      keywords: ['save', 'finish', '완료', '저장'],
      icon: Check,
      run: ({ close }) => {
        props.onFinish?.()
        close()
      },
    },
    {
      id: 'open-workspace',
      group: '작업',
      label: '내 작업 불러오기',
      keywords: ['load', 'open', '불러오기'],
      icon: PanelLeftOpen,
      run: ({ close }) => {
        props.onOpenWorkspace?.()
        close()
      },
    },
    {
      id: 'shortcuts',
      group: '작업',
      label: '키보드 단축키 도움말',
      hint: '?',
      keywords: ['shortcut', 'help', '단축키', '도움말'],
      icon: HelpCircle,
      run: ({ close }) => {
        props.onOpenShortcuts?.()
        close()
      },
    },
  ]

  const ui: CommandAction[] = [
    {
      id: 'sidebar-toggle',
      group: 'UI',
      label: '사이드바 접기/펼치기',
      hint: '⌘\\',
      keywords: ['sidebar', '사이드바'],
      icon: PanelLeftClose,
      run: ({ close }) => {
        useUiPrefStore.getState().toggleSidebarCollapsed()
        close()
      },
    },
    {
      id: 'ruler-toggle',
      group: 'UI',
      label: '룰러 켜기/끄기',
      keywords: ['ruler', '눈금자'],
      icon: Ruler,
      run: ({ close }) => {
        useUiPrefStore.getState().toggleRuler()
        close()
      },
    },
    {
      id: 'theme-light',
      group: 'UI',
      label: '라이트 테마',
      keywords: ['theme', 'light'],
      icon: Sun,
      run: ({ close }) => {
        useUiPrefStore.getState().setTheme('light')
        close()
      },
    },
    {
      id: 'theme-dark',
      group: 'UI',
      label: '다크 테마',
      keywords: ['theme', 'dark'],
      icon: Moon,
      run: ({ close }) => {
        useUiPrefStore.getState().setTheme('dark')
        close()
      },
    },
    {
      id: 'theme-system',
      group: 'UI',
      label: '시스템 테마',
      keywords: ['theme', 'system', 'auto'],
      icon: Monitor,
      run: ({ close }) => {
        useUiPrefStore.getState().setTheme('system')
        close()
      },
    },
    {
      id: 'pagenav-auto',
      group: 'UI',
      label: '페이지 네비: 자동',
      keywords: ['nav', 'navigation'],
      icon: Cog,
      run: ({ close }) => {
        useUiPrefStore.getState().setPageNavPosition('auto')
        close()
      },
    },
    {
      id: 'pagenav-right',
      group: 'UI',
      label: '페이지 네비: 우측',
      keywords: ['nav'],
      icon: Cog,
      run: ({ close }) => {
        useUiPrefStore.getState().setPageNavPosition('right')
        close()
      },
    },
    {
      id: 'pagenav-bottom',
      group: 'UI',
      label: '페이지 네비: 하단',
      keywords: ['nav'],
      icon: Cog,
      run: ({ close }) => {
        useUiPrefStore.getState().setPageNavPosition('bottom')
        close()
      },
    },
  ]

  return [...tools, ...editing, ...ui]
}

function matchesQuery(action: CommandAction, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  if (action.label.toLowerCase().includes(q)) return true
  if (action.group.toLowerCase().includes(q)) return true
  if (action.keywords?.some((k) => k.toLowerCase().includes(q))) return true
  return false
}

export default function CommandPaletteModal(props: CommandPaletteModalProps) {
  const { open, onClose } = props
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 페이지 정보 (페이지 이동 액션용)
  const pages = useEditorStore((s) => s.pages)

  const allActions = useMemo(() => {
    const base = buildActions(props)
    // 페이지 이동 액션 — 페이지가 1개 이상일 때만
    const pageActions: CommandAction[] = pages.map((p, i) => ({
      id: `page-${i}`,
      group: 'UI',
      label: `${i + 1}쪽으로 이동`,
      hint: `${i + 1}/${pages.length}`,
      keywords: ['page', '페이지', `${i + 1}`],
      icon: Cog,
      run: ({ close }) => {
        useAppStore.getState().setPage(i)
        useEditorStore.getState().goToPage(i)
        close()
      },
    }))
    return [...base, ...pageActions]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages.length])

  const filtered = useMemo(
    () => allActions.filter((a) => matchesQuery(a, query)),
    [allActions, query]
  )

  // 그룹별 정렬
  const grouped = useMemo(() => {
    const groups: Record<string, CommandAction[]> = {}
    filtered.forEach((a) => {
      if (!groups[a.group]) groups[a.group] = []
      groups[a.group].push(a)
    })
    return groups
  }, [filtered])

  // 모달 열림 시 input focus + 인덱스 reset
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      // focus는 다음 tick에 (DOM 마운트 직후)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  // query 변경 시 active index 0으로
  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // 키보드 navigation
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => Math.min(filtered.length - 1, i + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => Math.max(0, i - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const action = filtered[activeIndex]
        if (action) action.run({ close: onClose })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, filtered, activeIndex, onClose])

  // active index 항목으로 스크롤
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-action-index="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  if (!open) return null

  let runningIndex = 0

  return (
    <div
      className="fixed inset-0 z-[210] flex items-start justify-center pt-[10vh] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cmd-palette-title"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={cn(
          'relative bg-editor-panel border border-editor-border rounded-lg shadow-2xl',
          'w-full max-w-xl max-h-[70vh] overflow-hidden flex flex-col'
        )}
      >
        {/* 검색 input */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-editor-border">
          <Search className="h-4 w-4 text-editor-text-muted flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="명령 또는 도구 검색..."
            aria-label="명령 검색"
            className="flex-1 bg-transparent border-none outline-none text-sm text-editor-text placeholder:text-editor-text-muted"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-editor-surface-low text-editor-text-muted border border-editor-border flex-shrink-0">
            ESC
          </kbd>
        </div>

        {/* 결과 리스트 */}
        <div ref={listRef} className="flex-1 overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-editor-text-muted">
              일치하는 명령이 없습니다.
            </div>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div key={group} className="mb-1">
                <div className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-editor-text-muted">
                  {group}
                </div>
                {items.map((a) => {
                  const idx = runningIndex++
                  const active = idx === activeIndex
                  const Icon = a.icon
                  return (
                    <button
                      key={a.id}
                      type="button"
                      data-action-index={idx}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => a.run({ close: onClose })}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                        active
                          ? 'bg-editor-accent/10 text-editor-accent'
                          : 'text-editor-text hover:bg-editor-hover'
                      )}
                    >
                      {Icon && (
                        <Icon
                          className={cn(
                            'h-4 w-4 flex-shrink-0',
                            active ? 'text-editor-accent' : 'text-editor-text-muted'
                          )}
                        />
                      )}
                      <span className="flex-1 truncate">{a.label}</span>
                      {a.hint && (
                        <span className="flex-shrink-0 text-[11px] text-editor-text-muted">
                          {a.hint}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* 푸터 힌트 */}
        <div className="border-t border-editor-border bg-editor-surface-low/50 px-3 py-1.5">
          <p className="text-[10px] text-editor-text-muted flex items-center gap-3">
            <span><Kbd>↑↓</Kbd> 이동</span>
            <span><Kbd>↵</Kbd> 실행</span>
            <span><Kbd>ESC</Kbd> 닫기</span>
          </p>
        </div>
      </div>
    </div>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.25rem] h-4 px-1 text-[9px] rounded bg-editor-panel border border-editor-border text-editor-text-muted font-semibold">
      {children}
    </kbd>
  )
}
