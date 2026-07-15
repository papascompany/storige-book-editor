/**
 * GET /api/frame-ancestors 계약 + 동작 spec (P-Stage2-3).
 *
 * 이 라우트는 GUARDED spec(guarded-routes.spec.ts — @Public+ApiKeyGuard 파트너
 * 표면 전용)에 등재하지 않는 대신, 여기서 시맨틱을 고정한다:
 *  - 경로 'frame-ancestors' + GET (편집기 Edge Middleware 가 하드코딩 소비)
 *  - @Public (전역 JwtAuthGuard 우회 — 제거 시 미들웨어 fetch 전면 401 → 동적 CSP 무력화)
 *  - ApiKeyGuard 없음 (공개 목록 — CSP 헤더로 어차피 공개되는 비민감 값)
 *  - Cache-Control: public, max-age=60 (엣지 캐시)
 *
 * 동작 spec 은 SitesService.getAllFrameAncestors() 경유:
 *  - 활성(active) 사이트만 조회하는 쿼리
 *  - allowed_origins 미등록 site 의 frame_ancestors 도 포함 (P-Stage2-3 함정 수정)
 *  - 중복 제거·falsy 제거
 *  - 60s policyCache (2회째 호출 DB 미조회) + invalidatePolicyCache 즉시 무효화
 */
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import {
  PATH_METADATA,
  METHOD_METADATA,
  GUARDS_METADATA,
  HEADERS_METADATA,
} from '@nestjs/common/constants';
import { Repository } from 'typeorm';
import { FrameAncestorsController } from './frame-ancestors.controller';
import { SitesService } from './sites.service';
import { Site } from './entities/site.entity';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';

function makeService(sites: Partial<Site>[]): {
  service: SitesService;
  find: jest.Mock;
} {
  const find = jest.fn().mockResolvedValue(sites as Site[]);
  const repo = { find } as unknown as Repository<Site>;
  return { service: new SitesService(repo), find };
}

describe('FrameAncestorsController — 계약 (경로·메서드·@Public·캐시 헤더)', () => {
  const handler = FrameAncestorsController.prototype.getFrameAncestors;

  it("@Controller('frame-ancestors') + @Get() — 편집기 미들웨어 소비 경로 고정", () => {
    expect(Reflect.getMetadata(PATH_METADATA, FrameAncestorsController)).toBe(
      'frame-ancestors',
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('/');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
  });

  it('@Public — 제거 시 전역 JwtAuthGuard 401 로 동적 CSP 무력화(회귀 즉시 red)', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
  });

  it('ApiKeyGuard 등 라우트 가드 없음 — 무인증 공개 목록 (의도된 시맨틱)', () => {
    const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
    expect(guards).toHaveLength(0);
  });

  it('Cache-Control: public, max-age=60 (엣지/중간 캐시)', () => {
    const headers: Array<{ name: string; value: string }> =
      Reflect.getMetadata(HEADERS_METADATA, handler) ?? [];
    expect(headers).toEqual(
      expect.arrayContaining([
        { name: 'Cache-Control', value: 'public, max-age=60' },
      ]),
    );
  });
});

describe('FrameAncestorsController — 응답 shape', () => {
  it('{ success: true, data: { frameAncestors: string[] } }', async () => {
    const { service } = makeService([
      { frameAncestors: ['https://partner-a.example.com'], allowedOrigins: [] },
    ]);
    const controller = new FrameAncestorsController(service);
    await expect(controller.getFrameAncestors()).resolves.toEqual({
      success: true,
      data: { frameAncestors: ['https://partner-a.example.com'] },
    });
  });
});

describe('SitesService.getAllFrameAncestors — 목록 합성·캐시', () => {
  it('활성(active) 사이트만 조회한다', async () => {
    const { service, find } = makeService([]);
    await service.getAllFrameAncestors();
    expect(find).toHaveBeenCalledWith({ where: { status: 'active' } });
  });

  it('allowed_origins 미등록 site 의 frame_ancestors 도 포함한다 (누락 함정 수정)', async () => {
    const { service } = makeService([
      // allowedOrigins 없음(null) — 기존 frameAncestorsByOrigin 경유 로직이면 누락되던 케이스
      { frameAncestors: ['https://only-ancestors.example.com'], allowedOrigins: null },
      {
        frameAncestors: ['https://both.example.com'],
        allowedOrigins: ['https://both.example.com'],
      },
    ]);
    const result = await service.getAllFrameAncestors();
    expect(result).toEqual(
      expect.arrayContaining([
        'https://only-ancestors.example.com',
        'https://both.example.com',
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it('사이트 간 중복·falsy 항목을 제거한다', async () => {
    const { service } = makeService([
      { frameAncestors: ['https://dup.example.com', ''], allowedOrigins: [] },
      { frameAncestors: ['https://dup.example.com'], allowedOrigins: [] },
      { frameAncestors: null, allowedOrigins: [] },
    ]);
    await expect(service.getAllFrameAncestors()).resolves.toEqual([
      'https://dup.example.com',
    ]);
  });

  it('60s policyCache — 두 번째 호출은 DB 를 다시 조회하지 않는다', async () => {
    const { service, find } = makeService([
      { frameAncestors: ['https://cached.example.com'], allowedOrigins: [] },
    ]);
    await service.getAllFrameAncestors();
    await service.getAllFrameAncestors();
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('invalidatePolicyCache() 후에는 즉시 재조회한다 (admin 수정 반영 경로)', async () => {
    const { service, find } = makeService([
      { frameAncestors: ['https://a.example.com'], allowedOrigins: [] },
    ]);
    await service.getAllFrameAncestors();
    service.invalidatePolicyCache();
    await service.getAllFrameAncestors();
    expect(find).toHaveBeenCalledTimes(2);
  });
});
