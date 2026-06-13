import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Queue } from 'bull';
import * as client from 'prom-client';
import { FileEntity } from '../files/entities/file.entity';

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
  private readonly storageBytesGauge: client.Gauge<string>;
  private readonly storageFilesGauge: client.Gauge<string>;
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
    @InjectRepository(FileEntity) private fileRepository: Repository<FileEntity>,
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

    // 저장 용량 메트릭 (R2 보강 — 비용/용량 모니터링). label: backend(local|s3)
    this.storageBytesGauge = new client.Gauge({
      name: 'storige_storage_bytes',
      help: 'Total stored file bytes by storage backend (files table, not soft-deleted)',
      labelNames: ['backend'],
      registers: [this.registry],
    });
    this.storageFilesGauge = new client.Gauge({
      name: 'storige_storage_files',
      help: 'Total file count by storage backend',
      labelNames: ['backend'],
      registers: [this.registry],
    });
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

    // 저장 용량 by backend (소프트삭제 제외). 실패해도 큐 메트릭은 유지.
    try {
      const rows: Array<{ backend: string; bytes: string | null; cnt: string }> =
        await this.fileRepository
          .createQueryBuilder('f')
          .select('f.storage_backend', 'backend')
          .addSelect('SUM(f.file_size)', 'bytes')
          .addSelect('COUNT(*)', 'cnt')
          .where('f.deleted_at IS NULL')
          .groupBy('f.storage_backend')
          .getRawMany();
      // 보고 없는 backend 는 0 으로 리셋(라벨 stale 방지)
      this.storageBytesGauge.set({ backend: 'local' }, 0);
      this.storageBytesGauge.set({ backend: 's3' }, 0);
      this.storageFilesGauge.set({ backend: 'local' }, 0);
      this.storageFilesGauge.set({ backend: 's3' }, 0);
      for (const r of rows) {
        const backend = r.backend === 's3' ? 's3' : 'local';
        this.storageBytesGauge.set({ backend }, Number(r.bytes ?? 0));
        this.storageFilesGauge.set({ backend }, Number(r.cnt ?? 0));
      }
    } catch (e) {
      this.logger.debug(`storage metric refresh failed: ${(e as Error).message}`);
    }
  }
}
