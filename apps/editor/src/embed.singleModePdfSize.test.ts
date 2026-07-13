/**
 * G-E (2026-07-14) — 단일(비-spread) 완료 PDF 방향 정합 헬퍼 단위 테스트.
 *
 * resolveSingleModePdfSizeMm 은 호스트 전달값(options.size)이 templateSet 판형(오리엔트된
 * 판형 권위)과 **정확히 W↔H 스왑 관계**(각 축 |Δ|<0.01mm)일 때만 templateSet 방향으로
 * 정규화하고, 그 외(일치/무관 불일치/정사각/size 미전달)는 현행 그대로(원본 보존) 반환한다.
 *
 * A안 계약: 워커 validatePageSize 는 무스왑 유지(스왑 마스킹 + fix-bleed innerfit 축소 사고
 * 방지) — 방향 정합은 이 기준값 유도측에서 확정. 워커측 잠금은
 * apps/worker/src/services/pdf-validator.service.spec.ts 의
 * "내지 판형 규격표 (2026-07-14 오너 스펙)" describe 가 담당한다.
 */
import { describe, it, expect } from 'vitest'
import { resolveSingleModePdfSizeMm } from './embed'
import { detectOrientationMismatch } from './utils/orientationGuard'

describe('resolveSingleModePdfSizeMm (G-E 단일모드 PDF 방향 정합)', () => {
  it('스왑 관계 → 정규화: 전달값이 templateSet 판형의 정확한 W↔H 스왑이면 templateSet 방향으로 스왑', () => {
    // 세로 templateSet(A4 210×297) + 가로로 뒤집힌 전달값(297×210) → 세로로 정규화
    const portrait = resolveSingleModePdfSizeMm(
      { width: 297, height: 210 },
      { width: 210, height: 297 },
    )
    expect(portrait).toEqual({ width: 210, height: 297, swapped: true })

    // 가로 templateSet(297×210) + 세로로 뒤집힌 전달값(210×297) → 가로로 정규화
    const landscape = resolveSingleModePdfSizeMm(
      { width: 210, height: 297 },
      { width: 297, height: 210 },
    )
    expect(landscape).toEqual({ width: 297, height: 210, swapped: true })

    // 오너 규격표 나머지도 동일 (B5/46배판/16절/B6)
    for (const [w, h] of [
      [182, 257],
      [188, 257],
      [190, 260],
      [128, 182],
    ]) {
      const r = resolveSingleModePdfSizeMm({ width: h, height: w }, { width: w, height: h })
      expect(r).toEqual({ width: w, height: h, swapped: true })
    }
  })

  it('일치 → 불변: 전달값과 templateSet 판형이 같으면 그대로', () => {
    const r = resolveSingleModePdfSizeMm(
      { width: 210, height: 297 },
      { width: 210, height: 297 },
    )
    expect(r).toEqual({ width: 210, height: 297, swapped: false })
  })

  it('정사각 → 불변: templateSet 이 정사각(방향 모호)이면 수치상 스왑이어도 정규화하지 않음', () => {
    // 정확히 같은 정사각 — 스왑 판정식은 수치상 참이지만 square 제외로 불변이어야 한다
    const exact = resolveSingleModePdfSizeMm(
      { width: 210, height: 210 },
      { width: 210, height: 210 },
    )
    expect(exact).toEqual({ width: 210, height: 210, swapped: false })

    // classifyOrientation 토러런스(1mm) 안의 근사 정사각 templateSet 도 동일하게 제외
    const nearSquare = resolveSingleModePdfSizeMm(
      { width: 210.5, height: 210 },
      { width: 210, height: 210.5 },
    )
    expect(nearSquare).toEqual({ width: 210.5, height: 210, swapped: false })
  })

  it('무관 불일치 → 불변: 스왑 관계가 아닌 불일치는 파트너 명시값 계약대로 원본 보존', () => {
    // 비규격 전달값(205×290) vs A4 templateSet — 스왑 아님 → 원본 그대로
    const r = resolveSingleModePdfSizeMm(
      { width: 205, height: 290 },
      { width: 210, height: 297 },
    )
    expect(r).toEqual({ width: 205, height: 290, swapped: false })

    // 스왑 오차(0.01mm) 이상 어긋나면 스왑으로 보지 않는다 — 경계 잠금
    const nearSwap = resolveSingleModePdfSizeMm(
      { width: 297.02, height: 210 },
      { width: 210, height: 297 },
    )
    expect(nearSwap).toEqual({ width: 297.02, height: 210, swapped: false })
  })

  it('size 미전달/무효 → A4 폴백(현행 || 시맨틱), 폴백값으로는 정규화하지 않음', () => {
    // 미전달 — templateSet 이 가로(297×210)여서 폴백 A4(210×297)가 수치상 스왑이어도 불변
    expect(resolveSingleModePdfSizeMm(undefined, { width: 297, height: 210 })).toEqual({
      width: 210,
      height: 297,
      swapped: false,
    })
    // 축별 독립 폴백(0 → 폴백) — 현행 `|| 210 / || 297` 보존
    expect(resolveSingleModePdfSizeMm({ width: 0, height: 500 }, null)).toEqual({
      width: 210,
      height: 500,
      swapped: false,
    })
    // templateSet 판형 미보유(null) → 전달값 그대로
    expect(resolveSingleModePdfSizeMm({ width: 297, height: 210 }, null)).toEqual({
      width: 297,
      height: 210,
      swapped: false,
    })
  })

  it('의미 정합: 정규화(swapped=true)가 일어나는 케이스는 항상 detectOrientationMismatch 도 불일치를 보고한다', () => {
    // 헬퍼의 스왑 판정은 기존 방향 가드(2026-07-09)가 경고하는 케이스의 부분집합이어야 한다
    const cases: Array<[{ width: number; height: number }, { width: number; height: number }]> = [
      [{ width: 297, height: 210 }, { width: 210, height: 297 }],
      [{ width: 257, height: 182 }, { width: 182, height: 257 }],
      [{ width: 182, height: 128 }, { width: 128, height: 182 }],
    ]
    for (const [requested, template] of cases) {
      const normalized = resolveSingleModePdfSizeMm(requested, template)
      expect(normalized.swapped).toBe(true)
      expect(detectOrientationMismatch(requested, template)).not.toBeNull()
    }
  })
})
