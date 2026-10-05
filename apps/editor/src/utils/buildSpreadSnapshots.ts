import {
  type SpreadSnapshot,
  type SpineSnapshot,
  type SpreadSpec,
  normalizeSpreadSpec,
  computeSpreadDimensions,
  computeSpreadOutputDimensions,
  isValidCaseBind,
  roundMm01,
  SPINE_FORMULA_VERSION,
} from '@storige/types'

/** useSettingsStore.spreadConfig 의 구조적 부분형 (필요한 필드만) */
interface SpreadConfigLike {
  // 포토북 내지(regionScope==='inner')는 spec 이 없음 — 본 함수는 표지 스냅샷 전용이라
  // 진입 가드(`if (!spreadConfig?.spec) return {}`)로 내지 config 는 빈 객체 반환.
  spec?: SpreadSpec
  /** 표지 구조. 'flat-spread'(표지펼침면)는 책등 고정 템플릿 — spec.spineWidthMm 이 확정값이다. */
  conversionMode?: string
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
 * - metadata.spine(SpineSnapshot): 필수 필드가 모두 유효할 때만 기록(부분기록 금지 — 단 S7 예외로
 *   책등 0mm·비공식제본이면 paperType 만 생략 가능). spineWidthMm 은
 *   spec.spineWidthMm(updateSpreadSpineWidth 동기화값) 우선, 폴백 calculatedSpineWidth.
 *   책등공식 계산값과 일치하면 spineWidthSource='formula', 수동조정 등으로 다르면 'manual'.
 *   S7: spineWidthMm 은 유한수 ≥ 0 이면 유효(0 = 책등 없는 책 — 스프링 표지펼침면·호스트 0mm).
 *   단 spec 초기값 0(buildSpreadSpec "나중에 계산됨")과 확정 0 을 구분해야 하므로 0 은 다음일 때만 확정으로 본다:
 *     ① calculatedSpineWidth 가 유한수 0(공식/호스트 적용 결과), 또는
 *     ② conversionMode==='flat-spread'(책등 고정 템플릿 — spec 값이 곧 확정값)
 *   그 외(공식 미실행·실패로 calc=null 이고 spec=0)는 미확정 → spine 미기록(종전과 동일).
 *   bindingType/pageCount>0 요구는 0mm 에도 그대로 유지(부분기록 금지).
 *   paperType 은 예외적으로 "확정 0mm + bindingType 이 공식제본(perfect/hardcover, 대소문자 무시)이 아님"
 *   (스프링·중철 등 종이두께 공식을 쓰지 않는 제본)일 때만 생략 가능 — 이때 paperType 키 자체를 생략한다.
 *   perfect/hardcover 는 0mm 여도 paperType 필수(레거시 불일치 신호 유지). 동일 predicate 사용처:
 *   packages/types SpineSnapshot.paperType, api EditSessionsService.validateSpreadSnapshot,
 *   worker PdfSynthesizerService.validateSpreadSnapshot.
 *
 * 안전: spec 이 비정상(NaN 등)이면 roundMm01 가 throw → catch 하여 spread/spine 미기록하고 빈 객체 반환.
 * 호출측(완료 update)은 기존 동작(스냅샷 없이)으로 무중단 진행한다.
 *
 * 두 완료 경로(embed.tsx handleFinish, useWorkSave.completeSpreadWork)가 공용으로 사용.
 *
 * opts.hardcoverWrapMm: 양장 싸바리 모드(caseBind 없음)의 사방 여분 mm. 유한 양수면
 * metadata.spread.outputWidthMm/HeightMm = 총폭/총높이 + wrap×2 를 기록한다. 없으면 기록하지 않는다.
 */
export function buildSpreadSnapshots(
  spreadConfig: SpreadConfigLike | null | undefined,
  spineConfig: SpineConfigLike | null | undefined,
  innerPageCount: number,
  opts?: { hardcoverWrapMm?: number },
): { spread?: SpreadSnapshot; spine?: SpineSnapshot } {
  if (!spreadConfig?.spec) return {}
  try {
    const normSpec = normalizeSpreadSpec(spreadConfig.spec)
    const dims = computeSpreadDimensions(normSpec)
    // D-4 (2026-07-06): 싸바리(caseBind) 세션만 출력(wrap 포함) 사이즈를 additive 기록.
    // 미설정 세션은 필드 자체를 생략해 기존 스냅샷과 byte-identical(기존 필드 불변).
    // 양장 싸바리 모드(caseBind 없음): 출력 = 총폭/총높이 + 사방 wrap.
    const wrapMm = opts?.hardcoverWrapMm
    const outputDims = isValidCaseBind(normSpec.caseBind)
      ? computeSpreadOutputDimensions(normSpec)
      : typeof wrapMm === 'number' && Number.isFinite(wrapMm) && wrapMm > 0
        ? {
            totalWidthMm: roundMm01(dims.totalWidthMm + wrapMm * 2),
            totalHeightMm: roundMm01(dims.totalHeightMm + wrapMm * 2),
          }
        : null
    const spread: SpreadSnapshot = {
      spec: normSpec,
      totalWidthMm: dims.totalWidthMm,
      totalHeightMm: dims.totalHeightMm,
      dpi: normSpec.dpi,
      ...(outputDims
        ? { outputWidthMm: outputDims.totalWidthMm, outputHeightMm: outputDims.totalHeightMm }
        : {}),
    }

    const calc = spineConfig?.calculatedSpineWidth
    const calcMm = typeof calc === 'number' && Number.isFinite(calc) && calc >= 0 ? roundMm01(calc) : undefined
    // 확정 책등 폭(mm) 또는 undefined(미확정). 양수 spec → calc(0 포함) → flat-spread 고정 spec(0) 순.
    const spineWidthMm: number | undefined =
      normSpec.spineWidthMm > 0
        ? normSpec.spineWidthMm
        : calcMm !== undefined
          ? calcMm
          : spreadConfig.conversionMode === 'flat-spread' && normSpec.spineWidthMm === 0
            ? 0
            : undefined

    // S7: paperType 생략 허용 predicate — 확정 0mm + 공식제본(perfect/hardcover) 아닌 bindingType.
    // 동일 predicate: packages/types SpineSnapshot.paperType 주석, api EditSessionsService.validateSpreadSnapshot,
    // worker PdfSynthesizerService.validateSpreadSnapshot. 변경 시 네 곳을 함께 맞춘다.
    const bindingType = spineConfig?.bindingType
    const paperTypeOptional =
      spineWidthMm === 0 &&
      !!bindingType &&
      !['perfect', 'hardcover'].includes(String(bindingType).toLowerCase())

    let spine: SpineSnapshot | undefined
    if (
      spineConfig?.bindingType &&
      spineWidthMm !== undefined &&
      innerPageCount > 0 &&
      (spineConfig?.paperType || paperTypeOptional)
    ) {
      let spineWidthSource: 'formula' | 'manual' | undefined
      if (typeof calc === 'number' && Number.isFinite(calc)) {
        spineWidthSource =
          Math.abs(normSpec.spineWidthMm - roundMm01(calc)) <= 0.1 ? 'formula' : 'manual'
      }
      spine = {
        pageCount: innerPageCount,
        ...(spineConfig?.paperType ? { paperType: spineConfig.paperType } : {}),
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
