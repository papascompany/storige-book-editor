/**
 * createCanvas 플러그인 생성 순서 계약 (적대 리뷰 P0, 2026-07-15)
 *
 * fabric 이벤트 핸들러는 등록(=생성자 바인딩) 순서대로 발화한다. SmartGuidesPlugin(스냅)과
 * FrameInteractionPlugin(사진틀 fillImage/clipPath 동기화)은 둘 다 **생성자**에서
 * object:moving/rotating 을 바인딩하므로, initPlugins 의 `new SmartGuidesPlugin(...)` 이
 * `new FrameInteractionPlugin(...)` 보다 **소스상 먼저** 와야 "스냅 → 프레임 동기화" 순서가
 * 성립한다(뒤면 사진·마스크가 스냅 전 raw 값으로 동기화됨 — 이동 최대 8/zoom px·회전 3°).
 *
 * createCanvas 는 DOM/폰트/API 배선 없이는 실행 불가하므로, 여기서는 소스 텍스트의 생성
 * 순서를 잠근다(행동 검증은 canvas-core 의 SmartGuidesFrameInteractionOrder.test.ts 가
 * 동일 생성 순서로 두 플러그인을 실제 인스턴스화해 리스너 순서·스냅 선행을 스파이로 증명).
 */
import { describe, it, expect } from 'vitest'
// vite `?raw` — happy-dom 이 import.meta.url 을 http 스킴으로 바꿔 node:fs 경로 유도가
// 불가하므로, 번들러가 소스 텍스트를 직접 주입하는 raw import 를 사용한다(경로 이동에도 안전).
import source from './createCanvas.ts?raw'

describe('createCanvas — 플러그인 생성(바인딩) 순서 계약', () => {
  it('SmartGuidesPlugin 이 FrameInteractionPlugin 보다 먼저 생성된다 (스냅 → 사진틀 동기화)', () => {
    const smartGuidesAt = source.indexOf('new SmartGuidesPlugin(')
    const frameInteractionAt = source.indexOf('new FrameInteractionPlugin(')
    expect(smartGuidesAt).toBeGreaterThan(-1)
    expect(frameInteractionAt).toBeGreaterThan(-1)
    expect(smartGuidesAt).toBeLessThan(frameInteractionAt)
  })

  it('RulerPlugin(중앙 스냅) → SmartGuidesPlugin 기존 질서도 유지된다', () => {
    const rulerAt = source.indexOf('new RulerPlugin(')
    const smartGuidesAt = source.indexOf('new SmartGuidesPlugin(')
    expect(rulerAt).toBeGreaterThan(-1)
    expect(rulerAt).toBeLessThan(smartGuidesAt)
  })

  it('각 플러그인 생성은 단일 지점이다 (다중 생성으로 인한 순서 판정 오염 방지)', () => {
    for (const token of [
      'new SmartGuidesPlugin(',
      'new FrameInteractionPlugin(',
      'new RulerPlugin(',
    ]) {
      expect(source.indexOf(token)).toBe(source.lastIndexOf(token))
    }
  })
})
