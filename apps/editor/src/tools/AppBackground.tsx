import { useCallback, useState, useEffect } from 'react'
import { Upload as UploadSimple, Trash2 as Trash } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { useImageStore } from '@/stores/useImageStore'
import { useIsCustomer } from '@/stores/useAuthStore'
import { useEditorContents } from '@/hooks/useEditorContents'
import { Button } from '@/components/ui/button'
import AppSection from '@/components/AppSection'
import { ImageProcessingPlugin, SelectionType, parseColorValue, rgbaToHex8 } from '@storige/canvas-core'
import type { EditorContent } from '@/generated/graphql'

// Fabric types
 
type FabricObject = any

export default function AppBackground() {
  const canvas = useAppStore((state) => state.canvas)
  const getPlugin = useAppStore((state) => state.getPlugin)
  const setContentsBrowser = useAppStore((state) => state.setContentsBrowser)
  const updateObjects = useAppStore((state) => state.updateObjects)
  const upload = useImageStore((state) => state.upload)
  const isCustomer = useIsCustomer()
  const { setupAsset } = useEditorContents()

  const [isLoading, setIsLoading] = useState(false)
  const [workspace, setWorkspace] = useState<FabricObject | null>(null)
  const [bgObject, setBgObject] = useState<FabricObject | null>(null)
  const [lidObject, setLidObject] = useState<FabricObject | null>(null)

  // Background color state
  const [bgColor, setBgColor] = useState('#FFFFFF')
  const [lidColor, setLidColor] = useState('#FFFFFF')

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

  // Compute effective background color
  useEffect(() => {
    if (!workspace?.fill) {
      setBgColor('#FFFFFF')
      return
    }

    const fill = workspace.fill
    if (typeof fill === 'string') {
      const rgba = parseColorValue(fill)
      if (rgba) {
        setBgColor(rgbaToHex8(rgba.r, rgba.g, rgba.b, rgba.a).slice(0, 7))
      }
    }
  }, [workspace?.fill])

  // Compute lid color
  useEffect(() => {
    if (!lidObject?.fill) {
      setLidColor(bgColor)
      return
    }

    const fill = lidObject.fill
    if (typeof fill === 'string') {
      const rgba = parseColorValue(fill)
      if (rgba) {
        setLidColor(rgbaToHex8(rgba.r, rgba.g, rgba.b, rgba.a).slice(0, 7))
      }
    }
  }, [lidObject?.fill, bgColor])

  // Initialize and setup canvas event listeners
  useEffect(() => {
    if (!canvas) return

    // Find workspace and background objects
    const ws = canvas.getObjects().find((obj: FabricObject) =>
      obj.id === 'template-background' || obj.id === 'workspace'
    )
    const bg = canvas.getObjects().find((obj: FabricObject) => obj.extensionType === 'background')
    const lid = canvas.getObjects().find((obj: FabricObject) => obj.extensionType === 'lid')

    setWorkspace(ws || null)
    setBgObject(bg || null)
    setLidObject(lid || null)

    // Event listeners
    const handleObjectAdded = (e: { target?: FabricObject }) => {
      if (e.target?.extensionType === 'background') {
        setBgObject(e.target)
      }
      if (e.target?.id === 'template-background' || e.target?.id === 'workspace') {
        setWorkspace(e.target)
      }
    }

    const handleObjectRemoved = (e: { target?: FabricObject }) => {
      if (e.target?.extensionType === 'background') {
        setBgObject(null)
      }
      if (e.target?.id === 'template-background' || e.target?.id === 'workspace') {
        const newWs = canvas.getObjects().find((obj: FabricObject) =>
          obj.id === 'template-background' || obj.id === 'workspace'
        )
        setWorkspace(newWs || null)
      }
      if (e.target?.extensionType === 'lid') {
        const newLid = canvas.getObjects().find((obj: FabricObject) => obj.extensionType === 'lid')
        setLidObject(newLid || null)
      }
    }

    const handleObjectModified = (e: { target?: FabricObject }) => {
      if (!e.target) return
      if (e.target.extensionType === 'lid') {
        setLidObject(e.target)
      }
    }

    canvas.on('object:added', handleObjectAdded)
    canvas.on('object:removed', handleObjectRemoved)
    canvas.on('object:modified', handleObjectModified)

    return () => {
      canvas.off('object:added', handleObjectAdded)
      canvas.off('object:removed', handleObjectRemoved)
      canvas.off('object:modified', handleObjectModified)
    }
  }, [canvas])

  // Handle upload
  const handleUpload = useCallback(async () => {
    if (!canvas) return

    const imagePlugin = getPlugin<ImageProcessingPlugin>('ImageProcessingPlugin')

    setIsLoading(true)

    try {
      const uploadedImage = await upload(
        canvas,
        imagePlugin!,
        SelectionType.background,
        'image/*,.ai,.eps,.pdf,application/pdf,application/postscript,application/illustrator',
        () => {
          console.log('벡터 이미지 변환 시작...')
        },
        (success) => {
          if (success) {
            console.log('벡터 변환 완료!')
          } else {
            console.error('벡터 변환 실패')
          }
        }
      )

      if (uploadedImage) {
        const bg = canvas.getObjects().find((obj: FabricObject) => obj.extensionType === 'background')
        setBgObject(bg || null)
      }
    } catch (error) {
      console.error('배경 업로드 오류:', error)
    } finally {
      setIsLoading(false)
    }
  }, [canvas, getPlugin, upload])

  // Delete background
  const deleteBg = useCallback(() => {
    if (!canvas || !bgObject) return

    const bg = canvas.getObjects().find((obj: FabricObject) => obj.extensionType === 'background')
    if (bg) {
      canvas.remove(bg)
      canvas.renderAll()
      setBgObject(null)
    }
  }, [canvas, bgObject])

  // Select background
  const selectBg = useCallback(() => {
    if (!canvas || !bgObject) return
    canvas.setActiveObject(bgObject)
    canvas.renderAll()
  }, [canvas, bgObject])

  // Handle background color change
  const onBgColorChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setBgColor(value)

    if (!workspace || !canvas) return

    const rgba = parseColorValue(value)
    if (!rgba) return

    rgba.a = 1
    const rgbaString = `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${rgba.a})`

    workspace.fill = rgbaString
    workspace.dirty = true
    canvas.renderAll()
    updateObjects()
  }, [workspace, canvas, updateObjects])

  // Handle lid color change
  const onLidColorChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setLidColor(value)

    if (!lidObject || !canvas) return

    const rgba = parseColorValue(value)
    if (!rgba) return

    const rgbaString = `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, 1)`
    lidObject.fill = rgbaString
    lidObject.dirty = true
    canvas.renderAll()
    canvas.fire('object:modified', { target: lidObject })
    updateObjects()
  }, [lidObject, canvas, updateObjects])

  // Add content to canvas
  const addContentToCanvas = useCallback(async (content: unknown) => {
    if (!content) return
    try {
      await setupAsset(content as EditorContent, 'background')
    } catch (error) {
      console.error('배경 콘텐츠 추가 오류:', error)
    }
  }, [setupAsset])

  const showMore = useCallback(() => {
    setContentsBrowser('background')
  }, [setContentsBrowser])

  if (!workspace) {
    return (
      <div className="w-full h-full flex flex-col">
        <div className="px-4 pt-4 pb-3">
        </div>
        <div className="flex-1 flex items-center justify-center text-editor-text-muted text-sm">
          워크스페이스를 먼저 설정해주세요.
        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-full flex flex-col">
      <div className="px-4 pt-4 pb-3">
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
      <div className="sections flex flex-col overflow-y-auto">
        {/* Background Image */}
        {bgObject && (
          <AppSection
            title="배경이미지"
            onDelete={deleteBg}
          >
            <div className="px-3">
              <div
                className={`
                  image-box mx-3 p-3 max-h-60 rounded-xl bg-editor-surface-lowest
                  overflow-hidden flex justify-center items-center cursor-pointer
                  border-2 transition-colors
                  ${canvas?.getActiveObject()?.id === bgObject.id
                    ? 'border-editor-accent'
                    : 'border-transparent'
                  }
                `}
                onClick={selectBg}
              >
                <img
                  src={bgObject.getSrc?.() || ''}
                  alt="배경"
                  className="max-h-52 object-contain"
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="w-full mt-2 text-red-500 hover:text-red-600 hover:bg-red-50"
                onClick={deleteBg}
              >
                <Trash className="h-4 w-4 mr-2" />
                배경 삭제
              </Button>
            </div>
          </AppSection>
        )}

        {/* Background Color */}
        <AppSection title="배경색">
          <div className="flex flex-row gap-2 items-center px-4">
            <div className="flex-1 flex items-center gap-2 h-10 px-3 rounded-lg bg-editor-surface-lowest">
              <input
                type="color"
                value={bgColor}
                onChange={onBgColorChange}
                className="w-8 h-8 rounded cursor-pointer border-0"
              />
              <input
                type="text"
                value={bgColor.toUpperCase()}
                onChange={(e) => {
                  const val = e.target.value
                  if (/^#[0-9A-Fa-f]{0,6}$/.test(val)) {
                    setBgColor(val)
                  }
                }}
                onBlur={onBgColorChange as unknown as React.FocusEventHandler<HTMLInputElement>}
                className="flex-1 bg-transparent text-sm text-editor-text outline-none uppercase"
              />
            </div>
          </div>
        </AppSection>

        {/* Lid Color (if lid object exists) */}
        {lidObject && (
          <AppSection title="뚜껑색 변경">
            <div className="flex flex-row gap-2 items-center px-4">
              <div className="flex-1 flex items-center gap-2 h-10 px-3 rounded-lg bg-editor-surface-lowest">
                <input
                  type="color"
                  value={lidColor}
                  onChange={onLidColorChange}
                  className="w-8 h-8 rounded cursor-pointer border-0"
                />
                <input
                  type="text"
                  value={lidColor.toUpperCase()}
                  onChange={(e) => {
                    const val = e.target.value
                    if (/^#[0-9A-Fa-f]{0,6}$/.test(val)) {
                      setLidColor(val)
                    }
                  }}
                  onBlur={onLidColorChange as unknown as React.FocusEventHandler<HTMLInputElement>}
                  className="flex-1 bg-transparent text-sm text-editor-text outline-none uppercase"
                />
              </div>
            </div>
          </AppSection>
        )}

        {/* Recommended Contents */}
        {isCustomer && (
        <AppSection title="추천 콘텐츠" onDetail={showMore}>
          {loadingContents ? (
            <div className="flex justify-center items-center min-h-[200px]">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-editor-accent" />
            </div>
          ) : contents.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-400 text-xs">
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
