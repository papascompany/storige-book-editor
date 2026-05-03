import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Query,
  UseGuards,
  Res,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiSecurity } from '@nestjs/swagger';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { WorkerJobsService } from './worker-jobs.service';
import {
  CreateValidationJobDto,
  CreateConversionJobDto,
  CreateSynthesisJobDto,
  UpdateJobStatusDto,
} from './dto/worker-job.dto';
import { CreateSplitSynthesisJobDto } from './dto/create-split-synthesis-job.dto';
import { CheckMergeableDto, CheckMergeableResponseDto } from './dto/check-mergeable.dto';
import { WorkerJob } from './entities/worker-job.entity';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { Public } from '../auth/decorators/public.decorator';
import { UserRole, WorkerJobStatus, WorkerJobType } from '@storige/types';

@ApiTags('Worker Jobs')
@ApiBearerAuth()
@Controller('worker-jobs')
export class WorkerJobsController {
  constructor(private readonly workerJobsService: WorkerJobsService) {}

  // ============================================================================
  // Create Jobs (Queue Operations)
  // ============================================================================

  @Post('validate')
  @ApiOperation({ summary: 'Create a PDF validation job' })
  @ApiResponse({ status: 201, description: 'Validation job created and queued', type: WorkerJob })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  async createValidationJob(
    @Body() createValidationJobDto: CreateValidationJobDto,
  ): Promise<WorkerJob> {
    return await this.workerJobsService.createValidationJob(createValidationJobDto);
  }

  /**
   * 외부 연동용 검증 작업 생성 (API Key 인증)
   * bookmoa 등 외부 시스템에서 서버 간 통신으로 호출
   */
  @Post('validate/external')
  @Public()
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Create a PDF validation job (external API key auth)' })
  @ApiResponse({ status: 201, description: 'Validation job created and queued', type: WorkerJob })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Invalid API key' })
  async createValidationJobExternal(
    @Body() createValidationJobDto: CreateValidationJobDto,
  ): Promise<WorkerJob> {
    return await this.workerJobsService.createValidationJob(createValidationJobDto);
  }

  @Post('convert')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a PDF conversion job' })
  @ApiResponse({ status: 201, description: 'Conversion job created and queued', type: WorkerJob })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  async createConversionJob(
    @Body() createConversionJobDto: CreateConversionJobDto,
  ): Promise<WorkerJob> {
    return await this.workerJobsService.createConversionJob(createConversionJobDto);
  }

  @Post('synthesize')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a PDF synthesis job' })
  @ApiResponse({ status: 201, description: 'Synthesis job created and queued', type: WorkerJob })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  async createSynthesisJob(
    @Body() createSynthesisJobDto: CreateSynthesisJobDto,
  ): Promise<WorkerJob> {
    return await this.workerJobsService.createSynthesisJob(createSynthesisJobDto);
  }

  /**
   * 외부 연동용 병합 작업 생성 (API Key 인증)
   * 북모아 주문 시점에 호출
   */
  @Post('synthesize/external')
  @Public()
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Create a PDF synthesis job (external API key auth)' })
  @ApiResponse({ status: 201, description: 'Synthesis job created and queued', type: WorkerJob })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Invalid API key' })
  async createSynthesisJobExternal(
    @Body() createSynthesisJobDto: CreateSynthesisJobDto,
  ): Promise<WorkerJob> {
    return await this.workerJobsService.createSynthesisJob(createSynthesisJobDto);
  }

  // ============================================================================
  // Split Synthesis (단일 PDF 분리)
  // ============================================================================

  /**
   * 분리 합성 작업 생성 (★ v1.1.4 설계서)
   * 단일 PDF에서 표지/내지를 분리
   */
  @Post('split-synthesize')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a PDF split-synthesis job (split single PDF into cover/content)' })
  @ApiResponse({ status: 201, description: 'Split synthesis job created and queued', type: WorkerJob })
  @ApiResponse({ status: 400, description: 'Invalid input or option combination' })
  @ApiResponse({ status: 404, description: 'Session or file not found' })
  @ApiResponse({ status: 422, description: 'Invalid session data (empty pages, invalid sortOrder, etc.)' })
  async createSplitSynthesisJob(
    @Body() dto: CreateSplitSynthesisJobDto,
  ): Promise<WorkerJob> {
    return await this.workerJobsService.createSplitSynthesisJob(dto);
  }

