import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { FileEntity } from './entities/file.entity';
import { ObjectStorageService } from '../storage/object-storage.service';
import { FileRetentionService } from './file-retention.service';
import { PresignedUploadService } from './presigned-upload.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([FileEntity]),
    ConfigModule,
    SettingsModule, // StorageConfigService (저장 드라이버/보존정책 런타임 설정)
  ],
  controllers: [FilesController],
  providers: [FilesService, ObjectStorageService, FileRetentionService, PresignedUploadService],
  exports: [FilesService, ObjectStorageService, PresignedUploadService],
})
export class FilesModule {}
