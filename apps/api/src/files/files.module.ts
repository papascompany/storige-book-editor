import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { OptionalShopJwtGuard } from '../auth/guards/optional-shop-jwt.guard';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { FileEntity } from './entities/file.entity';
import { ObjectStorageService } from '../storage/object-storage.service';
import { FileRetentionService } from './file-retention.service';
import { FileOrphanService } from './file-orphan.service';
import { PresignedUploadService } from './presigned-upload.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([FileEntity]),
    ConfigModule,
    SettingsModule, // StorageConfigService (저장 드라이버/보존정책 런타임 설정)
    // S3-A안(2026-08-28, D1 승인): presigned complete 의 옵션형 site 스탬프 —
    // OptionalShopJwtGuard 가 shop-session JWT **서명을 검증**하는 데 사용.
    // AuthModule 이 JwtModule 을 export 하지 않으므로 edit-sessions 와 동일 패턴으로
    // 자체 등록한다. JWT_SECRET 미설정 시 verify throw → 스탬프 없이 NULL(fail-closed).
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [FilesController],
  providers: [
    FilesService,
    ObjectStorageService,
    FileRetentionService,
    FileOrphanService,
    PresignedUploadService,
    OptionalShopJwtGuard,
  ],
  exports: [FilesService, ObjectStorageService, PresignedUploadService],
})
export class FilesModule {}
