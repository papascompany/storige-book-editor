/**
 * Template → SpreadSpec 변환 유틸리티
 *
 * 관리자가 입력한 최소 스펙(Template.spreadConfig.spec)과
 * product_sizes의 cutSize/safeSize를 결합하여
 * 완전한 SpreadSpec을 생성합니다.
 */

import type { SpreadSpec, SpreadConfig, Template } from '@storige/types'

/**
 * 날개 오버라이드 해석 (주문 옵션 > 템플릿 spec).
 *
 * 규칙:
 *  - 오버라이드 미전달 → 템플릿 값 그대로(기존 동작 byte-identical)
 *  - `wingEnabled=false` → 폭과 무관하게 끔
 *  - `wingEnabled=true` → **유효한 폭(>0)이 오버라이드나 템플릿에 있어야** 켠다.
 *    폭 없이 켜면 computeLayout 이 폭 0 영역을 skip 해 "켰는데 안 보이는" 무성의한 상태가 된다.
 *  - 폭만 전달 → 템플릿이 켜져 있을 때만 의미가 있으므로 enabled 는 템플릿 값 유지
 */
export function resolveWingOverride(
  base: { wingEnabled: boolean; wingWidthMm: number },
  override: { wingEnabled?: boolean; wingWidthMm?: number },
): { wingEnabled: boolean; wingWidthMm: number } {
  const width =
    typeof override.wingWidthMm === 'number' && Number.isFinite(override.wingWidthMm) && override.wingWidthMm > 0
      ? override.wingWidthMm
      : base.wingWidthMm

  if (override.wingEnabled === false) {
    return { wingEnabled: false, wingWidthMm: width }
  }
  if (override.wingEnabled === true) {
    return width > 0
      ? { wingEnabled: true, wingWidthMm: width }
      : { wingEnabled: false, wingWidthMm: width }
  }
  return { wingEnabled: base.wingEnabled, wingWidthMm: width }
}

export interface BuildSpreadSpecOptions {
  /** Template (spread 타입) */
  template: Template
  /** 상품 스펙의 재단 여백 (mm) */
  cutSizeMm?: number
  /** 상품 스펙의 안전 여백 (mm) */
  safeSizeMm?: number
  /** DPI (기본값: 150) */
  dpi?: number
  /**
   * 주문(상품) 옵션의 날개 사용 여부 오버라이드 (2026-08-03).
   * 날개는 종전까지 템플릿 spec 전용 정적값이라, 같은 표지 템플릿을 쓰면서 상품별로
   * 날개 유무가 갈리는 운영이 불가능했다. 미전달이면 템플릿 값 그대로 = 기존 동작 불변.
   */
  wingEnabled?: boolean
  /** 주문(상품) 옵션의 날개 폭(mm) 오버라이드. 미전달이면 템플릿 값 그대로. */
  wingWidthMm?: number
}

/**
 * Template에서 SpreadSpec 추출
 *
 * @param options - 빌드 옵션
 * @returns SpreadSpec 또는 null (spread 타입이 아니면)
 * @throws {Error} spreadConfig 필수 필드 누락 시
 */
export function buildSpreadSpec(options: BuildSpreadSpecOptions): SpreadSpec | null {
  const { template, cutSizeMm = 2, safeSizeMm = 3, dpi = 150 } = options

  // spread 타입이 아니면 null 반환
  if (template.type !== 'spread') {
    return null
  }

  // spreadConfig 존재 확인
  if (!template.spreadConfig) {
    throw new Error(`Template ${template.id} is type=spread but missing spreadConfig`)
  }

  const config: SpreadConfig = template.spreadConfig

  // 필수 필드 검증
  if (!config.spec) {
    throw new Error(`Template ${template.id} spreadConfig.spec is missing`)
  }

  const { spec } = config

  // 필수 필드 존재 확인
  if (
    typeof spec.coverWidthMm !== 'number' ||
    typeof spec.coverHeightMm !== 'number' ||
    typeof spec.wingEnabled !== 'boolean' ||
    typeof spec.wingWidthMm !== 'number'
  ) {
    throw new Error(
      `Template ${template.id} spreadConfig.spec is missing required fields (coverWidthMm, coverHeightMm, wingEnabled, wingWidthMm)`
    )
  }

  const resolvedWing = resolveWingOverride(
    { wingEnabled: spec.wingEnabled, wingWidthMm: spec.wingWidthMm },
    { wingEnabled: options.wingEnabled, wingWidthMm: options.wingWidthMm },
  )

  // 완전한 SpreadSpec 생성 (저장된 값 + 상품 스펙 보완)
  const spreadSpec: SpreadSpec = {
    coverWidthMm: spec.coverWidthMm,
    coverHeightMm: spec.coverHeightMm,
    spineWidthMm: spec.spineWidthMm || 0, // 초기값, 나중에 계산됨
    // 주문 옵션 오버라이드 우선 — 단 '켜기'는 유효한 폭이 함께 와야 적용한다
    // (폭 없이 켜면 computeLayout 이 폭 0 영역을 skip 해 조용히 무효가 된다).
    wingEnabled: resolvedWing.wingEnabled,
    wingWidthMm: resolvedWing.wingWidthMm,
    cutSizeMm: spec.cutSizeMm || cutSizeMm, // 저장된 값 우선, 없으면 상품 스펙
    safeSizeMm: spec.safeSizeMm || safeSizeMm,
    dpi: spec.dpi || dpi,
  }

  return spreadSpec
}

/**
 * SpreadSpec 유효성 검사
 *
 * @param spec - 검사할 SpreadSpec
 * @returns 유효하면 true
 * @throws {Error} 유효하지 않으면 에러
 */
export function validateSpreadSpec(spec: SpreadSpec): boolean {
  if (spec.coverWidthMm <= 0 || spec.coverHeightMm <= 0) {
    throw new Error('coverWidth and coverHeight must be positive')
  }

  if (spec.spineWidthMm < 0) {
    throw new Error('spineWidth must be non-negative')
  }

  if (spec.wingEnabled && spec.wingWidthMm <= 0) {
    throw new Error('wingWidth must be positive when wingEnabled=true')
  }

  if (spec.cutSizeMm < 0 || spec.safeSizeMm < 0) {
    throw new Error('cutSize and safeSize must be non-negative')
  }

  if (spec.dpi <= 0) {
    throw new Error('dpi must be positive')
  }

  return true
}
