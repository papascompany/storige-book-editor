import {
  Controller,
  ParseUUIDPipe,
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
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiSecurity } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { resolveStoragePath } from '../common/helpers/storage-path.helper';
import { WorkerJobsService } from './worker-jobs.service';
import {
  CreateValidationJobDto,
  CreateConversionJobDto,
  CreatePageCountFixJobDto,
  CreateSynthesisJobDto,
  CreateCutoutJobDto,
  UpdateJobStatusDto,
} from './dto/worker-job.dto';
import { CreateSplitSynthesisJobDto } from './dto/create-split-synthesis-job.dto';
import { CheckMergeableDto, CheckMergeableResponseDto } from './dto/check-mergeable.dto';
import { CreateComposeMixedJobDto } from './dto/create-compose-mixed-job.dto';
import { CreateRenderPagesJobDto } from './dto/create-render-pages-job.dto';
import { CreateBleedFixJobDto } from './dto/create-bleed-fix-job.dto';
import { WorkerJob } from './entities/worker-job.entity';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
// P3b 멀티테넌시 — 사이트 운영자 조회 라우트(목록/상세/통계) 테넌트 스코핑.
import { TenantGuard } from '../auth/guards/tenant.guard';
import { CurrentScope } from '../auth/decorators/tenant-scope.decorator';
import { TenantScope } from '../common/helpers/tenant-scope.helper';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
// 컷아웃 @Public 라우트의 테넌트 복원(서명 검증된 shop-session JWT 한정).
import { OptionalShopJwtGuard } from '../auth/guards/optional-shop-jwt.guard';
import { CurrentSite, CurrentSitePayload } from '../auth/decorators/current-site.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { UserRole, WorkerJobStatus, WorkerJobType, CutoutJobResult } from '@storige/types';

/**
 * 컷아웃 실패 사유의 사용자 표시 문구 (2026-08-05).
 *
 * 워커 원문 errorMessage 는 시스템 예외 문자열이라 내부 IP·절대경로가 실린다.
 * `GET /worker-jobs/:id/cutout-status` 는 무인증 라우트이므로 원문을 그대로 내보내지 않고
 * errorCode 로 분류된 고정 문구만 준다. 진단 원문은 워커 로그·Sentry 에 그대로 남는다.
 */
