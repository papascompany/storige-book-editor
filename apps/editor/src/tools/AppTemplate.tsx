import { useCallback, useState, useMemo } from 'react'
import { Upload as UploadSimple } from 'lucide-react'
import { useAppStore, useHasCutlineTemplate } from '@/stores/useAppStore'
import { useSettingsStore, useEditorTemplates } from '@/stores/useSettingsStore'
import { useIsCustomer } from '@/stores/useAuthStore'
import { useEditorContents } from '@/hooks/useEditorContents'
import { Button } from '@/components/ui/button'
import AppSection from '@/components/AppSection'
import AppSectionSearch from '@/components/AppSectionSearch'
import { selectFiles, TemplatePlugin } from '@storige/canvas-core'
import type { EditorTemplate } from '@/generated/graphql'

export default function AppTemplate() {
  const canvas = useAppStore((state) => state.canvas)
  const ready = useAppStore((state) => state.ready)
  const getPlugin = useAppStore((state) => state.getPlugin)
  const setContentsBrowser = useAppStore((state) => state.setContentsBrowser)
  const hasCutlineTemplate = useHasCutlineTemplate()

  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const editorTemplates = useEditorTemplates()
  const isCustomer = useIsCustomer()

  const { setupTemplateContent, setupTemplateFromSvgString } = useEditorContents()

  const [isLoading, setIsLoading] = useState(false)
  const [searchType, setSearchType] = useState('name')
  const [searchKeyword, setSearchKeyword] = useState('')

  // Filtered templates based on search
  const filteredTemplates = useMemo(() => {
    if (!editorTemplates) return null

    // Return all if no search keyword or too short
    if (!searchKeyword.trim() || searchKeyword.trim().length < 2) {
      return editorTemplates
    }

    const keyword = searchKeyword.trim().toLowerCase()

    return editorTemplates.filter((template) => {
      if (searchType === 'name') {
        return template.name?.toLowerCase().includes(keyword) || false
      } else if (searchType === 'tags') {
        return template.tags?.some((tag: { id?: string; name?: string | null }) =>
          tag.name?.toLowerCase().includes(keyword)
        ) || false
      }
      return false
    })
  }, [editorTemplates, searchKeyword, searchType])

  // Add template content to canvas
  const addContentToCanvas = useCallback((content: EditorTemplate) => {
     
    setupTemplateContent(content as any)
  }, [setupTemplateContent])

  // UploadSimple SVG template
  const handleUpload = useCallback(async () => {
    if (!ready) {
      console.error('에디터가 준비되지 않았습니다.')
      return
    }

    try {
      const files = await selectFiles({
        multiple: false,
        accept: '.svg'
      })

      if (!files || files.length === 0) return

      setIsLoading(true)
      const file = files[0]
      const fileExtension = file.name.split('.').pop()?.toLowerCase()

      if (fileExtension !== 'svg') {
        console.error('SVG 파일만 지원합니다.')
        setIsLoading(false)
        return
      }

      const plugin = getPlugin<TemplatePlugin>('TemplatePlugin')
      const svgString = await plugin?.readSVGFromFile(file)

      if (svgString) {
        await setupTemplateFromSvgString(svgString, null, { viaUpload: true })
      }
    } catch (e) {
      console.error('SVG 템플릿 업로드 오류:', e)
    } finally {
      setIsLoading(false)
    }
  }, [ready, getPlugin, setupTemplateFromSvgString])

  // UploadSimple cutline template
  const handleUploadCutTemplate = useCallback(async () => {
    if (!ready) {
      console.error('에디터가 준비되지 않았습니다.')
      return
    }

    try {
      const files = await selectFiles({
        multiple: false,
        accept: '.svg'
      })

      if (!files || files.length === 0) return

      updateSettings({
        showCutBorder: false,
        showSafeBorder: false,
      })

      setIsLoading(true)
      const file = files[0]
      const fileExtension = file.name.split('.').pop()?.toLowerCase()

      if (fileExtension !== 'svg') {
        console.error('SVG 파일만 지원합니다.')
        setIsLoading(false)
        return
      }

      const templatePlugin = getPlugin<TemplatePlugin>('TemplatePlugin')
      // cutsize는 항상 0으로 지정
      await templatePlugin?.setCutTemplate(file, 0)
      console.log('SVG 템플릿이 추가되었습니다.')
    } catch (e) {
      console.error('SVG 템플릿 추가 오류:', e)
    } finally {
      setIsLoading(false)
    }
  }, [ready, updateSettings, getPlugin])

  // Remove cutline template
  const handleRemoveCutTemplate = useCallback(async () => {
    if (!canvas) return

     
    const cutlineTemplate = canvas.getObjects().find((obj: any) => obj.id === 'cutline-template')
    if (cutlineTemplate) {
      canvas.remove(cutlineTemplate)
    }

    canvas.renderAll()
  }, [canvas])

  // Show more handler
  const showMore = useCallback(() => {
    setContentsBrowser('template')
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
        <div className="flex items-end flex-col gap-2 w-full">
          <Button
            variant="secondary"
            className="w-full h-10"
            onClick={handleUpload}
            disabled={isLoading}
          >
            <UploadSimple className="h-4 w-4 mr-2" />
            {isLoading ? '업로드 중...' : '업로드'}
          </Button>

          {!hasCutlineTemplate ? (
            <Button
              variant="secondary"
              className="w-full h-10"
              onClick={handleUploadCutTemplate}
              disabled={isLoading}
            >
              <UploadSimple className="h-4 w-4 mr-2" />
              칼선 업로드
            </Button>
          ) : (
            <Button
              variant="secondary"
              className="w-full h-10"
              onClick={handleRemoveCutTemplate}
              disabled={isLoading}
            >
              <UploadSimple className="h-4 w-4 mr-2" />
              칼선 제거
            </Button>
          )}
        </div>
      </div>
      <div className="sections flex flex-col overflow-y-auto">
        {isCustomer && (
          <AppSection
            id="app-template-recommended"
            title="추천 콘텐츠"
            onDetail={showMore}
            searchSlot={
              <AppSectionSearch
                searchType={searchType}
                searchKeyword={searchKeyword}
                isSearching={false}
                onSearch={handleSearch}
                onClear={handleClearSearch}
              />
            }
          >
            {!filteredTemplates ? (
              <div className="flex justify-center items-center min-h-[200px]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-editor-accent" />
              </div>
            ) : filteredTemplates.length === 0 ? (
              <div className="px-4 py-8 text-center text-editor-text-muted text-xs">
                {searchKeyword ? '검색 결과가 없습니다.' : '추천 콘텐츠가 없습니다.'}
              </div>
            ) : (
              <div className="w-full grid grid-cols-2 gap-2 px-4">
                {filteredTemplates.map((content, index) => (
                  <div
                    key={index}
                    className="w-full cursor-pointer"
                    onClick={() => addContentToCanvas(content as EditorTemplate)}
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
