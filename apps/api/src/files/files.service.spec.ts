import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FilesService } from './files.service';
import { FileEntity, FileType } from './entities/file.entity';
import { ObjectStorageService } from '../storage/object-storage.service';

/**
 * Phase 0 안전판 회귀 스펙 (2026-07-03) — files 모듈 첫 스펙.
 * 커버:
 *  1) P0-3 thumbnail 테넌트 격리 — generateThumbnail/getThumbnailBuffer 가 assertSiteAccess 를
 *     mimeType 검사보다 먼저 강제하는지(타 테넌트 404 / NULL·worker·정합 통과).
 *  2) P0 findExpired 무중단 가드 — 미완결 주문(편집세션 status<>'complete') 파일 제외를 위한
 *     NOT EXISTS(file_edit_sessions) 조인이 쿼리에 포함되는지(가드 실수 제거 방지).
 */
describe('FilesService (Phase 0 safety net)', () => {
  let service: FilesService;
  let fileRepository: jest.Mocked<Repository<FileEntity>>;

  // 비-PDF 파일: assertSiteAccess 를 통과하면 mimeType 검사에서 BadRequestException 이 난다.
  // → NotFoundException(격리 차단) 과 BadRequestException(격리 통과) 로 결과를 구분할 수 있다.
  const fileWithSite = (siteId: string | null): FileEntity =>
    ({
      id: '11111111-1111-1111-1111-111111111111',
      siteId,
      mimeType: 'image/png', // 비-PDF → 격리 통과 시 mimeType 검사로 이어짐
      fileName: 'x.png',
      fileType: FileType.OTHER,
    }) as FileEntity;

  const mockQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        {
          provide: getRepositoryToken(FileEntity),
          useValue: {
            findOne: jest.fn(),
            save: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_k: string, d?: unknown) => d) },
        },
        {
          provide: ObjectStorageService,
          useValue: { get: jest.fn(), put: jest.fn(), delete: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<FilesService>(FilesService);
    fileRepository = module.get(getRepositoryToken(FileEntity));
    jest.clearAllMocks();
  });

  describe('thumbnail 테넌트 격리 (P0-3)', () => {
    it('타 테넌트(site 불일치)는 404 — GS 래스터화 이전에 차단', async () => {
      fileRepository.findOne.mockResolvedValue(fileWithSite('site-A'));
      await expect(
        service.getThumbnailBuffer('id', 1, 200, { siteId: 'site-B' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('정합 site 는 격리 통과 (이후 비-PDF 이므로 400)', async () => {
      fileRepository.findOne.mockResolvedValue(fileWithSite('site-A'));
      await expect(
        service.generateThumbnail('id', 1, 200, { siteId: 'site-A' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('NULL-siteId(레거시/공유)는 어떤 caller 든 격리 통과 (이후 400)', async () => {
      fileRepository.findOne.mockResolvedValue(fileWithSite(null));
      await expect(
        service.generateThumbnail('id', 1, 200, { siteId: 'site-B' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('worker 역할(내부 WORKER_API_KEY)은 site 무관 격리 통과 (이후 400)', async () => {
      fileRepository.findOne.mockResolvedValue(fileWithSite('site-A'));
      await expect(
        service.generateThumbnail('id', 1, 200, { role: 'worker' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('caller 미지정(내부 호출)은 격리 검사 생략 (이후 400)', async () => {
      fileRepository.findOne.mockResolvedValue(fileWithSite('site-A'));
      await expect(service.generateThumbnail('id', 1, 200)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('findExpired 무중단 가드 (미완결 주문 제외)', () => {
    it('미완결 주문(편집세션 status<>complete) 제외를 위한 NOT EXISTS 조인이 쿼리에 포함된다', async () => {
      await service.findExpired(50);
      const guardClause = mockQueryBuilder.andWhere.mock.calls
        .map((c) => String(c[0]))
        .find((sql) => sql.includes('NOT EXISTS'));
      expect(guardClause).toBeDefined();
      expect(guardClause).toContain('file_edit_sessions');
      expect(guardClause).toContain("s.status <> 'complete'");
      // order_seqno 단독 가드로 회귀하지 않았는지(세션 조인 방식 유지) 확인
      expect(guardClause).toContain('s.order_seqno = f.order_seqno');
    });

    it('만료 조건(expires_at NOT NULL AND < now)은 유지된다', async () => {
      await service.findExpired();
      const wheres = [
        ...mockQueryBuilder.where.mock.calls,
        ...mockQueryBuilder.andWhere.mock.calls,
      ].map((c) => String(c[0]));
      expect(wheres.some((s) => s.includes('expires_at IS NOT NULL'))).toBe(true);
      expect(wheres.some((s) => s.includes('expires_at < :now'))).toBe(true);
    });
  });
});
