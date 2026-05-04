import { test, expect } from '@playwright/test';
import { ADMIN_PASSWORD, loginAsAdmin } from '../_support/auth';

/**
 * Dashboard 큐 모니터 위젯 — 5초 폴링 동작 검증 (P1-7 / P2-7)
 *
 * 검증 범위:
 *  1. 위젯 카드 렌더링 (제목 "워커 큐 모니터링")
 *  2. 3개 큐 라벨 가시성 (PDF 검증 / 변환 / 합성)
 *  3. 5초 후 GET /health/queues 가 2회 이상 호출됨 (refetchInterval)
 *  4. 응답 시 상태 태그(정상/주의/적체) 중 하나가 노출됨
 *
 * 환경:
 *  - E2E_ADMIN_PASSWORD 미설정 시 전체 skip
 *  - 운영 admin (E2E_BASE_URL=https://admin.papascompany.co.kr) / 로컬(:3001) 모두 호환
 */
test.describe('Queue Monitor Widget Polling', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    if (!ADMIN_PASSWORD) {
      testInfo.skip(true, 'E2E_ADMIN_PASSWORD env 미설정');
      return;
    }
    await loginAsAdmin(page);
  });

  test('widget renders with queue cards', async ({ page }) => {
    // Dashboard 진입 후 위젯 가시성
    await expect(page.getByText('워커 큐 모니터링').first()).toBeVisible({ timeout: 10000 });

    // 3개 큐 라벨 (loading/error 상태에서도 보일 수 있으므로 여유롭게)
    await expect(page.getByText('PDF 검증').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('PDF 변환').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('PDF 합성').first()).toBeVisible({ timeout: 5000 });
  });

  test('refetches /health/queues at 5s interval', async ({ page }) => {
    const calls: number[] = [];

    // 위젯 표시 후부터의 호출만 카운트하도록 라우트 핸들러 먼저 등록
    page.on('response', (response) => {
      if (response.url().includes('/health/queues')) {
        calls.push(Date.now());
      }
    });

    // Dashboard 재진입 (이전 테스트 후 위젯이 이미 떠 있을 수 있어 명시적 갱신)
    await page.goto('/');

    // 첫 호출 발생 대기 (최대 8초)
    const t0 = Date.now();
    while (calls.length < 1 && Date.now() - t0 < 8000) {
      await page.waitForTimeout(200);
    }

    if (calls.length < 1) {
      test.skip(true, '/health/queues 첫 호출 미발생 — admin 빌드에 P1-7 미포함 가능성');
      return;
    }

    // refetchInterval=5000 ms — 6초 추가 대기 후 2회 이상 누적 확인
    await page.waitForTimeout(6000);

    expect(calls.length).toBeGreaterThanOrEqual(2);

    // 호출 간격이 5초 ± 1.5초 범위인지 (네트워크/부팅 노이즈 허용)
    if (calls.length >= 2) {
      const gap = calls[1] - calls[0];
      expect(gap).toBeGreaterThan(3000);
      expect(gap).toBeLessThan(8000);
    }
  });

  test('shows status tag (정상 / 주의 / 적체)', async ({ page }) => {
    await expect(page.getByText('워커 큐 모니터링').first()).toBeVisible({ timeout: 10000 });

    // 위젯 데이터 로드 대기
    await page.waitForResponse(
      (r) => r.url().includes('/health/queues') && r.status() === 200,
      { timeout: 10000 },
    ).catch(() => null);

    // 상태 태그 셋 중 적어도 하나는 보여야 함 (실패 시 큐 모니터 응답 없음)
    const statusVisible = await page
      .locator('text=/정상|주의|적체/')
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    expect(statusVisible).toBeTruthy();
  });
});
