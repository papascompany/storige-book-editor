import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import { core, ImageProcessingPlugin, selectFiles, SelectionType } from '@storige/canvas-core'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { storageApi } from '@/api'
import { CUTTING_LINE_CONFIG } from '@/constants/cutting'
import { showToast } from '@/stores/useToastStore'

// Feature flag for image processing (OpenCV) features
const ENABLE_IMAGE_PROCESSING = import.meta.env.VITE_ENABLE_IMAGE_PROCESSING !== 'false'

// 모바일/터치 환경에서는 retina(DPR=3) 캔버스에 대용량 이미지 추가 시 메모리 hit이 매우 큼.
// 4MB 이상 파일은 사전 차단해 iOS Safari 페이지 크래시 방지 (P0-2 사용자 보고 대응).
function isTouchEnv(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  try { return window.matchMedia('(pointer: coarse)').matches } catch { return false }
}
const TOUCH_ENV = isTouchEnv()
const MOBILE_MAX_FILE_BYTES = 4 * 1024 * 1024 // 4MB
const MOBILE_MAX_FILE_LABEL = '4MB'

/**
 * 모바일 환경에서 파일 크기 사전 가드.
 * - 데스크톱: 항상 허용
 * - 모바일: MOBILE_MAX_FILE_BYTES 초과 시 toast 안내 + false 반환 (호출자가 abort)
 */
function checkMobileFileSize(file: File): boolean {
  if (!TOUCH_ENV) return true
  if (file.size <= MOBILE_MAX_FILE_BYTES) return true
  const sizeMb = (file.size / 1024 / 1024).toFixed(1)
  showToast(
    `이미지가 너무 큽니다 (${sizeMb}MB). 모바일에선 ${MOBILE_MAX_FILE_LABEL} 이하만 지원합니다. 갤러리에서 더 작은 파일을 선택해주세요.`,
    'error',
    5000
  )
  return false
}

// Fabric.js 타입 (실제 fabric 타입은 런타임에 로드됨)
// canvas-core API를 통해 fabric 객체를 다루므로 타입만 정의
 
type FabricCanvas = any
 
type FabricObject = any
 
type FabricImage = any


interface LoadingBar {
  start: () => void
  finish: () => void
}

interface ImageState {
  uploading: boolean
  uploaded: FabricObject[]
}

interface ImageActions {
  // 파일 업로드 (ImageProcessingPlugin 필요)
  upload: (
    canvas: FabricCanvas,
    imagePlugin: ImageProcessingPlugin,
    type?: SelectionType,
    accept?: string,
    onVectorStart?: () => void,
    onVectorEnd?: (success: boolean) => void
  ) => Promise<FabricObject | undefined>

  // 간단한 파일 업로드 (ImageProcessingPlugin 불필요, OpenCV 미사용)
  uploadSimple: (
    canvas: FabricCanvas,
    accept?: string
  ) => Promise<FabricObject | undefined>

  // 이미 가지고 있는 File 객체로 업로드 (드래그앤드롭, 클립보드 paste 등)
  uploadFile: (
    canvas: FabricCanvas,
    file: File
  ) => Promise<FabricObject | undefined>

  // 이미지 채우기
  fillImage: (
    canvas: FabricCanvas,
    fore: FabricObject,
    rear: FabricObject,
    imagePlugin: ImageProcessingPlugin
  ) => Promise<FabricObject>

  // 사진틀(프레임)을 인터랙티브하게 만들기: hover "이미지 채우기" 오버레이 + 클릭 시 파일 선택
  makeFrameInteractive: (
    canvas: FabricCanvas,
    frame: FabricObject,
    imagePlugin: ImageProcessingPlugin
  ) => void

  // 사진을 프레임의 투명창 안에만 보이도록 채우기 (inverted clipPath 마스킹)
  fillImageIntoFrame: (
    canvas: FabricCanvas,
    fore: FabricObject,
    frame: FabricObject,
    imagePlugin: ImageProcessingPlugin
  ) => Promise<FabricObject>

  // 빈 사진틀(채워진 사진 없는 frame) 삭제 — 포토북 고유, 무경고 분기
  // 채워진 틀은 삭제하지 않고 false 반환(채워진 틀의 '사진' 삭제 경고는 별도 항목).
  deleteEmptyFrame: (
    canvas: FabricCanvas,
    frame: FabricObject
  ) => boolean

  // 배경 추가
  addBackground: (item: FabricObject, canvas: FabricCanvas) => FabricObject

  // 이미지 세그멘테이션 (배경 제거)
  segmentImage: (
    image: FabricImage,
    canvas: FabricCanvas,
    imagePlugin: ImageProcessingPlugin,
    loadingBar: LoadingBar
  ) => Promise<FabricImage>

  // 모양을 몰드로 설정
  setShapeAsMold: (
    shape: FabricObject,
    canvas: FabricCanvas
  ) => Promise<FabricObject | undefined>
}

