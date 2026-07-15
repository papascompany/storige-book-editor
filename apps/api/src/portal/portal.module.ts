import { Module } from '@nestjs/common';
import { PartnerApiModule } from '../partner-api/partner-api.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

/**
 * 파트너 포털 v0 모듈 (S2-4 — 로드맵 §6 Stage 2 작업 2, D-7a 보수 스코프).
 *
 * SITE_ADMIN 셀프서브 표면(/api/portal/sites/:siteId)만 담는 additive 모듈.
 * - SitesService: SitesModule 이 @Global 이라 import 불필요.
 * - PartnerApiKeysService: PartnerApiModule 이 export — test 키 셀프 발급 재사용.
 * - 웹훅 v2 config 셀프 관리는 v1 Partner API(파트너 키 인증)가 정본 — 여기 중복 금지.
 */
@Module({
  imports: [PartnerApiModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
