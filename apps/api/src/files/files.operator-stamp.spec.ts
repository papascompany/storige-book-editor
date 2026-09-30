/**
 * 편집기 산출물 site 귀속(2026-09-30) × 운영자 파일 참조 검사 — 연쇄 확인.
 *
 * 운영자 토큰으로 /files/upload 한 파일은 권한 사이트(= 세션 사이트)로 스탬프되고, 같은 세션에
 * cover/content/contentPdf 로 참조하면 통과한다. 다른 사이트로 스탬프된 파일은 400 FILE_NOT_IN_SCOPE.
 *
 * 실제 FilesController·FilesService·EditSessionsService, 저장소만 인메모리 mock(파일 저장소 공유).
 */
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import type { PresignedUploadService } from './presigned-upload.service';
import { FileEntity, FileType } from './entities/file.entity';
import type { UploadFileDto } from './dto/upload-file.dto';
import { ObjectStorageService } from '../storage/object-storage.service';
import { EditSessionsController } from '../edit-sessions/edit-sessions.controller';
import { EditSessionsService } from '../edit-sessions/edit-sessions.service';
import { EditSessionEntity, SessionStatus } from '../edit-sessions/entities/edit-session.entity';
import { EditSessionVersionEntity } from '../edit-sessions/entities/edit-session-version.entity';
import type { UpdateEditSessionDto } from '../edit-sessions/dto/update-edit-session.dto';
import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import { TemplateSetsService } from '../templates/template-sets.service';
import { PartnerOperatorAuditWriter } from '../auth/partner-operator/partner-operator-audit.writer';
import type {
  PartnerOperatorGrant,
  PartnerOperatorUser,
} from '../auth/partner-operator/partner-operator.types';

const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION = '11111111-1111-4111-8111-111111111111';

const grant = (extra: Partial<PartnerOperatorGrant> = {}): PartnerOperatorGrant => ({
  grantId: 'abababab-abab-4bab-8bab-abababababab',
  operatorId: 'op-7f3c',
  operatorName: '운영팀',
  siteId: SITE_A,
  sessionIds: [SESSION],
  capabilities: ['edit'],
  onBehalfOfMemberSeqno: 777,
  grantExpiresAt: Math.floor(Date.now() / 1000) + 3600,
  ...extra,
});

const operator = (g: PartnerOperatorGrant): PartnerOperatorUser => ({
  userId: `po:${g.operatorId}`,
  email: '',
  name: '운영팀',
  role: 'partner_operator',
  source: 'partner_operator',
  permissions: [],
  siteId: g.siteId,
  siteName: 'Site',
  partnerOperator: g,
});

function session(): EditSessionEntity {
  return {
    id: SESSION,
    memberSeqno: 777,
    orderSeqno: 5,
    guestToken: null,
    guestExpiresAt: null,
    siteId: SITE_A,
    status: SessionStatus.EDITING,
    canvasData: [{ page: 1 }],
    metadata: {},
    contentPdfFileId: null,
    contentPdfMode: null,
    coverFileId: null,
    contentFileId: null,
    templateSetId: null,
  } as unknown as EditSessionEntity;
}

