import { useCallback, useState, useEffect } from 'react'
import { Upload as UploadSimple, Trash2 as Trash, Check } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { useImageStore } from '@/stores/useImageStore'
import { useIsCustomer } from '@/stores/useAuthStore'
import { useEditorContents } from '@/hooks/useEditorContents'
import { useLibraryPanel } from '@/hooks/useLibraryPanel'
import { Button } from '@/components/ui/button'
import AppSection from '@/components/AppSection'
import AppSectionSearch from '@/components/AppSectionSearch'
import { ImageProcessingPlugin, SelectionType, parseColorValue, rgbaToHex8 } from '@storige/canvas-core'
import type { EditorContent } from '@/generated/graphql'
import { contentsApi } from '@/api'
import { resolveAssetUrl } from '@/utils/resolveAssetUrl'

// 모바일/터치 환경 감지 — iOS native <input type="color">는 picker dismiss(X 버튼) 시점에
// change 이벤트가 발화되며 사용자가 "적용 UI 없음"으로 혼동. 모바일 안내 + 명시적 "적용" 버튼 노출.
function isTouchEnv(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  try { return window.matchMedia('(pointer: coarse)').matches } catch { return false }
}
const TOUCH_ENV = isTouchEnv()

// Fabric types
 
type FabricObject = any

