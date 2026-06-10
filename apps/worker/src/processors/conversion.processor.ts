import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PdfConverterService } from '../services/pdf-converter.service';
import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { captureJobException } from '../sentry/sentry.init';

interface ConversionJobData {
  jobId: string;
  fileUrl: string;
  convertOptions: {
    addPages: boolean;
    applyBleed: boolean;
    targetPages: number;
    bleed: number;
    /** 출력 크기 (mm) */
    targetSize?: { width: number; height: number };
    /**
     * 고객 업로드 PDF 사이즈 검증 허용오차(mm).
     * P1: 수신만(optional), 로직 미구현(P4).
     */
    sizeToleranceMm?: number;
    /** 편집(원본) 사이즈(mm). P1: 수신만(optional), 로직 미구현(P4). */
    editSize?: { width: number; height: number };
    /**
     * 변환 모드. P1: 인터페이스만, 로직 미구현(P4).
     * - passthrough: 원본 그대로
     * - innerfit: 내지 맞춤
     * - center: 중앙 배치
     */
    mode?: 'passthrough' | 'innerfit' | 'center';
  };
}

@Processor('pdf-conversion')
export class ConversionProcessor {
  private readonly logger = new Logger(ConversionProcessor.name);
  private readonly apiBaseUrl =
    process.env.API_BASE_URL || 'http://localhost:4000/api';
  private readonly storagePath =
    process.env.STORAGE_PATH || '/app/storage';
  private readonly convertedDir = 'converted';

  constructor(private readonly converterService: PdfConverterService) {}

  @Process('convert-pdf')
  async handleConversion(job: Job<ConversionJobData>) {
    this.logger.log(`Processing conversion job ${job.data.jobId}`);

    try {
      // Update job status to PROCESSING
      await this.updateJobStatus(job.data.jobId, 'PROCESSING');

      // Generate output path under STORAGE_PATH/converted/ (synthesis의 /outputs/ 패턴과 정렬)
      const outputDir = path.join(this.storagePath, this.convertedDir);
      await fs.mkdir(outputDir, { recursive: true });
      const outputFilename = `converted_${uuidv4()}.pdf`;
      const outputPath = path.join(outputDir, outputFilename);

      // Convert PDF (service는 /storage/converted/... 형식의 상대 URL 반환)
      const result = await this.converterService.convert(
        job.data.fileUrl,
        job.data.convertOptions,
        outputPath,
      );

      // Update job status to COMPLETED — top-level outputFileUrl과 result 내부 URL 모두 일관성 유지
      await this.updateJobStatus(job.data.jobId, 'COMPLETED', {
        outputFileUrl: result.outputFileUrl,
        result,
      });

      this.logger.log(`Conversion job ${job.data.jobId} completed successfully`);

      return result;
    } catch (error) {
      this.logger.error(
        `Conversion job ${job.data.jobId} error: ${error.message}`,
        error.stack,
      );

      // Sentry에 잡 컨텍스트와 함께 전송
      captureJobException(error, {
        jobId: job.data.jobId,
        jobType: 'convert',
        queueName: 'pdf-conversion',
        fileUrl: job.data.fileUrl,
      });

      // Update job status to FAILED
      await this.updateJobStatus(
        job.data.jobId,
        'FAILED',
        null,
        error.message,
      );

      throw error;
    }
  }

  /**
   * Update job status in API
   */
  private async updateJobStatus(
    jobId: string,
    status: string,
    result?: any,
    errorMessage?: string,
  ): Promise<void> {
    try {
      const payload: any = { status };

      if (result) {
        payload.result = result.result || result;
        if (result.outputFileUrl) {
          payload.outputFileUrl = result.outputFileUrl;
        }
      }

      if (errorMessage) {
        payload.errorMessage = errorMessage;
      }

      await axios.patch(
        `${this.apiBaseUrl}/worker-jobs/external/${jobId}/status`,
        payload,
        { headers: { 'X-API-Key': process.env.WORKER_API_KEY } },
      );
    } catch (error) {
      this.logger.error(
        `Failed to update job status: ${error.message}`,
        error.stack,
      );
    }
  }
}
