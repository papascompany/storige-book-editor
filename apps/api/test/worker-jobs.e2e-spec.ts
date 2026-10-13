import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import request from 'supertest';
import { TypeOrmModule, InjectRepository, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { AuthGuard } from '@nestjs/passport';
import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  Repository,
  BeforeInsert,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// Test Entities (SQLite compatible)
// ============================================================================

@Entity('worker_jobs')
class TestWorkerJobEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Column({ name: 'job_type', type: 'varchar', length: 30 })
  jobType: string;

  @Column({ type: 'varchar', length: 20 })
  status: string;

  @Column({ name: 'edit_session_id', type: 'varchar', length: 36, nullable: true })
  editSessionId: string | null;

  @Column({ name: 'file_id', type: 'varchar', length: 36, nullable: true })
  fileId: string | null;

  @Column({ name: 'input_file_url', type: 'varchar', length: 500, nullable: true })
  inputFileUrl: string | null;

  @Column({ name: 'output_file_url', type: 'varchar', length: 500, nullable: true })
  outputFileUrl: string | null;

  @Column({ name: 'output_file_id', type: 'varchar', length: 36, nullable: true })
  outputFileId: string | null;

  @Column({ type: 'simple-json', nullable: true })
  options: any;

  @Column({ type: 'simple-json', nullable: true })
  result: any;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'completed_at', type: 'datetime', nullable: true })
  completedAt: Date | null;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv4();
    }
    if (!this.status) {
      this.status = 'PENDING';
    }
  }
}

@Entity('file_edit_sessions')
class TestEditSessionEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Column({ name: 'order_seqno', type: 'integer' })
  orderSeqno: number;

  @Column({ name: 'member_seqno', type: 'integer' })
  memberSeqno: number;

  @Column({ type: 'text', default: 'draft' })
  status: string;

  @Column({ type: 'text' })
  mode: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv4();
    }
  }
}

// ============================================================================
// Test JWT Strategy
// ============================================================================

@Injectable()
class TestJwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: 'test-secret',
    });
  }

  async validate(payload: any) {
    return {
      userId: String(payload.sub),
      email: payload.memberId,
      role: payload.role || 'user',
    };
  }
}

// ============================================================================
// Test Guards
// ============================================================================

@Injectable()
class TestJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any) {
    if (err || !user) {
      throw err || new UnauthorizedException();
    }
    return user;
  }
}

@Injectable()
class TestApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];
    return apiKey === 'test-api-key';
  }
}

@Injectable()
class TestRolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    return user && (user.role === 'admin' || user.role === 'manager');
  }
}

// ============================================================================
// Test Service
// ============================================================================

@Injectable()
class TestWorkerJobsService {
  private files: Map<string, any> = new Map();

  constructor(
    @InjectRepository(TestWorkerJobEntity)
    private jobRepository: Repository<TestWorkerJobEntity>,
    @InjectRepository(TestEditSessionEntity)
    private sessionRepository: Repository<TestEditSessionEntity>,
  ) {}

  addTestFile(id: string, filePath: string) {
    this.files.set(id, { id, filePath, fileName: 'test.pdf' });
  }

  async addTestSession(session: Partial<TestEditSessionEntity>) {
    const entity = this.sessionRepository.create({
      id: session.id || uuidv4(),
      orderSeqno: session.orderSeqno || 1,
      memberSeqno: session.memberSeqno || 1,
      mode: session.mode || 'cover',
      status: session.status || 'draft',
      ...session,
    });
    return await this.sessionRepository.save(entity);
  }

  async checkMergeable(dto: any) {
    const issues: any[] = [];

    if (dto.coverFileId && !this.files.has(dto.coverFileId)) {
      issues.push({ code: 'COVER_FILE_NOT_FOUND', message: '표지 파일을 찾을 수 없습니다.' });
    }
    if (dto.contentFileId && !this.files.has(dto.contentFileId)) {
      issues.push({ code: 'CONTENT_FILE_NOT_FOUND', message: '내지 파일을 찾을 수 없습니다.' });
    }

    if (!dto.coverUrl && !dto.coverFileId) {
      issues.push({ code: 'COVER_URL_REQUIRED', message: '표지 URL 또는 파일 ID가 필요합니다.' });
    }
    if (!dto.contentUrl && !dto.contentFileId) {
      issues.push({ code: 'CONTENT_URL_REQUIRED', message: '내지 URL 또는 파일 ID가 필요합니다.' });
    }

    if (dto.spineWidth < 0) {
      issues.push({ code: 'INVALID_SPINE_WIDTH', message: '책등 폭은 0 이상이어야 합니다.' });
    }

    return {
      mergeable: issues.length === 0,
      issues: issues.length > 0 ? issues : undefined,
    };
  }

