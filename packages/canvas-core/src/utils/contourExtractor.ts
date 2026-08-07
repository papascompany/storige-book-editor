/**
 * 알파 윤곽 추출기 주입 계약 (2026-08-07)
 *
 * 배경: @techstark/opencv-js(dist/opencv.js, wasm 인라인 UMD)는 **메인 스레드에서는
 * 어떤 로드 방식으로도 실행이 끝나지 않았다** — ESM `import()` 도, 클래식 `<script>` 태그도
 * 실제 Chrome 에서 탭을 10분+ 굳혔다(localStorage 트레이스 + 전면 탭 프로브로 실측).
 * CSP(frame-ancestors 뿐)·asm.js(아님, wasm 비동기 instantiate) 가설은 모두 반증됐다.
 *
 * 해법: 윤곽 추출(cv 사용부 전체 — cvtColor/threshold/findContours/convexHull/approxPolyDP)을
 * **Web Worker** 로 옮긴다. Emscripten UMD 의 `importScripts` 분기는 워커에서 가장 잘 검증된
 * 경로이고, 무엇보다 어떤 이상 동작도 UI 스레드를 굳히지 못한다(타임아웃 → 사용자 토스트).
 *
 * canvas-core 는 tsc 로 빌드돼 워커 번들링(vite)을 할 수 없으므로, 여기는 **계약과 주입점**만
 * 둔다 — 실제 워커는 editor 가 만들어 `configureContourExtractor()` 로 주입한다
 * (editor: `src/utils/opencvLoader.ts`). 미주입 환경(임베드 스텁·테스트)은 종전
 * 메인 스레드 cv 폴백을 그대로 탄다.
 */

export interface ContourExtractInput {
  /** 추출 대상(캡 적용본)의 RGBA 픽셀 — postMessage 시 buffer 를 transfer 한다 */
  data: Uint8ClampedArray
  width: number
  height: number
  /** GaussianBlur 커널 크기(기존 kSize 규약 유지) */
  kSize: number
  /** 컨투어 스캔 상한(CONTOUR_SCAN_LIMIT) */
  scanLimit: number
  /** convexHull 입력 점 예산(HULL_MAX_INPUT_POINTS) */
  hullMaxInputPoints: number
  /** approxPolyDP epsilon = 둘레 × 이 비율(CONTOUR_APPROX_EPSILON_RATIO) */
  approxEpsilonRatio: number
}

export interface ContourExtractResult {
  /** 캡 좌표계의 윤곽 점(근사·헐 처리 완료) — 좌표 역보정은 호출부(메인 스레드)가 한다 */
  points: [number, number][]
  /** 다중 컨투어를 convexHull 로 합쳤는가(기존 useHull 규약) */
  useHull: boolean
  /** 진단용(총 컨투어 수·스캔 수 등) — 트레이스에 그대로 실린다 */
  meta?: Record<string, number>
}

export type ContourExtractor = (input: ContourExtractInput) => Promise<ContourExtractResult>

let extractor: ContourExtractor | null = null

/** 앱 부트스트랩에서 1회 주입(editor). null 주입으로 해제도 가능(테스트용). */
export function configureContourExtractor(fn: ContourExtractor | null): void {
  extractor = fn
}

export function getContourExtractor(): ContourExtractor | null {
  return extractor
}
