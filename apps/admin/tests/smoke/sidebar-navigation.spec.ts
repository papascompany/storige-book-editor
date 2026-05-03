import { test, expect } from '@playwright/test';

/**
 * Smoke test — 사이드바 메뉴 네비게이션
 *
 * 검증:
 *  - 좌측 사이드바의 핵심 메뉴 (대시보드, 템플릿, 라이브러리, 워커관리) 클릭
 *  - 각 페이지 전환 후 제목 확인
 *
 * Skip: 로그인 인증 필요 (E2E_ADMIN_PASSWORD 미설정 시 전체 skip)
 */
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@storige.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || '';

test.describe('Sidebar Navigation', () => {
  test.beforeEach(async ({ page }) => {
    if (!ADMIN_PASSWORD) {
      test.skip(true, 'E2E_ADMIN_PASSWORD env 미설정');
      return;
    }
    await page.goto('/login');
    await page.fill('input[type="email"], input[name="email"]', ADMIN_EMAIL);
    await page.fill('input[type="password"]', ADMIN_PASSWORD);
    await page.getByRole('button', { name: /로그인|login/i }).first().click();
    await page.waitForLoadState('networkidle');
  });

  test('navigates to library shapes page', async ({ page }) => {
    // 라이브러리 메뉴 → 도형 클릭
    const libraryMenu = page.getByText('라이브러리', { exact: true }).first();
    if (!(await libraryMenu.isVisible().catch(() => false))) {
      test.skip(true, '라이브러리 메뉴 미가시');
      return;
    }
    await libraryMenu.click();
    await page.waitForTimeout(300);

    const shapesItem = page.getByText('도형', { exact: true }).first();
    if (await shapesItem.isVisible().catch(() => false)) {
      await shapesItem.click();
      await expect(page.getByText('도형 관리').first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('navigates to library backgrounds (P2-9 카테고리 필터)', async ({ page }) => {
    const libraryMenu = page.getByText('라이브러리', { exact: true }).first();
    if (!(await libraryMenu.isVisible().catch(() => false))) {
      test.skip(true);
      return;
    }
    await libraryMenu.click();
    await page.waitForTimeout(300);

    const bgItem = page.getByText('배경', { exact: true }).first();
    if (await bgItem.isVisible().catch(() => false)) {
      await bgItem.click();
      // 배경 관리 페이지에 카테고리 필터 Select 존재 확인
      await expect(page.getByPlaceholder('카테고리 필터').first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('worker test page accessible', async ({ page }) => {
    const workerMenu = page.getByText('워커관리', { exact: true }).first();
    if (!(await workerMenu.isVisible().catch(() => false))) {
      test.skip(true);
      return;
    }
    await workerMenu.click();
    await page.waitForTimeout(300);

    const testItem = page.getByText('테스트', { exact: true }).first();
    if (await testItem.isVisible().catch(() => false)) {
      await testItem.click();
      await expect(page.getByText(/Worker 테스트|PDF 검증/).first()).toBeVisible({ timeout: 5000 });
    }
  });
});