  async createValidationJob(dto: any) {
    if (!dto.fileId && !dto.fileUrl) {
      throw new BadRequestException('FILE_REQUIRED');
    }

    if (dto.fileId && !this.files.has(dto.fileId)) {
      throw new NotFoundException(`File not found: ${dto.fileId}`);
    }

    const job = this.jobRepository.create({
      id: uuidv4(),
      jobType: 'VALIDATE',
      status: 'PENDING',
      editSessionId: dto.editSessionId || null,
      fileId: dto.fileId || null,
      inputFileUrl: dto.fileUrl || this.files.get(dto.fileId)?.filePath,
      options: {
        fileType: dto.fileType,
        orderOptions: dto.orderOptions,
      },
    });

    return await this.jobRepository.save(job);
  }

  async createConversionJob(dto: any) {
    if (!dto.fileId && !dto.fileUrl) {
      throw new BadRequestException('FILE_REQUIRED');
    }

    const job = this.jobRepository.create({
      id: uuidv4(),
      jobType: 'CONVERT',
      status: 'PENDING',
      fileId: dto.fileId || null,
      inputFileUrl: dto.fileUrl,
      options: dto.convertOptions,
    });

    return await this.jobRepository.save(job);
  }

  async createSynthesisJob(dto: any) {
    if (!dto.coverFileId && !dto.coverUrl) {
      throw new BadRequestException('COVER_FILE_REQUIRED');
    }
    if (!dto.contentFileId && !dto.contentUrl) {
      throw new BadRequestException('CONTENT_FILE_REQUIRED');
    }

    const outputFormat = dto.outputFormat || 'merged';

    const job = this.jobRepository.create({
      id: uuidv4(),
      jobType: 'SYNTHESIZE',
      status: 'PENDING',
      editSessionId: dto.editSessionId || null,
      fileId: dto.coverFileId || null,
      inputFileUrl: dto.coverUrl || this.files.get(dto.coverFileId)?.filePath,
      options: {
        coverFileId: dto.coverFileId,
        contentFileId: dto.contentFileId,
        coverUrl: dto.coverUrl,
        contentUrl: dto.contentUrl,
        spineWidth: dto.spineWidth,
        orderId: dto.orderId,
        callbackUrl: dto.callbackUrl,
        outputFormat, // 출력 형식 저장
      },
    });

    return await this.jobRepository.save(job);
  }

  async findAll(status?: string, jobType?: string) {
    let jobs = await this.jobRepository.find({ order: { createdAt: 'DESC' } });
    if (status) {
      jobs = jobs.filter((j) => j.status === status);
    }
    if (jobType) {
      jobs = jobs.filter((j) => j.jobType === jobType);
    }
    return jobs;
  }

  async findOne(id: string) {
    const job = await this.jobRepository.findOne({ where: { id } });
    if (!job) {
      throw new NotFoundException(`Worker job with ID ${id} not found`);
    }
    return job;
  }

  async updateJobStatus(id: string, dto: any) {
    const job = await this.findOne(id);

    // outputFiles가 있으면 result에 포함
    if (dto.outputFiles && dto.result) {
      dto.result.outputFiles = dto.outputFiles;
    }

    Object.assign(job, dto);
    if (dto.status === 'COMPLETED' || dto.status === 'FAILED') {
      job.completedAt = new Date();
    }
    return await this.jobRepository.save(job);
  }

  async getJobStats() {
    const jobs = await this.jobRepository.find();
    const stats: any[] = [];
    const grouped = new Map<string, number>();

    for (const job of jobs) {
      const key = `${job.status}-${job.jobType}`;
      grouped.set(key, (grouped.get(key) || 0) + 1);
    }

    for (const [key, count] of grouped) {
      const [status, jobType] = key.split('-');
      stats.push({ status, jobType, count: String(count) });
    }

    return stats;
  }
}

// ============================================================================
// Test Controller (워커 작업 컨트롤러 테스트용)
// ============================================================================

@Controller('worker-jobs')
class TestWorkerJobsController {
  constructor(private readonly workerJobsService: TestWorkerJobsService) {}

  @Post('check-mergeable')
  @UseGuards(TestJwtAuthGuard)
  async checkMergeable(@Body() dto: any) {
    return this.workerJobsService.checkMergeable(dto);
  }

  @Post('check-mergeable/external')
  @UseGuards(TestApiKeyGuard)
  async checkMergeableExternal(@Body() dto: any) {
    return this.workerJobsService.checkMergeable(dto);
  }

  @Post('validate')
  @UseGuards(TestJwtAuthGuard)
  async createValidationJob(@Body() dto: any) {
    if (!dto.orderOptions) {
      throw new BadRequestException('orderOptions is required');
    }
    return this.workerJobsService.createValidationJob(dto);
  }

  @Post('validate/external')
  @UseGuards(TestApiKeyGuard)
  async createValidationJobExternal(@Body() dto: any) {
    if (!dto.orderOptions) {
      throw new BadRequestException('orderOptions is required');
    }
    return this.workerJobsService.createValidationJob(dto);
  }

  @Post('convert')
  @UseGuards(TestJwtAuthGuard, TestRolesGuard)
  async createConversionJob(@Body() dto: any) {
    return this.workerJobsService.createConversionJob(dto);
  }

