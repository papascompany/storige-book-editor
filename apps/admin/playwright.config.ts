import { defineConfig, devices } from '@playwright/test';

/**
 * Storige Admin E2E 설정
 *
 * 실행: `pnpm --filter @storige/admin test:e2e`
 *
 * 시나리오:
 *  - tests/smoke/*.spec.ts — 빠른 회귀 검증 (로그인, Dashboard, 사이드바)
 *  - tests/worker-test/*.spec.ts — 워커 테스트 페이지 (PDF 검증 + Before/After)
 *  - tests/queue-monitor/*.spec.ts — Dashboard 큐 모니터 위젯 5초 폴링
 */
export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.spec.ts'],
  fullyParallel: false, // admin은 로그인 상태 공유라 직렬 실행
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'pnpm dev',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
