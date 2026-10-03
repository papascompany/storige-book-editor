/**
 * 운영자 대리 편집 (2026-09-29, ADDITIVE) — 업로드 소유 스탬프 · @Public 완료 라우트 사이트 스탬프 ·
 * worker-jobs 컷아웃/합본 caller 파생. 고객·익명 동작은 종전과 동일해야 한다.
 */
import { FilesController } from './files.controller';
import type { FilesService } from './files.service';
import type { PresignedUploadService } from './presigned-upload.service';
import { FileType } from './entities/file.entity';
import type { UploadFileDto } from './dto/upload-file.dto';
import type { PresignUploadDto, MultipartCompleteDto, CompleteUploadDto } from './dto/presigned-upload.dto';
import { WorkerJobsController } from '../worker-jobs/worker-jobs.controller';
import type { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import type { ConfigService } from '@nestjs/config';
import type { PartnerOperatorGrant, PartnerOperatorUser } from '../auth/partner-operator/partner-operator.types';

const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FILE_ID = '11111111-1111-4111-8111-111111111111';

const grant = (extra: Partial<PartnerOperatorGrant> = {}): PartnerOperatorGrant => ({
  grantId: '44444444-4444-4444-8444-444444444444',
  operatorId: 'op-7f3c',
  operatorName: null,
  siteId: SITE_A,
  sessionIds: ['22222222-2222-4222-8222-222222222222'],
  capabilities: ['edit'],
  grantExpiresAt: Math.floor(Date.now() / 1000) + 3600,
  ...extra,
});

const operator = (g: PartnerOperatorGrant = grant()): PartnerOperatorUser => ({
  userId: `po:${g.operatorId}`,
  email: '',
  name: g.operatorId,
  role: 'partner_operator',
  source: 'partner_operator',
  permissions: [],
  siteId: g.siteId,
  siteName: 'Site A',
  partnerOperator: g,
});

/** OptionalShopJwtGuard 가 @Public 라우트에서 복원하는 운영자 사용자 */
const operatorStamp = {
  userId: 'po:op-7f3c',
  source: 'partner_operator',
  siteId: SITE_A,
  siteName: 'Site A',
  grantId: '44444444-4444-4444-8444-444444444444',
  operatorId: 'op-7f3c',
};
const shopUser = { userId: '777', source: 'shop', role: 'customer', siteId: SITE_A };

describe('FilesController — 운영자 업로드·완료 스탬프', () => {
  let filesService: { uploadFile: jest.Mock; toResponseDto: jest.Mock };
  let presigned: { presignPut: jest.Mock; completeMultipart: jest.Mock; completeSingle: jest.Mock };
  let controller: FilesController;
  const pdf = { originalname: 'a.pdf', mimetype: 'application/pdf' } as Express.Multer.File;

  beforeEach(() => {
    filesService = {
      uploadFile: jest.fn().mockResolvedValue({ id: FILE_ID }),
      toResponseDto: jest.fn((f: { id: string }) => ({ id: f.id })),
    };
    presigned = {
      presignPut: jest.fn().mockResolvedValue({ fileId: FILE_ID }),
      completeMultipart: jest.fn().mockResolvedValue({ id: FILE_ID }),
      completeSingle: jest.fn().mockResolvedValue({ id: FILE_ID }),
    };
    controller = new FilesController(
      filesService as unknown as FilesService,
      presigned as unknown as PresignedUploadService,
    );
  });

  const uploadMember = (): unknown => filesService.uploadFile.mock.calls[0][3];
  const presignMember = (): unknown => (presigned.presignPut.mock.calls[0][0] as { memberSeqno: unknown }).memberSeqno;

  it('uploadFile: 운영자 + obo → memberSeqno=obo, DTO memberSeqno 무시', async () => {
    const dto = { type: FileType.CONTENT, memberSeqno: 5 } as unknown as UploadFileDto;
    await controller.uploadFile(pdf, dto, operator(grant({ onBehalfOfMemberSeqno: 777 })));
    expect(uploadMember()).toBe(777);
  });

  it('uploadFile: 운영자 + obo 없음 → undefined (DTO 값·po: sub 모두 무시)', async () => {
    const dto = { type: FileType.CONTENT, memberSeqno: 5 } as unknown as UploadFileDto;
    await controller.uploadFile(pdf, dto, operator());
    expect(uploadMember()).toBeUndefined();
  });

  it('presignUpload: 운영자 + obo → obo / 없음 → undefined', async () => {
    const dto = { expectedSize: 10, contentType: 'application/pdf', memberSeqno: 5 } as unknown as PresignUploadDto;
    await controller.presignUpload(dto, operator(grant({ onBehalfOfMemberSeqno: 777 })));
    expect(presignMember()).toBe(777);
    presigned.presignPut.mockClear();
    await controller.presignUpload(dto, operator());
    expect(presignMember()).toBeUndefined();
  });

  it('회귀: 고객 업로드는 DTO memberSeqno 우선, 없으면 JWT userId', async () => {
    await controller.uploadFile(pdf, { type: FileType.CONTENT, memberSeqno: 5 } as unknown as UploadFileDto, shopUser);
    expect(uploadMember()).toBe(5);
    filesService.uploadFile.mockClear();
    await controller.uploadFile(pdf, { type: FileType.CONTENT } as unknown as UploadFileDto, shopUser);
    expect(uploadMember()).toBe(777);
    const dto = { expectedSize: 10, contentType: 'application/pdf' } as unknown as PresignUploadDto;
    await controller.presignUpload(dto, shopUser);
    expect(presignMember()).toBe(777);
  });

  it('completeUpload/multipartComplete: 운영자 스탬프 사용자 → 사이트 caller 전달', async () => {
    await controller.completeUpload(FILE_ID, { uploadToken: 't' } as CompleteUploadDto, operatorStamp);
    expect(presigned.completeSingle).toHaveBeenCalledWith(FILE_ID, 't', { siteId: SITE_A, role: 'shop' });
    await controller.multipartComplete(
      { fileId: FILE_ID, parts: [], uploadToken: 't' } as unknown as MultipartCompleteDto,
      operatorStamp,
    );
    expect(presigned.completeMultipart).toHaveBeenCalledWith(FILE_ID, [], 't', { siteId: SITE_A, role: 'shop' });
  });

  it('회귀: 고객 shop → 사이트 caller, 익명·admin(비-shop) → undefined', async () => {
    await controller.completeUpload(FILE_ID, { uploadToken: 't' } as CompleteUploadDto, shopUser);
    expect(presigned.completeSingle).toHaveBeenLastCalledWith(FILE_ID, 't', { siteId: SITE_A, role: 'shop' });
    await controller.completeUpload(FILE_ID, { uploadToken: 't' } as CompleteUploadDto, undefined);
    expect(presigned.completeSingle).toHaveBeenLastCalledWith(FILE_ID, 't', undefined);
    await controller.completeUpload(FILE_ID, { uploadToken: 't' } as CompleteUploadDto, { role: 'ADMIN', siteId: SITE_A });
    expect(presigned.completeSingle).toHaveBeenLastCalledWith(FILE_ID, 't', undefined);
    await controller.multipartComplete(
      { fileId: FILE_ID, parts: [], uploadToken: 't' } as unknown as MultipartCompleteDto,
      undefined,
    );
    expect(presigned.completeMultipart).toHaveBeenLastCalledWith(FILE_ID, [], 't', undefined);
  });

  it('siteId 없는 운영자 스탬프 → undefined(스탬프 근거 없음)', async () => {
    await controller.completeUpload(FILE_ID, { uploadToken: 't' } as CompleteUploadDto, {
      ...operatorStamp,
      siteId: undefined,
    });
    expect(presigned.completeSingle).toHaveBeenLastCalledWith(FILE_ID, 't', undefined);
  });
});

describe('WorkerJobsController — 컷아웃·합본 caller 파생(운영자 포함)', () => {
  let workerJobs: {
    createCutoutJob: jest.Mock;
    findCutoutJob: jest.Mock;
    createComposeMixedJob: jest.Mock;
    createValidationJob: jest.Mock;
    assertEditSessionLink: jest.Mock;
    observeJobInputFileSites: jest.Mock;
  };
  let controller: WorkerJobsController;
  // CUTOUT_ENABLED 만 켠다 — 잡 생성 확인 플래그(JOB_LINK_STRICT·JOB_FILE_SITE_STRICT)는 미설정.
  const config = { get: jest.fn((key: string) => (key === 'CUTOUT_ENABLED' ? 'true' : undefined)) };

  beforeEach(() => {
    workerJobs = {
      createCutoutJob: jest.fn().mockResolvedValue({ id: 'job-1', status: 'pending' }),
      findCutoutJob: jest.fn().mockResolvedValue({
        id: 'job-1',
        status: 'completed',
        result: null,
        errorCode: null,
        errorMessage: null,
        completedAt: null,
      }),
      createComposeMixedJob: jest.fn().mockResolvedValue({ id: 'job-2' }),
      createValidationJob: jest.fn().mockResolvedValue({ id: 'job-3' }),
      assertEditSessionLink: jest.fn().mockResolvedValue(undefined),
      observeJobInputFileSites: jest.fn().mockResolvedValue(undefined),
    };
    controller = new WorkerJobsController(
      workerJobs as unknown as WorkerJobsService,
      config as unknown as ConfigService,
    );
  });

  it('cutout 생성: 운영자 스탬프 → { siteId }', async () => {
    await controller.createCutoutJob({ fileId: FILE_ID } as never, operatorStamp);
    expect(workerJobs.createCutoutJob.mock.calls[0][1]).toEqual({ siteId: SITE_A });
  });

  it('cutout-status: 운영자 스탬프 → { siteId }', async () => {
    await controller.getCutoutStatus('job-1', operatorStamp);
    expect(workerJobs.findCutoutJob).toHaveBeenCalledWith('job-1', { siteId: SITE_A });
  });

  it('compose-mixed: 운영자 스탬프는 테넌트 근거로 인정하지 않음 → caller undefined(자동조립 fail-closed)', async () => {
    await controller.createComposeMixed({ editSessionId: 's' } as never, operatorStamp);
    expect(workerJobs.createComposeMixedJob.mock.calls[0][1]).toBeUndefined();
  });

  it('validate: 운영자 → siteId 는 권한 사이트로 고정, 범위 밖 editSessionId 는 404', async () => {
    const operatorUser = {
      source: 'partner_operator',
      siteId: SITE_A,
      partnerOperator: { siteId: SITE_A, sessionIds: ['in-scope'] },
    };
    await controller.createValidationJob(
      { fileId: FILE_ID, fileType: 'content', siteId: 'other-site', editSessionId: 'in-scope' } as never,
      operatorUser,
    );
    expect(workerJobs.createValidationJob.mock.calls[0][0]).toMatchObject({ siteId: SITE_A, editSessionId: 'in-scope' });
    await expect(
      controller.createValidationJob({ fileId: FILE_ID, fileType: 'content', editSessionId: 'out-of-scope' } as never, operatorUser),
    ).rejects.toMatchObject({ response: { code: 'SESSION_NOT_FOUND' } });
    expect(workerJobs.createValidationJob).toHaveBeenCalledTimes(1);
  });

  it('validate: shop → 잡 사이트는 토큰 사이트, 본문 siteId 미사용', async () => {
    const dto = { fileId: FILE_ID, fileType: 'content', siteId: 'x' };
    await controller.createValidationJob(dto as never, { source: 'shop', siteId: SITE_A });
    expect(workerJobs.createValidationJob).toHaveBeenCalledWith(
      { ...dto, siteId: SITE_A },
      { skipSiteWorkerDefaults: true, siteWebhookOff: true },
    );
  });

  it('잡 생성 확인 플래그는 미설정(OFF)으로 전달된다', async () => {
    await controller.createValidationJob({ fileId: FILE_ID, fileType: 'content' } as never, { source: 'shop', siteId: SITE_A });
    expect(workerJobs.observeJobInputFileSites.mock.calls[0][3]).toEqual({ strict: false, urls: [] });
  });

  it('회귀: shop → 종전, 익명·비-shop → undefined', async () => {
    await controller.createCutoutJob({ fileId: FILE_ID } as never, { source: 'shop', siteId: SITE_A });
    expect(workerJobs.createCutoutJob.mock.calls[0][1]).toEqual({ siteId: SITE_A });
    await controller.createCutoutJob({ fileId: FILE_ID } as never, undefined);
    expect(workerJobs.createCutoutJob.mock.calls[1][1]).toBeUndefined();
    await controller.getCutoutStatus('job-1', { role: 'ADMIN', siteId: SITE_A });
    expect(workerJobs.findCutoutJob).toHaveBeenLastCalledWith('job-1', undefined);
    await controller.createComposeMixed({ editSessionId: 's' } as never, { source: 'admin', siteId: SITE_A });
    expect(workerJobs.createComposeMixedJob.mock.calls[0][1]).toBeUndefined();
  });
});
