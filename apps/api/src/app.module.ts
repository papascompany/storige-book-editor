import { Module, DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { TemplatesModule } from './templates/templates.module';
import { LibraryModule } from './library/library.module';
import { StorageModule } from './storage/storage.module';
import { WorkerJobsModule } from './worker-jobs/worker-jobs.module';
import { EditorModule } from './editor/editor.module';
import { EditorDesignsModule } from './editor-designs/editor-designs.module';
import { EditorContentsModule } from './editor-contents/editor-contents.module';
import { ProductsModule } from './products/products.module';
import { HealthModule } from './health/health.module';
import { SeedModule } from './database/seeds/seed.module';
import { FilesModule } from './files/files.module';
import { EditSessionsModule } from './edit-sessions/edit-sessions.module';
import { PayloadTooLargeFilter } from './common/filters/payload-too-large.filter';

// Bookmoa 모듈 조건부 로드 (BOOKMOA_DB_PASSWORD가 설정된 경우에만)
const conditionalModules: DynamicModule[] = [];
if (process.env.BOOKMOA_DB_PASSWORD) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { BookmoaModule } = require('./bookmoa/bookmoa.module');
  conditionalModules.push(BookmoaModule);
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
      }),
    }),

    // Cron schedules (BB-Phase 3 follow-up: 시점 썸네일 orphan cleanup 등)
    ScheduleModule.forRoot(),

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

    // Database seeding
    SeedModule,

    // File management
    FilesModule,

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
  ],
})
export class AppModule {}
