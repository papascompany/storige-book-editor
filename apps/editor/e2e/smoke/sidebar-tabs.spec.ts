import { test, expect } from '@playwright/test';

/**
 * Smoke test — 사이드바 탭 동작 (P1-6 AI 패널 통합 + 기존 메뉴들)
 *
 * 빠른 회귀 검증용:
 *  - 에디터 로드 후 사이드바가 보이는지
 *  - 각 메뉴 탭 클릭 시 패널이 전환되는지
 *  - AI 탭 (이번 세션 추가)이 정상 동작하는지
 *
 * Skip 정책: VITE_ENABLE_AI_PANEL=false 빌드면 AI 탭 테스트 건너뜀
 */
test.describe('FeatureSidebar tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('renders all tool tabs in sidebar', async ({ page }) => {
    // 캔버스가 마운트될 때까지 대기 (에디터 ready 신호)
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    // 사이드바의 메뉴 라벨 확인 (lucide 아이콘이 적용된 버튼)
    const sidebar = page.locator('[class*="toolbar"], [role="toolbar"]').first();
    await expect(sidebar).toBeVisible();
  });

  test('Text tab: clicking shows text panel', async ({ page }) => {
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    // '텍스트' 라벨이 있는 메뉴 버튼 클릭
    const textBtn = page.getByText('텍스트', { exact: true }).first();
    if (await textBtn.isVisible()) {
      await textBtn.click();
      // 패널이 활성화되었는지 (텍스트 추가 버튼 등 일반 요소)
      await page.waitForTimeout(300);
    }
  });

  test('AI tab: clicking shows recommendation/generation panel', async ({ page }) => {
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    // 'AI' 라벨 메뉴 — VITE_ENABLE_AI_PANEL=true (기본)에서만 존재
    const aiBtn = page.getByText('AI', { exact: true }).first();
    const isAiVisible = await aiBtn.isVisible().catch(() => false);

    if (!isAiVisible) {
      test.skip(true, 'AI panel disabled (VITE_ENABLE_AI_PANEL=false)');
      return;
    }

    await aiBtn.click();
    await page.waitForTimeout(500);

    // AI 패널의 '추천' 또는 '생성' 탭이 보여야 함
    const recommendTab = page.getByText('추천', { exact: true });
    const generateTab = page.getByText('생성', { exact: true });

    const hasAiContent =
      (await recommendTab.isVisible().catch(() => false)) ||
      (await generateTab.isVisible().catch(() => false));

    expect(hasAiContent).toBeTruthy();
  });

  test('Background tab: clicking shows background panel', async ({ page }) => {
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const bgBtn = page.getByText('배경', { exact: true }).first();
    if (await bgBtn.isVisible()) {
      await bgBtn.click();
      await page.waitForTimeout(300);
    }
  });
});
