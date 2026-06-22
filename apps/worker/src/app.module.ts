import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { LoggerModule } from 'nestjs-pino';

// Services
import { PdfValidatorService } from './services/pdf-validator.service';
import { PdfConverterService } from './services/pdf-converter.service';
import { PdfSynthesizerService } from './services/pdf-synthesizer.service';
import { PdfPageRendererService } from './services/pdf-page-renderer.service';

// Processors
import { ValidationProcessor } from './processors/validation.processor';
import { ConversionProcessor } from './processors/conversion.processor';
import { SynthesisProcessor } from './processors/synthesis.processor';
import { RenderProcessor } from './processors/render.processor';

// Controllers
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    // Configuration - loads environment-specific file based on NODE_ENV
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        `.env.${process.env.NODE_ENV || 'development'}`,
        '.env',
      ],
    }),

    // P2-10 구조화 로깅 (Pino → JSON stdout → Promtail → Loki)
    // Worker는 HTTP 서버가 거의 없고 잡 처리 중심이라 autoLogging 비활성
    LoggerModule.forRoot({
      pinoHttp: {
        autoLogging: false,
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
                options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' },
              },
        level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
        base: { app: 'storige-worker', env: process.env.NODE_ENV || 'development' },
      },
    }),

    // Database (MariaDB - for job status updates)
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mariadb',
        host: config.get('DATABASE_HOST', 'localhost'),
        port: config.get('DATABASE_PORT', 3306),
        username: config.get('DATABASE_USER', 'root'),
        password: config.get('DATABASE_PASSWORD', ''),
        database: config.get('DATABASE_NAME', 'storige'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: false,
        logging: config.get('NODE_ENV') === 'development',
        charset: 'utf8mb4',
      }),
    }),

    // Redis Queue Consumers
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get('REDIS_PORT', 6379),
        },
        // P0-5(2026-06-22): 대형 PDF 합성/변환이 Bull 기본 lockDuration(30s)을 초과하면
        // stalled 로 오판돼 잡이 중복 재실행되고 DB 상태(PROCESSING)·콜백이 경합한다.
        // lock 을 10분으로 늘리고 주기 갱신해 애초에 stalled 판정을 막는다.
        // ⚠️ maxStalledCount 는 0 금지(0=stalled 1회에 즉시 영구 FAILED → 정상완료 잡 오탐).
        //    기본값 1 유지: 진짜 크래시 시에만 1회 재처리.
        settings: {
          lockDuration: 600000, // 10분 (기본 30s) — 대형 PDF 처리시간 여유
          lockRenewTime: 150000, // lockDuration/4 — lock 만료 전 능동 갱신
          maxStalledCount: 1, // 기본값 유지(0 아님)
          stalledInterval: 30000, // 기본값 유지
        },
      }),
    }),

    // Register queue consumers
    BullModule.registerQueue(
      { name: 'pdf-validation' },
      { name: 'pdf-conversion' },
      { name: 'pdf-synthesis' },
    ),
  ],
  controllers: [HealthController],
  providers: [
    // Services
    PdfValidatorService,
    PdfConverterService,
    PdfSynthesizerService,
    PdfPageRendererService,

    // Processors
    ValidationProcessor,
    ConversionProcessor,
    SynthesisProcessor,
    RenderProcessor,
  ],
})
export class AppModule {}