function toCutoutUserMessage(
  errorCode: string | null | undefined,
  raw: string | null | undefined,
): string | null {
  if (!raw && !errorCode) return null;
  switch (errorCode) {
    case 'CUTOUT_INPUT_TOO_LARGE':
      return '이미지가 너무 커서 배경을 제거할 수 없습니다. 더 작은 이미지로 다시 시도해 주세요.';
    case 'CUTOUT_UNSUPPORTED_FORMAT':
      return '지원하지 않는 이미지 형식입니다. PNG·JPEG·WebP 파일을 사용해 주세요.';
    case 'CUTOUT_DISABLED':
      return '배경 제거 기능이 현재 비활성화되어 있습니다.';
    case 'INVALID_OUTPUT_OPTIONS':
      return '배경 제거 설정이 올바르지 않습니다.';
    case 'SERVICE_UNAVAILABLE':
      return '배경 제거 서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.';
    default:
      return '배경 제거에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  }
}

@ApiTags('Worker Jobs')
@ApiBearerAuth()
@Controller('worker-jobs')
export class WorkerJobsController {
  private readonly logger = new Logger(WorkerJobsController.name);

  constructor(
    private readonly workerJobsService: WorkerJobsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 컷아웃 기능 플래그 — `CUTOUT_ENABLED` (**기본 false**, 미설정=꺼짐).
   * 꺼져 있으면 컷아웃 라우트는 404 로 응답해 기능의 존재 자체를 숨긴다.
   */
  private assertCutoutEnabled(): void {
    const raw = String(this.configService.get<string>('CUTOUT_ENABLED') ?? '')
      .trim()
      .toLowerCase();
    if (raw !== 'true' && raw !== '1') {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Cannot resolve route',
      });
    }
  }

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
    @CurrentSite() site?: CurrentSitePayload,
  ): Promise<WorkerJob> {
    return await this.workerJobsService.createValidationJob({
      ...createValidationJobDto,
      siteId: site?.siteId, // Phase C — 자동 사이트 식별
      // [S2-5] 인증 컨텍스트 env 전파 훅 — 공용 ApiKeyGuard(sites 키)는 항상 live 라
      // 현 경로 no-op. test 는 Stage 3 v1 잡 생성 표면에서만 도달(선행 인프라).
      partnerEnv: site?.env,
    });
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

  /**
   * 페이지수 배수 보정 (fix-pagecount) — 데이터 주도 검증 d1 빈페이지 추가 실행기. 내부(admin/manager).
   * 비동기 — 반환 jobId 폴링(GET /worker-jobs/:id) → COMPLETED 시 outputFileId(보정본 새 fileId).
   */
  @Post('fix-pagecount')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a page-count fix job (pad blank pages to multiple)' })
  @ApiResponse({ status: 201, description: 'Fix job created and queued', type: WorkerJob })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  async createPageCountFixJob(
    @Body() dto: CreatePageCountFixJobDto,
  ): Promise<WorkerJob> {
    return await this.workerJobsService.createPageCountFixJob(dto);
  }

  /**
   * 외부 연동용 페이지수 보정 (API Key 인증). 파트너 주문화면 d1 모달 Y 확정 시 호출.
   */
  @Post('fix-pagecount/external')
  @Public()
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Create a page-count fix job (external API key auth)' })
  @ApiResponse({ status: 201, description: 'Fix job created and queued', type: WorkerJob })
  @ApiResponse({ status: 401, description: 'Invalid API key' })
  async createPageCountFixJobExternal(
    @Body() dto: CreatePageCountFixJobDto,
    @CurrentSite() site?: CurrentSitePayload,
  ): Promise<WorkerJob> {
    return await this.workerJobsService.createPageCountFixJob({
      ...dto,
      siteId: site?.siteId, // Phase C — 자동 사이트 식별
    });
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
    @CurrentSite() site?: CurrentSitePayload,
  ): Promise<WorkerJob> {
    return await this.workerJobsService.createSynthesisJob({
      ...createSynthesisJobDto,
      siteId: site?.siteId, // Phase C — 자동 사이트 식별
      partnerEnv: site?.env, // [S2-5] env 전파 훅 — validate/external 주석 참조(현 경로 live=no-op)
    });
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

  // ============================================================================
  // Compose-mixed (인쇄 워크플로우 v1 Phase 5, 2026-05-19)
  // ============================================================================

  /**
   * Compose-mixed 잡 생성 — 표지+앞면지+내지+뒷면지 합본.
   *
   * 게스트도 호출 가능 (@Public). 향후 X-Guest-Token 또는 ApiKey 분기 추가 가능.
   * 기존 PHP synthesize/external 경로와 완전 분리 — 회귀 보호.
   *
   * ── 자동조립 opt-in (2026-08-13) ──────────────────────────────────────────
   * body.assembleFromSession=true 일 때만 서버가 세션에서 표지/내지/면지/판형을 도출한다.
   * 그 경로에만 인가가 걸리므로 `@Public` 은 **유지**하고(CONTRACT_FREEZE §2 동결 계약,
   * contract-freeze.spec.ts:65 auth:'public'), 컷아웃 라우트 선례와 동일하게
   * additive `OptionalShopJwtGuard` 로 검증된 shop-session 의 테넌트만 복원한다.
   * 토큰이 없거나 위조면 가드는 그대로 통과시키고(401 없음) 자동조립만 404 로 막힌다.
   * ⚠️ 기존 경로(URL 직접 공급)에는 어떤 인가 검사도 추가하지 않는다 — 무중단 최우선.
   *
   * 🔒 주문 스코프(2026-08-13 적대검증 MAJOR): siteId 일치만으로는 **동일 테넌트 내
   *    타 고객 세션**을 조립해 그 표지/내지를 합본으로 뽑아낼 수 있다(세션 UUID 는
   *    편집기 URL·/embed?sessionId= 등으로 노출되는 값이다). 형제 라우트가 이미 닫은
   *    취약점 클래스이므로(edit-sessions.controller.ts:91-101 Patch D, :163-180 F-5)
   *    같은 근거 필드 `allowedOrderSeqnos` 를 서비스로 넘겨 세션 orderSeqno 를 가드한다.
   *    가드가 이미 서명 검증된 JWT 에서 복원해 준다(optional-shop-jwt.guard.ts:70-75).
   *
   * 🔒 테넌트 스탬프(2026-08-13): 이 라우트가 `@Public` 인 이상 **body.siteId 는 인가 주체가
   *    아니다**. 여기서 복원한 caller 가 잡 스탬프의 유일한 검증 근거이며, 서비스가
   *    `resolveComposeMixedSiteId` 로 대조해 불일치·부재면 NULL 스탬프한다(400 없음).
   *    다른 라우트(:139·190·224·461)는 `@CurrentSite()` 서버 도출값이라 이 문제가 없다.
   */
  @Post('compose-mixed')
  @Public()
  @UseGuards(OptionalShopJwtGuard)
  @ApiOperation({ summary: 'Compose-mixed 잡 생성 (Phase 5)' })
  @ApiResponse({ status: 201, description: '잡 생성 성공', type: WorkerJob })
  @ApiResponse({ status: 400, description: '빈 입력(EMPTY_COMPOSE_INPUT) / 자동조립 불완전(SESSION_ASSEMBLY_INCOMPLETE)' })
  @ApiResponse({ status: 404, description: '자동조립 대상 세션 미존재·타 테넌트(SESSION_NOT_FOUND)' })
  async createComposeMixed(
    @Body() dto: CreateComposeMixedJobDto,
    @CurrentUser()
    user?: {
      siteId?: string;
      role?: string;
      source?: string;
      allowedOrderSeqnos?: unknown;
    },
  ): Promise<WorkerJob> {
    // 검증된 shop-session 이 있을 때만 테넌트 컨텍스트로 넘긴다(cutout 라우트와 동일 규약).
    // 없으면 undefined → 자동조립 요청은 서비스에서 404(SESSION_NOT_FOUND) 로 fail-closed.
    // allowedOrderSeqnos 는 배열일 때만 전달 — 없으면 호환 모드(주문 검사 생략, 형제 라우트 동일).
    const caller =
      user?.source === 'shop' && typeof user?.siteId === 'string'
        ? {
            siteId: user.siteId,
            allowedOrderSeqnos: Array.isArray(user.allowedOrderSeqnos)
              ? user.allowedOrderSeqnos
              : undefined,
          }
        : undefined;
    return await this.workerJobsService.createComposeMixedJob(dto, caller);
  }

  /**
   * 내지 PDF 표시전용 가이드 래스터화 잡 생성 (2026-06-07).
   *
   * 첨부 내지 PDF 각 페이지를 이미지로 변환 → 편집기 underlay 잠금 가이드.
   * 게스트도 호출 가능(@Public). ⚠️ 표시 전용 — 최종 인쇄엔 미반영.
   */
  @Post('render-pages')
  @Public()
  @ApiOperation({ summary: '내지 PDF 표시전용 가이드 래스터화 잡 생성' })
  @ApiResponse({ status: 201, description: '잡 생성 성공', type: WorkerJob })
  async createRenderPages(
    @Body() dto: CreateRenderPagesJobDto,
  ): Promise<WorkerJob> {
    return await this.workerJobsService.createRenderPagesJob(dto);
  }

  /**
   * 도련 자동 삽입(fix-bleed) 잡 생성 (2026-07-13) — BLEED_MISSING(extendBleed) 실행기.
   *
   * 재단 사이즈(=templateSet 판형) 업로드 PDF → 작업 사이즈(판형+bleedMm×2)로 변환
   * (콘텐츠 무스케일 중앙 배치). editSize 는 서버가 templateSetId 로 권위 산출 —
   * 클라이언트 임의 사이즈 입력 차단. 게스트 편집기 모달 호출 가능(@Public, render-pages 전례).
   * 폴링: GET /worker-jobs/:id → COMPLETED 시 outputFileId(보정본 새 fileId). 원본 보존.
   */
  @Post('fix-bleed')
  @Public()
  @ApiOperation({ summary: '도련 자동 삽입 잡 생성 (재단→작업 사이즈, 무스케일 중앙 배치)' })
  @ApiResponse({ status: 201, description: '잡 생성 성공', type: WorkerJob })
  @ApiResponse({ status: 400, description: 'templateSet 미존재 / 비PDF / 작업 사이즈 무효' })
  @ApiResponse({ status: 404, description: '파일 미존재' })
  async createBleedFixJob(
    @Body() dto: CreateBleedFixJobDto,
  ): Promise<WorkerJob> {
    return await this.workerJobsService.createBleedFixJob(dto);
  }

  // ============================================================================
  // Cutout (배경제거 서버 오프로드) — S-P2A-B, 2026-08-05
  // ============================================================================

  /**
   * 배경제거(컷아웃) 잡 생성.
   *
   * 게스트 편집기가 직접 호출한다(@Public + OptionalShopJwtGuard — 검증된 shop-session 이
   * 있을 때만 테넌트 컨텍스트 복원, 없으면 그대로 통과). 잡의 siteId 는 body 가 아니라
   * **원본 파일에서 승계**하므로 무인증 임의 테넌트 스탬프 통로가 없다.
   *
   * 🔒 @Throttle 10/min — 배경제거는 잡당 수백 MB~GB 를 쓰는 **무인증 컴퓨트**다.
   *    전역 300/min 으로는 단일 IP 가 사이드카를 포화시켜 인쇄 파이프라인까지 굶긴다.
   *
   * 폴링: `GET /worker-jobs/:id/cutout-status` (기존 `GET /worker-jobs/:id` 는 JWT 필수라
   *       게스트가 401 — 그래서 전용 조회 라우트를 둔다).
   */
  @Post('cutout')
  @Public()
  @UseGuards(OptionalShopJwtGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: '배경제거(컷아웃) 잡 생성 — CUTOUT_ENABLED=true 일 때만' })
  @ApiResponse({ status: 201, description: '잡 생성 성공' })
  @ApiResponse({ status: 400, description: '비이미지 MIME / 비허용 모델 키' })
  @ApiResponse({ status: 404, description: '파일 미존재 또는 기능 비활성(CUTOUT_ENABLED)' })
  async createCutoutJob(
    @Body() dto: CreateCutoutJobDto,
    @CurrentUser() user?: { siteId?: string; role?: string; source?: string },
  ): Promise<{ id: string; status: WorkerJobStatus }> {
    this.assertCutoutEnabled();

    // 검증된 shop-session 이 있을 때만 테넌트 컨텍스트로 넘긴다 — 서비스가 이 값으로
    // 입력 파일의 site 를 대조한다(없으면 site 스탬프된 파일은 404 = confused deputy 차단).
    const caller =
      user?.source === 'shop' && typeof user?.siteId === 'string'
        ? { siteId: user.siteId }
        : undefined;
    const job = await this.workerJobsService.createCutoutJob(dto, caller);

    // ⚠️ 잡 엔티티를 그대로 반환하면 무인증 응답에 siteId(파일 소유 테넌트)와
    //    inputFileUrl(내부 절대 저장경로)이 실린다 — 아래 조회 라우트와 동일하게 좁게 투영한다.
    return { id: job.id, status: job.status };
  }

  /**
   * 컷아웃 잡 상태·결과 폴링 (게스트 도달 가능).
   *
   * ⚠️ `jobType === CUTOUT` 인 잡만 응답하고 그 외는 404 — 무인증 라우트로 다른 잡 타입의
   *    정보가 새지 않게 하고, 타입 불일치도 미존재와 같은 404 로 존재 오라클을 차단한다.
   * ⚠️ 응답은 좁은 투영(id/status/result/error/completedAt)만 — 잡 엔티티를 그대로 주면
   *    siteId·inputFileUrl 같은 테넌트 메타데이터가 무인증 표면에 노출된다.
   * ⚠️ 기존 `GET /worker-jobs/:id` 의 인증은 건드리지 않는다(회귀 위험).
   *
   * @Throttle 120/min — 생성(10/min)보다 넉넉한 이유: 편집기 폴링이 1.5초 간격(=40회/분)이라
   *   60/min 이면 한 잡이 1분을 넘기는 순간 폴링이 스스로 429 로 끊긴다. 잡 1건 조회는 인덱스
   *   PK 조회 1회라 비용이 낮으므로, 컴퓨트를 여는 POST 만 좁게 잠근다.
   */
  @Get(':id/cutout-status')
  @Public()
  @UseGuards(OptionalShopJwtGuard)
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @ApiOperation({ summary: '컷아웃 잡 상태 조회 (CUTOUT 잡 한정, 그 외 404)' })
  @ApiResponse({ status: 200, description: '잡 상태/결과' })
  @ApiResponse({ status: 404, description: '잡 미존재·비CUTOUT 잡·기능 비활성' })
  async getCutoutStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: { siteId?: string; role?: string; source?: string },
  ): Promise<{
    id: string;
    status: WorkerJobStatus;
    result: CutoutJobResult | null;
    errorCode: string | null;
    errorMessage: string | null;
    completedAt: Date | null;
  }> {
    this.assertCutoutEnabled();

    // 검증된 shop-session 이 있을 때만 테넌트 격리 근거로 넘긴다(없으면 undefined = 기존 통과).
    const caller =
      user?.source === 'shop' && typeof user?.siteId === 'string'
        ? { siteId: user.siteId }
        : undefined;
    const job = await this.workerJobsService.findCutoutJob(id, caller);

    return {
      id: job.id,
      status: job.status,
      // 워커가 넣는 값의 런타임 형상은 CutoutJobResult(계약) — 엔티티 컬럼은 json(any).
      result: (job.result as CutoutJobResult | null) ?? null,
      errorCode: job.errorCode,
      // ⚠️ 워커 원문 errorMessage 를 그대로 주면 안 된다 — 무인증 표면에 내부 정보가 샌다
      //    (예: `connect ECONNREFUSED <도커 내부 IP>:7000`, `ENOENT /app/storage/uploads/...`).
      //    사용자에게는 errorCode 기반 고정 문구만 주고, 원문은 워커 로그·Sentry 에 남는다.
      errorMessage: toCutoutUserMessage(job.errorCode, job.errorMessage),
      completedAt: job.completedAt,
    };
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
    @CurrentSite() site?: CurrentSitePayload,
  ): Promise<WorkerJob> {
    return await this.workerJobsService.createSplitSynthesisJob({
      ...dto,
      siteId: site?.siteId, // Phase C — 자동 사이트 식별 (Stage 0 비대칭 봉합, validate/external 준용)
      partnerEnv: site?.env, // [S2-5] env 전파 훅 — validate/external 주석 참조(현 경로 live=no-op)
    });
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
    @CurrentSite() site?: CurrentSitePayload,
  ): Promise<CheckMergeableResponseDto> {
    // Stage 0 비대칭 봉합 — 사이트 컨텍스트를 감사 로깅/후속 스코핑용으로만 전달.
    // check-mergeable 은 worker_job 행을 만들지 않는 dry-run 조회라 스탬프 대상이 없고,
    // 접근 차단/스코핑 강제는 NULL-siteId 정책(오너 결정 잔여 사안) 확정 전 도입하지 않는다.
    //
    // ⚠️ NULL-siteId 정책 미결 항목 (2026-08-13 추가) — `POST /worker-jobs/compose-mixed`.
    //    수동 경로가 body.siteId 를 무시하고 NULL 을 스탬프하도록 하드닝되면서
    //    (worker-jobs.service.ts resolveComposeMixedSiteId) **write 위조는 막았지만
    //    read 표면은 넓어졌다** — 이 트레이드오프가 정책 결정 대상이다:
    //      · findAll: applySiteScope(includeNull 기본 false) → 사이트 운영자 목록에서 사라짐
    //      · findOne: 읽기라 allowNull — shop JWT 가 @Public validate/render-pages
    //        폴링 가능. 타 테넌트 스탬프 잡은 assertJobSiteAccess 가 404
    //      · GET /worker-jobs/external/:id: assertJobSiteAccess 가 NULL 잡을 통과시킴
    //        → jobId 를 아는 **어느 테넌트 키로도** 상태·outputFileUrl 조회 가능
    //    (산출물 경로 자체가 무인증 공개라 실질 노출 = 오너 결정 대기.)
    return await this.workerJobsService.checkMergeable(checkMergeableDto, site);
  }

  // ============================================================================
  // Job Management
  // ============================================================================

  @Get()
  @UseGuards(RolesGuard, TenantGuard)
  // P3b — 사이트 운영자 조회 허용(자기 site 잡만 — 서비스 applySiteScope 강제)
  @Roles(
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.SITE_ADMIN,
    UserRole.SITE_MANAGER,
  )
  @ApiOperation({ summary: 'Get all worker jobs with optional filters' })
  @ApiQuery({ name: 'status', required: false, enum: WorkerJobStatus })
  @ApiQuery({ name: 'jobType', required: false, enum: WorkerJobType })
  @ApiQuery({ name: 'siteId', required: false, description: '사이트 ID (Phase C-3)' })
  @ApiQuery({ name: 'limit', required: false, description: '최대 반환 수 (기본 200, 최대 1000) — DB-016' })
  @ApiResponse({ status: 200, description: 'List of worker jobs', type: [WorkerJob] })
  async findAll(
    @CurrentScope() scope: TenantScope,
    @Query('status') status?: WorkerJobStatus,
    @Query('jobType') jobType?: WorkerJobType,
    @Query('siteId') siteId?: string, // Phase C-3
    @Query('limit') limit?: string, // DB-016
  ): Promise<WorkerJob[]> {
    return await this.workerJobsService.findAll(
      status,
      jobType,
      siteId,
      limit ? Number(limit) : undefined,
      scope,
    );
  }

  @Get('stats')
  @UseGuards(RolesGuard, TenantGuard)
  // P3b — 사이트 운영자는 자기 site 잡 통계만(서비스 applySiteScope 강제)
  @Roles(
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.SITE_ADMIN,
    UserRole.SITE_MANAGER,
  )
  @ApiOperation({ summary: 'Get job statistics grouped by status and type' })
  @ApiResponse({ status: 200, description: 'Job statistics' })
  async getJobStats(@CurrentScope() scope: TenantScope) {
    return await this.workerJobsService.getJobStats(scope);
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
  async findOneExternal(
    @Param('id') id: string,
    @CurrentSite() site?: CurrentSitePayload,
  ): Promise<WorkerJob> {
    // P2c S-3: editor 키(테넌트)는 자기 site/NULL 잡만, worker 키(내부)는 바이패스.
    return await this.workerJobsService.findOne(id, site);
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
  async downloadOutput(
    @Param('id') id: string,
    @Res() res: Response,
    @CurrentSite() site?: CurrentSitePayload,
  ): Promise<void> {
    // SEC-002: site/소유권 격리(external/:id 와 동일). NULL-site 잡·undefined-caller 는 통과,
    // 타 테넌트 잡은 404 → IDOR 차단. assertJobSiteAccess(service) 재사용.
    const job = await this.workerJobsService.findOne(id, site);
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
    // 해석+경계 가드는 공유 헬퍼로 — 종전 인라인 startsWith(base) 검사는 형제 접두사
    // (/app/storage-evil)를 통과시키는 결함이 있었다(감사 §8 ⑦, files.service 와 동일 로직 통합).
    const storageBase = process.env.STORAGE_PATH || '/app/storage';
    const resolvedPath = resolveStoragePath(outputFileUrl, storageBase);
    if (!resolvedPath) {
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

    // 스트림 가드 — files.controller/books.controller 의 기존 패턴과 동일.
    // ① close: 클라이언트 중단 시 fd 누수 방지 ② error: existsSync 통과 후 open/read 사이에
    // 파일이 지워지면(보존정책 sweep 등) unhandled 'error' 로 응답이 매달린다 — 헤더 전송 전이면
    // JSON 에러, 전송 중이면 소켓을 끊어 불완전 다운로드가 완결로 오인되지 않게 한다.
    // 라벨은 err.code 로 분기한다 — ENOENT(삭제 레이스)만 404 로, EACCES/EIO 같은 I/O 장애를
    // '파일이 사라졌다'로 오분류하면 운영 진단이 은폐된다(적대 리뷰 지적, files.controller 는 500).
    const stream = fs.createReadStream(resolvedPath);
    res.on('close', () => stream.destroy());
    stream.on('error', (err: NodeJS.ErrnoException) => {
      this.logger.error(`downloadOutput stream error (${err.code ?? 'unknown'}): ${err.message}`);
      if (!res.headersSent) {
        // 스트리밍용으로 걸어둔 헤더를 정리한다 — Express res.json() 은 기설정 Content-Type 을
        // 덮지 않아, 정리 없이는 에러 JSON 이 application/pdf + attachment(+옛 Content-Length)로
        // 나가 다운로더가 에러 본문을 .pdf 로 저장한다(적대 리뷰 실증, 3라우트 공통 일괄 수정).
        res.removeHeader('Content-Type');
        res.removeHeader('Content-Disposition');
        res.removeHeader('Content-Length');
        if (err.code === 'ENOENT') {
          res.status(404).json({
            code: 'FILE_NOT_ON_DISK',
            message: `Output file disappeared during read: ${outputFileUrl}`,
          });
        } else {
          res.status(500).json({
            code: 'STREAM_ERROR',
            message: '파일 스트리밍 중 오류가 발생했습니다.',
          });
        }
      } else {
        res.destroy(err);
      }
    });
    stream.pipe(res);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a worker job by ID' })
  @ApiResponse({ status: 200, description: 'Worker job details', type: WorkerJob })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async findOne(
    @CurrentScope() scope: TenantScope,
    @Param('id') id: string,
    @CurrentSite() site?: CurrentSitePayload,
  ): Promise<WorkerJob> {
    // SEC-002: site/소유권 격리(external/:id 와 동일). 타 테넌트 잡 조회 차단.
    // P3b: 사이트 운영자(admin JWT)도 자기 site 잡만 — scope 로 서비스에서 단정.
    return await this.workerJobsService.findOne(id, site, scope);
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
    @CurrentSite() site?: CurrentSitePayload,
  ): Promise<WorkerJob> {
    // P2c S-3: worker 키(내부 콜백)는 바이패스, editor 키(테넌트)는 자기 site 잡만 업데이트.
    return await this.workerJobsService.updateJobStatus(id, updateJobStatusDto, site);
  }

  /**
   * 작업 상태 업데이트(내부 호환 별칭) — API Key 인증 필수 (P0-3, 2026-06-22).
   *
   * ⚠️ 과거 이 라우트는 가드 없이 전역 JwtAuthGuard 만 적용돼, 유효한 고객 JWT 면 누구나
   * 임의 잡 상태를 조작할 수 있었다(소유권/역할 검사 없음). 워커 콜백은 전부
   * `external/:id/status`(X-API-Key) 를 쓰므로 이 라우트엔 코드 콜러가 없으나,
   * 혹시 모를 인증된 외부 콜러 보호를 위해 삭제 대신 external 변형과 동일하게 잠근다.
   */
  @Patch(':id/status')
  @Public()
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Update job status (API key auth; alias of external/:id/status)' })
  @ApiResponse({ status: 200, description: 'Job status updated', type: WorkerJob })
  @ApiResponse({ status: 401, description: 'Invalid API key' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async updateJobStatus(
    @Param('id') id: string,
    @Body() updateJobStatusDto: UpdateJobStatusDto,
    @CurrentSite() site?: CurrentSitePayload,
  ): Promise<WorkerJob> {
    // external 변형과 동일: worker 키는 바이패스, editor 키는 자기 site 잡만 갱신.
    return await this.workerJobsService.updateJobStatus(id, updateJobStatusDto, site);
  }
}
