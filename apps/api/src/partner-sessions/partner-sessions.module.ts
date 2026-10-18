import { Module, forwardRef } from '@nestjs/common';
import { PartnerApiModule } from '../partner-api/partner-api.module';
import { EditSessionsModule } from '../edit-sessions/edit-sessions.module';
import { AuthModule } from '../auth/auth.module';
import { TemplatesModule } from '../templates/templates.module';
import { WorkerJobsModule } from '../worker-jobs/worker-jobs.module';
import { PartnerSessionsController } from './partner-sessions.controller';
import { PartnerSessionsService } from './partner-sessions.service';

/**
 * Partner API v1 — 1-call 런처 모듈(P2-b, 2026-10-18, /api/v1/sessions/*).
 * 정본: docs/PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md §8.1
 *
 * - v1 표준 스택은 @PartnerV1Controller + PartnerApiModule import(가드/필터/인터셉터 DI)로 승계(BooksModule 선례).
 * - EditSessionsModule: 세션 생성·스코프 조회·재합성(EditSessionsService export).
 * - AuthModule: 편집기 shop 세션 JWT 발급(AuthService export). 쿠키 미설정.
 * - TemplatesModule: 템플릿셋 hybrid 스코프·pdfOutputMode·productProfile 조회.
 * - WorkerJobsModule: 완료 잡 산출물 서명 URL(issueOutputUrls). books ↔ worker-jobs 순환 → forwardRef.
 * 신규 엔티티·테이블 없음(기존 file_edit_sessions.metadata · worker_jobs.options 에 additive 키만).
 */
@Module({
  imports: [
    PartnerApiModule,
    EditSessionsModule,
    AuthModule,
    TemplatesModule,
    forwardRef(() => WorkerJobsModule),
  ],
  controllers: [PartnerSessionsController],
  providers: [PartnerSessionsService],
})
export class PartnerSessionsModule {}
