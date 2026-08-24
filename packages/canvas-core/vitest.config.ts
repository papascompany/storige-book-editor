import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // 프리플라이트 — node-canvas 부재/ABI 불일치를 '커버리지 조용한 축소'가 아니라
    // 즉시 실패로 드러낸다. 상세 사유·재빌드 처방은 vitest.setup.ts 상단 주석 참조.
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.test.ts']
    }
  }
})
