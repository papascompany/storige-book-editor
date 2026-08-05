/**
 * D-6b② 배경제거 추론 픽셀 캡 — **정본은 `@storige/types`** 로 이관됐다(2026-08-05, 샤드2).
 *
 * 이관 이유: 워커(서버)가 같은 캡 값을 써야 하는데, 워커가 canvas-core 를 의존하면
 * 브라우저 스택(fabric·opencv-js·imgly)이 통째로 딸려온다. types 는 양쪽이 이미 의존한다.
 *
 * 이 파일은 기존 import 경로(`@storige/canvas-core` 배럴)를 깨지 않기 위한 re-export 다.
 */
export {
  CUTOUT_MAX_LONG_EDGE,
  computeInferenceCap,
  type InferenceCapResult,
} from '@storige/types'
