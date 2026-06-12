/**
 * WK-1 회귀 테스트 (2026-06-13) — UpdateJobStatusDto errorCode/errorDetail.
 *
 * 배경: 워커 split/duplex-split/spread 실패 경로는 FAILED 상태 업데이트에
 * errorCode(DomainError.code)/errorDetail 을 포함해 PATCH 하는데, 전역
 * ValidationPipe(whitelist + forbidNonWhitelisted)가 DTO 미정의 필드를 400 으로
 * 거부 → FAILED 상태 업데이트 자체가 실패하는 구멍이 있었다.
 * 이 스펙은 main.ts 와 동일 옵션의 ValidationPipe 로 해당 페이로드가
 * 검증을 통과하는지 고정한다.
 */
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { UpdateJobStatusDto } from './worker-job.dto';
import { WorkerJobsService } from '../worker-jobs.service';
import { WorkerJob } from '../entities/worker-job.entity';
import { EditSessionEntity } from '../../edit-sessions/entities/edit-session.entity';
import { FilesService } from '../../files/files.service';
import { WebhookService } from '../../webhook/webhook.service';
import { SitesService } from '../../sites/sites.service';
import { WorkerJobType, WorkerJobStatus } from '@storige/types';

describe('UpdateJobStatusDto (WK-1: errorCode/errorDetail)', () => {
  // main.ts 의 전역 파이프와 동일 옵션 (whitelist + transform + forbidNonWhitelisted)
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  });

  const metadata = {
    type: 'body' as const,
    metatype: UpdateJobStatusDto,
  };

  it('split 실패 페이로드(errorCode/errorDetail 포함)가 검증을 통과해야 한다', async () => {
    // 워커 updateJobStatusWithRetry FAILED 경로의 실제 페이로드 형태
    const payload = {
      status: 'FAILED',
      errorCode: 'PAGE_COUNT_MISMATCH',
      errorMessage: '페이지 수 불일치',
      errorDetail: { expected: 4, got: 3 },
    };

    const result = await pipe.transform(payload, metadata);

    expect(result).toBeInstanceOf(UpdateJobStatusDto);
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('PAGE_COUNT_MISMATCH');
    expect(result.errorMessage).toBe('페이지 수 불일치');
    expect(result.errorDetail).toEqual({ expected: 4, got: 3 });
  });

  it('queueJobId 를 포함한 spread 실패 페이로드도 통과해야 한다', async () => {
    const payload = {
      status: 'FAILED',
      errorCode: 'SYNTHESIS_FAILED',
      errorMessage: 'boom',
      errorDetail: { stack: 'Error: boom', jobData: { jobId: 'x' } },
      queueJobId: '123',
    };

    const result = await pipe.transform(payload, metadata);
    expect(result.errorCode).toBe('SYNTHESIS_FAILED');
    expect(result.queueJobId).toBe('123');
  });

  it('errorCode 가 문자열이 아니면 거부해야 한다', async () => {
    const payload = { status: 'FAILED', errorCode: 42 };
    await expect(pipe.transform(payload, metadata)).rejects.toThrow(BadRequestException);
  });

  it('errorDetail 이 객체가 아니면 거부해야 한다', async () => {
    const payload = { status: 'FAILED', errorDetail: 'not-an-object' };
    await expect(pipe.transform(payload, metadata)).rejects.toThrow(BadRequestException);
  });

  it('미정의 필드는 여전히 forbidNonWhitelisted 로 거부해야 한다 (기존 보안 동작 유지)', async () => {
    const payload = { status: 'FAILED', hackerField: 'x' };
    await expect(pipe.transform(payload, metadata)).rejects.toThrow(BadRequestException);
  });
});

describe('WorkerJobsService.updateJobStatus (WK-1: errorCode/errorDetail 영속화)', () => {
  let service: WorkerJobsService;
  let savedEntity: any;

  const mockJob = () => ({
    id: 'job-1',
    jobType: WorkerJobType.SYNTHESIZE,
    status: WorkerJobStatus.PROCESSING,
    editSessionId: null,
    options: {},
  });

  beforeEach(async () => {
    savedEntity = null;
    const workerJobRepo = {
      findOne: jest.fn().mockResolvedValue(mockJob()),
      save: jest.fn().mockImplementation(async (j: any) => {
        savedEntity = j;
        return j;
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerJobsService,
        { provide: getRepositoryToken(WorkerJob), useValue: workerJobRepo },
        { provide: getRepositoryToken(EditSessionEntity), useValue: { findOne: jest.fn() } },
        { provide: getQueueToken('pdf-validation'), useValue: { add: jest.fn() } },
        { provide: getQueueToken('pdf-conversion'), useValue: { add: jest.fn() } },
        { provide: getQueueToken('pdf-synthesis'), useValue: { add: jest.fn() } },
        { provide: FilesService, useValue: { findById: jest.fn() } },
        { provide: WebhookService, useValue: { sendCallback: jest.fn() } },
        { provide: SitesService, useValue: { findOne: jest.fn() } },
      ],
    }).compile();

    service = module.get<WorkerJobsService>(WorkerJobsService);
  });

  it('FAILED 업데이트 시 errorCode/errorDetail 이 엔티티 필드로 저장되어야 한다', async () => {
    const dto: UpdateJobStatusDto = {
      status: WorkerJobStatus.FAILED,
      errorCode: 'SPLIT_VERIFICATION_FAILED',
      errorMessage: 'cover 페이지 수 불일치',
      errorDetail: { phase: 'pageCount', target: 'cover', expected: 2, got: 1 },
    };

    const result = await service.updateJobStatus('job-1', dto);

    // 엔티티 프로퍼티 errorCode/errorDetail → error_code/error_detail 컬럼 매핑(기존재)
    expect(savedEntity.errorCode).toBe('SPLIT_VERIFICATION_FAILED');
    expect(savedEntity.errorDetail).toEqual({
      phase: 'pageCount',
      target: 'cover',
      expected: 2,
      got: 1,
    });
    expect(savedEntity.errorMessage).toBe('cover 페이지 수 불일치');
    expect(result.completedAt).toBeInstanceOf(Date);
  });
});
