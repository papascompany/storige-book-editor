import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Book } from './entities/book.entity';
import { BookAsset } from './entities/book-asset.entity';
import { BookFinalization } from './entities/book-finalization.entity';
import { BookSpec } from '../book-specs/entities/book-spec.entity';
import { BooksController } from './books.controller';
import { BooksService } from './books.service';
import { PartnerApiModule } from '../partner-api/partner-api.module';
import { FilesModule } from '../files/files.module';

/**
 * Partner API v1 — Books(도서 aggregate) 모듈 (Stage 3, W1+W2).
 *
 * 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §2.4~2.6·§6.1~6.2
 *
 * - v1 표준 스택은 @PartnerV1Controller 조합 데코레이터 + PartnerApiModule
 *   import(가드/필터/인터셉터 의존 DI 해석)로 승계.
 * - ApiKeyGuard 의존 SitesService 는 SitesModule @Global 로 주입.
 * - BookSpec 은 bookSpecUid 검증·view 역해석(id→uid)용 읽기 참조만(조회+참조).
 * - files/file_edit_sessions/worker_jobs 무접촉(AD-1) — 자산 파일 투입(W2)은
 *   FilesModule 의 FilesService 재사용(신규 파일 등록/조회, 기존 상태 변경 없음).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Book, BookAsset, BookFinalization, BookSpec]),
    PartnerApiModule,
    FilesModule,
  ],
  controllers: [BooksController],
  providers: [BooksService],
  exports: [BooksService],
})
export class BooksModule {}
