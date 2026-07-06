import { useCallback, useState, useMemo } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useAuthStore } from '@/stores/useAuthStore'
import { useEditorStore } from '@/stores/useEditorStore'
import { ServicePlugin, core } from '@storige/canvas-core'
import { designsApi, editSessionsApi, filesApi, storageApi } from '@/api'
import { buildSpreadSnapshots } from '@/utils/buildSpreadSnapshots'
import { computeInnerContentSizeMm, computeCoverOutputSizeMm } from '@/utils/photobookSpread'
import type { SpreadSynthesisJobData } from '@storige/types'

// Fabric.js 타입 (런타임에 로드됨)
 
type FabricObject = any

// 타입 정의
interface SaveWorkOptions {
  exportToPdf?: boolean
}

interface UploadResult {
  thumbnailUrl: string
  jsonUrl: string
}

interface SaveData {
  jsonDataArray: string[]
  workState: {
    name: string
    productId?: string
    sizeNo: string
    totalPage: number
    settings: unknown
    createdAt: string
    canvases: string[]
  }
  baseFileName: string
}

// 에러 타입 가드
const isError = (error: unknown): error is Error => {
  return error instanceof Error
}

export interface CompleteSpreadWorkResult {
  success: boolean
  jobId?: string
  error?: string
}

export interface UseWorkSaveReturn {
  saving: boolean
  workId: string
  currentWorkState: {
    name: string
    productId?: string
    sizeNo: string
    totalPage: number
    settings: unknown
    createdAt: string
    canvases: string[]
  }
  saveWork: (options?: SaveWorkOptions) => Promise<File | null>
  saveWorkForAdmin: () => Promise<void>
  saveWorkToLocal: () => Promise<boolean>
  loadWorkFromLocal: () => Promise<boolean>
  loadWorkFromServer: (designId: string) => Promise<boolean>
  completeSpreadWork: () => Promise<CompleteSpreadWorkResult>
}

/**
 * Work Save Hook
 * 작업 저장 및 로드를 위한 React Hook
 * REST API 사용 (외부 점검 정합화 — 8c383de + 5c4145a 반영)
 */
