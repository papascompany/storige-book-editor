/**
 * Partner API v1 — Books 실스택 HTTP 스모크 (Stage 3 W1+W2 통합 검증).
 *
 * @PartnerV1Controller('books') 가 v1 표준 스택(PartnerApiKeyGuard→RateLimit→
 * 필터→감사/멱등/봉투)을 실제 HTTP(supertest)로 관통하는지 고정한다 —
 * book-specs.v1.http.spec 과 동일 레시피(DB 없음: repo·SitesService·FilesService 스텁).
 *
 * 커버리지:
 *  ① 무키 → 401 에러 봉투(6필드) — @PartnerV1Controller 승계
 *  ② POST → 201 성공 봉투 + DRAFT 생성(내부 id 비노출)
 *  ③ GET 목록 → 200 봉투 + pagination(§5.1) + 자기 site 스코프
 *  ④ GET 상세 테넌트 격리 — 타 site uid = 404 ERR_NOT_FOUND
 *  ⑤ 자산 POST 기존재 → 409 ERR_ASSET_ALREADY_EXISTS
 *  ⑥ 자산 PUT 미존재 → 404 ERR_ASSET_NOT_FOUND / PUT 교체 → 200(이력 보존)
 *  ⑦ 호환 매트릭스 위반(PDF_UPLOAD+photos) → 422 ERR_ASSET_INCOMPATIBLE
 *  ⑧ FINALIZED 게이트 → 409 ERR_BOOK_NOT_DRAFT
 *  ⑨ fileId 참조 검증 — 교차 테넌트 404 / 미확정 409 ERR_FILE_NOT_READY / ready 201
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { ErrV1 } from '@storige/types';
import { SitesService } from '../sites/sites.service';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { PartnerApiKeyGuard } from '../partner-api/guards/partner-api-key.guard';
import { PartnerRateLimitGuard } from '../partner-api/guards/partner-rate-limit.guard';
import { PartnerApiExceptionFilter } from '../partner-api/http/partner-api-exception.filter';
import { PartnerEnvelopeInterceptor } from '../partner-api/http/partner-envelope.interceptor';
import { PartnerAuditService } from '../partner-api/audit/partner-audit.service';
import { PartnerAuditInterceptor } from '../partner-api/audit/partner-audit.interceptor';
import { PublicApiAuditLog } from '../partner-api/entities/public-api-audit-log.entity';
import { PartnerIdempotencyKey } from '../partner-api/entities/partner-idempotency-key.entity';
import { PartnerApiKey } from '../partner-api/entities/partner-api-key.entity';
import { PartnerApiKeysService } from '../partner-api/keys/partner-api-keys.service';
import { PartnerIdempotencyService } from '../partner-api/idempotency/partner-idempotency.service';
import { PartnerIdempotencyInterceptor } from '../partner-api/idempotency/partner-idempotency.interceptor';
import { PARTNER_API_CONFIG } from '../partner-api/partner-api.constants';
import { FilesService } from '../files/files.service';
import { BooksController } from './books.controller';
import { BooksService } from './books.service';
import { Book } from './entities/book.entity';
import { BookAsset } from './entities/book-asset.entity';
import { BookSpec } from '../book-specs/entities/book-spec.entity';

const KEY_A = 'test-key-site-a';
const SITE_A = 'site-a';
const SITE_B = 'site-b';
const T0 = new Date('2026-01-01T00:00:00.000Z');

type BookRow = {
  id: string;
  uid: string;
  siteId: string;
  env: 'test' | 'live';
  creationType: string;
  bookSpecId: string | null;
  status: string;
  pageCount: number | null;
  title: string | null;
  editSessionId: string | null;
  partnerRef: string | null;
  finalizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const makeBook = (o: Partial<BookRow> = {}): BookRow => ({
  id: 'book-1',
  uid: 'bk_test0000000000000000000000000001',
  siteId: SITE_A,
  env: 'live',
  creationType: 'PDF_UPLOAD',
  bookSpecId: null,
  status: 'DRAFT',
  pageCount: null,
  title: null,
  editSessionId: null,
  partnerRef: null,
  finalizedAt: null,
  createdAt: T0,
  updatedAt: T0,
  ...o,
});

describe('Books v1 실스택 HTTP 스모크 (Stage 3 W1+W2)', () => {
  let app: INestApplication;

  // Book repo
  const bookCreate = jest.fn();
  const bookSave = jest.fn();
  const bookFindOne = jest.fn();
  const bookFindAndCount = jest.fn();
  // BookAsset repo
  const assetFindOne = jest.fn();
  const assetFind = jest.fn();
  const assetCreate = jest.fn();
  const assetSave = jest.fn();
  // BookSpec repo
  const specFindOne = jest.fn();
  const specFind = jest.fn();
  // FilesService
  const filesFindById = jest.fn();
  const filesUploadFile = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }])],
      controllers: [BooksController],
      providers: [
        BooksService,
        ApiKeyGuard,
        PartnerApiKeyGuard,
        PartnerRateLimitGuard,
        PartnerApiExceptionFilter,
        PartnerEnvelopeInterceptor,
        PartnerAuditService,
        PartnerAuditInterceptor,
        PartnerIdempotencyService,
        PartnerIdempotencyInterceptor,
        {
          provide: SitesService,
          useValue: {
            findByEditorAuthCode: jest.fn(async (code: string) =>
              code === KEY_A ? { id: SITE_A, name: 'Site A', retentionDays: null } : null,
            ),
            findByWorkerAuthCode: jest.fn(async () => null),
          },
        },
        {
          provide: getRepositoryToken(Book),
          useValue: {
            create: bookCreate,
            save: bookSave,
            findOne: bookFindOne,
            findAndCount: bookFindAndCount,
          },
        },
        {
          provide: getRepositoryToken(BookAsset),
          useValue: {
            findOne: assetFindOne,
            find: assetFind,
            create: assetCreate,
            save: assetSave,
          },
        },
        {
          provide: getRepositoryToken(BookSpec),
          useValue: { findOne: specFindOne, find: specFind },
        },
        {
          provide: FilesService,
          useValue: { findById: filesFindById, uploadFile: filesUploadFile },
        },
        {
          provide: getRepositoryToken(PublicApiAuditLog),
          useValue: { insert: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: getRepositoryToken(PartnerIdempotencyKey),
          useValue: { insert: jest.fn(), findOne: jest.fn(), update: jest.fn(), delete: jest.fn() },
        },
        PartnerApiKeysService,
        {
          provide: getRepositoryToken(PartnerApiKey),
          useValue: { findOne: jest.fn().mockResolvedValue(null), update: jest.fn() },
        },
        {
          provide: PARTNER_API_CONFIG,
          useValue: {
            rateLimit: { general: { limitPerMin: 300 }, heavy: { limitPerMin: 100 } },
            idempotencyTtlMs: 24 * 60 * 60 * 1000,
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // 안정 동작 기본값 — create 는 입력 그대로, save 는 id/타임스탬프 부여.
    bookCreate.mockImplementation((x: Partial<BookRow>) => x);
    bookSave.mockImplementation(async (x: Partial<BookRow>) => ({
      ...x,
      id: x.id ?? 'book-new',
      createdAt: x.createdAt ?? T0,
      updatedAt: x.updatedAt ?? T0,
    }));
    assetCreate.mockImplementation((x: Record<string, unknown>) => x);
    assetSave.mockImplementation(async (x: Record<string, unknown>) => ({
      ...x,
      id: (x.id as string) ?? 'asset-new',
      createdAt: T0,
      updatedAt: T0,
    }));
    specFind.mockResolvedValue([]);
    assetFind.mockResolvedValue([]);
  });

  // ── 승계·생성·조회 ──────────────────────────────────────────────────
  it('① 무키 — 401 ERR_UNAUTHORIZED 에러 봉투 6필드', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/books').expect(401);
    expect(Object.keys(res.body).sort()).toEqual(
      ['errorCode', 'errors', 'fieldErrors', 'message', 'requestId', 'success'].sort(),
    );
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe(ErrV1.ERR_UNAUTHORIZED);
    expect(res.body.requestId).toMatch(/^req_/);
  });

  it('② POST — 201 성공 봉투 + DRAFT 생성(내부 id 비노출)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/books')
      .set('X-API-Key', KEY_A)
      .send({ creationType: 'PDF_UPLOAD', title: '내 책' })
      .expect(201);

    expect(Object.keys(res.body).sort()).toEqual(
      ['data', 'message', 'pagination', 'success'].sort(),
    );
    expect(res.body.success).toBe(true);
    expect(res.body.pagination).toBeNull();
    expect(res.body.data.uid).toMatch(/^bk_/);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.creationType).toBe('PDF_UPLOAD');
    expect(res.body.data.env).toBe('live');
    expect(res.body.data.id).toBeUndefined(); // 내부 UUID 비노출
    expect(res.body.data.siteId).toBeUndefined();
    // 생성 payload 에 site 스탬프·DRAFT 확인
    const created = bookCreate.mock.calls[0][0];
    expect(created.siteId).toBe(SITE_A);
    expect(created.status).toBe('DRAFT');
  });

  it('② -a POST bookSpecUid 무효 — 404 ERR_BOOK_SPEC_NOT_FOUND', async () => {
    specFindOne.mockResolvedValue(null); // 없음/비활성/타 site
    const res = await request(app.getHttpServer())
      .post('/api/v1/books')
      .set('X-API-Key', KEY_A)
      .send({ creationType: 'PDF_UPLOAD', bookSpecUid: 'bs_nope' })
      .expect(404);
    expect(res.body.errorCode).toBe(ErrV1.ERR_BOOK_SPEC_NOT_FOUND);
  });

  it('② -b POST creationType 누락 — 400 ERR_VALIDATION_FAILED', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/books')
      .set('X-API-Key', KEY_A)
      .send({ title: 'x' })
      .expect(400);
    expect(res.body.errorCode).toBe(ErrV1.ERR_VALIDATION_FAILED);
  });

  it('③ GET 목록 — 200 봉투 + pagination(§5.1) + 자기 site 스코프', async () => {
    bookFindAndCount.mockResolvedValue([[makeBook()], 1]);
    const res = await request(app.getHttpServer())
      .get('/api/v1/books')
      .set('Authorization', `Bearer ${KEY_A}`) // AD-5 Bearer 동등 수용
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.pagination).toEqual({ total: 1, limit: 20, offset: 0, hasNext: false });
    expect(res.body.data[0].uid).toBe('bk_test0000000000000000000000000001');
    expect(res.body.data[0].id).toBeUndefined();
    // 자기 site+env 스코프가 쿼리에 반영됐는지
    const where = bookFindAndCount.mock.calls[0][0].where;
    expect(where.siteId).toBe(SITE_A);
    expect(where.env).toBe('live');
  });

  it('④ GET 상세 테넌트 격리 — 타 site 도서 uid = 404 ERR_NOT_FOUND', async () => {
    const otherBook = makeBook({ uid: 'bk_othersite', siteId: SITE_B });
    // 실제 스코프 시맨틱 재현: uid+siteId 동시 일치 시에만 반환
    bookFindOne.mockImplementation(async ({ where }: { where: { uid: string; siteId: string } }) =>
      where.uid === otherBook.uid && where.siteId === otherBook.siteId ? otherBook : null,
    );
    const res = await request(app.getHttpServer())
      .get('/api/v1/books/bk_othersite')
      .set('X-API-Key', KEY_A) // site-a 키로 site-b 도서 조회
      .expect(404);
    expect(res.body.errorCode).toBe(ErrV1.ERR_NOT_FOUND);
  });

  // ── 자산(W2) ────────────────────────────────────────────────────────
  it('⑤ 자산 POST 기존재 — 409 ERR_ASSET_ALREADY_EXISTS', async () => {
    bookFindOne.mockResolvedValue(makeBook()); // DRAFT PDF_UPLOAD
    assetFindOne.mockResolvedValue({ id: 'a1', assetType: 'pdf_cover', status: 'active' });
    const res = await request(app.getHttpServer())
      .post('/api/v1/books/bk_test/pdf-cover')
      .set('X-API-Key', KEY_A)
      .send({ fileId: 'file-1' })
      .expect(409);
    expect(res.body.errorCode).toBe(ErrV1.ERR_ASSET_ALREADY_EXISTS);
  });

  it('⑥ 자산 PUT 미존재 — 404 ERR_ASSET_NOT_FOUND', async () => {
    bookFindOne.mockResolvedValue(makeBook());
    assetFindOne.mockResolvedValue(null); // 교체 대상 없음
    const res = await request(app.getHttpServer())
      .put('/api/v1/books/bk_test/pdf-cover')
      .set('X-API-Key', KEY_A)
      .send({ fileId: 'file-1' })
      .expect(404);
    expect(res.body.errorCode).toBe(ErrV1.ERR_ASSET_NOT_FOUND);
  });

  it('⑥ -a 자산 PUT 교체 — 200 + 기존 replaced 전환(이력 보존)', async () => {
    bookFindOne.mockResolvedValue(makeBook());
    const existing = { id: 'a-old', bookId: 'book-1', assetType: 'pdf_cover', status: 'active' };
    assetFindOne.mockResolvedValue(existing);
    filesFindById.mockResolvedValue({ id: 'file-2', siteId: SITE_A, status: 'ready' });

    const res = await request(app.getHttpServer())
      .put('/api/v1/books/bk_test/pdf-cover')
      .set('X-API-Key', KEY_A)
      .send({ fileId: 'file-2' })
      .expect(200);

    expect(res.body.data.assetType).toBe('pdf_cover');
    expect(res.body.data.fileId).toBe('file-2');
    expect(res.body.data.status).toBe('active');
    // 기존 자산이 replaced 로 저장(이력 보존) + 신규 active 저장 = save 2회
    expect(assetSave).toHaveBeenCalledTimes(2);
    const replacedSaved = assetSave.mock.calls.find(
      (c) => (c[0] as { id?: string }).id === 'a-old',
    );
    expect((replacedSaved?.[0] as { status?: string }).status).toBe('replaced');
  });

  it('⑦ 호환 매트릭스 위반(PDF_UPLOAD + photos) — 422 ERR_ASSET_INCOMPATIBLE', async () => {
    bookFindOne.mockResolvedValue(makeBook({ creationType: 'PDF_UPLOAD' }));
    const res = await request(app.getHttpServer())
      .post('/api/v1/books/bk_test/photos')
      .set('X-API-Key', KEY_A)
      .send({ fileId: 'file-1' })
      .expect(422);
    expect(res.body.errorCode).toBe(ErrV1.ERR_ASSET_INCOMPATIBLE);
  });

  it('⑧ FINALIZED 게이트 — 자산 변경 시 409 ERR_BOOK_NOT_DRAFT', async () => {
    bookFindOne.mockResolvedValue(makeBook({ status: 'FINALIZED' }));
    const res = await request(app.getHttpServer())
      .post('/api/v1/books/bk_test/pdf-cover')
      .set('X-API-Key', KEY_A)
      .send({ fileId: 'file-1' })
      .expect(409);
    expect(res.body.errorCode).toBe(ErrV1.ERR_BOOK_NOT_DRAFT);
  });

  it('⑨ fileId 교차 테넌트 — 404 ERR_NOT_FOUND(존재 은닉)', async () => {
    bookFindOne.mockResolvedValue(makeBook());
    assetFindOne.mockResolvedValue(null);
    filesFindById.mockResolvedValue({ id: 'file-b', siteId: SITE_B, status: 'ready' });
    const res = await request(app.getHttpServer())
      .post('/api/v1/books/bk_test/pdf-cover')
      .set('X-API-Key', KEY_A)
      .send({ fileId: 'file-b' })
      .expect(404);
    expect(res.body.errorCode).toBe(ErrV1.ERR_NOT_FOUND);
  });

  it('⑨ -a fileId 미확정(pending) — 409 ERR_FILE_NOT_READY', async () => {
    bookFindOne.mockResolvedValue(makeBook());
    assetFindOne.mockResolvedValue(null);
    filesFindById.mockResolvedValue({ id: 'file-1', siteId: SITE_A, status: 'pending' });
    const res = await request(app.getHttpServer())
      .post('/api/v1/books/bk_test/pdf-cover')
      .set('X-API-Key', KEY_A)
      .send({ fileId: 'file-1' })
      .expect(409);
    expect(res.body.errorCode).toBe(ErrV1.ERR_FILE_NOT_READY);
  });

  it('⑨ -b fileId ready — 201 자산 생성(active)', async () => {
    bookFindOne.mockResolvedValue(makeBook());
    assetFindOne.mockResolvedValue(null);
    filesFindById.mockResolvedValue({ id: 'file-1', siteId: SITE_A, status: 'ready' });
    const res = await request(app.getHttpServer())
      .post('/api/v1/books/bk_test/pdf-cover')
      .set('X-API-Key', KEY_A)
      .send({ fileId: 'file-1' })
      .expect(201);
    expect(res.body.data.assetType).toBe('pdf_cover');
    expect(res.body.data.fileId).toBe('file-1');
    expect(res.body.data.status).toBe('active');
    // 기존 파일 상태 변경 없음(AD-1) — uploadFile 미호출(참조 경로)
    expect(filesUploadFile).not.toHaveBeenCalled();
  });

  it('⑨ -c 입력 없음(fileId·file 모두 없음) — 400 ERR_VALIDATION_FAILED', async () => {
    bookFindOne.mockResolvedValue(makeBook());
    assetFindOne.mockResolvedValue(null);
    const res = await request(app.getHttpServer())
      .post('/api/v1/books/bk_test/pdf-cover')
      .set('X-API-Key', KEY_A)
      .send({})
      .expect(400);
    expect(res.body.errorCode).toBe(ErrV1.ERR_VALIDATION_FAILED);
  });
});
