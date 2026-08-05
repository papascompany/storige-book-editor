import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Upload as UploadSimple, Wand2 } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { useImageStore, useUploaded, useUploadedPhotoMeta } from '@/stores/useImageStore'
import { useExternalPhotosStore } from '@/stores/useExternalPhotosStore'
import { buildPhotoUsageCountMap, photoUsageCount } from '@/utils/photoUsage'
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer'
import { Button } from '@/components/ui/button'
import { ImageProcessingPlugin, SelectionType, core } from '@storige/canvas-core'
import type { ExternalPhoto, PhotoSortMode } from '@storige/types'
import { enrichPhotosWithExif } from '@/utils/photoAutofill'
import { autofillPhotosIntoFrames, hasEmptyFrame, mergeAutofillPhotoInputs } from '@/utils/photoPlacement'
import { showToast } from '@/stores/useToastStore'

// 자동편집 정렬 모드 옵션 (PhotoSortMode 와 동기)
const AUTOFILL_SORT_OPTIONS: { value: PhotoSortMode; label: string }[] = [
  { value: 'date', label: '날짜순' },
  { value: 'filename', label: '파일명순' },
  { value: 'location', label: '장소별' },
  { value: 'random', label: '랜덤' },
]

// S-E4: 사용 횟수 집계 debounce — 이벤트 폭주(자동편집·다중 삭제·undo 복원) 시
// 프레임당 재스캔을 막는다(기술설계 §3.4: ≥300ms).
const USAGE_RECOUNT_DEBOUNCE_MS = 300

