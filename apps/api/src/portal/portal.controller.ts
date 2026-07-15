import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@storige/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PortalIssueTestKeyDto, UpdatePortalSiteDto } from './portal.dto';
import { PortalRequestUser, PortalService } from './portal.service';

/**
 * /api/portal/sites/:siteId — 파트너 포털 v0 SITE_ADMIN 셀프 표면
 * (S2-4, D-7a 보수 스코프: 계정은 운영자 초대(operators CRUD) 전제 — 가입 없음).
 *
 * 인가 3중 스택(전부 기존 재사용 — additive):
 *  ① JwtAuthGuard — admin 로그인 JWT (Bearer/httpOnly 쿠키)
 *  ② RolesGuard + @Roles(SITE_ADMIN, SITE_MANAGER) — 전역 ADMIN/MANAGER 는 이 표면
 *     밖(기존 /api/sites·/api/sites/:id/partner-keys 사용). SUPER_ADMIN 은 가드 무조건
 *     통과. **per-site 판정은 이 전역 역할이 아니라 ④ assertSiteAdmin 에 위임**한다 —
 *     "전역 SITE_MANAGER 로 생성 후 특정 site 에 SITE_ADMIN 배정" 된 계정도 통과시켜야
 *     하므로 RolesGuard 를 전역 role 로 좁히면(과거 @Roles(SITE_ADMIN) 단독) 그 계정이
 *     assertSiteAdmin 도달 전 전량 403 이 되는 UI↔API 불일치가 생긴다.
 *  ③ TenantGuard — :siteId 가 JWT siteRoles 멤버십에 포함되는지(크로스 테넌트 403)
 *  ④ (서비스) assertSiteAdmin — 해당 site 의 per-site 역할이 SITE_ADMIN 인지
 *     (site A=ADMIN, site B=MANAGER 혼합 배정의 역할 경계 — 순수 SITE_MANAGER 는 여기서 403)
 *
 * 응답 규약:
 *  - site 뷰는 인증코드 prefix 마스킹만 (원문 열람은 운영자 표면 전용)
 *  - test 키 발급 응답의 data.key 에만 원문 1회 노출(운영자 표면과 동일 규약)
 *  - live 키: 발급 403 / 목록·폐기 표면에서 비노출(운영자 승인 큐 전용)
 *
 * ⚠️ 'v1/' prefix 아님 — partner-v1-guarded.spec 의 v1 전수 스캔 대상 밖
 *    (파트너 키 인증이 아닌 admin JWT 표면이므로 의도된 분리).
 */
@ApiTags('Portal')
@ApiBearerAuth()
@Controller('portal/sites/:siteId')
@UseGuards(JwtAuthGuard, RolesGuard, TenantGuard)
@Roles(UserRole.SITE_ADMIN, UserRole.SITE_MANAGER)
export class PortalController {
  constructor(private readonly portalService: PortalService) {}

  @Get()
  @ApiOperation({ summary: '내 사이트 정보 (인증코드 prefix 마스킹)' })
  async getMySite(
    @CurrentUser() user: PortalRequestUser,
    @Param('siteId') siteId: string,
  ) {
    const site = await this.portalService.getMySite(user, siteId);
    return { success: true, data: site };
  }

  @Patch()
  @HttpCode(200)
  @ApiOperation({
    summary: '셀프 설정 변경 — allowedOrigins / uploadCallbackUrl(웹훅 URL)만',
  })
  async updateMySite(
    @CurrentUser() user: PortalRequestUser,
    @Param('siteId') siteId: string,
    @Body() dto: UpdatePortalSiteDto,
  ) {
    const site = await this.portalService.updateMySite(user, siteId, dto);
    return { success: true, data: site };
  }

  @Get('partner-keys')
  @ApiOperation({ summary: 'test 키 목록 (prefix 마스킹 — live 키 비노출)' })
  async listTestKeys(
    @CurrentUser() user: PortalRequestUser,
    @Param('siteId') siteId: string,
  ) {
    const items = await this.portalService.listTestKeys(user, siteId);
    return { success: true, data: { items, total: items.length } };
  }

  @Post('partner-keys')
  @ApiOperation({
    summary:
      "test 키 셀프 발급 (env='test' 강제 — live 시도 403, 원문은 이 응답 1회 노출)",
  })
  async issueTestKey(
    @CurrentUser() user: PortalRequestUser,
    @Param('siteId') siteId: string,
    @Body() dto: PortalIssueTestKeyDto,
  ) {
    const issued = await this.portalService.issueTestKey(user, siteId, dto);
    return {
      success: true,
      data: { key: issued.plaintextKey, apiKey: issued.apiKey },
    };
  }

  @Delete('partner-keys/:keyId')
  @HttpCode(200)
  @ApiOperation({ summary: 'test 키 즉시 폐기 (live 키는 이 표면에서 404)' })
  async revokeTestKey(
    @CurrentUser() user: PortalRequestUser,
    @Param('siteId') siteId: string,
    @Param('keyId') keyId: string,
  ) {
    const revoked = await this.portalService.revokeTestKey(user, siteId, keyId);
    return { success: true, data: revoked };
  }
}
