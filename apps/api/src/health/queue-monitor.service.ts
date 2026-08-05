/**
 * Bull 큐 적체 / 실패 감시 서비스
 *
 * 정책:
 *  - 매 1분마다 등록된 큐(pdf-validation/conversion/synthesis + image-cutout)의 상태를 체크
 *  - waiting + active 가 임계치 초과 → 적체 알람 (Sentry warning + 콘솔)
 *  - failed 누적 카운트가 직전 체크 대비 증가 → 실패 알람 (Sentry error)
 *  - 1번 알람 후 쿨다운 5분 (스팸 방지)
 *
 * 환경변수:
 *  - QUEUE_MONITOR_ENABLED — 'false'면 비활성화 (기본: true)
 *  - QUEUE_MONITOR_BACKLOG_THRESHOLD — 적체 임계치 (기본: 10)
 *  - QUEUE_MONITOR_INTERVAL_MS — 체크 주기 ms (기본: 60000)
 *  - QUEUE_MONITOR_COOLDOWN_MS — 쿨다운 ms (기본: 300000 = 5분)
 */
import { Injectable, Logger, Optional, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import * as Sentry from '@sentry/node';
import { CUTOUT_QUEUE_NAME } from '@storige/types';

export interface QueueState {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export interface DashboardSnapshot {
  queues: Record<string, QueueState & { backlog: number; status: 'ok' | 'warning' | 'critical' }>;
  thresholds: {
    backlog: number;
    intervalMs: number;
    cooldownMs: number;
  };
  timestamp: string;
}

interface MonitorState {
  prevFailed: number;
  lastBacklogAlertAt: number;
  lastFailedAlertAt: number;
}

@Injectable()
export class QueueMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueMonitorService.name);
  private intervalHandle?: ReturnType<typeof setInterval>;

  private readonly enabled = process.env.QUEUE_MONITOR_ENABLED !== 'false';
  private readonly backlogThreshold = parseInt(
    process.env.QUEUE_MONITOR_BACKLOG_THRESHOLD || '10',
    10,
  );
  private readonly intervalMs = parseInt(
    process.env.QUEUE_MONITOR_INTERVAL_MS || '60000',
    10,
  );
  private readonly cooldownMs = parseInt(
    process.env.QUEUE_MONITOR_COOLDOWN_MS || '300000',
    10,
  );

  private readonly state: Record<string, MonitorState> = {
    'pdf-validation': { prevFailed: 0, lastBacklogAlertAt: 0, lastFailedAlertAt: 0 },
    'pdf-conversion': { prevFailed: 0, lastBacklogAlertAt: 0, lastFailedAlertAt: 0 },
    'pdf-synthesis': { prevFailed: 0, lastBacklogAlertAt: 0, lastFailedAlertAt: 0 },
    // 컷아웃(2026-08-05 S-P2A-B) — 큐 미주입이면 queueMap 이 순회하지 않아 no-op.
    [CUTOUT_QUEUE_NAME]: { prevFailed: 0, lastBacklogAlertAt: 0, lastFailedAlertAt: 0 },
  };

  constructor(
    @InjectQueue('pdf-validation') private validationQueue: Queue,
    @InjectQueue('pdf-conversion') private conversionQueue: Queue,
    @InjectQueue('pdf-synthesis') private synthesisQueue: Queue,
    // 컷아웃 큐. @Optional 인 이유는 health.controller 주석 참조 —
    // 미주입이면 적체/실패 알람 대상에서 image-cutout 만 빠진다.
    @Optional()
    @InjectQueue(CUTOUT_QUEUE_NAME)
    private readonly cutoutQueue?: Queue,
  ) {}

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('Queue monitor disabled (QUEUE_MONITOR_ENABLED=false)');
      return;
    }

    this.logger.log(
      `Queue monitor started — interval=${this.intervalMs}ms, backlogThreshold=${this.backlogThreshold}, cooldown=${this.cooldownMs}ms`,
    );
    // 관측 구멍의 침묵 마스킹 방지(metrics.service 와 동일 사유).
    if (!this.cutoutQueue) {
      this.logger.warn(
        `[cutout] ${CUTOUT_QUEUE_NAME} 큐 미주입 — HealthModule 의 BullModule.registerQueue 배선을 ` +
          '확인하세요. 컷아웃 큐의 적체/실패 알람이 동작하지 않습니다.',
      );
    }

    // 초기 1회는 prevFailed 베이스라인만 채움 (알람 안 보냄)
    this.bootstrap().catch((err) => this.logger.error('Bootstrap failed', err));

    this.intervalHandle = setInterval(() => {
      this.tick().catch((err) => this.logger.error('Tick failed', err));
    }, this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }
  }

  private async bootstrap(): Promise<void> {
    for (const [name, queue] of this.queueMap()) {
      const counts = await this.getCounts(queue);
      this.state[name].prevFailed = counts.failed;
    }
  }

  private async tick(): Promise<void> {
    const now = Date.now();

    for (const [name, queue] of this.queueMap()) {
      const counts = await this.getCounts(queue);
      const s = this.state[name];

      // 1. 적체 감지 (waiting + active)
      const backlog = counts.waiting + counts.active;
      if (backlog >= this.backlogThreshold) {
        if (now - s.lastBacklogAlertAt >= this.cooldownMs) {
          this.alertBacklog(name, counts);
          s.lastBacklogAlertAt = now;
        }
      }

      // 2. 실패 잡 증가 감지
      if (counts.failed > s.prevFailed) {
        const delta = counts.failed - s.prevFailed;
        if (now - s.lastFailedAlertAt >= this.cooldownMs) {
          this.alertNewFailures(name, delta, counts);
          s.lastFailedAlertAt = now;
        }
      }
      s.prevFailed = counts.failed;
    }
  }

  private alertBacklog(queueName: string, counts: QueueState): void {
    const msg = `[QueueAlert] ${queueName} backlog: waiting=${counts.waiting} active=${counts.active} (threshold=${this.backlogThreshold})`;
    this.logger.warn(msg);

    Sentry.withScope((scope) => {
      scope.setLevel('warning');
      scope.setTag('queue', queueName);
      scope.setTag('alert.type', 'backlog');
      scope.setContext('queue_state', counts as any);
      Sentry.captureMessage(msg);
    });
  }

  private alertNewFailures(queueName: string, delta: number, counts: QueueState): void {
    const msg = `[QueueAlert] ${queueName} +${delta} failed jobs (total failed=${counts.failed})`;
    this.logger.error(msg);

    Sentry.withScope((scope) => {
      scope.setLevel('error');
      scope.setTag('queue', queueName);
      scope.setTag('alert.type', 'failed');
      scope.setContext('queue_state', counts as any);
      Sentry.captureMessage(msg);
    });
  }

  private queueMap(): [string, Queue][] {
    return [
      ['pdf-validation', this.validationQueue],
      ['pdf-conversion', this.conversionQueue],
      ['pdf-synthesis', this.synthesisQueue],
      // 큐 미배선 시 순회 대상에서 제외(존재하지 않는 큐를 0 으로 보고하지 않는다).
      ...(this.cutoutQueue
        ? ([[CUTOUT_QUEUE_NAME, this.cutoutQueue]] as [string, Queue][])
        : []),
    ];
  }

  private async getCounts(queue: Queue): Promise<QueueState> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);
    return { waiting, active, completed, failed, delayed };
  }

  /**
   * Admin 대시보드용: 현재 모든 큐 상태와 임계치 정보 반환
   */
  async getDashboardSnapshot(): Promise<DashboardSnapshot> {
    const queues: DashboardSnapshot['queues'] = {} as any;

    for (const [name, queue] of this.queueMap()) {
      const counts = await this.getCounts(queue);
      const backlog = counts.waiting + counts.active;
      const status: 'ok' | 'warning' | 'critical' =
        backlog >= this.backlogThreshold ? 'critical'
        : backlog >= this.backlogThreshold / 2 ? 'warning'
        : 'ok';
      queues[name] = { ...counts, backlog, status };
    }

    return {
      queues,
      thresholds: {
        backlog: this.backlogThreshold,
        intervalMs: this.intervalMs,
        cooldownMs: this.cooldownMs,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
