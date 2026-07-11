import { Test, TestingModule } from '@nestjs/testing';
import { ValidationProcessor } from './validation.processor';
import { PdfValidatorService } from '../services/pdf-validator.service';
import { Job } from 'bull';
import axios from 'axios';
import { ValidationResultDto, ErrorCode, WarningCode } from '../dto/validation-result.dto';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ValidationProcessor', () => {
  let processor: ValidationProcessor;
  let validatorService: jest.Mocked<PdfValidatorService>;

  const mockValidatorService = {
    validate: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidationProcessor,
        {
          provide: PdfValidatorService,
          useValue: mockValidatorService,
        },
      ],
    }).compile();

    processor = module.get<ValidationProcessor>(ValidationProcessor);
    validatorService = module.get(PdfValidatorService);
    jest.clearAllMocks();
    mockedAxios.patch.mockResolvedValue({ data: {} });
  });

  const createMockJob = (data: any): Job<any> => ({
    data,
    id: 'test-job-id',
    name: 'validate-pdf',
    queue: {} as any,
    timestamp: Date.now(),
    processedOn: Date.now(),
    finishedOn: undefined,
    progress: jest.fn(),
    log: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    retry: jest.fn(),
    discard: jest.fn(),
    finished: jest.fn(),
    moveToCompleted: jest.fn(),
    moveToFailed: jest.fn(),
    promote: jest.fn(),
    lockKey: jest.fn(),
    releaseLock: jest.fn(),
    takeLock: jest.fn(),
    extendLock: jest.fn(),
    toJSON: jest.fn(),
    attemptsMade: 0,
    opts: {},
    returnvalue: undefined,
    stacktrace: [],
    failedReason: undefined,
    getState: jest.fn(),
    isCompleted: jest.fn(),
    isFailed: jest.fn(),
    isDelayed: jest.fn(),
    isActive: jest.fn(),
    isWaiting: jest.fn(),
    isPaused: jest.fn(),
    isStuck: jest.fn(),
  });

  describe('handleValidation', () => {
    const jobData = {
      jobId: 'test-uuid-123',
      fileUrl: 'storage/uploads/test.pdf',
      fileType: 'content' as const,
      orderOptions: {
        size: { width: 210, height: 297 },
        pages: 4,
        binding: 'perfect' as const,
        bleed: 3,
      },
    };

    it('should process valid PDF and update status to COMPLETED', async () => {
      const validResult: ValidationResultDto = {
        isValid: true,
        errors: [],
        warnings: [],
        metadata: {
          pageCount: 4,
          pageSize: { width: 210, height: 297 },
          hasBleed: true,
          colorMode: 'RGB',
          resolution: 300,
        },
      };

      mockValidatorService.validate.mockResolvedValue(validResult);

      const job = createMockJob(jobData);
      const result = await processor.handleValidation(job);

      expect(result).toEqual(validResult);
      expect(mockValidatorService.validate).toHaveBeenCalledWith(
        jobData.fileUrl,
        expect.objectContaining({
          fileType: 'content',
          orderOptions: jobData.orderOptions,
        }),
      );

      // Check status updates
      expect(mockedAxios.patch).toHaveBeenCalledTimes(2);

      // First call: PROCESSING
      expect(mockedAxios.patch).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('/worker-jobs/external/test-uuid-123/status'),
        expect.objectContaining({ status: 'PROCESSING' }),
        expect.objectContaining({
          headers: { 'X-API-Key': expect.any(String) },
        }),
      );

      // Second call: COMPLETED
      expect(mockedAxios.patch).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('/worker-jobs/external/test-uuid-123/status'),
        expect.objectContaining({
          status: 'COMPLETED',
          result: { result: validResult },
        }),
        expect.any(Object),
      );
    });

    it('should update status to FAILED for validation errors that are not fixable', async () => {
      const failedResult: ValidationResultDto = {
        isValid: false,
        errors: [
          {
            code: ErrorCode.FILE_CORRUPTED,
            message: 'File is corrupted',
            details: {},
            autoFixable: false,
          },
        ],
        warnings: [],
        metadata: {
          pageCount: 0,
          pageSize: { width: 0, height: 0 },
          hasBleed: false,
          colorMode: 'RGB',
          resolution: 0,
        },
      };

      mockValidatorService.validate.mockResolvedValue(failedResult);

      const job = createMockJob(jobData);
      const result = await processor.handleValidation(job);

      expect(result).toEqual(failedResult);

      // Check FAILED status
      expect(mockedAxios.patch).toHaveBeenLastCalledWith(
        expect.stringContaining('/worker-jobs/external/test-uuid-123/status'),
        expect.objectContaining({
          status: 'FAILED',
          errorMessage: 'File is corrupted',
        }),
        expect.any(Object),
      );
    });

    it('C+ 게이팅 소비 잠금: {autoFixable:false, fixMethod 존재} 는 FIXABLE 이 아니라 FAILED 다', async () => {
      // 게이팅 ON 시 validator 가 만드는 신규 조합(SIZE_MISMATCH: fixMethod 는 보존하되
      // autoFixable=false). processor 술어가 fixMethod 존재 기반으로 회귀하면
      // (예: `e.autoFixable || !!e.fixMethod`) 이 테스트가 깨진다 — 침묵 무력화 방지.
      const gatedResult: ValidationResultDto = {
        isValid: false,
        errors: [
          {
            code: ErrorCode.SIZE_MISMATCH,
            message: '페이지 크기가 맞지 않습니다.',
            details: { expected: { withBleed: { width: 216, height: 303 } }, actual: { width: 100, height: 100 } },
            autoFixable: false,
            fixMethod: 'resizeWithPadding',
          },
        ],
        warnings: [],
        metadata: {
          pageCount: 4,
          pageSize: { width: 100, height: 100 },
          hasBleed: false,
          colorMode: 'RGB',
          resolution: 300,
        },
      };

      mockValidatorService.validate.mockResolvedValue(gatedResult);

      const job = createMockJob(jobData);
      await processor.handleValidation(job);

      expect(mockedAxios.patch).toHaveBeenLastCalledWith(
        expect.stringContaining('/worker-jobs/external/test-uuid-123/status'),
        expect.objectContaining({
          status: 'FAILED',
        }),
        expect.any(Object),
      );
    });

    it('should update status to FIXABLE when all errors are auto-fixable', async () => {
      const fixableResult: ValidationResultDto = {
        isValid: false,
        errors: [
          {
            code: ErrorCode.PAGE_COUNT_INVALID,
            message: 'Page count is not multiple of 4',
            details: { expected: 4, actual: 3 },
            autoFixable: true,
            fixMethod: 'addBlankPages',
          },
        ],
        warnings: [],
        metadata: {
          pageCount: 3,
          pageSize: { width: 210, height: 297 },
          hasBleed: false,
          colorMode: 'RGB',
          resolution: 300,
        },
      };

      mockValidatorService.validate.mockResolvedValue(fixableResult);

      const job = createMockJob(jobData);
      await processor.handleValidation(job);

      // Check FIXABLE status
      expect(mockedAxios.patch).toHaveBeenLastCalledWith(
        expect.stringContaining('/worker-jobs/external/test-uuid-123/status'),
        expect.objectContaining({
          status: 'FIXABLE',
        }),
        expect.any(Object),
      );
    });

    it('should handle validation service errors', async () => {
      const error = new Error('Validation service failed');
      mockValidatorService.validate.mockRejectedValue(error);

      const job = createMockJob(jobData);

      await expect(processor.handleValidation(job)).rejects.toThrow('Validation service failed');

      // Check FAILED status
      expect(mockedAxios.patch).toHaveBeenLastCalledWith(
        expect.stringContaining('/worker-jobs/external/test-uuid-123/status'),
        expect.objectContaining({
          status: 'FAILED',
          errorMessage: 'Validation service failed',
        }),
        expect.any(Object),
      );
    });

    it('should use API key from environment', async () => {
      const originalApiKey = process.env.WORKER_API_KEY;
      process.env.WORKER_API_KEY = 'custom-api-key';

      // Need to recreate the module to pick up new env
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ValidationProcessor,
          {
            provide: PdfValidatorService,
            useValue: mockValidatorService,
          },
        ],
      }).compile();

      const newProcessor = module.get<ValidationProcessor>(ValidationProcessor);

      const validResult: ValidationResultDto = {
        isValid: true,
        errors: [],
        warnings: [],
        metadata: {
          pageCount: 4,
          pageSize: { width: 210, height: 297 },
          hasBleed: true,
          colorMode: 'RGB',
          resolution: 300,
        },
      };
      mockValidatorService.validate.mockResolvedValue(validResult);

      const job = createMockJob(jobData);
      await newProcessor.handleValidation(job);

      expect(mockedAxios.patch).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          headers: { 'X-API-Key': 'custom-api-key' },
        }),
      );

      process.env.WORKER_API_KEY = originalApiKey;
    });

    it('should continue processing even if status update fails', async () => {
      mockedAxios.patch.mockRejectedValueOnce(new Error('Network error'));

      const validResult: ValidationResultDto = {
        isValid: true,
        errors: [],
        warnings: [],
        metadata: {
          pageCount: 4,
          pageSize: { width: 210, height: 297 },
          hasBleed: true,
          colorMode: 'RGB',
          resolution: 300,
        },
      };
      mockValidatorService.validate.mockResolvedValue(validResult);

      const job = createMockJob(jobData);

      // Should not throw even if status update fails
      const result = await processor.handleValidation(job);
      expect(result).toEqual(validResult);
    });
  });
});
