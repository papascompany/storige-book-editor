/**
 * OpenCV 자산 URL 주입 — SPA 엔트리(main.tsx) 전용 side-effect 모듈.
 *
 * canvas-core 의 `getCv()` 는 이제 `<script>` 태그로 UMD 를 로드한다(2026-08-07 —
 * ESM `import()` 는 Emscripten UMD 를 깨뜨려 프로덕션에서 영원히 resolve 되지 않았다).
 * canvas-core 는 tsc 빌드라 vite 의 `?url` 자산 문법을 쓸 수 없으므로,
 * vite 로 빌드되는 editor 가 여기서 URL 을 만들어 주입한다.
 *
 * ⚠️ 임베드 IIFE(embed.tsx)에서는 이 모듈을 import 하지 않는다 — 임베드는
 *    opencvStubPlugin 이 bare id 를 스텁으로 치환하는 종전 폴백 경로를 유지하고,
 *    10MB 자산이 dist-embed 에 유입되지 않아야 한다(단일 파일 배포 계약).
 */
import opencvScriptUrl from '@techstark/opencv-js/dist/opencv.js?url'
import { configureOpenCv } from '@storige/canvas-core'

configureOpenCv({ scriptUrl: opencvScriptUrl })
