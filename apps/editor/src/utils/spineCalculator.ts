/**
 * 책등 너비 동적 계산 유틸리티
 * 내지 수에 따라 책등 너비를 계산하고 캔버스에 적용합니다.
 */
import { spineApi } from '@/api'
import { useAppStore } from '@/stores/useAppStore'
import { useEditorStore } from '@/stores/useEditorStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { mmToPxDisplay, SpreadPlugin } from '@storige/canvas-core'
import type { fabric } from 'fabric'

// Fabric.js Object 확장 타입
interface ExtendedFabricObject extends fabric.Object {
  id?: string
}

// 템플릿 메타데이터 타입
interface TemplateMetadata {
  type?: 'cover' | 'spine' | 'page' | 'wing'
  [key: string]: unknown
}

export interface RecalculateSpineOptions {
  paperType: string
  bindingType: string
  templateSetHeight?: number  // 템플릿셋 높이 (mm)
}

export interface RecalculateSpineResult {
  success: boolean
  spineWidth: number | null
  pageCount: number
  warnings: Array<{ code: string; message: string }>
  error?: string
  /** 정상 스킵(예: flat-spread 책등 고정 가드) — error 문자열(실패)과 구분하기 위한 플래그 */
  skipped?: boolean
}

/**
 * 템플릿의 타입을 가져옵니다.
 * editorTemplates 저장 시 pageType 필드에 저장되거나, 원본 type 필드가 있을 수 있습니다.
 */
function getTemplateType(template: any): string | undefined {
  // pageType 필드 우선 확인 (useEditorContents에서 매핑된 경우)
  if (template?.pageType) {
    return template.pageType
  }
  // 원본 type 필드 확인
  if (template?.type && template.type !== 'template') {
    return template.type
  }
  // metadata 내부 확인
  if (template?.metadata?.type) {
    return template.metadata.type
  }
  return undefined
}

/**
 * 현재 에디터의 내지(page) 템플릿 개수를 계산합니다.
 * 실제 allCanvas 배열에서 page 타입만 카운트합니다.
 */
export function countPageTemplates(): number {
  const editorTemplates = useSettingsStore.getState().editorTemplates
  const allCanvas = useAppStore.getState().allCanvas
  const actualCanvasCount = allCanvas.length

  if (!editorTemplates || editorTemplates.length === 0) {
    // editorTemplates가 없으면 모든 캔버스를 page로 간주
    return actualCanvasCount
  }

  // editorTemplates에서 page가 아닌 타입(spine, wing, cover 등)의 수를 카운트
  const nonPageCount = editorTemplates.filter((t: any) => {
    const templateType = getTemplateType(t)
    return templateType && templateType !== 'page'
  }).length

  // 실제 캔버스 수에서 비-page 템플릿 수를 빼서 page 수 계산
  // (삭제된 페이지도 반영됨)
  const pageCount = actualCanvasCount - nonPageCount

  return pageCount > 0 ? pageCount : 0
}

/**
 * spine 템플릿의 인덱스를 찾습니다.
 */
export function findSpineTemplateIndex(): number {
  const editorTemplates = useSettingsStore.getState().editorTemplates

  if (!editorTemplates || editorTemplates.length === 0) {
    return -1
  }

  return editorTemplates.findIndex((t: any) => {
    const templateType = getTemplateType(t)
    return templateType === 'spine'
  })
}

/**
 * 책등 너비를 재계산하고 캔버스에 적용합니다.
 *
 * @param options - 계산에 필요한 옵션 (paperType, bindingType)
 * @returns 계산 결과
 */