  /**
   * 외부 연동용 분리 합성 작업 생성 (API Key 인증)
   */
  @Post('split-synthesize/external')
  @Public()
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Create a PDF split-synthesis job (external API key auth)' })
  @ApiResponse({ status: 201, description: 'Split synthesis job created and queued', type: WorkerJob })
  @ApiResponse({ status: 400, description: 'Invalid input or option combination' })
  @ApiResponse({ status: 401, description: 'Invalid API key' })
  @ApiResponse({ status: 404, description: 'Session or file not found' })
  @ApiResponse({ status: 422, description: 'Invalid session data' })
  async createSplitSynthesisJobExternal(
    @Body() dto: CreateSplitSynthesisJobDto,
  ): Promise<WorkerJob> {
    return await this.workerJobsService.createSplitSynthesisJob(dto);
  }

  // ============================================================================
  // Merge Check (Dry-run)
  // ============================================================================

  /**
   * 병합 가능 여부 체크 (에디터 저장 시 호출)
   */
  @Post('check-mergeable')
  @ApiOperation({ summary: 'Check if PDFs can be merged (dry-run)' })
  @ApiResponse({ status: 200, description: 'Merge check result', type: CheckMergeableResponseDto })
  async checkMergeable(
    @Body() checkMergeableDto: CheckMergeableDto,
  ): Promise<CheckMergeableResponseDto> {
    return await this.workerJobsService.checkMergeable(checkMergeableDto);
  }

