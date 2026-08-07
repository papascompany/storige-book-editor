// @vitest-environment jsdom
// OpenCV 로더 회귀 잠금 (2026-08-07)
//
// 배경: `import('@techstark/opencv-js')` 는 Emscripten UMD 를 ESM 스코프에서 평가해
// 프로덕션에서 **영원히 resolve 되지 않았다**(모양컷 '효과' 6분+ 응답 없음, localStorage
// 트레이스로 ensureCvReady 에서 멈춤 확정). 잠그는 불변식:
//  ① configureOpenCv 주입 시 <script> 태그 로드 경로를 탄다
//  ② 준비 신호 3형태(즉시 ready / onRuntimeInitialized / thenable)를 모두 처리한다
//  ③ 어떤 경로든 타임아웃 안에 끝나지 않으면 **reject** 한다(무한 대기 금지)
//  ④ 실패 후 재호출하면 재시도된다(캐시 리셋)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 폴백(dynamic import) 경로용 스텁 — 임베드 IIFE 의 opencvStubPlugin 과 같은 형상.
const fallbackStub = { Mat: class Mat {}, imread: () => null }
vi.mock('@techstark/opencv-js', () => ({ default: fallbackStub }))

async function freshModule() {
  vi.resetModules()
  return await import('./openCv')
}

function cleanupGlobals() {
  delete (globalThis as any).cv
  document.head.querySelectorAll('script').forEach((s) => s.remove())
}

beforeEach(cleanupGlobals)
afterEach(() => {
  vi.useRealTimers()
  cleanupGlobals()
})

describe('openCv 로더 — <script> 태그 경로 (2026-08-07 전환)', () => {
  it('① scriptUrl 주입 + 전역 cv 가 이미 준비면 스크립트 태그 없이 즉시 반환한다', async () => {
    const mod = await freshModule()
    mod.configureOpenCv({ scriptUrl: '/assets/opencv-test.js' })
    const ready = { Mat: class Mat {} }
    ;(globalThis as any).cv = ready

    const cv = await mod.getCv()

    expect(cv).toBe(ready)
    expect(document.head.querySelector('script')).toBeNull()
  })

  it('② 스크립트 로드 후 onRuntimeInitialized 로 준비되는 classic 빌드를 처리한다', async () => {
    const mod = await freshModule()
    mod.configureOpenCv({ scriptUrl: '/assets/opencv-test.js' })

    const promise = mod.getCv()
    // loadScript 가 태그를 붙일 때까지 마이크로태스크 양보
    await Promise.resolve()
    const script = document.head.querySelector('script') as HTMLScriptElement
    expect(script?.src).toContain('/assets/opencv-test.js')

    // UMD 가 만드는 전역: 아직 Mat 없음(초기화 중)
    const moduleObj: any = {}
    ;(globalThis as any).cv = moduleObj
    script.dispatchEvent(new Event('load'))
    // waitForRuntime 이 onRuntimeInitialized 훅을 걸 때까지 양보
    await Promise.resolve()
    await Promise.resolve()

    moduleObj.Mat = class Mat {}
    moduleObj.onRuntimeInitialized?.()

    await expect(promise).resolves.toBe(moduleObj)
  })

  it('② thenable(modularized) 빌드도 처리한다', async () => {
    const mod = await freshModule()
    mod.configureOpenCv({ scriptUrl: '/assets/opencv-test.js' })
    const ready = { Mat: class Mat {} }
    ;(globalThis as any).cv = { then: (res: (v: any) => void) => res(ready) }

    await expect(mod.getCv()).resolves.toBe(ready)
  })

  it('③④ 준비가 영원히 안 되면 타임아웃으로 reject 하고, 재호출은 재시도된다', async () => {
    vi.useFakeTimers()
    const mod = await freshModule()
    mod.configureOpenCv({ scriptUrl: '/assets/opencv-test.js' })

    const promise = mod.getCv()
    const rejection = expect(promise).rejects.toThrow(/초 안에 끝나지 않았습니다/)
    await Promise.resolve()
    const script = document.head.querySelector('script') as HTMLScriptElement
    ;(globalThis as any).cv = {} // 영원히 Mat 이 생기지 않는 모듈
    script.dispatchEvent(new Event('load'))

    await vi.advanceTimersByTimeAsync(mod.OPENCV_READY_TIMEOUT_MS + 1000)
    await rejection

    // 재시도 — 이번엔 전역이 준비돼 있으면 성공해야 한다(캐시 리셋 검증)
    vi.useRealTimers()
    ;(globalThis as any).cv = { Mat: class Mat {} }
    await expect(mod.getCv()).resolves.toBe((globalThis as any).cv)
  })
})

describe('openCv 로더 — 폴백(dynamic import) 경로', () => {
  it('미주입 환경(임베드 스텁·테스트)은 종전 import 폴백을 타고, 스텁은 즉시 통과한다', async () => {
    const mod = await freshModule()
    // configureOpenCv 미호출

    await expect(mod.getCv()).resolves.toBe(fallbackStub)
    expect(document.head.querySelector('script')).toBeNull()
  })
})
