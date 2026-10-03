/**
 * JD-2 (2026-10) — spread 합성의 세션·파일 조회 실패 매핑 고정.
 *
 * - 404 → null → SESSION_NOT_FOUND / FILE_NOT_FOUND(재시도 없음)
 * - 그 밖의 4xx → null(같은 NOT_FOUND 실패, 재시도 없음)
 * - 408·425·429·5xx·응답 없음 → DomainError(SERVICE_UNAVAILABLE, detail.phase·httpStatus) — 재시도 대상
 * - 요청 옵션에 timeout 30000
 */
import { Logger } from '@nestjs/common';
import { PdfSynthesizerService } from './pdf-synthesizer.service';
import { DomainError, ErrorCodes } from '../common/errors';
import { classifySynthesisError } from '../processors/synthesis-retry';

jest.mock('axios', () => ({
  default: { get: jest.fn() },
  __esModule: true,
}));

const mockedGet = jest.requireMock<{ default: { get: jest.Mock } }>('axios').default.get;

type LookupTarget = {
  getEditSession(sessionId: string): Promise<unknown>;
  getFileById(fileId: string): Promise<unknown>;
};

function httpError(status: number): Error {
  return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });
}

describe('PdfSynthesizerService — spread 조회 실패 매핑', () => {
  let service: PdfSynthesizerService;
  let lookup: LookupTarget;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    service = new PdfSynthesizerService();
    lookup = service as unknown as LookupTarget;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const CALLS: Array<[string, (t: LookupTarget) => Promise<unknown>, 'session-lookup' | 'file-lookup']> = [
    ['getEditSession', (t) => t.getEditSession('s-1'), 'session-lookup'],
    ['getFileById', (t) => t.getFileById('f-1'), 'file-lookup'],
  ];

  describe.each(CALLS)('%s', (_name, call, phase) => {
    it('성공하면 응답 본문을 돌려주고 timeout 30000 으로 요청한다', async () => {
      mockedGet.mockResolvedValue({ data: { id: 'x' } });
      await expect(call(lookup)).resolves.toEqual({ id: 'x' });
      expect(mockedGet).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeout: 30000 }));
    });

    it.each([404, 400, 401, 403, 410])('HTTP %i → null', async (status) => {
      mockedGet.mockRejectedValue(httpError(status));
      await expect(call(lookup)).resolves.toBeNull();
    });

    it.each([408, 425, 429, 500, 502, 503])('HTTP %i → SERVICE_UNAVAILABLE(재시도 대상)', async (status) => {
      mockedGet.mockRejectedValue(httpError(status));
      const err = await call(lookup).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe(ErrorCodes.SERVICE_UNAVAILABLE);
      expect((err as DomainError).detail).toEqual({ phase, httpStatus: status });
      expect(classifySynthesisError(err).retryable).toBe(true);
    });

    it('응답 없음(시간 초과·네트워크) → SERVICE_UNAVAILABLE, httpStatus null', async () => {
      mockedGet.mockRejectedValue(Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' }));
      const err = await call(lookup).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe(ErrorCodes.SERVICE_UNAVAILABLE);
      expect((err as DomainError).detail).toEqual({ phase, httpStatus: null });
    });
  });

  describe('handleSpreadSynthesis', () => {
    const OPTIONS = {
      sessionId: 's-1',
      spreadPdfFileId: 'f-1',
      contentPdfFileIds: ['c-1'],
      jobTempDir: '/tmp/unused',
      alsoGenerateMerged: false,
    };

    it('세션 조회 404 → SESSION_NOT_FOUND(재시도 없음)', async () => {
      mockedGet.mockRejectedValue(httpError(404));
      const err = await service.handleSpreadSynthesis(OPTIONS).catch((e: unknown) => e);
      expect((err as DomainError).code).toBe(ErrorCodes.SESSION_NOT_FOUND);
      expect(classifySynthesisError(err).retryable).toBe(false);
    });

    it('세션 조회 503 → SERVICE_UNAVAILABLE(재시도 대상)', async () => {
      mockedGet.mockRejectedValue(httpError(503));
      const err = await service.handleSpreadSynthesis(OPTIONS).catch((e: unknown) => e);
      expect((err as DomainError).code).toBe(ErrorCodes.SERVICE_UNAVAILABLE);
      expect(classifySynthesisError(err).retryable).toBe(true);
    });
  });
});
