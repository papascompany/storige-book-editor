/**
 * 공통 로그인 헬퍼 — Admin smoke / worker-test / queue-monitor / library 모든 spec 공유.
 *
 * 환경변수:
 *   E2E_ADMIN_EMAIL    — 기본 'admin@storige.com'
 *   E2E_ADMIN_PASSWORD — 미설정 시 로그인 단계 skip
 *
 * 사용:
 *   import { loginAsAdmin, ADMIN_PASSWORD } from '../_support/auth';
 *   test.beforeEach(async ({ page }, testInfo) => {
 *     if (!ADMIN_PASSWORD) testInfo.skip(true, 'E2E_ADMIN_PASSWORD 미설정');
 *     await loginAsAdmin(page);
 *   });
 */
import type { Page } from '@playwright/test';

export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@storige.com';
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || '';

export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  // Ant Design Input은 default type="text". autoComplete + placeholder로 robust 매칭.
  const emailInput = page.locator(
    'input[autocomplete="email"], input[placeholder="이메일"], input[type="email"]',
  ).first();
  const passwordInput = page.locator(
    'input[autocomplete="current-password"], input[placeholder="비밀번호"], input[type="password"]',
  ).first();

  await emailInput.waitFor({ state: 'visible', timeout: 10000 });
  await emailInput.fill(ADMIN_EMAIL);
  await passwordInput.fill(ADMIN_PASSWORD);

  const loginButton = page.getByRole('button', { name: /로그인|login|sign in/i }).first();
  await loginButton.click();

  // Dashboard / index 진입 확인 — networkidle은 큐 모니터 5초 폴링 때문에 영원히 도달 X.
  // 대신 /login 이탈만 확인 (URL이 /login이 아니면 진입 성공).
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 15000 });
}
