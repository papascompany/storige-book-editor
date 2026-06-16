import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PdfValidatorService } from '../services/pdf-validator.service';
import { ValidationOptions, ValidationResultDto } from '../dto/validation-result.dto';
import { JobStatusService } from '../services/job-status.service';
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
    /**
     * 사방(per-edge) 블리드 mm — 상품별 설정값.
     * P1: 수신만(optional), 사용은 P4에서.
     */
    bleedMm?: number;
    /**
     * 재단선 마커 표기 ON/OFF 토글(블리드와 별개 명시 스위치).
     * P1: 수신만(optional), 사용은 P4에서.
     */
    cropMarkEnabled?: boolean;
    /**
     * 고객 업로드 PDF 사이즈 검증 허용오차(mm).
     * P1: 수신만(optional), 사용은 P4에서.
     */
    sizeToleranceMm?: number;
    /** 재단(완성) 사이즈(mm). P1: 수신만(optional). */
    trimSize?: { width: number; height: number };
    /** 작업 사이즈(재단 + bleedMm*2, mm). P1: 수신만(optional). */
    workSize?: { width: number; height: number };
    /**
     * 주문 의도 페이지 방향 (R3). 수신만(optional) — 사용은 validate() 의
     * validatePageOrientation 에서. 미제공/'auto' 면 혼재 시에만 집계 경고.
     */
    expectedOrientation?: 'portrait' | 'landscape' | 'auto';
  };
}

@Processor('pdf-validation')
export class ValidationProcessor {
  private readonly logger = new Logger(ValidationProcessor.name);
  // WK-4 — 상태 업데이트 재시도 공유 서비스 (생성자 주입 대신 직접 생성:
  //   기존 스펙들이 생성자 시그니처를 고정하고 있어 DI 파라미터 추가 불가)
  private readonly jobStatusService = new JobStatusService();

  constructor(private readonly validatorService: PdfValidatorService) {}

  // 검증 동시성: 기본 1이라 cover+content 등 다건 검증이 순차 처리되어 느렸음.
  // env VALIDATION_CONCURRENCY 로 조정(기본 3).
  // ⚠️ 주석 정정 (WK-5, 2026-06-13): 종전 주석은 "Ghostscript 는 별도 GS_CONCURRENCY 로
  //   보호된다"고 했으나 당시 그런 가드는 존재하지 않았다(허위). 현재는
  //   utils/ghostscript.ts 의 모듈 레벨 카운팅 세마포어(gsSemaphore, env GS_CONCURRENCY,
  //   기본 2)가 GS spawn 동시 수를 실제로 제한한다.
  // 파일당 PDF 메모리 상한(100MB)을 고려해도 3~4는 안전.
  @Process({
    name: 'validate-pdf',
    concurrency: Math.max(1, Number(process.env.VALIDATION_CONCURRENCY) || 3),
  })
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
   * API를 통해 Job 상태 업데이트.
   *
   * WK-4: 무재시도 axios.patch → 공유 JobStatusService(재시도 5회·최대 30s 백오프,
   * 최종 실패 시 Sentry capture)로 대체. 최종 실패해도 throw 하지 않는 기존
   * 동작(검증 결과 반환은 보존)은 유지된다.
   */
  private async updateJobStatus(
    jobId: string,
    status: string,
    result?: any,
    errorMessage?: string,
  ): Promise<void> {
    await this.jobStatusService.updateJobStatusWithRetry(
      jobId,
      { status, result, errorMessage },
      { jobType: 'validate', queueName: 'pdf-validation' },
    );
  }
}
