import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EditorController } from './editor.controller';
import { EditorService } from './editor.service';
import { ThumbnailCleanupService } from './thumbnail-cleanup.service';
import { EditSession, EditHistory } from './entities/edit-session.entity';
import { EditSessionVersion } from './entities/edit-session-version.entity';
import { TemplateSet } from '../templates/entities/template-set.entity';
import { Template } from '../templates/entities/template.entity';
import { EditSessionsModule } from '../edit-sessions/edit-sessions.module';
import { WorkerJobsModule } from '../worker-jobs/worker-jobs.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EditSession,
      EditHistory,
      EditSessionVersion,
      TemplateSet,
      Template,
    ]),
    EditSessionsModule,
    WorkerJobsModule,
  ],
  controllers: [EditorController],
  providers: [EditorService, ThumbnailCleanupService],
  exports: [EditorService],
})
export class EditorModule {}
