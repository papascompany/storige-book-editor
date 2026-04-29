import { useCallback, useState } from 'react'
import { Upload as UploadSimple } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { useImageStore } from '@/stores/useImageStore'
import { useIsCustomer } from '@/stores/useAuthStore'
import { useEditorContents } from '@/hooks/useEditorContents'
import { Button } from '@/components/ui/button'
import AppSection from '@/components/AppSection'
import { ImageProcessingPlugin, SelectionType } from '@storige/canvas-core'
import type { EditorContent } from '@/generated/graphql'

export default function AppElement() {
  const canvas = useAppStore((state) => state.canvas)
  const getPlugin = useAppStore((state) => state.getPlugin)
  const setContentsBrowser = useAppStore((state) => state.setContentsBrowser)
  const upload = useImageStore((state) => state.upload)
  const isCustomer = useIsCustomer()
  const { setupAsset } = useEditorContents()

  const [isLoading, setIsLoading] = useState(false)

  // Search state (for future GraphQL implementation)
  const [_searchType, _setSearchType] = useState('name')
  const [_searchKeyword, _setSearchKeyword] = useState('')

  // Placeholder for recommended contents (will be loaded via GraphQL)
  const [contents] = useState<Array<{
    id: string
    name: string
    image?: { image?: { url?: string } }
  }>>([])
  const loadingContents = false

  // Handle upload (SVG elements)
  const handleUpload = useCallback(async () => {
    if (!canvas) return

    const imagePlugin = getPlugin<ImageProcessingPlugin>('ImageProcessingPlugin')

    setIsLoading(true)

    try {
      await upload(
        canvas,
        imagePlugin!,
        SelectionType.shape
      )
    } catch (error) {
      console.error('요소 업로드 오류:', error)
    } finally {
      setIsLoading(false)
    }
  }, [canvas, getPlugin, upload])

  // Add content to canvas
  const addContentToCanvas = useCallback(async (content: unknown) => {
    if (!content) return
    try {
      await setupAsset(content as EditorContent, 'element')
    } catch (error) {
      console.error('요소 콘텐츠 추가 오류:', error)
    }
  }, [setupAsset])

  const showMore = useCallback(() => {
    setContentsBrowser('element')
  }, [setContentsBrowser])

  return (
    <div className="w-full h-full flex flex-col">
      <div className="tool-header p-4 gap-6 flex flex-col">
        <span className="title text-editor-text font-medium">요소</span>
        <Button
          variant="secondary"
          className="w-full h-10"
          onClick={handleUpload}
          disabled={isLoading}
        >
          <UploadSimple className="h-4 w-4 mr-2" />
          {isLoading ? '업로드 중...' : '업로드'}
        </Button>
      </div>

      <hr className="border-editor-border" />

      <div className="sections flex flex-col overflow-y-auto">
        {isCustomer && (
          <AppSection title="추천 콘텐츠" onDetail={showMore}>
            {loadingContents ? (
              <div className="flex justify-center items-center min-h-[200px]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-editor-accent" />
              </div>
            ) : contents.length === 0 ? (
              <div className="px-4 py-8 text-center text-editor-text-muted text-sm">
                추천 콘텐츠가 없습니다.
              </div>
            ) : (
              <div className="w-full grid grid-cols-2 gap-2 px-4">
                {contents.map((content, index) => (
                  <div
                    key={index}
                    className="w-full cursor-pointer"
                    onClick={() => addContentToCanvas(content)}
                  >
                    <div className="bg-gray-50 p-2 flex items-center justify-center w-full rounded hover:bg-gray-100 aspect-square overflow-hidden">
                      {content.image?.image?.url && (
                        <img
                          src={content.image.image.url}
                          alt={content.name}
                          className="object-contain w-full h-full"
                        />
                      )}
                    </div>
                    <div className="mt-1 px-1 text-left text-xs text-gray-600 truncate">
                      {content.name || '이름 없음'}
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
