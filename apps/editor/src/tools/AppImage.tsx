import { useCallback, useState } from 'react'
import { Upload as UploadSimple } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { useImageStore, useUploaded } from '@/stores/useImageStore'
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer'
import { Button } from '@/components/ui/button'
import { ImageProcessingPlugin, SelectionType } from '@storige/canvas-core'

export default function AppImage() {
  const canvas = useAppStore((state) => state.canvas)
  const getPlugin = useAppStore((state) => state.getPlugin)
  const tapMenu = useAppStore((state) => state.tapMenu)
  const upload = useImageStore((state) => state.upload)
  const uploaded = useUploaded()
  const isCoarsePointer = useIsCoarsePointer()

  const [isLoading, setIsLoading] = useState(false)

  // Handle upload
  const handleUpload = useCallback(async () => {
    if (!canvas) return

    const imagePlugin = getPlugin<ImageProcessingPlugin>('ImageProcessingPlugin')

    setIsLoading(true)

    try {
      await upload(
        canvas,
        imagePlugin!,
        SelectionType.image,
        'image/*,.ai,.eps,.pdf,application/pdf,application/postscript,application/illustrator',
        () => {
          // onVectorStart
          console.log('벡터 이미지 변환 시작...')
        },
        (success) => {
          // onVectorEnd
          if (success) {
            console.log('벡터 변환 완료!')
          } else {
            console.error('벡터 변환 실패')
          }
        }
      )
    } catch (error) {
      console.error('이미지 업로드 오류:', error)
    } finally {
      setIsLoading(false)
    }
  }, [canvas, getPlugin, upload])

  // Add uploaded image to canvas
  const addToCanvas = useCallback(async (image: unknown) => {
    if (!canvas) return

     
    const imgObj = image as any

    canvas.offHistory()

    try {
      const workspace = canvas.getObjects().find((obj: unknown) => (obj as { id?: string }).id === 'workspace')
      if (!workspace) {
        console.error('워크스페이스를 찾을 수 없습니다')
        return
      }

      const workspaceCenter = workspace.getCenterPoint()
      const src = imgObj.getSrc?.() || imgObj._element?.src

      if (src) {
        // core API를 사용하여 이미지 로드 및 캔버스에 추가
        const { core } = await import('@storige/canvas-core')

        await core.addImageFromURL(canvas, src, {
          left: workspaceCenter.x,
          top: workspaceCenter.y,
          originX: 'center',
          originY: 'center',
          scaleX: imgObj.scaleX || 1,
          scaleY: imgObj.scaleY || imgObj.scaleX || 1,
          centerInWorkspace: false,
          setActive: true
        })

        canvas.onHistory()
        canvas.requestRenderAll()

        // 터치 디바이스에서는 객체 추가 직후 사이드바를 닫아 캔버스를 노출.
        if (isCoarsePointer) {
          tapMenu(null)
        }
      }
    } catch (error) {
      console.error('이미지 추가 중 오류:', error)
      canvas.onHistory()
    }
  }, [canvas, isCoarsePointer, tapMenu])

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
      <div className="flex-1 overflow-y-auto">
        {/* My Contents (Uploaded Images) */}
        {uploaded.length > 0 && (
          <div className="px-4 py-3">
            <div className="text-sm font-medium text-editor-text mb-3">나의 콘텐츠</div>
            <div className="grid grid-cols-2 gap-3">
              {uploaded.map((image, index) => (
                <div
                  key={index}
                  className="aspect-square rounded-lg overflow-hidden cursor-pointer bg-editor-surface-low border border-editor-border hover:border-editor-accent hover:scale-105 transition-all"
                  onClick={() => addToCanvas(image)}
                >
                  <img
                    src={(image as { getSrc?: () => string }).getSrc?.() || ''}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
