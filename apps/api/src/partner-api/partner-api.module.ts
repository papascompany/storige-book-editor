import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { PublicApiAuditLog } from './entities/public-api-audit-log.entity';
import { PartnerIdempotencyKey } from './entities/partner-idempotency-key.entity';
import { PartnerAuditService } from './audit/partner-audit.service';
import { PartnerAuditInterceptor } from './audit/partner-audit.interceptor';
import { PartnerIdempotencyService } from './idempotency/partner-idempotency.service';
import { PartnerIdempotencyInterceptor } from './idempotency/partner-idempotency.interceptor';
import { PartnerIdempotencySweeper } from './idempotency/partner-idempotency.sweeper';
import { PartnerApiExceptionFilter } from './http/partner-api-exception.filter';
import { PartnerEnvelopeInterceptor } from './http/partner-envelope.interceptor';
import { PartnerApiKeyGuard } from './guards/partner-api-key.guard';
import { PartnerRateLimitGuard } from './guards/partner-rate-limit.guard';
import { partnerApiConfigProvider } from './partner-api.config';
import { PartnerPingController } from './ping.controller';

/**
 * Partner API v1 — 신규 파사드 모듈 (설계서 AD-1).
 *
 * 표준 봉투·멱등성·페이지네이션·per-Key 레이트리밋·Bearer 병행 인증은
 * 이 모듈의 /api/v1/* 표면에만 실장한다. 기존 /external·동결 라우트 무접촉.
 *
 * - ApiKeyGuard 는 공용 파일 무수정으로 프로바이더 등록만 하여
 *   PartnerApiKeyGuard 가 위임 재사용한다(§7.1).
 * - SitesService 는 SitesModule 이 @Global 이라 별도 import 불필요.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PublicApiAuditLog, PartnerIdempotencyKey])],
  controllers: [PartnerPingController],
  providers: [
    partnerApiConfigProvider,
    ApiKeyGuard,
    PartnerApiKeyGuard,
    PartnerRateLimitGuard,
    PartnerApiExceptionFilter,
    PartnerEnvelopeInterceptor,
    PartnerAuditService,
    PartnerAuditInterceptor,
    PartnerIdempotencyService,
    PartnerIdempotencyInterceptor,
    PartnerIdempotencySweeper,
  ],
})
export class PartnerApiModule {}
