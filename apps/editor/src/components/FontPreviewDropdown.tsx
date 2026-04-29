import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { ChevronDown, Search, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FontSource } from '@/utils/fonts'
import { useFontPreview, isFontLoaded, SAMPLE_TEXT } from '@/hooks/useFontPreview'

interface FontPreviewDropdownProps {
  value?: string
  options: FontSource[]
  placeholder?: string
  disabled?: boolean
  onSelect: (font: FontSource) => void
}

// Korean character helpers for search
const HANGUL_BASE = 0xac00
const HANGUL_LAST = 0xd7a3
const CHOSEONG_LIST = [
  'ㄱ',
  'ㄲ',
  'ㄴ',
  'ㄷ',
  'ㄸ',
  'ㄹ',
  'ㅁ',
  'ㅂ',
  'ㅃ',
  'ㅅ',
  'ㅆ',
  'ㅇ',
  'ㅈ',
  'ㅉ',
  'ㅊ',
  'ㅋ',
  'ㅌ',
  'ㅍ',
  'ㅎ',
]

const normalizeText = (text: string): string => {
  return text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
}

const isKoreanConsonantQuery = (text: string): boolean => {
  return /^([\u3131-\u314e])+$/u.test(text)
}

const getInitialConsonants = (text: string): string => {
  let result = ''
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
      const idx = Math.floor((code - HANGUL_BASE) / (21 * 28))
      result += CHOSEONG_LIST[idx]
    } else {
      const ch = text[i]
      if (/^[a-z0-9]$/.test(ch)) {
        result += ch
      } else if (ch === ' ') {
        result += ' '
      }
    }
  }
  return result.replace(/\s+/g, ' ').trim()
}

const tokenize = (text: string): string[] => {
  return normalizeText(text)
    .split(/[^\p{Script=Hangul}a-z0-9]+/iu)
    .filter(Boolean)
}

const computeMatchScore = (font: FontSource, rawQuery: string): number => {
  if (!rawQuery) return 0
  const query = normalizeText(rawQuery)
  const nameNorm = normalizeText(font.name)
  const nameTokens = tokenize(font.name)

  let score = 0

  // Exact full match
  if (nameNorm === query) score = Math.max(score, 100)

  // Prefix of full name
  if (nameNorm.startsWith(query)) score = Math.max(score, 85)

  // Token exact/prefix matches
  for (const token of nameTokens) {
    if (token === query) {
      score = Math.max(score, 95)
      break
    }
    if (token.startsWith(query)) {
      const tokenBonus = Math.max(0, 10 - Math.min(10, token.length - query.length))
      score = Math.max(score, 80 + tokenBonus)
    }
  }

  // Substring fallback
  if (nameNorm.includes(query)) score = Math.max(score, 70)

  // Korean initial consonant match
  const queryIsChoseong = isKoreanConsonantQuery(query)
  if (queryIsChoseong) {
    const nameInitials = getInitialConsonants(nameNorm)
    const initialsTokens = nameInitials.split(' ')

    if (initialsTokens.some((t) => t === query)) score = Math.max(score, 90)
    if (initialsTokens.some((t) => t.startsWith(query))) score = Math.max(score, 82)
    if (nameInitials.replace(/\s+/g, '').includes(query)) score = Math.max(score, 75)
  }

  return score
}

// Font preview item component
interface FontPreviewItemProps {
  font: FontSource
  selected: boolean
  onClick: () => void
}

