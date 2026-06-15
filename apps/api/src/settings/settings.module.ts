import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { StorageSettingEntity } from './entities/storage-setting.entity';
import { StorageConfigService } from './storage-config.service';
import { StorageSettingsController } from './storage-settings.controller';

/**
 * SettingsModule — 저장계층/보존정책 런타임 설정 (admin 관리).
 * StorageConfigService 를 export → ObjectStorageService / FileRetentionService 가 소비.
 */
@Module({
  imports: [TypeOrmModule.forFeature([StorageSettingEntity]), ConfigModule],
  controllers: [StorageSettingsController],
  providers: [StorageConfigService],
  exports: [StorageConfigService],
})
export class SettingsModule {}
