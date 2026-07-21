import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { WorkerJobsController } from './worker-jobs.controller';
import { WorkerJobsService } from './worker-jobs.service';
import { WorkerJobsSweeperService } from './worker-jobs-sweeper.service';
import { TestJobOutputsRetentionService } from './test-job-outputs-retention.service';
import { WorkerJob } from './entities/worker-job.entity';
import { FilesModule } from '../files/files.module';
import { WebhookModule } from '../webhook/webhook.module';
import { TemplatesModule } from '../templates/templates.module';
// R-44(2026-07-21) — 표지 검증 잡 생성 시 서버 spine 재계산 주입(SpineService).
import { ProductsModule } from '../products/products.module';
import { EditSessionEntity } from '../edit-sessions/entities/edit-session.entity';
// [Stage 3 W3, #4] 최종화 콜백 역참조(BookFinalizationsService) — 순환 모듈 forwardRef.
import { BooksModule } from '../books/books.module';

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
    ),
    FilesModule,
    WebhookModule,
    // fix-bleed(2026-07-13) — templateSet 권위 editSize 산출(TemplateSetsService).
    TemplatesModule,
    // R-44 — SpineService(표지 잡 spine 서버 재계산). 순환 없음(products 는 독립 모듈).
    ProductsModule,
    // [Stage 3 W3, #4] 최종화 콜백 역참조 — BookFinalizationsService 주입(순환 모듈 forwardRef).
    forwardRef(() => BooksModule),
  ],
  controllers: [WorkerJobsController],
  // WK-4 — 고아 잡 스위퍼 cron (ScheduleModule.forRoot() 는 app.module 기존재)
  // S2-5 — test env 잡 산출물 24h retention cron (매시 37분, 대상=options.isTest 잡 한정)
  providers: [
    WorkerJobsService,
    WorkerJobsSweeperService,
    TestJobOutputsRetentionService,
  ],
  exports: [WorkerJobsService],
})
export class WorkerJobsModule {}