function FontPreviewItem({ font, selected, onClick }: FontPreviewItemProps) {
  const { loadFontPreview, isFontLoading, hasFontError } = useFontPreview()
  const [isHovered, setIsHovered] = useState(false)
  const isLoaded = isFontLoaded(font.name)
  const isLoading = isFontLoading(font.name)
  const hasError = hasFontError(font.name)

  const handleMouseEnter = useCallback(async () => {
    setIsHovered(true)
    if (!isLoaded && !isLoading && !hasError) {
      try {
        await loadFontPreview(font)
      } catch {
        // ignore
      }
    }
  }, [font, isLoaded, isLoading, hasError, loadFontPreview])

  const previewStyle = useMemo(() => {
    if (!isLoaded) {
      return { fontFamily: 'Arial, sans-serif' }
    }
    return { fontFamily: `"${font.name}", Arial, sans-serif` }
  }, [isLoaded, font.name])

  return (
    <div
      className={cn(
        'relative px-4 py-3 cursor-pointer border-b border-editor-border transition-colors',
        isHovered && 'bg-editor-hover',
        selected && 'bg-primary/10',
        isLoading && 'pointer-events-none'
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
    >
      {isLoading ? (
        <div className="flex flex-col gap-2">
          <div className="h-3.5 w-2/5 bg-editor-hover rounded animate-pulse" />
          <div className="h-4 w-4/5 bg-editor-hover rounded animate-pulse" />
        </div>
      ) : hasError ? (
        <div className="flex flex-col gap-1">
          <div className="text-sm font-medium text-editor-text">{font.name}</div>
          <div className="flex items-center gap-1 text-xs text-red-500">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>로딩 실패</span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="text-sm font-medium text-editor-text-muted">{font.name}</div>
          <div
            className="text-base text-editor-text whitespace-nowrap overflow-hidden text-ellipsis"
            style={previewStyle}
          >
            {SAMPLE_TEXT}
          </div>
        </div>
      )}
      {selected && (
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-primary font-bold">
          ✓
        </span>
      )}
    </div>
  )
}

export default function FontPreviewDropdown({
  value,
  options,
  placeholder = '폰트를 선택해 주세요',
  disabled = false,
  onSelect,
}: FontPreviewDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Virtual scrolling config
  const itemHeight = 72
  const containerHeight = 300
  const visibleCount = Math.ceil(containerHeight / itemHeight) + 2

  const [scrollTop, setScrollTop] = useState(0)

  // Get selected font name
  const selectedFontName = useMemo(() => {
    if (!value) return ''
    const font = options.find((f) => f.name === value)
    return font?.name || value
  }, [value, options])

  // Selected font style
  const selectedFontStyle = useMemo(() => {
    if (!value || !isFontLoaded(value)) {
      return { fontFamily: 'Arial, sans-serif' }
    }
    return { fontFamily: `"${value}", Arial, sans-serif` }
  }, [value])

  // Filtered fonts with search
  const filteredFonts = useMemo(() => {
    const q = normalizeText(searchQuery)
    if (!q) return options

    const matches: { font: FontSource; score: number }[] = []
    for (const font of options) {
      const s = computeMatchScore(font, q)
      if (s > 0) {
        matches.push({ font, score: s })
      }
    }

    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (a.font.name.length !== b.font.name.length)
        return a.font.name.length - b.font.name.length
      return a.font.name.localeCompare(b.font.name)
    })

    return matches.map((m) => m.font)
  }, [options, searchQuery])

  // Virtual scrolling calculations
  const totalHeight = filteredFonts.length * itemHeight
  const startIndex = Math.floor(scrollTop / itemHeight)
  const endIndex = Math.min(startIndex + visibleCount, filteredFonts.length)
  const visibleFonts = filteredFonts.slice(startIndex, endIndex)
  const offsetY = startIndex * itemHeight

  // Panel positioning
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({})

  const updatePanelPosition = useCallback(() => {
    if (!dropdownRef.current) return

    const triggerRect = dropdownRef.current.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const panelHeight = 400

    let top = triggerRect.bottom + 4

    if (top + panelHeight > viewportHeight) {
      top = triggerRect.top - panelHeight - 4
    }

    setPanelStyle({
      position: 'fixed',
      top: `${top}px`,
      left: `${triggerRect.left}px`,
      width: `${triggerRect.width}px`,
      zIndex: 9999,
    })
  }, [])

  // Toggle dropdown
  const toggleDropdown = useCallback(() => {
    if (disabled) return

    setIsOpen((prev) => {
      const newValue = !prev
      if (newValue) {
        // Opening
        setTimeout(() => {
          updatePanelPosition()
          searchInputRef.current?.focus()

          // Scroll to selected item
          if (value && scrollContainerRef.current) {
            const idx = filteredFonts.findIndex((f) => f.name === value)
            if (idx >= 0) {
              scrollContainerRef.current.scrollTop = idx * itemHeight
              setScrollTop(idx * itemHeight)
            }
          }
        }, 0)
      } else {
        // Closing
        setSearchQuery('')
      }
      return newValue
    })
  }, [disabled, value, filteredFonts, updatePanelPosition])

  // Handle scroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  // Handle font select
  const handleFontSelect = useCallback(
    (font: FontSource) => {
      onSelect(font)
      setIsOpen(false)
      setSearchQuery('')
    },
    [onSelect]
  )

  // Handle search input
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
    // Reset scroll on search
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0
      setScrollTop(0)
    }
  }, [])

  // Handle keyboard
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
        setSearchQuery('')
      } else if (e.key === 'Enter' && filteredFonts.length > 0) {
        handleFontSelect(filteredFonts[0])
      }
    },
    [filteredFonts, handleFontSelect]
  )

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        panelRef.current &&
        !panelRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
        setSearchQuery('')
      }
    }

    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  // Update position on resize/scroll
  useEffect(() => {
    if (!isOpen) return

    window.addEventListener('resize', updatePanelPosition)
    window.addEventListener('scroll', updatePanelPosition, true)

    return () => {
      window.removeEventListener('resize', updatePanelPosition)
      window.removeEventListener('scroll', updatePanelPosition, true)
    }
  }, [isOpen, updatePanelPosition])

  return (
    <div ref={dropdownRef} className="relative w-full">
      {/* Trigger */}
      <div
        className={cn(
          'h-9 px-3 border border-editor-border rounded-md cursor-pointer flex items-center justify-between bg-editor-panel transition-all',
          'hover:border-editor-border hover:bg-editor-hover',
          isOpen && 'border-editor-accent shadow-sm rounded-b-none',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        onClick={toggleDropdown}
        tabIndex={0}
        role="combobox"
        aria-expanded={isOpen}
      >
        <span
          className="flex-1 text-sm text-editor-text truncate"
          style={selectedFontStyle}
        >
          {selectedFontName || placeholder}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-editor-text-muted transition-transform flex-shrink-0',
            isOpen && 'rotate-180'
          )}
        />
      </div>

      {/* Dropdown panel */}
      {isOpen && (
        <div
          ref={panelRef}
          className="bg-editor-panel border border-editor-border border-t-0 rounded-b-lg shadow-lg overflow-hidden"
          style={panelStyle}
        >
          {/* Search input */}
          <div className="border-b border-editor-border bg-editor-surface">
            <div className="flex items-center px-3 py-2 gap-2">
              <Search className="h-4 w-4 text-editor-text-muted flex-shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                onKeyDown={handleKeyDown}
                placeholder="폰트 검색..."
                className="flex-1 bg-transparent text-sm outline-none text-editor-text placeholder:text-editor-text-muted"
              />
              {searchQuery && (
                <button
                  className="text-editor-text-muted hover:text-editor-text"
                  onClick={() => {
                    setSearchQuery('')
                    searchInputRef.current?.focus()
                  }}
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {/* Font list with virtual scrolling */}
          {filteredFonts.length > 0 ? (
            <div
              ref={scrollContainerRef}
              className="overflow-y-auto bg-editor-panel"
              style={{ height: containerHeight }}
              onScroll={handleScroll}
            >
              <div style={{ height: totalHeight, position: 'relative' }}>
                <div style={{ transform: `translateY(${offsetY}px)` }}>
                  {visibleFonts.map((font) => (
                    <FontPreviewItem
                      key={font.name}
                      font={font}
                      selected={font.name === value}
                      onClick={() => handleFontSelect(font)}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-8 text-editor-text-muted">
              <Search className="h-6 w-6" />
              <span className="text-sm">검색 결과가 없습니다.</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
