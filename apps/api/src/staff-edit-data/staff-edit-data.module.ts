import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EditSessionEntity } from '../edit-sessions/entities/edit-session.entity';
import { EditSessionVersionEntity } from '../edit-sessions/entities/edit-session-version.entity';
import { Site } from '../sites/entities/site.entity';
import { UserSiteRole } from '../auth/entities/user-site-role.entity';
import { WorkerJob } from '../worker-jobs/entities/worker-job.entity';
import { EditSessionsModule } from '../edit-sessions/edit-sessions.module';
import { WorkerJobsModule } from '../worker-jobs/worker-jobs.module';
import { FilesModule } from '../files/files.module';
import { AuthModule } from '../auth/auth.module';
import { StaffEditDataController } from './staff-edit-data.controller';
import { StaffEditDataService } from './staff-edit-data.service';

/**
 * Storige 관리자 편집데이터 관리 (2026-09-29, ADDITIVE) — /api/admin/edit-data.
 * 이 모듈을 import 하는 모듈은 없다(순환 없음). AuthModule 은 PartnerOperatorGrantService·
 * PartnerOperatorAuditWriter 를 export 한다.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([EditSessionEntity, EditSessionVersionEntity, Site, UserSiteRole, WorkerJob]),
    EditSessionsModule,
    WorkerJobsModule,
    FilesModule,
    AuthModule,
  ],
  controllers: [StaffEditDataController],
  providers: [StaffEditDataService],
})
export class StaffEditDataModule {}
