import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookSpec } from './entities/book-spec.entity';
import { TemplateSet } from '../templates/entities/template-set.entity';
import { BookSpecsController } from './book-specs.controller';
import { BookSpecsService } from './book-specs.service';
import { ProductsModule } from '../products/products.module';

/**
 * Partner API v1 — BookSpecs(판형 마스터) 모듈 (Stage 1-B, 2026-07-15).
 *
 * - SpineService 는 ProductsModule exports 재사용(중복 구현 금지).
 * - ApiKeyGuard 의존 SitesService 는 SitesModule @Global 로 주입 가능.
 * - TemplateSet 은 sizeToleranceMm 계약값 우선 노출용 읽기 참조만.
 * - 트랙 A partner-api 모듈(봉투 인터셉터·PartnerApiKeyGuard·멱등성)과
 *   디렉터리 분리 — 통합 시 이 모듈을 partner-api 하위로 이동 검토.
 */
@Module({
  imports: [TypeOrmModule.forFeature([BookSpec, TemplateSet]), ProductsModule],
  controllers: [BookSpecsController],
  providers: [BookSpecsService],
  exports: [BookSpecsService],
})
export class BookSpecsModule {}
