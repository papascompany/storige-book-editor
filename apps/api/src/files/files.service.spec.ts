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

  /**
   * 고아 판정 역참조 — compose-mixed options JSON (2026-08-13).
   *
   * 배경: compose-mixed 자동조립(assembleFromSession)은 파일참조를 **file_url 이 아니라**
   *   `api://<fileId>`(s3 백엔드) 또는 `file_path`(local) 로 싣는다
   *   (worker-jobs.service.ts:190-192 toWorkerInputUrl). 종전 절은 file_url 하고만 비교해
   *   자동조립 잡이 물고 있는 표지/내지/면지 파일을 전부 miss → **고아 오판·삭제 위험**.
   *
   * ⚠️ 방향: 이 절은 `NOT EXISTS` 안에 OR 로 들어간다 = 참조가 하나라도 걸리면 후보에서 제외.
   *   즉 매칭 형식을 늘리는 것은 항상 '덜 지우는' 보수적 방향이다. 아래 테스트는
   *   (a) NOT EXISTS 방향, (b) 4개 옵션 키 × URL 표기 5종 대조를 잠근다.
   */
  describe('findOrphanCandidates — compose-mixed 역참조 (데이터손실 방지)', () => {
    /** worker_jobs NOT EXISTS 절을 공백 정규화해 반환 */
    const workerJobClause = async (): Promise<string> => {
      await service.findOrphanCandidates(24, 30, 200);
      const clause = mockQueryBuilder.andWhere.mock.calls
        .map((c) => String(c[0]))
        .find((sql) => sql.includes('worker_jobs'));
      expect(clause).toBeDefined();
      return (clause as string).replace(/\s+/g, ' ').trim();
    };

    it('worker_jobs 역참조는 NOT EXISTS 방향이다 — 참조가 걸리면 고아가 아니다', async () => {
      const sql = await workerJobClause();
      expect(sql.startsWith('NOT EXISTS (')).toBe(true);
      expect(sql).toContain('SELECT 1 FROM worker_jobs w');
    });

    it.each(['coverUrl', 'contentPdfUrl', 'contentUrl'])(
      '스칼라 옵션 $.%s 가 api://<id> · file_path · file_url · s3://<key> · %%/<key> 전부와 대조된다',
      async (key) => {
        const sql = await workerJobClause();
        const expr = `JSON_VALUE(w.options, '$.${key}')`;
        // 자동조립(s3) — 이번 수정의 핵심. 종전엔 이 형식이 없어 전량 miss 였다.
        expect(sql).toContain(`${expr} = CONCAT('api://', f.id)`);
        // 자동조립(local)
        expect(sql).toContain(`${expr} = f.file_path`);
        // 외부 파트너 직접 호출(공개 URL) — 기존 규약 유지(회귀 방지)
        expect(sql).toContain(`${expr} = f.file_url`);
        // storage_key 기반 2종은 NULL 가드와 함께여야 한다(NULL substring 매칭 사고 방지)
        expect(sql).toContain(
          `(f.storage_key IS NOT NULL AND ${expr} = CONCAT('s3://', f.storage_key))`,
        );
        expect(sql).toContain(
          `(f.storage_key IS NOT NULL AND ${expr} LIKE CONCAT('%/', f.storage_key))`,
        );
      },
    );

    it.each(['frontEndpaperUrls', 'backEndpaperUrls'])(
      '배열 옵션 $.%s 는 원소 단위(JSON_CONTAINS/JSON_SEARCH)로 5종 전부와 대조된다',
      async (key) => {
        const sql = await workerJobClause();
        const doc = `JSON_EXTRACT(w.options, '$.${key}')`;
        expect(sql).toContain(`JSON_CONTAINS(${doc}, JSON_QUOTE(CONCAT('api://', f.id)))`);
        expect(sql).toContain(`JSON_CONTAINS(${doc}, JSON_QUOTE(f.file_path))`);
        expect(sql).toContain(`JSON_CONTAINS(${doc}, JSON_QUOTE(f.file_url))`);
        expect(sql).toContain(
          `(f.storage_key IS NOT NULL AND JSON_CONTAINS(${doc}, JSON_QUOTE(CONCAT('s3://', f.storage_key))))`,
        );
        expect(sql).toContain(
          `(f.storage_key IS NOT NULL AND JSON_SEARCH(${doc}, 'one', CONCAT('%/', f.storage_key)) IS NOT NULL)`,
        );
      },
    );

    it('기존 역참조(컬럼 3종 · 입력 URL · id 기반 JSON 경로)는 유지된다', async () => {
      const sql = await workerJobClause();
      for (const frag of [
        'w.file_id = f.id',
        'w.output_file_id = f.id',
        'w.pdf_file_id = f.id',
        "w.input_file_url = CONCAT('api://', f.id)",
        "JSON_VALUE(w.options, '$.spreadPdfFileId') = f.id",
        "JSON_VALUE(w.options, '$.pdfFileId') = f.id",
        "JSON_CONTAINS(JSON_EXTRACT(w.options, '$.contentPdfFileIds'), JSON_QUOTE(f.id))",
      ]) {
        expect(sql).toContain(frag);
      }
    });

    /**
     * synthesis(createSynthesisJob) 내지 역참조 — 2026-08-13 추가.
     *
     * 이 잡은 **표지만** 컬럼에 남긴다(worker-jobs.service.ts:1086-1087
     * fileId=coverFileId · inputFileUrl=coverUrl). 내지는 options.contentFileId /
     * options.contentUrl 에만 존재하므로(:1093-1096), 이 경로가 빠지면 게스트 세션
     * 하드 DELETE + grace 경과 후 **내지만** 고아로 오판·삭제된다(표지는 생존).
     */
    it('synthesis 잡의 내지·표지 id 경로($.contentFileId·$.coverFileId)가 역참조된다', async () => {
      const sql = await workerJobClause();
      expect(sql).toContain("JSON_VALUE(w.options, '$.contentFileId') = f.id");
      expect(sql).toContain("JSON_VALUE(w.options, '$.coverFileId') = f.id");
    });

    it('edit_session 참조 절(3컬럼)도 NOT EXISTS 로 유지된다', async () => {
      await service.findOrphanCandidates(24, 30, 200);
      const clause = mockQueryBuilder.andWhere.mock.calls
        .map((c) => String(c[0]).replace(/\s+/g, ' ').trim())
        .find((sql) => sql.includes('file_edit_sessions'));
      expect(clause).toBeDefined();
      expect(clause?.startsWith('NOT EXISTS (')).toBe(true);
      expect(clause).toContain('s.cover_file_id = f.id');
      expect(clause).toContain('s.content_file_id = f.id');
      expect(clause).toContain('s.content_pdf_file_id = f.id');
    });
  });
});
