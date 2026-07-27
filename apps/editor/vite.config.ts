import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import fs from 'fs'
import path from 'path'

// 이전 colorRuntimeStubPlugin은 제거됨 (2026-04-29).
// 이유: @pf/color-runtime import가 레포 전체에 0건이고 package.json
// 의존성도 없으며, canvas-core/utils/colors.ts의 cmykToRgb/rgbToCmyk가
// 이미 내부적으로 legacy 알고리즘만 사용하도록 정리되어 있어 stub이
// 작동할 일이 없는 dead code였음. ICC 정확도가 필요해지면 보류 목록 참조.

/**
 * 프로덕션 번들에서 제거할 디버그 콘솔 호출 (source-exposure 트랙).
 *
 * 소스에 흩어진 디버그 로그(canvas-core 175곳 + editor)는 운영 콘솔에 내부 파이프라인·
 * 세션 payload 를 그대로 노출한다. dlog() 개별 치환 대신 **빌드 단계 제거**로 일괄 차단:
 * pure 로 표기하면 minify 패스가 "결과 미사용" 호출을 통째로 지운다(인자 부작용은 보존).
 * - dev 서버는 minify 를 하지 않으므로 개발 중 로그는 그대로 보인다(= dev 게이팅).
 * - console.warn/error 는 남긴다 — Sentry breadcrumb·실장애 진단 신호라 지우면 손해.
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

// ---------------------------------------------------------------------------
// 소스맵 공개 차단 정책 (source-exposure 트랙, 2026-07-27)
// ---------------------------------------------------------------------------
// 배경: dist/*.map 이 sourcesContent 포함으로 공개 서빙돼 원본 TS 전문이 열람 가능했다
// (실측 24청크 25.5MB 전량 HTTP 200). 그런데 현재 Sentry 심볼리케이션의 **유일한** 경로가
// 그 공개 맵을 Sentry 가 긁어가는 것이라, 맵만 지우면 스택트레이스가 통째로 minified 된다.
// → 업로드 배선과 맵 제거를 **한 스위치로 묶어** 무증상 실패를 구조적으로 차단한다.
//
// 스위치(자기 게이팅):
//   canUpload = SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT 3종이 모두 있을 때만 true
//   - true  → sourcemap:'hidden' + Sentry 업로드 + postbuild 에서 맵 삭제
//   - false → 현행 유지(sourcemap:true, 맵 공개). 심볼리케이션을 잃지 않는다.
//   - SOURCEMAP_STRIP=1 → 업로드 없이 노출만 즉시 차단(스택트레이스 minified 감수).
// 삭제는 이 파일이 아니라 postbuild 의 strip-sourcemaps.mjs 가 한다 — 유출 검사 게이트가
// .map 의 sourcesContent 를 스캔한 **뒤에** 지워야 탐지 커버리지를 잃지 않기 때문이다.
// (플러그인 내장 filesToDeleteAfterUpload 는 업로드 실패/스킵과 무관하게 finally 에서
//  지워버려 '맵 삭제 O · 업로드 X' 무증상 조합을 만든다 — 그래서 쓰지 않는다.)
// ⚠️ trim 필수 — 이 레포의 기존 등록 절차(scripts/activate-sentry.sh 의 `echo "$V" | vercel env add`)가
//    값 끝에 개행을 붙여 저장한 전례가 있다(실측: 프로덕션 번들의 environment 가 "production\n").
//    개행이 붙은 토큰은 truthy 라 게이팅은 통과하고 sentry-cli 만 401 로 죽는다 = 최악의 무증상 조합.
const SENTRY_ORG = process.env.SENTRY_ORG?.trim() || undefined
const SENTRY_PROJECT = process.env.SENTRY_PROJECT?.trim() || undefined
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN?.trim() || undefined
const canUploadSourcemaps = Boolean(SENTRY_ORG && SENTRY_PROJECT && SENTRY_AUTH_TOKEN)
const stripSourcemaps = canUploadSourcemaps || process.env.SOURCEMAP_STRIP === '1'

// 릴리스 식별자 — 런타임(sentry.ts)과 업로드 아티팩트가 **같은 값**을 써야 한다.
// Vercel 에서는 커밋 SHA 로 자동 파생(VITE_SENTRY_RELEASE 를 수동 등록할 필요 없음).
// process.env 에 되꽂아 두면 Vite 의 loadEnv 가 VITE_ 접두 변수를 그대로 주워
// import.meta.env.VITE_SENTRY_RELEASE 로 치환한다(별도 define 불필요).
const commitSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim()
if (!process.env.VITE_SENTRY_RELEASE && commitSha) {
  process.env.VITE_SENTRY_RELEASE = `storige-editor@${commitSha.slice(0, 7)}`
}
const sentryRelease = process.env.VITE_SENTRY_RELEASE?.trim() || undefined

// 번들 분석 리포트(stats.html)는 **기본 미생성**. dist 에 남으면 Vercel 이 그대로 서빙해
// 모듈 트리·내부 경로 수천 건이 공개된다(실측 /stats.html 2.18MB, 모듈 2,866건).
// 필요할 때만 `ANALYZE=1 pnpm --filter @storige/editor build`.
const analyzeBundle = process.env.ANALYZE === '1'

// Check if building as library (embed mode)
// Note: process.env is available in Node.js context (vite.config.ts runs in Node)
const isLibraryBuild = process.env.BUILD_MODE === 'embed'
console.log(`[vite.config] BUILD_MODE=${process.env.BUILD_MODE}, isLibraryBuild=${isLibraryBuild}`)
console.log(
  `[vite.config] sourcemap=${stripSourcemaps ? 'hidden(+strip)' : 'true(public)'}` +
    ` sentryUpload=${canUploadSourcemaps ? 'on' : 'off'}` +
    ` release=${sentryRelease ?? '(runtime fallback)'} analyze=${analyzeBundle}`
)

/** 산출물 디렉터리 (SPA=dist, embed 라이브러리 분기=dist-embed) */
const outDirName = isLibraryBuild ? 'dist-embed' : 'dist'

