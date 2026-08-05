import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller';
import { QueueMonitorService } from './queue-monitor.service';
import { MetricsService } from './metrics.service';
import { FileEntity } from '../files/entities/file.entity';
import { CUTOUT_QUEUE_NAME } from '@storige/types';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'pdf-validation' },
      { name: 'pdf-conversion' },
      { name: 'pdf-synthesis' },
      // 컷아웃(2026-08-05) — 이 등록이 없으면 health/metrics/queue-monitor 3곳의
      // @Optional @InjectQueue 가 전부 undefined 로 떨어져 관측이 통째로 죽는다.
      { name: CUTOUT_QUEUE_NAME },
    ),
    TypeOrmModule.forFeature([FileEntity]), // 저장 용량/백엔드 메트릭용
  ],
  controllers: [HealthController],
  providers: [QueueMonitorService, MetricsService],
  exports: [QueueMonitorService, MetricsService],
})
export class HealthModule {}
