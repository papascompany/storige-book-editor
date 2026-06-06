import {
  type SpreadSnapshot,
  type SpineSnapshot,
  type SpreadSpec,
  normalizeSpreadSpec,
  computeSpreadDimensions,
  roundMm01,
  SPINE_FORMULA_VERSION,
} from '@storige/types'

/** useSettingsStore.spreadConfig 의 구조적 부분형 (필요한 필드만) */
interface SpreadConfigLike {
  spec: SpreadSpec
  totalWidthMm?: number
  totalHeightMm?: number
}

/** useSettingsStore.spineConfig 의 구조적 부분형 */
interface SpineConfigLike {
  paperType: string | null
  bindingType: string | null
  calculatedSpineWidth: number | null
}

/**
 * 스프레드 책 "편집완료" 시 EditSession.metadata 에 저장할 출력재현 단일소스(B38) 스냅샷 생성.
 *
 * - metadata.spread(SpreadSnapshot): normalizeSpreadSpec 으로 정규화한 spec + computeSpreadDimensions
 *   재계산 총폭(wing×2 포함 비즈니스 단일소스) + dpi. 스토어 캐시 totalWidthMm 대신 공식 재실행으로
 *   api/worker 검증과 항상 동일값 보장.
 * - metadata.spine(SpineSnapshot): 필수 5필드가 모두 유효할 때만 기록(부분기록 금지). spineWidthMm 은
 *   spec.spineWidthMm(updateSpreadSpineWidth 동기화값) 우선, 폴백 calculatedSpineWidth.
 *   책등공식 계산값과 일치하면 spineWidthSource='formula', 수동조정 등으로 다르면 'manual'.
 *
 * 안전: spec 이 비정상(NaN 등)이면 roundMm01 가 throw → catch 하여 spread/spine 미기록하고 빈 객체 반환.
 * 호출측(완료 update)은 기존 동작(스냅샷 없이)으로 무중단 진행한다.
 *
 * 두 완료 경로(embed.tsx handleFinish, useWorkSave.completeSpreadWork)가 공용으로 사용.
 */
export function buildSpreadSnapshots(
  spreadConfig: SpreadConfigLike | null | undefined,
  spineConfig: SpineConfigLike | null | undefined,
  innerPageCount: number,
): { spread?: SpreadSnapshot; spine?: SpineSnapshot } {
  if (!spreadConfig?.spec) return {}
  try {
    const normSpec = normalizeSpreadSpec(spreadConfig.spec)
    const dims = computeSpreadDimensions(normSpec)
    const spread: SpreadSnapshot = {
      spec: normSpec,
      totalWidthMm: dims.totalWidthMm,
      totalHeightMm: dims.totalHeightMm,
      dpi: normSpec.dpi,
    }

    const calc = spineConfig?.calculatedSpineWidth
    const spineWidthMm =
      normSpec.spineWidthMm || (typeof calc === 'number' && Number.isFinite(calc) ? roundMm01(calc) : 0)

    let spine: SpineSnapshot | undefined
    if (
      spineConfig?.paperType &&
      spineConfig?.bindingType &&
      spineWidthMm > 0 &&
      innerPageCount > 0
    ) {
      let spineWidthSource: 'formula' | 'manual' | undefined
      if (typeof calc === 'number' && Number.isFinite(calc)) {
        spineWidthSource =
          Math.abs(normSpec.spineWidthMm - roundMm01(calc)) <= 0.1 ? 'formula' : 'manual'
      }
      spine = {
        pageCount: innerPageCount,
        paperType: spineConfig.paperType,
        bindingType: spineConfig.bindingType,
        spineWidthMm,
        formulaVersion: SPINE_FORMULA_VERSION,
        ...(spineWidthSource ? { spineWidthSource } : {}),
      }
    }

    return { spread, ...(spine ? { spine } : {}) }
  } catch (e) {
    // 비정상 spec(NaN 등) → 스냅샷 미기록, 완료는 기존 동작대로 계속(무중단)
    console.warn('[buildSpreadSnapshots] 스냅샷 생성 실패 — spread/spine 미기록(완료는 계속):', e)
    return {}
  }
}
