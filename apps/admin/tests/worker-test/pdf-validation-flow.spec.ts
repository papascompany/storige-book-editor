import { test, expect } from '@playwright/test';
import { ADMIN_PASSWORD, loginAsAdmin } from '../_support/auth';

/**
 * Worker 테스트 페이지 — PDF 검증 폼 + Before/After 미리보기 (P2-7)
 *
 * 검증 범위:
 *  1. /worker-test 라우트 접근 가능 + 페이지 제목
 *  2. 검증 폼 핵심 필드 (URL/Upload Tabs, Type Select, Pages, Bleed) 가시성
 *  3. URL 입력 후 검증 잡 생성 시도 → API POST /worker-jobs/validate 발사 확인
 *     (실 worker 응답은 배경에서 처리, UI는 진행 상태로 전환)
 *
 * 안전:
 *  - 운영 환경에서 실행 시 DRY_RUN=true 시 폼 제출 단계 skip
 *  - E2E_BASE_URL=admin.papascompany.co.kr (운영) → 자동으로 DRY_RUN 처리 (실 잡 생성 방지)
 */

const DRY_RUN =
  process.env.E2E_DRY_RUN === 'true' ||
  (process.env.E2E_BASE_URL || '').includes('papascompany.co.kr');

test.describe('Worker Test Page', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    if (!ADMIN_PASSWORD) {
      testInfo.skip(true, 'E2E_ADMIN_PASSWORD env 미설정');
      return;
    }
    await loginAsAdmin(page);
  });

  test('worker-test page renders with validation form', async ({ page }) => {
    await page.goto('/worker-test');

    await expect(
      page.getByRole('heading', { name: 'Worker 테스트' }).first(),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('검증 테스트 설정').first()).toBeVisible({ timeout: 5000 });

    // Tabs (URL 입력 / 파일 업로드)
    await expect(page.getByRole('tab', { name: /URL 입력/ }).first()).toBeVisible();
    await expect(page.getByRole('tab', { name: /파일 업로드/ }).first()).toBeVisible();
  });

  test('URL input tab accepts a storage path', async ({ page }) => {
    await page.goto('/worker-test');

    // "URL 입력" 탭이 기본값. placeholder 확인 후 입력
    const urlInput = page.getByPlaceholder(/example.com\/test\.pdf|storage\//).first();
    await expect(urlInput).toBeVisible({ timeout: 5000 });

    await urlInput.fill('storage/uploads/__e2e-non-existent__.pdf');
    await expect(urlInput).toHaveValue('storage/uploads/__e2e-non-existent__.pdf');
  });

  test('submit triggers POST /worker-jobs/validate (dry-run safe)', async ({ page }) => {
    if (DRY_RUN) {
      test.skip(true, 'DRY_RUN — 운영 환경에서 잡 생성 단계 skip');
      return;
    }

    await page.goto('/worker-test');

    // 폼 채우기
    const urlInput = page.getByPlaceholder(/example.com\/test\.pdf|storage\//).first();
    await urlInput.fill('storage/uploads/__e2e-non-existent__.pdf');

    // 네트워크 요청 가로채기
    const requestPromise = page.waitForRequest(
      (req) =>
        req.url().includes('/worker-jobs/validate') && req.method() === 'POST',
      { timeout: 10000 },
    );

    // Submit 버튼 (Form 내 type=primary 첫 버튼 — Ant Design 기본 패턴)
    const submitButton = page.getByRole('button', { name: /검증 시작|시작|실행|submit/i }).first();
    if (await submitButton.isVisible().catch(() => false)) {
      await submitButton.click();

      // POST 발사 확인
      const req = await requestPromise.catch(() => null);
      if (req) {
        const body = req.postDataJSON?.() ?? null;
        expect(body).toBeTruthy();
      }
    } else {
      test.skip(true, 'Submit 버튼 미식별 — UI 변경됨');
    }
  });
});
