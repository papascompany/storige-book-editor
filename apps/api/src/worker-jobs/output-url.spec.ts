/**
 * S4 2단계 — 합성 산출물 서명 URL 재발급 (2026-08-28, 오너 결정 D3·D4).
 *
 * 계약:
 *  - GET /worker-jobs/external/:id/output-url (X-API-Key) → nginx secure_link 형식의
 *    서명 URL 목록. 만료 시 재호출(재발급) — "URL 박제" 대신 jobId 저장이 정식.
 *  - 스탬프 잡: caller site 일치 필요(불일치 404 존재 은닉).
 *  - NULL 잡: allowlist env 미설정 = 유효 키 전부 허용(현행 read 표면과 동일 시맨틱,
 *    additive 무중단) / 설정 시 목록만.
 *  - separate 다중 산출물(result.outputFiles[]) 전부 서명.
 *  - 시크릿 미설정 → 503 fail-closed.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { createHash } from 'crypto';
import { WorkerJobsController } from './worker-jobs.controller';
import { WorkerJobsService } from './worker-jobs.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SitesService } from '../sites/sites.service';
import { signOutputUrl, SIGNED_OUTPUTS_PREFIX } from './output-url-signer';

const SECRET = 'output-sign-secret-for-spec-32bytes!';
const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const KEY_A = 'sk-storige-site-a-key';
const KEY_B = 'sk-storige-site-b-key';

describe('output-url-signer (순수)', () => {
  it('nginx secure_link_md5 공식과 일치하는 base64url 무패딩 해시를 만든다', () => {
    const r = signOutputUrl('/storage/outputs/j1/content.pdf', SECRET, 300, 1_000_000_000_000)!;
    const expires = Math.floor(1_000_000_000_000 / 1000) + 300;
    const uri = `${SIGNED_OUTPUTS_PREFIX}j1/content.pdf`;
    const expect64 = createHash('md5')
      .update(`${expires}${uri}${SECRET}`)
      .digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(r.url).toBe(`${uri}?md5=${expect64}&expires=${expires}`);
    expect(r.name).toBe('content.pdf');
  });

  it('outputs 프리픽스 밖 경로는 null (render-pages 등 비대상)', () => {
    expect(signOutputUrl('/storage/content-pdf-guides/x/1.png', SECRET, 300)).toBeNull();
  });

  it('경로 순회(..)·빈 세그먼트는 거부', () => {
    expect(signOutputUrl('/storage/outputs/../secrets.pdf', SECRET, 300)).toBeNull();
    expect(signOutputUrl('/storage/outputs//x.pdf', SECRET, 300)).toBeNull();
  });

  it('시크릿/만료/URI 가 다르면 해시도 다르다', () => {
    const a = signOutputUrl('/storage/outputs/j/a.pdf', SECRET, 300, 0)!;
    const b = signOutputUrl('/storage/outputs/j/a.pdf', SECRET + 'x', 300, 0)!;
    const c = signOutputUrl('/storage/outputs/j/a.pdf', SECRET, 301, 0)!;
    const d = signOutputUrl('/storage/outputs/j/b.pdf', SECRET, 300, 0)!;
    const md5 = (u: string) => new URLSearchParams(u.split('?')[1]).get('md5');
    expect(new Set([md5(a.url), md5(b.url), md5(c.url), md5(d.url)]).size).toBe(4);
  });
});

describe('GET /worker-jobs/external/:id/output-url — 인증 재발급 표면', () => {
  let app: INestApplication;
  const jobs = new Map<string, Record<string, any>>();
  const OLD_ENV = { ...process.env };

  const svcOverrides: Partial<Record<keyof WorkerJobsService, unknown>> = {};

  beforeAll(async () => {
    process.env.OUTPUT_SIGN_SECRET = SECRET;
    delete process.env.OUTPUT_URL_NULL_JOB_SITE_ALLOWLIST;

    // 실 서비스 대신: issueOutputUrls 실물 로직을 쓰기 위해 서비스 인스턴스를
    // repo-fake 로 구성하는 편이 정석이나, WorkerJobsService 생성자 의존이 방대하다.
    // 실물 메서드를 프로토타입에서 빌려 fake repo 에 바인딩한다(로직=실물, 의존=최소).
    const svc: any = {
      workerJobRepository: { findOne: async ({ where }: any) => jobs.get(where.id) ?? null },
    };
    svc.issueOutputUrls = WorkerJobsService.prototype.issueOutputUrls.bind(svc);
    Object.assign(svc, svcOverrides);

    const moduleRef = await Test.createTestingModule({
      // 컨트롤러의 형제 라우트(compose-mixed)가 OptionalShopJwtGuard(JwtService 의존)를
      // 쓰므로 모듈 해석에 JwtModule 이 필요하다(이 spec 은 그 라우트를 호출하지 않는다).
      imports: [JwtModule.register({ secret: 'spec-only-secret' })],
      controllers: [WorkerJobsController],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: WorkerJobsService, useValue: svc },
        {
          provide: SitesService,
          useValue: {
            findByEditorAuthCode: async (k: string) =>
              k === KEY_A ? { id: SITE_A, name: 'A' } : k === KEY_B ? { id: SITE_B, name: 'B' } : null,
            findByWorkerAuthCode: async () => null,
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    process.env = OLD_ENV;
    await app.close();
  });

  const seed = (over: Record<string, any> = {}) => {
    const j = {
      id: 'job-1',
      siteId: null,
      status: 'completed',
      outputFileUrl: '/storage/outputs/job-1/merged.pdf',
      result: null,
      ...over,
    };
    jobs.clear();
    jobs.set(j.id, j);
    return j;
  };

  const call = (id: string, key?: string) => {
    const r = request(app.getHttpServer()).get(`/worker-jobs/external/${id}/output-url`);
    return key ? r.set('X-API-Key', key) : r;
  };

  it('R1 스탬프 잡 + 소유 키 → 200 + 서명 URL(서명 검증 가능)', async () => {
    seed({ siteId: SITE_A });
    const res = await call('job-1', KEY_A).expect(200);
    expect(res.body.files).toHaveLength(1);
    const u = res.body.files[0].url as string;
    expect(u.startsWith(SIGNED_OUTPUTS_PREFIX)).toBe(true);
    // 서버가 만든 서명을 독립 재계산으로 검증(nginx 가 할 일과 동일)
    const [path, qs] = u.split('?');
    const p = new URLSearchParams(qs);
    const recomputed = createHash('md5')
      .update(`${p.get('expires')}${path}${SECRET}`)
      .digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(p.get('md5')).toBe(recomputed);
  });

  it('R2 IDOR: 스탬프 잡 + 타 site 키 → 404 (존재 은닉)', async () => {
    seed({ siteId: SITE_A });
    await call('job-1', KEY_B).expect(404);
  });

  it('R3 NULL 잡 + allowlist 미설정 → 유효 키 전부 200 (현행 시맨틱, 무중단)', async () => {
    seed({ siteId: null });
    await call('job-1', KEY_B).expect(200);
  });

  it('R4 NULL 잡 + allowlist 설정 → 목록 밖 키 404, 목록 키 200', async () => {
    process.env.OUTPUT_URL_NULL_JOB_SITE_ALLOWLIST = `${SITE_A}`;
    try {
      seed({ siteId: null });
      await call('job-1', KEY_B).expect(404);
      await call('job-1', KEY_A).expect(200);
    } finally {
      delete process.env.OUTPUT_URL_NULL_JOB_SITE_ALLOWLIST;
    }
  });

  it('R5 무인증(키 없음) → 401 (ApiKeyGuard)', async () => {
    seed();
    await call('job-1').expect(401);
  });

  it('R6 separate 다중 산출물 전부 서명(outputFileUrl + result.outputFiles, 중복 제거)', async () => {
    seed({
      outputFileUrl: '/storage/outputs/job-1/cover.pdf',
      result: {
        outputFiles: [
          { url: '/storage/outputs/job-1/cover.pdf' },
          { url: '/storage/outputs/job-1/content.pdf' },
        ],
      },
    });
    const res = await call('job-1', KEY_A).expect(200);
    const names = (res.body.files as Array<{ name: string }>).map((f) => f.name).sort();
    expect(names).toEqual(['content.pdf', 'cover.pdf']);
  });

  it('R7 산출물 없음(미완료) → 400 JOB_OUTPUT_NOT_READY', async () => {
    seed({ outputFileUrl: null, status: 'processing' });
    const res = await call('job-1', KEY_A).expect(400);
    expect(res.body.code ?? res.body.message?.code).toBeDefined();
  });

  it('R8 시크릿 미설정 → 503 fail-closed', async () => {
    const saved = process.env.OUTPUT_SIGN_SECRET;
    delete process.env.OUTPUT_SIGN_SECRET;
    try {
      seed();
      await call('job-1', KEY_A).expect(503);
    } finally {
      process.env.OUTPUT_SIGN_SECRET = saved;
    }
  });

  it('R9 잡 없음 → 404', async () => {
    jobs.clear();
    await call('nope', KEY_A).expect(404);
  });
});
