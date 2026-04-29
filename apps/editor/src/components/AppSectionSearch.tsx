import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { cn } from '@/lib/utils'

interface AppSectionSearchProps {
  searchType?: string
  searchKeyword?: string
  isSearching?: boolean
  minSearchLength?: number
  onSearch?: (params: { type: string; keyword: string }) => void
  onClear?: () => void
}

const searchOptions = [
  { label: '이름', value: 'name' },
  { label: '태그', value: 'tags' }
]

export default function AppSectionSearch({
  searchType = 'name',
  searchKeyword = '',
  isSearching = false,
  minSearchLength = 2,
  onSearch,
  onClear
}: AppSectionSearchProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [localKeyword, setLocalKeyword] = useState(searchKeyword)
  const [localType, setLocalType] = useState(searchType)
  const rootRef = useRef<HTMLDivElement>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync local state with props
  useEffect(() => {
    setLocalKeyword(searchKeyword)
  }, [searchKeyword])

  useEffect(() => {
    setLocalType(searchType)
  }, [searchType])

  // Current search type label
  const currentSearchTypeLabel = useMemo(() => {
    return searchOptions.find(o => o.value === localType)?.label ?? '검색유형'
  }, [localType])

  // Toggle dropdown
  const toggleDropdown = useCallback(() => {
    setIsDropdownOpen(prev => !prev)
  }, [])

  // Select type
  const selectType = useCallback((value: string) => {
    setLocalType(value)
    setIsDropdownOpen(false)

    // Re-search if there's a valid keyword
    if (localKeyword.trim() && localKeyword.trim().length >= minSearchLength) {
      onSearch?.({
        type: value,
        keyword: localKeyword.trim()
      })
    }
  }, [localKeyword, minSearchLength, onSearch])

  // Handle input change
  const handleInput = useCallback((value: string) => {
    setLocalKeyword(value)

    // Clear previous timer
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current)
    }

    // Empty string - reset immediately
    if (!value.trim()) {
      onSearch?.({
        type: localType,
        keyword: ''
      })
      return
    }

    // Min length check
    if (value.trim().length < minSearchLength) {
      return
    }

    // Debounce search (500ms)
    searchTimerRef.current = setTimeout(() => {
      onSearch?.({
        type: localType,
        keyword: value.trim()
      })
    }, 500)
  }, [localType, minSearchLength, onSearch])

  // Handle clear
  const handleClear = useCallback(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current)
    }
    setLocalKeyword('')
    onClear?.()
  }, [onClear])

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false)
      }
    }

    document.addEventListener('click', handleOutsideClick)
    return () => {
      document.removeEventListener('click', handleOutsideClick)
    }
  }, [])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current)
      }
    }
  }, [])

  return (
    <div className="app-section-search w-full">
      <div className="search-container bg-editor-panel w-full">
        <div
          ref={rootRef}
          className="search-field relative flex items-center bg-editor-panel border border-black/10 rounded-lg px-2 py-1"
        >
          {/* Type selector */}
          <button
            type="button"
            className="prefix inline-flex items-center gap-1.5 h-7 px-2 border-none bg-transparent text-editor-text cursor-pointer rounded-md text-xs hover:bg-black/5"
            aria-expanded={isDropdownOpen}
            onClick={toggleDropdown}
          >
            <span className="prefix-label min-w-[32px]">{currentSearchTypeLabel}</span>
            <span className="chevron text-[10px] leading-none text-editor-text-muted" aria-hidden="true">▾</span>
          </button>

          {/* Dropdown */}
          {isDropdownOpen && (
            <div className="dropdown absolute top-full left-0 mt-1.5 bg-editor-panel border border-black/10 rounded-lg shadow-lg z-20 min-w-[140px] py-1.5 px-1">
              <ul className="list-none p-0 m-0">
                {searchOptions.map(opt => (
                  <li
                    key={opt.value}
                    className={cn(
                      'dropdown-item py-2 px-2.5 rounded-md cursor-pointer text-sm text-editor-text',
                      'hover:bg-black/5',
                      opt.value === localType && 'bg-black/[0.06] font-semibold'
                    )}
                    role="option"
                    aria-selected={opt.value === localType}
                    onClick={() => selectType(opt.value)}
                  >
                    {opt.label}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Divider */}
          <div className="divider w-px h-[18px] bg-black/10 mx-2" />

          {/* Input */}
          <input
            type="text"
            className="input-el flex-1 min-w-0 h-7 border-none outline-none text-sm text-editor-text bg-transparent"
            placeholder="검색어를 입력하세요"
            value={localKeyword}
            onChange={(e) => handleInput(e.target.value)}
          />

          {/* Clear button */}
          {localKeyword && localKeyword.length > 0 && (
            <button
              type="button"
              className="clear-btn border-none bg-transparent text-editor-text-muted cursor-pointer h-6 w-6 rounded hover:bg-black/[0.06] hover:text-editor-text-muted"
              aria-label="clear"
              onClick={handleClear}
            >
              ✕
            </button>
          )}

          {/* Spinner */}
          {isSearching && (
            <span
              className="spinner w-4 h-4 border-2 border-black/10 border-t-black/50 rounded-full animate-spin ml-1"
              aria-hidden="true"
            />
          )}
        </div>

        {/* Min length warning */}
        {localKeyword && localKeyword.length > 0 && localKeyword.length < minSearchLength && (
          <div className="text-xs text-editor-text-muted mt-1 px-1">
            최소 {minSearchLength}자 이상 입력해주세요
          </div>
        )}
      </div>
    </div>
  )
}
