// snapCoordinator — 스냅 계산 순수 로직 테스트 (E1 §5-1)
import { describe, it, expect } from 'vitest'
import {
  SnapBounds,
  boundsIntersect,
  computeSnap,
  snapAngle,
  toSnapBounds,
} from './snapCoordinator'

const bounds = (left: number, top: number, width: number, height: number): SnapBounds =>
  toSnapBounds({ left, top, width, height })

describe('toSnapBounds', () => {
  it('엣지 2 + 센터 1 (축별 3선) 을 정확히 산출한다', () => {
    const b = bounds(100, 200, 40, 60)
    expect(b).toEqual({
      left: 100,
      right: 140,
      centerX: 120,
      top: 200,
      bottom: 260,
      centerY: 230,
    })
  })
})

describe('computeSnap — 스냅 좌표 정확성', () => {
  const SHOW = 15
  const SNAP = 8

  it('이동 객체 left 가 후보 left 에 스냅 임계값 이내로 근접하면 delta 를 반환한다', () => {
    const moving = bounds(105, 500, 50, 50) // left=105
    const candidate = bounds(100, 100, 80, 80) // left=100
    const r = computeSnap(moving, [candidate], SHOW, SNAP)
    expect(r.x.delta).toBe(-5) // 105 → 100
    expect(r.x.guideLine).toBe(100)
    // y 축은 far (top 500 vs 후보 100..180) — 무반응
    expect(r.y.delta).toBeNull()
    expect(r.y.guideLine).toBeNull()
  })

  it('센터-센터 정렬: 이동 센터가 후보 센터에 근접하면 센터 기준 delta', () => {
    // 3선×3선 전조합 중 센터-센터(|100-106|=6)가 최근접이 되도록 배치
    // (moving left=90 ↔ 후보 centerX=100 은 10 으로 더 멀다)
    const moving = bounds(90, 0, 32, 20) // lines [90, 106, 122]
    const candidate = bounds(50, 300, 100, 100) // lines [50, 100, 150]
    const r = computeSnap(moving, [candidate], SHOW, SNAP)
    expect(r.x.delta).toBe(-6) // centerX 106 → 100
    expect(r.x.guideLine).toBe(100)
  })

  it('이동 right ↔ 후보 left(맞닿음) 정렬도 지원한다', () => {
    const moving = bounds(0, 0, 97, 20) // right=97
    const candidate = bounds(100, 0, 50, 20) // left=100
    const r = computeSnap(moving, [candidate], SHOW, SNAP)
    expect(r.x.delta).toBe(3) // right 97 → 100
    expect(r.x.guideLine).toBe(100)
  })

  it('스냅 임계값(8) 밖 + 표시 임계값(15) 안이면 가이드만 표시하고 스냅하지 않는다', () => {
    // 최근접 조합 = moving left 110 ↔ 후보 left 100 (10px) — 다른 선들은 전부 15px 밖
    const moving = bounds(110, 0, 300, 50) // lines [110, 260, 410]
    const candidate = bounds(100, 200, 80, 80) // lines [100, 140, 180]
    const r = computeSnap(moving, [candidate], SHOW, SNAP)
    expect(r.x.delta).toBeNull()
    expect(r.x.guideLine).toBe(100)
  })

  it('표시 임계값 밖이면 완전 무반응', () => {
    // 최근접 조합조차 20px (moving left 120 ↔ 후보 left 100 / centerX 140)
    const moving = bounds(120, 0, 300, 50) // lines [120, 270, 420]
    const candidate = bounds(100, 200, 80, 80) // lines [100, 140, 180]
    const r = computeSnap(moving, [candidate], SHOW, SNAP)
    expect(r.x.delta).toBeNull()
    expect(r.x.guideLine).toBeNull()
  })

  it('복수 후보 중 최근접 선을 선택한다', () => {
    const moving = bounds(103, 0, 50, 50) // left=103
    const far = bounds(110, 200, 80, 80) // left=110 (거리 7)
    const near = bounds(101, 400, 80, 80) // left=101 (거리 2)
    const r = computeSnap(moving, [far, near], SHOW, SNAP)
    expect(r.x.delta).toBe(-2) // 103 → 101
    expect(r.x.guideLine).toBe(101)
  })

  it('x·y 양축 동시 스냅이 독립적으로 판정된다', () => {
    const moving = bounds(103, 52, 50, 50)
    const candidate = bounds(100, 50, 50, 50)
    const r = computeSnap(moving, [candidate], SHOW, SNAP)
    expect(r.x.delta).toBe(-3)
    expect(r.y.delta).toBe(-2)
  })

  it('후보 0건이면 무반응', () => {
    const r = computeSnap(bounds(0, 0, 10, 10), [], SHOW, SNAP)
    expect(r.x.delta).toBeNull()
    expect(r.y.guideLine).toBeNull()
  })

  it('zoom 환산된 임계값 시맨틱: 화면 8px @ zoom 2 = canvas 4px', () => {
    // 호출측이 /zoom 으로 환산해 넘기는 계약 — canvas 5px 거리는 zoom 2 에서 스냅 안 됨
    const moving = bounds(105, 0, 50, 50)
    const candidate = bounds(100, 200, 80, 80)
    const r = computeSnap(moving, [candidate], 15 / 2, 8 / 2)
    expect(r.x.delta).toBeNull() // 5 > 4
    expect(r.x.guideLine).toBe(100) // 5 < 7.5
  })
})

