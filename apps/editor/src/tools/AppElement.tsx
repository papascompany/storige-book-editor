import { useCallback, useEffect, useState } from 'react'
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

  // Fetch elements (clipart) using REST API
  useEffect(() => {
    if (!isCustomer) return

    const fetchElements = async () => {
      setLoadingContents(true)
      try {
        const keyword = debouncedKeyword.trim()
        const result = await contentsApi.getElements({
          pageSize: 20,
          search: keyword.length >= 2 ? keyword : undefined,
        })

        if (result.success && result.data) {
          // contentsApi 반환은 @storige/types EditorContent (createdAt: Date)이고
          // 로컬 import는 @/generated/graphql EditorContent (createdAt: string)이라 형태가 다름.
          // 런타임 사용처는 추가 필드만 보고 createdAt은 직접 참조 안 함 → unknown 캐스팅으로 정합.
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
  }, [isCustomer, debouncedKeyword])

  // Handle upload — 요소 도구는 SVG, PNG, JPG, GIF, WebP 등 모든 이미지를 받음
  // (사용자 요구: 정정된 정책 — SVG뿐 아니라 raster 이미지도 element로 추가 가능)
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
      // setupAsset 내부에서 add 후 렌더링까지 처리되지만, 캔버스가 idle 상태일 때를
      // 대비해 명시적으로 한 번 더 렌더 요청.
      const cv = useAppStore.getState().canvas
      cv?.requestRenderAll?.()
      // 터치 디바이스에서는 추가 후 사이드바 닫기.
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

  // Search handlers
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
                          alt={content?.name || ''}
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