describe('편집기 산출물 스탬프 × 운영자 파일 참조 검사', () => {
  /** 파일 저장소(FilesService 가 쓰고 EditSessionsService 가 읽는다) */
  const files = new Map<string, { id: string; siteId: string | null }>();
  let seq = 0;
  const fileRepo = {
    create: jest.fn((v: Record<string, unknown>) => ({ ...v })),
    save: jest.fn(async (v: Record<string, unknown>) => {
      seq += 1;
      const id = `f0000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
      const row = { ...v, id };
      files.set(id, { id, siteId: (v.siteId as string | null) ?? null });
      return row;
    }),
    findOne: jest.fn(async (opts: { where: { id: string } }) => files.get(opts.where.id) ?? null),
  };
  const sessionRepo = {
    findOne: jest.fn(async () => session()),
    save: jest.fn(async (s: EditSessionEntity) => s),
    manager: { query: jest.fn().mockResolvedValue([]) },
  };
  const audit = { recordOrThrow: jest.fn().mockResolvedValue(undefined), recordBestEffort: jest.fn(), list: jest.fn() };

  let filesController: FilesController;
  let sessionsController: EditSessionsController;

  const pdf = { originalname: 'out.pdf', mimetype: 'application/pdf', size: 10, buffer: Buffer.from('x') } as Express.Multer.File;
  const uploadAs = async (user: unknown): Promise<string> => {
    const res = await filesController.uploadFile(
      pdf,
      { type: FileType.CONTENT, metadata: { generatedBy: 'editor', editSessionId: SESSION } } as unknown as UploadFileDto,
      user,
    );
    return res.id;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    files.clear();
    const filesService = new FilesService(
      fileRepo as unknown as Repository<FileEntity>,
      { get: jest.fn((_k: string, d?: unknown) => d) } as unknown as ConfigService,
      { put: jest.fn().mockResolvedValue({ backend: 'local' }) } as unknown as ObjectStorageService,
    );
    filesController = new FilesController(filesService, {} as unknown as PresignedUploadService);

    const moduleRef = await Test.createTestingModule({
      providers: [
        EditSessionsService,
        { provide: getRepositoryToken(EditSessionEntity), useValue: sessionRepo },
        { provide: getRepositoryToken(EditSessionVersionEntity), useValue: { find: jest.fn().mockResolvedValue([]), create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(FileEntity), useValue: fileRepo },
        { provide: WorkerJobsService, useValue: { createValidationJob: jest.fn() } },
        { provide: TemplateSetsService, useValue: { findOneWithTemplates: jest.fn(), findOne: jest.fn() } },
        { provide: PartnerOperatorAuditWriter, useValue: audit },
      ],
    }).compile();
    sessionsController = new EditSessionsController(moduleRef.get(EditSessionsService));
  });

  it('운영자 토큰 업로드 → 파일 site = 권한 사이트(= 세션 사이트)', async () => {
    const id = await uploadAs(operator(grant()));
    expect(files.get(id)?.siteId).toBe(SITE_A);
  });

  it.each([
    ['coverFileId'],
    ['contentFileId'],
    ['contentPdfFileId'],
  ])('스탬프(= 세션 site) 파일을 %s 로 참조 → 통과(저장됨)', async (field) => {
    const id = await uploadAs(operator(grant()));
    await sessionsController.update(SESSION, { [field]: id } as UpdateEditSessionDto, operator(grant()));
    expect(sessionRepo.save).toHaveBeenCalledTimes(1);
  });

  it('관리자 발급(staff origin) 권한도 같은 사이트로 스탬프 → 참조 통과', async () => {
    const staffGrant = grant({ origin: 'staff' } as Partial<PartnerOperatorGrant>);
    const id = await uploadAs(operator(staffGrant));
    expect(files.get(id)?.siteId).toBe(SITE_A);
    await sessionsController.update(SESSION, { coverFileId: id } as UpdateEditSessionDto, operator(staffGrant));
    expect(sessionRepo.save).toHaveBeenCalledTimes(1);
  });

  it('다른 사이트로 스탬프된 파일(shop 토큰 site B) → 400 FILE_NOT_IN_SCOPE, 저장 없음', async () => {
    const id = await uploadAs({ userId: '777', source: 'shop', role: 'customer', siteId: SITE_B });
    expect(files.get(id)?.siteId).toBe(SITE_B);
    let caught: unknown;
    try {
      await sessionsController.update(SESSION, { coverFileId: id } as UpdateEditSessionDto, operator(grant()));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(400);
    expect(((caught as HttpException).getResponse() as { code: string }).code).toBe('FILE_NOT_IN_SCOPE');
    expect(sessionRepo.save).not.toHaveBeenCalled();
  });

  it('회귀: admin JWT 업로드(스탬프 없음, NULL) 파일 참조 → 통과(종전)', async () => {
    const id = await uploadAs({ id: 'admin-1', role: 'ADMIN' });
    expect(files.get(id)?.siteId).toBeNull();
    await sessionsController.update(SESSION, { contentFileId: id } as UpdateEditSessionDto, operator(grant()));
    expect(sessionRepo.save).toHaveBeenCalledTimes(1);
  });
});
