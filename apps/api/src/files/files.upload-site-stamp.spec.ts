/**
 * 편집기 산출물 site 귀속 (2026-09-30) — POST /files/upload 가 호출자 토큰의 사이트를 스탬프한다.
 *
 *  - shop-session·운영자(파트너·관리자 발급 권한) 토큰 → 그 siteId
 *  - admin JWT·siteId 없는 토큰·익명 → null(종전)
 *  - 본문 값(metadata.editSessionId·metadata.siteId)은 근거로 쓰지 않는다
 *  - upload/external 은 종전대로 API Key 사이트
 *  - 만료 sweep 보호절: 세션 site NULL(레거시 무소속)이면 파일 site 와 무관하게 보호
 */
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import type { PresignedUploadService } from './presigned-upload.service';
import { FileEntity, FileType } from './entities/file.entity';
import type { UploadFileDto } from './dto/upload-file.dto';
import type { CurrentSitePayload } from '../auth/decorators/current-site.decorator';
import type { PartnerOperatorGrant, PartnerOperatorUser } from '../auth/partner-operator/partner-operator.types';
import { ObjectStorageService } from '../storage/object-storage.service';

const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const FILE_ID = '11111111-1111-4111-8111-111111111111';

const grant = (extra: Partial<PartnerOperatorGrant> = {}): PartnerOperatorGrant => ({
  grantId: '44444444-4444-4444-8444-444444444444',
  operatorId: 'op-7f3c',
  operatorName: null,
  siteId: SITE_A,
  sessionIds: [SESSION_ID],
  capabilities: ['edit'],
  grantExpiresAt: Math.floor(Date.now() / 1000) + 3600,
  ...extra,
});

