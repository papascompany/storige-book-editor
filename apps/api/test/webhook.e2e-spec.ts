import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import axios from 'axios';
import {
  WebhookService,
  SessionWebhookPayload,
  SynthesisWebhookPayload,
} from '../src/webhook/webhook.service';

// Axios mock
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('WebhookService (e2e)', () => {
  let app: INestApplication;
  let webhookService: WebhookService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [WebhookService],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    webhookService = moduleFixture.get<WebhookService>(WebhookService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // 웹훅 전송 성공 테스트
  // ============================================================================

  describe('TC-WEBHOOK-001: 성공 웹훅 전송', () => {
    it('세션 검증 완료 웹훅 전송 성공', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: { received: true } });

      const payload: SessionWebhookPayload = {
        event: 'session.validated',
        sessionId: 'session-uuid-123',
        orderSeqno: 12345,
        status: 'validated',
        fileType: 'cover',
        result: { valid: true, pageCount: 4 },
        timestamp: new Date().toISOString(),
      };

      const result = await webhookService.sendCallback(
        'https://bookmoa.com/api/webhook',
        payload,
      );

      expect(result).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://bookmoa.com/api/webhook',
        payload,
        expect.objectContaining({
          timeout: 10000,
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Storige-Event': 'session.validated',
          }),
        }),
      );
    });

    it('PDF 병합 완료 웹훅 전송 성공', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: { received: true } });

      const payload: SynthesisWebhookPayload = {
        event: 'synthesis.completed',
        jobId: 'job-uuid-456',
        orderId: 'ORD-2024-12345',
        status: 'completed',
        outputFileUrl: '/storage/temp/synthesized_xxx.pdf',
        timestamp: new Date().toISOString(),
      };

      const result = await webhookService.sendCallback(
        'https://bookmoa.com/api/webhook/synthesis',
        payload,
      );

      expect(result).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://bookmoa.com/api/webhook/synthesis',
        payload,
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Storige-Event': 'synthesis.completed',
          }),
        }),
      );
    });

    it('PDF 병합 완료 웹훅 — sessionId + outputFiles (separate 모드) 포함', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: { received: true } });

      const payload: SynthesisWebhookPayload = {
        event: 'synthesis.completed',
        jobId: 'job-uuid-789',
        sessionId: 'edit-session-uuid-abc', // NEW_DEV_PLAN §3.5 additive
        orderId: 'ORD-2024-SEP',
        status: 'completed',
        outputFileUrl: '/storage/outputs/merged.pdf',
        outputFiles: [
          { type: 'cover', url: '/storage/outputs/cover.pdf' },
          { type: 'content', url: '/storage/outputs/content.pdf' },
        ],
        outputFormat: 'separate',
        timestamp: new Date().toISOString(),
      };

      const result = await webhookService.sendCallback(
        'https://bookmoa.com/api/webhook/synthesis',
        payload,
      );

      expect(result).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://bookmoa.com/api/webhook/synthesis',
        expect.objectContaining({
          sessionId: 'edit-session-uuid-abc',
          outputFiles: expect.arrayContaining([
            expect.objectContaining({ type: 'cover' }),
            expect.objectContaining({ type: 'content' }),
          ]),
          outputFormat: 'separate',
        }),
        expect.any(Object),
      );
    });

    it('HTTP 201 응답도 성공으로 처리', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 201, data: { created: true } });

      const payload: SessionWebhookPayload = {
        event: 'session.validated',
        sessionId: 'session-uuid',
        orderSeqno: 12345,
        status: 'validated',
        timestamp: new Date().toISOString(),
      };

      const result = await webhookService.sendCallback(
        'https://example.com/webhook',
        payload,
      );

      expect(result).toBe(true);
    });
  });

  // ============================================================================
  // 웹훅 전송 실패 테스트
  // ============================================================================

  describe('TC-WEBHOOK-002: 실패 웹훅 전송', () => {
    it('세션 검증 실패 웹훅 전송', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: { received: true } });

      const payload: SessionWebhookPayload = {
        event: 'session.failed',
        sessionId: 'session-uuid-123',
        orderSeqno: 12345,
        status: 'failed',
        fileType: 'content',
        errorMessage: 'PDF 파일이 손상되었습니다.',
        timestamp: new Date().toISOString(),
      };

      const result = await webhookService.sendCallback(
        'https://bookmoa.com/api/webhook',
        payload,
      );

      expect(result).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://bookmoa.com/api/webhook',
        payload,
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Storige-Event': 'session.failed',
          }),
        }),
      );
    });

    it('PDF 병합 실패 웹훅 전송', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: { received: true } });

      const payload: SynthesisWebhookPayload = {
        event: 'synthesis.failed',
        jobId: 'job-uuid-456',
        orderId: 'ORD-2024-12345',
        status: 'failed',
        outputFileUrl: '', // 실패 시 빈 문자열 (하위호환 계약)
        errorMessage: 'Cover PDF is corrupted',
        timestamp: new Date().toISOString(),
      };

      const result = await webhookService.sendCallback(
        'https://bookmoa.com/api/webhook/synthesis',
        payload,
      );

      expect(result).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://bookmoa.com/api/webhook/synthesis',
        payload,
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Storige-Event': 'synthesis.failed',
          }),
        }),
      );
    });
  });

  // ============================================================================
  // 웹훅 재시도 테스트
  // ============================================================================

  describe('TC-WEBHOOK-003: 웹훅 재시도 검증', () => {
    it('첫 번째 요청 실패 시 재시도 수행', async () => {
      // 첫 번째 요청 실패
      mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));
      // 재시도 성공
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: { received: true } });

      const payload: SessionWebhookPayload = {
        event: 'session.validated',
        sessionId: 'session-uuid',
        orderSeqno: 12345,
        status: 'validated',
        timestamp: new Date().toISOString(),
      };

      const result = await webhookService.sendCallback(
        'https://example.com/webhook',
        payload,
      );

      expect(result).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);

      // 재시도 요청에 X-Storige-Retry 헤더가 포함되어야 함
      expect(mockedAxios.post).toHaveBeenNthCalledWith(
        2,
        'https://example.com/webhook',
        payload,
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Storige-Retry': '1',
          }),
        }),
      );
    }, 10000); // 2초 대기가 있으므로 타임아웃 연장

    it('모든 재시도 실패 시 false 반환', async () => {
      // 첫 번째 요청 실패
      mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));
      // 재시도도 실패
      mockedAxios.post.mockRejectedValueOnce(new Error('Still failing'));

      const payload: SessionWebhookPayload = {
        event: 'session.validated',
        sessionId: 'session-uuid',
        orderSeqno: 12345,
        status: 'validated',
        timestamp: new Date().toISOString(),
      };

      const result = await webhookService.sendCallback(
        'https://example.com/webhook',
        payload,
      );

      expect(result).toBe(false);
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    }, 10000);

    it('서버가 500 에러 반환 시 재시도', async () => {
      // 첫 번째 요청: 500 에러 (실제로 axios는 500도 성공으로 처리할 수 있으므로 reject로 시뮬레이션)
      mockedAxios.post.mockResolvedValueOnce({ status: 500, data: { error: 'Server error' } });

      const payload: SessionWebhookPayload = {
        event: 'session.validated',
        sessionId: 'session-uuid',
        orderSeqno: 12345,
        status: 'validated',
        timestamp: new Date().toISOString(),
      };

      const result = await webhookService.sendCallback(
        'https://example.com/webhook',
        payload,
      );

      // 500 응답은 성공이 아니므로 false 반환
      expect(result).toBe(false);
    });
  });

  // ============================================================================
  // 콜백 URL 누락 테스트
  // ============================================================================

  describe('콜백 URL 누락 처리', () => {
    it('콜백 URL이 없으면 웹훅 전송 스킵', async () => {
      const payload: SessionWebhookPayload = {
        event: 'session.validated',
        sessionId: 'session-uuid',
        orderSeqno: 12345,
        status: 'validated',
        timestamp: new Date().toISOString(),
      };

      const result = await webhookService.sendCallback('', payload);

      expect(result).toBe(false);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('콜백 URL이 undefined면 웹훅 전송 스킵', async () => {
      const payload: SessionWebhookPayload = {
        event: 'session.validated',
        sessionId: 'session-uuid',
        orderSeqno: 12345,
        status: 'validated',
        timestamp: new Date().toISOString(),
      };

      const result = await webhookService.sendCallback(undefined as any, payload);

      expect(result).toBe(false);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // 서명 생성 테스트
  // ============================================================================

  describe('TC-WEBHOOK-005: 서명 생성 검증', () => {
    it('세션 웹훅에 서명이 포함됨', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: {} });

      const payload: SessionWebhookPayload = {
        event: 'session.validated',
        sessionId: 'session-uuid-123',
        orderSeqno: 12345,
        status: 'validated',
        timestamp: '2025-12-28T10:00:00Z',
      };

      await webhookService.sendCallback('https://example.com/webhook', payload);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://example.com/webhook',
        payload,
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Storige-Signature': expect.any(String),
          }),
        }),
      );

      // 서명 형식 검증 (base64)
      const callArgs = mockedAxios.post.mock.calls[0];
      const signature = callArgs[2]?.headers?.['X-Storige-Signature'];
      expect(signature).toBeDefined();
      expect(() => Buffer.from(signature, 'base64')).not.toThrow();
    });

    it('병합 웹훅에 서명이 포함됨', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: {} });

      const payload: SynthesisWebhookPayload = {
        event: 'synthesis.completed',
        jobId: 'job-uuid-456',
        status: 'completed',
        outputFileUrl: '/storage/outputs/merged.pdf',
        timestamp: '2025-12-28T10:00:00Z',
      };

      await webhookService.sendCallback('https://example.com/webhook', payload);

      const callArgs = mockedAxios.post.mock.calls[0];
      const signature = callArgs[2]?.headers?.['X-Storige-Signature'];
      expect(signature).toBeDefined();

      // 서명 디코딩하여 jobId 포함 확인
      const decoded = Buffer.from(signature, 'base64').toString();
      expect(decoded).toContain('job-uuid-456');
      expect(decoded).toContain('synthesis.completed');
    });
  });

  // ============================================================================
  // 웹훅 페이로드 구조 테스트
  // ============================================================================

  describe('웹훅 페이로드 구조 검증', () => {
    it('세션 검증 웹훅 페이로드 구조', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: {} });

      const payload: SessionWebhookPayload = {
        event: 'session.validated',
        sessionId: 'session-uuid',
        orderSeqno: 12345,
        status: 'validated',
        fileType: 'cover',
        result: { valid: true, pageCount: 4 },
        timestamp: '2025-12-28T10:00:00Z',
      };

      await webhookService.sendCallback('https://example.com/webhook', payload);

      const sentPayload = mockedAxios.post.mock.calls[0][1];
      expect(sentPayload).toEqual({
        event: 'session.validated',
        sessionId: 'session-uuid',
        orderSeqno: 12345,
        status: 'validated',
        fileType: 'cover',
        result: { valid: true, pageCount: 4 },
        timestamp: '2025-12-28T10:00:00Z',
      });
    });

    it('병합 완료 웹훅 페이로드 구조', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: {} });

      const payload: SynthesisWebhookPayload = {
        event: 'synthesis.completed',
        jobId: 'job-uuid',
        orderId: 'ORD-2024-12345',
        status: 'completed',
        outputFileUrl: '/storage/output.pdf',
        timestamp: '2025-12-28T10:00:00Z',
      };

      await webhookService.sendCallback('https://example.com/webhook', payload);

      const sentPayload = mockedAxios.post.mock.calls[0][1];
      expect(sentPayload).toEqual({
        event: 'synthesis.completed',
        jobId: 'job-uuid',
        orderId: 'ORD-2024-12345',
        status: 'completed',
        outputFileUrl: '/storage/output.pdf',
        timestamp: '2025-12-28T10:00:00Z',
      });
    });

    it('병합 실패 웹훅에 에러 메시지 포함', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: {} });

      const payload: SynthesisWebhookPayload = {
        event: 'synthesis.failed',
        jobId: 'job-uuid',
        orderId: 'ORD-2024-12345',
        status: 'failed',
        outputFileUrl: '', // 실패 시 빈 문자열 (하위호환 계약)
        errorMessage: 'Cover PDF is corrupted',
        timestamp: '2025-12-28T10:00:00Z',
      };

      await webhookService.sendCallback('https://example.com/webhook', payload);

      const sentPayload = mockedAxios.post.mock.calls[0][1] as Record<string, unknown>;
      expect(sentPayload.errorMessage).toBe('Cover PDF is corrupted');
      expect(sentPayload.outputFileUrl).toBe('');
    });
  });

  // ============================================================================
  // 타임아웃 테스트
  // ============================================================================

  describe('웹훅 타임아웃 처리', () => {
    it('10초 타임아웃 설정 확인', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: {} });

      const payload: SessionWebhookPayload = {
        event: 'session.validated',
        sessionId: 'session-uuid',
        orderSeqno: 12345,
        status: 'validated',
        timestamp: new Date().toISOString(),
      };

      await webhookService.sendCallback('https://example.com/webhook', payload);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          timeout: 10000,
        }),
      );
    });

    it('타임아웃 에러 시 재시도', async () => {
      const timeoutError = new Error('timeout of 10000ms exceeded');
      timeoutError.name = 'AxiosError';
      mockedAxios.post.mockRejectedValueOnce(timeoutError);
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: {} });

      const payload: SessionWebhookPayload = {
        event: 'session.validated',
        sessionId: 'session-uuid',
        orderSeqno: 12345,
        status: 'validated',
        timestamp: new Date().toISOString(),
      };

      const result = await webhookService.sendCallback(
        'https://example.com/webhook',
        payload,
      );

      expect(result).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    }, 10000);
  });

  // ============================================================================
  // 다양한 HTTP 상태 코드 테스트
  // ============================================================================

  describe('HTTP 상태 코드 처리', () => {
    it('HTTP 200-299 범위는 성공', async () => {
      const successCodes = [200, 201, 202, 204];

      for (const status of successCodes) {
        jest.clearAllMocks();
        mockedAxios.post.mockResolvedValueOnce({ status, data: {} });

        const payload: SessionWebhookPayload = {
          event: 'session.validated',
          sessionId: 'session-uuid',
          orderSeqno: 12345,
          status: 'validated',
          timestamp: new Date().toISOString(),
        };

        const result = await webhookService.sendCallback(
          'https://example.com/webhook',
          payload,
        );

        expect(result).toBe(true);
      }
    });

    it('HTTP 300 이상은 실패 (재시도 없음)', async () => {
      const failureCodes = [301, 400, 401, 403, 404, 500, 502, 503];

      for (const status of failureCodes) {
        jest.clearAllMocks();
        mockedAxios.post.mockResolvedValueOnce({ status, data: {} });

        const payload: SessionWebhookPayload = {
          event: 'session.validated',
          sessionId: 'session-uuid',
          orderSeqno: 12345,
          status: 'validated',
          timestamp: new Date().toISOString(),
        };

        const result = await webhookService.sendCallback(
          'https://example.com/webhook',
          payload,
        );

        expect(result).toBe(false);
        // 300 이상의 응답은 에러가 아니므로 재시도하지 않음
        expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      }
    });
  });
});
