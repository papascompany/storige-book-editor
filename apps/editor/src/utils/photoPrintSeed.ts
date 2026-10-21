import { mmToPxDisplay, type ServicePlugin } from '@storige/canvas-core'
import type { fabric } from 'fabric'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore, type LinkedPrintTemplate } from '@/stores/useSettingsStore'
import { applyObjectPermissions } from '@/utils/objectPermissions'
import { trackRequiredEdits } from '@/utils/requiredEditGate'
import { rebindFrameInteractivity } from '@/utils/frameInteractive'
import { isPhotoPrintProfile, type PhotoPrintProductProfile } from '@/utils/productProfile'
import { photoPrintStride, rehydratePhotoPrint } from '@/utils/photoPrintRehydrate'

/**
 * photoPrintSeed.ts — 사진인화 페이지 추가 시 캔버스 시드 (P2-d, 2026-10-19; 계약 결정 7)
 *
 * SidePanel '페이지 추가' 로 만든 빈 캔버스 k 에 템플릿셋 refs[k % refs.length](settings.linkedPrintTemplates,
 * digital = [앞, 뒤] / chemical = [앞]) 의 canvasData 를 useEditorContents 의 세트 페이지 로드와 같은
 * ServicePlugin.loadJSON 경로로 앉히고, 초기 페이지 로드와 같은 초기화(사진틀 인터랙션 재바인딩·
 * applyObjectPermissions(canvas, editMode)·trackRequiredEdits)와 PhotoPrintPlugin rehydrate 를 수행한다(editor-flow-7/D6:
 * editMode(관리자)에서는 잠그지 않고, 고객 세션의 시드 앞면도 초기 페이지와 같은 보호·필수편집 추적을 받는다).
 * composition 'per-photo-fixed-back' 의 뒷면(digital 홀수 캔버스)은 로드 객체 전부에
 * movable/deleteable/contentEditable=false 를 먼저 강제한다.
 *
 * 게이트: 프로파일이 사진인화가 아니거나 refs/캔버스/에디터/ServicePlugin 이 없으면 false(no-op).
 */

interface SeedObject {
  id?: string
  movable?: boolean
  deleteable?: boolean
  contentEditable?: boolean
  preventAutoResize?: boolean
}

function parseCanvasData(raw: LinkedPrintTemplate['canvasData'] | string | undefined): Record<string, unknown> | null {
  if (!raw) return null
  let data: unknown = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (Array.isArray(data)) data = data[0]
  if (typeof data !== 'object' || data === null) return null
  const objects = (data as { objects?: unknown }).objects
  if (!Array.isArray(objects) || !objects.some((o) => (o as SeedObject | null)?.id !== 'workspace')) return null
  return data as Record<string, unknown>
}

/** 뒷면 잠금: workspace 를 제외한 모든 로드 객체에 편집 금지 플래그 강제 */
export function lockSeededObjects(canvas: fabric.Canvas): number {
  let count = 0
  for (const obj of canvas.getObjects() as Array<fabric.Object & SeedObject>) {
    if (obj.id === 'workspace') continue
    obj.set({ movable: false, deleteable: false, contentEditable: false } as Partial<fabric.Object>)
    count += 1
  }
  return count
}

/**
 * 시드/초기 캔버스 공통 초기화 (D11, 2026-10-21): ② 고정 뒷면(digital 홀수 캔버스) 잠금 → 사진틀 재바인딩 →
 * applyObjectPermissions(canvas, editMode) → trackRequiredEdits. loadJSON 콜백 안(= canvas-core TemplatePlugin.afterLoad 가
 * 텍스트의 hasControls/lockScaling 을 되살린 **뒤**)에서 불러야 잠금이 유지된다. 페이지 추가(seedPhotoPrintCanvas)와
 * 템플릿셋 초기 로드(useEditorContents 2번째 이후 페이지)가 같은 함수를 쓴다 — 초기 페이지만 applyCustomerLocks 를
 * 건너뛰어 고정 뒷면 textbox 가 hasControls true·lockScaling false·editable true 로 남던 결함(D11)의 수정.
 * 사진인화 세트 전용(호출측 게이트) — 프로파일 NULL 세트의 로더 동작은 바꾸지 않는다.
 */
export function initPhotoPrintSeededCanvas(
  editor: Parameters<typeof rebindFrameInteractivity>[0],
  canvas: fabric.Canvas,
  canvasIndex: number,
  profile: PhotoPrintProductProfile,
): { lockedBack: boolean } {
  const stride = photoPrintStride(profile.photoPrint)
  const isBackFace = stride === 2 && canvasIndex % 2 === 1
  const lockedBack = isBackFace && profile.photoPrint.composition === 'per-photo-fixed-back'
  if (lockedBack) lockSeededObjects(canvas)
  rebindFrameInteractivity(editor, canvas)
  // 초기 페이지(useEditorContents 세트 로드·embed 복원)와 같은 보호·필수편집 추적 — editMode 면 잠그지 않는다.
  applyObjectPermissions(canvas, useSettingsStore.getState().currentSettings.editMode)
  trackRequiredEdits(canvas)
  return { lockedBack }
}

/**
 * 캔버스 k 를 템플릿셋 refs[k % refs.length] 로 시드한다.
 * @returns 시드했으면 true(프로파일 없음·템플릿 없음·캔버스 없음이면 false)
 */
export async function seedPhotoPrintCanvas(canvasIndex: number): Promise<boolean> {
  const settings = useSettingsStore.getState()
  const profile = settings.productProfile
  if (!isPhotoPrintProfile(profile)) return false
  const refs = settings.linkedPrintTemplates
  if (!Number.isInteger(canvasIndex) || canvasIndex < 0 || refs.length === 0) return false
  const { allCanvas, allEditors } = useAppStore.getState()
  const canvas = allCanvas[canvasIndex]
  const editor = allEditors[canvasIndex]
  if (!canvas || !editor) return false
  const servicePlugin = editor.getPlugin<ServicePlugin>('ServicePlugin')
  if (!servicePlugin) return false

  const ref = refs[canvasIndex % refs.length]
  const data = parseCanvasData(ref.canvasData)
  if (!data) {
    console.warn(`[photoPrintSeed] 템플릿 ${ref.id} 에 로드할 객체 없음 — 캔버스 ${canvasIndex} 빈 상태 유지`)
    return false
  }

  await new Promise<void>((resolve) => {
    servicePlugin.loadJSON(data, () => {
      try {
        // useEditorContents 의 세트 페이지 로드와 같은 workspace 치수 보정(trim + cutSize 양변 합)
        const size = useSettingsStore.getState().currentSettings.size
        const totalWidth = mmToPxDisplay(size.width + (size.cutSize ?? 0))
        const totalHeight = mmToPxDisplay(size.height + (size.cutSize ?? 0))
        for (const obj of canvas.getObjects() as Array<fabric.Object & SeedObject>) {
          if (obj.id === 'workspace') {
            obj.set({ width: totalWidth, height: totalHeight, scaleX: 1, scaleY: 1 })
          } else if (obj.id === 'template-background' && !obj.preventAutoResize && obj.width && obj.height) {
            obj.set({ scaleX: totalWidth / obj.width, scaleY: totalHeight / obj.height })
          }
        }
        for (const obj of canvas.getObjects() as fabric.Object[]) {
          obj.setCoords()
          obj.dirty = true
        }
        initPhotoPrintSeededCanvas(editor, canvas, canvasIndex, profile)
        canvas.requestRenderAll()
      } finally {
        resolve()
      }
    })
  })

  await rehydratePhotoPrint(editor, canvas, canvasIndex)
  return true
}
