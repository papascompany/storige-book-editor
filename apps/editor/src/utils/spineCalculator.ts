/**
 * 책등 너비 동적 계산 유틸리티
 * 내지 수에 따라 책등 너비를 계산하고 캔버스에 적용합니다.
 */
import { spineApi, isRequestCancelled } from '@/api/spine'
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
  /** 호출자(useAppStore.spineResizeAbortController)의 취소를 HTTP 까지 전달한다. 옵셔널. */
  signal?: AbortSignal
}

export interface RecalculateSpineResult {
  success: boolean
  spineWidth: number | null
  pageCount: number
  warnings: Array<{ code: string; message: string }>
  error?: string
  /** 정상 스킵(예: flat-spread 책등 고정 가드) — error 문자열(실패)과 구분하기 위한 플래그 */
  skipped?: boolean
  /**
   * 더 최신 재계산이 발사돼 이 결과는 적용하지 않았다(경합 가드).
   * `skipped`(종국적 no-op)와 의미가 다르므로 필드를 분리한다 — 이쪽은 '일시적 선점'이라
   * 곧 최신 세대가 같은 자리에 값을 적용한다. `error` 는 설정하지 않는다(정상 흐름).
   */
  superseded?: boolean
}

// ────────────────────────────────────────────────────────────────────────────
// 세대(generation) 가드 — 스테일 응답이 최신 응답을 덮어쓰는 경합을 막는다.
//
// 배경: 542fa18 의 runBulkPageOps 구간 게이트로 "재진입 증설 루프" 기인 다중 in-flight 는
// 구조적으로 사라졌지만, 구간 밖 사용자 연타('+내지' 400~600ms 간격 + API 지연)는 여전히
// 여러 요청을 동시에 띄운다. 늦게 도착한 구(舊) pageCount 응답이 최신 응답보다 나중에
// 효과를 적용하면 최종 책등 폭이 스테일 값으로 확정된다.
//
// 왜 스토어가 아니라 이 모듈인가: 호출자 6곳 중 4곳(특히 deletePage — SpreadPagePanel 의
// 삭제 UI 가 직접 부른다)이 useAppStore 의 AbortController 를 우회한다. 스토어에 두면
// 그 4곳이 가드를 못 탄다.
//
// 왜 promise chain 직렬화가 아닌가: axios timeout 이 30s(api/client.ts)라 요청 1건이
// 매달리면 이후 모든 재계산이 최대 30초 정지한다 — 더 드문 실패를 더 흔한 실패와
// 맞바꾸는 셈. 이 가드는 직렬화가 아니라 "적용 시점 순서 판정"이라 그 정지가 없다.
//
// AbortSignal 은 이 가드의 **보완재**다: 취소는 '응답 도착 전'에만 듣고,
// 도착 후 효과 적용 구간은 세대 비교만이 막을 수 있다. 둘 다 필요하다.
let spineCalcGeneration = 0
let spineCalcInFlight: AbortController | null = null

/**
 * 새 세대를 연다. **모든 조기 return 을 통과한 뒤**에 불러야 한다 —
 * 함수 진입부에서 올리면 스킵된 호출이 살아있는 in-flight 를 무효화해
 * "책등이 아예 적용되지 않음"이 된다.
 *
 * 이전 in-flight 는 이 시점에 구세대로 확정되므로(응답이 와도 아래 가드가 효과를 막는다)
 * 소켓·서버 부하를 아끼려고 즉시 끊는다.
 */
function beginSpineCalcGeneration(external?: AbortSignal): { gen: number; signal: AbortSignal } {
  spineCalcInFlight?.abort()
  const controller = new AbortController()
  spineCalcInFlight = controller
  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', () => controller.abort(), { once: true })
  }
  return { gen: ++spineCalcGeneration, signal: controller.signal }
}

