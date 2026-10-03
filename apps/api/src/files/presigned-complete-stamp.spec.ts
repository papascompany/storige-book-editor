/**
 * S3-A안 — presigned complete 의 옵션형 site 스탬프 (2026-08-28, 오너 결정 D1).
 *
 * 계약(테넌시 설계안 §2-A):
 *  - 검증된 shop-session Bearer 가 실려 오면 완료 확정 시 파일에 그 site 를 귀속.
 *  - 토큰 없음/위조/비-shop → **종전대로 NULL**(무중단 — 100p 키없는 경로·게스트 불변).
 *  - 이미 귀속된 파일 + 타 site caller → requirePending 기존 대조가 404(회귀 가드).
 *  - @Public + ApiKeyGuard 불추가 → contract-freeze.spec 무변경(동결 저촉 없음).
 *  - v1.9: 토큰 근거가 없으면 검증된 활성 사이트 키(X-API-Key)의 사이트로 귀속(K1–K17).
 *    토큰 사이트가 우선이고 둘이 다르면 귀속하지 않는다. 귀속은 최초 확정 1회, 보관기간은 영구.
 *
 * 구성: 실 FilesController + 실 PresignedUploadService + 실 OptionalShopJwtGuard
 * + 실 OptionalApiKeySiteGuard(SitesService 는 키별 응답 mock)
 * + 실 JwtService(진짜 서명/검증) + 전역 JwtAuthGuard(@Public 단락 재현)
 * + 인메모리 file repo + S3 fake(HeadObject 성공 고정).
 */
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { PresignedUploadService } from './presigned-upload.service';
import { FileEntity } from './entities/file.entity';
import { ObjectStorageService } from '../storage/object-storage.service';
import { StorageConfigService } from '../settings/storage-config.service';
import { OptionalShopJwtGuard } from '../auth/guards/optional-shop-jwt.guard';
import { OptionalApiKeySiteGuard } from '../auth/guards/optional-api-key-site.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SitesService } from '../sites/sites.service';

const JWT_SECRET = 'stamp-spec-secret';
const OTHER_SECRET = 'forged-secret';
const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOKEN = 'upload-token-1';
/** 사이트 키 고정값 — sk-a: 편집기 코드(site A), sk-b: 편집기 코드(site B), sk-a-w: 워커 코드(site A) */
const KEY_A = 'sk-a';
const KEY_B = 'sk-b';
const KEY_A_WORKER = 'sk-a-w';
const INTERNAL_WORKER_KEY = 'internal-worker-key';

type SiteRow = { id: string; name: string } | null;
const editorSiteOf = async (code: string): Promise<SiteRow> =>
  code === KEY_A ? { id: SITE_A, name: 'A' } : code === KEY_B ? { id: SITE_B, name: 'B' } : null;
const workerSiteOf = async (code: string): Promise<SiteRow> =>
  code === KEY_A_WORKER ? { id: SITE_A, name: 'A' } : null;

