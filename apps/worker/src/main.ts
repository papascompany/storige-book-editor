import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables before anything else
// Priority: .env.{NODE_ENV} > .env
const nodeEnv = process.env.NODE_ENV || 'development';
config({ path: resolve(__dirname, `../.env.${nodeEnv}`) });
config({ path: resolve(__dirname, '../.env') });

// Sentry 초기화 (다른 import보다 먼저)
import { initSentry, Sentry } from './sentry/sentry.init';
initSentry('storige-worker');

import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';

// Unhandled rejection 캐치 + Sentry 전송
process.on('unhandledRejection', (reason: any) => {
  console.error('[Worker] Unhandled Rejection:', reason);
  Sentry.captureException(reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Worker] Uncaught Exception:', err);
  Sentry.captureException(err);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // P2-10 Pino logger를 NestJS 전역 logger로 사용
  const pinoLogger = app.get(PinoLogger);
  app.useLogger(pinoLogger);

  // CFG-001(2026-06-22): 핵심 시크릿 누락 조기 경보(warn-only, 부팅 미차단).
  if ((process.env.NODE_ENV || 'development') === 'production') {
    for (const key of ['DATABASE_PASSWORD', 'WORKER_API_KEY']) {
      if (!process.env[key]) {
        pinoLogger.warn(
          `[CFG] 필수 환경변수 ${key} 가 설정되지 않았습니다 — DB/API 콜백 연동이 실패할 수 있습니다.`,
        );
      }
    }
  }

  const port = process.env.PORT || 4001;
  await app.listen(port);

  pinoLogger.log(
    { port },
    `🔧 Worker Service running on http://localhost:${port} — waiting for Bull jobs`,
  );
}

bootstrap();