export function useWorkSave(): UseWorkSaveReturn {
  // 로컬 상태
  const [saving, setSaving] = useState(false)
  const [workId, setWorkId] = useState('')

  // Zustand 스토어
  const canvas = useAppStore((state) => state.canvas)
  const editor = useAppStore((state) => state.editor)
  const allCanvas = useAppStore((state) => state.allCanvas)
  const allEditors = useAppStore((state) => state.allEditors)
  const updateObjects = useAppStore((state) => state.updateObjects)

  const currentSettings = useSettingsStore((state) => state.currentSettings)
  const artwork = useSettingsStore((state) => state.artwork)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const updateArtworkStore = useSettingsStore((state) => state.updateArtwork)

  const me = useAuthStore((state) => state.me)
  const sessionId = useEditorStore((state) => state.sessionId)
  const session = useEditorStore((state) => state.session)

  // 현재 작업 상태
  const currentWorkState = useMemo(() => ({
    name: artwork.name || '새 작업',
    productId: artwork.product?.id,
    sizeNo: String(artwork.sizeInfo?.sizeno || ''),
    totalPage: allCanvas.length,
    settings: currentSettings,
    createdAt: new Date().toISOString(),
    canvases: [] as string[]
  }), [artwork, allCanvas.length, currentSettings])

  /**
   * 단일 캔버스 데이터 가져오기
   */
  const getCanvasData = useCallback(async (index: number): Promise<string> => {
    try {
      const canvasItem = allCanvas[index]
      const editorItem = allEditors[index]

      if (!canvasItem || !editorItem) {
        throw new Error(`캔버스 ${index + 1}을 찾을 수 없습니다`)
      }

      const plugin = editorItem.getPlugin('ServicePlugin') as ServicePlugin
      if (!plugin) {
        throw new Error('서비스 플러그인을 찾을 수 없습니다')
      }

      return await plugin.saveJSON()
    } catch (error) {
      console.error(`캔버스 ${index + 1} 데이터 저장 실패:`, error)
      const errorMessage = isError(error) ? error.message : '알 수 없는 오류'
      throw new Error(`캔버스 ${index + 1} 데이터 저장 실패: ${errorMessage}`)
    }
  }, [allCanvas, allEditors])

  /**
   * 모든 캔버스 데이터 가져오기
   */
  const getAllCanvasData = useCallback(async (): Promise<string[]> => {
    const canvasDataPromises = allCanvas.map((_, index) => getCanvasData(index))
    return Promise.all(canvasDataPromises)
  }, [allCanvas, getCanvasData])

  /**
   * 썸네일 생성
   */
  const generateThumbnail = useCallback(async (): Promise<string> => {
    if (!canvas || !editor) return ''

    const workspace = canvas.getObjects().find((obj: FabricObject) => obj.id === 'workspace')
    if (!workspace) return ''

    try {
      const templateBackground = canvas.getObjects().find((obj: FabricObject) => obj.id === 'template-background')
      const cutlineTemplate = canvas.getObjects().find((obj: FabricObject) => obj.id === 'cutline-template')
      const background = (
        templateBackground?.type?.toLowerCase() === 'group'
          ? templateBackground.getObjects()[0]
          : templateBackground
      )?.fill

      // 제외할 객체 ID 목록
      const excludeIds = new Set([
        'cutline-template',
        'cut-border',
        'safe-zone-border',
        'page-outline',
        'center-guideline-h',
        'center-guideline-v'
      ])

      // core API를 사용하여 캔버스 JSON 생성
      const canvasJson = core.toJSON(canvas, ['id', 'extensionType', 'selectable', 'evented'])

      // core API를 사용하여 임시 캔버스 생성
      const tempCanvas = core.createTempCanvas({
        width: canvas.width || 800,
        height: canvas.height || 600
      })
      tempCanvas.setViewportTransform([1, 0, 0, 1, 0, 0])

      // core API를 사용하여 JSON 로드
      await core.loadFromJSON(tempCanvas, canvasJson)

      const objectsToRemove: FabricObject[] = []
      tempCanvas.getObjects().forEach((obj: FabricObject) => {
        if (
          excludeIds.has(obj.id) ||
          obj.extensionType === 'printguide' ||
          obj.extensionType === 'guideline' ||
          obj.extensionType === 'moldIcon' ||
          obj.type === 'GuideLine'
        ) {
          objectsToRemove.push(obj)
        }
      })

      objectsToRemove.forEach((obj: FabricObject) => tempCanvas.remove(obj))

      if (cutlineTemplate && workspace.extensionType !== 'clipping' && cutlineTemplate.type !== 'group') {
        // core API를 사용하여 객체 복제
        const cutlineClone = core.cloneObject(cutlineTemplate)
        cutlineClone.set({
          fill: background || 'white',
          stroke: background || 'white',
          absolutePositioned: true
        })
        tempCanvas.clipPath = cutlineClone
      }

      tempCanvas.renderAll()

      const tempWorkspace = tempCanvas.getObjects().find((obj: FabricObject) => obj.id === 'workspace')
      let dataURL: string

      if (tempWorkspace) {
        const bound = tempWorkspace.getBoundingRect(true)
        dataURL = tempCanvas.toDataURL({
          format: 'png',
          quality: 0.8,
          multiplier: 1,
          left: bound.left,
          top: bound.top,
          width: bound.width,
          height: bound.height
        })
      } else {
        dataURL = tempCanvas.toDataURL({
          format: 'png',
          quality: 0.8,
          multiplier: 1
        })
      }

      tempCanvas.dispose()
      return dataURL
    } catch (error) {
      console.error('썸네일 생성 실패:', error)
      return ''
    }
  }, [canvas, editor])

  /**
   * 저장 데이터 준비
   */
  const prepareSaveData = useCallback(async (): Promise<SaveData> => {
    const jsonDataArray = await getAllCanvasData()
    const workState = { ...currentWorkState, canvases: jsonDataArray }

    const timestamp = new Date().getTime()
    const baseFileName = `${workState.name.replace(/[^a-zA-Z0-9가-힣]/g, '_')}_${timestamp}`

    return {
      jsonDataArray,
      workState,
      baseFileName
    }
  }, [getAllCanvasData, currentWorkState])

  /**
   * 파일 업로드 (REST API 사용)
   */
  const uploadFiles = useCallback(async (saveData: SaveData): Promise<UploadResult> => {
    const { jsonDataArray, baseFileName } = saveData

    // JSON 데이터 업로드
    const jsonBlob = new Blob([JSON.stringify(jsonDataArray)], { type: 'application/json' })
    const jsonFileName = `${baseFileName}.json`
    const jsonResult = await storageApi.uploadDesign(jsonBlob, jsonFileName)
    const jsonUrl = jsonResult.data?.url || ''

    // 썸네일 생성 및 업로드
    const thumbnailDataURL = await generateThumbnail()
    let thumbnailUrl = ''

    if (thumbnailDataURL) {
      const response = await fetch(thumbnailDataURL)
      const thumbnailBlob = await response.blob()
      const thumbnailFileName = `${baseFileName}_thumbnail.png`
      const thumbnailResult = await storageApi.uploadDesign(thumbnailBlob, thumbnailFileName)
      thumbnailUrl = thumbnailResult.data?.url || ''
    }

    return { thumbnailUrl, jsonUrl }
  }, [generateThumbnail])

  /**
   * 일반 사용자용 작업 저장
   */
  const saveWork = useCallback(async (_options?: SaveWorkOptions): Promise<File | null> => {
    if (saving) {
      console.warn('저장 중입니다. 잠시만 기다려주세요.')
      throw new Error('이미 저장 중입니다')
    }

    try {
      setSaving(true)
      console.log('작업을 저장하는 중입니다...')

      const saveData = await prepareSaveData()
      console.log('workState', saveData.workState)

      // 파일 업로드
      const { thumbnailUrl, jsonUrl } = await uploadFiles(saveData)
      console.log('파일 업로드 완료:', { thumbnailUrl, jsonUrl })

      // 기존 workId가 있으면 업데이트, 없으면 생성
      if (workId) {
        // 기존 디자인 업데이트
        const updateResult = await designsApi.updateDesign(workId, {
          name: saveData.workState.name,
          imageUrl: thumbnailUrl || undefined,
          mediaUrl: jsonUrl,
          metadata: {
            productId: saveData.workState.productId,
            sizeNo: saveData.workState.sizeNo,
            totalPage: saveData.workState.totalPage,
            settings: saveData.workState.settings as Record<string, unknown>,
          },
        })

        if (!updateResult.success) {
          throw new Error(updateResult.error?.message || '디자인 업데이트 실패')
        }

        console.log('디자인 업데이트 완료:', updateResult.data?.id)
      } else {
        // 새 디자인 생성
        const createResult = await designsApi.createDesign({
          name: saveData.workState.name,
          imageUrl: thumbnailUrl || undefined,
          mediaUrl: jsonUrl,
          metadata: {
            productId: saveData.workState.productId,
            sizeNo: saveData.workState.sizeNo,
            totalPage: saveData.workState.totalPage,
            settings: saveData.workState.settings as Record<string, unknown>,
          },
        })

        if (!createResult.success || !createResult.data) {
          throw new Error(createResult.error?.message || '디자인 생성 실패')
        }

        const newWorkId = createResult.data.id
        if (newWorkId) {
          setWorkId(newWorkId)
        }
        console.log('새 디자인 생성 완료:', newWorkId)
      }

      console.log('작업이 성공적으로 저장되었습니다')
      localStorage.setItem('lastSavedTimestamp', new Date().toISOString())

      return null
    } catch (error) {
      console.error('작업 저장 오류:', error)
      const errorMessage = isError(error) ? error.message : '알 수 없는 오류'
      throw new Error(`작업 저장에 실패했습니다: ${errorMessage}`)
    } finally {
      setSaving(false)
    }
  }, [saving, prepareSaveData, uploadFiles, workId])

  /**
   * 관리자용 작업 저장
   * 콘텐츠 편집 모드에서 사용 (template, background, element, frame, image)
   */
  const saveWorkForAdmin = useCallback(async (): Promise<void> => {
    if (saving) {
      console.warn('저장 중입니다. 잠시만 기다려주세요.')
      throw new Error('이미 저장 중입니다')
    }

    try {
      setSaving(true)
      console.log('관리자 작업을 저장하는 중입니다...')

      const saveData = await prepareSaveData()

      // 파일 업로드
      const { thumbnailUrl, jsonUrl } = await uploadFiles(saveData)
      console.log('파일 업로드 완료:', { thumbnailUrl, jsonUrl })

      // 기존 workId가 있으면 업데이트
      if (workId) {
        const updateResult = await designsApi.updateDesign(workId, {
          name: saveData.workState.name,
          imageUrl: thumbnailUrl || undefined,
          mediaUrl: jsonUrl,
          metadata: {
            isAdmin: true,
            productId: saveData.workState.productId,
            sizeNo: saveData.workState.sizeNo,
            totalPage: saveData.workState.totalPage,
            settings: saveData.workState.settings as Record<string, unknown>,
          },
        })

        if (!updateResult.success) {
          throw new Error(updateResult.error?.message || '디자인 업데이트 실패')
        }

        console.log('관리자 디자인 업데이트 완료:', updateResult.data?.id)
      } else {
        // 새 디자인 생성 (관리자 메타데이터 포함)
        const createResult = await designsApi.createDesign({
          name: saveData.workState.name,
          imageUrl: thumbnailUrl || undefined,
          mediaUrl: jsonUrl,
          metadata: {
            isAdmin: true,
            productId: saveData.workState.productId,
            sizeNo: saveData.workState.sizeNo,
            totalPage: saveData.workState.totalPage,
            settings: saveData.workState.settings as Record<string, unknown>,
          },
        })

        if (!createResult.success || !createResult.data) {
          throw new Error(createResult.error?.message || '관리자 디자인 생성 실패')
        }

        const newWorkId = createResult.data.id
        if (newWorkId) {
          setWorkId(newWorkId)
        }
        console.log('관리자 디자인 생성 완료:', newWorkId)
      }

      console.log('관리자 작업이 성공적으로 저장되었습니다')
      localStorage.setItem('lastSavedTimestamp', new Date().toISOString())
    } catch (error) {
      console.error('관리자 작업 저장 오류:', error)
      const errorMessage = isError(error) ? error.message : '알 수 없는 오류'
      throw new Error(`관리자 작업 저장에 실패했습니다: ${errorMessage}`)
    } finally {
      setSaving(false)
    }
  }, [saving, prepareSaveData, uploadFiles, workId])

  /**
   * 로컬 임시 저장
   */
  const saveWorkToLocal = useCallback(async (): Promise<boolean> => {
    try {
      const jsonDataArray = await getAllCanvasData()
      const workState = {
        ...currentWorkState,
        canvases: jsonDataArray,
        lastSaved: new Date().toISOString()
      }

      localStorage.setItem('tempWork', JSON.stringify(workState))
      return true
    } catch (error) {
      console.error('로컬 저장 오류:', error)
      return false
    }
  }, [getAllCanvasData, currentWorkState])

  /**
   * 로컬 임시 저장 불러오기
   */
  const loadWorkFromLocal = useCallback(async (): Promise<boolean> => {
    try {
      const tempWorkString = localStorage.getItem('tempWork')
      if (!tempWorkString) {
        return false
      }

      const tempWork = JSON.parse(tempWorkString)

      if (tempWork.settings) {
        updateSettings(tempWork.settings)
      }

      if (tempWork.name) {
        updateArtworkStore({
          name: tempWork.name,
          sizeno: tempWork.sizeNo
        })
      }

      if (tempWork.canvases && Array.isArray(tempWork.canvases)) {
        for (let i = 0; i < tempWork.canvases.length; i++) {
          if (i < allEditors.length) {
            const plugin = allEditors[i].getPlugin('ServicePlugin') as ServicePlugin
            if (plugin) {
              await plugin.loadJSON(tempWork.canvases[i])
            }
          }
        }

        updateObjects()
        return true
      }

      return false
    } catch (error) {
      console.error('로컬 저장 불러오기 오류:', error)
      return false
    }
  }, [allEditors, updateSettings, updateArtworkStore, updateObjects])

  /**
   * 서버에서 디자인 불러오기
   */
  const loadWorkFromServer = useCallback(async (designId: string): Promise<boolean> => {
    try {
      console.log('서버에서 디자인 불러오는 중:', designId)

      const result = await designsApi.getDesign(designId)

      if (!result.success || !result.data) {
        throw new Error(result.error?.message || '디자인을 찾을 수 없습니다')
      }

      const design = result.data
      setWorkId(design.id)

      // 메타데이터에서 설정 복원
      if (design.metadata?.settings) {
        updateSettings(design.metadata.settings as Record<string, unknown>)
      }

      // 작업 이름 복원
      if (design.name) {
        updateArtworkStore({
          name: design.name,
          sizeno: design.metadata?.sizeNo
        })
      }

      // JSON 데이터 로드
      if (design.mediaUrl) {
        const response = await fetch(design.mediaUrl)
        const canvasData = await response.json()

        if (Array.isArray(canvasData)) {
          for (let i = 0; i < canvasData.length; i++) {
            if (i < allEditors.length) {
              const plugin = allEditors[i].getPlugin('ServicePlugin') as ServicePlugin
              if (plugin) {
                await plugin.loadJSON(canvasData[i])
              }
            }
          }

          updateObjects()
        }
      }

      console.log('디자인 로드 완료:', design.id)
      return true
    } catch (error) {
      console.error('서버에서 디자인 불러오기 오류:', error)
      return false
    }
  }, [allEditors, updateSettings, updateArtworkStore, updateObjects])

  /**
   * 스프레드 모드 작업 완료 (PDF 생성 및 Worker Job 생성)
   *
   * §4.7 설계서에 따라:
   * 1. allCanvas[0] (스프레드) → cover.pdf 업로드
   * 2. allCanvas[1~N] (내지) → 개별 PDF 업로드
   * 3. EditSession 완료 API 호출 → Worker Job 자동 생성
   */
  const completeSpreadWork = useCallback(async (): Promise<CompleteSpreadWorkResult> => {
    const isSpreadMode = useAppStore.getState().isSpreadMode

    if (!isSpreadMode) {
      console.error('[useWorkSave] completeSpreadWork는 스프레드 모드에서만 사용 가능합니다.')
      return {
        success: false,
        error: '스프레드 모드가 아닙니다.',
      }
    }

    if (saving) {
      console.warn('[useWorkSave] 이미 저장 중입니다.')
      return {
        success: false,
        error: '이미 저장 중입니다.',
      }
    }

    try {
      setSaving(true)
      console.log('[useWorkSave:Spread] 스프레드 작업 완료 시작...')

      if (allCanvas.length < 1) {
        throw new Error('캔버스가 없습니다.')
      }

      if (!sessionId) {
        throw new Error('편집 세션이 없습니다. (sessionId 누락)')
      }

      const orderSeqnoFromSession = (session as any)?.orderSeqno as number | undefined
      // Track 1 (2026-07-06): 출력 크기 산출은 embed.tsx handleFinish 와 photobookSpread 헬퍼를
      // **단일 진실원**으로 공유한다(경로별 출력 크기 불일치 회귀 방지).
      const spreadCfg = useSettingsStore.getState().spreadConfig
      // D-1 1단계: 포토북 내지(regionScope='inner')는 content.pdf 페이지 크기 = innerSpec 2-up
      // (pageWidthMm×2 × pageHeightMm). 비-포토북은 헬퍼가 null → 기존 폴백(주문 판형) byte-parity.
      const innerContentSize = computeInnerContentSizeMm(spreadCfg)
      const innerWidthMm = innerContentSize?.widthMm ?? (artwork as any)?.sizeInfo?.width ?? 210
      const innerHeightMm = innerContentSize?.heightMm ?? (artwork as any)?.sizeInfo?.height ?? 297
      const cutSize = 3

      // P3 (2026-06-10): 작업사이즈(재단+블리드)+코너마커+TrimBox 출력 게이팅.
      // templateSet 에서 운반한 printMarkConfig 를 saveMultiPagePDFAsBlob 의 size 에 전달.
      // ServicePlugin 게이트(cropMarkEnabled && bleedMm>0)에서만 작업사이즈 경로 활성.
      // 미설정(null) → undefined → 게이트 OFF(현행 trim 출력 그대로).
      const printMarkCfg = useSettingsStore.getState().printMarkConfig
      const markOpt = {
        bleedMm: printMarkCfg?.bleedMm,
        cropMarkEnabled: printMarkCfg?.cropMarkEnabled,
      }

      // ========================================================================
      // 1. 스프레드 표지 (allCanvas[0]) → 단일 PDF → filesApi.upload(type='cover')
      // ========================================================================
      const spreadCanvas = allCanvas[0]
      const spreadEditor = allEditors[0]

      if (!spreadCanvas || !spreadEditor) {
        throw new Error('스프레드 표지 캔버스를 찾을 수 없습니다.')
      }

      console.log('[useWorkSave:Spread] 1. 스프레드 표지 PDF 생성 + 업로드 중...')

      const spreadPlugin = spreadEditor.getPlugin<ServicePlugin>('ServicePlugin')
      if (!spreadPlugin) {
        throw new Error('스프레드 표지의 ServicePlugin을 찾을 수 없습니다.')
      }

      // 표지(펼침면) = 단일 페이지 PDF. 기존 spreadPlugin.exportToPDF() 는 ServicePlugin 에
      // 미정의(TypeError) 였음 → 내지와 동일하게 saveMultiPagePDFAsBlob 사용.
      // 폭/높이는 표지 '펼침면 전체' mm, dpi=300(내지와 통일).
      // ⚠️ 무결성(SF-3): 책등 가변(비동기 트랜잭션) 직후 저장 시 settingsStore 가 아직 stale 일 수
      // 있으므로, 방금 트랜잭션이 갱신한 SpreadPlugin.currentLayout(getLayout)을 단일 진실 소스로
      // 우선 사용. 폴백: settingsStore → 내지 치수.
      const spreadLayout = (
        spreadEditor.getPlugin('SpreadPlugin') as
          | { getLayout?: () => { totalWidthMm?: number; totalHeightMm?: number } | null }
          | null
      )?.getLayout?.()
      const coverWidthMm = spreadLayout?.totalWidthMm ?? spreadCfg?.totalWidthMm ?? innerWidthMm
      const coverHeightMm = spreadLayout?.totalHeightMm ?? spreadCfg?.totalHeightMm ?? innerHeightMm
      // D-4 (2026-07-06): 하드커버(caseBind) 표지는 출력 페이지 크기 = wrap 포함 사이즈.
      // ServicePlugin 의 기존 printSize 메커니즘(페이지=printSize, 콘텐츠 trim 렌더 중앙 배치) 재사용
      // — canvas-core 무변경. caseBind 미설정이면 null → 기존 호출 byte-parity.
      // (wrap 자체가 재단 여유 역할 — crop mark 게이트(markOpt)는 printSize 와 함께 쓰지 않는다.)
      const coverOutputSize = computeCoverOutputSizeMm(spreadCfg)
      const coverPdfBlob = await spreadPlugin.saveMultiPagePDFAsBlob(
        [spreadCanvas] as any,
        [spreadEditor],
        `spread_cover_${Date.now()}`,
        {
          width: coverWidthMm, height: coverHeightMm, cutSize,
          ...(coverOutputSize
            ? { printSize: { width: coverOutputSize.widthMm, height: coverOutputSize.heightMm } }
            : markOpt),
        },
        undefined,
        300,
      )
      const coverFile = new File(
        [coverPdfBlob],
        `spread_cover_${Date.now()}.pdf`,
        { type: 'application/pdf' },
      )
      const coverUploadResult = await filesApi.upload({
        file: coverFile,
        type: 'cover',
        orderSeqno: orderSeqnoFromSession,
        metadata: {
          generatedBy: 'editor',
          editSessionId: sessionId,
          mode: 'spread',
          isSpreadCover: true,
        },
      })
      const coverPdfFileId = coverUploadResult.id
      console.log('[useWorkSave:Spread] 표지 업로드 완료:', coverPdfFileId)

      // ========================================================================
      // 2. 내지 N개 (allCanvas[1~N]) → 단일 multi-page PDF → filesApi.upload(type='content')
      // ========================================================================
      const innerCanvases = allCanvas.slice(1)
      const innerEditors = allEditors.slice(1)

      if (innerCanvases.length === 0 || innerEditors.length === 0) {
        throw new Error('내지 캔버스가 없습니다.')
      }

      console.log(`[useWorkSave:Spread] 2. 내지 ${innerCanvases.length}개 → multi-page PDF 합성 중...`)

      const firstInnerEditor = innerEditors[0]
      const firstInnerPlugin = firstInnerEditor.getPlugin<ServicePlugin>('ServicePlugin')
      if (!firstInnerPlugin) {
        throw new Error('내지의 ServicePlugin을 찾을 수 없습니다.')
      }

      const contentPdfBlob = await firstInnerPlugin.saveMultiPagePDFAsBlob(
        innerCanvases as any,
        innerEditors,
        `spread_content_${Date.now()}`,
        { width: innerWidthMm, height: innerHeightMm, cutSize, ...markOpt },
        undefined,
        300,
      )

      const contentFile = new File(
        [contentPdfBlob],
        `spread_content_${Date.now()}.pdf`,
        { type: 'application/pdf' },
      )
      const contentUploadResult = await filesApi.upload({
        file: contentFile,
        type: 'content',
        orderSeqno: orderSeqnoFromSession,
        metadata: {
          generatedBy: 'editor',
          editSessionId: sessionId,
          mode: 'spread',
          pageCount: innerCanvases.length,
        },
      })
      const contentPdfFileId = contentUploadResult.id
      console.log('[useWorkSave:Spread] 내지 multi-page PDF 업로드 완료:', contentPdfFileId)

      // ========================================================================
      // 3. EditSession 갱신 + 완료
      //    spread 모드는 서버측에서 자동 검증 잡 발행을 스킵 (펼침면 사이즈 검증 충돌 방지)
      //    실제 합성은 PHP가 별도로 worker-jobs/synthesize/external 호출 시점에 수행
      // ========================================================================
      console.log('[useWorkSave:Spread] 3. EditSession 완료 API 호출 중...')

      // B38 출력재현 단일소스: metadata.spread/spine 스냅샷 저장(additive). 실패해도 완료 무중단.
      const spreadSnapshots = buildSpreadSnapshots(
        useSettingsStore.getState().spreadConfig,
        useSettingsStore.getState().spineConfig,
        innerCanvases.length,
      )
      await editSessionsApi.update(sessionId, {
        coverFileId: coverPdfFileId,
        contentFileId: contentPdfFileId,
        metadata: {
          spreadContentPageCount: innerCanvases.length,
          ...(spreadSnapshots.spread ? { spread: spreadSnapshots.spread } : {}),
          ...(spreadSnapshots.spine ? { spine: spreadSnapshots.spine } : {}),
        },
      })

      const completedSession = await editSessionsApi.complete(sessionId)
      console.log('[useWorkSave:Spread] EditSession 완료:', completedSession.id)

      // 4. 부모(PHP) 윈도우에 완료 알림 (iframe 임베드 환경)
      if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
        window.parent.postMessage(
          {
            type: 'storige:completed',
            payload: {
              sessionId: completedSession.id,
              orderSeqno: Number(completedSession.orderSeqno),
              status: completedSession.status,
              completedAt: completedSession.completedAt,
              files: {
                coverFileId: completedSession.coverFileId,
                contentFileId: completedSession.contentFileId,
              },
            },
          },
          '*',
        )
      }

      console.log('[useWorkSave:Spread] 스프레드 작업 완료!')

      return {
        success: true,
        jobId: completedSession.id,
      }
    } catch (error) {
      console.error('[useWorkSave:Spread] 오류:', error)
      const errorMessage = isError(error) ? error.message : '알 수 없는 오류'
      return {
        success: false,
        error: errorMessage,
      }
    } finally {
      setSaving(false)
    }
  }, [saving, allCanvas, allEditors, sessionId, session, artwork])

  return {
    saving,
    workId,
    currentWorkState,
    saveWork,
    saveWorkForAdmin,
    saveWorkToLocal,
    loadWorkFromLocal,
    loadWorkFromServer,
    completeSpreadWork,
  }
}
