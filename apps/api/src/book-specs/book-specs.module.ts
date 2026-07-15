import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookSpec } from './entities/book-spec.entity';
import { TemplateSet } from '../templates/entities/template-set.entity';
import { BookSpecsController } from './book-specs.controller';
import { BookSpecsService } from './book-specs.service';
import { ProductsModule } from '../products/products.module';
import { PartnerApiModule } from '../partner-api/partner-api.module';

/**
 * Partner API v1 — BookSpecs(판형 마스터) 모듈 (Stage 1-B, 2026-07-15).
 *
 * - SpineService 는 ProductsModule exports 재사용(중복 구현 금지).
 * - v1 표준 스택은 @PartnerV1Controller 조합 데코레이터 + PartnerApiModule
 *   import(가드/필터/인터셉터 의존 DI 해석)로 승계 — Stage 1 통합.
 * - ApiKeyGuard 의존 SitesService 는 SitesModule @Global 로 주입 가능.
 * - TemplateSet 은 sizeToleranceMm 계약값 우선 노출용 읽기 참조만.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([BookSpec, TemplateSet]),
    ProductsModule,
    PartnerApiModule,
  ],
  controllers: [BookSpecsController],
  providers: [BookSpecsService],
  exports: [BookSpecsService],
})
export class BookSpecsModule {}
