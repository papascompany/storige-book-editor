import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import * as client from 'prom-client';

/**
 * Prometheus 메트릭 수집 서비스 (P2-8 옵션 C 하이브리드)
 *
 * - Node.js 기본 메트릭 (CPU, 메모리, GC, event loop) → prom-client default
 * - Bull 큐 메트릭 (waiting, active, completed, failed, delayed, backlog) → 30초마다 갱신
 * - Worker 잡 처리 카운터/히스토그램은 Sentry tracing이 이미 수집 중 (옵션 C 분담)
 */
@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);
  private readonly registry: client.Registry;
  private readonly queueGauges: Record<string, client.Gauge<string>>;
  private intervalHandle?: ReturnType<typeof setInterval>;

  // 30초 단위로 큐 상태 갱신 (Prometheus scrape interval 15초와 정렬, 1샘플 staleness 1분 이하)
  private readonly refreshIntervalMs = parseInt(
    process.env.METRICS_REFRESH_INTERVAL_MS || '30000',
    10,
  );

  constructor(
    @InjectQueue('pdf-validation') private validationQueue: Queue,
    @InjectQueue('pdf-conversion') private conversionQueue: Queue,
    @InjectQueue('pdf-synthesis') private synthesisQueue: Queue,
  ) {
    this.registry = new client.Registry();
    this.registry.setDefaultLabels({ app: 'storige-api' });
    client.collectDefaultMetrics({ register: this.registry });

    // 큐 상태 게이지 (label: queue, state)
    const stateGauge = new client.Gauge({
      name: 'storige_bull_queue_jobs',
      help: 'Number of Bull queue jobs by state',
      labelNames: ['queue', 'state'],
      registers: [this.registry],
    });

    const backlogGauge = new client.Gauge({
      name: 'storige_bull_queue_backlog',
      help: 'Backlog (waiting + active) per queue',
      labelNames: ['queue'],
      registers: [this.registry],
    });

    this.queueGauges = { state: stateGauge, backlog: backlogGauge };
  }

  onModuleInit(): void {
    // 즉시 1회 + interval 등록
    this.refresh().catch((e) =>
      this.logger.warn(`Initial metrics refresh failed: ${e.message}`),
    );
    this.intervalHandle = setInterval(
      () => this.refresh().catch((e) => this.logger.debug(e.message)),
      this.refreshIntervalMs,
    );
    this.logger.log(
      `Metrics service started — refresh interval ${this.refreshIntervalMs}ms`,
    );
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
  }

  /** Prometheus scrape 응답 본문 */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /** Prometheus content-type */
  getContentType(): string {
    return this.registry.contentType;
  }

  private async refresh(): Promise<void> {
    const queues: [string, Queue][] = [
      ['pdf-validation', this.validationQueue],
      ['pdf-conversion', this.conversionQueue],
      ['pdf-synthesis', this.synthesisQueue],
    ];

    for (const [name, queue] of queues) {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);
      const stateGauge = this.queueGauges.state;
      stateGauge.set({ queue: name, state: 'waiting' }, waiting);
      stateGauge.set({ queue: name, state: 'active' }, active);
      stateGauge.set({ queue: name, state: 'completed' }, completed);
      stateGauge.set({ queue: name, state: 'failed' }, failed);
      stateGauge.set({ queue: name, state: 'delayed' }, delayed);

      this.queueGauges.backlog.set({ queue: name }, waiting + active);
    }
  }
}
