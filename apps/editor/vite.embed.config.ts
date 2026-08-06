import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// 이전 colorRuntimeStubPlugin은 제거됨 (2026-04-29).
// @pf/color-runtime import 0건 + canvas-core가 이미 legacy 알고리즘만 사용해
// dead code였음. ICC 도입은 보류 목록 참조.

// ⚠️ @imgly/background-removal 스텁 플러그인은 제거됐다(D-12d, 2026-08-06) —
// 배경제거 추론이 서버(rembg 사이드카)로 이관되면서 그 의존 자체가 사라졌다.
// 임베드 IIFE 에서 배경제거를 쓰려면 OpenCV 스텁(아래)도 함께 풀어야 한다
// (서버 결과의 알파 트림이 OpenCV 경로다).

// OpenCV.js를 스텁으로 대체하는 플러그인 (번들 사이즈 ~45MB 감소)
function opencvStubPlugin(): Plugin {
  const virtualModuleId = '@techstark/opencv-js'
  const resolvedVirtualModuleId = '\0' + virtualModuleId
  const stubCode = `
    // OpenCV.js stub - image processing features disabled
    const cv = {
      onRuntimeInitialized: () => {},
      Mat: class Mat {
        constructor() { this.rows = 0; this.cols = 0; }
        delete() {}
      },
      imread: () => new cv.Mat(),
      imshow: () => {},
      cvtColor: () => {},
      threshold: () => {},
      findContours: () => [],
      boundingRect: () => ({ x: 0, y: 0, width: 0, height: 0 }),
      distanceTransform: () => {},
      convexHull: () => {},
      split: () => [],
      merge: () => {},
      COLOR_RGBA2GRAY: 0,
      COLOR_GRAY2RGBA: 0,
      THRESH_BINARY: 0,
      RETR_EXTERNAL: 0,
      CHAIN_APPROX_SIMPLE: 0,
      DIST_L2: 0,
      MatVector: class MatVector { size() { return 0 } get() { return new cv.Mat() } delete() {} },
    }
    export default cv
  `
  return {
    name: 'opencv-stub',
    enforce: 'pre',
    resolveId(id) {
      if (id === virtualModuleId) {
        return { id: resolvedVirtualModuleId, moduleSideEffects: false }
      }
    },
    load(id) {
      if (id === resolvedVirtualModuleId) {
        return stubCode
      }
    },
  }
}

// Embed/Library build configuration for PHP integration
/**
 * 프로덕션 번들에서 제거할 디버그 콘솔 호출 (source-exposure 트랙).
 * 임베드 번들은 파트너 사이트에 그대로 실려 나가므로 SPA 번들과 동일 정책을 적용한다.
 * (pure = minify 패스에서 "결과 미사용" 호출 제거. warn/error 는 진단 신호라 보존.)
 * ⚠️ vite.config.ts 의 PURE_DEBUG_CONSOLE 와 동기 유지.
 */
const PURE_DEBUG_CONSOLE = [
  'console.log',
  'console.debug',
  'console.info',
  'console.trace',
  'console.table',
  'console.dir',
  'console.group',
  'console.groupCollapsed',
  'console.groupEnd',
  'console.time',
  'console.timeEnd',
]

export default defineConfig({
  plugins: [opencvStubPlugin(), react()],
  esbuild: {
    pure: PURE_DEBUG_CONSOLE,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    // Define process for browser compatibility
    'process': JSON.stringify({ env: { NODE_ENV: 'production' } }),
    'global': 'globalThis',
    // Disable AI features (excludes AiPanel from bundle via dead code elimination)
    'import.meta.env.VITE_AI_ENABLED': JSON.stringify('false'),
    // Disable image processing features (hides CLIPPING/EDIT menus)
    'import.meta.env.VITE_ENABLE_IMAGE_PROCESSING': JSON.stringify('false'),
    // Disable ruler for embed build
    'import.meta.env.VITE_ENABLE_RULER': JSON.stringify('false'),
    // Hide menus for embed build
    'import.meta.env.VITE_ENABLE_UPLOAD_MENU': JSON.stringify('false'),
    'import.meta.env.VITE_ENABLE_TEMPLATE_MENU': JSON.stringify('false'),
    'import.meta.env.VITE_ENABLE_FRAME_MENU': JSON.stringify('false'),
    'import.meta.env.VITE_ENABLE_SMART_CODE_MENU': JSON.stringify('false'),
  },
  build: {
    // Library build for embedding in external pages (PHP, etc.)
    outDir: 'dist-embed',
    // 'hidden' — 파트너 사이트에 실려 나가는 번들이라 sourceMappingURL 주석을 남기지 않는다.
    // ⚠️ 주석 제거만으로는 부족하다: docker-compose.yml 이 이 디렉터리를 그대로 마운트하고
    //    docker/nginx/nginx.conf 의 `location /embed/` 가 **빌드 산출 디렉터리를 직접 서빙**한다.
    //    실질 차단은 package.json 의 postbuild:embed(strip-sourcemaps --force-strip)가 담당하고,
    //    nginx 쪽 `.map 404` 규칙이 이중화한다.
    // 이 번들 경로에는 Sentry 초기화가 없어(initSentry 호출은 main.tsx 뿐) 업로드 대상이 아니다.
    sourcemap: 'hidden',
    lib: {
      entry: path.resolve(__dirname, 'src/embed.tsx'),
      name: 'StorigeEditor',
      fileName: 'editor-bundle',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        // Include all dependencies in the bundle
        inlineDynamicImports: true,
        // Ensure CSS is bundled
        assetFileNames: 'editor-bundle[extname]',
      },
    },
    // Minify to reduce bundle size and memory usage
    minify: 'esbuild',
    // Increase chunk size warning limit for single bundle
    chunkSizeWarningLimit: 20000,
  },
})
