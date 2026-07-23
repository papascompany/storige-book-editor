/**
 * 트랙 C G-2 — 기하 parity spec (2026-07-23).
 *
 * @storige/types computeSpreadRegionRangesMm(mm 단일 소스, 표지 파생 유틸 소비)와
 * SpreadLayoutEngine.computeLayout(px, 편집기 소비)의 영역 시맨틱 드리프트 봉쇄.
 * SpreadLayoutEngine 은 무변경 — 이 spec 이 단일 시맨틱을 보증한다.
 */
import { describe, it, expect } from 'vitest'
import type { SpreadSpec } from '@storige/types'
import { SPREAD_REGION_LABELS, computeSpreadRegionRangesMm } from '@storige/types'
import { computeLayout } from './SpreadLayoutEngine'

const pxToMm = (px: number, dpi: number) => (px * 25.4) / dpi

function makeSpec(over: Partial<SpreadSpec>): SpreadSpec {
  return {
    coverWidthMm: 214,
    coverHeightMm: 301,
    spineWidthMm: 7.5,
    wingEnabled: false,
    wingWidthMm: 0,
    cutSizeMm: 3,
    safeSizeMm: 3,
    dpi: 150,
    ...over,
  }
}

// 표본: wing on/off × spine {0.1, 1.2, 7.5, 30} × 세로/가로 판형
const SPINES = [0.1, 1.2, 7.5, 30]
const SHAPES: Array<Partial<SpreadSpec>> = [
  {},                                             // 세로 표지(A4하드커버 실물 형상)
  { coverWidthMm: 301, coverHeightMm: 214 },      // 가로 파생 형상
]
const WINGS: Array<Partial<SpreadSpec>> = [
  {},
  { wingEnabled: true, wingWidthMm: 60 },
]

describe('G-2 parity — computeSpreadRegionRangesMm ↔ SpreadLayoutEngine.computeLayout', () => {
  for (const shape of SHAPES) {
    for (const wing of WINGS) {
      for (const spine of SPINES) {
        const spec = makeSpec({ ...shape, ...wing, spineWidthMm: spine })
        const name = `cover ${spec.coverWidthMm}×${spec.coverHeightMm} spine ${spine} wing ${spec.wingEnabled ? spec.wingWidthMm : 'off'}`

        it(`${name} — 영역 수·순서·경계(mm) 전 필드 일치`, () => {
          const ranges = computeSpreadRegionRangesMm(spec)
          const layout = computeLayout(spec)

          expect(layout.regions.length).toBe(ranges.length)
          for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i]
            const lr = layout.regions[i]
            expect(lr.position).toBe(r.position)
            expect(pxToMm(lr.x, spec.dpi)).toBeCloseTo(r.x0Mm, 6)
            expect(pxToMm(lr.width, spec.dpi)).toBeCloseTo(r.widthMm, 6)
            expect(lr.widthMm).toBeCloseTo(r.widthMm, 6)
            // 라벨 문자열 고정 매핑 드리프트 봉쇄(파생 spreadConfig.regions 가 이 라벨 사용)
            expect(lr.label).toBe(SPREAD_REGION_LABELS[r.position])
          }
          // 마지막 경계 = 총폭
          const last = ranges[ranges.length - 1]
          expect(last.x1Mm).toBeCloseTo(layout.totalWidthMm, 6)
        })
      }
    }
  }
})
