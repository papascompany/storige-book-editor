import { useCallback, useEffect, useState, useRef } from 'react'
import { Upload as UploadSimple } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { useImageStore } from '@/stores/useImageStore'
import { useIsCustomer } from '@/stores/useAuthStore'
import { useEditorContents } from '@/hooks/useEditorContents'
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer'
import { Button } from '@/components/ui/button'
import AppSection from '@/components/AppSection'
import AppSectionSearch from '@/components/AppSectionSearch'
import { ImageProcessingPlugin, SelectionType } from '@storige/canvas-core'
import { contentsApi } from '@/api'
import type { EditorContent } from '@/generated/graphql'
import { cn } from '@/lib/utils'

export default function AppElement() {
  const canvas = useAppStore((state) => state.canvas)
  const ready = useAppStore((state) => state.ready)
  const getPlugin = useAppStore((state) => state.getPlugin)
  const setContentsBrowser = useAppStore((state) => state.setContentsBrowser)
  const tapMenu = useAppStore((state) => state.tapMenu)
  const upload = useImageStore((state) => state.upload)
  const isCustomer = useIsCustomer()
  const { setupAsset } = useEditorContents()
  const isCoarsePointer = useIsCoarsePointer()

  const [isLoading, setIsLoading] = useState(false)

  // Search state
  const [searchType, setSearchType] = useState('name')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')

  // Category tabs state
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const tagsDiscoveredRef = useRef(false)

  // Contents state
  const [contents, setContents] = useState<EditorContent[]>([])
  const [loadingContents, setLoadingContents] = useState(false)

  // Debounce search keyword
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedKeyword(searchKeyword)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchKeyword])

  // Discover available tags once on mount (large fetch, no search)
  useEffect(() => {
    if (!isCustomer || tagsDiscoveredRef.current) return
    tagsDiscoveredRef.current = true

    const discoverTags = async () => {
      try {
        const result = await contentsApi.getElements({ pageSize: 100 })
        if (result.success && result.data) {
          const tagSet = new Set<string>()
          result.data.items.forEach((item: any) => {
            const itemTags = item.tags
            if (Array.isArray(itemTags)) {
              itemTags.forEach((t: string) => { if (t) tagSet.add(t) })
            }
          })
          setAvailableTags(Array.from(tagSet).sort((a, b) => a.localeCompare(b, 'ko')))
        }
      } catch {
        // tags discovery failure is non-critical
      }
    }
    discoverTags()
  }, [isCustomer])

  // Fetch elements — respects selectedTag + search
  useEffect(() => {
    if (!isCustomer) return

    const fetchElements = async () => {
      setLoadingContents(true)
      try {
        const keyword = debouncedKeyword.trim()
        const result = await contentsApi.getElements({
          pageSize: 20,
          search: keyword.length >= 2 ? keyword : undefined,
          tags: selectedTag ? [selectedTag] : undefined,
        })

        if (result.success && result.data) {
          setContents(result.data.items as unknown as EditorContent[])
        } else {
          setContents([])
        }
      } catch (error) {
        console.error('요소 콘텐츠 로드 오류:', error)
        setContents([])
      } finally {
        setLoadingContents(false)
      }
    }

    fetchElements()
  }, [isCustomer, debouncedKeyword, selectedTag])

  // Handle upload
  const handleUpload = useCallback(async () => {
    if (!ready || !canvas) return

    const imagePlugin = getPlugin<ImageProcessingPlugin>('ImageProcessingPlugin')

    setIsLoading(true)

    try {
      await upload(
        canvas,
        imagePlugin!,
        SelectionType.shape,
        'image/*'
      )
    } catch (error) {
      console.error('요소 업로드 오류:', error)
    } finally {
      setIsLoading(false)
    }
  }, [ready, canvas, getPlugin, upload])

  // Add content to canvas
  const addContentToCanvas = useCallback(async (content: EditorContent) => {
    if (!content) return
    try {
      await setupAsset(content, 'element')
      const cv = useAppStore.getState().canvas
      cv?.requestRenderAll?.()
      if (isCoarsePointer) {
        tapMenu(null)
      }
    } catch (error) {
      console.error('요소 콘텐츠 추가 오류:', error)
    }
  }, [setupAsset, isCoarsePointer, tapMenu])

  const showMore = useCallback(() => {
    setContentsBrowser('element')
  }, [setContentsBrowser])

  const handleSearch = useCallback(({ type, keyword }: { type: string; keyword: string }) => {
    setSearchType(type)
    setSearchKeyword(keyword)
  }, [])

  const handleClearSearch = useCallback(() => {
    setSearchType('name')
    setSearchKeyword('')
  }, [])

  return (
    <div className="w-full h-full flex flex-col">
      <div className="px-4 pt-4 pb-3">
        <Button
          variant="secondary"
          className="w-full h-10"
          onClick={handleUpload}
          disabled={isLoading || !ready}
        >
          <UploadSimple className="h-4 w-4 mr-2" />
          {isLoading ? '업로드 중...' : '업로드'}
        </Button>
      </div>
      <div className="sections flex flex-col overflow-y-auto">
        {isCustomer && (
          <AppSection
            id="app-element-recommended"
            title="추천 콘텐츠"
            onDetail={showMore}
            searchSlot={
              <AppSectionSearch
                searchType={searchType}
                searchKeyword={searchKeyword}
                isSearching={loadingContents}
                onSearch={handleSearch}
                onClear={handleClearSearch}
              />
            }
          >
            {/* Category tag tabs */}
            {availableTags.length > 0 && (
              <div
                className="flex gap-1.5 overflow-x-auto pb-3 -mx-4 px-4"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                <button
                  className={cn(
                    'whitespace-nowrap text-xs px-3 py-1 rounded-full border transition-colors flex-shrink-0',
                    !selectedTag
                      ? 'bg-editor-accent border-editor-accent text-white'
                      : 'border-editor-border text-editor-text-muted hover:text-editor-text hover:border-editor-text-muted'
                  )}
                  onClick={() => setSelectedTag(null)}
                >
                  전체
                </button>
                {availableTags.map((tag) => (
                  <button
                    key={tag}
                    className={cn(
                      'whitespace-nowrap text-xs px-3 py-1 rounded-full border transition-colors flex-shrink-0',
                      selectedTag === tag
                        ? 'bg-editor-accent border-editor-accent text-white'
                        : 'border-editor-border text-editor-text-muted hover:text-editor-text hover:border-editor-text-muted'
                    )}
                    onClick={() => setSelectedTag(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}

            {loadingContents ? (
              <div className="flex justify-center items-center min-h-[160px]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-editor-accent" />
              </div>
            ) : contents.length === 0 ? (
              <div className="py-8 text-center text-editor-text-muted text-xs">
                {searchKeyword || selectedTag ? '검색 결과가 없습니다.' : '추천 콘텐츠가 없습니다.'}
              </div>
            ) : (
              <div className="w-full grid grid-cols-2 gap-2">
                {contents.map((content, index) => {
                  const imageUrl = (content as any).imageUrl || content?.image?.image?.url
                  return (
                    <div
                      key={index}
                      className="w-full cursor-pointer"
                      onClick={() => addContentToCanvas(content)}
                    >
                      <div className="bg-editor-surface-low p-2 flex items-center justify-center w-full rounded hover:bg-editor-hover aspect-square overflow-hidden">
                        {imageUrl && (
                          <img
                            src={imageUrl}
                            alt={content?.name || ''}
                            className="object-contain w-full h-full"
                          />
                        )}
                      </div>
                      <div className="mt-1 px-1 text-left text-xs text-editor-text-muted truncate">
                        {content?.name || '이름 없음'}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </AppSection>
        )}

        <div className="h-10 w-1 p-10" />
      </div>
    </div>
  )
}
