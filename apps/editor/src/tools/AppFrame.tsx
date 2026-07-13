import { useCallback, useState } from 'react'
import { Upload as UploadSimple } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { useImageStore } from '@/stores/useImageStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useIsCustomer } from '@/stores/useAuthStore'
import { useEditorContents } from '@/hooks/useEditorContents'
import { useLibraryPanel } from '@/hooks/useLibraryPanel'
import { Button } from '@/components/ui/button'
import AppSection from '@/components/AppSection'
import AppSectionSearch from '@/components/AppSectionSearch'
import LibraryTagChips from '@/components/LibraryTagChips'
import { ImageProcessingPlugin, SelectionType } from '@storige/canvas-core'
import { contentsApi } from '@/api'
import type { EditorContent } from '@/generated/graphql'
import { resolveAssetUrl } from '@/utils/resolveAssetUrl'

export default function AppFrame() {
  const canvas = useAppStore((state) => state.canvas)
  const ready = useAppStore((state) => state.ready)
  const getPlugin = useAppStore((state) => state.getPlugin)
  const setContentsBrowser = useAppStore((state) => state.setContentsBrowser)

  const upload = useImageStore((state) => state.upload)
  const isCustomer = useIsCustomer()
  // A1-4: 관리자(editMode) 템플릿 제작 화면에도 추천 콘텐츠(라이브러리) 섹션 노출
  const editMode = useSettingsStore((state) => state.currentSettings.editMode)

  const { setupFrameContent } = useEditorContents()

  const [isLoading, setIsLoading] = useState(false)

  // 추천 콘텐츠 데이터 파이프라인 공통화 (P3-b) — 프레임은 tags 컬럼 보유로 태그칩 지원.
  const {
    contents,
    loadingContents,
    availableTags,
    selectedTag,
    setSelectedTag,
    searchType,
    searchKeyword,
    handleSearch,
    handleClearSearch,
    hasActiveFilter,
  } = useLibraryPanel({ fetcher: contentsApi.getFrames })

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
        {/* A1-4: isCustomer 게이트 완화 — 관리자(editMode)도 추천 섹션 사용(템플릿 제작 시 에셋 배치) */}
        {(isCustomer || editMode) && (
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
                searchOptions={[{ label: '이름', value: 'name' }]}
              />
            }
          >
            {/* Category tag tabs (프레임 tags 컬럼 지원) */}
            <LibraryTagChips
              tags={availableTags}
              selectedTag={selectedTag}
              onSelect={setSelectedTag}
            />

            {loadingContents ? (
              <div className="flex justify-center items-center min-h-[200px]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-editor-accent" />
              </div>
            ) : contents.length === 0 ? (
              <div className="py-8 text-center text-editor-text-muted text-xs">
                {hasActiveFilter ? '검색 결과가 없습니다.' : '추천 콘텐츠가 없습니다.'}
              </div>
            ) : (
              <div className="w-full grid grid-cols-2 gap-2">
                {contents.map((content, index) => {
                  const imageUrl = resolveAssetUrl(
                    (content as any).imageUrl || content?.image?.image?.url
                  )
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
                          alt={content.name || ''}
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