export async function recalculateSpineWidth(
  options?: Partial<RecalculateSpineOptions>
): Promise<RecalculateSpineResult> {
  const settingsStore = useSettingsStore.getState()
  const appStore = useAppStore.getState()
  const spineConfig = settingsStore.spineConfig

  // ============================================================================
  // 스프레드 모드 분기 (§4.3 설계서)
  // ============================================================================
  if (appStore.isSpreadMode) {
    return await recalculateSpineWidthSpreadMode(options)
  }

  // ============================================================================
  // 단일 모드 (기존 로직 유지)
  // ============================================================================

  // paperType과 bindingType 결정 (옵션 > 스토어 > null)
  const paperType = options?.paperType || spineConfig.paperType
  const bindingType = options?.bindingType || spineConfig.bindingType

  if (!paperType || !bindingType) {
    console.log('[SpineCalculator] paperType 또는 bindingType이 설정되지 않음, 책등 계산 스킵')
    return {
      success: false,
      spineWidth: null,
      pageCount: 0,
      warnings: [],
      error: 'paperType 또는 bindingType이 설정되지 않았습니다.',
    }
  }

  // spine 템플릿 인덱스 찾기
  const spineTemplateIndex = findSpineTemplateIndex()

  if (spineTemplateIndex === -1) {
    console.log('[SpineCalculator] spine 템플릿이 없음, 책등 계산 스킵')
    return {
      success: false,
      spineWidth: null,
      pageCount: 0,
      warnings: [],
      error: 'spine 템플릿이 없습니다.',
    }
  }

  // 내지 페이지 수 계산 (단면 인쇄: 캔버스 1개 = 인쇄 1p)
  const pageTemplateCount = countPageTemplates()
  const pageCount = pageTemplateCount

  console.log(`[SpineCalculator] 책등 너비 계산: pageCount=${pageCount}, paperType=${paperType}, bindingType=${bindingType}`)

  try {
    // API로 책등 폭 계산
    const spineResult = await spineApi.calculate({
      pageCount,
      paperType,
      bindingType,
    })

    console.log(`[SpineCalculator] 계산된 책등 너비: ${spineResult.spineWidth}mm`)

    // 경고 메시지 출력
    if (spineResult.warnings.length > 0) {
      spineResult.warnings.forEach((warning: { message: string }) => {
        console.warn(`[SpineCalculator] 경고: ${warning.message}`)
      })
    }

    // 책등 캔버스 크기 업데이트
    const appStore = useAppStore.getState()
    const spineEditor = appStore.allEditors[spineTemplateIndex]
    const spineCanvas = appStore.allCanvas[spineTemplateIndex]

    if (spineEditor && spineCanvas) {
      const workspacePlugin = spineEditor.getPlugin<any>('WorkspacePlugin')
      if (workspacePlugin) {
        const newWidthPx = mmToPxDisplay(spineResult.spineWidth)
        const currentHeight = options?.templateSetHeight ||
          workspacePlugin._options?.size?.height ||
          297  // 기본값 A4 높이

        console.log(`[SpineCalculator] 책등 workspace 크기 변경: width=${newWidthPx}px (${spineResult.spineWidth}mm)`)

        // workspace 객체 찾아서 크기 변경
        const workspaceObj = spineCanvas.getObjects().find((obj: fabric.Object) =>
          (obj as ExtendedFabricObject).id === 'workspace'
        )

        if (workspaceObj) {
          const heightPx = mmToPxDisplay(currentHeight)

          // workspace 객체 크기 업데이트
          workspaceObj.set({
            width: newWidthPx,
            height: heightPx,
            scaleX: 1,
            scaleY: 1,
          })
          workspaceObj.setCoords()

          // 플러그인 내부 옵션 업데이트
          if (workspacePlugin._options?.size) {
            workspacePlugin._options.size.width = spineResult.spineWidth
          }

          // 렌더링 및 줌 조정
          spineCanvas.requestRenderAll()
          if (workspacePlugin.setZoomAuto) {
            workspacePlugin.setZoomAuto()
          }

          console.log('[SpineCalculator] 책등 workspace 크기 변경 완료')
        }
      }
    }

    // 스토어에 계산된 값 저장
    settingsStore.setSpineConfig({
      paperType,
      bindingType,
      calculatedSpineWidth: spineResult.spineWidth,
    })

    return {
      success: true,
      spineWidth: spineResult.spineWidth,
      pageCount,
      warnings: spineResult.warnings,
    }
  } catch (error) {
    console.error('[SpineCalculator] 책등 계산 오류:', error)
    return {
      success: false,
      spineWidth: null,
      pageCount,
      warnings: [],
      error: error instanceof Error ? error.message : '책등 계산 중 오류가 발생했습니다.',
    }
  }
}

