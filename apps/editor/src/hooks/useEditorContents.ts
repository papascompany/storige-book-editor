import { useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { v4 as uuid } from 'uuid'
import { useAppStore } from '@/stores/useAppStore'
import { useEditorStore } from '@/stores/useEditorStore'
import {
  useSettingsStore,
  type EditorUseCase,
  type ProductBasedSetupConfig,
  type ContentEditSetupConfig,
  type EmptyEditorSetupConfig,
  type GeneralSetupConfig,
} from '@/stores/useSettingsStore'
import Editor, { ServicePlugin, SvgUtils, TemplatePlugin, mmToPxDisplay, computeLayout, SpreadPlugin } from '@storige/canvas-core'
import { contentsApi, storageApi, templateSetsApi, templatesApi } from '@/api'
import { createCanvas } from '@/utils/createCanvas'
import { recalculateSpineWidth, initSpineConfig } from '@/utils/spineCalculator'
import { buildSpreadSpec } from '@/utils/buildSpreadSpec'
import type {
  EditorContent,
  EditorTemplate,
} from '@/generated/graphql'
import type { fabric } from 'fabric'
import type { EditorMode, SpreadConfig, EditPage } from '@storige/types'
import { TemplateType } from '@storige/types'

// Fabric.js Object 확장 타입 (canvas-core에서 사용하는 커스텀 속성 포함)
interface ExtendedFabricObject extends fabric.Object {
  id?: string
  extensionType?: string
  preventAutoResize?: boolean
  editable?: boolean
}

// 템플릿셋 기반 에디터 설정 타입
export interface TemplateSetBasedSetupConfig {
  templateSetId: string
  pageCount?: number      // 요청된 페이지 수 (내지 자동 조정용)
  paperType?: string      // 용지 종류 코드 (책등 계산용)
  bindingType?: string    // 제본 방식 코드 (책등 계산용)
}

// 사용 케이스별 설정 타입 매핑
export type UseCaseConfigMap = {
  'product-based': ProductBasedSetupConfig
  'content-edit': ContentEditSetupConfig
  'empty': EmptyEditorSetupConfig | undefined
  'general': GeneralSetupConfig | undefined
  'template-set': TemplateSetBasedSetupConfig
}

// 메타데이터 안전 접근 유틸리티
 
const safeGetMetadata = (content: any, key: string, defaultValue: any = null) => {
  return content?.metadata?.[key] ?? defaultValue
}

// 안전한 URL 접근 유틸리티
// 중첩 형태(content.image.image.url) + flat 형태(content.imageUrl) 모두 지원.
// flat 은 API가 library 에셋/editor_contents 를 평면 필드로 반환하는 경우(P0-1, 2026-06-02).
const safeGetImageUrl = (content: EditorContent | EditorTemplate): string | null => {
  return content?.image?.image?.url || (content as any)?.imageUrl || null
}

// 안전한 템플릿 URL 접근
const safeGetTemplateUrl = (content: EditorTemplate): string | null => {

  const designUrl = (content as any)?.design?.document?.url || (content as any)?.designUrl
  if (designUrl) return designUrl
  return content?.image?.image?.url || (content as any)?.imageUrl || null
}

// 안전한 칼선 템플릿 URL 접근
const safeGetCutLineTemplateUrl = (content: EditorTemplate): string | null => {
   
  return (content as any)?.cutLineTemplate?.image?.url || null
}

// S3 URL에서 경로 추출
const extractPathFromS3Url = (s3Url: string): string => {
  if (!s3Url.startsWith('s3://')) return s3Url
  const parts = s3Url.replace('s3://', '').split('/')
  return parts.slice(1).join('/')
}

// 콘텐츠 타입별 REST API 호출 함수 가져오기
const getContentApiByType = (contentType: string) => {
  switch (contentType) {
    case 'image':
      return contentsApi.getImages
    case 'frame':
      return contentsApi.getFrames
    case 'element':
      return contentsApi.getElements
    case 'background':
      return contentsApi.getBackgrounds
    case 'template':
      return contentsApi.getTemplates
    default:
      return contentsApi.getTemplates
  }
}

export interface UseEditorContentsReturn {
  // 콘텐츠 로드
  loadContent: (contentId: string, contentType: string) => Promise<void>
  loadCanvasData: (canvases: unknown[]) => Promise<boolean>
  loadEditDesign: (item: EditorContent | EditorTemplate, documentURL: string) => Promise<void>

  // 에셋 설정
  setupAsset: (content: EditorContent | EditorTemplate, contentType: string) => Promise<void>
  setupEditContent: (content: EditorContent | EditorTemplate, contentType: string) => Promise<void>
  setupTemplateFromSvgString: (svgString: string, cutLineSvgString?: string | null, options?: { viaUpload?: boolean }) => Promise<boolean>
  setupTemplateContent: (content: EditorTemplate) => Promise<void>
  setupFrameContent: (content: EditorContent, canvas: fabric.Canvas) => Promise<void>

  // 에셋 추가
  addAssetToCanvas: (url: string, objectId: string) => Promise<fabric.Object>
  setAsBackground: (item: fabric.Object, canvas: fabric.Canvas) => fabric.Object | null

  // 사용 케이스 기반 로더
  loadForUseCase: <T extends EditorUseCase>(useCase: T, config: UseCaseConfigMap[T]) => Promise<void>
  loadProductBasedEditor: (config: ProductBasedSetupConfig) => Promise<void>
  loadContentEditor: (config: ContentEditSetupConfig) => Promise<void>
  loadEmptyEditor: (config?: EmptyEditorSetupConfig) => Promise<void>
  loadGeneralEditor: (config?: GeneralSetupConfig) => Promise<void>
  loadTemplateSetEditor: (config: TemplateSetBasedSetupConfig) => Promise<void>
}

/**
 * Editor Contents Hook
 * 에디터 콘텐츠 로딩 및 관리를 위한 React Hook
 *
 * 사용 케이스별 에디터 초기화:
 * - product-based: 제품 기반 에디터 (템플릿, 사이즈 정보 포함)
 * - content-edit: 기존 콘텐츠 편집
 * - empty: 빈 에디터
 * - general: 일반 에디터
 */
export function useEditorContents(): UseEditorContentsReturn {
  // Zustand 스토어 - useShallow로 한 번에 가져와서 불필요한 리렌더링 방지
  const {
    canvas,
    editor,
    allCanvas,
    allEditors,
    clearAll,
    setPage,
    addPage,
    getPlugin,
    updateObjects,
  } = useAppStore(
    useShallow((state) => ({
      canvas: state.canvas,
      editor: state.editor,
      allCanvas: state.allCanvas,
      allEditors: state.allEditors,
      clearAll: state.clearAll,
      setPage: state.setPage,
      addPage: state.addPage,
      getPlugin: state.getPlugin,
      updateObjects: state.updateObjects,
    }))
  )

  const {
    setupProductBased,
    setupEmptyEditor: setupEmptyEditorStore,
    setupGeneral: setupGeneralStore,
    setEditorTemplates,
    setEnabledMenus,
  } = useSettingsStore(
    useShallow((state) => ({
      setupProductBased: state.setupProductBased,
      setupEmptyEditor: state.setupEmptyEditor,
      setupGeneral: state.setupGeneral,
      setEditorTemplates: state.setEditorTemplates,
      setEnabledMenus: state.setEnabledMenus,
    }))
  )

  /**
   * SVG URL에서 콘텐츠 가져오기
   */
  const fetchSvgContent = useCallback(async (url: string): Promise<string> => {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`SVG 로드 실패: ${response.status} ${response.statusText}`)
      }
      return await response.text()
    } catch (error) {
      console.error('SVG 로드 오류:', error)
      throw new Error('SVG 로드 중 오류가 발생했습니다.')
    }
  }, [])

  /**
   * 에셋을 캔버스에 추가
   */
   
  const addAssetToCanvas = useCallback(async (url: string, _objectId: string): Promise<fabric.Object> => {
    if (!url) {
      throw new Error('이미지 URL을 찾을 수 없습니다.')
    }

    // canvas-core API 사용을 위한 import
    const { core } = await import('@storige/canvas-core')

    const isSvg = url.toLowerCase().endsWith('.svg')

    try {
      if (isSvg) {
        // core API를 사용하여 SVG 로드
        const group = await core.loadSVGFromURL(url, {
          left: 0,
          top: 0,
          originX: 'center',
          originY: 'center'
        })

        if (!group) {
          throw new Error('SVG 로딩에 실패했습니다.')
        }

        group.setCoords()
        canvas?.add(group)
        return group
      } else {
        // core API를 사용하여 이미지 로드
        const img = await core.imageFromURL(url, {
          left: 0,
          top: 0,
          originX: 'center',
          originY: 'center'
        })

        if (!img) {
          throw new Error('이미지 로딩에 실패했습니다.')
        }

        canvas?.add(img)
        return img
      }
    } catch (error) {
      console.error('에셋 처리 오류:', error)
      throw error
    }
  }, [canvas])

  /**
   * 객체를 배경으로 설정
   */
  const setAsBackground = useCallback((item: fabric.Object, targetCanvas: fabric.Canvas): fabric.Object | null => {
    const workspace = targetCanvas.getObjects().find((obj) => (obj as ExtendedFabricObject).id === 'workspace')
    if (!workspace) {
      return null
    }

    const prev = targetCanvas.getObjects().find((obj) => (obj as ExtendedFabricObject).extensionType === 'background')
    if (prev) {
      targetCanvas.remove(prev)
    }

    const fitSide = workspace.width! / item.width! > workspace.height! / item.height!
    const scale = fitSide ? workspace.width! / item.width! : workspace.height! / item.height!

    item.set({
      left: workspace.left,
      top: workspace.top,
      originX: 'center',
      originY: 'center'
    })

    const extItem = item as ExtendedFabricObject
    extItem.id = uuid()
    extItem.extensionType = 'background'
    extItem.editable = false
    item.set({
      scaleX: scale,
      scaleY: scale,
      hasControls: false,
      selectable: true,
      lockMovementX: fitSide,
      lockMovementY: !fitSide,
      name: '배경'
    })

    item.sendToBack()
    item.bringForward()

    return item
  }, [])

  /**
   * 캔버스 데이터 로드
   */
  const loadCanvasData = useCallback(async (canvases: unknown[]): Promise<boolean> => {
    // 스토어에서 직접 최신 상태 가져오기 (stale closure 방지)
    const latestEditor = useAppStore.getState().editor
    const latestAllEditors = useAppStore.getState().allEditors
    const latestAllCanvas = useAppStore.getState().allCanvas
    const latestSetPage = useAppStore.getState().setPage

    latestEditor?.emit('longTask:start', { message: '디자인을 적용하는 중...' })
    try {
      console.log('캔버스 데이터 로드:', canvases)

      // 캔버스가 유효한지 확인 - disposed 상태 체크 추가
      if (latestAllCanvas.length === 0) {
        console.warn('[loadCanvasData] No canvas available, skipping')
        return false
      }

      // 캔버스가 disposed 상태인지 확인
      const firstCanvas = latestAllCanvas[0]
       
      if (!firstCanvas || (firstCanvas as any).disposed) {
        console.warn('[loadCanvasData] Canvas is disposed, skipping')
        return false
      }

      // 기존 객체만 클리어 (캔버스 자체는 유지)
      // NOTE: clearAll()이 캔버스 객체를 클리어하므로 여기서는 호출하지 않음
      // loadJSON이 기존 객체를 대체함

      // NOTE: 캔버스 컨테이너를 비우면 안 됨! 기존 캔버스에 데이터를 로드해야 함
      // setupCanvas({ page: canvases.length || 1 })

      if (canvases && canvases.length > 0) {
        const loadPromises = latestAllEditors.map((ed: Editor, index: number) => {
          return new Promise<void>((resolve) => {
            if (index >= canvases.length) {
              resolve()
              return
            }

            // 에디터가 유효한지 확인
            const cvs = latestAllCanvas[index]
            if (!cvs || !cvs.getContext()) {
              console.warn(`[loadCanvasData] Canvas ${index} is disposed, skipping`)
              resolve()
              return
            }

            const plugin = ed.getPlugin<ServicePlugin>('ServicePlugin')
            if (!plugin) { resolve(); return }
            // ⚠️ loadJSON 콜백이 끝내 호출되지 않으면(plugin/fabric 내부 실패·폰트적용 예외)
            //   이 Promise 가 영원히 hang → Promise.all 미완 → longTask:end 미발생 →
            //   '디자인을 적용하는 중' 오버레이 영구 표시. 타임아웃 가드로 항상 진행 보장.
            let settled = false
            const settle = () => { if (!settled) { settled = true; resolve() } }
            const guardTimer = setTimeout(() => {
              console.warn(`[loadCanvasData] loadJSON 타임아웃(page ${index}) — 복원 계속 진행`)
              settle()
            }, 12000)
            plugin.loadJSON(canvases[index] as string | object, async () => {
              if (cvs) {
                const targetObjects = (cvs.getObjects() as fabric.Object[]).filter((obj: fabric.Object) => {
                  const extObj = obj as ExtendedFabricObject
                  return extObj.id === 'workspace' || extObj.id === 'template-background'
                })

                // 스토어에서 직접 최신 설정 가져오기 (stale closure 방지)
                const latestSettings = useSettingsStore.getState().currentSettings
                const latestGetEffectiveValue = useSettingsStore.getState().getEffectiveValue

                targetObjects.forEach((obj: fabric.Object) => {
                  const extObj = obj as ExtendedFabricObject
                  const size = latestSettings.size
                  const totalWidth = latestGetEffectiveValue(size.width + (size.cutSize || 0))
                  const totalHeight = latestGetEffectiveValue(size.height + (size.cutSize || 0))

                  if (extObj.id === 'workspace') {
                    obj.set({
                      width: totalWidth,
                      height: totalHeight,
                      scaleX: 1,
                      scaleY: 1
                    })
                  } else if (extObj.id === 'template-background') {
                    if (!extObj.preventAutoResize) {
                      obj.set({
                        scaleX: totalWidth / obj.width!,
                        scaleY: totalHeight / obj.height!
                      })
                    }
                  }
                })

                ;(cvs.getObjects() as fabric.Object[]).forEach((obj: fabric.Object) => {
                  obj.setCoords()
                  obj.dirty = true
                })

                cvs.requestRenderAll()
              }
              clearTimeout(guardTimer)
              settle()
            })
          })
        })

        await Promise.all(loadPromises)
        latestSetPage(0)
      }

      console.log('작업물을 불러왔습니다.')
      return true
    } catch (error) {
      console.error('캔버스 데이터 로드 오류:', error)
      throw error
    } finally {
      latestEditor?.emit('longTask:end')
    }
  }, [clearAll])

  /**
   * S3 URL에서 다운로드 URL 생성
   * REST API 방식: S3 URL인 경우 storageApi를 통해 접근 가능한 URL로 변환
   */
  const getDownloadUrl = useCallback(async (url: string): Promise<string> => {
    try {
      if (!url.startsWith('s3://')) {
        return url
      }

      // S3 URL에서 경로 추출 후 storage API URL로 변환
      const path = extractPathFromS3Url(url)
      // storageApi의 getDesignUrl 사용
      return storageApi.getDesignUrl(path)
    } catch (error) {
      console.error('파일 다운로드 URL 생성 중 오류:', error)
      throw error
    }
  }, [])

  /**
   * 편집 디자인 로드
   */
  const loadEditDesign = useCallback(async (item: EditorContent | EditorTemplate, documentURL: string): Promise<void> => {
    if (!item.metadata) {
      console.error('작업물 메타데이터를 찾을 수 없습니다.')
      return
    }

    try {
      // S3 URL인 경우 다운로드 URL로 변환
      const fileUrl = await getDownloadUrl(documentURL)
      const res = await fetch(fileUrl)
      const jsonData = await res.json()

      const canvases: unknown[] = []
      if (Array.isArray(jsonData)) {
        jsonData.forEach((json: unknown) => {
          canvases.push(typeof json === 'string' ? JSON.parse(json) : json)
        })
      } else {
        canvases.push(typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData)
      }

      await loadCanvasData(canvases)

      // 칼선 템플릿 적용
      const cutLineTemplate = safeGetCutLineTemplateUrl(item as EditorTemplate)
      if (cutLineTemplate) {
        const templatePlugin = editor?.getPlugin('TemplatePlugin') as TemplatePlugin
        if (templatePlugin) {
          const cutLineSvgString = await fetchSvgContent(cutLineTemplate)
          await templatePlugin.setCutTemplate(cutLineSvgString, 0)
        }
      }
    } catch (e) {
      console.error('작업물 로드 오류:', e)
    }

    canvas?.clearHistory()
    canvas?.onHistory()
  }, [canvas, editor, loadCanvasData, fetchSvgContent, getDownloadUrl])

  /**
   * 이미지 콘텐츠 설정
   */
  const setupImageContent = useCallback(async (content: EditorContent, targetCanvas: fabric.Canvas): Promise<void> => {
    const imageUrl = safeGetImageUrl(content)
    if (!imageUrl) {
      throw new Error('이미지 URL을 찾을 수 없습니다.')
    }

    const item = await addAssetToCanvas(imageUrl, content.id)
    ;(item as ExtendedFabricObject).extensionType = 'image'
    targetCanvas?.renderAll()
  }, [addAssetToCanvas])

  /**
   * 엘리먼트/도형 콘텐츠 설정
   */
  const setupShapeContent = useCallback(async (content: EditorContent, targetCanvas: fabric.Canvas): Promise<void> => {
    const imageUrl = safeGetImageUrl(content)
    if (!imageUrl) {
      throw new Error('이미지 URL을 찾을 수 없습니다.')
    }

    const item = await addAssetToCanvas(imageUrl, content.id)
    ;(item as ExtendedFabricObject).extensionType = 'shape'
    targetCanvas?.renderAll()
  }, [addAssetToCanvas])

  /**
   * 배경 콘텐츠 설정
   */
  const setupBackgroundContent = useCallback(async (content: EditorContent, targetCanvas: fabric.Canvas): Promise<void> => {
    const imageUrl = safeGetImageUrl(content)
    if (!imageUrl) {
      throw new Error('이미지 URL을 찾을 수 없습니다.')
    }

    const obj = await addAssetToCanvas(imageUrl, content.id)
    setAsBackground(obj, targetCanvas)
  }, [addAssetToCanvas, setAsBackground])

  /**
   * 콘텐츠 로드 - 개별 콘텐츠를 ID로 가져오기
   * REST API를 사용하여 콘텐츠 조회
   */
  const loadContent = useCallback(async (contentId: string, contentType: string): Promise<void> => {
    try {
      console.log('loadContent:', contentId, contentType)

      // REST API로 개별 콘텐츠 조회
      const result = await contentsApi.getContent(contentId)

      if (!result.success || !result.data) {
        console.error('콘텐츠를 불러오는 중 오류가 발생했습니다:', result.error?.message)
        return
      }

      const content = result.data
      console.log('loaded content', content)

       
      await setupEditContent(content as any, contentType)
    } catch (e) {
      console.error('콘텐츠 로드 중 오류 발생:', e)
    }
  }, [])

  /**
   * 에셋 설정 - 콘텐츠 타입별로 캔버스에 추가
   */
  const setupAsset = useCallback(async (content: EditorContent | EditorTemplate, contentType: string): Promise<void> => {
    if (!content || !canvas) return

    try {
      switch (contentType) {
        case 'image':
           
          await setupImageContent(content as any, canvas)
          break
        case 'frame':
           
          await setupFrameContent(content as any, canvas)
          break
        case 'element':
           
          await setupShapeContent(content as any, canvas)
          break
        case 'background':
           
          await setupBackgroundContent(content as any, canvas)
          break
        case 'template':
          await setupTemplateContent(content as EditorTemplate)
          break
        default:
          break
      }

      updateObjects()
    } catch (error) {
      console.error('에셋 설정 오류:', error)
    }
  }, [canvas, updateObjects])

  /**
   * 편집 콘텐츠 설정 - 기존 콘텐츠 편집 모드
   */
  const setupEditContent = useCallback(async (content: EditorContent | EditorTemplate, contentType: string): Promise<void> => {
    if (!content) {
      console.error('콘텐츠 정보를 찾을 수 없습니다.')
      return
    }

    try {
      editor?.emit('longTask:start', { message: '콘텐츠를 로드하는 중...' })
      clearAll()

      // 콘텐츠 메타데이터에서 크기 정보 추출 (향후 settings 스토어에 적용)
      const _sizeInfo = safeGetMetadata(content, 'sizeinfo', {})
      const _printSize = safeGetMetadata(content, 'printingSize', {})
      console.log('콘텐츠 크기 정보:', _sizeInfo, _printSize)

      // 문서 URL 확인
       
      let documentURL = (content as any)?.design?.document?.url || null
      const workId = safeGetMetadata(content, 'workId')

      // 작업물 ID가 있으면 기존 작업물 로드
      if (workId) {
        try {
          // 기존 작업물 로드 로직 - GraphQL 쿼리 필요시 추가 구현
          console.log('작업물 로드:', workId)
        } catch (e) {
          console.error('작업물 로드 중 오류 발생:', e)
        }
      }

      // 문서가 있으면 로드
      if (documentURL) {
        console.log('문서 로드:', documentURL)
         
        await loadEditDesign(content as any, documentURL)
      } else {
        // 기본 에셋으로 설정
        await setupAsset(content, contentType)
      }

      console.log('콘텐츠가 성공적으로 로드되었습니다.')
    } catch (error) {
      console.error('콘텐츠 로드 중 오류 발생:', error)
    } finally {
      editor?.emit('longTask:end')
    }
  }, [editor, clearAll, loadEditDesign])

  /**
   * SVG 문자열로부터 템플릿 설정
   */
  const setupTemplateFromSvgString = useCallback(async (
    svgString: string,
    cutLineSvgString?: string | null,
     
    _options?: { viaUpload?: boolean }
  ): Promise<boolean> => {
    editor?.emit('longTask:start', { message: '템플릿을 적용하는 중...' })
    try {
      if (!svgString) {
        throw new Error('SVG 문자열이 제공되지 않았습니다.')
      }

      const pages = await SvgUtils.loadPagesFromSvgString(svgString)
      console.log('템플릿 페이지:', pages.length)

      clearAll()

      // setupCanvas({ page: pages.length })

      // 각 페이지 처리
      for (let i = 0; i < pages.length; i++) {
        const ed = allEditors[i]
        const cvs = allCanvas[i]

        if (ed && cvs) {
          await new Promise<void>((resolve) => {
            canvas?.offHistory()

            const plugin = ed.getPlugin('TemplatePlugin') as TemplatePlugin
            if (!plugin) {
              console.warn(`페이지 ${i + 1}의 템플릿 플러그인을 찾을 수 없습니다.`)
              resolve()
              return
            }

            try {
              const pageData = pages[i]
              plugin.addTemplateToCanvas(pageData.objects).then(() => {
                if (cutLineSvgString) {
                  plugin.setCutTemplate(cutLineSvgString, 0).then(() => {
                    cvs.onHistory()
                    cvs.requestRenderAll()
                    resolve()
                  }).catch(() => {
                    cvs.onHistory()
                    resolve()
                  })
                } else {
                  cvs.onHistory()
                  cvs.requestRenderAll()
                  resolve()
                }
              }).catch(() => {
                cvs.onHistory()
                resolve()
              })
            } catch (err) {
              console.error(`페이지 ${i + 1} 템플릿 적용 오류:`, err)
              cvs.onHistory()
              resolve()
            }
          })
        }
      }

      if (allCanvas.length > 0) {
        setPage(0)
      }

      console.log('템플릿이 성공적으로 적용되었습니다.')
      return true
    } catch (e) {
      console.error('템플릿 적용 중 오류 발생:', e)
      return false
    } finally {
      editor?.emit('longTask:end')
    }
  }, [editor, canvas, clearAll, allEditors, allCanvas, setPage])

  /**
   * 워크스페이스 초기화 (canvas 크기 및 workspace 설정)
   * 주의: 스토어에서 직접 최신 설정을 가져와야 함 (useCallback의 stale closure 문제 방지)
   */
  const initWorkspace = useCallback(async (): Promise<void> => {
    if (!editor || !canvas) return

    // 캔버스가 dispose되었는지 확인 (React Strict Mode 이중 마운트 대응)
    if (!canvas.getContext()) {
      console.warn('[EditorContents] Canvas has been disposed, skipping initWorkspace')
      return
    }

    try {
       
      const workspacePlugin = getPlugin<any>('WorkspacePlugin')

      if (workspacePlugin) {
        // 스토어에서 직접 최신 설정 가져오기 (stale closure 방지)
        const latestSettings = useSettingsStore.getState().currentSettings

        console.log('[EditorContents] initWorkspace with settings:', latestSettings)

        // setOptions로 설정 적용 (setSize 메서드는 존재하지 않음)
        workspacePlugin.setOptions(latestSettings)

        // init으로 워크스페이스 초기화
        workspacePlugin.init()
      }
    } catch (e) {
      console.error('워크스페이스 초기화 오류:', e)
    }
  }, [editor, canvas, getPlugin])

  // 사용 케이스 기반 로더들
  const loadForUseCase = useCallback(async <T extends EditorUseCase>(
    useCase: T,
    config: UseCaseConfigMap[T]
  ): Promise<void> => {
    console.log(`[EditorContents] Loading for use case: ${useCase}`, config)

    switch (useCase) {
      case 'product-based':
        return await loadProductBasedEditor(config as ProductBasedSetupConfig)
      case 'content-edit':
        return await loadContentEditor(config as ContentEditSetupConfig)
      case 'empty':
        return await loadEmptyEditor(config as EmptyEditorSetupConfig | undefined)
      case 'general':
        return await loadGeneralEditor(config as GeneralSetupConfig | undefined)
      default:
        console.warn(`Unknown use case: ${useCase}`)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadProductBasedEditor = useCallback(async (config: ProductBasedSetupConfig): Promise<void> => {
    console.log('[EditorContents] loadProductBasedEditor called with config:', config)
    console.log('[EditorContents] Product ID:', config.product?.id)
    console.log('[EditorContents] Product title:', config.product?.title)

    try {
      editor?.emit('longTask:start', { message: '상품 정보를 설정하는 중...' })

      // 1. settings 스토어 설정 - 이 단계에서 size, dpi 등 설정이 적용됨
      console.log('[EditorContents] Calling setupProductBased...')
      await setupProductBased(config)
      console.log('[EditorContents] setupProductBased completed')

      // 2. 에디터 템플릿 저장
      const allTemplates = config.product?.editorTemplates ||
        config.product?.template?.editorPreset?.editorTemplates || []
      setEditorTemplates(allTemplates)

      // 3. 기본 템플릿 로드 또는 워크스페이스 초기화
      const preset = config.product.template?.editorPreset
      const defaultId = preset?.defaultTemplate?.id

      let templateLoaded = false

      if (allTemplates.length > 0) {
        // 기본 템플릿 찾기
        const defaultTemplate = allTemplates.find(t => t.id === defaultId)
        const sizeMatchTemplate = allTemplates.find(t => t.sizeNo === config.sizeno)
        const templateToLoad = sizeMatchTemplate || defaultTemplate || allTemplates[0]

         
        const designUrl = (templateToLoad as any)?.design?.document?.url
        if (designUrl) {
          console.log('[EditorContents] Loading template:', templateToLoad.name)
          try {
            const svgString = await fetchSvgContent(designUrl)
            await setupTemplateFromSvgString(svgString, null)
            templateLoaded = true
          } catch (e) {
            console.error('[EditorContents] Template loading error:', e)
          }
        }
      }

      // 4. 템플릿이 로드되지 않았으면 워크스페이스만 초기화
      // 기존 Vue 로직: 템플릿 없어도 setupCanvas 호출하여 빈 캔버스 초기화
      if (!templateLoaded) {
        console.log('[EditorContents] No template loaded, initializing workspace only')
        await initWorkspace()

        // 캔버스 렌더링 요청
        canvas?.requestRenderAll()
      }

      console.log('[EditorContents] Product-based editor loaded successfully')
    } catch (error) {
      console.error('[EditorContents] Product-based editor load error:', error)
      throw error
    } finally {
      editor?.emit('longTask:end')
    }
  }, [editor, canvas, setupProductBased, initWorkspace, setEditorTemplates, fetchSvgContent, setupTemplateFromSvgString])

  const loadContentEditor = useCallback(async (config: ContentEditSetupConfig): Promise<void> => {
    console.log('[EditorContents] Loading content editor', config)
    // TODO: GraphQL로 콘텐츠 데이터 가져와서 로드
    await initWorkspace()
  }, [initWorkspace])

  const loadEmptyEditor = useCallback(async (config?: EmptyEditorSetupConfig): Promise<void> => {
    console.log('[EditorContents] Loading empty editor', config)

    try {
      editor?.emit('longTask:start', { message: '빈 에디터를 준비하는 중...' })

      await setupEmptyEditorStore(config)
      await initWorkspace()

      console.log('[EditorContents] Empty editor loaded successfully')
    } catch (error) {
      console.error('[EditorContents] Empty editor load error:', error)
      throw error
    } finally {
      editor?.emit('longTask:end')
    }
  }, [editor, setupEmptyEditorStore, initWorkspace])

  const loadGeneralEditor = useCallback(async (config?: GeneralSetupConfig): Promise<void> => {
    console.log('[EditorContents] Loading general editor', config)

    try {
      editor?.emit('longTask:start', { message: '에디터를 준비하는 중...' })

      await setupGeneralStore(config)
      await initWorkspace()

      console.log('[EditorContents] General editor loaded successfully')
    } catch (error) {
      console.error('[EditorContents] General editor load error:', error)
      throw error
    } finally {
      editor?.emit('longTask:end')
    }
  }, [editor, setupGeneralStore, initWorkspace])

  /**
   * 템플릿셋 기반 에디터 로드
   * templateSetId로 템플릿셋 정보를 조회하고 모든 템플릿의 canvasData를 각 페이지에 로드
   */
  const loadTemplateSetEditor = useCallback(async (config: TemplateSetBasedSetupConfig): Promise<void> => {
    console.log('[EditorContents] Loading template set editor', config)

    try {
      editor?.emit('longTask:start', { message: '템플릿셋을 불러오는 중...' })

      // 1. 템플릿셋과 템플릿 상세 정보 조회
      const result = await templateSetsApi.getTemplateSetWithTemplates(config.templateSetId)
      const { templateSet, templateDetails: originalTemplateDetails } = result

      console.log('[EditorContents] Template set loaded:', templateSet.name)
      console.log('[EditorContents] Original template details count:', originalTemplateDetails.length)

      // 1-A. 템플릿셋이 지정한 도구 메뉴 화이트리스트를 settings store 에 반영.
      // null/undefined = 모두 노출(legacy/기본). 배열이면 그 키만 ToolBar 에 노출.
      // ToolBar 가 useSettingsStore.enabledMenus 를 구독해 자동 필터링.
      const templateSetEnabledMenus = (templateSet as any).enabledMenus
      setEnabledMenus(
        Array.isArray(templateSetEnabledMenus) ? templateSetEnabledMenus : null
      )

      // 2. EditorMode 확인 및 분기
      // DB의 editorMode를 우선 사용하되, 스프레드 템플릿이 존재하면 book 모드로 자동 전환
      let editorMode = (templateSet as any).editorMode as EditorMode
      const hasSpreadTemplate = originalTemplateDetails.some((t: any) => t.type === 'spread')
      if (hasSpreadTemplate && editorMode !== 'book') {
        console.log('[EditorContents] Spread template detected, switching to book mode')
        editorMode = 'book' as EditorMode
      }
      console.log('[EditorContents] EditorMode:', editorMode)

      if (editorMode === 'book') {
        // ========================================================================
        // Spread Mode 초기화 (§4.5 설계서)
        // ========================================================================
        await loadSpreadModeEditor(config, templateSet, originalTemplateDetails)
        return
      }

      // ========================================================================
      // Single Mode 초기화 (기존 로직)
      // ========================================================================

      // 3. 페이지수 조정 (pageCount 파라미터가 있는 경우)
      let templateDetails = [...originalTemplateDetails]
      const requestedPageCount = config.pageCount

      if (requestedPageCount !== undefined) {
        // 내지(page) 템플릿만 필터링 (API는 type 필드 사용)
        const pageTemplates = templateDetails.filter(t => (t as any).type === 'page')
        const currentPageCount = pageTemplates.length

        console.log(`[EditorContents] Page adjustment: requested=${requestedPageCount}, current=${currentPageCount}`)

        // 방어적 클램프: 호스트가 placeholder/범위 밖 pageCount(예: 1)를 보내도
        // throw 대신 유효 범위로 보정한다 (편집기 진입 보장). 주문 페이지수 불일치는 워커/주문 검증에서 처리.
        let effectivePageCount = requestedPageCount
        const pageCountRange = (templateSet as any).pageCountRange || []
        if (pageCountRange.length > 0) {
          const minPages = Math.min(...pageCountRange)
          const maxPages = Math.max(...pageCountRange)
          if (effectivePageCount < minPages) {
            console.warn(`[EditorContents] pageCount ${effectivePageCount} < 최소 ${minPages} — 템플릿 최소로 보정`)
            effectivePageCount = minPages
          }
          if (effectivePageCount > maxPages) {
            console.warn(`[EditorContents] pageCount ${effectivePageCount} > 최대 ${maxPages} — 템플릿 최대로 보정`)
            effectivePageCount = maxPages
          }
        }
        // 템플릿 실제 내지수보다 적으면 내지수로 보정 (내지 삭제 불가)
        if (effectivePageCount < currentPageCount) {
          console.warn(`[EditorContents] pageCount ${effectivePageCount} < 템플릿 내지수 ${currentPageCount} — 내지수로 보정`)
          effectivePageCount = currentPageCount
        }

        // 페이지수가 더 많으면 마지막 내지 템플릿 복제
        if (effectivePageCount > currentPageCount && pageTemplates.length > 0) {
          const lastPageTemplate = pageTemplates[pageTemplates.length - 1]
          const pagesToAdd = effectivePageCount - currentPageCount

          console.log(`[EditorContents] Adding ${pagesToAdd} pages by cloning last page template`)

          for (let i = 0; i < pagesToAdd; i++) {
            templateDetails.push({
              ...lastPageTemplate,
              id: uuid(),  // 새 ID 생성
              name: `${lastPageTemplate.name || '내지'} (${currentPageCount + i + 1})`,
              order: templateDetails.length,
            } as any)
          }

          console.log(`[EditorContents] Template details after page adjustment: ${templateDetails.length}`)
        }
      }

      // 2. 설정 스토어에 크기 정보 설정
      await setupEmptyEditorStore({
        name: templateSet.name,
        size: {
          width: templateSet.width,
          height: templateSet.height,
          cutSize: 0,
          safeSize: 0,
        },
        unit: 'mm',
      })

      // 3. 템플릿 메타데이터를 설정 스토어에 저장 (페이지 이름 표시용)
       
      const templateMetadata = templateDetails.map((t, index) => ({
        id: t.id,
        type: 'template',
        name: t.name || `Page ${index + 1}`,
        pageType: (t as any).type,  // API는 type 필드 사용
        order: (t as any).order ?? index,
      })) as any[]
      setEditorTemplates(templateMetadata)

      // 4. 모든 템플릿을 각 페이지에 로드
      if (templateDetails.length > 0) {
        // 첫 번째 페이지(이미 존재)에 첫 번째 템플릿 로드
        const firstTemplate = templateDetails[0]
        const firstTemplateType = (firstTemplate as any).type as string

        // 첫 번째 템플릿 크기 결정 (spine, wing은 템플릿 자체 크기)
        let firstTemplateWidth = templateSet.width
        let firstTemplateHeight = templateSet.height
        if ((firstTemplateType === 'spine' || firstTemplateType === 'wing') && firstTemplate.width && firstTemplate.height) {
          firstTemplateWidth = firstTemplate.width
          firstTemplateHeight = firstTemplate.height
          console.log(`[EditorContents] First template uses own size (${firstTemplateType}):`, { width: firstTemplateWidth, height: firstTemplateHeight })
        }

        if (firstTemplate.canvasData) {
          console.log('[EditorContents] Loading first template:', firstTemplate.name, `type=${firstTemplateType}`)
          const canvasData = typeof firstTemplate.canvasData === 'string'
            ? JSON.parse(firstTemplate.canvasData)
            : firstTemplate.canvasData

          // canvasData에 실제 객체가 있는지 확인
          const hasObjects = canvasData?.objects && Array.isArray(canvasData.objects) && canvasData.objects.length > 0
          const hasWorkspace = hasObjects && canvasData.objects.some((obj: any) => obj.id === 'workspace')

          console.log('[EditorContents] First template canvasData analysis:', {
            hasObjects,
            hasWorkspace,
            objectCount: canvasData?.objects?.length || 0
          })

          // canvasData가 비어있거나 workspace가 없으면 initWorkspace만 호출
          if (!hasObjects || !hasWorkspace) {
            console.log('[EditorContents] No objects or workspace in canvasData, initializing workspace only')
            await initWorkspace()
          } else {
            // 첫 번째 템플릿의 canvasData에서 workspace 크기를 템플릿별 크기로 수정
            // (spine, wing 타입은 템플릿 자체 크기, 나머지는 템플릿셋 크기)
            const targetWidth = mmToPxDisplay(firstTemplateWidth)
            const targetHeight = mmToPxDisplay(firstTemplateHeight)

            // canvasData의 workspace 객체 크기 수정
            const modifyWorkspaceInData = (data: any) => {
              if (data && data.objects && Array.isArray(data.objects)) {
                data.objects.forEach((obj: any) => {
                  if (obj.id === 'workspace') {
                    console.log('[EditorContents] Modifying workspace in canvasData:', {
                      original: { width: obj.width, height: obj.height },
                      target: { width: targetWidth, height: targetHeight }
                    })
                    obj.width = targetWidth
                    obj.height = targetHeight
                    obj.scaleX = 1
                    obj.scaleY = 1
                  }
                })
              }
              // top-level width/height도 업데이트 (mm 단위)
              data.width = firstTemplateWidth
              data.height = firstTemplateHeight
              return data
            }

            const canvases = Array.isArray(canvasData)
              ? canvasData.map(modifyWorkspaceInData)
              : [modifyWorkspaceInData(canvasData)]

            await loadCanvasData(canvases)
          }

          // 첫 번째 페이지 workspace 크기 재조정 (템플릿별 크기 적용)
          const firstCanvas = useAppStore.getState().allCanvas[0]
          const firstEditor = useAppStore.getState().allEditors[0]
          if (firstCanvas && firstEditor) {
            // 첫 번째 템플릿 크기 사용 (spine, wing은 템플릿 자체 크기)
            const totalWidth = mmToPxDisplay(firstTemplateWidth)
            const totalHeight = mmToPxDisplay(firstTemplateHeight)

            console.log('[EditorContents] Resizing first page workspace to:', {
              templateType: firstTemplateType,
              mm: { width: firstTemplateWidth, height: firstTemplateHeight },
              px: { width: totalWidth, height: totalHeight }
            })

            const targetObjects = (firstCanvas.getObjects() as fabric.Object[]).filter((obj: fabric.Object) => {
              const extObj = obj as ExtendedFabricObject
              return extObj.id === 'workspace' || extObj.id === 'template-background'
            })

            targetObjects.forEach((obj: fabric.Object) => {
              const extObj = obj as ExtendedFabricObject
              if (extObj.id === 'workspace') {
                obj.set({
                  width: totalWidth,
                  height: totalHeight,
                  scaleX: 1,
                  scaleY: 1
                })
              } else if (extObj.id === 'template-background') {
                if (!extObj.preventAutoResize) {
                  obj.set({
                    scaleX: totalWidth / obj.width!,
                    scaleY: totalHeight / obj.height!
                  })
                }
              }
            })

            ;(firstCanvas.getObjects() as fabric.Object[]).forEach((obj: fabric.Object) => {
              obj.setCoords()
              obj.dirty = true
            })

            // WorkspacePlugin의 내부 옵션 업데이트 및 workspace 객체 크기 조정
            // reset()은 workspace를 새로 생성할 수 있어 기존 객체가 사라지므로 사용하지 않음
            // setOptions는 template-background 등을 다시 변경하므로 사용하지 않음

            const workspacePlugin = firstEditor.getPlugin<any>('WorkspacePlugin')
            if (workspacePlugin) {
              // 플러그인 내부 옵션을 직접 업데이트 (템플릿별 크기 사용)
              if (workspacePlugin._options) {
                workspacePlugin._options.size = {
                  width: firstTemplateWidth,
                  height: firstTemplateHeight,
                  cutSize: 0,
                  safeSize: 0,
                }
              }
              // workspace 객체 참조 업데이트 및 크기 조정
              const workspaceObj = firstCanvas.getObjects().find((obj: fabric.Object) => (obj as ExtendedFabricObject).id === 'workspace')
              if (workspaceObj) {
                workspacePlugin.workspace = workspaceObj

                console.log('[EditorContents] Updating workspace size:', {
                  mm: { width: firstTemplateWidth, height: firstTemplateHeight },
                  px: { width: totalWidth, height: totalHeight }
                })

                workspaceObj.set({
                  width: totalWidth,
                  height: totalHeight,
                  scaleX: 1,
                  scaleY: 1
                })
                workspaceObj.setCoords()

                console.log('[EditorContents] Workspace object after update:', {
                  width: workspaceObj.width,
                  height: workspaceObj.height,
                  scaleX: workspaceObj.scaleX,
                  scaleY: workspaceObj.scaleY
                })
              }

              // requestRenderAll 먼저 호출하여 객체 상태 커밋
              firstCanvas.requestRenderAll()

              // setZoomAuto로 캔버스 중심 재조정 (reset 대신)
              if (workspacePlugin.setZoomAuto) {
                console.log('[EditorContents] Calling setZoomAuto')
                workspacePlugin.setZoomAuto()
              }
            } else {
              firstCanvas.requestRenderAll()
            }
          }
        } else {
          await initWorkspace()
        }

        // 나머지 템플릿들을 추가 페이지로 생성 및 로드
        // createCanvas를 사용하여 모든 플러그인이 초기화된 상태로 생성
        const canvasContainer = document.getElementById('canvas-containers')
        const initId = useAppStore.getState().initializationId

        for (let i = 1; i < templateDetails.length; i++) {
          const template = templateDetails[i]
          const templateType = (template as any).type as string
          console.log(`[EditorContents] Creating page ${i + 1}/${templateDetails.length}:`, template.name, `type=${templateType}`)

          // 템플릿 타입별 크기 결정
          // spine, wing 타입은 템플릿 자체 크기 사용, 나머지는 템플릿셋 크기 사용
          let templateWidth = templateSet.width
          let templateHeight = templateSet.height
          if ((templateType === 'spine' || templateType === 'wing') && template.width && template.height) {
            templateWidth = template.width
            templateHeight = template.height
            console.log(`[EditorContents] Using template-specific size for ${templateType}:`, { width: templateWidth, height: templateHeight })
          }

          // createCanvas를 사용하여 모든 플러그인이 포함된 새 캔버스 생성
          if (canvasContainer) {
            await createCanvas({
              size: {
                width: templateWidth,
                height: templateHeight,
                cutSize: 0,
                safeSize: 0,
              }
            }, canvasContainer, initId || undefined)
          }

          // 새로 추가된 페이지의 인덱스
          const latestAllEditors = useAppStore.getState().allEditors
          const latestAllCanvas = useAppStore.getState().allCanvas
          const newPageIndex = latestAllCanvas.length - 1

          console.log(`[EditorContents] Page created, loading canvasData to page ${newPageIndex}`)

          if (template.canvasData && latestAllEditors[newPageIndex]) {
            const canvasData = typeof template.canvasData === 'string'
              ? JSON.parse(template.canvasData)
              : template.canvasData

            // canvasData에 실제 객체가 있는지 확인 (workspace 제외)
            const dataToCheck = Array.isArray(canvasData) ? canvasData[0] : canvasData
            const hasNonWorkspaceObjects = dataToCheck?.objects && Array.isArray(dataToCheck.objects) &&
              dataToCheck.objects.some((obj: any) => obj.id !== 'workspace')

            // 새 페이지에 canvasData 로드 (실제 객체가 있는 경우에만)
            const targetEditor = latestAllEditors[newPageIndex]
            const servicePlugin = targetEditor.getPlugin<ServicePlugin>('ServicePlugin')
            console.log(`[EditorContents] Loading canvasData to page ${newPageIndex}:`, {
              hasServicePlugin: !!servicePlugin,
              canvasDataType: typeof canvasData,
              isArray: Array.isArray(canvasData),
              hasNonWorkspaceObjects,
            })

            // canvasData에 workspace 외의 객체가 있는 경우에만 loadJSON 호출
            // (빈 canvasData를 로드하면 createCanvas에서 생성된 workspace가 사라짐)
            if (servicePlugin && hasNonWorkspaceObjects) {
              // canvasData가 배열인 경우 첫 번째 요소 사용, 아니면 그대로 사용
              const dataToLoad = Array.isArray(canvasData) ? canvasData[0] : canvasData
              // 클로저를 위해 템플릿 크기 캡처
              const capturedWidth = templateWidth
              const capturedHeight = templateHeight
              await new Promise<void>((resolve) => {
                servicePlugin.loadJSON(dataToLoad, () => {
                  console.log(`[EditorContents] loadJSON completed for page ${newPageIndex}`)

                  // loadJSON 후 workspace 크기 조정
                  // 템플릿 타입별 크기 사용 (spine, wing은 템플릿 자체 크기)
                  const cvs = latestAllCanvas[newPageIndex]
                  if (cvs) {
                    const totalWidth = mmToPxDisplay(capturedWidth)
                    const totalHeight = mmToPxDisplay(capturedHeight)

                    console.log(`[EditorContents] Resizing workspace for page ${newPageIndex}:`, {
                      templateType,
                      mm: { width: capturedWidth, height: capturedHeight },
                      px: { width: totalWidth, height: totalHeight }
                    })

                    const targetObjects = (cvs.getObjects() as fabric.Object[]).filter((obj: fabric.Object) => {
                      const extObj = obj as ExtendedFabricObject
                      return extObj.id === 'workspace' || extObj.id === 'template-background'
                    })

                    targetObjects.forEach((obj: fabric.Object) => {
                      const extObj = obj as ExtendedFabricObject
                      if (extObj.id === 'workspace') {
                        obj.set({
                          width: totalWidth,
                          height: totalHeight,
                          scaleX: 1,
                          scaleY: 1
                        })
                      } else if (extObj.id === 'template-background') {
                        if (!extObj.preventAutoResize) {
                          obj.set({
                            scaleX: totalWidth / obj.width!,
                            scaleY: totalHeight / obj.height!
                          })
                        }
                      }
                    })

                    ;(cvs.getObjects() as fabric.Object[]).forEach((obj: fabric.Object) => {
                      obj.setCoords()
                      obj.dirty = true
                    })

                    cvs.requestRenderAll()
                  }

                  resolve()
                })
              })
            } else {
              console.log(`[EditorContents] Skipping loadJSON for page ${newPageIndex} - no non-workspace objects`)
            }
          } else {
            console.log(`[EditorContents] Skipping canvasData load for page ${newPageIndex}: hasCanvasData=${!!template.canvasData}, hasEditor=${!!latestAllEditors[newPageIndex]}`)
          }
        }

        // 첫 번째 페이지로 돌아가기
        const latestSetPage = useAppStore.getState().setPage
        latestSetPage(0)

        console.log(`[EditorContents] All ${templateDetails.length} templates loaded successfully`)

        // 책등 설정 초기화 및 자동 리사이징
        initSpineConfig(config.paperType || null, config.bindingType || null)

        if (config.paperType && config.bindingType) {
          // 책등 너비 계산 및 적용
          const spineResult = await recalculateSpineWidth({
            paperType: config.paperType,
            bindingType: config.bindingType,
            templateSetHeight: templateSet.height,
          })

          if (spineResult.success) {
            console.log(`[EditorContents] Spine width calculated: ${spineResult.spineWidth}mm`)
          } else if (spineResult.error) {
            console.warn(`[EditorContents] Spine calculation skipped: ${spineResult.error}`)
          }
        }
      } else {
        // 템플릿이 없으면 워크스페이스만 초기화
        console.log('[EditorContents] No templates, initializing workspace only')
        await initWorkspace()
      }

      // useEditorStore.pages 동기화 — BookNavigation 등 페이지 정보 참조 컴포넌트용
      // 단일 모드에서도 책자 네비를 위해 pages 정보 채움
      try {
        if (templateDetails.length > 0) {
          useEditorStore.getState().setPages(
            templateDetails.map((t, idx) => ({
              id: `${t.id}-${idx}`,
              templateId: t.id,
              templateType: ((t as any).type ?? 'page') as any,
              canvasData: t.canvasData,
              sortOrder: idx,
              required: !(t.deleteable ?? true),
              deleteable: (t.deleteable as any) !== false,
            })) as any
          )
          console.log(`[EditorContents] useEditorStore.setPages with ${templateDetails.length} pages`)
        }
      } catch (err) {
        console.warn('[EditorContents] setPages sync failed:', err)
      }

      console.log('[EditorContents] Template set editor loaded successfully')
    } catch (error) {
      console.error('[EditorContents] Template set editor load error:', error)
      throw error
    } finally {
      editor?.emit('longTask:end')
    }

    /**
     * Spread Mode 전용 에디터 로드 헬퍼 함수
     */
    async function loadSpreadModeEditor(
      config: TemplateSetBasedSetupConfig,
      templateSet: any,
      originalTemplateDetails: any[]
    ): Promise<void> {
      console.log('[EditorContents:Spread] Loading spread mode editor')

      // 1. spread 템플릿 찾기 (type === 'spread')
      const spreadTemplate = originalTemplateDetails.find((t: any) => t.type === 'spread')
      if (!spreadTemplate) {
        throw new Error('Spread 템플릿을 찾을 수 없습니다.')
      }

      // 2. SpreadSpec 구성
      const spreadSpec = buildSpreadSpec({
        template: spreadTemplate,
        cutSizeMm: 2,
        safeSizeMm: 3,
        dpi: 150,
      })

      if (!spreadSpec) {
        throw new Error('SpreadSpec 구성에 실패했습니다.')
      }

      console.log('[EditorContents:Spread] SpreadSpec built:', spreadSpec)

      // 3. computeLayout으로 완전한 SpreadConfig 계산
      const spreadLayout = computeLayout(spreadSpec)
      const spreadConfig: SpreadConfig = {
        version: 1,
        spec: spreadSpec,
        regions: spreadLayout.regions,
        totalWidthMm: spreadLayout.totalWidthMm,
        totalHeightMm: spreadLayout.totalHeightMm,
      }

      console.log('[EditorContents:Spread] SpreadConfig calculated:', spreadConfig)

      // 4. settingsStore에 SpreadConfig 저장
      useSettingsStore.getState().setSpreadConfig(spreadConfig)

      // 5. 빈 에디터 스토어 설정 (spread 캔버스용 - totalWidth/Height 사용)
      await setupEmptyEditorStore({
        name: templateSet.name,
        size: {
          width: spreadConfig.totalWidthMm,
          height: spreadConfig.totalHeightMm,
          cutSize: spreadSpec.cutSizeMm,
          safeSize: spreadSpec.safeSizeMm,
        },
        unit: 'mm',
      })

      // 5-1. 워크스페이스 초기화 + canvasData 로드
      // NOTE: SpreadPlugin 등록보다 먼저 실행해야 함.
      // WorkspacePlugin.init() → reset()이 모든 비-workspace 객체를 제거하므로,
      // SpreadPlugin의 가이드/라벨이 제거되는 것을 방지하기 위함.
      const spreadCanvasData = spreadTemplate.canvasData
        ? typeof spreadTemplate.canvasData === 'string'
          ? JSON.parse(spreadTemplate.canvasData)
          : spreadTemplate.canvasData
        : null

      // canvasData에 실제 객체가 있는지 확인
      const hasObjects = spreadCanvasData && (
        Array.isArray(spreadCanvasData)
          ? spreadCanvasData.some((c: any) => c?.objects?.length > 0)
          : spreadCanvasData?.objects?.length > 0
      )

      if (hasObjects) {
        console.log('[EditorContents:Spread] Loading spread canvas data with objects')
        const canvases = Array.isArray(spreadCanvasData) ? spreadCanvasData : [spreadCanvasData]
        await loadCanvasData(canvases)
      } else {
        console.log('[EditorContents:Spread] No spread objects, initializing workspace only')
        await initWorkspace()
      }

      // 6. SpreadPlugin 동적 등록 (워크스페이스 초기화 이후)
      // createCanvas()는 spreadConfig 설정 전에 실행되므로 SpreadPlugin이 미등록 상태.
      // 여기서 직접 생성하여 editor에 등록한다.
      // initWorkspace() 이후에 등록해야 가이드/라벨이 reset()에 의해 제거되지 않음.
      const latestAppStore = useAppStore.getState()
      const latestCanvas = latestAppStore.canvas
      const latestEditor = latestAppStore.editor

      if (latestCanvas && latestEditor) {
        const existingSpread = latestEditor.getPlugin('SpreadPlugin')
        if (!existingSpread) {
          console.log('[EditorContents:Spread] Dynamically registering SpreadPlugin')
          const spreadPlugin = new SpreadPlugin(latestCanvas, latestEditor, { spec: spreadSpec })
          latestEditor.use(spreadPlugin)
          // init() 호출하여 currentLayout 설정 + 가이드/라벨 렌더링
          spreadPlugin.init()
        }
      }

      // 7. isSpreadMode 설정
      useAppStore.getState().setSpreadMode(true)

      // 7-1. 책등 설정 초기화 (내지 추가 시 debouncedRecalcSpine이 호출되므로 미리 설정)
      initSpineConfig(config.paperType || null, config.bindingType || null)

      // 8. 내지 페이지 템플릿 필터링 (type === 'page')
      const pageTemplates = originalTemplateDetails.filter((t: any) => t.type === 'page')
      console.log('[EditorContents:Spread] Page templates count:', pageTemplates.length)

      // 9. 페이지수 조정 (config.pageCount가 있는 경우)
      let adjustedPageTemplates = [...pageTemplates]
      const requestedPageCount = config.pageCount

      if (requestedPageCount !== undefined) {
        const currentPageCount = pageTemplates.length

        console.log(`[EditorContents:Spread] Page adjustment: requested=${requestedPageCount}, current=${currentPageCount}`)

        // 방어적 클램프: 호스트가 placeholder/범위 밖 pageCount(예: 1)를 보내도
        // throw 대신 유효 범위로 보정한다 (편집기 진입 보장 — 게스트 폴백과 동일 철학).
        // 실제 주문 페이지수 불일치는 워커/주문 검증에서 별도로 잡힌다.
        let effectivePageCount = requestedPageCount
        const pageCountRange = (templateSet as any).pageCountRange || []
        if (pageCountRange.length > 0) {
          const minPages = Math.min(...pageCountRange)
          const maxPages = Math.max(...pageCountRange)
          if (effectivePageCount < minPages) {
            console.warn(`[EditorContents:Spread] pageCount ${effectivePageCount} < 최소 ${minPages} — 템플릿 최소로 보정`)
            effectivePageCount = minPages
          }
          if (effectivePageCount > maxPages) {
            console.warn(`[EditorContents:Spread] pageCount ${effectivePageCount} > 최대 ${maxPages} — 템플릿 최대로 보정`)
            effectivePageCount = maxPages
          }
        }
        // 템플릿 실제 내지수보다 적으면 내지수로 보정 (내지 삭제 불가)
        if (effectivePageCount < currentPageCount) {
          console.warn(`[EditorContents:Spread] pageCount ${effectivePageCount} < 템플릿 내지수 ${currentPageCount} — 내지수로 보정`)
          effectivePageCount = currentPageCount
        }

        // 페이지수가 더 많으면 마지막 내지 템플릿 복제
        if (effectivePageCount > currentPageCount && pageTemplates.length > 0) {
          const lastPageTemplate = pageTemplates[pageTemplates.length - 1]
          const pagesToAdd = effectivePageCount - currentPageCount

          console.log(`[EditorContents:Spread] Adding ${pagesToAdd} pages by cloning last page template`)

          for (let i = 0; i < pagesToAdd; i++) {
            adjustedPageTemplates.push({
              ...lastPageTemplate,
              id: uuid(),
              name: `${lastPageTemplate.name || '내지'} (${currentPageCount + i + 1})`,
              order: adjustedPageTemplates.length,
            })
          }

          console.log(`[EditorContents:Spread] Adjusted page templates count: ${adjustedPageTemplates.length}`)
        }
      }

      // 10. 내지 페이지 캔버스 생성 및 로드
      if (adjustedPageTemplates.length > 0) {
        const appStore = useAppStore.getState()
        // 초기화 세션 ID 캡처 (React Strict Mode 대응: 루프 중 초기화가 취소되면 중단)
        const capturedInitId = useAppStore.getState().initializationId

        for (let i = 0; i < adjustedPageTemplates.length; i++) {
          // 초기화 세션이 바뀌었으면 루프 중단 (Strict Mode 두 번째 마운트가 reset/restart한 경우)
          if (useAppStore.getState().initializationId !== capturedInitId) {
            console.warn(`[EditorContents:Spread] initializationId changed during inner page creation (page ${i + 1}), aborting loop`)
            return
          }

          const pageTemplate = adjustedPageTemplates[i]

          console.log(`[EditorContents:Spread] Creating inner page ${i + 1}/${adjustedPageTemplates.length}`)

          // 내지 페이지 추가 (addInnerPage는 debounced spine 계산 포함)
          await appStore.addInnerPage()

          // 최신 상태 가져오기
          const latestAllCanvas = useAppStore.getState().allCanvas
          const latestAllEditors = useAppStore.getState().allEditors
          const newPageIndex = latestAllCanvas.length - 1

          // canvasData가 있으면 로드
          if (pageTemplate.canvasData) {
            const canvasData = typeof pageTemplate.canvasData === 'string'
              ? JSON.parse(pageTemplate.canvasData)
              : pageTemplate.canvasData

            // canvasData에 실제 객체가 있는지 확인 (workspace 제외)
            const dataToCheck = Array.isArray(canvasData) ? canvasData[0] : canvasData
            const hasNonWorkspaceObjects = dataToCheck?.objects && Array.isArray(dataToCheck.objects) &&
              dataToCheck.objects.some((obj: any) => obj.id !== 'workspace')

            const targetEditor = latestAllEditors[newPageIndex]
            const servicePlugin = targetEditor.getPlugin<ServicePlugin>('ServicePlugin')

            console.log(`[EditorContents:Spread] Loading canvasData to inner page ${newPageIndex}:`, {
              hasServicePlugin: !!servicePlugin,
              hasNonWorkspaceObjects,
            })

            if (servicePlugin && hasNonWorkspaceObjects) {
              const dataToLoad = Array.isArray(canvasData) ? canvasData[0] : canvasData
              await new Promise<void>((resolve) => {
                // loadJSON 콜백 미발생 시 hang 방지 타임아웃 가드(오버레이 영구표시 방지)
                let settled = false
                const settle = () => { if (!settled) { settled = true; resolve() } }
                const guardTimer = setTimeout(() => {
                  console.warn(`[EditorContents:Spread] loadJSON 타임아웃(inner page ${newPageIndex}) — 계속 진행`)
                  settle()
                }, 12000)
                servicePlugin.loadJSON(dataToLoad, () => {
                  console.log(`[EditorContents:Spread] loadJSON completed for inner page ${newPageIndex}`)
                  clearTimeout(guardTimer)
                  settle()
                })
              })
            } else {
              console.log(`[EditorContents:Spread] Skipping loadJSON for inner page ${newPageIndex} - no non-workspace objects`)
            }
          }
        }

        // 첫 번째 페이지(spread 캔버스)로 돌아가기
        appStore.setPage(0)

        console.log(`[EditorContents:Spread] All ${adjustedPageTemplates.length} inner pages loaded`)
      }

      // 10-1. useEditorStore.pages 설정 (SpreadPagePanel이 참조)
      const editorPages: EditPage[] = []

      // 스프레드 페이지 (index 0)
      editorPages.push({
        id: spreadTemplate.id,
        templateId: spreadTemplate.id,
        templateType: TemplateType.SPREAD,
        canvasData: { version: '5.3.0', objects: [], width: spreadConfig.totalWidthMm, height: spreadConfig.totalHeightMm },
        sortOrder: 0,
        required: true,
        deleteable: false,
      })

      // 내지 페이지들
      for (let i = 0; i < adjustedPageTemplates.length; i++) {
        const pt = adjustedPageTemplates[i]
        editorPages.push({
          id: pt.id,
          templateId: pt.id,
          templateType: TemplateType.PAGE,
          canvasData: { version: '5.3.0', objects: [], width: spreadSpec.coverWidthMm, height: spreadSpec.coverHeightMm },
          sortOrder: i + 1,
          required: pt.required !== false,
          deleteable: pt.required === false,
        })
      }

      const editorStore = useEditorStore.getState()
      editorStore.setPages(editorPages)

      // canAddPage, pageCountRange도 설정
      useEditorStore.setState({
        canAddPage: templateSet.canAddPage ?? true,
        pageCountRange: templateSet.pageCountRange ?? [],
        templateSetId: templateSet.id,
        templateSetName: templateSet.name,
      })

      console.log(`[EditorContents:Spread] EditorStore pages set: ${editorPages.length} pages`)

      // 11. 템플릿 메타데이터 저장 (스프레드 모드용)
      const spreadMetadata = {
        id: spreadTemplate.id,
        type: 'template',
        name: spreadTemplate.name || 'Spread',
        pageType: 'spread',
        order: 0,
      }

      const pageMetadata = adjustedPageTemplates.map((t: any, index: number) => ({
        id: t.id,
        type: 'template',
        name: t.name || `Page ${index + 1}`,
        pageType: 'page',
        order: index + 1,
      }))

      setEditorTemplates([spreadMetadata, ...pageMetadata])

      // 12. 책등 자동 리사이징 (initSpineConfig는 step 7-1에서 이미 호출됨)
      if (config.paperType && config.bindingType) {
        const spineResult = await recalculateSpineWidth({
          paperType: config.paperType,
          bindingType: config.bindingType,
        })

        if (spineResult.success) {
          console.log(`[EditorContents:Spread] Spine width calculated: ${spineResult.spineWidth}mm`)
        } else if (spineResult.error) {
          console.warn(`[EditorContents:Spread] Spine calculation skipped: ${spineResult.error}`)
        }
      }

      console.log('[EditorContents:Spread] Spread mode editor loaded successfully')
    }
  }, [editor, setupEmptyEditorStore, setEditorTemplates, initWorkspace, loadCanvasData])

  /**
   * 템플릿 콘텐츠 설정
   */
  const setupTemplateContent = useCallback(async (content: EditorTemplate): Promise<void> => {
    const templateUrl = safeGetTemplateUrl(content)
    if (!templateUrl) {
      console.error('템플릿 콘텐츠에 디자인 URL이 없습니다.')
      return
    }

    try {
      const svgString = await fetchSvgContent(templateUrl)
      const cutLineSvgUrl = safeGetCutLineTemplateUrl(content)
      const cutLineSvgString = cutLineSvgUrl ? await fetchSvgContent(cutLineSvgUrl) : null
      await setupTemplateFromSvgString(svgString, cutLineSvgString)
    } catch (e) {
      console.error('템플릿 콘텐츠 설정 오류:', e)
    }
  }, [fetchSvgContent, setupTemplateFromSvgString])

  /**
   * 프레임 콘텐츠 설정
   */
  const setupFrameContent = useCallback(async (content: EditorContent, targetCanvas: fabric.Canvas): Promise<void> => {
    const imageUrl = safeGetImageUrl(content)
    if (!imageUrl) {
      console.error('프레임 콘텐츠에 이미지 URL이 없습니다.')
      return
    }

    try {
      const workspace = targetCanvas?.getObjects().find((obj) => (obj as ExtendedFabricObject).id === 'workspace')
      if (!workspace) {
        console.error('워크스페이스를 찾을 수 없습니다.')
        return
      }

      const asset = await addAssetToCanvas(imageUrl, content.id)
      if (asset) {
        const centerPoint = workspace.getCenterPoint()
        ;(asset as ExtendedFabricObject).extensionType = 'frame'
        asset.set({
          left: centerPoint.x,
          top: centerPoint.y,
          originX: 'center',
          originY: 'center'
        })
        targetCanvas?.requestRenderAll()
      }
    } catch (e) {
      console.error('프레임 콘텐츠 설정 오류:', e)
    }
  }, [addAssetToCanvas])

  return {
    loadContent,
    loadCanvasData,
    loadEditDesign,
    setupAsset,
    setupEditContent,
    setupTemplateFromSvgString,
    setupTemplateContent,
    setupFrameContent,
    addAssetToCanvas,
    setAsBackground,
    loadForUseCase,
    loadProductBasedEditor,
    loadContentEditor,
    loadEmptyEditor,
    loadGeneralEditor,
    loadTemplateSetEditor,
  }
}
