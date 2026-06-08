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
