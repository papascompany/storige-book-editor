import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { HealthController } from './health.controller';
import { QueueMonitorService } from './queue-monitor.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'pdf-validation' },
      { name: 'pdf-conversion' },
      { name: 'pdf-synthesis' },
    ),
  ],
  controllers: [HealthController],
  providers: [QueueMonitorService],
  exports: [QueueMonitorService],
})
export class HealthModule {}
