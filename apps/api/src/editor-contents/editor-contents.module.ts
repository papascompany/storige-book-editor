import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EditorContent } from './entities/editor-content.entity';
import { LibraryClipart } from '../library/entities/clipart.entity';
import { LibraryFrame } from '../library/entities/frame.entity';
import { LibraryBackground } from '../library/entities/background.entity';
import { EditorContentsService } from './editor-contents.service';
import { EditorContentsController } from './editor-contents.controller';

@Module({
  // P0-1 (2026-06-02): 고객 편집기 패널이 관리자 Library 에셋을 읽도록 library 엔티티 등록
  imports: [TypeOrmModule.forFeature([EditorContent, LibraryClipart, LibraryFrame, LibraryBackground])],
  controllers: [EditorContentsController],
  providers: [EditorContentsService],
  exports: [EditorContentsService],
})
export class EditorContentsModule {}
