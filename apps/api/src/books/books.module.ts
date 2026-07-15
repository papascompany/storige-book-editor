import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Book } from './entities/book.entity';
import { BookAsset } from './entities/book-asset.entity';
import { BookFinalization } from './entities/book-finalization.entity';

/**
 * Partner API v1 — Books(도서 aggregate) 모듈 (Stage 3, W1+W2).
 *
 * 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §2.4~2.6·§6.1~6.2
 *
 * W1(스키마+엔티티)에서는 3종 엔티티 등록만 한다. DRAFT 생성/목록/상세
 * 컨트롤러·서비스와 자산 라우트(W2)는 후속 커밋에서 이 모듈에 추가한다.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Book, BookAsset, BookFinalization])],
})
export class BooksModule {}
