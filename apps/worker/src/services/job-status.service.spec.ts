/**
 * WK-4 회귀 테스트 (2026-06-13) — JobStatusService 공유 재시도 정책.
 *
 * - 재시도 5회(총 6회 시도), 백오프 최대 30s.
 * - 최종 실패 시 throw 하지 않고 false 반환 + Sentry capture.
 * - PATCH wire 포맷: /worker-jobs/external/:id/status + X-API-Key 헤더.
 */
import axios from 'axios';
import { JobStatusService } from './job-status.service';
import { captureJobException } from '../sentry/sentry.init';

jest.mock('axios');
jest.mock('../sentry/sentry.init', () => ({
  captureJobException: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedCapture = captureJobException as jest.MockedFunction<typeof captureJobException>;

describe('JobStatusService (WK-4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.patch.mockResolvedValue({ status: 200 });
  });

  describe('재시도 정책 상수', () => {
    it('백오프는 5회, 최대 30s 여야 한다', () => {
      expect(JobStatusService.RETRY_DELAYS_MS).toHaveLength(5);
      expect(Math.max(...JobStatusService.RETRY_DELAYS_MS)).toBe(30_000);
      // 단조 증가 백오프
      const d = JobStatusService.RETRY_DELAYS_MS;
      for (let i = 1; i < d.length; i++) {
        expect(d[i]).toBeGreaterThan(d[i - 1]);
      }
    });
  });

  describe('updateJobStatusWithRetry', () => {
    // 테스트 가속: 1ms 백오프 5회 주입(횟수 정책은 동일)
    const fastDelays = [1, 1, 1, 1, 1];

    it('첫 시도 성공 시 1회만 호출하고 true 를 반환해야 한다', async () => {
      const service = new JobStatusService(fastDelays);

      const ok = await service.updateJobStatusWithRetry('job-1', { status: 'PROCESSING' });

      expect(ok).toBe(true);
      expect(mockedAxios.patch).toHaveBeenCalledTimes(1);
      expect(mockedCapture).not.toHaveBeenCalled();
    });

    it('2회 실패 후 성공하면 3회 호출하고 true 를 반환해야 한다', async () => {
      mockedAxios.patch
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('502 Bad Gateway'))
        .mockResolvedValueOnce({ status: 200 });
      const service = new JobStatusService(fastDelays);

      const ok = await service.updateJobStatusWithRetry('job-1', { status: 'COMPLETED' });

      expect(ok).toBe(true);
      expect(mockedAxios.patch).toHaveBeenCalledTimes(3);
      expect(mockedCapture).not.toHaveBeenCalled();
    });

    it('전부 실패하면 6회(최초 1 + 재시도 5) 시도 후 false + Sentry capture 해야 한다', async () => {
      mockedAxios.patch.mockRejectedValue(new Error('API down'));
      const service = new JobStatusService(fastDelays);

      const ok = await service.updateJobStatusWithRetry(
        'job-x',
        { status: 'FAILED', errorMessage: 'boom' },
        { jobType: 'validate', queueName: 'pdf-validation' },
      );

      expect(ok).toBe(false);
      expect(mockedAxios.patch).toHaveBeenCalledTimes(6);
      expect(mockedCapture).toHaveBeenCalledTimes(1);
      expect(mockedCapture).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          jobId: 'job-x',
          jobType: 'validate',
          queueName: 'pdf-validation',
        }),
      );
    });

    it('최종 실패해도 throw 하지 않아야 한다 (잡 결과 보존 동작)', async () => {
      mockedAxios.patch.mockRejectedValue(new Error('API down'));
      const service = new JobStatusService(fastDelays);

      await expect(
        service.updateJobStatusWithRetry('job-x', { status: 'FAILED' }),
      ).resolves.toBe(false);
    });
  });

  describe('updateJobStatus (단일 시도 wire 포맷)', () => {
    it('외부 상태 엔드포인트로 페이로드를 그대로 PATCH 해야 한다', async () => {
      const service = new JobStatusService();
      const payload = {
        status: 'FAILED',
        errorCode: 'PAGE_COUNT_MISMATCH',
        errorMessage: '페이지 수 불일치',
        errorDetail: { expected: 4, got: 3 },
        queueJobId: '42',
      };

      await service.updateJobStatus('job-9', payload);

      expect(mockedAxios.patch).toHaveBeenCalledWith(
        expect.stringContaining('/worker-jobs/external/job-9/status'),
        payload,
        expect.objectContaining({
          timeout: 10_000,
          headers: { 'X-API-Key': expect.any(String) },
        }),
      );
    });

    it('단일 시도는 실패 시 throw 해야 한다 (재시도는 래퍼 책임)', async () => {
      mockedAxios.patch.mockRejectedValueOnce(new Error('Network error'));
      const service = new JobStatusService();

      await expect(service.updateJobStatus('job-9', { status: 'PROCESSING' })).rejects.toThrow(
        'Network error',
      );
    });
  });
});
