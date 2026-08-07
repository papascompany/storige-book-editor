/**
 * OpenCV lazy-loader + warmup helper
 *
 * ⚠️ 로딩 방식이 **`<script>` 태그 주입**으로 바뀌었다(2026-08-07 실적발).
 *
 * 종전의 `import('@techstark/opencv-js')` 는 프로덕션에서 **영원히 resolve 되지 않았다**
 * (localStorage 트레이스: `▶ ensureCvReady` 진입 후 완료 기록 없음 → 모양컷 '효과' 6분+ 응답 없음).
 * dist/opencv.js 는 Emscripten UMD 라 ESM 모듈 스코프에서는 `this === undefined` 여서
 * `root.cv = factory()` 가 깨진다(dev 실측: "Cannot set properties of undefined (setting 'cv')").
 * 클래식 `<script>` 로드는 UMD 의 `typeof window === 'object'` 분기를 타는 정상 경로다.
 *
 * canvas-core 는 tsc 로 빌드되므로 vite 전용 `?url` 문법을 여기서 쓸 수 없다 —
 * **소비 앱(editor)이 `configureOpenCv({ scriptUrl })` 로 자산 URL 을 주입**한다
 * (editor: `src/utils/opencvLoader.ts`, SPA 엔트리 전용 — 임베드 IIFE 는 종전 스텁 경로 유지).
 *
 * 미주입 환경(임베드 스텁·테스트·admin)은 종전 동적 import 로 폴백하되,
 * 어떤 경로든 `READY_TIMEOUT_MS` 안에 끝나지 않으면 **reject 한다**(무한 대기 금지 —
 * 호출부 토스트/에러 처리가 동작하려면 반드시 끝나야 한다).
 *
 * 같은 module-level Promise 캐시를 공유하므로 동시 호출 시 중복 로드는 없다.
 */

let cv: any = null
let cvLoadingPromise: Promise<any> | null = null
let configuredScriptUrl: string | null = null

/** 초기화 전체(스크립트 다운로드 + wasm 컴파일) 상한. 초과 시 reject — 재호출 시 재시도된다. */
export const OPENCV_READY_TIMEOUT_MS = 20_000

/**
 * OpenCV 자산 URL 주입 — 앱 부트스트랩에서 1회 호출.
 * (vite: `import url from '@techstark/opencv-js/dist/opencv.js?url'`)
 */
export function configureOpenCv(options: { scriptUrl?: string }): void {
  if (options.scriptUrl) configuredScriptUrl = options.scriptUrl
}

/** 런타임 준비 판정 — 실제 API(Mat)가 생겼는가. 임베드 스텁도 Mat 클래스를 가져 통과한다. */
function isCvReady(candidate: any): boolean {
  return !!candidate && typeof candidate.Mat === 'function'
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`OpenCV ${what}가 ${Math.round(ms / 1000)}초 안에 끝나지 않았습니다.`)),
      ms
    )
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

/** 클래식 스크립트 로드 — UMD 가 `window.cv` 전역을 만든다. */
function loadScript(url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const el = document.createElement('script')
    el.src = url
    el.async = true
    el.onload = () => resolve()
    el.onerror = () => {
      el.remove()
      reject(new Error(`OpenCV 스크립트 로드 실패: ${url}`))
    }
    document.head.appendChild(el)
  })
}

/**
 * Emscripten 산출물의 준비 신호 3형태를 모두 처리한다:
 *  1) 이미 준비됨(cv.Mat 존재) — 즉시 반환
 *  2) thenable(modularized 빌드) — resolve 를 기다림
 *  3) classic — `onRuntimeInitialized` 콜백 + 100ms 폴링 이중화
 *     (콜백은 우리가 훅을 걸기 전에 이미 발화했을 수 있어 폴링이 반드시 함께 필요하다)
 * 상한은 바깥 withTimeout 이 건다. 내부 폴링도 같은 상한에서 스스로 멈춰 타이머 누수를 막는다.
 */
function waitForRuntime(candidate: any): Promise<any> {
  if (isCvReady(candidate)) return Promise.resolve(candidate)

  if (candidate && typeof candidate.then === 'function') {
    return Promise.resolve(candidate).then((resolved: any) =>
      isCvReady(resolved) ? resolved : isCvReady(candidate) ? candidate : resolved || candidate
    )
  }

  return new Promise((resolve) => {
    let settled = false
    const settle = (value: any) => {
      if (settled) return
      settled = true
      clearInterval(poll)
      resolve(value)
    }

    if (candidate && typeof candidate === 'object') {
      const previous = candidate.onRuntimeInitialized
      try {
        candidate.onRuntimeInitialized = () => {
          try {
            if (typeof previous === 'function') previous()
          } catch {
            /* 기존 핸들러 실패는 무시 */
          }
          settle(candidate)
        }
      } catch {
        /* 콜백을 걸 수 없는 객체 — 폴링만으로 진행 */
      }
    }

    const maxTicks = Math.ceil(OPENCV_READY_TIMEOUT_MS / 100) + 5
    let ticks = 0
    const poll = setInterval(() => {
      if (isCvReady(candidate)) {
        settle(candidate)
      } else if (++ticks > maxTicks) {
        clearInterval(poll) // resolve 하지 않는다 — 바깥 withTimeout 이 reject 한다
      }
    }, 100)
  })
}

async function loadCvOnce(): Promise<any> {
  const g = globalThis as any

  if (configuredScriptUrl) {
    // 전역에 이미 있으면(중복 스크립트 방지) 준비만 기다린다.
    if (!g.cv) {
      await loadScript(configuredScriptUrl)
    }
    return waitForRuntime(g.cv)
  }

  // 폴백 — 임베드(스텁 치환)·테스트·미주입 소비자용. 실제 editor 는 항상 주입돼 이 경로를 타지 않는다.
  const module = await import('@techstark/opencv-js')
  const candidate = (module as any).default || module
  return waitForRuntime(candidate)
}

/**
 * OpenCV WASM 인스턴스 lazy load (동시 호출 시 동일 Promise 반환).
 * 실패·타임아웃 시 캐시를 리셋하므로 다음 호출에서 재시도된다.
 */
export async function getCv(): Promise<any> {
  if (cv) return cv
  if (cvLoadingPromise) return cvLoadingPromise

  cvLoadingPromise = withTimeout(loadCvOnce(), OPENCV_READY_TIMEOUT_MS, '초기화')
    .then((ready) => {
      cv = ready
      return ready
    })
    .catch((e) => {
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