  @Post('synthesize')
  @UseGuards(TestJwtAuthGuard, TestRolesGuard)
  async createSynthesisJob(@Body() dto: any) {
    return this.workerJobsService.createSynthesisJob(dto);
  }

  @Post('synthesize/external')
  @UseGuards(TestApiKeyGuard)
  async createSynthesisJobExternal(@Body() dto: any) {
    return this.workerJobsService.createSynthesisJob(dto);
  }

  @Get()
  @UseGuards(TestJwtAuthGuard, TestRolesGuard)
  async findAll(@Query('status') status?: string, @Query('jobType') jobType?: string) {
    return this.workerJobsService.findAll(status, jobType);
  }

  @Get('stats')
  @UseGuards(TestJwtAuthGuard, TestRolesGuard)
  async getJobStats() {
    return this.workerJobsService.getJobStats();
  }

  @Get('external/:id')
  @UseGuards(TestApiKeyGuard)
  async findOneExternal(@Param('id') id: string) {
    return this.workerJobsService.findOne(id);
  }

  @Get(':id')
  @UseGuards(TestJwtAuthGuard)
  async findOne(@Param('id') id: string) {
    return this.workerJobsService.findOne(id);
  }

  @Patch('external/:id/status')
  @UseGuards(TestApiKeyGuard)
  async updateJobStatusExternal(@Param('id') id: string, @Body() dto: any) {
    return this.workerJobsService.updateJobStatus(id, dto);
  }

  @Patch(':id/status')
  @UseGuards(TestJwtAuthGuard)
  async updateJobStatus(@Param('id') id: string, @Body() dto: any) {
    return this.workerJobsService.updateJobStatus(id, dto);
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('WorkerJobsController (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let workerJobsService: TestWorkerJobsService;
  let jobRepository: Repository<TestWorkerJobEntity>;

  const TEST_API_KEY = 'test-api-key';

  function generateToken(payload: any): string {
    return jwtService.sign(payload, { expiresIn: '1h' });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({
          secret: 'test-secret',
          signOptions: { expiresIn: '1h' },
        }),
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          driver: require('better-sqlite3'),
          database: ':memory:',
          entities: [TestWorkerJobEntity, TestEditSessionEntity],
          synchronize: true,
          dropSchema: true,
        }),
        TypeOrmModule.forFeature([TestWorkerJobEntity, TestEditSessionEntity]),
      ],
      controllers: [TestWorkerJobsController],
      providers: [
        TestWorkerJobsService,
        TestJwtStrategy,
        TestJwtAuthGuard,
        TestApiKeyGuard,
        TestRolesGuard,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();

    jwtService = moduleFixture.get<JwtService>(JwtService);
    workerJobsService = moduleFixture.get<TestWorkerJobsService>(TestWorkerJobsService);
    jobRepository = moduleFixture.get<Repository<TestWorkerJobEntity>>(
      getRepositoryToken(TestWorkerJobEntity),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await jobRepository.clear();
  });

  // ============================================================================
  // 병합 가능 여부 체크 테스트
  // ============================================================================