  /**
   * 병합 가능 여부 체크 - 외부용 (API Key 인증)
   * 에디터 저장 시점에 호출하여 병합 가능 여부를 사전 확인
   */
  @Post('check-mergeable/external')
  @Public()
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Check if PDFs can be merged (external API key auth)' })
  @ApiResponse({ status: 200, description: 'Merge check result', type: CheckMergeableResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid API key' })
  async checkMergeableExternal(
    @Body() checkMergeableDto: CheckMergeableDto,
  ): Promise<CheckMergeableResponseDto> {
    return await this.workerJobsService.checkMergeable(checkMergeableDto);
  }

  // ============================================================================
  // Job Management
  // ============================================================================

  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get all worker jobs with optional filters' })
  @ApiQuery({ name: 'status', required: false, enum: WorkerJobStatus })
  @ApiQuery({ name: 'jobType', required: false, enum: WorkerJobType })
  @ApiResponse({ status: 200, description: 'List of worker jobs', type: [WorkerJob] })
  async findAll(
    @Query('status') status?: WorkerJobStatus,
    @Query('jobType') jobType?: WorkerJobType,
  ): Promise<WorkerJob[]> {
    return await this.workerJobsService.findAll(status, jobType);
  }

  @Get('stats')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get job statistics grouped by status and type' })
  @ApiResponse({ status: 200, description: 'Job statistics' })
  async getJobStats() {
    return await this.workerJobsService.getJobStats();
  }

  /**
   * 외부 연동용 작업 상태 조회 (API Key 인증)
   * bookmoa 등 외부 시스템에서 서버 간 통신으로 호출
   */
  @Get('external/:id')
  @Public()
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Get a worker job by ID (external API key auth)' })
  @ApiResponse({ status: 200, description: 'Worker job details', type: WorkerJob })
  @ApiResponse({ status: 404, description: 'Job not found' })
  @ApiResponse({ status: 401, description: 'Invalid API key' })
  async findOneExternal(@Param('id') id: string): Promise<WorkerJob> {
    return await this.workerJobsService.findOne(id);
  }

  /**
   * 워커 잡 결과 파일 다운로드
   * - 변환(convert) 잡: outputFileUrl로 저장된 수정 PDF
   * - 합성(synthesize) 잡: outputFileUrl로 저장된 합성 PDF
   * 호출 위치: Admin Before/After 미리보기에서 "수정된 PDF 다운로드"
   */
  @Get(':id/output')
  @ApiOperation({ summary: 'Download worker job output file (PDF)' })
  @ApiResponse({ status: 200, description: 'PDF file stream' })
  @ApiResponse({ status: 404, description: 'Job not found or no output file' })
  @ApiResponse({ status: 400, description: 'Job not completed or no output' })
  async downloadOutput(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const job = await this.workerJobsService.findOne(id);
    if (!job) {
      throw new NotFoundException({
        code: 'JOB_NOT_FOUND',
        message: `Worker job ${id} not found`,
      });
    }

    if (job.status !== WorkerJobStatus.COMPLETED && job.status !== WorkerJobStatus.FIXABLE) {
      throw new BadRequestException({
        code: 'JOB_NOT_COMPLETED',
        message: `Job status is ${job.status}, output not available`,
      });
    }

    // result에서 outputFileUrl 추출 — convert 잡: result.outputFileUrl, synthesize: result.outputFileUrl
    const result: any = job.result;
    const outputFileUrl: string | undefined =
      result?.outputFileUrl || result?.result?.outputFileUrl;

    if (!outputFileUrl) {
      throw new NotFoundException({
        code: 'OUTPUT_NOT_FOUND',
        message: 'No output file URL in job result',
      });
    }

    // outputFileUrl 형식: '/storage/temp/converted_xxx.pdf' 또는 'storage/...'
    // 파일시스템 절대경로로 변환
    const storageBase = process.env.STORAGE_PATH || '/app/storage';
    let absolutePath: string;
    if (outputFileUrl.startsWith('/storage/')) {
      // /storage/temp/x.pdf → /app/storage/temp/x.pdf
      absolutePath = path.join(storageBase, outputFileUrl.replace(/^\/storage\//, ''));
    } else if (outputFileUrl.startsWith('storage/')) {
      absolutePath = path.join(storageBase, outputFileUrl.replace(/^storage\//, ''));
    } else if (path.isAbsolute(outputFileUrl)) {
      absolutePath = outputFileUrl; // 이미 절대경로
    } else {
      absolutePath = path.join(storageBase, outputFileUrl);
    }

    // 보안: storage 디렉토리 밖으로 path traversal 방지
    const resolvedPath = path.resolve(absolutePath);
    const resolvedBase = path.resolve(storageBase);
    if (!resolvedPath.startsWith(resolvedBase)) {
      throw new BadRequestException({
        code: 'INVALID_PATH',
        message: 'Output path is outside storage root',
      });
    }

    // 파일 존재 확인
    if (!fs.existsSync(resolvedPath)) {
      throw new NotFoundException({
        code: 'FILE_NOT_ON_DISK',
        message: `Output file not found on disk: ${outputFileUrl}`,
      });
    }

    const filename = path.basename(resolvedPath);
    const stat = fs.statSync(resolvedPath);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );
    res.setHeader('Content-Length', stat.size);

    fs.createReadStream(resolvedPath).pipe(res);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a worker job by ID' })
  @ApiResponse({ status: 200, description: 'Worker job details', type: WorkerJob })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async findOne(@Param('id') id: string): Promise<WorkerJob> {
    return await this.workerJobsService.findOne(id);
  }

  /**
   * 외부 연동용 작업 상태 업데이트 (API Key 인증)
   * Worker 서비스에서 서버 간 통신으로 호출
   */
  @Patch('external/:id/status')
  @Public()
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Update job status (external API key auth)' })
  @ApiResponse({ status: 200, description: 'Job status updated', type: WorkerJob })
  @ApiResponse({ status: 404, description: 'Job not found' })
  @ApiResponse({ status: 401, description: 'Invalid API key' })
  async updateJobStatusExternal(
    @Param('id') id: string,
    @Body() updateJobStatusDto: UpdateJobStatusDto,
  ): Promise<WorkerJob> {
    return await this.workerJobsService.updateJobStatus(id, updateJobStatusDto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update job status (used by worker service)' })
  @ApiResponse({ status: 200, description: 'Job status updated', type: WorkerJob })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async updateJobStatus(
    @Param('id') id: string,
    @Body() updateJobStatusDto: UpdateJobStatusDto,
  ): Promise<WorkerJob> {
    return await this.workerJobsService.updateJobStatus(id, updateJobStatusDto);
  }
}
