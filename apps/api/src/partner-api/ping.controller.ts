import { Get } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PartnerV1Controller } from './partner-v1.decorator';

/**
 * GET /api/v1/ping — v1 표준 스택 스모크 표면.
 *
 * 인증(🔑)·봉투·감사·레이트리밋이 전부 걸린 최소 라우트 — v1 무인증 라우트 0 원칙에
 * 따라 ping 도 파트너 키 필수. 파트너 온보딩 시 연결/키 확인 용도.
 */
@ApiTags('partner-v1')
@ApiSecurity('api-key')
@PartnerV1Controller()
export class PartnerPingController {
  @Get('ping')
  @ApiOperation({ summary: 'v1 연결/인증 확인 (파트너 키 필수)' })
  ping(): { pong: true; serverTime: string } {
    return { pong: true, serverTime: new Date().toISOString() };
  }
}
