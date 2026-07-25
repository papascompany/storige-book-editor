// @vitest-environment jsdom
//
// syncFabricDevicePixelRatio — 클릭 좌표 오프셋(dpr/줌 정합) 수정의 핵심 헬퍼 검증.
//
// 증명 대상:
//  ① 살아있는 window.devicePixelRatio 로 fabric 의 캐시된 devicePixelRatio 를 갱신하고 true 반환
//  ② 이미 동기 상태(동일 dpr)면 no-op + false 반환 (무의미한 재정합 방지)
//  ③ dpr 이 다시 바뀌면 새 값으로 재갱신
//
// fabric 은 devicePixelRatio 프로퍼티만 가진 최소 mock 으로 대체한다(헬퍼가 읽고/쓰는 표면만).
import { describe, it, expect, beforeEach, vi } from 'vitest'

// factory.ts 는 `import { fabric } from 'fabric'` 로 네임스페이스를 참조하고
// syncFabricDevicePixelRatio 는 fabric.devicePixelRatio 를 읽고 쓴다.
vi.mock('fabric', () => ({
  fabric: { devicePixelRatio: 1 },
}))

import { fabric } from 'fabric'
import { syncFabricDevicePixelRatio } from './factory'

function setWindowDpr(v: number | undefined): void {
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    value: v,
  })
}

const fb = fabric as unknown as { devicePixelRatio: number }

describe('syncFabricDevicePixelRatio', () => {
  beforeEach(() => {
    fb.devicePixelRatio = 1
    setWindowDpr(1)
  })

  it('① 살아있는 dpr(2.5)로 캐시를 갱신하고 true 를 반환한다', () => {
    setWindowDpr(2.5)
    const changed = syncFabricDevicePixelRatio()
    expect(changed).toBe(true)
    expect(fb.devicePixelRatio).toBeCloseTo(2.5)
  })

  it('② 이미 동기 상태면 no-op + false', () => {
    setWindowDpr(2)
    fb.devicePixelRatio = 2
    const changed = syncFabricDevicePixelRatio()
    expect(changed).toBe(false)
    expect(fb.devicePixelRatio).toBe(2)
  })

  it('③ dpr 이 다시 바뀌면 새 값으로 재갱신한다', () => {
    setWindowDpr(2)
    expect(syncFabricDevicePixelRatio()).toBe(true)
    expect(fb.devicePixelRatio).toBeCloseTo(2)

    setWindowDpr(3)
    expect(syncFabricDevicePixelRatio()).toBe(true)
    expect(fb.devicePixelRatio).toBeCloseTo(3)
  })

  it('window.devicePixelRatio 미정의(undefined)면 1 로 간주 — 캐시 1 과 동일하므로 false', () => {
    setWindowDpr(undefined)
    fb.devicePixelRatio = 1
    expect(syncFabricDevicePixelRatio()).toBe(false)
    expect(fb.devicePixelRatio).toBe(1)
  })
})