describe('snapAngle — 회전 각도 스냅 라운딩', () => {
  it('15° 배수 ±3° 이내면 라운딩된 각을 반환한다', () => {
    expect(snapAngle(14, 15, 3)).toBe(15)
    expect(snapAngle(16.5, 15, 3)).toBe(15)
    expect(snapAngle(43.2, 15, 3)).toBe(45)
    expect(snapAngle(0.5, 15, 3)).toBe(0)
    expect(snapAngle(88, 15, 3)).toBe(90)
  })

  it('허용 오차 밖이면 null (자유 회전 유지)', () => {
    expect(snapAngle(10, 15, 3)).toBeNull()
    expect(snapAngle(22.5, 15, 3)).toBeNull()
    expect(snapAngle(50, 15, 3)).toBeNull()
  })

  it('경계값: 정확히 tolerance 거리는 스냅된다 (≤)', () => {
    expect(snapAngle(12, 15, 3)).toBe(15)
    expect(snapAngle(18, 15, 3)).toBe(15)
  })

  it('음수 각도에서도 동작한다', () => {
    expect(snapAngle(-14, 15, 3)).toBe(-15)
    expect(snapAngle(-46, 15, 3)).toBe(-45)
    expect(snapAngle(-10, 15, 3)).toBeNull()
  })

  it('360° 부근: 358 → 360', () => {
    expect(snapAngle(358, 15, 3)).toBe(360)
  })

  it('step 0 이하는 방어적으로 null', () => {
    expect(snapAngle(15, 0, 3)).toBeNull()
  })
})

describe('boundsIntersect — 뷰포트 컬링', () => {
  const viewport = { left: 0, top: 0, right: 1000, bottom: 800 }

  it('뷰포트 안/걸침 객체는 true', () => {
    expect(boundsIntersect(bounds(100, 100, 50, 50), viewport)).toBe(true)
    expect(boundsIntersect(bounds(-20, -20, 50, 50), viewport)).toBe(true) // 걸침
    expect(boundsIntersect(bounds(990, 790, 50, 50), viewport)).toBe(true) // 걸침
  })

  it('뷰포트 완전 밖 객체는 false', () => {
    expect(boundsIntersect(bounds(1100, 100, 50, 50), viewport)).toBe(false)
    expect(boundsIntersect(bounds(100, -200, 50, 50), viewport)).toBe(false)
  })
})
