import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { captureJobException } from '../sentry/sentry.init';

/**
 * WK-4 (2026-06-13) — 잡 상태 업데이트 공유 서비스.
 *
 * 배경: synthesis 프로세서만 updateJobStatusWithRetry(3회/최대 3s)를 갖고 있었고,
 * validation/conversion/render 는 무재시도 axios.patch(실패 시 로그만)였다.
 * API 가 일시적으로 응답하지 못하면(재배포/nginx 502 등) 잡 상태가 영원히
 * PENDING/PROCESSING 으로 남는 구멍 → 재시도 5회(최대 30s 백오프)로 통일하고,
 * 최종 실패는 Sentry 로 capture 한다.
 *
 * 사용: 각 프로세서가 직접 인스턴스화(new)해 사용한다 — 기존 프로세서 스펙들이
 * 생성자 시그니처(서비스 1개 주입)를 고정하고 있어 DI 파라미터 추가 시 깨지기
 * 때문. (env 의존만 있고 상태가 없으므로 인스턴스 분리 비용 없음)
 */

/** PATCH /worker-jobs/external/:id/status 페이로드 (UpdateJobStatusDto 와 동일 계약) */
export interface JobStatusPayload {
  status: string;
  result?: any;
  outputFileUrl?: string | null;
  outputFiles?: any[];
  queueJobId?: string | number;
  errorCode?: string;
  errorMessage?: string;
  errorDetail?: Record<string, any>;
}

/** Sentry capture 컨텍스트 (선택) */
export interface JobStatusContext {
  jobType?: string;
  queueName?: string;
}

@Injectable()
export class JobStatusService {
  private readonly logger = new Logger(JobStatusService.name);
  private readonly apiBaseUrl =
    process.env.API_BASE_URL || 'http://localhost:4000/api';
  // 생성 시점에 읽음 — 프로세서 생성자에서 인스턴스화되므로 기존
  // "환경변수에서 API 키" 동작(프로세서 재생성 시 재반영)과 동일.
  private readonly apiKey = process.env.WORKER_API_KEY || 'test-api-key';

  /** 재시도 백오프(ms) — 5회, 최대 30s */
  static readonly RETRY_DELAYS_MS = [250, 1_000, 3_000, 10_000, 30_000];

  /** 테스트에서 백오프를 단축할 수 있도록 주입 가능 */
  constructor(
    private readonly retryDelaysMs: number[] = JobStatusService.RETRY_DELAYS_MS,
  ) {}

  /**
   * 단일 시도 상태 업데이트. 실패 시 throw (재시도는 updateJobStatusWithRetry 에서).
   */
  async updateJobStatus(jobId: string, payload: JobStatusPayload): Promise<void> {
    await axios.patch(
      `${this.apiBaseUrl}/worker-jobs/external/${jobId}/status`,
      payload,
      {
        timeout: 10_000,
        headers: { 'X-API-Key': this.apiKey },
      },
    );
  }

  /**
   * 재시도 래퍼 — 5회 / 250ms→1s→3s→10s→30s 백오프.
   *
   * 최종 실패 시 throw 하지 않고 false 반환(기존 프로세서들의
   * "상태 업데이트 실패해도 잡 처리 결과는 보존" 동작 유지) + Sentry capture.
   */
  async updateJobStatusWithRetry(
    jobId: string,
    payload: JobStatusPayload,
    context: JobStatusContext = {},
  ): Promise<boolean> {
    const delays = this.retryDelaysMs;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        await this.updateJobStatus(jobId, payload);
        return true;
      } catch (error: any) {
        lastError = error;
        if (attempt < delays.length) {
          this.logger.warn(
            `updateJobStatus attempt ${attempt + 1} failed for jobId=${jobId} ` +
              `(status=${payload.status}), retrying in ${delays[attempt]}ms: ${error?.message}`,
          );
          await this.delay(delays[attempt]);
        }
      }
    }

    // 최종 실패 — 로그 + Sentry (DSN 미설정 시 capture 는 no-op)
    this.logger.error(
      `updateJobStatus FINAL FAILURE for jobId=${jobId} (status=${payload.status}): ${lastError?.message}`,
      { jobId, payload, error: lastError },
    );
    captureJobException(lastError, {
      jobId,
      jobType: context.jobType || 'status-update',
      queueName: context.queueName,
    });
    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
