/**
 * GET /files/:id/external — 워커 합성(split·duplex-split·spread) 파일 메타 조회 (2026-10-18 신설).
 *
 * 종전 워커는 JWT 전용 GET /files/:id 를 X-API-Key 로 호출해 항상 401 → 잡 FAILED(INTERNAL_ERROR).
 * 이 라우트는 download/external 과 같은 사이트 대조 규칙(worker 역할 바이패스·NULL=레거시 허용·
 * 타 사이트 404)을 쓰고, GET /files/:id 와 같은 FileResponseDto 를 돌려준다.
 *
 * 사이트 대조는 mock 이 아니라 실제 FilesService(assertSiteAccess) 로 실행한다.
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { FileEntity, FileType } from './entities/file.entity';
import { ObjectStorageService } from '../storage/object-storage.service';
import type { PresignedUploadService } from './presigned-upload.service';
import type { CurrentSitePayload } from '../auth/decorators/current-site.decorator';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import type { SitesService } from '../sites/sites.service';

const FILE_ID = '11111111-1111-4111-8111-111111111111';
const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const siteCaller = (siteId: string, role: 'editor' | 'worker'): CurrentSitePayload => ({
  siteId,
  siteName: `site-${siteId.slice(0, 1)}`,
  role,
  apiKey: 'k',
});

const fileRow = (siteId: string | null): FileEntity =>
  ({
    id: FILE_ID,
    siteId,
    fileName: 'out.pdf',
    originalName: 'out.pdf',
    fileUrl: '/storage/uploads/out.pdf',
    filePath: '/srv/storage/uploads/out.pdf',
    thumbnailUrl: null,
    fileSize: '123',
    mimeType: 'application/pdf',
    fileType: FileType.CONTENT,
    orderSeqno: null,
    memberSeqno: null,
    metadata: { generatedBy: 'editor', editSessionId: 'sess-1' },
    storageBackend: 'local',
    status: 'ready',
    expiresAt: null,
    createdAt: new Date('2026-10-18T00:00:00Z'),
  }) as unknown as FileEntity;

async function statusOf(p: Promise<unknown>): Promise<number | 'ok'> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof HttpException) return e.getStatus();
    throw e;
  }
}

describe('GET /files/:id/external — 워커 메타 조회(X-API-Key + 사이트 대조)', () => {
  let controller: FilesController;
  let findOne: jest.Mock;

  beforeEach(async () => {
    findOne = jest.fn();
    const module = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: getRepositoryToken(FileEntity), useValue: { findOne, save: jest.fn(), update: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn((_k: string, d?: unknown) => d) } },
        { provide: ObjectStorageService, useValue: { get: jest.fn(), put: jest.fn(), delete: jest.fn() } },
      ],
    }).compile();
    controller = new FilesController(module.get(FilesService), {} as unknown as PresignedUploadService);
  });

  it('라우트 메타: @Public + ApiKeyGuard 조합(하우스 규약) — JWT 없이 X-API-Key 로 도달', () => {
    const h = FilesController.prototype.getFileExternal;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, h)).toBe(true);
    const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, h) ?? [];
    expect(guards).toContain(ApiKeyGuard);
  });

  it('키 없음 → ApiKeyGuard 401 (핸들러 미도달)', async () => {
    const sites = { findByEditorAuthCode: jest.fn(), findByWorkerAuthCode: jest.fn() };
    const guard = new ApiKeyGuard(sites as unknown as SitesService);
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    } as unknown as ExecutionContext;
    await expect(statusOf(guard.canActivate(ctx))).resolves.toBe(401);
    expect(sites.findByEditorAuthCode).not.toHaveBeenCalled();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('타 사이트 키(editor, site B) → 404 (존재 미노출)', async () => {
    findOne.mockResolvedValue(fileRow(SITE_A));
    await expect(statusOf(controller.getFileExternal(FILE_ID, siteCaller(SITE_B, 'editor')))).resolves.toBe(404);
  });

  it('워커 role(WORKER_API_KEY) → 200, 타 사이트 파일도 바이패스, GET /files/:id 와 같은 DTO', async () => {
    findOne.mockResolvedValue(fileRow(SITE_A));
    const dto = await controller.getFileExternal(FILE_ID, siteCaller(SITE_B, 'worker'));
    expect(dto).toEqual({
      id: FILE_ID,
      fileName: 'out.pdf',
      originalName: 'out.pdf',
      fileUrl: '/storage/uploads/out.pdf',
      thumbnailUrl: null,
      fileSize: 123,
      mimeType: 'application/pdf',
      fileType: FileType.CONTENT,
      orderSeqno: null,
      memberSeqno: null,
      metadata: { generatedBy: 'editor', editSessionId: 'sess-1' },
      storageBackend: 'local',
      status: 'ready',
      expiresAt: null,
      createdAt: new Date('2026-10-18T00:00:00Z'),
    });
    // 워커 이중검증 필드(metadata.generatedBy·editSessionId)는 DTO 에 포함된다
    expect(dto.metadata?.generatedBy).toBe('editor');
    expect(dto.metadata?.editSessionId).toBe('sess-1');
    // SEC-008: filePath 는 GET /files/:id 와 동일하게 미노출
    expect(dto).not.toHaveProperty('filePath');
  });

  it('같은 사이트 키(editor, site A) → 200', async () => {
    findOne.mockResolvedValue(fileRow(SITE_A));
    const dto = await controller.getFileExternal(FILE_ID, siteCaller(SITE_A, 'editor'));
    expect(dto.id).toBe(FILE_ID);
  });

  it('NULL-site 파일(레거시/공유)은 어느 사이트 키로도 200', async () => {
    findOne.mockResolvedValue(fileRow(null));
    const dto = await controller.getFileExternal(FILE_ID, siteCaller(SITE_B, 'editor'));
    expect(dto.id).toBe(FILE_ID);
  });

  it('없는 파일(soft-deleted 포함 — findOne 미반환) → 404', async () => {
    findOne.mockResolvedValue(null);
    await expect(statusOf(controller.getFileExternal(FILE_ID, siteCaller(SITE_A, 'worker')))).resolves.toBe(404);
  });
});
