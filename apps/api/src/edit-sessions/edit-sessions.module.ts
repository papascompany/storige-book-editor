import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EditSessionsController } from './edit-sessions.controller';
import { EditSessionsService } from './edit-sessions.service';
import { EditSessionEntity } from './entities/edit-session.entity';
import { WorkerJobsModule } from '../worker-jobs/worker-jobs.module';
import { TemplatesModule } from '../templates/templates.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([EditSessionEntity]),
    forwardRef(() => WorkerJobsModule),
    // B49: 완료 시 metadata.spread 스펙을 템플릿 권위(spreadConfig.spec)와 대조하기 위해 TemplateSetsService 사용
    TemplatesModule,
  ],
  controllers: [EditSessionsController],
  providers: [EditSessionsService],
  exports: [EditSessionsService],
})
export class EditSessionsModule {}