export default function AppBackground() {
  const canvas = useAppStore((state) => state.canvas)
  const getPlugin = useAppStore((state) => state.getPlugin)
  const setContentsBrowser = useAppStore((state) => state.setContentsBrowser)
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

  // 추천 콘텐츠 데이터 파이프라인 공통화 (P3-b).
  // ⚠️ 배경(library_backgrounds)은 tags 컬럼이 없어 태그칩 필터 불가 → enableTags:false.
  //    대신 이름 검색바를 추가해 다른 패널과 일관성을 맞춘다(enableSearch:true).
  const {
    contents,
    loadingContents,
    searchType,
    searchKeyword,
    handleSearch,
    handleClearSearch,
    hasActiveFilter,
  } = useLibraryPanel({ fetcher: contentsApi.getBackgrounds, enableTags: false })

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

  // 배경색 적용 핵심 로직 — 색상 문자열을 받아 workspace.fill에 즉시 반영.
  //
  // 사용자 보고: React state로 캐싱한 workspace 참조가 stale일 수 있음 (fabric 재초기화,
  // 캔버스 dispose/재생성, 페이지 전환 등으로). 매 호출 시 canvas에서 fresh fetch.
  // 또한 안전 차원에서 모든 workspace 객체에 적용 (preview HMR 중복도 회피).
  const applyBgColor = useCallback((value: string) => {
    if (!canvas) return false
    const targets = canvas.getObjects().filter((obj: FabricObject) =>
      obj.id === 'workspace' || obj.id === 'template-background'
    )
    if (targets.length === 0) return false
    const rgba = parseColorValue(value)
    if (!rgba) return false
    rgba.a = 1
    const rgbaString = `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${rgba.a})`
    targets.forEach((t: FabricObject) => t.set({ fill: rgbaString, dirty: true }))
    canvas.renderAll()
    // workspace state도 동기화 (다음 useEffect 의존성 트리거 위함)
    if (targets[0]) setWorkspace(targets[0])
    return true
  }, [canvas])

  // Handle background color change — input change 이벤트(color picker dismiss 시점)에서 호출
  const onBgColorChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setBgColor(value)
    applyBgColor(value)
  }, [applyBgColor])

  // 명시적 "적용" 버튼 — iOS native color picker가 dismiss를 놓치는 경우 또는
  // 사용자가 텍스트 input으로 hex 직접 입력 후 즉시 적용하고 싶을 때 사용.
  const handleApplyBgColor = useCallback(() => {
    if (applyBgColor(bgColor)) {
      // 시각적 confirm — workspace 업데이트 후 명시적 안내 (모바일 사용자 혼동 방지)
      // showToast 호출은 stores/useToastStore에서 import 필요하지만 BB-Phase 3 외 트랙에서
      // 이미 등록된 useToastStore를 사용. 여기는 silent로 두고 시각적 변화로만 확인.
    }
  }, [applyBgColor, bgColor])

  // 뚜껑색 적용 — 동일 패턴: 매 호출 시 canvas에서 fresh fetch (stale state 회피)
  const applyLidColor = useCallback((value: string) => {
    if (!canvas) return false
    const target = canvas.getObjects().find((obj: FabricObject) => obj.extensionType === 'lid')
    if (!target) return false
    const rgba = parseColorValue(value)
    if (!rgba) return false
    const rgbaString = `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, 1)`
    target.set({ fill: rgbaString, dirty: true })
    canvas.renderAll()
    canvas.fire('object:modified', { target })
    setLidObject(target)
    return true
  }, [canvas])

  // Handle lid color change
  const onLidColorChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setLidColor(value)
    applyLidColor(value)
  }, [applyLidColor])

  const handleApplyLidColor = useCallback(() => {
    applyLidColor(lidColor)
  }, [applyLidColor, lidColor])

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
            id="app-background-image"
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
        <AppSection id="app-background-color" title="배경색">
          <div className="flex flex-col gap-1.5 px-4">
            {/* min-w-0: flex 자식이 부모 폭 안으로 줄어들 수 있게(기본 min-width:auto 회피).
                shrink-0: 적용 버튼이 사이드바 가장자리에서 잘리지 않게 고정 폭 보장. */}
            <div className="flex flex-row gap-2 items-center min-w-0">
              <div className="flex-1 min-w-0 flex items-center gap-2 h-10 px-3 rounded-lg bg-editor-surface-lowest">
                <input
                  type="color"
                  value={bgColor}
                  onChange={onBgColorChange}
                  className="w-8 h-8 shrink-0 rounded cursor-pointer border-0"
                  aria-label="배경색 선택"
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
                  className="flex-1 min-w-0 bg-transparent text-sm text-editor-text outline-none uppercase"
                  aria-label="배경색 hex 코드"
                />
              </div>
              <button
                type="button"
                onClick={handleApplyBgColor}
                className="shrink-0 flex items-center justify-center gap-1 h-10 px-3 rounded-lg bg-editor-accent text-white text-xs font-medium hover:bg-editor-accent-hover transition-colors"
                aria-label="배경색 적용"
                title="현재 색상을 배경에 적용"
              >
                <Check className="h-4 w-4" />
                <span>적용</span>
              </button>
            </div>
            {TOUCH_ENV && (
              <p className="text-[10px] text-editor-text-muted leading-snug px-1">
                팝업에서 색상 선택 후 X(닫기)를 누르면 자동 적용됩니다. 적용이 안 되면 위 "적용" 버튼을 누르세요.
              </p>
            )}
          </div>
        </AppSection>

        {/* Lid Color (if lid object exists) */}
        {lidObject && (
          <AppSection id="app-background-cap" title="뚜껑색 변경">
            <div className="flex flex-col gap-1.5 px-4">
              <div className="flex flex-row gap-2 items-center min-w-0">
                <div className="flex-1 min-w-0 flex items-center gap-2 h-10 px-3 rounded-lg bg-editor-surface-lowest">
                  <input
                    type="color"
                    value={lidColor}
                    onChange={onLidColorChange}
                    className="w-8 h-8 shrink-0 rounded cursor-pointer border-0"
                    aria-label="뚜껑색 선택"
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
                    className="flex-1 min-w-0 bg-transparent text-sm text-editor-text outline-none uppercase"
                    aria-label="뚜껑색 hex 코드"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleApplyLidColor}
                  className="shrink-0 flex items-center justify-center gap-1 h-10 px-3 rounded-lg bg-editor-accent text-white text-xs font-medium hover:bg-editor-accent-hover transition-colors"
                  aria-label="뚜껑색 적용"
                  title="현재 색상을 뚜껑에 적용"
                >
                  <Check className="h-4 w-4" />
                  <span>적용</span>
                </button>
              </div>
              {TOUCH_ENV && (
                <p className="text-[10px] text-editor-text-muted leading-snug px-1">
                  팝업에서 색상 선택 후 X(닫기)를 누르면 자동 적용됩니다.
                </p>
              )}
            </div>
          </AppSection>
        )}

        {/* Recommended Contents — 배경은 tags 컬럼 부재로 태그칩 없이 이름 검색만 제공(P3-b) */}
        {isCustomer && (
        <AppSection
          id="app-background-recommended"
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
          {loadingContents ? (
            <div className="flex justify-center items-center min-h-[160px]">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-editor-accent" />
            </div>
          ) : contents.length === 0 ? (
            <div className="py-8 text-center text-editor-text-muted text-xs">
              {hasActiveFilter ? '검색 결과가 없습니다.' : '추천 콘텐츠가 없습니다.'}
            </div>
          ) : (
            <div className="w-full grid grid-cols-2 gap-2">
              {contents.map((content, index) => {
                const imageUrl = resolveAssetUrl((content as any).imageUrl || content?.image?.image?.url)
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
                          alt={(content as any).name || ''}
                          className="object-contain w-full h-full"
                        />
                      )}
                    </div>
                    <div className="mt-1 px-1 text-left text-xs text-editor-text-muted truncate">
                      {(content as any).name || '이름 없음'}
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
