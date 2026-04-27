import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables before anything else
// Priority: .env.{NODE_ENV} > .env
const nodeEnv = process.env.NODE_ENV || 'development';
config({ path: resolve(__dirname, `../.env.${nodeEnv}`) });
config({ path: resolve(__dirname, '../.env') });

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { PayloadTooLargeResponseDto } from './common/dto/error-response.dto';

// Prevent unhandled rejections from crashing the process
process.on('unhandledRejection', (reason: any) => {
  // NotFoundException from requests to non-existent routes (e.g. /, /health, bot scans)
  // should not crash the server
  if (reason?.name === 'NotFoundException') {
    console.warn(`Unhandled NotFoundException: ${reason.message}`);
    return;
  }
  console.error('Unhandled Rejection:', reason);
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

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
      console.log(`CORS blocked for origin: ${origin}`);
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

  console.log(`🚀 API Server running on http://localhost:${port}`);
  console.log(`📚 API Documentation: http://localhost:${port}/api/docs`);
  console.log(`📦 Max body size: ${maxBodySize}`);
}

bootstrap();
