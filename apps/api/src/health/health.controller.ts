import { Controller, Get, Header, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { QueueMonitorService } from './queue-monitor.service';
import { MetricsService } from './metrics.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectQueue('pdf-validation') private validationQueue: Queue,
    @InjectQueue('pdf-conversion') private conversionQueue: Queue,
    @InjectQueue('pdf-synthesis') private synthesisQueue: Queue,
    private readonly queueMonitor: QueueMonitorService,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * Prometheus scrape endpoint (P2-8)
   * 내부 docker network 의 prometheus 컨테이너에서만 접근.
   * nginx 외부 노출 X — `/api/metrics` 경로는 운영 nginx 에서 deny 또는 IP 화이트리스트 권장.
   */
  @Public()
  @Get('metrics')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Prometheus metrics (text/plain)' })
  async metrics(@Res() res: Response): Promise<void> {
    res.set('Content-Type', this.metricsService.getContentType());
    res.send(await this.metricsService.getMetrics());
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({
    status: 200,
    description: 'Service is healthy',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        timestamp: { type: 'string', example: '2025-01-15T10:30:00.000Z' },
        uptime: { type: 'number', example: 3600.5 },
        environment: { type: 'string', example: 'production' },
        version: { type: 'string', example: '1.0.0' },
        queues: {
          type: 'object',
          properties: {
            validation: { type: 'object' },
            conversion: { type: 'object' },
            synthesis: { type: 'object' },
          },
        },
      },
    },
  })
  async check() {
    const [validationCounts, conversionCounts, synthesisCounts] =
      await Promise.all([
        this.getQueueCounts(this.validationQueue),
        this.getQueueCounts(this.conversionQueue),
        this.getQueueCounts(this.synthesisQueue),
      ]);

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0',
      queues: {
        validation: validationCounts,
        conversion: conversionCounts,
        synthesis: synthesisCounts,
      },
    };
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness check endpoint' })
  @ApiResponse({
    status: 200,
    description: 'Service is ready',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ready' },
      },
    },
  })
  async ready() {
    try {
      await this.validationQueue.client.ping();
      return { status: 'ready' };
    } catch {
      return { status: 'not_ready', error: 'Redis connection failed' };
    }
  }

  /**
   * Admin 대시보드용 큐 상태 스냅샷
   * (JWT 인증 필요 - 관리자만 접근)
   */
  @Get('queues')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: 큐 상태 + 임계치 스냅샷' })
  @ApiResponse({
    status: 200,
    description: '큐별 카운트 + status (ok/warning/critical) + 모니터 임계치',
  })
  @UseGuards(JwtAuthGuard)
  async queueDashboard() {
    return this.queueMonitor.getDashboardSnapshot();
  }

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness check endpoint' })
  @ApiResponse({
    status: 200,
    description: 'Service is alive',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'alive' },
      },
    },
  })
  live() {
    return {
      status: 'alive',
    };
  }

  private async getQueueCounts(queue: Queue) {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }
}
