import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'path'

// 이전 colorRuntimeStubPlugin은 제거됨 (2026-04-29).
// 이유: @pf/color-runtime import가 레포 전체에 0건이고 package.json
// 의존성도 없으며, canvas-core/utils/colors.ts의 cmykToRgb/rgbToCmyk가
// 이미 내부적으로 legacy 알고리즘만 사용하도록 정리되어 있어 stub이
// 작동할 일이 없는 dead code였음. ICC 정확도가 필요해지면 보류 목록 참조.

// Check if building as library (embed mode)
// Note: process.env is available in Node.js context (vite.config.ts runs in Node)
const isLibraryBuild = process.env.BUILD_MODE === 'embed'
console.log(`[vite.config] BUILD_MODE=${process.env.BUILD_MODE}, isLibraryBuild=${isLibraryBuild}`)

export default defineConfig(({ mode }) => {
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
    visualizer({
      filename: 'dist/stats.html',
      open: true,
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
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
        // Library build for embedding in external pages (PHP, etc.)
        outDir: 'dist-embed',
        sourcemap: true,
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
        sourcemap: true,
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
                if (id.includes('qrcode') || id.includes('jsbarcode') || id.includes('bwip-js')) {
                  return 'vendor-codes'
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
