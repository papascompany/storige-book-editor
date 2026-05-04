/**
 * OpenCV + 배경 제거 lazy-loader + warmup helpers
 *
 * 기존엔 ImageProcessingPlugin 내부에 module-level 캐시가 있었으나
 * 첫 업로드 시점에 OpenCV WASM 다운로드/컴파일 + onnxruntime warmup이
 * 메인 스레드를 5초+ 점유해 브라우저 unresponsive 모달이 뜨는 문제 발견.
 *
 * 이 모듈로 분리해서 두 가지 사용:
 *   - ImageProcessingPlugin.processImage() 등 실 사용 시점 (await getCv())
 *   - EditorView mount 시 idle 시간 background warmup (warmupOpenCv())
 *
 * 같은 module-level Promise 캐시를 공유하므로 두 호출 시 중복 다운로드 X.
 */

let cv: any = null
let cvLoadingPromise: Promise<any> | null = null

let bgRemoval: { preload: any; removeBackground: any } | null = null
let bgRemovalPromise: Promise<{ preload: any; removeBackground: any }> | null = null

/**
 * OpenCV WASM 인스턴스 lazy load (동시 호출 시 동일 Promise 반환).
 */
export async function getCv(): Promise<any> {
  if (cv) return cv
  if (cvLoadingPromise) return cvLoadingPromise

  cvLoadingPromise = import('@techstark/opencv-js').then((module) => {
    cv = (module as any).default || module
    return cv
  })
  return cvLoadingPromise
}

/**
 * 배경 제거 모듈 lazy load (onnxruntime-web 포함).
 */
export async function getBackgroundRemoval(): Promise<{
  preload: any
  removeBackground: any
}> {
  if (bgRemoval) return bgRemoval
  if (bgRemovalPromise) return bgRemovalPromise

  bgRemovalPromise = import('@imgly/background-removal').then((mod) => {
    bgRemoval = { preload: (mod as any).preload, removeBackground: (mod as any).removeBackground }
    return bgRemoval
  })
  return bgRemovalPromise
}

/**
 * 백그라운드 warmup — 에디터 진입 시 idle callback에서 호출.
 *
 * 사용자가 처음 이미지 업로드 / 배경 제거를 시도하기 전에 미리 WASM을
 * 다운로드/컴파일해 둠으로써 첫 업로드 시 메인 스레드 freeze 방지.
 *
 * 실패 시 silent (네트워크 끊김 등) — 실 사용 시점에 다시 시도됨.
 */
export function warmupOpenCv(): void {
  // 이미 로드됐거나 진행 중이면 skip
  if (cv || cvLoadingPromise) return

  // requestIdleCallback 미지원 환경(Safari 일부) → setTimeout fallback
  const schedule =
    typeof window !== 'undefined' && 'requestIdleCallback' in window
      ? (cb: () => void) => (window as any).requestIdleCallback(cb, { timeout: 3000 })
      : (cb: () => void) => setTimeout(cb, 500)

  schedule(() => {
    getCv().catch(() => {
      // warmup 실패는 silent — 실 사용 시점에 정상 처리
    })
  })
}

/**
 * 배경 제거 모듈 warmup (onnxruntime + ML 모델 다운로드).
 * 별도 옵션 — 사용자가 배경 제거 기능을 거의 안 쓰는 경우 호출 X.
 */
export function warmupBackgroundRemoval(): void {
  if (bgRemoval || bgRemovalPromise) return

  const schedule =
    typeof window !== 'undefined' && 'requestIdleCallback' in window
      ? (cb: () => void) => (window as any).requestIdleCallback(cb, { timeout: 5000 })
      : (cb: () => void) => setTimeout(cb, 1500)

  schedule(() => {
    getBackgroundRemoval().catch(() => {
      // silent
    })
  })
}
