import { useCallback, useEffect, useMemo, useState } from 'react'
import { Upload as UploadSimple, Check } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { useImageStore, useUploaded } from '@/stores/useImageStore'
import { useExternalPhotosStore, isPhotoUsed } from '@/stores/useExternalPhotosStore'
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer'
import { Button } from '@/components/ui/button'
import { ImageProcessingPlugin, SelectionType, core } from '@storige/canvas-core'
import type { ExternalPhoto } from '@storige/types'

export default function AppImage() {
  const canvas = useAppStore((state) => state.canvas)
  const getPlugin = useAppStore((state) => state.getPlugin)
  const tapMenu = useAppStore((state) => state.tapMenu)
  const upload = useImageStore((state) => state.upload)
  const uploaded = useUploaded()
  const isCoarsePointer = useIsCoarsePointer()

  // D1 외부 사진 주입 (EDITOR.md §20.1) — 목록이 있으면 탭 UI 활성
  const externalPhotos = useExternalPhotosStore((s) => s.photos)
  const usageTick = useExternalPhotosStore((s) => s.usageTick)
  const bumpUsage = useExternalPhotosStore((s) => s.bumpUsage)
  const hasExternal = externalPhotos.length > 0

  const [isLoading, setIsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'external' | 'my'>(hasExternal ? 'external' : 'my')
  const [unusedOnly, setUnusedOnly] = useState(false)
  const [addingUrl, setAddingUrl] = useState<string | null>(null)

  // 사진 목록은 세션 로드 후 비동기 적재 — 패널이 먼저 마운트됐어도 기본 탭 전환
  useEffect(() => {
    if (hasExternal) setActiveTab('external')
  }, [hasExternal])

  // 캔버스 객체 추가/삭제 시 '사용됨' 뱃지 재계산 (다른 경로의 삭제·undo 포함)
  useEffect(() => {
    if (!hasExternal) return
    const canvases = useAppStore.getState().allCanvas
    const handler = () => bumpUsage()
    canvases.forEach((c: any) => {
      try {
        c.on('object:added', handler)
        c.on('object:removed', handler)
      } catch { /* noop */ }
    })
    return () => {
      canvases.forEach((c: any) => {
        try {
          c.off('object:added', handler)
          c.off('object:removed', handler)
        } catch { /* noop */ }
      })
    }
  }, [hasExternal, bumpUsage])

  // 사용 여부 맵 — usageTick 변경 시 전체 캔버스 재스캔
  const usedMap = useMemo(() => {
    const map = new Map<string, boolean>()
    if (!hasExternal) return map
    const allCanvas = useAppStore.getState().allCanvas
    externalPhotos.forEach((p) => map.set(p.url, isPhotoUsed(allCanvas, p.url)))
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPhotos, usageTick, hasExternal])

  const visiblePhotos = useMemo(
    () => (unusedOnly ? externalPhotos.filter((p) => !usedMap.get(p.url)) : externalPhotos),
    [externalPhotos, unusedOnly, usedMap],
  )

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

  // D1: 공유방 사진을 현재 캔버스에 추가 (1-tap).
  // 인쇄용 리사이즈본(긴변 3000~4000px)이 워크스페이스보다 크므로 80% 맞춤 스케일.
  const addExternalPhoto = useCallback(async (photo: ExternalPhoto) => {
    if (!canvas || addingUrl) return
    setAddingUrl(photo.url)
    try {
      const img = await core.addImageFromURL(canvas, photo.url, {
        centerInWorkspace: true,
        setActive: true,
        // 출처 URL 보존 — '사용됨' 뱃지 + 저장/재편집 라운드트립 (extendFabricOption 등재)
        externalPhotoUrl: photo.url,
      } as Record<string, unknown>)

      const workspace = core.getWorkspace(canvas)
      if (workspace && img.width && img.height) {
        const wsW = (workspace.width || 0) * (workspace.scaleX || 1)
        const wsH = (workspace.height || 0) * (workspace.scaleY || 1)
        if (wsW > 0 && wsH > 0) {
          const scale = Math.min((wsW * 0.8) / img.width, (wsH * 0.8) / img.height, 1)
          img.set({ scaleX: scale, scaleY: scale })
          img.setCoords()
        }
      }
      canvas.requestRenderAll()
      bumpUsage()

      // 터치 디바이스에서는 추가 직후 사이드바를 닫아 캔버스 노출 (기존 동작과 동일)
      if (isCoarsePointer) {
        tapMenu(null)
      }
    } catch (error) {
      console.error('[AppImage] 공유방 사진 추가 실패:', photo.url, error)
    } finally {
      setAddingUrl(null)
    }
  }, [canvas, addingUrl, bumpUsage, isCoarsePointer, tapMenu])

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
      {/* D1: 외부 사진 주입 시 탭 바 (없으면 기존 UI 그대로) */}
      {hasExternal && (
        <div className="flex border-b border-editor-border">
          <button
            className={`flex-1 py-2.5 text-sm font-medium text-center transition-colors ${
              activeTab === 'external'
                ? 'text-editor-text border-b-2 border-editor-accent'
                : 'text-editor-text-muted'
            }`}
            onClick={() => setActiveTab('external')}
          >
            공유방 사진
            <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-editor-surface-low">
              {externalPhotos.length}
            </span>
          </button>
          <button
            className={`flex-1 py-2.5 text-sm font-medium text-center transition-colors ${
              activeTab === 'my'
                ? 'text-editor-text border-b-2 border-editor-accent'
                : 'text-editor-text-muted'
            }`}
            onClick={() => setActiveTab('my')}
          >
            내 업로드
          </button>
        </div>
      )}

      {hasExternal && activeTab === 'external' ? (
        <>
          <div className="px-4 pt-3 pb-2 flex items-center gap-2">
            <button
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                !unusedOnly
                  ? 'border-editor-accent text-editor-text'
                  : 'border-editor-border text-editor-text-muted'
              }`}
              onClick={() => setUnusedOnly(false)}
            >
              전체
            </button>
            <button
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                unusedOnly
                  ? 'border-editor-accent text-editor-text'
                  : 'border-editor-border text-editor-text-muted'
              }`}
              onClick={() => setUnusedOnly(true)}
            >
              안 쓴 사진
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-2">
              {visiblePhotos.length === 0 ? (
                <p className="text-xs text-editor-text-muted py-6 text-center">
                  {unusedOnly ? '모든 사진을 사용했습니다.' : '공유방 사진이 없습니다.'}
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {visiblePhotos.map((photo) => {
                    const used = usedMap.get(photo.url)
                    return (
                      <div
                        key={photo.url}
                        className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer bg-editor-surface-low border hover:border-editor-accent transition-all ${
                          addingUrl === photo.url ? 'opacity-50' : ''
                        } ${used ? 'border-editor-border' : 'border-editor-border'}`}
                        onClick={() => addExternalPhoto(photo)}
                        title={photo.name || ''}
                      >
                        <img
                          src={photo.thumbnailUrl || photo.url}
                          alt={photo.name || ''}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                        {used && (
                          <span className="absolute top-1 right-1 w-4.5 h-4.5 rounded-full bg-green-600 flex items-center justify-center" style={{ width: 18, height: 18 }}>
                            <Check className="w-3 h-3 text-white" />
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  )
}