/** 내가 발사한 뒤 더 새로운 재계산이 시작됐는가 — true 면 어떤 효과도 적용해선 안 된다. */
function isSuperseded(gen: number): boolean {
  return gen !== spineCalcGeneration
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
/** 표지 칸을 제외한 내지의 인쇄 페이지 수. 펼침면은 pagesPerCanvas(보통 2)를 곱한다. */
export function innerPrintPageCount(input: {
  pageListLength: number
  canvasCount: number
  pagesPerCanvas: number
  hasCoverSlot: boolean
}): number {
  const canvases = input.pageListLength > 0 ? input.pageListLength : input.canvasCount
  const innerCanvasCount = Math.max(0, canvases - (input.hasCoverSlot ? 1 : 0))
  const per = input.pagesPerCanvas > 0 ? input.pagesPerCanvas : 1
  return innerCanvasCount * per
}

export function countInnerPrintPages(): number {
  const editorStore = useEditorStore.getState()
  return innerPrintPageCount({
    pageListLength: editorStore.pages.length,
    canvasCount: useAppStore.getState().allCanvas.length,
    pagesPerCanvas: editorStore.pagesPerCanvas,
    hasCoverSlot: useSettingsStore.getState().hasCoverSlot !== false,
  })
}

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

  // 조기 return(paperType 미설정 / spine 템플릿 없음)을 모두 통과한 뒤에만 세대를 연다.
  const { gen: myGen, signal } = beginSpineCalcGeneration(options?.signal)

  try {
    // API로 책등 폭 계산
    const spineResult = await spineApi.calculate({
      pageCount,
      paperType,
      bindingType,
    }, { signal })

    // 가드 ①: 응답을 기다리는 사이 더 새로운 재계산이 발사됐다면 아무것도 적용하지 않는다.
    // 이 await 경계가 이 경로에서 유일한 인터리브 지점이다 — 아래 workspace 변경·줌 조정은
    // 전부 동기라 한 번의 검사로 효과 전체(202~254행)가 차단된다.
    if (isSuperseded(myGen)) {
      return { success: false, spineWidth: null, pageCount, warnings: [], superseded: true }
    }

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
    // 취소 = 더 새로운 재계산이 이 요청을 끊은 것이다. 에러가 아니므로 조용히 삼킨다.
    // (axios 는 CanceledError 를 던진다 — name 이 'AbortError' 가 아니라서
    //  이름 비교로는 절대 걸러지지 않는다. isRequestCancelled 참조.)
    if (isRequestCancelled(error)) {
      return { success: false, spineWidth: null, pageCount, warnings: [], superseded: true }
    }
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
  // ── 내지 펼침면 가드 (책등 없음) ────────────────────────────────────────
  // 포토북 내지(regionScope='inner')는 좌면+거터+우면 2-up 이라 책등 자체가 없다.
  // 그런데 이 함수가 무조건 실행돼 책등 API 를 호출하고, placeholder spec 으로
  // 레이아웃을 계산하다 `roundMm01: non-finite value NaN` 로 매 트리거마다 실패했다
  // (2026-08-03 E2E 실측 — 콘솔 에러 반복). flat-spread 와 동일하게 여기서 차단한다.
  if (settingsStore.spreadConfig?.regionScope === 'inner') {
    return {
      success: false,
      spineWidth: null,
      pageCount: 0,
      warnings: [],
      skipped: true, // 정상 스킵 — 계산 실패와 구분
      error: '내지 펼침면(2-up)에는 책등이 없습니다.',
    }
  }

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

  // 내지 인쇄 페이지 수. 표지 슬롯은 빼고, 내지펼침면은 캔버스 1장 = 물리 2p.
  const pageCount = countInnerPrintPages()

  if (pageCount <= 0) {
    console.log('[SpineCalculator:Spread] 내지 페이지 없음, 스킵')
    return {
      success: false,
      spineWidth: null,
      pageCount: 0,
      warnings: [],
      error: '내지 캔버스가 없습니다.',
    }
  }

  // 현재 책등 너비 (변경 전)
  const currentSpineWidth = settingsStore.spineConfig.calculatedSpineWidth ?? settingsStore.spreadConfig?.spec?.spineWidthMm ?? null

  console.log(`[SpineCalculator:Spread] 책등 너비 계산 시작:`)
  console.log(`  - 인쇄 페이지 수: ${pageCount}p`)
  console.log(`  - 용지: ${paperType}, 제본: ${bindingType}`)
  console.log(`  - 현재 책등 너비: ${currentSpineWidth}mm`)

  // 조기 return(inner / flat-spread / 내지 0장)을 모두 통과한 뒤에만 세대를 연다.
  // 두 경로가 하나의 카운터를 공유한다 — 모드는 세션 전역이라 "가장 최근 발사가 이긴다"가
  // 공통 규약이다.
  const { gen: myGen, signal } = beginSpineCalcGeneration(options?.signal)

  try {
    // API로 책등 폭 계산
    const spineResult = await spineApi.calculate({
      pageCount,
      paperType,
      bindingType,
    }, { signal })

    // 가드 ①: resizeSpine 진입 자체를 막는다. 레이아웃을 건드리기 전이라 되돌릴 것이 없다.
    if (isSuperseded(myGen)) {
      return { success: false, spineWidth: null, pageCount, warnings: [], superseded: true }
    }

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

    // 가드 ②(보험): resizeSpine 은 await 라 그 안에서도 인터리브가 가능하다.
    // 여기 도달했다는 건 레이아웃은 이미 내 값으로 바뀐 뒤라는 뜻이다 — 되돌릴 수 없으므로
    // **스토어 쓰기만** 건너뛴다.
    //
    // 왜 쓰지 않는가(트레이드오프를 정직하게): 선점한 신 세대는 이미 자기 가드 ①을 통과해
    // 곧(또는 이미) 스토어를 자기 값으로 쓴다. 여기서 구 값을 쓰면 **그 최신 스토어 값을
    // 되덮을 수 있다** — 이 파일이 막으려는 스테일 쓰기 그 자체다. 그래서 쓰지 않는다.
    //
    // ⚠️ 대가: 신 세대가 그 뒤 **실패**하면 플러그인=내 값 / 스토어=그 이전 값 으로 갈린 채
    //    남는다(덮어줄 주체가 없다). 쓰는 쪽을 택하면 이 케이스는 일관되지만 위의 스테일
    //    되덮기가 열린다 — 양쪽 다 실패 모드가 있고, 더 흔하고 더 해로운 쪽(스테일 되덮기)을
    //    막는 선택이다. 갈림이 남아도 다음 페이지 추가/삭제의 재계산이 양쪽을 다시 맞춘다.
    //    (가드 ②는 오늘 기준 도달 경로가 확인되지 않았다 — resizeSpine 은 네트워크가 아닌
    //     동기 레이아웃 위주라 그 await 창이 매우 짧다. 방어적 보험으로 남긴다.)
    if (isSuperseded(myGen)) {
      return {
        success: false,
        spineWidth: spineResult.spineWidth,
        pageCount,
        warnings: spineResult.warnings,
        superseded: true,
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
    // 취소는 정상 흐름(더 새로운 재계산이 끊은 것) — 콘솔을 더럽히지 않는다.
    if (isRequestCancelled(error)) {
      return { success: false, spineWidth: null, pageCount, warnings: [], superseded: true }
    }
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
