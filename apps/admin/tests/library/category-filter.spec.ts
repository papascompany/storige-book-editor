import { test, expect } from '@playwright/test';
import { ADMIN_PASSWORD, loginAsAdmin } from '../_support/auth';

/**
 * Library 페이지 카테고리 필터 동작 검증 (P2-7)
 *
 * 검증 범위:
 *  1. /library/backgrounds 진입 + 페이지 제목
 *  2. "카테고리 필터" Select 가시성
 *  3. 옵션 선택 시 GET /library/backgrounds?category={value} 재호출
 *  4. allowClear → undefined 로 초기화 시 category 파라미터 제거된 재호출
 *
 * 환경:
 *  - 운영(Library 카테고리 9개 + 13 자산)에서 read-only 검증 가능
 *  - 운영 데이터 변조 없음 — Select 변경만으로 query 재발사
 */
test.describe('Library Category Filter', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    if (!ADMIN_PASSWORD) {
      testInfo.skip(true, 'E2E_ADMIN_PASSWORD env 미설정');
      return;
    }
    await loginAsAdmin(page);
  });

  test('backgrounds page shows category filter', async ({ page }) => {
    await page.goto('/library/backgrounds');

    await expect(
      page.getByRole('heading', { name: '배경 관리' }).first(),
    ).toBeVisible({ timeout: 10000 });
    // Ant Design Select placeholder는 <span class="ant-select-selection-placeholder"> 로 렌더 (input attr 아님)
    await expect(
      page.locator('.ant-select-selection-placeholder', { hasText: '카테고리 필터' }).first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test('selecting category triggers query with category param', async ({ page }) => {
    const categoryRequests: string[] = [];

    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/library/backgrounds') && url.includes('category=')) {
        categoryRequests.push(url);
      }
    });

    await page.goto('/library/backgrounds');

    // 초기 로드 완료 대기 (background list 응답)
    await page.waitForResponse(
      (r) => r.url().includes('/library/backgrounds') && r.status() === 200,
      { timeout: 10000 },
    ).catch(() => null);

    // Ant Design Select wrapper — placeholder span 으로 식별
    const select = page.locator('.ant-select').filter({ hasText: '카테고리 필터' }).first();
    await select.click();

    // 첫 번째 옵션 (운영에 카테고리가 있다고 가정 — 없으면 skip)
    const firstOption = page.locator('.ant-select-item-option').first();
    const hasOption = await firstOption.isVisible({ timeout: 3000 }).catch(() => false);
    if (!hasOption) {
      test.skip(true, '카테고리 옵션이 없음 — 운영 데이터 부족');
      return;
    }

    const optionText = await firstOption.textContent();
    await firstOption.click();

    // category 파라미터 포함된 요청 도착 대기
    await page.waitForRequest(
      (req) =>
        req.url().includes('/library/backgrounds') &&
        req.url().includes('category=') &&
        req.method() === 'GET',
      { timeout: 5000 },
    );

    expect(categoryRequests.length).toBeGreaterThanOrEqual(1);
    if (optionText) {
      const encoded = encodeURIComponent(optionText.trim());
      // 일부 카테고리 라벨에 한글 포함 — encode 또는 raw 둘 다 허용
      const matched = categoryRequests.some(
        (u) => u.includes(`category=${encoded}`) || u.includes(`category=${optionText.trim()}`),
      );
      expect(matched).toBeTruthy();
    }
  });

  test('clearing filter removes category param', async ({ page }) => {
    let lastRequest = '';

    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/library/backgrounds') && req.method() === 'GET') {
        lastRequest = url;
      }
    });

    await page.goto('/library/backgrounds');

    // Ant Design Select wrapper — placeholder span 으로 식별
    const select = page.locator('.ant-select').filter({ hasText: '카테고리 필터' }).first();
    await select.click();

    const firstOption = page.locator('.ant-select-item-option').first();
    if (!(await firstOption.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip(true, '카테고리 옵션 없음');
      return;
    }
    await firstOption.click();

    // 카테고리 적용된 요청 1회 대기
    await page.waitForRequest(
      (req) => req.url().includes('/library/backgrounds') && req.url().includes('category='),
      { timeout: 5000 },
    );

    // Clear 버튼 (Ant Design — Select에 hover하면 X 버튼이 노출됨)
    await select.hover();
    const clearBtn = page.locator('.ant-select-clear').first();
    if (!(await clearBtn.isVisible({ timeout: 2000 }).catch(() => false))) {
      test.skip(true, 'Clear 버튼 미식별');
      return;
    }
    await clearBtn.click();

    // category 없는 요청 대기
    await page.waitForRequest(
      (req) => {
        const u = req.url();
        return (
          u.includes('/library/backgrounds') &&
          req.method() === 'GET' &&
          !u.includes('category=')
        );
      },
      { timeout: 5000 },
    );

    expect(lastRequest).not.toContain('category=');
  });
});
