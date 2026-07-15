import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@storige/types';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { SitesService } from '../../sites/sites.service';
import { PartnerApiKeysService } from './partner-api-keys.service';
import { IssuePartnerApiKeyDto } from './partner-api-keys.dto';

/**
 * /api/sites/:siteId/partner-keys — v1 파트너 키 운영자 표면 (Stage 2 작업 2).
 *
 * SitesController 와 동일한 전역 admin 가드(JwtAuthGuard+RolesGuard, ADMIN/MANAGER) —
 * 파트너 셀프서브 포털(SITE_ADMIN 표면)은 후속 배치. 외부/파트너 키로는 접근 불가.
 *
 * 응답 규약:
 *  - 발급/회전 응답의 data.key 에만 원문 1회 노출 — 이후 어떤 표면에서도 원문 재조회 불가.
 *  - 목록/폐기 응답은 keyPrefix 마스킹만.
 */
@ApiTags('Sites')
@ApiBearerAuth()
@Controller('sites/:siteId/partner-keys')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
export class PartnerApiKeysController {
  constructor(
    private readonly partnerApiKeysService: PartnerApiKeysService,
    private readonly sitesService: SitesService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'v1 파트너 키 발급 (원문은 이 응답에서만 1회 노출)',
  })
  async issue(
    @Param('siteId') siteId: string,
    @Body() dto: IssuePartnerApiKeyDto,
  ) {
    await this.sitesService.findOne(siteId); // 사이트 존재 검증 (404)
    const issued = await this.partnerApiKeysService.issue(
      siteId,
      dto.env,
      dto.name ?? null,
    );
    return {
      success: true,
      data: { key: issued.plaintextKey, apiKey: issued.apiKey },
    };
  }

  @Get()
  @ApiOperation({ summary: 'v1 파트너 키 목록 (prefix 마스킹)' })
  async list(@Param('siteId') siteId: string) {
    await this.sitesService.findOne(siteId);
    const items = await this.partnerApiKeysService.list(siteId);
    return { success: true, data: { items, total: items.length } };
  }

  @Post(':keyId/rotate')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'v1 파트너 키 오버랩 회전 (신 키 발급 + 구 키 72h 유예, 신 원문 1회 노출)',
  })
  async rotate(
    @Param('siteId') siteId: string,
    @Param('keyId') keyId: string,
  ) {
    const rotated = await this.partnerApiKeysService.rotate(siteId, keyId);
    return {
      success: true,
      data: {
        key: rotated.plaintextKey,
        apiKey: rotated.apiKey,
        rotatedFrom: rotated.rotatedFrom,
      },
    };
  }

  @Delete(':keyId')
  @HttpCode(200)
  @ApiOperation({ summary: 'v1 파트너 키 즉시 폐기 (유예 없음 — 유출 대응)' })
  async revoke(
    @Param('siteId') siteId: string,
    @Param('keyId') keyId: string,
  ) {
    const revoked = await this.partnerApiKeysService.revoke(siteId, keyId);
    return { success: true, data: revoked };
  }
}
