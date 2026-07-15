import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Site } from './entities/site.entity';
import { SitesService } from './sites.service';
import { SitesController } from './sites.controller';
import { FrameAncestorsController } from './frame-ancestors.controller';

/**
 * @Global — ApiKeyGuard가 SitesService를 의존하고, 여러 feature module이
 * ApiKeyGuard를 사용하므로 모든 모듈 scope에서 SitesService 주입 가능하게 함.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Site])],
  controllers: [SitesController, FrameAncestorsController],
  providers: [SitesService],
  exports: [SitesService],
})
export class SitesModule {}
