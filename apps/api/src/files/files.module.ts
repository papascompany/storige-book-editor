import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { FileEntity } from './entities/file.entity';
import { ObjectStorageService } from '../storage/object-storage.service';
import { FileRetentionService } from './file-retention.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FileEntity]),
    ConfigModule,
  ],
  controllers: [FilesController],
  providers: [FilesService, ObjectStorageService, FileRetentionService],
  exports: [FilesService, ObjectStorageService],
})
export class FilesModule {}
