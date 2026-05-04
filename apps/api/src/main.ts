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

  // Body parser size limit (캔버스 데이터 등 대용량 JSON 허용)
  const configService = app.get(ConfigService);
  const maxBodySize = configService.get<string>('MAX_BODY_SIZE', '100mb');
  app.useBodyParser('json', { limit: maxBodySize });
  app.useBodyParser('urlencoded', { limit: maxBodySize, extended: true });

  // Cookie parser middleware
  app.use(cookieParser());

  // Enable CORS
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

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, etc.)
      if (!origin) {
        callback(null, true);
        return;
      }
      // 정적 화이트리스트 매칭
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
