import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '@/stores/useEditorStore'
import { useIsCustomer } from '@/stores/useAuthStore'
import type { EditorContent } from '@/generated/graphql'

/**
 * contentsApi 의 라이브러리 조회 함수 시그니처 (getElements/getFrames/getBackgrounds).
 * 모두 `(params) => Promise<{ success, data: { items, total } }>` 형태로 동일.
 */
type ContentFetcher = (params: {
  pageSize?: number
  search?: string
  tags?: string[]
  templateSetId?: string
}) => Promise<{
  success: boolean
  data?: { items: unknown[]; total?: number } | null
}>

interface UseLibraryPanelOptions {
  /** contentsApi.getElements / getFrames / getBackgrounds 중 하나 */
  fetcher: ContentFetcher
  /** 이름 검색 지원 여부 (배경은 미지원 — tags/검색 컬럼 부재) */
  enableSearch?: boolean
  /** 태그칩 필터 지원 여부 (배경은 tags 컬럼 부재로 false) */
  enableTags?: boolean
  /** 한 번에 가져올 추천 콘텐츠 개수 (기본 20) */
  pageSize?: number
  /** 태그 디스커버리용 표본 크기 (기본 100) */
  tagDiscoverySize?: number
}

interface UseLibraryPanelResult {
  contents: EditorContent[]
  loadingContents: boolean
  /** 디스커버된 태그 (enableTags=false 면 항상 빈 배열) */
  availableTags: string[]
  selectedTag: string | null
  setSelectedTag: (tag: string | null) => void
  /** 검색 UI 제어 상태 (AppSectionSearch 와 연동) */
  searchType: string
  searchKeyword: string
  /** AppSectionSearch onSearch 핸들러 */
  handleSearch: (params: { type: string; keyword: string }) => void
  /** AppSectionSearch onClear 핸들러 */
  handleClearSearch: () => void
  /** 검색어/태그가 비어있지 않은지(빈 상태 메시지 분기용) */
  hasActiveFilter: boolean
}

/**
 * 에셋 패널 공통 라이브러리 조회 훅 (P3-b 패널 일관화).
 *
 * AppElement(정본)에 인라인되어 있던 아래 로직을 추출·공통화한다:
 *  1. 태그 디스커버리(마운트 1회, 큰 표본 1회 조회 후 tags 집합화·정렬)
 *  2. 검색어 디바운스(300ms) — AppSectionSearch 자체 디바운스(500ms)와 별개로 안전망
 *  3. selectedTag + search + templateSetId 로 추천 콘텐츠 조회
 *  4. P1 빈화면 방지: templateSetId 큐레이션이 0건이면 전역으로 1회 폴백 재조회
 *
 * 배경 패널(tags/검색 컬럼 부재)은 enableSearch=false, enableTags=false 로 호출해
 * 안전하게 검색/태그 파라미터를 보내지 않는다(백엔드 SQL 오류 회피).
 *
 * 각 패널의 캔버스 추가 로직(setupAsset/setupFrameContent 등)·업로드·특수 UI 는
 * 패널이 그대로 보유한다. 이 훅은 "추천 콘텐츠 데이터 파이프라인"만 담당.
 */
export function useLibraryPanel({
  fetcher,
  enableSearch = true,
  enableTags = true,
  pageSize = 20,
  tagDiscoverySize = 100,
}: UseLibraryPanelOptions): UseLibraryPanelResult {
  const templateSetId = useEditorStore((state) => state.templateSetId)
  const isCustomer = useIsCustomer()

  // Search state
  const [searchType, setSearchType] = useState('name')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')

  // Tag state
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const tagsDiscoveredRef = useRef(false)

  // Contents state
  const [contents, setContents] = useState<EditorContent[]>([])
  const [loadingContents, setLoadingContents] = useState(false)

  // Debounce search keyword
  useEffect(() => {
    if (!enableSearch) return
    const timer = setTimeout(() => {
      setDebouncedKeyword(searchKeyword)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchKeyword, enableSearch])

  // Discover available tags once on mount (large fetch, no search)
  useEffect(() => {
    if (!enableTags || !isCustomer || tagsDiscoveredRef.current) return
    tagsDiscoveredRef.current = true

    const discoverTags = async () => {
      try {
        const result = await fetcher({
          pageSize: tagDiscoverySize,
          templateSetId: templateSetId ?? undefined,
        })
        if (result.success && result.data) {
          const tagSet = new Set<string>()
          result.data.items.forEach((item) => {
            const itemTags = (item as { tags?: unknown }).tags
            if (Array.isArray(itemTags)) {
              itemTags.forEach((t: string) => {
                if (t) tagSet.add(t)
              })
            }
          })
          setAvailableTags(Array.from(tagSet).sort((a, b) => a.localeCompare(b, 'ko')))
        }
      } catch {
        // tags discovery failure is non-critical
      }
    }
    discoverTags()
  }, [enableTags, isCustomer, templateSetId, fetcher, tagDiscoverySize])

  // Fetch contents — respects selectedTag + search + templateSetId
  useEffect(() => {
    if (!isCustomer) return

    const fetchContents = async () => {
      setLoadingContents(true)
      try {
        const keyword = enableSearch ? debouncedKeyword.trim() : ''
        const baseParams = {
          pageSize,
          search: keyword.length >= 2 ? keyword : undefined,
          tags: enableTags && selectedTag ? [selectedTag] : undefined,
        }
        let result = await fetcher({
          ...baseParams,
          templateSetId: templateSetId ?? undefined,
        })

        // P1 빈화면 방지: 템플릿셋 큐레이션 결과가 0건이면(별도 세팅 안 됨/매칭 실패)
        // templateSetId 없이 전역 에셋으로 한 번 더 폴백 조회한다(기본 에셋 디폴트).
        const isEmpty = !result.success || !result.data || result.data.items.length === 0
        if (isEmpty && templateSetId) {
          result = await fetcher(baseParams)
        }

        if (result.success && result.data) {
          setContents(result.data.items as unknown as EditorContent[])
        } else {
          setContents([])
        }
      } catch (error) {
        console.error('라이브러리 콘텐츠 로드 오류:', error)
        setContents([])
      } finally {
        setLoadingContents(false)
      }
    }

    fetchContents()
  }, [
    isCustomer,
    debouncedKeyword,
    selectedTag,
    templateSetId,
    fetcher,
    enableSearch,
    enableTags,
    pageSize,
  ])

  const handleSearch = ({ type, keyword }: { type: string; keyword: string }) => {
    setSearchType(type)
    setSearchKeyword(keyword)
  }

  const handleClearSearch = () => {
    setSearchType('name')
    setSearchKeyword('')
  }

  const hasActiveFilter = Boolean((enableSearch && searchKeyword) || (enableTags && selectedTag))

  return {
    contents,
    loadingContents,
    availableTags: enableTags ? availableTags : [],
    selectedTag,
    setSelectedTag,
    searchType,
    searchKeyword,
    handleSearch,
    handleClearSearch,
    hasActiveFilter,
  }
}
