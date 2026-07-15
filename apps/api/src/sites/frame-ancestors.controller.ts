import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SitesService } from './sites.service';
import { Public } from '../auth/decorators/public.decorator';

/**
 * GET /api/frame-ancestors — 편집기 Edge Middleware 소비용 공개 조회 (P-Stage2-3).
 *
 * SitesService.getAllFrameAncestors() 의 재활성 소비자(기존 死코드).
 * 활성(active) 사이트들의 frame_ancestors origin 합집합을 반환하며,
 * 편집기(Vercel)의 Edge Middleware 가 /embed 응답의 CSP frame-ancestors 헤더를
 * 동적으로 합성할 때 호출한다.
 *
 * 인증 시맨틱 — @Public 단독(ApiKeyGuard 없음) 근거:
 *  - 반환값은 편집기 응답의 CSP 헤더로 어차피 전 세계에 공개되는 값(비민감 정보).
 *  - 소비자는 파트너가 아니라 우리 편집기 인프라(Edge Middleware) — X-API-Key 를
 *    엣지에 심으면 오히려 시크릿 표면만 늘어난다.
 *  - 읽기 전용·부수효과 없음. 전역 ThrottlerGuard(SEC-4)는 그대로 적용된다.
 *  - GUARDED spec(guarded-routes.spec.ts)은 "@Public + ApiKeyGuard(X-API-Key 파트너
 *    표면)" 계약 전용이므로 이 라우트는 등재하지 않는다 — 대신 전용 spec
 *    (frame-ancestors.controller.spec.ts)에서 경로·메서드·@Public 시맨틱을 고정한다.
 *  - v1 파트너 표면(FROZEN 17) 아님 — 응답 shape 은 additive 진화 허용.
 *
 * 캐싱: 서버 내부 60s(SitesService policyCache) + HTTP Cache-Control 60s
 * (엣지/중간 캐시용). admin 에서 사이트 수정 시 서버 캐시는 즉시 무효화되지만
 * HTTP 캐시 최대 60s + 미들웨어 캐시 최대 60s 지연은 허용 범위(추가 방향만 존재).
 */
@ApiTags('Sites')
@Controller('frame-ancestors')
export class FrameAncestorsController {
  constructor(private readonly sitesService: SitesService) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({
    summary: '활성 사이트 frame-ancestors origin 목록 (편집기 Edge Middleware 소비, 공개)',
  })
  async getFrameAncestors(): Promise<{
    success: true;
    data: { frameAncestors: string[] };
  }> {
    const frameAncestors = await this.sitesService.getAllFrameAncestors();
    return { success: true, data: { frameAncestors } };
  }
}
