import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { HealthController } from './health.controller';
import { QueueMonitorService } from './queue-monitor.service';
import { MetricsService } from './metrics.service';

describe('HealthController', () => {
  let controller: HealthController;
  let mockValidationQueue: any;
  let mockConversionQueue: any;
  let mockSynthesisQueue: any;

  const createMockQueue = (counts = {}) => ({
    getWaitingCount: jest.fn().mockResolvedValue(counts['waiting'] ?? 0),
    getActiveCount: jest.fn().mockResolvedValue(counts['active'] ?? 0),
    getCompletedCount: jest.fn().mockResolvedValue(counts['completed'] ?? 0),
    getFailedCount: jest.fn().mockResolvedValue(counts['failed'] ?? 0),
    getDelayedCount: jest.fn().mockResolvedValue(counts['delayed'] ?? 0),
    client: {
      ping: jest.fn().mockResolvedValue('PONG'),
    },
  });

  beforeEach(async () => {
    mockValidationQueue = createMockQueue({
      waiting: 5,
      active: 2,
      completed: 100,
      failed: 3,
    });
    mockConversionQueue = createMockQueue({ waiting: 1, completed: 50 });
    mockSynthesisQueue = createMockQueue({ active: 1, completed: 25 });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: getQueueToken('pdf-validation'),
          useValue: mockValidationQueue,
        },
        {
          provide: getQueueToken('pdf-conversion'),
          useValue: mockConversionQueue,
        },
        {
          provide: getQueueToken('pdf-synthesis'),
          useValue: mockSynthesisQueue,
        },
        {
          provide: QueueMonitorService,
          useValue: {
            getDashboardSnapshot: jest.fn().mockResolvedValue({ queues: [] }),
          },
        },
        {
          provide: MetricsService,
          useValue: {
            getMetrics: jest.fn().mockResolvedValue(''),
            recordJobCompleted: jest.fn(),
            recordJobFailed: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  describe('check()', () => {
    it('should return health status with queue counts', async () => {
      const result = await controller.check();

      expect(result.status).toBe('ok');
      expect(result.timestamp).toBeDefined();
      expect(result.uptime).toBeGreaterThan(0);
      expect(result.environment).toBeDefined();
      expect(result.version).toBeDefined();
      expect(result.queues).toBeDefined();
    });

    it('should return validation queue counts', async () => {
      const result = await controller.check();

      expect(result.queues.validation).toEqual({
        waiting: 5,
        active: 2,
        completed: 100,
        failed: 3,
        delayed: 0,
      });
    });

    it('should return conversion queue counts', async () => {
      const result = await controller.check();

      expect(result.queues.conversion).toEqual({
        waiting: 1,
        active: 0,
        completed: 50,
        failed: 0,
        delayed: 0,
      });
    });

    it('should return synthesis queue counts', async () => {
      const result = await controller.check();

      expect(result.queues.synthesis).toEqual({
        waiting: 0,
        active: 1,
        completed: 25,
        failed: 0,
        delayed: 0,
      });
    });

    it('should call queue methods for all queues', async () => {
      await controller.check();

      expect(mockValidationQueue.getWaitingCount).toHaveBeenCalled();
      expect(mockValidationQueue.getActiveCount).toHaveBeenCalled();
      expect(mockValidationQueue.getCompletedCount).toHaveBeenCalled();
      expect(mockValidationQueue.getFailedCount).toHaveBeenCalled();
      expect(mockValidationQueue.getDelayedCount).toHaveBeenCalled();

      expect(mockConversionQueue.getWaitingCount).toHaveBeenCalled();
      expect(mockSynthesisQueue.getWaitingCount).toHaveBeenCalled();
    });
  });

  describe('ready()', () => {
    it('should return ready status when Redis is connected', async () => {
      const result = await controller.ready();

      expect(result).toEqual({ status: 'ready' });
      expect(mockValidationQueue.client.ping).toHaveBeenCalled();
    });

    it('should return not_ready status when Redis connection fails', async () => {
      mockValidationQueue.client.ping.mockRejectedValue(
        new Error('Connection refused'),
      );

      const result = await controller.ready();

      expect(result).toEqual({
        status: 'not_ready',
        error: 'Redis connection failed',
      });
    });
  });

  describe('live()', () => {
    it('should return alive status', () => {
      const result = controller.live();

      expect(result).toEqual({ status: 'alive' });
    });
  });

  describe('edge cases', () => {
    it('should handle zero counts', async () => {
      mockValidationQueue = createMockQueue();
      mockConversionQueue = createMockQueue();
      mockSynthesisQueue = createMockQueue();

      const module: TestingModule = await Test.createTestingModule({
        controllers: [HealthController],
        providers: [
          {
            provide: getQueueToken('pdf-validation'),
            useValue: mockValidationQueue,
          },
          {
            provide: getQueueToken('pdf-conversion'),
            useValue: mockConversionQueue,
          },
          {
            provide: getQueueToken('pdf-synthesis'),
            useValue: mockSynthesisQueue,
          },
          {
            provide: QueueMonitorService,
            useValue: { getDashboardSnapshot: jest.fn().mockResolvedValue({ queues: [] }) },
          },
          {
            provide: MetricsService,
            useValue: { getMetrics: jest.fn().mockResolvedValue(''), recordJobCompleted: jest.fn(), recordJobFailed: jest.fn() },
          },
        ],
      }).compile();

      const ctrl = module.get<HealthController>(HealthController);
      const result = await ctrl.check();

      expect(result.queues.validation).toEqual({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });
    });

    it('should handle large queue counts', async () => {
      mockValidationQueue = createMockQueue({
        waiting: 10000,
        active: 500,
        completed: 1000000,
        failed: 50,
        delayed: 100,
      });

      const module: TestingModule = await Test.createTestingModule({
        controllers: [HealthController],
        providers: [
          {
            provide: getQueueToken('pdf-validation'),
            useValue: mockValidationQueue,
          },
          {
            provide: getQueueToken('pdf-conversion'),
            useValue: mockConversionQueue,
          },
          {
            provide: getQueueToken('pdf-synthesis'),
            useValue: mockSynthesisQueue,
          },
          {
            provide: QueueMonitorService,
            useValue: { getDashboardSnapshot: jest.fn().mockResolvedValue({ queues: [] }) },
          },
          {
            provide: MetricsService,
            useValue: { getMetrics: jest.fn().mockResolvedValue(''), recordJobCompleted: jest.fn(), recordJobFailed: jest.fn() },
          },
        ],
      }).compile();

      const ctrl = module.get<HealthController>(HealthController);
      const result = await ctrl.check();

      expect(result.queues.validation.waiting).toBe(10000);
      expect(result.queues.validation.completed).toBe(1000000);
    });
  });
});
