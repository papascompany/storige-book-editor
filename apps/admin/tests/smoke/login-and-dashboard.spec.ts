import { test, expect } from '@playwright/test';
import { ADMIN_PASSWORD, loginAsAdmin } from '../_support/auth';

/**
 * Smoke test — 로그인 + Dashboard 기본 동작
 *
 * 검증 범위:
 *  1. /login 페이지 로드 + 폼 가시성
 *  2. (선택) 시드 계정 로그인 → Dashboard 진입
 *  3. Dashboard 통계 카드 + 큐 모니터 위젯 렌더링 (P1-7)
 *
 * Skip 정책:
 *  - E2E_ADMIN_PASSWORD 미설정 시 로그인 의존 테스트만 skip
 */
test.describe('Login + Dashboard Smoke', () => {
  test('login page renders', async ({ page }) => {
    await page.goto('/login');

    // 이메일/비밀번호 입력 필드가 존재해야 함 (Ant Design Input은 default type=text — autoComplete/placeholder로 매칭)
    const emailInput = page.locator(
      'input[autocomplete="email"], input[placeholder="이메일"], input[type="email"]',
    ).first();
    const passwordInput = page.locator(
      'input[autocomplete="current-password"], input[placeholder="비밀번호"], input[type="password"]',
    ).first();
    await expect(emailInput).toBeVisible({ timeout: 10000 });
    await expect(passwordInput).toBeVisible();
  });

  test('dashboard accessible after login', async ({ page }, testInfo) => {
    if (!ADMIN_PASSWORD) {
      testInfo.skip(true, 'E2E_ADMIN_PASSWORD env 미설정 — 로그인 검증 건너뜀');
      return;
    }
    await loginAsAdmin(page);

    // Dashboard 제목 (Title level={2}) — heading role 사용
    await expect(
      page.getByRole('heading', { name: /대시보드|dashboard/i }).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('dashboard shows queue monitor widget (P1-7)', async ({ page }, testInfo) => {
    if (!ADMIN_PASSWORD) {
      testInfo.skip(true, 'E2E_ADMIN_PASSWORD env 미설정');
      return;
    }
    await loginAsAdmin(page);

    // 워커 큐 모니터링 위젯 — Card 제목 텍스트
    await expect(page.getByText('워커 큐 모니터링').first()).toBeVisible({ timeout: 10000 });

    // 3개 큐 카드 (PDF 검증/변환/합성)
    await expect(page.getByText(/PDF 검증/).first()).toBeVisible({ timeout: 5000 });
  });
});
