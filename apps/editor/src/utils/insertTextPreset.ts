/**
 * 텍스트 프리셋 삽입 로직 — S-E3 (AppText 프리셋 섹션에서 사용)
 *
 * AppText.addText 의 기존 규약 보존:
 * - 워크스페이스 필수(없으면 null 반환 — 호출 측이 안내)
 * - offHistory → 객체 완성 → onHistory → add : 삽입이 히스토리 1엔트리
 * - FontPlugin.applyFont 경로로 폰트 로드(실패 시 Arial 폴백)
 */

import { v4 as uuid } from 'uuid'
import {
  applyCurveToText,
  radiusForTextOnArc,
  type FontPlugin,
} from '@storige/canvas-core'
import {
  presetFontSize,
  type TextStylePresetDef,
  type CurveTextPresetDef,
} from '@/constants/textPresets'

interface InsertOptions {
  canvas: any
  fontPlugin?: FontPlugin | null
  defaultFontFamily: string
  /** true 면 삽입 직후 인라인 편집 진입 + 전체 선택 (스타일 프리셋용) */
  enterEditing?: boolean
}

/** 워크스페이스 탐색 — 없으면 null (addText 의 alert 는 호출 측 책임) */
function findWorkspace(canvas: any): any | null {
  const workspace = canvas.getObjects().find((obj: any) => obj.id === 'workspace')
  return workspace || null
}

async function createPresetText(
  canvas: any,
  options: InsertOptions,
  init: {
    sampleText: string
    fontSizeRatio: number
    fontFamily?: string
    fontWeight?: 'normal' | 'bold'
    letterSpacing?: number
    lineHeight?: number
  }
): Promise<any | null> {
  const workspace = findWorkspace(canvas)
  if (!workspace) return null

  const workspaceWidth = (workspace.width || 0) * (workspace.scaleX || 1)
  const workspaceHeight = (workspace.height || 0) * (workspace.scaleY || 1)
  const fontSize = presetFontSize(workspaceWidth, workspaceHeight, init.fontSizeRatio)

  // Dynamic import fabric (AppText 와 동일 패턴)
  const fabricModule = (await import('fabric')) as any
  const fabric = fabricModule.fabric || fabricModule.default || fabricModule

  const fontFamily = init.fontFamily || options.defaultFontFamily

  const text = new fabric.IText(init.sampleText, {
    fontFamily,
    fontSize,
    fill: '#000000',
    fillOpacity: 100,
    textAlign: 'center',
    id: uuid(),
    originX: 'center',
    originY: 'center',
    scaleX: 1,
    scaleY: 1,
    lockUniScaling: true,
    centeredScaling: false,
    lockScalingFlip: true,
    lockScalingX: false,
    lockScalingY: false,
    hasControls: true,
    ...(init.fontWeight ? { fontWeight: init.fontWeight } : {}),
    ...(init.letterSpacing !== undefined ? { charSpacing: init.letterSpacing } : {}),
    ...(init.lineHeight !== undefined ? { lineHeight: init.lineHeight } : {}),
  })

  // Position at workspace center
  const center = workspace.getCenterPoint()
  text.set({
    originX: 'center',
    originY: 'center',
    left: center.x,
    top: center.y,
  })

  // Apply font via FontPlugin (addText 와 동일 — 실패 시 폴백)
  if (options.fontPlugin) {
    try {
      await options.fontPlugin.applyFont(fontFamily, text)
    } catch (error) {
      console.warn('프리셋 텍스트 폰트 적용 실패, 기본 폰트 사용:', error)
      text.set('fontFamily', 'Arial, sans-serif')
    }
  }

  return text
}

/** 완성된 객체를 캔버스에 추가 — 히스토리 1엔트리 + 활성화 + 렌더 */
function commitToCanvas(canvas: any, text: any, enterEditing: boolean): void {
  canvas.onHistory?.()
  canvas.add(text)
  canvas.setActiveObject(text)
  // renderOnAddRemove: false 인 캔버스에서 add 후 명시적 렌더링 필수.
  canvas.requestRenderAll()

  if (enterEditing && typeof text.enterEditing === 'function') {
    text.enterEditing()
    text.selectAll()
    canvas.requestRenderAll()
  }
}

/**
 * 스타일 프리셋(제목/부제목/본문) 삽입.
 * @returns 삽입된 IText, 워크스페이스 부재 시 null
 */
export async function insertStylePreset(
  preset: TextStylePresetDef,
  options: InsertOptions
): Promise<any | null> {
  const { canvas } = options
  if (!canvas) return null

  canvas.offHistory?.()

  const text = await createPresetText(canvas, options, {
    sampleText: preset.sampleText,
    fontSizeRatio: preset.sizeRatio,
    fontFamily: preset.fontFamily,
    fontWeight: preset.fontWeight,
    letterSpacing: preset.letterSpacing,
    lineHeight: preset.lineHeight,
  })
  if (!text) {
    canvas.onHistory?.()
    return null
  }

  commitToCanvas(canvas, text, options.enterEditing ?? true)
  return text
}

/**
 * 곡선 프리셋(위 아치/아래 아치/웨이브/원형) 삽입.
 * 텍스트 생성 → 폭 실측 → 곡선 파라미터 계산 → path 적용 → 캔버스 추가.
 * 곡선 모드는 삽입 직후 편집 진입을 하지 않는다(패스 위 커서 UX — 더블클릭으로 진입).
 * @returns 삽입된 IText, 워크스페이스 부재 시 null
 */
export async function insertCurvePreset(
  preset: CurveTextPresetDef,
  options: InsertOptions
): Promise<any | null> {
  const { canvas } = options
  if (!canvas) return null

  canvas.offHistory?.()

  const text = await createPresetText(canvas, options, {
    sampleText: preset.sampleText,
    fontSizeRatio: preset.sizeRatio,
  })
  if (!text) {
    canvas.onHistory?.()
    return null
  }

  // 폰트 적용 후 실측 폭 기준으로 곡선 파라미터 계산
  const textWidth = (text.width || 0) * (text.scaleX || 1)
  const fontSize = text.fontSize || 40

  if (preset.pathType === 'wave') {
    await applyCurveToText(text, {
      pathType: 'wave',
      // 진폭 기본값 — 글자 크기의 절반(과하지 않게 읽히는 수준)
      radius: Math.round(fontSize * 0.5),
      direction: preset.direction,
      width: textWidth,
    })
  } else {
    const arcDeg = preset.arcDeg ?? 180
    // radiusForTextOnArc 는 호 길이 = 텍스트 폭인 '정확히 채우는' 값 — 여기서 줄이면
    // 호가 텍스트보다 짧아져 글자가 겹친다(실측). 5% 여유를 더해 살짝 풀어준다.
    const radius = Math.max(radiusForTextOnArc(textWidth, arcDeg) * 1.05, 50)
    await applyCurveToText(text, {
      pathType: 'arc',
      radius,
      direction: preset.direction,
      arcDeg,
    })
  }

  commitToCanvas(canvas, text, false)
  return text
}