const operator = (g: PartnerOperatorGrant): PartnerOperatorUser => ({
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

describe('POST /files/upload — 호출자 토큰 사이트 스탬프', () => {
  let filesService: { uploadFile: jest.Mock; toResponseDto: jest.Mock; setExpiry: jest.Mock };
  let controller: FilesController;
  const pdf = { originalname: 'a.pdf', mimetype: 'application/pdf' } as Express.Multer.File;
  const dto = (extra: Record<string, unknown> = {}): UploadFileDto =>
    ({ type: FileType.CONTENT, ...extra }) as unknown as UploadFileDto;
  const stampArg = (): unknown => filesService.uploadFile.mock.calls[0][5];

  beforeEach(() => {
    filesService = {
      uploadFile: jest.fn().mockResolvedValue({ id: FILE_ID }),
      toResponseDto: jest.fn((f: { id: string }) => ({ id: f.id })),
      setExpiry: jest.fn(async (id: string) => ({ id })),
    };
    controller = new FilesController(
      filesService as unknown as FilesService,
      {} as unknown as PresignedUploadService,
    );
  });

  it('shop-session(siteId A) → A', async () => {
    await controller.uploadFile(pdf, dto(), { userId: '777', source: 'shop', role: 'customer', siteId: SITE_A });
    expect(stampArg()).toBe(SITE_A);
  });

  it('파트너 발급 운영자 토큰(grant.siteId A) → A', async () => {
    await controller.uploadFile(pdf, dto(), operator(grant()));
    expect(stampArg()).toBe(SITE_A);
  });

  it('관리자 발급(staff origin) 운영자 토큰 → grant.siteId(= 세션 siteId)', async () => {
    const g = grant({ siteId: SITE_B, origin: 'staff' } as Partial<PartnerOperatorGrant>);
    await controller.uploadFile(pdf, dto(), operator(g));
    expect(stampArg()).toBe(SITE_B);
  });

  it('admin JWT(source 없음) + metadata.editSessionId 있음 → null(본문 값 불채택)', async () => {
    await controller.uploadFile(
      pdf,
      dto({ metadata: { editSessionId: SESSION_ID, generatedBy: 'editor' } }),
      { id: 'admin-1', role: 'ADMIN', siteId: SITE_A },
    );
    expect(stampArg()).toBeNull();
  });

  it('siteId 없는 shop 토큰·user undefined → null', async () => {
    await controller.uploadFile(pdf, dto(), { userId: '777', source: 'shop', role: 'customer' });
    expect(stampArg()).toBeNull();
    filesService.uploadFile.mockClear();
    await controller.uploadFile(pdf, dto(), undefined);
    expect(stampArg()).toBeNull();
  });

  it('shop 토큰 siteId A + metadata.siteId B → A(본문 무시)', async () => {
    await controller.uploadFile(
      pdf,
      dto({ metadata: { siteId: SITE_B } }),
      { userId: '777', source: 'shop', role: 'customer', siteId: SITE_A },
    );
    expect(stampArg()).toBe(SITE_A);
  });

  it('회귀: 앞 5개 인자(file·type·orderSeqno·memberSeqno·metadata)는 종전 그대로', async () => {
    const metadata = { generatedBy: 'editor' };
    await controller.uploadFile(
      pdf,
      dto({ orderSeqno: 42, metadata }),
      { userId: '777', source: 'shop', role: 'customer', siteId: SITE_A },
    );
    expect(filesService.uploadFile.mock.calls[0].slice(0, 5)).toEqual([pdf, FileType.CONTENT, 42, 777, metadata]);
  });

  it('회귀: upload/external 은 여전히 API Key 사이트 전달', async () => {
    const site: CurrentSitePayload = { siteId: SITE_B, siteName: 'B', role: 'editor', apiKey: 'k', retentionDays: null };
    await controller.uploadFileExternal(pdf, dto(), site);
    expect(stampArg()).toBe(SITE_B);
  });
});

describe('FilesService.uploadFile — 6번째 인자 스탬프가 새 행에만 들어간다', () => {
  it('siteId 인자 → 생성 엔티티 siteId, 미지정 → null', async () => {
    const created: Array<Record<string, unknown>> = [];
    const repo = {
      create: jest.fn((v: Record<string, unknown>) => {
        created.push(v);
        return v;
      }),
      save: jest.fn(async (v: unknown) => v),
    };
    const storage = { put: jest.fn().mockResolvedValue({ backend: 'local' }) };
    const service = new FilesService(
      repo as unknown as Repository<FileEntity>,
      { get: jest.fn((_k: string, d?: unknown) => d) } as unknown as ConfigService,
      storage as unknown as ObjectStorageService,
    );
    const file = { originalname: 'a.pdf', mimetype: 'application/pdf', size: 10, buffer: Buffer.from('x') } as Express.Multer.File;
    await service.uploadFile(file, FileType.CONTENT, undefined, undefined, undefined, SITE_A);
    await service.uploadFile(file, FileType.CONTENT);
    expect(created[0].siteId).toBe(SITE_A);
    expect(created[1].siteId).toBeNull();
    // 기존 행을 갱신하는 경로는 없다(create+save 만)
    expect(Object.keys(repo)).toEqual(['create', 'save']);
  });
});

describe('FilesService.findExpired — 미완결 주문 보호절(무소속 세션은 NULL 파일·직접 참조 파일만 보호)', () => {
  let ds: DataSource;
  let repo: Repository<FileEntity>;

  beforeAll(async () => {
    ds = new DataSource({ type: 'mysql', database: 'spec_no_connect', entities: [FileEntity] });
    await (ds as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas();
    repo = ds.getRepository(FileEntity);
  });

  afterEach(() => jest.restoreAllMocks());

  it('보호절 = 같은 사이트 OR (무소속 세션 AND (NULL 파일 OR 세션 직접 참조 파일))', async () => {
    const captured: string[] = [];
    jest
      .spyOn(SelectQueryBuilder.prototype, 'getMany')
      .mockImplementation(function (this: SelectQueryBuilder<FileEntity>) {
        captured.push(this.getQuery().replace(/`/g, '').replace(/\s+/g, ' '));
        return Promise.resolve([]);
      });
    jest.spyOn(ds.manager, 'query').mockResolvedValue([]);
    const service = new FilesService(
      repo,
      { get: jest.fn((_k: string, d?: unknown) => d) } as unknown as ConfigService,
      {} as unknown as ObjectStorageService,
    );
    await service.findExpired(10);
    expect(captured).toHaveLength(1);
    const sql = captured[0];
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('s.order_seqno = f.order_seqno');
    expect(sql).toContain("s.status <> 'complete'");
    expect(sql).toContain('s.deleted_at IS NULL');
    expect(sql).toContain(
      '( s.site_id = f.site_id OR ( s.site_id IS NULL AND ( f.site_id IS NULL OR s.cover_file_id = f.id OR s.content_file_id = f.id OR s.content_pdf_file_id = f.id ) ) )',
    );
  });

  /**
   * 실제 findExpired SQL 을 sqlite 인메모리 DB 에서 실행해 보호 판정을 확인한다.
   * (mysql 방언으로 생성된 SQL — 백틱 식별자·? 파라미터는 sqlite 도 받는다)
   */
  type SessionRef = 'none' | 'cover' | 'content' | 'contentPdf';
  const cases: Array<[string, string | null, string | null, SessionRef, boolean]> = [
    ['세션 A · 파일 A(스탬프) → 보호', SITE_A, SITE_A, 'none', true],
    ['세션 NULL · 파일 A(스탬프, 세션이 cover 로 참조) → 보호', null, SITE_A, 'cover', true],
    ['세션 NULL · 파일 A(스탬프, 세션이 content 로 참조) → 보호', null, SITE_A, 'content', true],
    ['세션 NULL · 파일 A(스탬프, 세션이 contentPdf 로 참조) → 보호', null, SITE_A, 'contentPdf', true],
    ['세션 NULL · 파일 A(스탬프, 세션이 참조하지 않음) → 만료 후보', null, SITE_A, 'none', false],
    ['세션 NULL · 파일 NULL(종전 보호 유지) → 보호', null, null, 'none', true],
    ['세션 A · 파일 NULL(종전과 같음) → 만료 후보', SITE_A, null, 'none', false],
    ['세션 A · 파일 B(다른 사이트) → 만료 후보', SITE_A, SITE_B, 'none', false],
    ['세션 A · 파일 B(다른 사이트, 세션이 참조해도 사이트 불일치) → 만료 후보', SITE_A, SITE_B, 'cover', false],
  ];
  it.each(cases)('%s', async (_l, sessionSite, fileSite, ref, isProtected) => {
    let captured: [string, unknown[]] | undefined;
    jest
      .spyOn(SelectQueryBuilder.prototype, 'getMany')
      .mockImplementation(function (this: SelectQueryBuilder<FileEntity>) {
        captured = this.getQueryAndParameters() as [string, unknown[]];
        return Promise.resolve([]);
      });
    jest.spyOn(ds.manager, 'query').mockResolvedValue([]);
    const service = new FilesService(
      repo,
      { get: jest.fn((_k: string, d?: unknown) => d) } as unknown as ConfigService,
      {} as unknown as ObjectStorageService,
    );
    await service.findExpired(10);
    expect(captured).toBeDefined();
    const [sql, params] = captured!;

    const lite = new DataSource({ type: 'sqlite', database: ':memory:' });
    await lite.initialize();
    try {
      const cols = repo.metadata.columns.map((c) => `\`${c.databaseName}\``).join(', ');
      await lite.query(`CREATE TABLE files (${cols})`);
      await lite.query(
        'CREATE TABLE file_edit_sessions (id TEXT, order_seqno INTEGER, status TEXT, deleted_at TEXT, site_id TEXT, ' +
          'cover_file_id TEXT, content_file_id TEXT, content_pdf_file_id TEXT)',
      );
      await lite.query(
        'INSERT INTO files (id, order_seqno, site_id, expires_at, deleted_at) VALUES (?, ?, ?, ?, NULL)',
        [FILE_ID, 9001, fileSite, 1],
      );
      await lite.query(
        'INSERT INTO file_edit_sessions (id, order_seqno, status, deleted_at, site_id, cover_file_id, content_file_id, content_pdf_file_id) ' +
          "VALUES (?, 9001, 'editing', NULL, ?, ?, ?, ?)",
        [
          SESSION_ID,
          sessionSite,
          ref === 'cover' ? FILE_ID : null,
          ref === 'content' ? FILE_ID : null,
          ref === 'contentPdf' ? FILE_ID : null,
        ],
      );
      const rows = (await lite.query(sql, params)) as unknown[];
      // 보호 = 만료 후보에서 빠짐
      expect(rows.length === 0).toBe(isProtected);
    } finally {
      await lite.destroy();
    }
  });
});
