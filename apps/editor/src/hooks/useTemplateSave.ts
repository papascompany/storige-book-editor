import { useCallback, useState } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { ServicePlugin, core } from '@storige/canvas-core'
import { templatesApi, storageApi } from '@/api'
import type { CreateTemplateDto, UpdateTemplateDto, Template } from '@/api/templates'
import type { CanvasData, TemplateType, SpreadConfig } from '@storige/types'

// Fabric.js 타입 (런타임에 로드됨)
 
type FabricObject = any

export interface UseTemplateSaveReturn {
  saving: boolean
  templateId: string | null
  saveTemplate: (options: SaveTemplateOptions) => Promise<Template | null>
  updateExistingTemplate: (id: string, options: UpdateTemplateOptions) => Promise<Template | null>
}

export interface SaveTemplateOptions {
  name: string
  type?: TemplateType
  width?: number
  height?: number
  categoryId?: string
  isActive?: boolean
  spreadConfig?: SpreadConfig
}

export interface UpdateTemplateOptions {
  name?: string
  type?: TemplateType
  width?: number
  height?: number
  categoryId?: string
  isActive?: boolean
  spreadConfig?: SpreadConfig
}

/**
 * Template Save Hook
 * 템플릿 저장을 위한 React Hook
 */
export function useTemplateSave(): UseTemplateSaveReturn {
  const [saving, setSaving] = useState(false)
  const [templateId, setTemplateId] = useState<string | null>(null)

  // Zustand stores
  const canvas = useAppStore((state) => state.canvas)
  const editor = useAppStore((state) => state.editor)
  const currentSettings = useSettingsStore((state) => state.currentSettings)

  /**
   * 캔버스 데이터를 CanvasData 형식으로 가져오기
   */
  const getCanvasData = useCallback(async (): Promise<CanvasData> => {
    if (!canvas || !editor) {
      throw new Error('캔버스가 초기화되지 않았습니다')
    }

    const plugin = editor.getPlugin('ServicePlugin') as ServicePlugin
    if (!plugin) {
      throw new Error('서비스 플러그인을 찾을 수 없습니다')
    }

    const jsonString = await plugin.saveJSON()
    const canvasJson = JSON.parse(jsonString)

    // CanvasData 형식으로 변환
    const canvasData: CanvasData = {
      version: canvasJson.version || '1.0.0',
      width: currentSettings.size?.width || canvasJson.width || 800,
      height: currentSettings.size?.height || canvasJson.height || 600,
      objects: canvasJson.objects || [],
      background: canvasJson.background,
    }

    return canvasData
  }, [canvas, editor, currentSettings])

  /**
   * 썸네일 생성 및 업로드
   */
  const generateAndUploadThumbnail = useCallback(async (templateName: string): Promise<string | undefined> => {
    if (!canvas || !editor) return undefined

    const workspace = canvas.getObjects().find((obj: FabricObject) => obj.id === 'workspace')
    if (!workspace) return undefined

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

      // 썸네일 업로드
      const response = await fetch(dataURL)
      const thumbnailBlob = await response.blob()
      const timestamp = new Date().getTime()
      const thumbnailFileName = `template_${templateName.replace(/[^a-zA-Z0-9가-힣]/g, '_')}_${timestamp}.png`
      const uploadResult = await storageApi.uploadDesign(thumbnailBlob, thumbnailFileName)

      return uploadResult.data?.url
    } catch (error) {
      console.error('썸네일 생성 실패:', error)
      return undefined
    }
  }, [canvas, editor])

  /**
   * 새 템플릿 저장
   */
  const saveTemplate = useCallback(async (options: SaveTemplateOptions): Promise<Template | null> => {
    if (saving) {
      console.warn('저장 중입니다. 잠시만 기다려주세요.')
      return null
    }

    try {
      setSaving(true)
      console.log('템플릿을 저장하는 중입니다...')

      // 캔버스 데이터 가져오기
      const canvasData = await getCanvasData()

      // 썸네일 생성 및 업로드
      const thumbnailUrl = await generateAndUploadThumbnail(options.name)

      // 템플릿 생성 DTO
      const createDto: CreateTemplateDto = {
        name: options.name,
        type: options.type || 'page',
        width: options.width || currentSettings.size?.width || 210,
        height: options.height || currentSettings.size?.height || 297,
        categoryId: options.categoryId,
        thumbnailUrl,
        canvasData,
        spreadConfig: options.spreadConfig,
        isActive: options.isActive ?? true,
      }

      // API 호출
      const template = await templatesApi.createTemplate(createDto)
      setTemplateId(template.id)

      console.log('템플릿이 성공적으로 저장되었습니다:', template.id)
      return template
    } catch (error) {
      console.error('템플릿 저장 오류:', error)
      throw error
    } finally {
      setSaving(false)
    }
  }, [saving, getCanvasData, generateAndUploadThumbnail, currentSettings])

  /**
   * 기존 템플릿 업데이트
   */
  const updateExistingTemplate = useCallback(async (id: string, options: UpdateTemplateOptions): Promise<Template | null> => {
    if (saving) {
      console.warn('저장 중입니다. 잠시만 기다려주세요.')
      return null
    }

    try {
      setSaving(true)
      console.log('템플릿을 업데이트하는 중입니다...')

      // 캔버스 데이터 가져오기
      const canvasData = await getCanvasData()

      // 썸네일 생성 및 업로드
      const thumbnailUrl = await generateAndUploadThumbnail(options.name || 'template')

      // 템플릿 업데이트 DTO — 명시 안 된(undefined) 메타 필드는 dto 에서 제외해
      // 기존 DB 값을 보존한다. (2026-05-19 fix)
      // 이전엔 type/width/height 가 undefined 면 entity 의 기존 값을 덮을 위험은
      // 없지만 호출자가 잘못된 기본값(PAGE/210/297)을 보내면 spread 표지가 page 로
      // 덮어씌워지는 사고가 발생 → 호출 측 + 여기 둘 다 가드.
      const updateDto: UpdateTemplateDto = {
        thumbnailUrl,
        canvasData,
      }
      if (options.name !== undefined) updateDto.name = options.name
      if (options.type !== undefined) updateDto.type = options.type
      if (options.width !== undefined) updateDto.width = options.width
      if (options.height !== undefined) updateDto.height = options.height
      if (options.categoryId !== undefined) updateDto.categoryId = options.categoryId
      if (options.spreadConfig !== undefined) updateDto.spreadConfig = options.spreadConfig
      if (options.isActive !== undefined) updateDto.isActive = options.isActive

      // API 호출
      const template = await templatesApi.updateTemplate(id, updateDto)
      setTemplateId(template.id)

      console.log('템플릿이 성공적으로 업데이트되었습니다:', template.id)
      return template
    } catch (error) {
      console.error('템플릿 업데이트 오류:', error)
      throw error
    } finally {
      setSaving(false)
    }
  }, [saving, getCanvasData, generateAndUploadThumbnail])

  return {
    saving,
    templateId,
    saveTemplate,
    updateExistingTemplate,
  }
}