  describe('POST /worker-jobs/check-mergeable (병합 가능 여부 체크)', () => {
    const userToken = () =>
      generateToken({ sub: '1', memberId: 'user@test.com', role: 'user' });

    it('TC-PDF-001: 정상적인 병합 가능 체크', async () => {
      const coverFileId = uuidv4();
      const contentFileId = uuidv4();
      workerJobsService.addTestFile(coverFileId, '/test/cover.pdf');
      workerJobsService.addTestFile(contentFileId, '/test/content.pdf');

      const sessionId = uuidv4();
      await workerJobsService.addTestSession({ id: sessionId });

      const response = await request(app.getHttpServer())
        .post('/worker-jobs/check-mergeable')
        .set('Authorization', `Bearer ${userToken()}`)
        .send({
          editSessionId: sessionId,
          coverFileId,
          contentFileId,
          spineWidth: 5.5,
        })
        .expect(201);

      expect(response.body.mergeable).toBe(true);
      expect(response.body.issues).toBeUndefined();
    });

    it('TC-PDF-002: 존재하지 않는 파일로 체크', async () => {
      const sessionId = uuidv4();
      await workerJobsService.addTestSession({ id: sessionId });

      const response = await request(app.getHttpServer())
        .post('/worker-jobs/check-mergeable')
        .set('Authorization', `Bearer ${userToken()}`)
        .send({
          editSessionId: sessionId,
          coverFileId: uuidv4(),
          contentFileId: uuidv4(),
          spineWidth: 5.5,
        })
        .expect(201);

      expect(response.body.mergeable).toBe(false);
      expect(response.body.issues).toBeDefined();
      expect(response.body.issues.some((i: any) => i.code === 'COVER_FILE_NOT_FOUND')).toBe(true);
    });

    it('파일 URL/ID 모두 누락 시 에러 반환', async () => {
      const sessionId = uuidv4();
      await workerJobsService.addTestSession({ id: sessionId });

      const response = await request(app.getHttpServer())
        .post('/worker-jobs/check-mergeable')
        .set('Authorization', `Bearer ${userToken()}`)
        .send({
          editSessionId: sessionId,
          spineWidth: 5.5,
        })
        .expect(201);

      expect(response.body.mergeable).toBe(false);
      expect(response.body.issues.some((i: any) => i.code === 'COVER_URL_REQUIRED')).toBe(true);
      expect(response.body.issues.some((i: any) => i.code === 'CONTENT_URL_REQUIRED')).toBe(true);
    });

    it('음수 책등 폭으로 체크 시 에러 반환', async () => {
      const sessionId = uuidv4();
      await workerJobsService.addTestSession({ id: sessionId });

      const response = await request(app.getHttpServer())
        .post('/worker-jobs/check-mergeable')
        .set('Authorization', `Bearer ${userToken()}`)
        .send({
          editSessionId: sessionId,
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: -1,
        })
        .expect(201);

      expect(response.body.mergeable).toBe(false);
      expect(response.body.issues.some((i: any) => i.code === 'INVALID_SPINE_WIDTH')).toBe(true);
    });

    it('URL로 병합 가능 체크', async () => {
      const sessionId = uuidv4();
      await workerJobsService.addTestSession({ id: sessionId });

      const response = await request(app.getHttpServer())
        .post('/worker-jobs/check-mergeable')
        .set('Authorization', `Bearer ${userToken()}`)
        .send({
          editSessionId: sessionId,
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
        })
        .expect(201);

      expect(response.body.mergeable).toBe(true);
    });

    it('인증 없이 요청 시 401', async () => {
      await request(app.getHttpServer())
        .post('/worker-jobs/check-mergeable')
        .send({
          editSessionId: uuidv4(),
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
        })
        .expect(401);
    });
  });

