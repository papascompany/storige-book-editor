import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PdfConverterService } from '../services/pdf-converter.service';
import axios from 'axios';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

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
  };
}

@Processor('pdf-conversion')
export class ConversionProcessor {
  private readonly logger = new Logger(ConversionProcessor.name);
  private readonly apiBaseUrl =
    process.env.API_BASE_URL || 'http://localhost:4000/api';
  private readonly storagePath =
    process.env.STORAGE_PATH || '/app/storage/temp';

  constructor(private readonly converterService: PdfConverterService) {}

  @Process('convert-pdf')
  async handleConversion(job: Job<ConversionJobData>) {
    this.logger.log(`Processing conversion job ${job.data.jobId}`);

    try {
      // Update job status to PROCESSING
      await this.updateJobStatus(job.data.jobId, 'PROCESSING');

      // Generate output path
      const outputFilename = `converted_${uuidv4()}.pdf`;
      const outputPath = path.join(this.storagePath, outputFilename);

      // Convert PDF
      const result = await this.converterService.convert(
        job.data.fileUrl,
        job.data.convertOptions,
        outputPath,
      );

      // Update job status to COMPLETED
      await this.updateJobStatus(job.data.jobId, 'COMPLETED', {
        outputFileUrl: `/storage/temp/${outputFilename}`,
        result,
      });

      this.logger.log(`Conversion job ${job.data.jobId} completed successfully`);

      return result;
    } catch (error) {
      this.logger.error(
        `Conversion job ${job.data.jobId} error: ${error.message}`,
        error.stack,
      );

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
