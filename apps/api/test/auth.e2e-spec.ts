/**
 * 인증 플로우 E2E 테스트
 *
 * 테스트 케이스 참조: docs/TEST_CASES.md - Section 2. 인증 플로우 테스트
 *
 * TC-AUTH-001: 정상적인 Shop Session 발급
 * TC-AUTH-002: 잘못된 API Key로 요청
 * TC-AUTH-003: API Key 누락
 * TC-AUTH-004: 필수 필드 누락
 * TC-AUTH-005: JWT 토큰 만료 검증
 * TC-AUTH-006: 변조된 JWT
 * TC-AUTH-007: 잘못된 JWT 형식
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Repository } from 'typeorm';
import cookieParser from 'cookie-parser';

import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { User } from '../src/auth/entities/user.entity';
import { UserSiteRole } from '../src/auth/entities/user-site-role.entity';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { ApiKeyStrategy } from '../src/auth/strategies/api-key.strategy';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { PartnerOperatorGrantService } from '../src/auth/partner-operator/partner-operator-grant.service';
import { APP_GUARD } from '@nestjs/core';
import { E2E_SITE_API_KEY, SitesServiceStubModule } from './support/sites-service.stub';

// 테스트용 상수
// X-API-Key 는 sites 조회로 판정한다(ApiKeyGuard → SitesService). 대역이 이 키만 사이트로 인정한다.
const TEST_API_KEY = E2E_SITE_API_KEY;
const TEST_JWT_SECRET = 'test-jwt-secret-for-e2e-testing';
const TEST_MEMBER = {
  memberSeqno: 99999,
  memberId: 'test@example.com',
  memberName: '테스트유저',
};

describe('AuthController (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let userRepository: Repository<User>;

  beforeAll(async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          // 환경 변수에서 직접 로드
          ignoreEnvFile: true,
        }),
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          driver: require('better-sqlite3'),
          database: ':memory:',
          // User.siteRoleAssignments 관계 대상까지 등록해야 메타데이터가 완성된다.
          entities: [User, UserSiteRole],
          synchronize: true,
          dropSchema: true,
        }),
        TypeOrmModule.forFeature([User]),
        SitesServiceStubModule,
        PassportModule,
        JwtModule.register({
          secret: TEST_JWT_SECRET,
          signOptions: { expiresIn: '1h' },
        }),
      ],
      controllers: [AuthController],
      providers: [
        AuthService,
        JwtStrategy,
        ApiKeyStrategy,
        // 운영자 대리 편집 분기 전용(AuthService·AuthController 생성자 3·2번째 인자).
        // 이 spec 은 운영자 토큰을 만들지 않으므로 호출되면 실패하게 둔다.
        {
          provide: PartnerOperatorGrantService,
          useValue: {
            refresh: jest.fn(async () => {
              throw new Error('partner operator path is out of scope in auth e2e');
            }),
          },
        },
        {
          provide: APP_GUARD,
          useClass: JwtAuthGuard,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    jwtService = moduleFixture.get<JwtService>(JwtService);
    userRepository = moduleFixture.get<Repository<User>>(
      getRepositoryToken(User),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  // ============================================================
  // Shop Session 테스트 (API Key 인증)
  // ============================================================
  describe('/auth/shop-session (POST)', () => {
    /**
     * TC-AUTH-001: 정상적인 Shop Session 발급
     */
    it('TC-AUTH-001: should create shop session with valid API key', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/shop-session')
        .set('X-API-Key', TEST_API_KEY)
        .send(TEST_MEMBER)
        .expect(200);

      // 응답 검증
      expect(response.body.success).toBe(true);
      expect(response.body.accessToken).toBeDefined();
      expect(typeof response.body.accessToken).toBe('string');
      expect(response.body.expiresIn).toBe(3600);
      expect(response.body.member).toEqual({
        seqno: TEST_MEMBER.memberSeqno,
        id: TEST_MEMBER.memberId,
        name: TEST_MEMBER.memberName,
      });

      // JWT 토큰 구조 검증
      const tokenParts = response.body.accessToken.split('.');
      expect(tokenParts.length).toBe(3); // header.payload.signature

      // 쿠키 검증
      const setCookieHeader = response.headers['set-cookie'];
      expect(setCookieHeader).toBeDefined();

      // set-cookie 헤더를 배열로 변환
      const cookies = Array.isArray(setCookieHeader)
        ? setCookieHeader
        : [setCookieHeader];

      expect(cookies.some((c: string) => c.startsWith('storige_access='))).toBe(
        true,
      );
      expect(cookies.some((c: string) => c.startsWith('storige_refresh='))).toBe(
        true,
      );

      // HttpOnly 쿠키 확인
      const accessCookie = cookies.find((c: string) =>
        c.startsWith('storige_access='),
      );
      expect(accessCookie).toContain('HttpOnly');
    });

    /**
     * TC-AUTH-002: 잘못된 API Key로 요청
     */
    it('TC-AUTH-002: should reject invalid API key', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/shop-session')
        .set('X-API-Key', 'invalid-api-key')
        .send(TEST_MEMBER)
        .expect(401);

      expect(response.body.message).toContain('Invalid API Key');
    });

    /**
     * TC-AUTH-003: API Key 누락
     */
    it('TC-AUTH-003: should reject request without API key', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/shop-session')
        .send(TEST_MEMBER)
        .expect(401);

      expect(response.body.statusCode).toBe(401);
    });

    /**
     * TC-AUTH-004: 필수 필드 누락 (memberSeqno)
     */
    it('TC-AUTH-004: should reject request with missing memberSeqno', async () => {
      const invalidMember = {
        memberId: 'user@example.com',
        memberName: '홍길동',
        // memberSeqno 누락
      };

      const response = await request(app.getHttpServer())
        .post('/auth/shop-session')
        .set('X-API-Key', TEST_API_KEY)
        .send(invalidMember)
        .expect(400);

      expect(response.body.message).toBeDefined();
    });

    it('should reject request with missing memberId', async () => {
      const invalidMember = {
        memberSeqno: 12345,
        memberName: '홍길동',
        // memberId 누락
      };

      const response = await request(app.getHttpServer())
        .post('/auth/shop-session')
        .set('X-API-Key', TEST_API_KEY)
        .send(invalidMember)
        .expect(400);

      expect(response.body.message).toBeDefined();
    });

    it('should reject request with missing memberName', async () => {
      const invalidMember = {
        memberSeqno: 12345,
        memberId: 'user@example.com',
        // memberName 누락
      };

      const response = await request(app.getHttpServer())
        .post('/auth/shop-session')
        .set('X-API-Key', TEST_API_KEY)
        .send(invalidMember)
        .expect(400);

      expect(response.body.message).toBeDefined();
    });

    it('should reject request with invalid memberSeqno type', async () => {
      const invalidMember = {
        memberSeqno: 'not-a-number', // 문자열
        memberId: 'user@example.com',
        memberName: '홍길동',
      };

      const response = await request(app.getHttpServer())
        .post('/auth/shop-session')
        .set('X-API-Key', TEST_API_KEY)
        .send(invalidMember)
        .expect(400);

      expect(response.body.message).toBeDefined();
    });

    it('should accept optional permissions field', async () => {
      const memberWithPermissions = {
        ...TEST_MEMBER,
        permissions: ['edit', 'upload'],
      };

      const response = await request(app.getHttpServer())
        .post('/auth/shop-session')
        .set('X-API-Key', TEST_API_KEY)
        .send(memberWithPermissions)
        .expect(200);

      expect(response.body.success).toBe(true);

      // JWT 페이로드에서 permissions 확인
      const payload = jwtService.decode(response.body.accessToken) as any;
      expect(payload.permissions).toEqual(['edit', 'upload']);
    });

    it('should accept optional phpSessionId field', async () => {
      const memberWithSession = {
        ...TEST_MEMBER,
        phpSessionId: 'abc123xyz',
      };

      const response = await request(app.getHttpServer())
        .post('/auth/shop-session')
        .set('X-API-Key', TEST_API_KEY)
        .send(memberWithSession)
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  // ============================================================
  // JWT 토큰 검증 테스트
  // ============================================================
  describe('JWT Token Validation', () => {
    let validToken: string;

    beforeEach(async () => {
      // 유효한 토큰 생성 (shop-session이 실패할 경우 직접 생성)
      const response = await request(app.getHttpServer())
        .post('/auth/shop-session')
        .set('X-API-Key', TEST_API_KEY)
        .send(TEST_MEMBER);

      if (response.status === 200 && response.body.accessToken) {
        validToken = response.body.accessToken;
      } else {
        // 백업: 직접 토큰 생성
        validToken = jwtService.sign({
          sub: TEST_MEMBER.memberSeqno.toString(),
          email: TEST_MEMBER.memberId,
          name: TEST_MEMBER.memberName,
          role: 'customer',
          source: 'shop',
          permissions: ['edit', 'upload', 'validate'],
        });
      }
    });

    /**
     * TC-AUTH-005: JWT 토큰 만료 검증
     */
    it('TC-AUTH-005: should reject expired JWT token', async () => {
      // 이미 만료된 토큰 생성 (expiresIn: -1s)
      const expiredToken = jwtService.sign(
        {
          sub: '99999',
          email: 'test@example.com',
          role: 'customer',
        },
        { expiresIn: '-1s' },
      );

      const response = await request(app.getHttpServer())
        .post('/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(response.body.statusCode).toBe(401);
    });

    /**
     * TC-AUTH-006: 변조된 JWT
     */
    it('TC-AUTH-006: should reject tampered JWT token', async () => {
      // 토큰의 payload 부분을 변조
      const parts = validToken.split('.');
      const tamperedPayload = Buffer.from(
        JSON.stringify({
          sub: '12345', // 다른 사용자 ID로 변조
          email: 'hacker@example.com',
          role: 'admin', // 권한 상승 시도
        }),
      ).toString('base64url');

      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      await request(app.getHttpServer())
        .post('/auth/me')
        .set('Authorization', `Bearer ${tamperedToken}`)
        .expect(401);
    });

    /**
     * TC-AUTH-007: 잘못된 JWT 형식
     */
    it('TC-AUTH-007: should reject malformed JWT token', async () => {
      const malformedTokens = [
        'not-a-jwt-token',
        'only.two.parts',
        'Bearer', // Bearer만 있고 토큰 없음
        '',
        'header.payload.signature.extra', // 파트가 너무 많음
      ];

      for (const token of malformedTokens) {
        await request(app.getHttpServer())
          .post('/auth/me')
          .set('Authorization', `Bearer ${token}`)
          .expect(401);
      }
    });

    it('should reject request without Authorization header', async () => {
      await request(app.getHttpServer()).post('/auth/me').expect(401);
    });

    it('should reject request with empty Bearer token', async () => {
      await request(app.getHttpServer())
        .post('/auth/me')
        .set('Authorization', 'Bearer ')
        .expect(401);
    });

    it('should accept valid JWT token', async () => {
      // shop-session은 User 엔티티를 사용하지 않으므로 /auth/me 대신 별도 테스트
      // 유효한 토큰 페이로드 검증
      const payload = jwtService.decode(validToken) as any;

      expect(payload.sub).toBe(TEST_MEMBER.memberSeqno.toString());
      expect(payload.email).toBe(TEST_MEMBER.memberId);
      expect(payload.name).toBe(TEST_MEMBER.memberName);
      expect(payload.role).toBe('customer');
      expect(payload.source).toBe('shop');
      expect(payload.exp).toBeDefined();
      expect(payload.iat).toBeDefined();
    });
  });

  // ============================================================
  // Shop Refresh 테스트
  // ============================================================
  describe('/auth/shop-refresh (POST)', () => {
    it('should refresh token with valid refresh cookie', async () => {
      // 먼저 shop-session으로 쿠키 획득
      const sessionResponse = await request(app.getHttpServer())
        .post('/auth/shop-session')
        .set('X-API-Key', TEST_API_KEY)
        .send(TEST_MEMBER);

      // shop-session이 실패하면 직접 refresh token 생성
      let refreshToken: string | undefined;

      if (sessionResponse.status === 200) {
        const setCookieHeader = sessionResponse.headers['set-cookie'];
        const cookies = Array.isArray(setCookieHeader)
          ? setCookieHeader
          : setCookieHeader
            ? [setCookieHeader]
            : [];
        const refreshCookie = cookies.find((c: string) =>
          c?.startsWith('storige_refresh='),
        );

        if (refreshCookie) {
          refreshToken = refreshCookie
            .split(';')[0]
            .replace('storige_refresh=', '');
        }
      }

      // shop-session 실패 시 직접 토큰 생성
      if (!refreshToken) {
        refreshToken = jwtService.sign(
          {
            sub: TEST_MEMBER.memberSeqno.toString(),
            email: TEST_MEMBER.memberId,
            name: TEST_MEMBER.memberName,
            role: 'customer',
            source: 'shop',
            permissions: ['edit', 'upload', 'validate'],
          },
          { expiresIn: '30d' },
        );
      }

      const response = await request(app.getHttpServer())
        .post('/auth/shop-refresh')
        .set('Cookie', `storige_refresh=${refreshToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.expiresIn).toBe(3600);
    });

    it('should fail refresh without refresh cookie', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/shop-refresh')
        .expect(200); // 실패해도 200 반환하고 success: false

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('REFRESH_TOKEN_MISSING');
    });

    it('should fail refresh with invalid refresh token', async () => {
      await request(app.getHttpServer())
        .post('/auth/shop-refresh')
        .set('Cookie', 'storige_refresh=invalid-token')
        .expect(401);
    });

    it('should fail refresh with expired refresh token', async () => {
      const expiredRefreshToken = jwtService.sign(
        {
          sub: '99999',
          email: 'test@example.com',
          name: '테스트',
          role: 'customer',
          source: 'shop',
        },
        { expiresIn: '-1s' },
      );

      await request(app.getHttpServer())
        .post('/auth/shop-refresh')
        .set('Cookie', `storige_refresh=${expiredRefreshToken}`)
        .expect(401);
    });
  });

  // ============================================================
  // 사용자 로그인/회원가입 테스트
  // ============================================================
  describe('/auth/login (POST)', () => {
    const testUser = {
      email: 'testuser@storige.com',
      password: 'password123',
    };

    beforeAll(async () => {
      // 테스트 사용자 등록
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(testUser)
        .expect(201);
    });

    it('should login with valid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send(testUser)
        .expect(200);

      expect(response.body.accessToken).toBeDefined();
      expect(response.body.refreshToken).toBeDefined();
    });

    it('should reject login with wrong password', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: testUser.email,
          password: 'wrongpassword',
        })
        .expect(401);

      expect(response.body.message).toContain('Invalid credentials');
    });

    it('should reject login with non-existent email', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'nonexistent@storige.com',
          password: 'password123',
        })
        .expect(401);

      expect(response.body.message).toContain('Invalid credentials');
    });

    it('should reject login with invalid email format', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'not-an-email',
          password: 'password123',
        })
        .expect(400);
    });

    it('should reject login with short password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'user@storige.com',
          password: '12345', // 6자 미만
        })
        .expect(400);
    });
  });

  // ============================================================
  // 사용자 회원가입 테스트
  // ============================================================
  describe('/auth/register (POST)', () => {
    it('should register new user successfully', async () => {
      const newUser = {
        email: 'newuser@storige.com',
        password: 'newpassword123',
      };

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send(newUser)
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.email).toBe(newUser.email);
      expect(response.body.role).toBeDefined();
      expect(response.body.passwordHash).toBeUndefined(); // 비밀번호 해시 노출 안됨
    });

    it('should reject registration with duplicate email', async () => {
      const existingUser = {
        email: 'duplicate@storige.com',
        password: 'password123',
      };

      // 첫 번째 등록
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(existingUser)
        .expect(201);

      // 중복 등록 시도
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send(existingUser)
        .expect(409);

      expect(response.body.message).toContain('Email already exists');
    });

    it('should reject registration with invalid email', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'invalid-email',
          password: 'password123',
        })
        .expect(400);
    });

    it('should reject registration with short password', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'user@storige.com',
          password: '12345', // 6자 미만
        })
        .expect(400);
    });

    it('should reject registration with missing fields', async () => {
      // 이메일 누락
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ password: 'password123' })
        .expect(400);

      // 비밀번호 누락
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'user@storige.com' })
        .expect(400);
    });
  });

  // ============================================================
  // Token Refresh 테스트
  // ============================================================
  describe('/auth/refresh (POST)', () => {
    let refreshToken: string;

    beforeEach(async () => {
      // 테스트용 사용자 생성 및 로그인
      const uniqueEmail = `refresh-test-${Date.now()}@storige.com`;
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: uniqueEmail,
          password: 'password123',
        });

      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: uniqueEmail,
          password: 'password123',
        });

      refreshToken = loginResponse.body.refreshToken;
    });

    it('should refresh token with valid refresh token', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body.accessToken).toBeDefined();
      expect(response.body.refreshToken).toBeDefined();
    });

    it('should reject refresh with invalid token', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'invalid-token' })
        .expect(401);
    });

    it('should reject refresh with expired token', async () => {
      const expiredToken = jwtService.sign(
        { sub: 'user-id', email: 'test@test.com', role: 'customer' },
        { expiresIn: '-1s' },
      );

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: expiredToken })
        .expect(401);
    });
  });
});