/** S-E4: 썸네일 우상단 사용 횟수 배지 — 0이면 렌더하지 않는다(호출부 가드). */
function UsageBadge({ count }: { count: number }) {
  return (
    <span
      className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-semibold flex items-center justify-center leading-none"
      aria-label={`문서에서 ${count}회 사용됨`}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

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

  // Track 2 (D-2): '내 업로드' 자동편집 입력 메타(storage URL 기준) + 페이지(캔버스) 목록.
  const uploadedPhotoMeta = useUploadedPhotoMeta()
  const allCanvas = useAppStore((state) => state.allCanvas)

  const [isLoading, setIsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'external' | 'my'>(hasExternal ? 'external' : 'my')
  const [unusedOnly, setUnusedOnly] = useState(false)
  const [addingUrl, setAddingUrl] = useState<string | null>(null)
  // 포토북 자동편집(Phase 3): 정렬 모드 + 진행 상태
  const [autofillMode, setAutofillMode] = useState<PhotoSortMode>('date')
  const [autofilling, setAutofilling] = useState(false)
  // Track 2 (D-2): 빈 사진틀 존재 재판정 트리거 — 캔버스 객체 추가/삭제 시 증가.
  const [frameTick, setFrameTick] = useState(0)

  // 사진 목록은 세션 로드 후 비동기 적재 — 패널이 먼저 마운트됐어도 기본 탭 전환
  useEffect(() => {
    if (hasExternal) setActiveTab('external')
  }, [hasExternal])

  // S-E4: 캔버스 객체 추가/삭제·undo/redo 시 사용 횟수 재집계 트리거.
  // (구 D1 배선 확장 — 외부주입 전용 → 내 업로드 포함, allCanvas 선택자 구독으로
  //  늦게 뜨는 페이지 재구독, history:undo/redo 직접 구독, 300ms debounce)
  const hasUploads = uploaded.length > 0
  const recountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!hasExternal && !hasUploads) return
    if (allCanvas.length === 0) return
    const handler = () => {
      if (recountTimerRef.current) clearTimeout(recountTimerRef.current)
      recountTimerRef.current = setTimeout(() => {
        recountTimerRef.current = null
        bumpUsage()
      }, USAGE_RECOUNT_DEBOUNCE_MS)
    }
    const events = ['object:added', 'object:removed', 'history:undo', 'history:redo']
    allCanvas.forEach((c: any) => {
      try {
        events.forEach((ev) => c.on(ev, handler))
      } catch { /* noop */ }
    })
    return () => {
      if (recountTimerRef.current) {
        clearTimeout(recountTimerRef.current)
        recountTimerRef.current = null
      }
      allCanvas.forEach((c: any) => {
        try {
          events.forEach((ev) => c.off(ev, handler))
        } catch { /* noop */ }
      })
    }
  }, [hasExternal, hasUploads, allCanvas, bumpUsage])

  // Track 2 (D-2): 빈 사진틀 존재 재판정 배선 — 채움/삭제(fillImage add·frame remove)가
  // object:added/removed 로 관측되므로 그때마다 frameTick 을 올려 노출 조건을 갱신한다.
  // allCanvas 는 zustand 상태(캔버스 등록 시 배열 교체)라 늦게 뜨는 페이지도 재구독된다.
  useEffect(() => {
    if (allCanvas.length === 0) return
    const handler = () => setFrameTick((t) => t + 1)
    allCanvas.forEach((c: any) => {
      try {
        c.on('object:added', handler)
        c.on('object:removed', handler)
      } catch { /* noop */ }
    })
    handler() // 구독 시점 즉시 1회 재판정(세션 로드 직후 프레임 포함 페이지 반영)
    return () => {
      allCanvas.forEach((c: any) => {
        try {
          c.off('object:added', handler)
          c.off('object:removed', handler)
        } catch { /* noop */ }
      })
    }
  }, [allCanvas])

  // Track 2 (D-2): 자동편집 입력 = 외부주입 ∪ 내 업로드 (URL 중복 제거, 외부주입 우선).
  const autofillPhotos = useMemo(
    () => mergeAutofillPhotoInputs(externalPhotos, uploadedPhotoMeta),
    [externalPhotos, uploadedPhotoMeta],
  )

  // Track 2 (D-2): 자동편집 노출 조건 = '빈 사진틀 존재' 런타임 판정.
  // ⚠️ TemplateSetType 게이팅 금지(오너 결정) — frame 없는 상품(BOOK/LEAFLET 일반 셋)에선
  // 이 판정이 false 라 컨트롤이 자연히 숨는다.
  const emptyFrameExists = useMemo(() => {
    const canvases = allCanvas.length > 0 ? allCanvas : canvas ? [canvas] : []
    return hasEmptyFrame(canvases)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCanvas, canvas, frameTick])

  const showAutofill = emptyFrameExists && autofillPhotos.length > 0

  // S-E4: 사용 횟수 맵 — usageTick 변경 시 전 캔버스 1패스 재집계 O(objects).
  // (구 usedMap 은 사진별 재스캔 O(사진×객체) — 300장×50페이지 요건 미달이라 교체)
  const usageCountMap = useMemo(() => {
    if (!hasExternal && !hasUploads) return new Map<string, number>()
    const canvases = allCanvas.length > 0 ? allCanvas : canvas ? [canvas] : []
    return buildPhotoUsageCountMap(canvases)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usageTick, hasExternal, hasUploads, allCanvas, canvas])

  const visiblePhotos = useMemo(
    () =>
      unusedOnly
        ? externalPhotos.filter((p) => photoUsageCount(usageCountMap, [p.url]) === 0)
        : externalPhotos,
    [externalPhotos, unusedOnly, usageCountMap],
  )

  // S-E4: '내 업로드' 필터 — 업로드 객체의 dataURL(src) + storage URL 합산 키.
  const [myUnusedOnly, setMyUnusedOnly] = useState(false)
  const uploadedKeysOf = useCallback((image: unknown): Array<string | undefined> => {
    const imgObj = image as { getSrc?: () => string; storagePhotoUrl?: string }
    let src: string | undefined
    try {
      src = imgObj.getSrc?.()
    } catch {
      src = undefined
    }
    return [src, imgObj.storagePhotoUrl]
  }, [])
  const visibleUploaded = useMemo(
    () =>
      myUnusedOnly
        ? uploaded.filter((image) => photoUsageCount(usageCountMap, uploadedKeysOf(image)) === 0)
        : uploaded,
    [uploaded, myUnusedOnly, usageCountMap, uploadedKeysOf],
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

  // 포토북 자동편집(Phase 3): 정렬 → 빈 사진틀 aspect 매칭 채움 → 저해상도 경고.
  // 배치 엔진(autofillPhotosIntoFrames)에 fillImageIntoFrame(채움) + core.imageFromURL(로드)을
  // 주입한다 — 마스킹/clipPath/frameRef/z-order 는 전부 fillImageIntoFrame 재사용(중복 구현 없음).
  const handleAutofill = useCallback(async () => {
    if (!canvas || autofilling) return
    const imagePlugin = getPlugin<ImageProcessingPlugin>('ImageProcessingPlugin')
    if (!imagePlugin) {
      showToast('이미지 처리 플러그인을 찾을 수 없습니다.', 'error')
      return
    }
    // Track 2 (D-2): 입력 = 외부주입 ∪ 내 업로드(스토어 메타, storage URL 기준).
    if (autofillPhotos.length === 0) {
      showToast('자동편집할 사진이 없습니다.', 'info')
      return
    }

    setAutofilling(true)
    try {
      // 모든 페이지(캔버스)를 대상으로 빈 사진틀을 채운다.
      const allCanvas = useAppStore.getState().allCanvas
      const canvases = allCanvas.length > 0 ? allCanvas : [canvas]

      // EXIF 보강(date/location 정렬 정확도) — 호스트 제공 메타는 존중, 미파싱분만 URL 페치.
      // ('내 업로드'는 등록 시점에 원본 File 로 파싱 완료(exifParsed=true) → 여기서 재페치 없음)
      const enriched = await enrichPhotosWithExif(autofillPhotos)

      const fillImageIntoFrame = useImageStore.getState().fillImageIntoFrame

      const result = await autofillPhotosIntoFrames(canvases, enriched, {
        mode: autofillMode,
        fillFrame: (cv, fore, frame, plugin) =>
          fillImageIntoFrame(cv, fore, frame, plugin as ImageProcessingPlugin),
        loadImage: (url) => core.imageFromURL(url, { crossOrigin: 'anonymous' }),
        imagePlugin,
        onFilled: (cv, frame) => {
          // 프레임=선택단위 — 채운 사진이 아니라 프레임을 활성화(기존 makeFrameInteractive 규약).
          cv.setActiveObject?.(frame)
        },
      })

      // '사용됨' 뱃지 재계산
      bumpUsage()
      canvas.requestRenderAll()

      if (result.filledCount === 0) {
        showToast('채울 빈 사진틀이 없습니다.', 'info')
      } else {
        let msg = `${result.filledCount}개 사진틀을 채웠습니다.`
        if (result.remainingFrames > 0) msg += ` 빈 틀 ${result.remainingFrames}개 남음.`
        if (result.remainingPhotos > 0) msg += ` 사진 ${result.remainingPhotos}장 미배치.`
        showToast(msg, result.lowResWarnings.length > 0 ? 'warning' : 'success')
      }

      // 저해상도 경고 — 임계 미만 사진이 있으면 별도 경고 토스트.
      if (result.lowResWarnings.length > 0) {
        const n = result.lowResWarnings.length
        const minDpi = Math.min(...result.lowResWarnings.map((w) => w.effectiveDpi))
        showToast(
          `사진 ${n}장이 인쇄 권장 해상도(${result.lowResWarnings[0].thresholdDpi}dpi) 미만입니다 (최저 ${minDpi}dpi). 더 큰 사진으로 교체를 권장합니다.`,
          'warning',
          6000,
        )
      }
    } catch (error) {
      console.error('[AppImage] 자동편집 실패:', error)
      showToast('자동편집 중 오류가 발생했습니다.', 'error')
    } finally {
      setAutofilling(false)
    }
  }, [canvas, autofilling, getPlugin, autofillPhotos, autofillMode, bumpUsage])

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

      {/* 포토북 자동편집: 정렬모드 드롭다운 + 실행 버튼.
          Track 2 (D-2): external 탭 전용 → 탭 공통으로 이동. 입력 = 외부주입 ∪ 내 업로드.
          노출 = '빈 사진틀 존재' 런타임 판정(TemplateSetType 게이팅 금지) ∧ 입력 사진 존재. */}
      {showAutofill && (
        <div className="px-4 pt-3 pb-1 flex items-center gap-2">
          <select
            value={autofillMode}
            onChange={(e) => setAutofillMode(e.target.value as PhotoSortMode)}
            disabled={autofilling}
            className="h-8 px-2 text-xs rounded-md border border-editor-border bg-editor-surface text-editor-text focus:outline-none focus:border-editor-accent disabled:opacity-50"
            aria-label="자동편집 정렬 기준"
          >
            {AUTOFILL_SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            className="flex-1 h-8 text-xs"
            onClick={handleAutofill}
            disabled={autofilling}
          >
            <Wand2 className="h-3.5 w-3.5 mr-1.5" />
            {autofilling ? '자동편집 중...' : '사진 자동편집'}
          </Button>
        </div>
      )}

      {hasExternal && activeTab === 'external' ? (
        <>
          <div className="px-4 pt-2 pb-2 flex items-center gap-2">
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
                    // S-E4: '사용됨' 체크 → 사용 횟수 배지로 승격 (0=비표시)
                    const count = photoUsageCount(usageCountMap, [photo.url])
                    return (
                      <div
                        key={photo.url}
                        className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer bg-editor-surface-low border border-editor-border hover:border-editor-accent transition-all ${
                          addingUrl === photo.url ? 'opacity-50' : ''
                        }`}
                        onClick={() => addExternalPhoto(photo)}
                        title={photo.name || ''}
                      >
                        <img
                          src={photo.thumbnailUrl || photo.url}
                          alt={photo.name || ''}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                        {count > 0 && <UsageBadge count={count} />}
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
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-medium text-editor-text">나의 콘텐츠</div>
                  {/* S-E4: 사용/미사용 필터 (공유방 탭과 동일 패턴) */}
                  <div className="flex items-center gap-1.5">
                    <button
                      className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                        !myUnusedOnly
                          ? 'border-editor-accent text-editor-text'
                          : 'border-editor-border text-editor-text-muted'
                      }`}
                      onClick={() => setMyUnusedOnly(false)}
                    >
                      전체
                    </button>
                    <button
                      className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                        myUnusedOnly
                          ? 'border-editor-accent text-editor-text'
                          : 'border-editor-border text-editor-text-muted'
                      }`}
                      onClick={() => setMyUnusedOnly(true)}
                    >
                      안 쓴 사진
                    </button>
                  </div>
                </div>
                {visibleUploaded.length === 0 ? (
                  <p className="text-xs text-editor-text-muted py-6 text-center">
                    모든 사진을 사용했습니다.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {visibleUploaded.map((image, index) => {
                      // S-E4: 문서 내 사용 횟수 배지 (0=비표시)
                      const count = photoUsageCount(usageCountMap, uploadedKeysOf(image))
                      return (
                        <div
                          key={index}
                          className="relative aspect-square rounded-lg overflow-hidden cursor-pointer bg-editor-surface-low border border-editor-border hover:border-editor-accent hover:scale-105 transition-all"
                          onClick={() => addToCanvas(image)}
                        >
                          <img
                            src={(image as { getSrc?: () => string }).getSrc?.() || ''}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                          {count > 0 && <UsageBadge count={count} />}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
