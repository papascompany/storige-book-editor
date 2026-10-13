/**
 * 편집 세션 플로우 E2E 테스트
 *
 * 테스트 케이스 참조: docs/TEST_CASES.md - Section 3. 편집 세션 테스트
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import request from 'supertest';
import { TypeOrmModule, getRepositoryToken, InjectRepository } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { Repository } from 'typeorm';
import cookieParser from 'cookie-parser';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { EditSessionsController } from '../src/edit-sessions/edit-sessions.controller';
import { EditSessionsService } from '../src/edit-sessions/edit-sessions.service';
import {
  TestEditSessionEntity,
  SessionStatus as TestSessionStatus,
  SessionMode as TestSessionMode,
  WorkerStatus as TestWorkerStatus,
} from './entities/test-edit-session.entity';
import { WorkerJobsService } from '../src/worker-jobs/worker-jobs.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { APP_GUARD } from '@nestjs/core';
import { SitesServiceStubModule } from './support/sites-service.stub';

// 테스트용 상수
const TEST_JWT_SECRET = 'test-jwt-secret-for-e2e-testing';
const TEST_MEMBER = {
  memberSeqno: 99999,
  memberId: 'test@example.com',
  memberName: '테스트유저',
};
const TEST_MEMBER_2 = {
  memberSeqno: 88888,
  memberId: 'test2@example.com',
  memberName: '테스트유저2',
};

// 테스트용 JwtStrategy (UserRepository 의존성 없음)
@Injectable()
class TestJwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: TEST_JWT_SECRET,
    });
  }

  async validate(payload: any) {
    return {
      userId: String(payload.sub),
      email: payload.memberId,
      name: payload.memberName || '',
      role: 'customer',
      source: 'shop',
      permissions: ['edit', 'upload', 'validate'],
    };
  }
}

// 테스트용 EditSessionsService (실제 서비스와 동일한 메서드 시그니처)
@Injectable()
class TestEditSessionsService {
  constructor(
    @InjectRepository(TestEditSessionEntity)
    private sessionRepository: Repository<TestEditSessionEntity>,
    private workerJobsService: WorkerJobsService,
  ) {}

  // 테넌트 판정은 실 서비스의 순수 규칙을 그대로 쓴다(저장소·외부 의존 없음). 상세 조회가
  // 소유자 판정 전에 assertTenantScope 를 부른다(edit-sessions.controller.ts findOne).
  isInTenantScope = EditSessionsService.prototype.isInTenantScope;
  isPartnerOperatorInScope = EditSessionsService.prototype.isPartnerOperatorInScope;
  assertTenantScope = EditSessionsService.prototype.assertTenantScope;

  async create(dto: any): Promise<TestEditSessionEntity> {
    const session = this.sessionRepository.create({
      // 실 서비스와 같은 규칙 — orderSeqno 미전송은 0(Phase 4, edit-sessions.service.ts create).
      orderSeqno: dto.orderSeqno ?? 0,
      memberSeqno: dto.memberSeqno,
      mode: dto.mode,
      status: TestSessionStatus.DRAFT,
      canvasData: dto.canvasData ?? null,
      templateSetId: dto.templateSetId ?? null,
      callbackUrl: dto.callbackUrl ?? null,
      workerStatus: null,
    });
    return this.sessionRepository.save(session);
  }

  async findByOrderSeqno(orderSeqno: number): Promise<TestEditSessionEntity[]> {
    return this.sessionRepository.find({
      where: { orderSeqno },
      order: { createdAt: 'DESC' },
    });
  }

  async findByMemberSeqno(memberSeqno: number): Promise<TestEditSessionEntity[]> {
    return this.sessionRepository.find({
      where: { memberSeqno },
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string): Promise<TestEditSessionEntity> {
    const session = await this.sessionRepository.findOne({ where: { id } });
    if (!session) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: '편집 세션을 찾을 수 없습니다.',
      });
    }
    return session;
  }

  async update(id: string, dto: any, userId: number): Promise<TestEditSessionEntity> {
    const session = await this.findById(id);

    if (Number(session.memberSeqno) !== userId) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '이 세션을 수정할 권한이 없습니다.',
      });
    }

    if (dto.canvasData !== undefined) session.canvasData = dto.canvasData;
    if (dto.metadata !== undefined) session.metadata = { ...session.metadata, ...dto.metadata };
    if (dto.status !== undefined) {
      session.status = dto.status;
      if (dto.status === TestSessionStatus.COMPLETE) {
        session.completedAt = new Date();
      }
    }

    return this.sessionRepository.save(session);
  }

  async complete(id: string, userId: number): Promise<TestEditSessionEntity> {
    const session = await this.findById(id);

    if (Number(session.memberSeqno) !== userId) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '이 세션을 완료할 권한이 없습니다.',
      });
    }

    if (session.status === TestSessionStatus.COMPLETE) {
      throw new BadRequestException({
        code: 'ALREADY_COMPLETED',
        message: '이미 완료된 세션입니다.',
      });
    }

    session.status = TestSessionStatus.COMPLETE;
    session.completedAt = new Date();
    session.workerStatus = TestWorkerStatus.PENDING;

    // Create validation job (mock)
    await this.workerJobsService.createValidationJob({
      editSessionId: session.id,
      fileType: session.mode === TestSessionMode.COVER ? 'cover' : 'content',
    } as any);

    return this.sessionRepository.save(session);
  }

  async delete(id: string, userId: number): Promise<void> {
    const session = await this.findById(id);

    if (Number(session.memberSeqno) !== userId) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '이 세션을 삭제할 권한이 없습니다.',
      });
    }

    await this.sessionRepository.softDelete(id);
  }

  toResponseDto(session: TestEditSessionEntity): any {
    return {
      id: session.id,
      orderSeqno: Number(session.orderSeqno),
      memberSeqno: Number(session.memberSeqno),
      status: session.status,
      mode: session.mode,
      coverFileId: session.coverFileId,
      contentFileId: session.contentFileId,
      templateSetId: session.templateSetId,
      canvasData: session.canvasData,
      metadata: session.metadata,
      workerStatus: session.workerStatus,
      completedAt: session.completedAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }
}

describe('EditSessionsController (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let editSessionRepository: Repository<TestEditSessionEntity>;
  let validToken: string;
  let validToken2: string;

  const mockWorkerJobsService = {
    createValidationJob: jest.fn().mockResolvedValue({
      id: 'mock-job-id',
      status: 'PENDING',
      jobType: 'VALIDATE',
    }),
  };

  async function createTestSession(
    overrides: Partial<{
      orderSeqno: number;
      memberSeqno: number;
      mode: TestSessionMode;
      status: TestSessionStatus;
      workerStatus: TestWorkerStatus | null;
      canvasData: any;
      templateSetId: string;
    }> = {},
  ): Promise<TestEditSessionEntity> {
    const entity = editSessionRepository.create({
      orderSeqno: overrides.orderSeqno ?? 12345,
      memberSeqno: overrides.memberSeqno ?? TEST_MEMBER.memberSeqno,
      mode: overrides.mode ?? TestSessionMode.COVER,
      status: overrides.status ?? TestSessionStatus.DRAFT,
      workerStatus: overrides.workerStatus ?? null,
      canvasData: overrides.canvasData ?? null,
      templateSetId: overrides.templateSetId ?? null,
    });
    return editSessionRepository.save(entity);
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          driver: require('better-sqlite3'),
          database: ':memory:',
          entities: [TestEditSessionEntity],
          synchronize: true,
          dropSchema: true,
        }),
        TypeOrmModule.forFeature([TestEditSessionEntity]),
        // 운영의 @Global SitesModule 자리 — 외부 라우트의 ApiKeyGuard 가 SitesService 를 주입받는다.
        SitesServiceStubModule,
        PassportModule,
        JwtModule.register({
          secret: TEST_JWT_SECRET,
          signOptions: { expiresIn: '1h' },
        }),
      ],
      controllers: [EditSessionsController],
      providers: [
        { provide: EditSessionsService, useClass: TestEditSessionsService },
        TestJwtStrategy,
        { provide: WorkerJobsService, useValue: mockWorkerJobsService },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
    })
      .overrideProvider('JwtStrategy')
      .useClass(TestJwtStrategy)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();

    jwtService = moduleFixture.get<JwtService>(JwtService);
    editSessionRepository = moduleFixture.get<Repository<TestEditSessionEntity>>(getRepositoryToken(TestEditSessionEntity));

    validToken = jwtService.sign({ sub: TEST_MEMBER.memberSeqno, memberId: TEST_MEMBER.memberId, memberName: TEST_MEMBER.memberName });
    validToken2 = jwtService.sign({ sub: TEST_MEMBER_2.memberSeqno, memberId: TEST_MEMBER_2.memberId, memberName: TEST_MEMBER_2.memberName });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await editSessionRepository.clear();
    jest.clearAllMocks();
  });

  // ============================================================================
  // Section 1: 세션 생성 테스트
  // ============================================================================

  describe('POST /edit-sessions (세션 생성)', () => {
    describe('TC-SESSION-001: 정상적인 세션 생성', () => {
      it('표지 모드로 세션 생성', async () => {
        const response = await request(app.getHttpServer())
          .post('/edit-sessions')
          .set('Authorization', `Bearer ${validToken}`)
          .send({ orderSeqno: 12345, mode: 'cover', callbackUrl: 'https://example.com/callback' })
          .expect(201);

        expect(response.body).toMatchObject({ mode: 'cover', status: 'draft' });
        expect(response.body.id).toBeDefined();
        expect(response.body.orderSeqno).toBe(12345);
        expect(response.body.memberSeqno).toBe(TEST_MEMBER.memberSeqno);
      });

      it('내지 모드로 세션 생성', async () => {
        const response = await request(app.getHttpServer())
          .post('/edit-sessions')
          .set('Authorization', `Bearer ${validToken}`)
          .send({ orderSeqno: 12345, mode: 'content' })
          .expect(201);

        expect(response.body.mode).toBe('content');
      });

      it('템플릿 모드로 세션 생성', async () => {
        const response = await request(app.getHttpServer())
          .post('/edit-sessions')
          .set('Authorization', `Bearer ${validToken}`)
          .send({ orderSeqno: 12345, mode: 'template', templateSetId: 'template-123' })
          .expect(201);

        expect(response.body.mode).toBe('template');
        expect(response.body.templateSetId).toBe('template-123');
      });

      it('캔버스 데이터와 함께 세션 생성', async () => {
        const response = await request(app.getHttpServer())
          .post('/edit-sessions')
          .set('Authorization', `Bearer ${validToken}`)
          .send({ orderSeqno: 12345, mode: 'cover', canvasData: { objects: [{ type: 'rect' }] } })
          .expect(201);

        expect(response.body.canvasData.objects).toHaveLength(1);
      });
    });

    describe('TC-SESSION-002: 잘못된 입력으로 세션 생성 실패', () => {
      // Phase 4 이후 orderSeqno 는 선택이다(CreateEditSessionDto @IsOptional). 회원 토큰으로
      // 빠뜨리면 400 이 아니라 orderSeqno 0 세션이 만들어진다 — 현행 계약을 고정한다.
      it('orderSeqno 누락 → 400 이 아니라 0 으로 생성', async () => {
        const response = await request(app.getHttpServer())
          .post('/edit-sessions')
          .set('Authorization', `Bearer ${validToken}`)
          .send({ mode: 'cover' })
          .expect(201);

        expect(response.body.orderSeqno).toBe(0);
        expect(response.body.memberSeqno).toBe(TEST_MEMBER.memberSeqno);
      });

      it('mode 누락', async () => {
        await request(app.getHttpServer())
          .post('/edit-sessions')
          .set('Authorization', `Bearer ${validToken}`)
          .send({ orderSeqno: 12345 })
          .expect(400);
      });

      it('잘못된 mode 값', async () => {
        await request(app.getHttpServer())
          .post('/edit-sessions')
          .set('Authorization', `Bearer ${validToken}`)
          .send({ orderSeqno: 12345, mode: 'invalid' })
          .expect(400);
      });
    });

    describe('인증 실패', () => {
      it('토큰 없이 요청', async () => {
        await request(app.getHttpServer())
          .post('/edit-sessions')
          .send({ orderSeqno: 12345, mode: 'cover' })
          .expect(401);
      });

      it('잘못된 토큰', async () => {
        await request(app.getHttpServer())
          .post('/edit-sessions')
          .set('Authorization', 'Bearer invalid-token')
          .send({ orderSeqno: 12345, mode: 'cover' })
          .expect(401);
      });
    });
  });

  // ============================================================================
  // Section 2: 세션 조회 테스트
  // ============================================================================

  describe('GET /edit-sessions (세션 목록 조회)', () => {
    it('자신의 세션 목록 조회', async () => {
      const session = await createTestSession();

      const response = await request(app.getHttpServer())
        .get('/edit-sessions')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body.sessions).toHaveLength(1);
      expect(response.body.sessions[0].id).toBe(session.id);
      expect(response.body.total).toBe(1);
    });

    it('다른 사용자의 세션은 조회되지 않음', async () => {
      await createTestSession();

      const response = await request(app.getHttpServer())
        .get('/edit-sessions')
        .set('Authorization', `Bearer ${validToken2}`)
        .expect(200);

      expect(response.body.sessions).toHaveLength(0);
    });

    it('orderSeqno로 필터링', async () => {
      await createTestSession({ orderSeqno: 12345 });
      await createTestSession({ orderSeqno: 99999 });

      const response = await request(app.getHttpServer())
        .get('/edit-sessions?orderSeqno=12345')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body.sessions).toHaveLength(1);
      expect(response.body.sessions[0].orderSeqno).toBe(12345);
    });
  });

  describe('GET /edit-sessions/:id (세션 상세 조회)', () => {
    it('세션 상세 조회', async () => {
      const session = await createTestSession({ canvasData: { objects: [] } });

      const response = await request(app.getHttpServer())
        .get(`/edit-sessions/${session.id}`)
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body.id).toBe(session.id);
      expect(response.body.canvasData).toBeDefined();
    });

    it('존재하지 않는 세션 조회 - 404', async () => {
      await request(app.getHttpServer())
        .get('/edit-sessions/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(404);
    });
  });

  // ============================================================================
  // Section 3: 세션 수정 테스트
  // ============================================================================

  describe('PATCH /edit-sessions/:id (세션 수정)', () => {
    describe('TC-SESSION-003: 세션 자동 저장', () => {
      it('캔버스 데이터 업데이트', async () => {
        const session = await createTestSession();

        const response = await request(app.getHttpServer())
          .patch(`/edit-sessions/${session.id}`)
          .set('Authorization', `Bearer ${validToken}`)
          .send({ canvasData: { objects: [{ type: 'rect' }, { type: 'text' }] } })
          .expect(200);

        expect(response.body.canvasData.objects).toHaveLength(2);
      });

      it('상태 변경', async () => {
        const session = await createTestSession();

        const response = await request(app.getHttpServer())
          .patch(`/edit-sessions/${session.id}`)
          .set('Authorization', `Bearer ${validToken}`)
          .send({ status: 'editing' })
          .expect(200);

        expect(response.body.status).toBe('editing');
      });

      it('메타데이터 업데이트', async () => {
        const session = await createTestSession();

        const response = await request(app.getHttpServer())
          .patch(`/edit-sessions/${session.id}`)
          .set('Authorization', `Bearer ${validToken}`)
          .send({ metadata: { version: 1 } })
          .expect(200);

        expect(response.body.metadata.version).toBe(1);
      });
    });

    describe('TC-SESSION-004: 다른 사용자의 세션 수정 시도', () => {
      it('403 Forbidden', async () => {
        const session = await createTestSession();

        await request(app.getHttpServer())
          .patch(`/edit-sessions/${session.id}`)
          .set('Authorization', `Bearer ${validToken2}`)
          .send({ status: 'editing' })
          .expect(403);
      });
    });

    it('존재하지 않는 세션 수정 - 404', async () => {
      await request(app.getHttpServer())
        .patch('/edit-sessions/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ status: 'editing' })
        .expect(404);
    });
  });

  // ============================================================================
  // Section 4: 세션 완료 테스트
  // ============================================================================

  describe('PATCH /edit-sessions/:id/complete (세션 완료)', () => {
    describe('TC-SESSION-005: 세션 정상 완료', () => {
      it('draft -> complete 변경', async () => {
        const session = await createTestSession();

        const response = await request(app.getHttpServer())
          .patch(`/edit-sessions/${session.id}/complete`)
          .set('Authorization', `Bearer ${validToken}`)
          .expect(200);

        expect(response.body.status).toBe('complete');
        expect(response.body.workerStatus).toBe('pending');
      });

      it('editing -> complete 변경', async () => {
        const session = await createTestSession({ status: TestSessionStatus.EDITING });

        const response = await request(app.getHttpServer())
          .patch(`/edit-sessions/${session.id}/complete`)
          .set('Authorization', `Bearer ${validToken}`)
          .expect(200);

        expect(response.body.status).toBe('complete');
      });

      it('완료 시 WorkerJobsService.createValidationJob 호출', async () => {
        const session = await createTestSession();

        await request(app.getHttpServer())
          .patch(`/edit-sessions/${session.id}/complete`)
          .set('Authorization', `Bearer ${validToken}`)
          .expect(200);

        expect(mockWorkerJobsService.createValidationJob).toHaveBeenCalled();
      });
    });

    describe('TC-SESSION-006: 이미 완료된 세션 재완료 시도', () => {
      it('400 Bad Request', async () => {
        const session = await createTestSession({ status: TestSessionStatus.COMPLETE, workerStatus: TestWorkerStatus.VALIDATED });

        await request(app.getHttpServer())
          .patch(`/edit-sessions/${session.id}/complete`)
          .set('Authorization', `Bearer ${validToken}`)
          .expect(400);
      });
    });

    it('다른 사용자의 세션 완료 시도 - 403', async () => {
      const session = await createTestSession();

      await request(app.getHttpServer())
        .patch(`/edit-sessions/${session.id}/complete`)
        .set('Authorization', `Bearer ${validToken2}`)
        .expect(403);
    });
  });

  // ============================================================================
  // Section 5: 세션 삭제 테스트
  // ============================================================================

  describe('DELETE /edit-sessions/:id (세션 삭제)', () => {
    it('자신의 세션 삭제', async () => {
      const session = await createTestSession();

      const response = await request(app.getHttpServer())
        .delete(`/edit-sessions/${session.id}`)
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      // soft delete 확인
      await request(app.getHttpServer())
        .get(`/edit-sessions/${session.id}`)
        .set('Authorization', `Bearer ${validToken}`)
        .expect(404);
    });

    it('다른 사용자의 세션 삭제 시도 - 403', async () => {
      const session = await createTestSession();

      await request(app.getHttpServer())
        .delete(`/edit-sessions/${session.id}`)
        .set('Authorization', `Bearer ${validToken2}`)
        .expect(403);
    });

    it('존재하지 않는 세션 삭제 - 404', async () => {
      await request(app.getHttpServer())
        .delete('/edit-sessions/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(404);
    });
  });

  // ============================================================================
  // Section 6: 세션 상태 전이 테스트
  // ============================================================================

  describe('세션 상태 전이', () => {
    it('draft -> editing -> complete 정상 전이', async () => {
      // 1. 생성 (draft)
      const createRes = await request(app.getHttpServer())
        .post('/edit-sessions')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ orderSeqno: 12345, mode: 'cover' })
        .expect(201);

      expect(createRes.body.status).toBe('draft');
      const id = createRes.body.id;

      // 2. 편집 (editing)
      const editRes = await request(app.getHttpServer())
        .patch(`/edit-sessions/${id}`)
        .set('Authorization', `Bearer ${validToken}`)
        .send({ status: 'editing', canvasData: { objects: [{ type: 'rect' }] } })
        .expect(200);

      expect(editRes.body.status).toBe('editing');

      // 3. 완료 (complete)
      const completeRes = await request(app.getHttpServer())
        .patch(`/edit-sessions/${id}/complete`)
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(completeRes.body.status).toBe('complete');
    });
  });

  // ============================================================================
  // Section 7: WorkerStatus 테스트
  // ============================================================================

  describe('WorkerStatus 관련 테스트', () => {
    it('세션 생성 시 workerStatus는 null', async () => {
      const response = await request(app.getHttpServer())
        .post('/edit-sessions')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ orderSeqno: 12345, mode: 'cover' })
        .expect(201);

      expect(response.body.workerStatus).toBeNull();
    });

    it('세션 완료 시 workerStatus는 pending', async () => {
      const session = await createTestSession();

      const response = await request(app.getHttpServer())
        .patch(`/edit-sessions/${session.id}/complete`)
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body.workerStatus).toBe('pending');
    });
  });
});