/**
 * 업로드 실패 마커 — postbuild 의 strip-sourcemaps.mjs 가 이 파일을 보면 "이 배포는 스택트레이스가
 * minified 로 남는다"고 크게 경고한다(맵 삭제 자체는 예정대로 수행 — hidden 은 참조 주석이 없어
 * 맵을 남겨도 Sentry 가 발견하지 못하므로 보존은 노출만 늘리는 순손해다).
 * 플러그인은 errorHandler 가 없으면 업로드 실패 시 throw 해서 배포를 통째로 막는다. Sentry 장애가
 * 편집기 배포를 막으면 안 되므로 fail-open 하되, 그 사실을 파일로 남겨 로그에서 놓치지 않게 한다.
 */
function markSentryUploadFailed(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  console.warn(`[vite.config] ⚠️ Sentry 소스맵 업로드 실패 — 배포는 계속한다(스택트레이스는 minified): ${message}`)
  try {
    const outDir = path.resolve(__dirname, outDirName)
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, '.sentry-upload-failed'), `${message}\n`)
  } catch (writeErr) {
    console.warn('[vite.config] 업로드 실패 마커를 쓰지 못했다:', writeErr)
  }
}

export default defineConfig(({ mode, command }) => {
  // loadEnv는 .env 파일에서 로드, process.env는 셸 환경변수
  const envFile = loadEnv(mode, path.resolve(__dirname), '')
  // 셸 환경변수 우선, 없으면 .env 파일에서 로드
  const routerBase = process.env.VITE_ROUTER_BASE || envFile.VITE_ROUTER_BASE
  const base = isLibraryBuild ? './' : (routerBase || './')
  console.error(`[vite.config] mode=${mode}, envFile.VITE_ROUTER_BASE=${envFile.VITE_ROUTER_BASE}, process.env.VITE_ROUTER_BASE=${process.env.VITE_ROUTER_BASE}, base=${base}`)
  return {
    base,
    plugins: [
    react(),
    // ANALYZE=1 일 때만 — dist 에 남으면 프로덕션에 그대로 공개된다(§소스맵 정책 주석 참조)
    ...(analyzeBundle
      ? [
          visualizer({
            filename: `${outDirName}/stats.html`,
            open: true,
            gzipSize: true,
            brotliSize: true,
          }),
        ]
      : []),
    // 소스맵 업로드는 실제 빌드에서만 (dev 서버 무영향). 토큰 3종이 없으면 아예 배선하지 않는다.
    ...(command === 'build' && canUploadSourcemaps
      ? [
          sentryVitePlugin({
            org: SENTRY_ORG,
            project: SENTRY_PROJECT,
            authToken: SENTRY_AUTH_TOKEN,
            // 플러그인 사용 통계 아웃바운드 차단
            telemetry: false,
            // 심볼리케이션은 debug ID(청크 내용 해시)로 매칭된다 — release 정합에 의존하지 않는다.
            // inject:false = 런타임(sentry.ts)이 이미 release 를 명시하므로 주입은 무효·혼란만 준다.
            // setCommits:false = Sentry↔GitHub 연동이 없어 매 빌드 경고만 남는다.
            release: sentryRelease
              ? { name: sentryRelease, inject: false, setCommits: false, deploy: false }
              : { inject: false, setCommits: false, deploy: false },
            // ⚠️ filesToDeleteAfterUpload 는 쓰지 않는다 — 업로드 실패/스킵과 무관하게 finally 에서
            //    지워버려 '맵 삭제 O · 업로드 X' 무증상 조합을 만든다. 삭제는 postbuild 가 한다.
            errorHandler: markSentryUploadFailed,
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // 디버그 콘솔 제거는 minify 패스에서 일어난다 → dev/serve 는 무영향
  esbuild: {
    pure: PURE_DEBUG_CONSOLE,
  },
  // Vite dev pre-bundling 제외 — 사용자가 배경 제거 기능을 안 쓰면 로드 자체 안 됨
  // (dynamic import는 이미 적용되어 있고, 여기는 dev pre-bundle 회피 추가 최적화)
  optimizeDeps: {
    exclude: [
      '@techstark/opencv-js',  // 10MB (CV 작업 시에만 로드)
      'onnxruntime-web',       // 24MB (배경 제거 시에만 로드)
      '@imgly/background-removal',
    ],
  },
  server: {
    port: 3000,
    proxy: {
      // DEV 전용: VITE_DEV_PROXY_TARGET 로 프록시 대상 변경 가능 (예: prod API 충실 재현).
      // 미설정 시 로컬 API(localhost:4000) 로 폴백 — 기존 동작 보존.
      '/api': {
        target: process.env.VITE_DEV_PROXY_TARGET || 'http://localhost:4000',
        changeOrigin: true,
        secure: true,
      },
    },
  },
  build: isLibraryBuild
    ? {
        // ⚠️ 미사용 분기 — BUILD_MODE=embed 를 세팅하는 호출자가 레포에 없다.
        //    실제 임베드 빌드는 vite.embed.config.ts(build:embed) 경로다. 정합만 맞춰 둔다.
        // Library build for embedding in external pages (PHP, etc.)
        outDir: 'dist-embed',
        sourcemap: stripSourcemaps ? 'hidden' : true,
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
          },
        },
        // Don't minify for easier debugging during development
        minify: process.env.NODE_ENV === 'production' ? 'esbuild' : false,
      }
    : {
        // Standard SPA build
        outDir: 'dist',
        // 'hidden' = 맵은 만들되 //# sourceMappingURL 주석을 넣지 않는다(업로드용).
        // 실제 노출 차단은 postbuild 의 strip-sourcemaps.mjs 삭제까지 가야 완결된다.
        sourcemap: stripSourcemaps ? 'hidden' : true,
        rollupOptions: {
          output: {
            manualChunks: (id) => {
              // Vendor chunks - large libraries separated for better caching
              if (id.includes('node_modules')) {
                // React ecosystem
                if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
                  return 'vendor-react'
                }
                // Fabric.js - canvas library (large)
                if (id.includes('fabric')) {
                  return 'vendor-fabric'
                }
                // OpenCV.js - image processing (very large)
                if (id.includes('opencv') || id.includes('@techstark/opencv-js')) {
                  return 'vendor-opencv'
                }
                // ONNX Runtime - ML inference for background removal
                if (id.includes('onnxruntime')) {
                  return 'vendor-onnx'
                }
                // Background removal
                if (id.includes('@imgly/background-removal')) {
                  return 'vendor-bg-removal'
                }
                // PDF libraries
                if (id.includes('pdf-lib') || id.includes('jspdf')) {
                  return 'vendor-pdf'
                }
                // QR/Barcode
                // ⚠️ 'qrcode' 부분문자열은 'qr-code-styling'(하이픈)을 매칭하지 못한다 → 명시 매칭 필수.
                // 미매칭 시 eager 'vendor' 캐치올에 흡수되어 dynamic import 절단이 무효화됨.
                if (
                  id.includes('qrcode') ||
                  id.includes('qr-code-styling') ||
                  id.includes('jsbarcode') ||
                  id.includes('bwip-js')
                ) {
                  return 'vendor-codes'
                }
                // Paper.js (accessory/effect 벡터 union) — dynamic-only 라 dedicated 청크로
                // 분리해야 eager 'vendor' 캐치올과 섞이지 않아 실제 지연로드가 유효해진다.
                if (id.includes('/paper@') || id.includes('/node_modules/paper/')) {
                  return 'vendor-paper'
                }
                // UI components (radix, etc)
                if (id.includes('@radix-ui') || id.includes('@phosphor-icons')) {
                  return 'vendor-ui'
                }
                // Other vendor libs
                return 'vendor'
              }
              // Canvas-core package
              if (id.includes('packages/canvas-core')) {
                return 'canvas-core'
              }
            },
          },
        },
      },
}})
