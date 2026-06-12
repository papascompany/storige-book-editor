import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PdfPageRendererService } from '../services/pdf-page-renderer.service';
import { JobStatusService } from '../services/job-status.service';
import { captureJobException } from '../sentry/sentry.init';

interface RenderPagesJobData {
  jobId: string;
  /** 내지 PDF 경로/URL (API 가 fileId → filePath 로 해석) */
  fileUrl: string;
  /** 가이드 출처 PDF 파일 ID (불일치 감지용) */
  sourceFileId?: string;
  /** 알려진 페이지 수(있으면 우선) */
  pageCount?: number;
}

/**
 * 내지 PDF 표시전용 가이드 래스터화 프로세서 (2026-06-07).
 *
 * `pdf-conversion` 큐를 공유하되 'render-pdf-pages' 잡만 처리.
 * 표시전용 가이드라 우선순위가 낮고 N페이지 직렬 GS 호출이라 동시성 1 로 검증/변환을 방해하지 않음.
 */
@Processor('pdf-conversion')
export class RenderProcessor {
  private readonly logger = new Logger(RenderProcessor.name);
  // WK-4 — 상태 업데이트 재시도 공유 서비스 (DI 대신 직접 생성 — 기존 스펙 생성자 고정)
  private readonly jobStatusService = new JobStatusService();

  constructor(private readonly rendererService: PdfPageRendererService) {}

  @Process({ name: 'render-pdf-pages', concurrency: 1 })
  async handleRender(job: Job<RenderPagesJobData>) {
    this.logger.log(`Processing render-pages job ${job.data.jobId}`);

    try {
      await this.updateJobStatus(job.data.jobId, 'PROCESSING');

      const rendered = await this.rendererService.renderPages(
        job.data.fileUrl,
        job.data.jobId,
        job.data.pageCount,
      );

      const result = {
        sourceFileId: job.data.sourceFileId ?? null,
        resolution: rendered.resolution,
        pageImageUrls: rendered.pageImageUrls,
        pageCount: rendered.pageCount,
        sourcePageCount: rendered.sourcePageCount,
        truncated: rendered.truncated,
        // renderedAt 은 워커가 stamp (DB는 UTC) — 편집기 불일치 비교용
        renderedAt: new Date().toISOString(),
      };

      await this.updateJobStatus(job.data.jobId, 'COMPLETED', { result });
      this.logger.log(
        `Render-pages job ${job.data.jobId} completed: ${result.pageImageUrls.length} pages`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Render-pages job ${job.data.jobId} error: ${error.message}`,
        error.stack,
      );

      captureJobException(error, {
        jobId: job.data.jobId,
        jobType: 'render-pages',
        queueName: 'pdf-conversion',
        fileUrl: job.data.fileUrl,
      });

      await this.updateJobStatus(job.data.jobId, 'FAILED', null, error.message);
      throw error;
    }
  }

  /**
   * WK-4: 무재시도 axios.patch → 공유 JobStatusService(재시도 5회·최대 30s 백오프,
   * 최종 실패 시 Sentry capture)로 대체. 페이로드 wire 포맷은 기존 그대로 유지.
   */
  private async updateJobStatus(
    jobId: string,
    status: string,
    result?: any,
    errorMessage?: string,
  ): Promise<void> {
    const payload: any = { status };
    if (result) {
      payload.result = result.result || result;
    }
    if (errorMessage) {
      payload.errorMessage = errorMessage;
    }

    await this.jobStatusService.updateJobStatusWithRetry(jobId, payload, {
      jobType: 'render-pages',
      queueName: 'pdf-conversion',
    });
  }
}