// 벡터 파일 업로드 (REST API 사용)
const uploadVector = async (file: File): Promise<string> => {
  try {
    // storageApi를 사용하여 파일 업로드
    const result = await storageApi.uploadFile(file, 'uploads')

    if (!result.success || !result.data) {
      throw new Error(result.error?.message || '벡터 파일 업로드 실패')
    }

    return result.data.url
  } catch (error) {
    console.error('vector 업로드 오류:', error)
    throw new Error('vector 업로드에 실패했습니다')
  }
}

export const useImageStore = create<ImageState & ImageActions>()((set, get) => ({
  // 초기 상태
  uploading: false,
  uploaded: [],

  // 배경 추가
  addBackground: (item: FabricObject, canvas: FabricCanvas): FabricObject => {
    const workspace = canvas.getObjects().find((obj: FabricObject) => obj.id === 'workspace')
    if (!workspace) {
      return item
    }

    const prev = canvas.getObjects().find((obj: FabricObject) => obj.extensionType === 'background')
    if (prev) {
      canvas.remove(prev)
    }

    const fitSide = workspace.width! / item.width! > workspace.height! / item.height!
    const scale = fitSide ? workspace.width! / item.width! : workspace.height! / item.height!

    item.set({
      left: workspace.left,
      top: workspace.top,
      originX: 'center',
      originY: 'center'
    })
    item.set({
      id: uuid(),
      scaleX: scale,
      scaleY: scale,
      hasControls: false,
      selectable: true,
      lockMovementX: fitSide,
      lockMovementY: !fitSide,
      name: '배경',
      extensionType: 'background'
    })

    return item
  },

  // 간단한 파일 업로드 (ImageProcessingPlugin 불필요)
  uploadSimple: async (
    canvas: FabricCanvas,
    accept: string = 'image/*'
  ): Promise<FabricObject | undefined> => {
    const { uploading, uploaded } = get()

    if (uploading) {
      console.log('Already uploading, please wait')
      return undefined
    }

    try {
      set({ uploading: true })

      const workspace = canvas.getObjects().find((obj: FabricObject) => obj.id === 'workspace')

      if (!workspace) {
        alert('workspace를 등록해 주세요')
        return undefined
      }

      const files = await selectFiles({
        accept: accept,
        multiple: false
      })

      if (!files || files.length === 0) {
        console.log('No file selected')
        return undefined
      }

      const file = files[0]

      // 벡터 파일은 지원하지 않음 (ImageProcessingPlugin 필요)
      const fileExtension = file.name.split('.').pop()?.toLowerCase()
      const isVectorFile = ['ai', 'eps', 'pdf'].includes(fileExtension || '')

      if (isVectorFile) {
        alert('벡터 파일 업로드는 이미지 처리 기능이 활성화된 경우에만 사용할 수 있습니다.')
        return undefined
      }

      // 모바일 메모리 가드 — 4MB 초과 차단 (P0-2 사용자 보고: iOS Safari 크래시)
      if (!checkMobileFileSize(file)) return undefined

      // 간단한 이미지 로드 (OpenCV 미사용)
      const item = await core.fileToImageSimple(canvas, file)

      if (item) {
        // workspace 크기 계산
        const workspaceWidth = workspace.width! * workspace.scaleX!
        const workspaceHeight = workspace.height! * workspace.scaleY!
        const workspaceCenter = workspace.getCenterPoint()

        // canvas setting이 mm인 경우 스케일 보정
        const scale = canvas.unitOptions?.unit === 'mm' ? (canvas.unitOptions.dpi || 150) / 72 : 1

        // 일반 이미지
        item.set({
          originX: 'center',
          originY: 'center',
          left: workspaceCenter.x,
          top: workspaceCenter.y
        })

        const actualItemWidth = item.width! * scale
        const actualItemHeight = item.height! * scale

        if (actualItemWidth > workspaceWidth || actualItemHeight > workspaceHeight) {
          const scaleX = workspaceWidth / actualItemWidth
          const scaleY = workspaceHeight / actualItemHeight
          const itemScale = Math.min(scaleX, scaleY)
          item.scale(itemScale * scale)
        } else {
          item.scale(scale)
        }

        canvas.add(item)
        canvas.setActiveObject(item)

        set({ uploaded: [...uploaded, item] })
        return item
      }

      return undefined
    } catch (e) {
      console.log(e)
      throw e
    } finally {
      set({ uploading: false })
    }
  },

  // 이미 가지고 있는 File로 업로드 (드래그앤드롭 등)
  // uploadSimple과 동일한 로직이지만 file picker 단계 생략
  uploadFile: async (
    canvas: FabricCanvas,
    file: File
  ): Promise<FabricObject | undefined> => {
    const { uploading, uploaded } = get()
    if (uploading) return undefined

    try {
      set({ uploading: true })
      const workspace = canvas.getObjects().find((obj: FabricObject) => obj.id === 'workspace')
      if (!workspace) return undefined

      // 벡터 파일은 지원 안 함 (uploadSimple과 동일)
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (['ai', 'eps', 'pdf'].includes(ext || '')) return undefined

      // 모바일 메모리 가드
      if (!checkMobileFileSize(file)) return undefined

      const item = await core.fileToImageSimple(canvas, file)
      if (!item) return undefined

      const workspaceWidth = workspace.width! * workspace.scaleX!
      const workspaceHeight = workspace.height! * workspace.scaleY!
      const workspaceCenter = workspace.getCenterPoint()
      const scale = canvas.unitOptions?.unit === 'mm' ? (canvas.unitOptions.dpi || 150) / 72 : 1

      item.set({
        originX: 'center',
        originY: 'center',
        left: workspaceCenter.x,
        top: workspaceCenter.y,
      })

      const actualW = item.width! * scale
      const actualH = item.height! * scale
      if (actualW > workspaceWidth || actualH > workspaceHeight) {
        const sx = workspaceWidth / actualW
        const sy = workspaceHeight / actualH
        item.scale(Math.min(sx, sy) * scale)
      } else {
        item.scale(scale)
      }

      canvas.add(item)
      canvas.setActiveObject(item)
      set({ uploaded: [...uploaded, item] })
      return item
    } catch (e) {
      console.error('[useImageStore.uploadFile]', e)
      return undefined
    } finally {
      set({ uploading: false })
    }
  },

  // 파일 업로드 (ImageProcessingPlugin 필요)
  upload: async (
    canvas: FabricCanvas,
    imagePlugin: ImageProcessingPlugin,
    type?: SelectionType,
    accept: string = 'image/*',
    onVectorStart?: () => void,
    onVectorEnd?: (success: boolean) => void
  ): Promise<FabricObject | undefined> => {
    const { uploading, uploaded, addBackground, fillImage } = get()

    if (uploading) {
      console.log('Already uploading, please wait')
      return undefined
    }

    try {
      set({ uploading: true })

      const workspace = canvas.getObjects().find((obj: FabricObject) => obj.id === 'workspace')

      if (!workspace) {
        alert('workspace를 등록해 주세요')
        return undefined
      }

      const files = await selectFiles({
        accept: accept,
        multiple: false
      })

      if (!files || files.length === 0) {
        console.log('No file selected')
        return undefined
      }

      const file = files[0]

      // 모바일 메모리 가드 — 4MB 초과 차단 (P0-2 사용자 보고: iOS Safari 크래시)
      if (!checkMobileFileSize(file)) return undefined

      let item: FabricObject | undefined

      // 파일 타입 체크
      const fileExtension = file.name.split('.').pop()?.toLowerCase()
      const isVectorFile = ['ai', 'eps', 'pdf'].includes(fileExtension || '')
      // SVG는 fabric.Image로 처리 불가 (loadImage indexOf TypeError 유발).
      // SelectionType.shape에서 SVG는 loadSVGFromURL로 별도 로드.
      const isSvgFile = file.type === 'image/svg+xml' || fileExtension === 'svg'

      if (isVectorFile) {
        if (onVectorStart) {
          onVectorStart()
        }

        try {
          const url = await uploadVector(file)
          const response = await fetch(url)
          const blob = await response.blob()
          const uploadedFile = new File([blob], file.name, { type: 'image/png' })
          item = await core.fileToImage(canvas, uploadedFile, imagePlugin)

          if (onVectorEnd) {
            onVectorEnd(true)
          }
        } catch (error) {
          if (onVectorEnd) {
            onVectorEnd(false)
          }
          throw error
        }
      } else if (isSvgFile) {
        // SVG는 모든 SelectionType에서 fabric.Image.fromURL이 indexOf throw 유발.
        // 항상 loadSVGFromURL로 vector 그대로 로드 (image/background/shape/frame 무관).
        try {
          const dataUrl = await core.fileToURL(file)
          const svgItem = await core.loadSVGFromURL(dataUrl)
          if (svgItem) {
            item = svgItem as FabricObject
          }
        } catch (error) {
          console.error('SVG 로드 실패:', error)
          showToast('SVG 파일 로드에 실패했습니다.', 'error', 4000)
          return undefined
        }
      } else {
        item = await core.fileToImage(canvas, file, imagePlugin)
      }

      if (item) {
        // workspace 크기 계산
        const workspaceWidth = workspace.width! * workspace.scaleX!
        const workspaceHeight = workspace.height! * workspace.scaleY!
        const workspaceCenter = workspace.getCenterPoint()

        // canvas setting이 mm인 경우 스케일 보정
        const scale = canvas.unitOptions.unit === 'mm' ? (canvas.unitOptions.dpi || 150) / 72 : 1

        if (type === SelectionType.frame) {
          // 프레임 처리
          canvas.clipPath = undefined
          canvas.clear()

          item.set({
            id: 'workspace',
            name: '배경 프레임',
            lockMovementX: true,
            lockMovementY: true,
            hasControls: false,
            hasBorders: false,
            extensionType: 'frame',
            scaleX: 1,
            absolutePositioned: true,
            scaleY: 1,
            fill: '#fff',
            hoverCursor: 'pointer',
            moveCursor: 'pointer',
            editable: false
          })

          // core API를 사용하여 fabric 객체 생성
          const rect = core.createRect({
            id: uuid(),
            width: (item.width || 0) + 100,
            height: (item.height || 0) + 100,
            fill: '#000',
            opacity: 0.5,
            originX: 'center',
            originY: 'center',
            left: item.left,
            top: item.top,
            selectable: false,
            hasControls: false,
            absolutePositioned: true,
            clipPath: item,
            evented: false
          })

          const text = core.createText('이미지 채우기', {
            fill: '#fff',
            fontSize: (item.width || 100) / 2 / 5,
            originX: 'center',
            originY: 'center',
            left: item.left,
            top: item.top,
            selectable: false,
            hasControls: false,
            absolutePositioned: true,
            evented: false
          })

          const group = core.createGroup([rect, text], {
            id: uuid(),
            evented: false,
            selectable: false,
            hasControls: false,
            editable: false,
            extensionType: 'overlay'
          })

          item.on('mouseover', () => {
            const hasFilled = canvas.getObjects().some((obj: FabricObject) => obj.clipPath?.id === item?.id)

            if (!hasFilled && !(group as FabricObject).added) {
              canvas.add(group)
              ;(group as FabricObject).added = true
              canvas.renderAll()
            }
          })

          item.on('mouseout', () => {
            if ((group as FabricObject).added) {
              canvas.remove(group)
              ;(group as FabricObject).added = false
              canvas.renderAll()
            }
          })

          item.on('mousedown', async () => {
            const filledImage = canvas
              .getObjects()
              .filter((obj: FabricObject) => obj.clipPath?.id === item?.id && obj.extensionType !== 'overlay')![0]

            if (filledImage) {
              return
            }

            const selectedFiles = await selectFiles({ accept: 'image/*', multiple: false })
            if (!selectedFiles || selectedFiles.length === 0) {
              return null
            }
            const selectedFile = selectedFiles[0]
            const fabricImage = await core.fileToImage(canvas, selectedFile, imagePlugin)
            if (!fabricImage) {
              console.log('no image selected')
              return
            }

            const fore = await fillImage(canvas, fabricImage, item, imagePlugin)
            canvas.add(fore)
            canvas.setActiveObject(fore)
            canvas.renderAll()
          })
        } else if (type === SelectionType.background) {
          item = addBackground(item, canvas)
        } else if (type === SelectionType.shape) {
          // SVG/raster 모두 위에서 item이 이미 로드 완료. 여기선 위치/크기/extensionType만.
          item.set({
            id: uuid(),
            originX: 'center',
            originY: 'center',
            left: workspaceCenter.x,
            top: workspaceCenter.y,
            extensionType: 'shape',
          })

          const actualItemWidth = item.width! * scale
          const actualItemHeight = item.height! * scale

          if (actualItemWidth > workspaceWidth || actualItemHeight > workspaceHeight) {
            const scaleX = workspaceWidth / actualItemWidth
            const scaleY = workspaceHeight / actualItemHeight
            const itemScale = Math.min(scaleX, scaleY)
            item.scale(itemScale * scale)
          } else {
            item.scale(scale)
          }
        } else {
          // 일반 이미지
          item.set({
            originX: 'center',
            originY: 'center',
            left: workspaceCenter.x,
            top: workspaceCenter.y
          })

          const actualItemWidth = item.width! * scale
          const actualItemHeight = item.height! * scale

          if (actualItemWidth > workspaceWidth || actualItemHeight > workspaceHeight) {
            const scaleX = workspaceWidth / actualItemWidth
            const scaleY = workspaceHeight / actualItemHeight
            const itemScale = Math.min(scaleX, scaleY)
            item.scale(itemScale * scale)
          } else {
            item.scale(scale)
          }
        }

        canvas.add(item)
        canvas.setActiveObject(item)

        if (type === SelectionType.image) {
          set({ uploaded: [...uploaded, item] })
        }
        return item
      }

      return undefined
    } catch (e) {
      console.log(e)
      throw e
    } finally {
      set({ uploading: false })
    }
  },

  // 이미지 채우기
  fillImage: async (
    _canvas: FabricCanvas,
    fore: FabricObject,
    rear: FabricObject,
    imagePlugin: ImageProcessingPlugin
  ): Promise<FabricObject> => {
    const centerOf = rear.getCenterPoint()

    let rearClip: FabricObject

    // SVG 요소인 경우 그냥 복제, 아닌 경우 pathData 생성
    if (['path', 'polygon', 'polyline', 'rect', 'circle', 'ellipse', 'triangle'].includes(rear.type)) {
      rearClip = await new Promise<FabricObject>((resolve) => {
        rear.clone((cloned: FabricObject) => {
          cloned.set({
            id: `${rear.id}_rearClip`,
            fill: 'white',
            stroke: 'transparent',
            strokeUniform: true,
            originX: 'center',
            originY: 'center',
            left: centerOf.x,
            top: centerOf.y,
            absolutePositioned: true,
          })
          resolve(cloned)
        })
      })
    } else {
      const rearObjectPath = await imagePlugin.getObjectPath(rear)
      // core API를 사용하여 Path 생성
      rearClip = core.createPath(rearObjectPath?.path, {
        id: `${rear.id}_rearPath`,
        fill: 'white',
        stroke: 'transparent',
        strokeUniform: true,
        originX: 'center',
        originY: 'center',
        left: centerOf.x,
        top: centerOf.y,
        angle: rear.angle,
        absolutePositioned: true,
      })
    }

    // 사진틀(extensionType==='frame')에 채운 사진은 기본 모드에서 비선택(클릭이 프레임을 잡게).
    // FrameInteractionPlugin 더블클릭(adjust) 진입 시에만 evented 를 켠다. 모양틀(mold/clipart)
    // 등 비-frame 채우기는 기존 동작(사진 직접 선택)을 유지해 회귀를 막는다.
    const asFrame = rear.extensionType === 'frame'

    fore.set({
      extensionType: 'fillImage',
      left: centerOf.x,
      top: centerOf.y,
      originX: 'center',
      originY: 'center',
      hasControls: true,
      // 프레임 채우기: 비선택(프레임=선택단위). 모양틀: 선택 가능(기존 동작).
      selectable: !asFrame,
      evented: !asFrame,
      scaleX: (rear.width! * rear.scaleX!) / fore.width!,
      scaleY: (rear.width! * rear.scaleX!) / fore.width!,
      id: rear.id + '_fillImage',
      // 프레임↔사진 링크 (vector/SVG 프레임 경로). frameRef = makeFrameInteractive.isFilled()
      // 중복채움 가드, parentLayerId = ObjectPlugin 삭제 동반제거·z-order 동기화 키.
      // 둘 다 extendFabricOption 화이트리스트라 저장/복원에 보존된다. (image 분기는
      // fillImageIntoFrame 가 동일하게 설정.)
      frameRef: rear.id,
      parentLayerId: rear.id,
      clipPath: rearClip
    })
    fore.setCoords()
    rear.fillImage = fore.id

    // z-order 보정: SVG 프레임도 image 경로(fillImageIntoFrame)와 통일해 프레임을 위로.
    // (모양틀은 기존 스택 유지를 위해 건드리지 않음)
    if (asFrame) rear.bringToFront()

    return fore
  },

  // 사진틀(프레임)을 인터랙티브하게 만들기
  // - hover 시 "이미지 채우기" 오버레이를 프레임 위에 표시
  // - 클릭(mousedown) 시 파일 선택 → 선택한 사진을 프레임 투명창에 마스킹하여 채움
  // 테스트용 경로(useImageStore.upload 의 SelectionType.frame 블록)와 같은 UX 패턴을
  // 공유하되, 마스킹 방식은 inverted clipPath(투명창 표시)로 통일한다.
  makeFrameInteractive: (
    canvas: FabricCanvas,
    frame: FabricObject,
    imagePlugin: ImageProcessingPlugin
  ): void => {
    // 중복 바인딩 방지 (afterLoad 재바인딩 등에서 다시 호출될 수 있음)
    if (frame._frameInteractiveBound) return
    frame._frameInteractiveBound = true

    const isFilled = () =>
      canvas
        .getObjects()
        .some((obj: FabricObject) => obj.frameRef === frame.id && obj.extensionType !== 'overlay')

    // 이 프레임에 채워진 사진(fillImage) 찾기 — frameRef/parentLayerId 규약(FrameInteractionPlugin·
    // ObjectPlugin.del 과 동일). 드롭 오버라이드 스왑·빈틀삭제 가드에서 공유.
    const findFilledImage = (): FabricObject | undefined =>
      canvas
        .getObjects()
        .find(
          (obj: FabricObject) =>
            obj.extensionType === 'fillImage' && obj.parentLayerId === frame.id
        )

    // 채워진 사진을 캔버스에서 제거 — ObjectPlugin.del(:309-310) 과 동일하게
    // clipPath 해제 후 remove (clipPath 잔존 시 렌더 누수/마스크 오염 방지).
    const removeFilledImage = (filled: FabricObject) => {
      filled.clipPath = undefined
      canvas.remove(filled)
      frame.fillImage = null
    }

    // hover 오버레이는 매 hover 시 즉석 생성/제거 (프레임의 현재 위치/크기에 맞춤)
    let overlay: FabricObject | null = null

    const removeOverlay = () => {
      if (overlay) {
        canvas.remove(overlay)
        overlay = null
        canvas.requestRenderAll()
      }
    }

    frame.set({ hoverCursor: 'pointer', moveCursor: 'pointer' })

    // B1 (2026-07-04): 내용편집 잠금 — contentEditable===false 프레임은 고객(비-editMode)의
    // 채우기/교체 진입 차단. 관리자(editMode)는 자유 편집(다른 잠금 축과 동일 규약).
    const isContentLocked = () =>
      frame.contentEditable === false &&
      !useSettingsStore.getState().currentSettings.editMode

    frame.on('mouseover', () => {
      if (overlay || isFilled() || isContentLocked()) return
      const center = frame.getCenterPoint()
      const w = frame.width! * frame.scaleX!
      const h = frame.height! * frame.scaleY!

      const rect = core.createRect({
        id: uuid(),
        width: w,
        height: h,
        fill: '#000',
        opacity: 0.5,
        originX: 'center',
        originY: 'center',
        left: center.x,
        top: center.y,
        angle: frame.angle,
        selectable: false,
        hasControls: false,
        evented: false
      })

      const text = core.createText('이미지 채우기', {
        fill: '#fff',
        fontSize: Math.max(12, Math.min(w, h) / 10),
        originX: 'center',
        originY: 'center',
        left: center.x,
        top: center.y,
        angle: frame.angle,
        selectable: false,
        hasControls: false,
        evented: false
      })

      overlay = core.createGroup([rect, text], {
        id: uuid(),
        evented: false,
        selectable: false,
        hasControls: false,
        editable: false,
        excludeFromExport: true,
        extensionType: 'overlay'
      })
      canvas.add(overlay)
      overlay.bringToFront()
      canvas.requestRenderAll()
    })

    frame.on('mouseout', removeOverlay)

    frame.on('mousedown', async () => {
      // B1: 내용편집 잠금 프레임은 채우기/스왑 진입 차단(비-editMode).
      if (isContentLocked()) return
      // 드롭 오버라이드 스왑(포토북 고유): 이미 채워진 틀에 새 사진을 떨어뜨리면
      // early-return 으로 차단하지 않고 기존 사진을 교체한다. 새 파일을 먼저 받은 뒤
      // (취소 시 기존 사진 보존) 기존 fillImage 를 제거하고 동일한 fillImageIntoFrame
      // 경로로 다시 채워 마스킹(inverted clipPath)·frameRef/parentLayerId·z-order 보정을
      // 그대로 재사용한다(중복 구현 없음).
      const selectedFiles = await selectFiles({ accept: 'image/*', multiple: false })
      if (!selectedFiles || selectedFiles.length === 0) return
      const selectedFile = selectedFiles[0]
      if (!checkMobileFileSize(selectedFile)) return

      const fabricImage = await core.fileToImage(canvas, selectedFile, imagePlugin)
      if (!fabricImage) {
        console.log('no image selected')
        return
      }

      // 새 이미지 로드 성공 후에만 기존 사진을 치운다(로드 실패 시 기존 채움 유지).
      const existing = findFilledImage()
      if (existing) removeFilledImage(existing)

      removeOverlay()
      const fore = await get().fillImageIntoFrame(canvas, fabricImage, frame, imagePlugin)
      canvas.add(fore)
      // 프레임=선택단위: 채우기 후엔 사진이 아니라 프레임을 선택한다(사진은 비evented).
      // 사진 위치 조정은 프레임 더블클릭(FrameInteractionPlugin adjust 모드)으로.
      canvas.setActiveObject(frame)
      canvas.requestRenderAll()
    })
  },

  // 사진을 프레임의 투명창 안에만 보이도록 채우기 (inverted clipPath 마스킹)
  // - image 타입 프레임(PNG 사진틀/액자/말풍선): 프레임 이미지를 복제하여 inverted clipPath 로 사용.
  //   프레임이 투명한 영역(=창)에서만 사진이 보이고, 불투명한 영역에선 가려진다.
  // - 비-image 프레임(vector/shape/mold): 기존 fillImage(외곽선 path clip) 동작을 유지하여
  //   몰드/테스트용 path 경로가 변하지 않게 한다.
  fillImageIntoFrame: async (
    canvas: FabricCanvas,
    fore: FabricObject,
    frame: FabricObject,
    imagePlugin: ImageProcessingPlugin
  ): Promise<FabricObject> => {
    // image 가 아닌 프레임은 기존 외곽선 clip 방식으로 위임 (몰드/벡터 호환 유지)
    if (frame.type !== 'image') {
      return get().fillImage(canvas, fore, frame, imagePlugin)
    }

    const centerOf = frame.getCenterPoint()

    // 프레임 이미지를 복제해 alpha 마스크로 사용.
    // inverted:true → 프레임이 "투명한" 곳에서 사진이 보이고, "불투명한" 곳에서 가려진다.
    // absolutePositioned:true → clipPath 가 사진의 로컬 좌표가 아니라 캔버스 절대좌표에 고정,
    //   화면상의 프레임과 정확히 같은 위치/크기/각도로 마스킹된다.
    const frameClip: FabricObject = await new Promise<FabricObject>((resolve) => {
      frame.clone((cloned: FabricObject) => {
        cloned.set({
          id: `${frame.id}_frameClip`,
          originX: 'center',
          originY: 'center',
          left: centerOf.x,
          top: centerOf.y,
          scaleX: frame.scaleX,
          scaleY: frame.scaleY,
          angle: frame.angle,
          flipX: frame.flipX,
          flipY: frame.flipY,
          absolutePositioned: true,
          inverted: true,
          selectable: false,
          evented: false
        })
        resolve(cloned)
      })
    })

    // 사진이 프레임 창 전체를 덮도록 스케일링 (가로/세로 중 큰 비율로 cover)
    const frameW = frame.width! * frame.scaleX!
    const frameH = frame.height! * frame.scaleY!
    const coverScale = Math.max(frameW / fore.width!, frameH / fore.height!)

    fore.set({
      extensionType: 'fillImage',
      left: centerOf.x,
      top: centerOf.y,
      originX: 'center',
      originY: 'center',
      hasControls: true,
      // 프레임=선택단위: 채운 사진은 기본 모드에서 비선택(클릭이 프레임을 잡게).
      // FrameInteractionPlugin 더블클릭(adjust)에서만 evented 를 켠다.
      selectable: false,
      evented: false,
      scaleX: coverScale,
      scaleY: coverScale,
      id: `${frame.id}_fillImage`,
      frameRef: frame.id,
      // ObjectPlugin 삭제 동반제거·z-order 동기화 키 (frameRef 만으론 불충분 — 매칭 기준이 parentLayerId).
      parentLayerId: frame.id,
      clipPath: frameClip
    })
    fore.setCoords()
    frame.fillImage = fore.id

    // 프레임을 사진 위로 올려 프레임 테두리/장식이 사진을 덮도록 z-order 보정.
    // (사진은 위 add 호출 직후 맨 위에 놓이므로 프레임을 다시 최상단으로)
    frame.bringToFront()

    return fore
  },

  // 빈 사진틀 삭제 (포토북 고유)
  // - 채워진 사진이 없는(frameRef/parentLayerId 매칭 fillImage 부재) 사진틀만 무경고로 즉시 삭제.
  //   (설계: 빈틀 무경고 분기 = 포토북 고유. 채워진 틀의 '사진' 삭제 경고는 별도 항목.)
  // - 채워진 틀이면 아무 것도 하지 않고 false 반환(여기서 사진 삭제/경고를 다루지 않음).
  // - 삭제 시 hover 오버레이가 남지 않도록 잔여 overlay 도 정리한다.
  deleteEmptyFrame: (
    canvas: FabricCanvas,
    frame: FabricObject
  ): boolean => {
    if (!frame || frame.extensionType !== 'frame') return false

    // 채워진 사진 존재 여부 — fillImage 채우기 규약(frameRef/parentLayerId)과 동일 기준.
    const hasFilled = canvas
      .getObjects()
      .some(
        (obj: FabricObject) =>
          obj.extensionType === 'fillImage' &&
          (obj.parentLayerId === frame.id || obj.frameRef === frame.id)
      )
    if (hasFilled) return false

    // hover "이미지 채우기" 오버레이는 frame.mouseout(=삭제 시 포인터 이탈) 에서 removeOverlay 로
    // 정리되고 excludeFromExport:true 라 출력에도 무영향이므로 여기서 별도 제거하지 않는다
    // (overlay 는 hover 싱글톤이라 전역 제거 시 타 프레임 오버레이 오염 위험 → 비파괴 유지).
    frame.clipPath = undefined
    canvas.remove(frame)
    canvas.requestRenderAll()
    return true
  },

  // 이미지 세그멘테이션 (배경 제거)
  segmentImage: async (
    image: FabricImage,
    canvas: FabricCanvas,
    imagePlugin: ImageProcessingPlugin,
    loadingBar: LoadingBar
  ): Promise<FabricImage> => {
    if (!image) {
      throw new Error('이미지가 없습니다')
    }

    loadingBar.start()
    canvas.offHistory()

     
    const hasRemoved = imagePlugin.tellHasAlpha(image.getElement() as any)

    if (hasRemoved) {
      alert('배경이 제거된 이미지 입니다.')
      loadingBar.finish()
      throw new Error('배경이 이미 제거된 이미지입니다')
    }
    const segmented = await imagePlugin.getForeground(image)

    if (!segmented) {
      console.error('No item')
      loadingBar.finish()
      throw new Error('No item')
    }

    const imageURLResult = imagePlugin.processImage(segmented.getElement() as HTMLImageElement)
    // processImage가 Promise<string>인 경우 await로 풀어줌
    const imageURL = typeof (imageURLResult as any)?.then === 'function'
      ? await (imageURLResult as Promise<string>)
      : (imageURLResult as unknown as string)
    const center = image.getCenterPoint()

    // core API를 사용하여 이미지 로드
    const img = await core.imageFromURL(imageURL, {
      id: uuid(),
      selectable: false,
      evented: false,
      hasControls: false,
      originX: 'center',
      originY: 'center',
      left: center.x,
      top: center.y,
    })

    canvas.onHistory()
    loadingBar.finish()
    return img
  },

  // 모양을 몰드로 설정
  setShapeAsMold: async (
    shape: FabricObject,
    canvas: FabricCanvas
  ): Promise<FabricObject | undefined> => {
    if (!shape) return undefined

    // 기존에 설정된 모양틀이면 해제
    if (shape.isMold || shape.hasMolding) {
      // 기존 + 아이콘 제거
      const existingIcon = canvas.getObjects().find((obj: FabricObject) =>
        obj.extensionType === 'moldIcon' && obj.id === `${shape.id}_moldIcon`
      )
      if (existingIcon) {
        canvas.remove(existingIcon)
      }

      // 기존 칼선 제거
      const existingOutline = canvas.getObjects().find((obj: FabricObject) =>
        obj.extensionType === 'outline' && obj.id === `${shape.id}_outline`
      )
      if (existingOutline) {
        canvas.remove(existingOutline)
      }

      // 이벤트 제거
      shape.off('mousedown')
      shape.off('mouseup')
      shape.off('moving')
      shape.isMold = false
      shape.hasMolding = false
      shape.hasCutting = false
      shape.extensionType = 'shape'
      canvas.renderAll()
      return shape
    }

    // 모양틀로 설정
    shape.set({
      extensionType: 'mold',
      hoverCursor: 'pointer',
      moveCursor: 'pointer',
      isMold: true,
      hasMolding: true
    })

    // 자동으로 칼선 생성
    const appStore = useAppStore.getState()
    const imagePlugin = appStore.getPlugin('ImageProcessingPlugin') as ImageProcessingPlugin
    if (!imagePlugin) {
      console.error('ImageProcessingPlugin을 찾을 수 없습니다')
      return shape
    }

    try {
      const { fillColor, strokeColor, strokeWidth, multiplier } = CUTTING_LINE_CONFIG

      const outline = await imagePlugin.createOffsetPathFromShape(shape, {
        fillColor: fillColor,
        includeStroke: false,
        stroke: strokeColor,
        strokeWidth: strokeWidth,
        multiplier: multiplier
      })

      if (outline) {
         
        (outline as any).alwaysTop = true
      }

      if (!outline) {
        console.error('칼선 생성에 실패했습니다')
        return shape
      }

      // + 아이콘 SVG 생성
      const iconSize = Math.min(shape.width!, shape.height!) / 8
      const plusSvg = `
        <svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="11" fill="rgba(0,0,0,0.6)" stroke="#fff" stroke-width="1"/>
          <path d="M12 6v12M6 12h12" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
        </svg>
      `

      // core API를 사용하여 SVG 로드
      const plusIcon = await core.loadSVGFromString(plusSvg, {
        originX: 'center',
        originY: 'center',
        left: shape.getCenterPoint().x,
        top: shape.getCenterPoint().y,
        selectable: false,
        hasControls: false,
        hasBorders: false,
        absolutePositioned: true,
        evented: false,
        excludeFromExport: true,
        extensionType: 'template-element'
      }) as FabricObject

      // + 아이콘에 ID와 extensionType 설정
      plusIcon.id = `${shape.id}_moldIcon`
      plusIcon.extensionType = 'moldIcon'

      canvas.add(plusIcon)

      // 히스토리에 포함되도록 SVG 요소로 등록
       
      if (typeof (canvas as any).registerSvgElement === 'function') {
         
        ;(canvas as any).registerSvgElement(plusIcon)
      }

      // 칼선과 + 아이콘을 shape와 바인딩
       
      imagePlugin.bindWithMold(shape, outline as any, plusIcon)

      console.log('모양틀 생성 완료:', shape.id)
    } catch (error) {
      console.error('칼선 생성 오류:', error)
    }

    return shape
  }
}))

// Selector hooks
export const useUploading = () => useImageStore((state) => state.uploading)
export const useUploaded = () => useImageStore((state) => state.uploaded)
