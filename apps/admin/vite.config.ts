import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import fs from 'fs'
import path from 'path'

// 소스맵 공개 차단 정책 — 정본 주석은 apps/editor/vite.config.ts 참조 (2026-07-27).
// 요약: 토큰 3종이 있으면 hidden + Sentry 업로드 + postbuild 삭제, 없으면 현행(public) 유지.
// SOURCEMAP_STRIP=1 이면 업로드 없이 노출만 차단(스택트레이스 minified 감수).
// 삭제는 postbuild 의 strip-sourcemaps.mjs 가 유출 검사 뒤에 수행한다.
// ⚠️ trim 필수 — 이 레포의 기존 등록 절차(scripts/activate-sentry.sh 의 `echo "$V" | vercel env add`)가
//    값 끝에 개행을 붙여 저장한 전례가 있다(실측: 프로덕션 번들의 environment 가 "production\n").
//    개행이 붙은 토큰은 truthy 라 게이팅은 통과하고 sentry-cli 만 401 로 죽는다 = 최악의 무증상 조합.
const SENTRY_ORG = process.env.SENTRY_ORG?.trim() || undefined
const SENTRY_PROJECT = process.env.SENTRY_PROJECT?.trim() || undefined
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN?.trim() || undefined
const canUploadSourcemaps = Boolean(SENTRY_ORG && SENTRY_PROJECT && SENTRY_AUTH_TOKEN)
const stripSourcemaps = canUploadSourcemaps || process.env.SOURCEMAP_STRIP === '1'

const commitSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim()
if (!process.env.VITE_SENTRY_RELEASE && commitSha) {
  process.env.VITE_SENTRY_RELEASE = `storige-admin@${commitSha.slice(0, 7)}`
}
const sentryRelease = process.env.VITE_SENTRY_RELEASE?.trim() || undefined

/** 업로드 실패 마커 — strip-sourcemaps.mjs 가 경고를 크게 남긴다(맵 삭제는 예정대로, fail-open). */
function markSentryUploadFailed(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  console.warn(`[vite.config] ⚠️ Sentry 소스맵 업로드 실패 — 배포는 계속한다(스택트레이스는 minified): ${message}`)
  try {
    const outDir = path.resolve(__dirname, 'dist')
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, '.sentry-upload-failed'), `${message}\n`)
  } catch (writeErr) {
    console.warn('[vite.config] 업로드 실패 마커를 쓰지 못했다:', writeErr)
  }
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    base: env.VITE_ROUTER_BASE || './',
    plugins: [
      react(),
      ...(command === 'build' && canUploadSourcemaps
        ? [
            sentryVitePlugin({
              org: SENTRY_ORG,
              project: SENTRY_PROJECT,
              authToken: SENTRY_AUTH_TOKEN,
              telemetry: false,
              release: sentryRelease
                ? { name: sentryRelease, inject: false, setCommits: false, deploy: false }
                : { inject: false, setCommits: false, deploy: false },
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
    server: {
      port: 3001,
      proxy: {
        '/api': {
          target: 'http://localhost:4000',
          changeOrigin: true,
        },
        '/storage': {
          target: 'http://localhost:4000',
          changeOrigin: true,
          rewrite: (path) => `/api${path}`,
        },
      },
    },
    build: {
      outDir: 'dist',
      // 'hidden' = 맵 생성하되 참조 주석 없음. 실제 노출 차단은 postbuild 삭제까지.
      sourcemap: stripSourcemaps ? 'hidden' : true,
    },
  }
})
