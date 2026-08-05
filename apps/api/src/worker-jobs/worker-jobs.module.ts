import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CUTOUT_QUEUE_NAME } from '@storige/types';
import { WorkerJobsController } from './worker-jobs.controller';
import { WorkerJobsService } from './worker-jobs.service';
import { WorkerJobsSweeperService } from './worker-jobs-sweeper.service';
import { TestJobOutputsRetentionService } from './test-job-outputs-retention.service';
import { CutoutOutputsRetentionService } from './cutout-outputs-retention.service';
import { WorkerJob } from './entities/worker-job.entity';
import { FilesModule } from '../files/files.module';
import { WebhookModule } from '../webhook/webhook.module';
import { TemplatesModule } from '../templates/templates.module';
// R-44(2026-07-21) — 표지 검증 잡 생성 시 서버 spine 재계산 주입(SpineService).
import { ProductsModule } from '../products/products.module';
import { EditSessionEntity } from '../edit-sessions/entities/edit-session.entity';
// [Stage 3 W3, #4] 최종화 콜백 역참조(BookFinalizationsService) — 순환 모듈 forwardRef.
import { BooksModule } from '../books/books.module';
// 컷아웃(배경제거) @Public 라우트의 테넌트 복원 — edit-sessions 게스트 라우트 선례.
import { OptionalShopJwtGuard } from '../auth/guards/optional-shop-jwt.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkerJob, EditSessionEntity]),
    BullModule.registerQueue(
      {
        name: 'pdf-validation',
      },
      {
        name: 'pdf-conversion',
      },
      {
        name: 'pdf-synthesis',
      },
      // 컷아웃(배경제거, 2026-08-05 S-P2A-B) — pdf-conversion 공유가 아니라 **별도 큐**다.
      // 추론 피크 메모리가 인쇄 파이프라인을 동반 실패시키지 않도록 격리한다(스파이크 §5-1).
      // 컨슈머는 워커의 rembg 사이드카 호출 프로세서(동시성 1).
      {
        name: CUTOUT_QUEUE_NAME,
      },
    ),
    FilesModule,
    WebhookModule,
    // fix-bleed(2026-07-13) — templateSet 권위 editSize 산출(TemplateSetsService).
    TemplatesModule,
    // R-44 — SpineService(표지 잡 spine 서버 재계산). 순환 없음(products 는 독립 모듈).
    ProductsModule,
    // [Stage 3 W3, #4] 최종화 콜백 역참조 — BookFinalizationsService 주입(순환 모듈 forwardRef).
    forwardRef(() => BooksModule),
    // 컷아웃 @Public 라우트의 siteId 스탬프 — OptionalShopJwtGuard 가 shop-session JWT
    // **서명을 검증**하는 데 사용. AuthModule 이 JwtModule 을 export 하지 않으므로 동일
    // JWT_SECRET 으로 자체 등록한다(edit-sessions.module 선례 그대로).
    // JWT_SECRET 미설정 시 verify 가 throw → 스탬프 없이 NULL(fail-closed).
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [WorkerJobsController],
  // WK-4 — 고아 잡 스위퍼 cron (ScheduleModule.forRoot() 는 app.module 기존재)
  // S2-5 — test env 잡 산출물 24h retention cron (매시 37분, 대상=options.isTest 잡 한정)
  providers: [
    WorkerJobsService,
    WorkerJobsSweeperService,
    TestJobOutputsRetentionService,
    // 컷아웃 산출물 보존기간 정리(무인증 write 경로라 정리 주체가 필수)
    CutoutOutputsRetentionService,
    // ⚠️ providers 등록 누락 시 route-scoped 가드 생성이 요청 시점에 실패한다
    //    (edit-sessions.module-wiring.spec 가 같은 함정을 고정하고 있음).
    OptionalShopJwtGuard,
  ],
  exports: [WorkerJobsService],
})
export class WorkerJobsModule {}
