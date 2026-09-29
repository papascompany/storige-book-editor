import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Site } from './entities/site.entity';
import { SitesService } from './sites.service';
import { SitesController } from './sites.controller';
import { FrameAncestorsController } from './frame-ancestors.controller';
// 편집데이터 보관기간 변경 감사(2026-09-29) — edit-sessions.module 과 같은 방식으로 자체 등록(무상태, AuthModule 미import).
import { PartnerOperatorAuditLogEntity } from '../auth/entities/partner-operator-audit-log.entity';
import { PartnerOperatorAuditWriter } from '../auth/partner-operator/partner-operator-audit.writer';

/**
 * @Global — ApiKeyGuard가 SitesService를 의존하고, 여러 feature module이
 * ApiKeyGuard를 사용하므로 모든 모듈 scope에서 SitesService 주입 가능하게 함.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Site, PartnerOperatorAuditLogEntity])],
  controllers: [SitesController, FrameAncestorsController],
  providers: [SitesService, PartnerOperatorAuditWriter],
  exports: [SitesService],
})
export class SitesModule {}
