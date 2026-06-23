import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables before anything else
// Priority: .env.{NODE_ENV} > .env
const nodeEnv = process.env.NODE_ENV || 'development';
config({ path: resolve(__dirname, `../.env.${nodeEnv}`) });
config({ path: resolve(__dirname, '../.env') });

// Sentry 초기화는 다른 모듈 import 보다 먼저 실행되어야 함
// (instrumentation 동작 기반이라 import 시점에 hook이 걸려야 모든 트랜잭션이 추적됨)
import { initSentry, Sentry } from './sentry/sentry.init';
initSentry('storige-api');

import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { PayloadTooLargeResponseDto } from './common/dto/error-response.dto';
import { SentryExceptionFilter } from './sentry/sentry.filter';

// Prevent unhandled rejections from crashing the process
process.on('unhandledRejection', (reason: any) => {
  // NotFoundException from requests to non-existent routes (e.g. /, /health, bot scans)
  // should not crash the server
  if (reason?.name === 'NotFoundException') {
    console.warn(`Unhandled NotFoundException: ${reason.message}`);
    return;
  }
  console.error('Unhandled Rejection:', reason);
  // Sentry로 전송 (DSN 설정된 경우만)
  Sentry.captureException(reason);
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true, // pino logger 등록 전까지 NestJS 기본 로그 버퍼링
  });

  // P2-10 Pino logger를 NestJS 전역 logger로 사용 (AppModule LoggerModule.forRoot 결과)
  const pinoLogger = app.get(PinoLogger);
  app.useLogger(pinoLogger);

  // SEC-4: 운영은 nginx(단일 hop) 뒤에서 동작 — X-Forwarded-For 의 클라이언트 IP 를
  // req.ip 로 신뢰해야 ThrottlerGuard 가 고객별로 카운트한다 (미설정 시 전 고객이
  // nginx 컨테이너 IP 하나로 묶여 오차단). nginx.conf 의
  // `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` 전달 확인됨 (2026-06-13).
  // 값 1 = 마지막 1개 프록시만 신뢰 (클라이언트가 XFF 를 위조해도 nginx 가 append 하므로 안전).
  app.set('trust proxy', 1);

  // Body parser size limit (캔버스 데이터 등 대용량 JSON 허용)
  const configService = app.get(ConfigService);

  // CFG-001(2026-06-22): 핵심 시크릿 누락 조기 경보. ⚠️ throw 금지(부팅 차단=전체 다운 위험).
  // JWT_SECRET 은 기본값이 없어 누락 시 secret=undefined 로 인증이 조용히 붕괴하므로 로그로 가시화.
  // (Joi .required() 강제 검증은 prod .env 변수목록 불확실성 + 부팅실패 리스크로 채택 안 함.)
  if (configService.get('NODE_ENV') === 'production') {
    for (const key of ['JWT_SECRET', 'DATABASE_PASSWORD', 'WORKER_API_KEY']) {
      if (!configService.get(key)) {
        pinoLogger.warn(
          `[CFG] 필수 환경변수 ${key} 가 설정되지 않았습니다 — 인증/DB/워커 연동이 실패할 수 있습니다. .env 확인 필요.`,
        );
      }
    }
    // WH-001(2026-06-23): WEBHOOK_SECRET 미주입 시 위조불가 HMAC 서명(X-Storige-Signature-HMAC)이
    // silent 생략된다(=웹훅 무서명). 미설정도 하위호환상 유효하나, .env 에 값이 있는데 컨테이너에
    // 미주입되는 회귀(docker-compose environment 매핑 누락)를 가시화. 경보일 뿐 부팅은 차단 안 함.
    if (!configService.get('WEBHOOK_SECRET')) {
      pinoLogger.warn(
        `[CFG] WEBHOOK_SECRET 미설정 — 아웃바운드 웹훅이 위조불가 HMAC 서명 없이 발송됩니다(레거시 base64만). 파트너 cutover 전 .env + docker-compose environment 매핑 확인 필요.`,
      );
    }
  }

  const maxBodySize = configService.get<string>('MAX_BODY_SIZE', '100mb');
  app.useBodyParser('json', { limit: maxBodySize });
  app.useBodyParser('urlencoded', { limit: maxBodySize, extended: true });

  // AUTH-001 WS-2(2026-06-22): 보안 응답 헤더(helmet). XSS 표면 축소·클릭재킹·MIME스니핑 방어.
  // ⚠️ API 가 크로스오리진 리소스(GET /files/:id/raw 이미지 — 외부 임베드 편집기에서 로드)를
  //    서빙하므로 Cross-Origin-Resource-Policy=cross-origin 유지(same-origin 기본은 차단 회귀).
  //    CSP/COEP 는 API/Swagger·임베드 호환 위해 미부과(별도 단계에서 Report-Only 검토).
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Cookie parser middleware
  app.use(cookieParser());

  // Enable CORS — Phase 1-2 (2026-05-16):
  // 환경변수 + 정적 패턴(legacy) 매칭 후, DB `sites.allowed_origins` 동적 매칭 (60s 캐시).
  // 새 외부 사이트는 .env 변경 없이 Admin 에서만 등록하면 즉시 허용.
  const corsOrigin = process.env.CORS_ORIGIN;
  const defaultOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:8080',
  ];
  const allowedOrigins = corsOrigin
    ? corsOrigin.split(',').map(o => o.trim())
    : defaultOrigins;

  // Vercel preview/production 도메인 패턴 허용 (예: storige-editor-XYZ-yohans-projects-de3234df.vercel.app)
  const VERCEL_PATTERN = /\.vercel\.app$/;
  // 운영 도메인 서브도메인 wildcard
  const PAPAS_PATTERN = /\.papascompany\.co\.kr$/;

  // Phase 1-2: SitesService 동적 정책 조회용. NestJS 인스턴스에서 lazily resolve.
  // 부팅 시점에 resolve 하면 OnModuleInit 시드 전 호출되어 비어 있을 수 있으므로
  // request-time lookup 으로 안전 처리.
  const { SitesService } = await import('./sites/sites.service');
  const sitesService = app.get(SitesService);

  app.enableCors({
    origin: async (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, etc.)
      if (!origin) {
        callback(null, true);
        return;
      }
      // 정적 화이트리스트 매칭 (env + 로컬 기본값)
      if (allowedOrigins.includes(origin)) {
        callback(null, origin);
        return;
      }
      // Vercel preview / *.papascompany.co.kr 동적 매칭
      try {
        const url = new URL(origin);
        if (VERCEL_PATTERN.test(url.hostname) || PAPAS_PATTERN.test(url.hostname)) {
          callback(null, origin);
          return;
        }
      } catch {
        // origin 파싱 실패는 차단
        pinoLogger.warn({ origin }, 'CORS blocked');
        callback(null, false);
        return;
      }
      // Phase 1-2: DB sites 기반 동적 매칭
      try {
        const allowed = await sitesService.isOriginAllowed(origin);
        if (allowed) {
          callback(null, origin);
          return;
        }
      } catch (err) {
        pinoLogger.error({ err, origin }, 'sites-based CORS check failed');
        // fallthrough → 차단
      }
      pinoLogger.warn({ origin }, 'CORS blocked');
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-API-Key'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Global Sentry exception filter (5xx 자동 전송)
  // BaseExceptionFilter가 HttpAdapterHost를 필요로 함
  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(new SentryExceptionFilter(httpAdapterHost.httpAdapter));

  // API prefix
  app.setGlobalPrefix('api');

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Storige API')
    .setDescription('Print Shopping Mall API Documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey(
      { type: 'apiKey', name: 'X-API-Key', in: 'header' },
      'api-key',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [PayloadTooLargeResponseDto],
  });
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 4000;
  await app.listen(port);

  pinoLogger.log(
    { port, docsUrl: `http://localhost:${port}/api/docs`, maxBodySize },
    `🚀 API Server running on http://localhost:${port}`,
  );
}

bootstrap();
