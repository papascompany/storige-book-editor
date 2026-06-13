import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller';
import { QueueMonitorService } from './queue-monitor.service';
import { MetricsService } from './metrics.service';
import { FileEntity } from '../files/entities/file.entity';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'pdf-validation' },
      { name: 'pdf-conversion' },
      { name: 'pdf-synthesis' },
    ),
    TypeOrmModule.forFeature([FileEntity]), // 저장 용량/백엔드 메트릭용
  ],
  controllers: [HealthController],
  providers: [QueueMonitorService, MetricsService],
  exports: [QueueMonitorService, MetricsService],
})
export class HealthModule {}