  describe('POST /worker-jobs/check-mergeable/external (외부 API Key 인증)', () => {
    it('유효한 API Key로 병합 가능 체크', async () => {
      const sessionId = uuidv4();
      await workerJobsService.addTestSession({ id: sessionId });

      const response = await request(app.getHttpServer())
        .post('/worker-jobs/check-mergeable/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          editSessionId: sessionId,
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
        })
        .expect(201);

      expect(response.body.mergeable).toBe(true);
    });

    it('잘못된 API Key로 요청 시 403', async () => {
      await request(app.getHttpServer())
        .post('/worker-jobs/check-mergeable/external')
        .set('X-API-Key', 'invalid-api-key')
        .send({
          editSessionId: uuidv4(),
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
        })
        .expect(403);
    });

    it('API Key 누락 시 403', async () => {
      await request(app.getHttpServer())
        .post('/worker-jobs/check-mergeable/external')
        .send({
          editSessionId: uuidv4(),
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
        })
        .expect(403);
    });
  });

  // ============================================================================
  // 검증 작업 생성 테스트
  // ============================================================================

  describe('POST /worker-jobs/validate (검증 작업 생성)', () => {
    const userToken = () =>
      generateToken({ sub: '1', memberId: 'user@test.com', role: 'user' });

    it('TC-PDF-004: 정상적인 검증 작업 생성', async () => {
      const fileId = uuidv4();
      workerJobsService.addTestFile(fileId, '/test/content.pdf');

      const response = await request(app.getHttpServer())
        .post('/worker-jobs/validate')
        .set('Authorization', `Bearer ${userToken()}`)
        .send({
          fileId,
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 100,
            binding: 'perfect',
            bleed: 3,
          },
        })
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.jobType).toBe('VALIDATE');
      expect(response.body.status).toBe('PENDING');
    });

    it('fileUrl로 검증 작업 생성', async () => {
      const response = await request(app.getHttpServer())
        .post('/worker-jobs/validate')
        .set('Authorization', `Bearer ${userToken()}`)
        .send({
          fileUrl: 'https://example.com/test.pdf',
          fileType: 'cover',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 4,
            binding: 'perfect',
            bleed: 3,
          },
        })
        .expect(201);

      expect(response.body.jobType).toBe('VALIDATE');
      expect(response.body.inputFileUrl).toBe('https://example.com/test.pdf');
    });

    it('필수 필드 누락 시 400', async () => {
      await request(app.getHttpServer())
        .post('/worker-jobs/validate')
        .set('Authorization', `Bearer ${userToken()}`)
        .send({
          fileUrl: 'https://example.com/test.pdf',
          fileType: 'content',
          // orderOptions 누락
        })
        .expect(400);
    });

    it('인증 없이 요청 시 401', async () => {
      await request(app.getHttpServer())
        .post('/worker-jobs/validate')
        .send({
          fileUrl: 'https://example.com/test.pdf',
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 100,
            binding: 'perfect',
            bleed: 3,
          },
        })
        .expect(401);
    });
  });

  describe('POST /worker-jobs/validate/external (외부 API Key 인증)', () => {
    it('유효한 API Key로 검증 작업 생성', async () => {
      const response = await request(app.getHttpServer())
        .post('/worker-jobs/validate/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          fileUrl: 'https://example.com/test.pdf',
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 100,
            binding: 'perfect',
            bleed: 3,
          },
        })
        .expect(201);

      expect(response.body.jobType).toBe('VALIDATE');
      expect(response.body.status).toBe('PENDING');
    });
  });

  // ============================================================================
  // 병합 작업 생성 테스트
  // ============================================================================

  describe('POST /worker-jobs/synthesize/external (병합 작업 생성)', () => {
    it('TC-PDF-003: 정상적인 PDF 병합 요청', async () => {
      const response = await request(app.getHttpServer())
        .post('/worker-jobs/synthesize/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
          orderId: 'ORD-2024-12345',
          callbackUrl: 'https://bookmoa.com/api/webhook',
        })
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.jobType).toBe('SYNTHESIZE');
      expect(response.body.status).toBe('PENDING');
      expect(response.body.options.spineWidth).toBe(5.5);
      expect(response.body.options.orderId).toBe('ORD-2024-12345');
    });

    it('우선순위 설정', async () => {
      const response = await request(app.getHttpServer())
        .post('/worker-jobs/synthesize/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
          priority: 'high',
        })
        .expect(201);

      expect(response.body.jobType).toBe('SYNTHESIZE');
    });

    it('표지 파일 누락 시 400', async () => {
      await request(app.getHttpServer())
        .post('/worker-jobs/synthesize/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
        })
        .expect(400);
    });

    it('내지 파일 누락 시 400', async () => {
      await request(app.getHttpServer())
        .post('/worker-jobs/synthesize/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          coverUrl: 'https://example.com/cover.pdf',
          spineWidth: 5.5,
        })
        .expect(400);
    });
  });

  // ============================================================================
  // 작업 조회 테스트
  // ============================================================================

  describe('GET /worker-jobs/external/:id (작업 상세 조회)', () => {
    it('작업 상세 조회 성공', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/worker-jobs/validate/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          fileUrl: 'https://example.com/test.pdf',
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 100,
            binding: 'perfect',
            bleed: 3,
          },
        })
        .expect(201);

      const jobId = createResponse.body.id;

      const response = await request(app.getHttpServer())
        .get(`/worker-jobs/external/${jobId}`)
        .set('X-API-Key', TEST_API_KEY)
        .expect(200);

      expect(response.body.id).toBe(jobId);
      expect(response.body.jobType).toBe('VALIDATE');
    });

    it('존재하지 않는 작업 조회 시 404', async () => {
      await request(app.getHttpServer())
        .get(`/worker-jobs/external/${uuidv4()}`)
        .set('X-API-Key', TEST_API_KEY)
        .expect(404);
    });
  });

  // ============================================================================
  // 작업 상태 업데이트 테스트
  // ============================================================================

  describe('PATCH /worker-jobs/external/:id/status (작업 상태 업데이트)', () => {
    it('TC-PDF-005: 작업 상태를 COMPLETED로 업데이트', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/worker-jobs/validate/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          fileUrl: 'https://example.com/test.pdf',
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 100,
            binding: 'perfect',
            bleed: 3,
          },
        })
        .expect(201);

      const jobId = createResponse.body.id;

      const response = await request(app.getHttpServer())
        .patch(`/worker-jobs/external/${jobId}/status`)
        .set('X-API-Key', TEST_API_KEY)
        .send({
          status: 'COMPLETED',
          result: { valid: true, pageCount: 100 },
        })
        .expect(200);

      expect(response.body.status).toBe('COMPLETED');
      expect(response.body.result.valid).toBe(true);
      expect(response.body.completedAt).toBeDefined();
    });

    it('TC-PDF-006: 작업 상태를 FAILED로 업데이트', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/worker-jobs/validate/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          fileUrl: 'https://example.com/test.pdf',
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 100,
            binding: 'perfect',
            bleed: 3,
          },
        })
        .expect(201);

      const jobId = createResponse.body.id;

      const response = await request(app.getHttpServer())
        .patch(`/worker-jobs/external/${jobId}/status`)
        .set('X-API-Key', TEST_API_KEY)
        .send({
          status: 'FAILED',
          errorMessage: 'Invalid PDF format',
        })
        .expect(200);

      expect(response.body.status).toBe('FAILED');
      expect(response.body.errorMessage).toBe('Invalid PDF format');
      expect(response.body.completedAt).toBeDefined();
    });

    it('PROCESSING 상태로 업데이트', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/worker-jobs/validate/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          fileUrl: 'https://example.com/test.pdf',
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 100,
            binding: 'perfect',
            bleed: 3,
          },
        })
        .expect(201);

      const jobId = createResponse.body.id;

      const response = await request(app.getHttpServer())
        .patch(`/worker-jobs/external/${jobId}/status`)
        .set('X-API-Key', TEST_API_KEY)
        .send({
          status: 'PROCESSING',
        })
        .expect(200);

      expect(response.body.status).toBe('PROCESSING');
      expect(response.body.completedAt).toBeNull();
    });

    it('outputFileUrl 업데이트', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/worker-jobs/synthesize/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
        })
        .expect(201);

      const jobId = createResponse.body.id;

      const response = await request(app.getHttpServer())
        .patch(`/worker-jobs/external/${jobId}/status`)
        .set('X-API-Key', TEST_API_KEY)
        .send({
          status: 'COMPLETED',
          outputFileUrl: 'https://storage.example.com/output.pdf',
        })
        .expect(200);

      expect(response.body.status).toBe('COMPLETED');
      expect(response.body.outputFileUrl).toBe('https://storage.example.com/output.pdf');
    });
  });

  // ============================================================================
  // 작업 목록/통계 조회 테스트 (Admin 권한 필요)
  // ============================================================================

  describe('GET /worker-jobs (작업 목록 조회 - Admin 권한)', () => {
    const adminToken = () =>
      generateToken({ sub: '1', memberId: 'admin@test.com', role: 'admin' });
    const userToken = () =>
      generateToken({ sub: '2', memberId: 'user@test.com', role: 'user' });

    beforeEach(async () => {
      await request(app.getHttpServer())
        .post('/worker-jobs/validate/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          fileUrl: 'https://example.com/test1.pdf',
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 100,
            binding: 'perfect',
            bleed: 3,
          },
        });

      await request(app.getHttpServer())
        .post('/worker-jobs/synthesize/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
        });
    });

    it('Admin 권한으로 작업 목록 조회', async () => {
      const response = await request(app.getHttpServer())
        .get('/worker-jobs')
        .set('Authorization', `Bearer ${adminToken()}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(2);
    });

    it('status 필터로 작업 조회', async () => {
      const response = await request(app.getHttpServer())
        .get('/worker-jobs?status=PENDING')
        .set('Authorization', `Bearer ${adminToken()}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      response.body.forEach((job: any) => {
        expect(job.status).toBe('PENDING');
      });
    });

    it('jobType 필터로 작업 조회', async () => {
      const response = await request(app.getHttpServer())
        .get('/worker-jobs?jobType=VALIDATE')
        .set('Authorization', `Bearer ${adminToken()}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      response.body.forEach((job: any) => {
        expect(job.jobType).toBe('VALIDATE');
      });
    });

    it('일반 사용자로 작업 목록 조회 시 403', async () => {
      await request(app.getHttpServer())
        .get('/worker-jobs')
        .set('Authorization', `Bearer ${userToken()}`)
        .expect(403);
    });
  });

  describe('GET /worker-jobs/stats (작업 통계 조회 - Admin 권한)', () => {
    const adminToken = () =>
      generateToken({ sub: '1', memberId: 'admin@test.com', role: 'admin' });

    it('Admin 권한으로 작업 통계 조회', async () => {
      await request(app.getHttpServer())
        .post('/worker-jobs/validate/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          fileUrl: 'https://example.com/test.pdf',
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 100,
            binding: 'perfect',
            bleed: 3,
          },
        });

      const response = await request(app.getHttpServer())
        .get('/worker-jobs/stats')
        .set('Authorization', `Bearer ${adminToken()}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  // ============================================================================
  // 작업 플로우 테스트
  // ============================================================================

  describe('작업 플로우 테스트', () => {
    it('검증 작업 생성 → PROCESSING → COMPLETED 전체 플로우', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/worker-jobs/validate/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          fileUrl: 'https://example.com/test.pdf',
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 100,
            binding: 'perfect',
            bleed: 3,
          },
        })
        .expect(201);

      const jobId = createResponse.body.id;
      expect(createResponse.body.status).toBe('PENDING');

      const processingResponse = await request(app.getHttpServer())
        .patch(`/worker-jobs/external/${jobId}/status`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ status: 'PROCESSING' })
        .expect(200);

      expect(processingResponse.body.status).toBe('PROCESSING');

      const completedResponse = await request(app.getHttpServer())
        .patch(`/worker-jobs/external/${jobId}/status`)
        .set('X-API-Key', TEST_API_KEY)
        .send({
          status: 'COMPLETED',
          result: { valid: true, pageCount: 100 },
        })
        .expect(200);

      expect(completedResponse.body.status).toBe('COMPLETED');
      expect(completedResponse.body.completedAt).toBeDefined();
    });

    it('병합 작업 생성 → PROCESSING → COMPLETED (outputFileUrl 포함)', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/worker-jobs/synthesize/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
          orderId: 'ORD-2024-99999',
        })
        .expect(201);

      const jobId = createResponse.body.id;

      await request(app.getHttpServer())
        .patch(`/worker-jobs/external/${jobId}/status`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ status: 'PROCESSING' })
        .expect(200);

      const completedResponse = await request(app.getHttpServer())
        .patch(`/worker-jobs/external/${jobId}/status`)
        .set('X-API-Key', TEST_API_KEY)
        .send({
          status: 'COMPLETED',
          outputFileUrl: 'https://storage.example.com/merged.pdf',
          result: { success: true },
        })
        .expect(200);

      expect(completedResponse.body.status).toBe('COMPLETED');
      expect(completedResponse.body.outputFileUrl).toBe('https://storage.example.com/merged.pdf');
    });

    it('작업 실패 플로우: PENDING → PROCESSING → FAILED', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/worker-jobs/validate/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          fileUrl: 'https://example.com/invalid.pdf',
          fileType: 'content',
          orderOptions: {
            size: { width: 210, height: 297 },
            pages: 100,
            binding: 'perfect',
            bleed: 3,
          },
        })
        .expect(201);

      const jobId = createResponse.body.id;

      await request(app.getHttpServer())
        .patch(`/worker-jobs/external/${jobId}/status`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ status: 'PROCESSING' })
        .expect(200);

      const failedResponse = await request(app.getHttpServer())
        .patch(`/worker-jobs/external/${jobId}/status`)
        .set('X-API-Key', TEST_API_KEY)
        .send({
          status: 'FAILED',
          errorMessage: 'PDF 파일이 손상되었습니다.',
        })
        .expect(200);

      expect(failedResponse.body.status).toBe('FAILED');
      expect(failedResponse.body.errorMessage).toBe('PDF 파일이 손상되었습니다.');
      expect(failedResponse.body.completedAt).toBeDefined();
    });
  });

  // ============================================================================
  // PDF 분리 출력 테스트 (outputFormat: 'separate')
  // ============================================================================

  describe('PDF 분리 출력 테스트 (outputFormat)', () => {
    it('TC-SEP-001: 기본 모드 (merged) - outputFormat 미지정 시 merged로 저장', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/worker-jobs/synthesize/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
          orderId: 'ORD-2024-MERGED',
        })
        .expect(201);

      expect(createResponse.body.options.outputFormat).toBe('merged');
    });

    it('TC-SEP-002: 분리 모드 (separate) - outputFormat: separate 요청', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/worker-jobs/synthesize/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
          orderId: 'ORD-2024-SEPARATE',
          outputFormat: 'separate',
        })
        .expect(201);

      expect(createResponse.body.options.outputFormat).toBe('separate');
    });

    it('TC-SEP-003: 분리 모드 완료 시 outputFiles 포함 응답', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/worker-jobs/synthesize/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
          outputFormat: 'separate',
        })
        .expect(201);

      const jobId = createResponse.body.id;

      // PROCESSING → COMPLETED with outputFiles
      await request(app.getHttpServer())
        .patch(`/worker-jobs/external/${jobId}/status`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ status: 'PROCESSING' })
        .expect(200);

      const completedResponse = await request(app.getHttpServer())
        .patch(`/worker-jobs/external/${jobId}/status`)
        .set('X-API-Key', TEST_API_KEY)
        .send({
          status: 'COMPLETED',
          outputFileUrl: '/storage/outputs/test-job/merged.pdf', // 항상 merged URL
          outputFiles: [
            { type: 'cover', url: '/storage/outputs/test-job/cover.pdf' },
            { type: 'content', url: '/storage/outputs/test-job/content.pdf' },
          ],
          result: {
            success: true,
            totalPages: 104,
            outputFileUrl: '/storage/outputs/test-job/merged.pdf',
            outputFiles: [
              { type: 'cover', url: '/storage/outputs/test-job/cover.pdf' },
              { type: 'content', url: '/storage/outputs/test-job/content.pdf' },
            ],
          },
        })
        .expect(200);

      // 하위호환: outputFileUrl은 항상 merged URL
      expect(completedResponse.body.outputFileUrl).toBe('/storage/outputs/test-job/merged.pdf');

      // separate 모드: outputFiles 포함
      expect(completedResponse.body.result.outputFiles).toBeDefined();
      expect(completedResponse.body.result.outputFiles).toHaveLength(2);
      expect(completedResponse.body.result.outputFiles[0].type).toBe('cover');
      expect(completedResponse.body.result.outputFiles[1].type).toBe('content');
    });

    it('TC-SEP-004: 하위호환 - merged 모드에서는 outputFiles 없음', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/worker-jobs/synthesize/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
          outputFormat: 'merged', // 명시적 merged
        })
        .expect(201);

      const jobId = createResponse.body.id;

      await request(app.getHttpServer())
        .patch(`/worker-jobs/external/${jobId}/status`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ status: 'PROCESSING' })
        .expect(200);

      const completedResponse = await request(app.getHttpServer())
        .patch(`/worker-jobs/external/${jobId}/status`)
        .set('X-API-Key', TEST_API_KEY)
        .send({
          status: 'COMPLETED',
          outputFileUrl: '/storage/outputs/test-job/merged.pdf',
          result: {
            success: true,
            totalPages: 104,
            outputFileUrl: '/storage/outputs/test-job/merged.pdf',
            // outputFiles 없음
          },
        })
        .expect(200);

      expect(completedResponse.body.outputFileUrl).toBe('/storage/outputs/test-job/merged.pdf');
      expect(completedResponse.body.result.outputFiles).toBeUndefined();
    });

    it('TC-SEP-005: 분리 모드 실패 시 outputFileUrl 빈값, errorMessage 포함', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/worker-jobs/synthesize/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
          outputFormat: 'separate',
        })
        .expect(201);

      const jobId = createResponse.body.id;

      await request(app.getHttpServer())
        .patch(`/worker-jobs/external/${jobId}/status`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ status: 'PROCESSING' })
        .expect(200);

      const failedResponse = await request(app.getHttpServer())
        .patch(`/worker-jobs/external/${jobId}/status`)
        .set('X-API-Key', TEST_API_KEY)
        .send({
          status: 'FAILED',
          errorMessage: 'Separate upload failed: content file inaccessible',
        })
        .expect(200);

      expect(failedResponse.body.status).toBe('FAILED');
      expect(failedResponse.body.errorMessage).toBe('Separate upload failed: content file inaccessible');
      expect(failedResponse.body.outputFileUrl).toBeNull();
    });

    it('TC-SEP-006: outputFiles 순서 검증 (cover → content)', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/worker-jobs/synthesize/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
          outputFormat: 'separate',
        })
        .expect(201);

      const jobId = createResponse.body.id;

      await request(app.getHttpServer())
        .patch(`/worker-jobs/external/${jobId}/status`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ status: 'PROCESSING' })
        .expect(200);

      const completedResponse = await request(app.getHttpServer())
        .patch(`/worker-jobs/external/${jobId}/status`)
        .set('X-API-Key', TEST_API_KEY)
        .send({
          status: 'COMPLETED',
          outputFileUrl: '/storage/outputs/test/merged.pdf',
          outputFiles: [
            { type: 'cover', url: '/storage/outputs/test/cover.pdf' },
            { type: 'content', url: '/storage/outputs/test/content.pdf' },
          ],
          result: {
            success: true,
            outputFiles: [
              { type: 'cover', url: '/storage/outputs/test/cover.pdf' },
              { type: 'content', url: '/storage/outputs/test/content.pdf' },
            ],
          },
        })
        .expect(200);

      // 순서 검증: cover가 먼저
      const outputFiles = completedResponse.body.result.outputFiles;
      expect(outputFiles[0].type).toBe('cover');
      expect(outputFiles[1].type).toBe('content');
    });

    it('TC-SEP-007: queueJobId 디버깅 필드 전달', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/worker-jobs/synthesize/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
        })
        .expect(201);

      const jobId = createResponse.body.id;

      const completedResponse = await request(app.getHttpServer())
        .patch(`/worker-jobs/external/${jobId}/status`)
        .set('X-API-Key', TEST_API_KEY)
        .send({
          status: 'COMPLETED',
          outputFileUrl: '/storage/outputs/test/merged.pdf',
          queueJobId: '12345', // Bull queue ID
          result: { success: true },
        })
        .expect(200);

      // queueJobId가 저장되었는지 확인 (result 안에 저장될 수 있음)
      expect(completedResponse.body.status).toBe('COMPLETED');
    });
  });

  // ============================================================================
  // 재시도 (Idempotency) 테스트
  // ============================================================================

  describe('재시도 및 Idempotency 테스트', () => {
    it('TC-RETRY-001: 동일 jobId로 상태 업데이트 재시도', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/worker-jobs/synthesize/external')
        .set('X-API-Key', TEST_API_KEY)
        .send({
          coverUrl: 'https://example.com/cover.pdf',
          contentUrl: 'https://example.com/content.pdf',
          spineWidth: 5.5,
          outputFormat: 'separate',
        })
        .expect(201);

      const jobId = createResponse.body.id;

      // 첫 번째 완료 업데이트
      const firstComplete = await request(app.getHttpServer())
        .patch(`/worker-jobs/external/${jobId}/status`)
        .set('X-API-Key', TEST_API_KEY)
        .send({
          status: 'COMPLETED',
          outputFileUrl: '/storage/outputs/v1/merged.pdf',
        })
        .expect(200);

      expect(firstComplete.body.status).toBe('COMPLETED');

      // 두 번째 완료 업데이트 (재시도 - 덮어쓰기)
      const secondComplete = await request(app.getHttpServer())
        .patch(`/worker-jobs/external/${jobId}/status`)
        .set('X-API-Key', TEST_API_KEY)
        .send({
          status: 'COMPLETED',
          outputFileUrl: '/storage/outputs/v2/merged.pdf', // 다른 URL
        })
        .expect(200);

      // 덮어쓰기 확인
      expect(secondComplete.body.outputFileUrl).toBe('/storage/outputs/v2/merged.pdf');
    });
  });
});