describe('presigned complete — 옵션형 site 스탬프 (S3-A안)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const ORIGINAL_WORKER_KEY = process.env.WORKER_API_KEY;
  const sites = {
    findByEditorAuthCode: jest.fn(editorSiteOf),
    findByWorkerAuthCode: jest.fn(workerSiteOf),
  };

  const store = new Map<string, Record<string, any>>();
  const fileRepo = {
    findOne: async ({ where }: { where: { id: string } }) => store.get(where.id) ?? null,
    save: async (f: Record<string, any>) => {
      store.set(f.id, f);
      return f;
    },
  };

  // S3 fake — HeadObject 는 항상 1024바이트 존재로 응답(finalize 통과), 나머지는 no-op.
  const s3Fake = {
    ensureS3: async () => ({
      client: {
        send: async (cmd: { constructor: { name: string } }) => {
          if (cmd.constructor.name === 'HeadObjectCommand') return { ContentLength: 1024 };
          return {};
        },
      },
      bucket: 'test-bucket',
    }),
    delete: async () => undefined,
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: JWT_SECRET })],
      controllers: [FilesController],
      providers: [
        PresignedUploadService,
        OptionalShopJwtGuard,
        OptionalApiKeySiteGuard,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: getRepositoryToken(FileEntity), useValue: fileRepo },
        { provide: ObjectStorageService, useValue: s3Fake },
        { provide: StorageConfigService, useValue: { getEffectiveConfig: async () => ({ driver: 's3' }) } },
        { provide: FilesService, useValue: { toResponseDto: (f: Record<string, any>) => f } },
        { provide: SitesService, useValue: sites },
        { provide: ConfigService, useValue: { get: () => JWT_SECRET } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
    if (ORIGINAL_WORKER_KEY === undefined) delete process.env.WORKER_API_KEY;
    else process.env.WORKER_API_KEY = ORIGINAL_WORKER_KEY;
  });

  beforeEach(() => {
    delete process.env.WORKER_API_KEY;
    sites.findByEditorAuthCode.mockReset().mockImplementation(editorSiteOf);
    sites.findByWorkerAuthCode.mockReset().mockImplementation(workerSiteOf);
  });

  const signShop = (payload: Record<string, unknown>, secret = JWT_SECRET) =>
    new JwtService({ secret }).sign({ sub: '0', source: 'shop', ...payload }, { expiresIn: '1h' });

  /** pending 파일 시드 — presign 발급 직후 상태 재현 */
  const seed = (over: Record<string, any> = {}) => {
    const f = {
      id: '00000000-0000-4000-8000-000000000001',
      storageBackend: 's3',
      storageKey: 'uploads/x.pdf',
      status: 'pending',
      uploadToken: TOKEN,
      multipartUploadId: null,
      expectedSize: 1024,
      siteId: null,
      expiresAt: new Date(Date.now() + 1000),
      ...over,
    };
    store.clear();
    store.set(f.id, f);
    return f;
  };

  const complete = (id: string, headers: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .post(`/files/${id}/complete`)
      .set(headers)
      .send({ uploadToken: TOKEN });

  it('T1 스탬프: 유효 shop-session(site A) Bearer → 파일 siteId=A 로 확정', async () => {
    const f = seed();
    await complete(f.id, { Authorization: `Bearer ${signShop({ siteId: SITE_A })}` }).expect(201);
    expect(store.get(f.id)!.siteId).toBe(SITE_A);
    expect(store.get(f.id)!.status).toBe('ready');
  });

  it('T2 토큰·사이트 키 모두 없음 → NULL 로 확정(게스트 경로)', async () => {
    const f = seed();
    await complete(f.id).expect(201);
    expect(store.get(f.id)!.siteId).toBeNull();
    expect(store.get(f.id)!.status).toBe('ready');
  });

  it('T3 공격: 다른 시크릿으로 위조한 토큰(site B) → NULL (decode 아닌 verify)', async () => {
    const f = seed();
    await complete(f.id, { Authorization: `Bearer ${signShop({ siteId: SITE_B }, OTHER_SECRET)}` }).expect(201);
    expect(store.get(f.id)!.siteId).toBeNull();
  });

  it('T4 비-shop 토큰(admin 등 source 상이) → 스탬프하지 않음', async () => {
    const f = seed();
    const adminish = new JwtService({ secret: JWT_SECRET }).sign(
      { sub: '1', source: 'admin', siteId: SITE_B },
      { expiresIn: '1h' },
    );
    await complete(f.id, { Authorization: `Bearer ${adminish}` }).expect(201);
    expect(store.get(f.id)!.siteId).toBeNull();
  });

  it('T5 회귀 가드: 이미 site A 귀속 파일을 site B caller 가 complete → 404 (기존 대조 불변)', async () => {
    const f = seed({ siteId: SITE_A });
    await complete(f.id, { Authorization: `Bearer ${signShop({ siteId: SITE_B })}` }).expect(404);
    expect(store.get(f.id)!.status).toBe('pending'); // 확정되지 않음
  });

  it('T6 멱등: 이미 ready 인 파일 재호출 → 200/201 + 스탬프 소급 없음', async () => {
    const f = seed({ status: 'ready', uploadToken: null });
    await complete(f.id, { Authorization: `Bearer ${signShop({ siteId: SITE_A })}` }).expect(201);
    expect(store.get(f.id)!.siteId).toBeNull(); // 최초 확정 시점의 값 유지
  });

  it('T7 multipart/complete 도 동일 스탬프', async () => {
    const f = seed({
      id: '00000000-0000-4000-8000-000000000002',
      multipartUploadId: 'mu-1',
    });
    await request(app.getHttpServer())
      .post('/files/multipart/complete')
      .set({ Authorization: `Bearer ${signShop({ siteId: SITE_A })}` })
      .send({ fileId: f.id, uploadToken: TOKEN, parts: [{ partNumber: 1, etag: 'e1' }] })
      .expect(201);
    expect(store.get(f.id)!.siteId).toBe(SITE_A);
  });

  it('T8 siteId 없는 shop JWT(레거시 발급) → NULL 유지', async () => {
    const f = seed();
    await complete(f.id, { Authorization: `Bearer ${signShop({})}` }).expect(201);
    expect(store.get(f.id)!.siteId).toBeNull();
  });

  // ── v1.9: 사이트 키(X-API-Key) 근거 ─────────────────────────────────
  const multipartComplete = (fileId: string, headers: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .post('/files/multipart/complete')
      .set(headers)
      .send({ fileId, uploadToken: TOKEN, parts: [{ partNumber: 1, etag: 'e1' }] });

  const stampLogLines = (spy: jest.SpyInstance): string[] =>
    spy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((m: string) => m.startsWith('[presigned-stamp]'));

  it('K1 활성 사이트 키(site A)만 → single complete 파일 siteId=A 로 확정', async () => {
    const f = seed();
    await complete(f.id, { 'X-API-Key': KEY_A }).expect(201);
    expect(store.get(f.id)!.siteId).toBe(SITE_A);
    expect(store.get(f.id)!.status).toBe('ready');
  });

  it('K2 multipart/complete 도 사이트 키만으로 siteId=A 로 확정', async () => {
    const f = seed({ id: '00000000-0000-4000-8000-000000000002', multipartUploadId: 'mu-1' });
    await multipartComplete(f.id, { 'X-API-Key': KEY_A }).expect(201);
    expect(store.get(f.id)!.siteId).toBe(SITE_A);
    expect(store.get(f.id)!.status).toBe('ready');
  });

  it('K3 워커 코드로 매칭된 사이트 키도 같은 사이트로 확정', async () => {
    const f = seed();
    await complete(f.id, { 'X-API-Key': KEY_A_WORKER }).expect(201);
    expect(store.get(f.id)!.siteId).toBe(SITE_A);
  });

  it('K4 shop-session(site A) + 사이트 키(site A) → A', async () => {
    const f = seed();
    await complete(f.id, {
      Authorization: `Bearer ${signShop({ siteId: SITE_A })}`,
      'X-API-Key': KEY_A,
    }).expect(201);
    expect(store.get(f.id)!.siteId).toBe(SITE_A);
  });

  it('K5 shop-session(site A) + 사이트 키(site B) → 귀속 없이 NULL 로 확정', async () => {
    const f = seed();
    await complete(f.id, {
      Authorization: `Bearer ${signShop({ siteId: SITE_A })}`,
      'X-API-Key': KEY_B,
    }).expect(201);
    expect(store.get(f.id)!.siteId).toBeNull();
    expect(store.get(f.id)!.status).toBe('ready');
  });

  it('K6 서명 검증에 실패한 토큰(site B) + 사이트 키(site A) → A', async () => {
    const f = seed();
    await complete(f.id, {
      Authorization: `Bearer ${signShop({ siteId: SITE_B }, OTHER_SECRET)}`,
      'X-API-Key': KEY_A,
    }).expect(201);
    expect(store.get(f.id)!.siteId).toBe(SITE_A);
  });

  it('K7 활성 사이트와 매칭되지 않는 키 → NULL 로 확정', async () => {
    const f = seed();
    await complete(f.id, { 'X-API-Key': 'sk-unknown' }).expect(201);
    expect(store.get(f.id)!.siteId).toBeNull();
    expect(store.get(f.id)!.status).toBe('ready');
  });

  it('K8 내부 WORKER_API_KEY → NULL 로 확정, 사이트 조회 없음', async () => {
    process.env.WORKER_API_KEY = INTERNAL_WORKER_KEY;
    const f = seed();
    await complete(f.id, { 'X-API-Key': INTERNAL_WORKER_KEY }).expect(201);
    expect(store.get(f.id)!.siteId).toBeNull();
    expect(sites.findByEditorAuthCode).not.toHaveBeenCalled();
    expect(sites.findByWorkerAuthCode).not.toHaveBeenCalled();
  });

  it('K9 사이트 조회 오류 → NULL 로 확정', async () => {
    sites.findByEditorAuthCode.mockRejectedValue(new Error('db unavailable'));
    const f = seed();
    await complete(f.id, { 'X-API-Key': KEY_A }).expect(201);
    expect(store.get(f.id)!.siteId).toBeNull();
    expect(store.get(f.id)!.status).toBe('ready');
  });

  it('K10 ready(NULL) 파일 재호출 + 사이트 키 → siteId NULL 유지', async () => {
    const f = seed({ status: 'ready', uploadToken: null });
    await complete(f.id, { 'X-API-Key': KEY_A }).expect(201);
    expect(store.get(f.id)!.siteId).toBeNull();
  });

  it('K11 site A 로 확정된 파일 + site B 키 재호출 → 404 FILE_NOT_FOUND, 파일 불변', async () => {
    const f = seed({ status: 'ready', uploadToken: null, siteId: SITE_A });
    const res = await complete(f.id, { 'X-API-Key': KEY_B }).expect(404);
    expect(res.body.code).toBe('FILE_NOT_FOUND');
    expect(store.get(f.id)!.siteId).toBe(SITE_A);
    expect(store.get(f.id)!.status).toBe('ready');
  });

  it('K12 site A 로 확정된 파일 + site A 키 재호출 → 201', async () => {
    const f = seed({ status: 'ready', uploadToken: null, siteId: SITE_A });
    await complete(f.id, { 'X-API-Key': KEY_A }).expect(201);
    expect(store.get(f.id)!.siteId).toBe(SITE_A);
  });

  it('K13 pending 파일 + 사이트 키 + 다른 uploadToken → 404 FILE_NOT_FOUND, pending 유지', async () => {
    const f = seed();
    const res = await request(app.getHttpServer())
      .post(`/files/${f.id}/complete`)
      .set({ 'X-API-Key': KEY_A })
      .send({ uploadToken: 'upload-token-2' })
      .expect(404);
    expect(res.body.code).toBe('FILE_NOT_FOUND');
    expect(store.get(f.id)!.status).toBe('pending');
    expect(store.get(f.id)!.siteId).toBeNull();
  });

  it('K14 Authorization: Bearer 에 실린 사이트 키 문자열 → NULL 로 확정(키는 X-API-Key 헤더로만 읽음)', async () => {
    const f = seed();
    await complete(f.id, { Authorization: `Bearer ${KEY_A}` }).expect(201);
    expect(store.get(f.id)!.siteId).toBeNull();
    expect(sites.findByEditorAuthCode).not.toHaveBeenCalled();
  });

  it('K15 사이트 키로 확정한 파일의 expiresAt 은 null(보관기간 영구)', async () => {
    const f = seed();
    await complete(f.id, { 'X-API-Key': KEY_A }).expect(201);
    expect(store.get(f.id)!.siteId).toBe(SITE_A);
    expect(store.get(f.id)!.expiresAt).toBeNull();
  });

  it('K16 사이트 키 귀속 시 [presigned-stamp] 로그 1줄(basis=site-key, 사이트 id 는 축약)', async () => {
    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const f = seed();
      await complete(f.id, { 'X-API-Key': KEY_A }).expect(201);
      const lines = stampLogLines(spy);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('basis=site-key');
      expect(lines[0]).toContain(`file=${f.id}`);
      expect(lines[0]).not.toContain(SITE_A);
    } finally {
      spy.mockRestore();
    }
  });

  it('K17 토큰 근거 귀속·귀속 없음은 [presigned-stamp] 로그를 남기지 않는다', async () => {
    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const f = seed();
      await complete(f.id, { Authorization: `Bearer ${signShop({ siteId: SITE_A })}` }).expect(201);
      expect(store.get(f.id)!.siteId).toBe(SITE_A);
      const g = seed();
      await complete(g.id).expect(201);
      expect(stampLogLines(spy)).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});
