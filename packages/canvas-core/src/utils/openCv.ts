/**
 * OpenCV lazy-loader + warmup helper
 *
 * 기존엔 ImageProcessingPlugin 내부에 module-level 캐시가 있었으나
 * 첫 업로드 시점에 OpenCV WASM 다운로드/컴파일이 메인 스레드를 5초+ 점유해
 * 브라우저 unresponsive 모달이 뜨는 문제 발견.
 *
 * ⚠️ 배경제거(@imgly/background-removal, AGPL-3.0) 로더는 **제거됐다** —
 *    추론은 서버(rembg 사이드카)가 한다(D-12d, 2026-08-06 · editor `api/cutout.ts`).
 *
 * 이 모듈로 분리해서 두 가지 사용:
 *   - ImageProcessingPlugin.processImage() 등 실 사용 시점 (await getCv())
 *   - EditorView mount 시 idle 시간 background warmup (warmupOpenCv())
 *
 * 같은 module-level Promise 캐시를 공유하므로 두 호출 시 중복 다운로드 X.
 */

let cv: any = null
let cvLoadingPromise: Promise<any> | null = null

/**
 * OpenCV WASM 인스턴스 lazy load (동시 호출 시 동일 Promise 반환).
 */
export async function getCv(): Promise<any> {
  if (cv) return cv
  if (cvLoadingPromise) return cvLoadingPromise

  cvLoadingPromise = import('@techstark/opencv-js')
    .then((module) => {
      cv = (module as any).default || module
      return cv
    })
    .catch((e) => {
      // D-6b① — 실패 시 캐시 리셋: 네트워크 일시 장애 후 다음 호출에서 재시도 가능
      cvLoadingPromise = null
      throw e
    })
  return cvLoadingPromise
}

/**
 * 백그라운드 warmup — 에디터 진입 시 idle callback에서 호출.
 *
 * 사용자가 처음 이미지 업로드(윤곽/트림 등 OpenCV 경로)를 시도하기 전에 미리 WASM을
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
