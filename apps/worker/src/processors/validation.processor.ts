import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PdfValidatorService } from '../services/pdf-validator.service';
import { ValidationOptions, ValidationResultDto } from '../dto/validation-result.dto';
import axios from 'axios';
import { captureJobException } from '../sentry/sentry.init';

interface ValidationJobData {
  jobId: string;
  /** 파일 URL 또는 경로 */
  fileUrl: string;
  /** 파일 ID (옵션, 새 시스템) */
  fileId?: string;
  /** 파일 타입 */
  fileType: 'cover' | 'content';
  /** 주문 옵션 */
  orderOptions: {
    size: { width: number; height: number };
    pages: number;
    binding: 'perfect' | 'saddle' | 'spring';
    bleed: number;
    paperThickness?: number;
    /** 책등 폭(mm) — 프런트 계산 권위 값(있으면 우선 사용) */
    spineWidthMm?: number;
    /** 날개 사용 여부 */
    wingEnabled?: boolean;
    /** 날개 한쪽 폭(mm) */
    wingWidthMm?: number;
  };
}

@Processor('pdf-validation')
export class ValidationProcessor {
  private readonly logger = new Logger(ValidationProcessor.name);
  private readonly apiBaseUrl =
    process.env.API_BASE_URL || 'http://localhost:4000/api';
  private readonly apiKey = process.env.WORKER_API_KEY || 'test-api-key';

  constructor(private readonly validatorService: PdfValidatorService) {}

  @Process('validate-pdf')
  async handleValidation(job: Job<ValidationJobData>): Promise<ValidationResultDto> {
    this.logger.log(`Processing validation job ${job.data.jobId}`);

    try {
      // Update job status to PROCESSING
      await this.updateJobStatus(job.data.jobId, 'PROCESSING');

      // 검증 옵션 구성
      const validationOptions: ValidationOptions = {
        fileType: job.data.fileType,
        orderOptions: job.data.orderOptions,
      };

      // PDF 검증 실행
      const result = await this.validatorService.validate(
        job.data.fileUrl,
        validationOptions,
      );

      // 결과에 따라 상태 업데이트
      if (result.isValid) {
        await this.updateJobStatus(job.data.jobId, 'COMPLETED', {
          result,
        });
        this.logger.log(`Validation job ${job.data.jobId} completed successfully`);
      } else {
        // 에러가 있지만 모두 자동 수정 가능한 경우
        const allErrorsFixable = result.errors.every(e => e.autoFixable);
        const status = allErrorsFixable ? 'FIXABLE' : 'FAILED';

        await this.updateJobStatus(
          job.data.jobId,
          status,
          { result },
          this.formatErrorMessage(result),
        );
        this.logger.warn(
          `Validation job ${job.data.jobId} ${status}: ${result.errors.length} errors, ${result.warnings.length} warnings`,
        );
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Validation job ${job.data.jobId} error: ${error.message}`,
        error.stack,
      );

      // Sentry에 잡 컨텍스트와 함께 전송
      captureJobException(error, {
        jobId: job.data.jobId,
        jobType: 'validate',
        queueName: 'pdf-validation',
        fileUrl: job.data.fileUrl,
        fileType: job.data.fileType,
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
   * 에러 메시지 포맷
   */
  private formatErrorMessage(result: ValidationResultDto): string {
    if (result.errors.length === 0) {
      return '';
    }

    const errorMessages = result.errors.map(e => e.message);
    return errorMessages.join('; ');
  }

  /**
   * API를 통해 Job 상태 업데이트
   */
  private async updateJobStatus(
    jobId: string,
    status: string,
    result?: any,
    errorMessage?: string,
  ): Promise<void> {
    try {
      await axios.patch(
        `${this.apiBaseUrl}/worker-jobs/external/${jobId}/status`,
        {
          status,
          result,
          errorMessage,
        },
        {
          timeout: 10000, // 10초 타임아웃
          headers: {
            'X-API-Key': this.apiKey,
          },
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to update job status: ${error.message}`,
        error.stack,
      );
    }
  }
}
