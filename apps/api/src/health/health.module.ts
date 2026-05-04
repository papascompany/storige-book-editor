import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { HealthController } from './health.controller';
import { QueueMonitorService } from './queue-monitor.service';
import { MetricsService } from './metrics.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'pdf-validation' },
      { name: 'pdf-conversion' },
      { name: 'pdf-synthesis' },
    ),
  ],
  controllers: [HealthController],
  providers: [QueueMonitorService, MetricsService],
  exports: [QueueMonitorService, MetricsService],
})
export class HealthModule {}
