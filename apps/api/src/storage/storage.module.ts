import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller';
import { FilesModule } from '../files/files.module';

@Module({
  // upload-public 업로드를 files 테이블에 정식 등록하기 위해 FilesService 주입
  // (fileId 소비 라우트 — validate/fix-bleed — 가 findById 로 해석 가능해야 함)
  imports: [FilesModule],
  controllers: [StorageController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
