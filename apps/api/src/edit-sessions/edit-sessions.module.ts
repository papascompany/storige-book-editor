import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EditSessionsController } from './edit-sessions.controller';
import { EditSessionsService } from './edit-sessions.service';
import { PartnerEditSessionsController } from './partner-edit-sessions.controller';
import { PartnerEditSessionOwnersService } from './partner-edit-session-owners.service';
import { EditSessionEntity } from './entities/edit-session.entity';
import { EditSessionVersionEntity } from './entities/edit-session-version.entity';
import { WorkerJobsModule } from '../worker-jobs/worker-jobs.module';
import { TemplatesModule } from '../templates/templates.module';
import { OptionalShopJwtGuard } from '../auth/guards/optional-shop-jwt.guard';
import { FileEntity } from '../files/entities/file.entity';
import { PartnerOperatorAuditLogEntity } from '../auth/entities/partner-operator-audit-log.entity';
import { PartnerOperatorAuditWriter } from '../auth/partner-operator/partner-operator-audit.writer';

@Module({
  imports: [
    // 운영자 대리 편집(2026-09-29): FileEntity(운영자 파일 참조 검사)·감사 기록 엔티티.
    TypeOrmModule.forFeature([
      EditSessionEntity,
      EditSessionVersionEntity,
      FileEntity,
      PartnerOperatorAuditLogEntity,
    ]),
    forwardRef(() => WorkerJobsModule),
    // B49: 완료 시 metadata.spread 스펙을 템플릿 권위(spreadConfig.spec)와 대조하기 위해 TemplateSetsService 사용
    TemplatesModule,
    // 게스트 세션 siteId 스탬프(2026-07-30) — OptionalShopJwtGuard 가 shop-session JWT
    // **서명을 검증**하는 데 사용. AuthModule 이 JwtModule 을 export 하지 않으므로 동일
    // JWT_SECRET 으로 자체 등록한다(검증 결과는 전역 JwtStrategy 와 동일).
    // JWT_SECRET 미설정 시 verify 가 throw → 스탬프 없이 NULL(fail-closed).
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  // 파트너 서버 간 세션 소유자 배치 조회(ADDITIVE 2026-09-30) — /partner/edit-sessions/owners
  controllers: [EditSessionsController, PartnerEditSessionsController],
  // PartnerOperatorAuditWriter: AuthModule 을 import 하지 않으므로(순환 방지) 자체 등록한다(무상태).
  providers: [
    EditSessionsService,
    OptionalShopJwtGuard,
    PartnerOperatorAuditWriter,
    PartnerEditSessionOwnersService,
  ],
  exports: [EditSessionsService],
})
export class EditSessionsModule {}
