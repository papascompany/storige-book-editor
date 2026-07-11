import { describe, it, expect, vi } from 'vitest'
import { bindPrintExcludeOverlay, drawPrintExcludeOverlay } from './printExcludeOverlay'

/**
 * L4-① (2026-07-11): printExclude 화면 전용 오버레이 회귀 테스트.
 *
 * 핵심 불변: 오버레이는 contextTop 순수 드로잉만 — fabric 객체 추가/속성 변경이 없어야
 * toJSON(저장)·PDF·썸네일(toDataURL=lower canvas) 출력이 오염되지 않는다.
 * (repo 테스트 관례에 따라 fabric 실캔버스 없이 최소 mock 으로 계약을 고정한다.)
 */

type AnyObj = Record<string, any>

function makeCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    setLineDash: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 40 })),
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    font: '',
    textBaseline: '',
  }
}

function makeObj(over: AnyObj = {}): AnyObj {
  return {
    type: 'textbox',
    visible: true,
    getBoundingRect: vi.fn(() => ({ left: 10, top: 20, width: 100, height: 50 })),
    ...over,
  }
}

function makeCanvas(objects: AnyObj[], over: AnyObj = {}): AnyObj {
  const handlers: Record<string, Array<() => void>> = {}
  return {
    contextTop: makeCtx(),
    viewportTransform: [1, 0, 0, 1, 0, 0],
    getObjects: () => objects,
    add: vi.fn(),
    remove: vi.fn(),
    on: vi.fn((ev: string, fn: () => void) => {
      ;(handlers[ev] ||= []).push(fn)
    }),
    __handlers: handlers,
    ...over,
  }
}

describe('bindPrintExcludeOverlay', () => {
  it('after:render 훅을 1회만 바인딩(멱등)', () => {
    const canvas = makeCanvas([])
    bindPrintExcludeOverlay(canvas as never)
    bindPrintExcludeOverlay(canvas as never)
    bindPrintExcludeOverlay(canvas as never)
    expect(canvas.on).toHaveBeenCalledTimes(1)
    expect(canvas.on).toHaveBeenCalledWith('after:render', expect.any(Function))
  })

  it('훅 발화 시 fabric 객체 추가/제거 없이 contextTop 에만 드로잉 (toJSON/toDataURL 무오염)', () => {
    const target = makeObj({ printExclude: true })
    const canvas = makeCanvas([target])
    bindPrintExcludeOverlay(canvas as never)

    const snapshotBefore = JSON.stringify({ ...target, getBoundingRect: undefined })
    canvas.__handlers['after:render'][0]()

    // 객체 추가/제거 없음 → 직렬화(toJSON)·출력(PDF)·썸네일 파이프라인에 진입할 신규 객체가 없다.
    expect(canvas.add).not.toHaveBeenCalled()
    expect(canvas.remove).not.toHaveBeenCalled()
    // 대상 객체 속성 무변경(excludeFromExport 등 미조작)
    expect(JSON.stringify({ ...target, getBoundingRect: undefined })).toBe(snapshotBefore)
    // contextTop 에 실제 드로잉 발생
    expect(canvas.contextTop.strokeRect).toHaveBeenCalledTimes(1)
    expect(canvas.contextTop.fillText).toHaveBeenCalledWith('인쇄 제외', expect.any(Number), expect.any(Number))
  })
})

describe('drawPrintExcludeOverlay', () => {
  it('printExclude 아닌 객체·visible=false 객체는 드로잉하지 않음', () => {
    const canvas = makeCanvas([
      makeObj({}),
      makeObj({ printExclude: true, visible: false }),
    ])
    drawPrintExcludeOverlay(canvas as never)
    expect(canvas.contextTop.strokeRect).not.toHaveBeenCalled()
  })

  it('viewportTransform(줌/팬) 적용 화면좌표로 드로잉', () => {
    const target = makeObj({ printExclude: true })
    const canvas = makeCanvas([target], { viewportTransform: [2, 0, 0, 2, 30, 40] })
    drawPrintExcludeOverlay(canvas as never)
    // 절대좌표(10,20,100,50) → zoom 2 + pan(30,40) = (50, 80, 200, 100)
    expect(canvas.contextTop.strokeRect).toHaveBeenCalledWith(50, 80, 200, 100)
    expect(target.getBoundingRect).toHaveBeenCalledWith(true, true)
  })

  it('직전 프레임 드로잉 영역을 다음 호출에서 clearRect (잔상 방지)', () => {
    const target = makeObj({ printExclude: true })
    const canvas = makeCanvas([target])
    drawPrintExcludeOverlay(canvas as never)
    expect(canvas.contextTop.clearRect).not.toHaveBeenCalled()
    drawPrintExcludeOverlay(canvas as never)
    expect(canvas.contextTop.clearRect).toHaveBeenCalledTimes(1)
  })

  it('contextTop 이 없으면 무동작 (dispose/정적 캔버스 방어)', () => {
    const canvas = makeCanvas([makeObj({ printExclude: true })], { contextTop: undefined })
    expect(() => drawPrintExcludeOverlay(canvas as never)).not.toThrow()
  })
})
