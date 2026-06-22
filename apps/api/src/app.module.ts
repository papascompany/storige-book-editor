import { Module, DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { TemplatesModule } from './templates/templates.module';
import { LibraryModule } from './library/library.module';
import { StorageModule } from './storage/storage.module';
import { WorkerJobsModule } from './worker-jobs/worker-jobs.module';
import { EditorModule } from './editor/editor.module';
import { EditorDesignsModule } from './editor-designs/editor-designs.module';
import { EditorContentsModule } from './editor-contents/editor-contents.module';
import { ProductsModule } from './products/products.module';
import { SitesModule } from './sites/sites.module';
import { HealthModule } from './health/health.module';
import { SeedModule } from './database/seeds/seed.module';
import { FilesModule } from './files/files.module';
import { SettingsModule } from './settings/settings.module';
import { EditSessionsModule } from './edit-sessions/edit-sessions.module';
import { PayloadTooLargeFilter } from './common/filters/payload-too-large.filter';

// Bookmoa 모듈 조건부 로드 (BOOKMOA_DB_PASSWORD가 설정된 경우에만)
const conditionalModules: DynamicModule[] = [];
if (process.env.BOOKMOA_DB_PASSWORD) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { BookmoaModule } = require('./bookmoa/bookmoa.module');
  conditionalModules.push(BookmoaModule);
  // pino logger는 모듈 로드 시점에 아직 초기화 전이라 console로 emit (1회성 startup info)
  console.log('[AppModule] Bookmoa integration enabled');
} else {
  console.log('[AppModule] Bookmoa integration disabled (BOOKMOA_DB_PASSWORD not set)');
}

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
    LoggerModule.forRoot({
      pinoHttp: {
        // production: JSON 한 줄, development: pretty
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
                options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' },
              },
        level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
        // 헬스체크 / 메트릭 / static 요청 로그 제외 (소음 감소)
        autoLogging: {
          ignore: (req) => {
            const url = (req as any).url || '';
            return (
              url.startsWith('/api/health/metrics') ||
              url === '/api/health' ||
              url === '/api/health/live' ||
              url === '/api/health/ready'
            );
          },
        },
        // 운영에서 식별용 base label (Loki 파싱 시 활용)
        base: { app: 'storige-api', env: process.env.NODE_ENV || 'development' },
        serializers: {
          // req/res에서 민감 헤더 제거
          req: (req) => ({
            method: req.method,
            url: req.url,
            id: req.id,
          }),
        },
      },
    }),

    // Database (MariaDB)
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mariadb',
        host: config.get('DATABASE_HOST', 'localhost'),
        port: config.get('DATABASE_PORT', 3306),
        username: config.get('DATABASE_USER', 'root'),
        password: config.get('DATABASE_PASSWORD', ''),
        database: config.get('DATABASE_NAME', 'storige'),
        // bookmoa-entities는 별도 DB 연결을 사용하므로 제외 (*/entities/ 경로만 포함)
        entities: [__dirname + '/*/entities/*.entity{.ts,.js}'],
        synchronize: config.get('NODE_ENV') === 'development',
        logging: config.get('NODE_ENV') === 'development',
        charset: 'utf8mb4',
      }),
    }),

    // Redis Queue
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get('REDIS_PORT', 6379),
        },
        // BQ-01/EH-006(2026-06-22): 완료/실패 잡을 무제한 보관하면 Redis 메모리가 계속 증가.
        // 개수 기반 보존(완료 1000·실패 5000건)으로 상한. ⚠️ attempts/backoff 는 미설정 —
        // 합성/변환/콜백이 비멱등이라 재시도 시 중복 산출물·중복 웹훅 위험(멱등키 도입 후 재논의).
        defaultJobOptions: {
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      }),
    }),

    // Cron schedules (BB-Phase 3 follow-up: 시점 썸네일 orphan cleanup 등)
    ScheduleModule.forRoot(),

    // SEC-4 글로벌 rate limiting (per-IP · per-endpoint, 60초 윈도우 300회).
    // nginx 뒤에서 동작 — main.ts 의 `trust proxy` 설정으로 X-Forwarded-For 의
    // 실제 클라이언트 IP 가 추적 키로 사용됨 (nginx.conf 가 XFF 전달 확인됨).
    // 민감 라우트(login/register/refresh/shop-session/upload-public/woff2ToTtf)는
    // 각 컨트롤러에서 @Throttle 로 더 좁은 한도를 적용.
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 300,
      },
    ]),

    // Feature modules
    HealthModule,
    AuthModule,
    TemplatesModule,
    LibraryModule,
    StorageModule,
    WorkerJobsModule,
    EditorModule,
    EditorDesignsModule,
    EditorContentsModule,
    ProductsModule,
    SitesModule,

    // Database seeding
    SeedModule,

    // File management
    FilesModule,

    // 저장계층/보존정책 런타임 설정 (admin)
    SettingsModule,

    // Edit sessions
    EditSessionsModule,

    // Bookmoa integration (conditionally loaded)
    ...conditionalModules,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_FILTER,
      useClass: PayloadTooLargeFilter,
    },
    // SEC-4: 전역 rate limit 가드 (ThrottlerModule 설정 사용)
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