/**
 * 스프레드 모드 전용: 책등 너비 재계산 및 SpreadPlugin.resizeSpine() 호출
 *
 * @param options - 계산 옵션
 * @returns 계산 결과
 */
async function recalculateSpineWidthSpreadMode(
  options?: Partial<RecalculateSpineOptions>
): Promise<RecalculateSpineResult> {
  const settingsStore = useSettingsStore.getState()
  const appStore = useAppStore.getState()
  const spineConfig = settingsStore.spineConfig

  // ── flat-spread 가드 (책등 고정) ─────────────────────────────────────────
  // 전폭 아트워크 1장(IDML hybrid 변환) 템플릿은 책등 폭을 바꾸면 아트워크와 어긋난다.
  // 모든 책등 자동 재계산 트리거(초기 로드, 내지 추가/삭제 debounce)가 이 함수를 거치므로
  // 여기가 단일 차단 지점. (SpreadPlugin.resizeSpine 에도 방어적 no-op 가드 존재.)
  // spineWidth 는 템플릿 고정값을 그대로 반환해 호출측 로그/스냅샷 정합 유지.
  const conversionMode = settingsStore.spreadConfig?.conversionMode ?? 'full'
  if (conversionMode === 'flat-spread') {
    const fixedSpineWidth = settingsStore.spreadConfig?.spec?.spineWidthMm ?? null
    console.log(
      `[SpineCalculator:Spread] conversionMode='flat-spread' — 책등 고정(${fixedSpineWidth}mm), 재계산/resizeSpine 스킵`
    )
    return {
      success: false,
      spineWidth: fixedSpineWidth,
      pageCount: 0,
      warnings: [],
      skipped: true, // 정상 스킵 — 계산 실패(error 만 있는 경우)와 구분
      error: '책등 고정 템플릿(flat-spread)입니다. 책등 폭은 변경되지 않습니다.',
    }
  }

  // paperType과 bindingType 결정 (옵션 > spineConfig > URL 파라미터 > 기본값)
  const urlParams = new URLSearchParams(window.location.search)
  const paperType = options?.paperType || spineConfig.paperType || urlParams.get('paperType') || 'mojo_80g'
  const bindingType = options?.bindingType || spineConfig.bindingType || urlParams.get('bindingType') || 'perfect'

  if (!spineConfig.paperType || !spineConfig.bindingType) {
    // spineConfig에 저장되지 않은 경우 지금 저장 (이후 호출에서 재사용)
    console.log(`[SpineCalculator:Spread] spineConfig에 paperType/bindingType 미설정, 기본값 사용: ${paperType}/${bindingType}`)
    settingsStore.setSpineConfig({ paperType, bindingType })
  }

  // 내지 페이지 수 계산 (useEditorStore.pages를 주요 소스로 사용)
  // allCanvas.length는 React Strict Mode race condition으로 부정확할 수 있음
  const editorPages = useEditorStore.getState().pages
  const editorPageCount = editorPages.filter((p) => p.templateType === 'page').length

  // fallback: editorPages가 아직 설정되지 않은 경우 (초기 로드 시) allCanvas 사용
  const allCanvas = appStore.allCanvas
  const allCanvasInnerCount = allCanvas.length - 1

  const innerPageCanvasCount = editorPageCount > 0 ? editorPageCount : Math.max(allCanvasInnerCount, 0)

  if (innerPageCanvasCount <= 0) {
    console.log('[SpineCalculator:Spread] 내지 캔버스 없음, 스킵')
    return {
      success: false,
      spineWidth: null,
      pageCount: 0,
      warnings: [],
      error: '내지 캔버스가 없습니다.',
    }
  }

  const pageCount = innerPageCanvasCount // 단면 인쇄: 캔버스 1개 = 인쇄 1p

  // 현재 책등 너비 (변경 전)
  const currentSpineWidth = settingsStore.spineConfig.calculatedSpineWidth ?? settingsStore.spreadConfig?.spec?.spineWidthMm ?? null

  console.log(`[SpineCalculator:Spread] 책등 너비 계산 시작:`)
  console.log(`  - 내지 수 (editorStore.pages): ${editorPageCount}개`)
  console.log(`  - 내지 수 (allCanvas fallback): ${allCanvasInnerCount}개`)
  console.log(`  - 사용된 내지 수: ${innerPageCanvasCount}개`)
  console.log(`  - 인쇄 페이지 수 (단면): ${pageCount}p`)
  console.log(`  - 용지: ${paperType}, 제본: ${bindingType}`)
  console.log(`  - 현재 책등 너비: ${currentSpineWidth}mm`)

  try {
    // API로 책등 폭 계산
    const spineResult = await spineApi.calculate({
      pageCount,
      paperType,
      bindingType,
    })

    console.log(`[SpineCalculator:Spread] API 응답: 책등 너비 ${spineResult.spineWidth}mm (${currentSpineWidth}mm → ${spineResult.spineWidth}mm, 변화: ${currentSpineWidth != null ? (spineResult.spineWidth - currentSpineWidth).toFixed(1) : 'N/A'}mm)`)

    // 경고 메시지 출력
    if (spineResult.warnings.length > 0) {
      spineResult.warnings.forEach((warning: { message: string }) => {
        console.warn(`[SpineCalculator:Spread] 경고: ${warning.message}`)
      })
    }

    // ========================================================================
    // SpreadPlugin.resizeSpine() 호출
    // ========================================================================
    const spreadEditor = appStore.allEditors[0] // 스프레드 캔버스는 항상 인덱스 0

    if (spreadEditor) {
      const spreadPlugin = spreadEditor.getPlugin<SpreadPlugin>('SpreadPlugin')

      if (spreadPlugin) {
        const layoutBefore = spreadPlugin.getLayout()
        await spreadPlugin.resizeSpine(spineResult.spineWidth)
        const layoutAfter = spreadPlugin.getLayout()
        console.log(`[SpineCalculator:Spread] resizeSpine 완료: 스프레드 총폭 ${layoutBefore?.totalWidthMm?.toFixed(1)}mm → ${layoutAfter?.totalWidthMm?.toFixed(1)}mm`)
      } else {
        console.warn('[SpineCalculator:Spread] SpreadPlugin을 찾을 수 없습니다.')
      }
    }

    // 스토어에 계산된 값 저장
    settingsStore.setSpineConfig({
      paperType,
      bindingType,
      calculatedSpineWidth: spineResult.spineWidth,
    })

    // SpreadConfig의 spineWidthMm도 업데이트
    settingsStore.updateSpreadSpineWidth(spineResult.spineWidth)

    return {
      success: true,
      spineWidth: spineResult.spineWidth,
      pageCount,
      warnings: spineResult.warnings,
    }
  } catch (error) {
    console.error('[SpineCalculator:Spread] 책등 계산 오류:', error)
    return {
      success: false,
      spineWidth: null,
      pageCount,
      warnings: [],
      error: error instanceof Error ? error.message : '책등 계산 중 오류가 발생했습니다.',
    }
  }
}

/**
 * 초기 로딩 시 spineConfig를 설정합니다.
 */
export function initSpineConfig(paperType: string | null, bindingType: string | null): void {
  const settingsStore = useSettingsStore.getState()
  settingsStore.setSpineConfig({
    paperType: paperType || null,
    bindingType: bindingType || null,
  })
  console.log(`[SpineCalculator] spineConfig 초기화: paperType=${paperType}, bindingType=${bindingType}`)
}
