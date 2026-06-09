import { useCallback, useState, useEffect } from 'react'
import { Upload as UploadSimple } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { useImageStore } from '@/stores/useImageStore'
import { useEditorStore } from '@/stores/useEditorStore'
import { useIsCustomer } from '@/stores/useAuthStore'
import { useEditorContents } from '@/hooks/useEditorContents'
import { Button } from '@/components/ui/button'
import AppSection from '@/components/AppSection'
import AppSectionSearch from '@/components/AppSectionSearch'
import { ImageProcessingPlugin, SelectionType } from '@storige/canvas-core'
import { contentsApi } from '@/api'
import type { EditorContent } from '@/generated/graphql'

export default function AppFrame() {
  const canvas = useAppStore((state) => state.canvas)
  const ready = useAppStore((state) => state.ready)
  const getPlugin = useAppStore((state) => state.getPlugin)
  const setContentsBrowser = useAppStore((state) => state.setContentsBrowser)

  const upload = useImageStore((state) => state.upload)
  // 템플릿셋별 에셋 큐레이션(2026-06-09): 현재 세션의 templateSetId 를 콘텐츠 조회에 전달.
  const templateSetId = useEditorStore((state) => state.templateSetId)
  const isCustomer = useIsCustomer()

  const { setupFrameContent } = useEditorContents()

  const [isLoading, setIsLoading] = useState(false)
  const [searchType, setSearchType] = useState('name')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [debouncedKeyword, setDebouncedKeyword] = useState('')

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

  // Fetch frames using REST API
  useEffect(() => {
    if (!isCustomer) return

    const fetchFrames = async () => {
      setLoadingContents(true)
      try {
        const keyword = debouncedKeyword.trim()
        const result = await contentsApi.getFrames({
          pageSize: 20,
          search: keyword.length >= 2 ? keyword : undefined,
          templateSetId: templateSetId ?? undefined,
        })

        if (result.success && result.data) {
           
          setContents(result.data.items as any[])
        } else {
          setContents([])
        }
      } catch (error) {
        console.error('프레임 콘텐츠 로드 오류:', error)
        setContents([])
      } finally {
        setLoadingContents(false)
      }
    }

    fetchFrames()
  }, [isCustomer, debouncedKeyword, templateSetId])

  // UploadSimple handler
  const handleUpload = useCallback(async () => {
    if (!ready || !canvas) return

    setIsLoading(true)
    try {
      const imagePlugin = getPlugin<ImageProcessingPlugin>('ImageProcessingPlugin')
      await upload(canvas, imagePlugin!, SelectionType.frame)
    } catch (error) {
      console.error('프레임 업로드 오류:', error)
    } finally {
      setIsLoading(false)
    }
  }, [ready, canvas, getPlugin, upload])

  // Add content to canvas
  const addContentToCanvas = useCallback((content: EditorContent) => {
    if (!canvas) return
     
    setupFrameContent(content as any, canvas)
  }, [canvas, setupFrameContent])

  // Show more handler
  const showMore = useCallback(() => {
    setContentsBrowser('frame')
  }, [setContentsBrowser])

  // Search handlers
  const handleSearch = useCallback(({ type, keyword }: { type: string; keyword: string }) => {
    setSearchType(type)
    setSearchKeyword(keyword)
    // GraphQL will automatically refetch when filter changes via useMemo
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
          {isLoading ? '업로드 중...' : '모양틀 SVG (테스트용)'}
        </Button>
      </div>
      <div className="sections flex flex-col overflow-y-auto">
        {isCustomer && (
          <AppSection
            id="app-frame-recommended"
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
            {loadingContents ? (
              <div className="flex justify-center items-center min-h-[200px]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-editor-accent" />
              </div>
            ) : contents.length === 0 ? (
              <div className="px-4 py-8 text-center text-editor-text-muted text-xs">
                {searchKeyword ? '검색 결과가 없습니다.' : '추천 콘텐츠가 없습니다.'}
              </div>
            ) : (
              <div className="w-full grid grid-cols-2 gap-2 px-4">
                {contents.map((content, index) => (
                  <div
                    key={index}
                    className="w-full cursor-pointer"
                    onClick={() => addContentToCanvas(content)}
                  >
                    <div className="bg-editor-surface-low p-2 flex items-center justify-center w-full rounded hover:bg-editor-hover aspect-square overflow-hidden">
                      {content?.image?.image?.url && (
                        <img
                          src={content.image.image.url}
                          alt={content.name || ''}
                          className="object-contain w-full h-full"
                        />
                      )}
                    </div>
                    <div className="mt-1 px-1 text-left text-xs text-editor-text-muted truncate">
                      {content?.name || '이름 없음'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </AppSection>
        )}

        <div className="h-10 w-1 p-10" />
      </div>
    </div>
  )
}
