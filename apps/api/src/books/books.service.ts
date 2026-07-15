import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { FindOptionsWhere, In, IsNull, Repository } from 'typeorm';
import { ErrV1 } from '@storige/types';
import { CurrentSitePayload } from '../auth/decorators/current-site.decorator';
import { PartnerApiException } from '../partner-api/http/partner-api.exceptions';
import {
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
} from '../partner-api/http/pagination';
import { BookSpec } from '../book-specs/entities/book-spec.entity';
import { Book } from './entities/book.entity';
import { BOOK_UID_PREFIX } from './books.constants';
import { BookListQueryDto, BookView, CreateBookDto } from './dto/book.dto';

/**
 * Partner API v1 — Books(도서 aggregate) 서비스 (Stage 3 W1).
 *
 * 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §2.4·§6.1~6.2
 *
 * - books 는 파사드 — 기존 files/file_edit_sessions/worker_jobs 무접촉(AD-1).
 * - 테넌트 스코프: 자기 site + 인증 env 만. 타 site/타 env 리소스는 존재 은닉
 *   위해 404 ERR_NOT_FOUND(§3.3 IDOR 방지).
 * - book_spec_id 는 nullable — bookSpecUid 미제공 시 book_spec 없이 DRAFT 생성
 *   (시드 게이트, §9-6). 제공 시 활성+테넌트 스코프 검증(404 ERR_BOOK_SPEC_NOT_FOUND).
 */
@Injectable()
export class BooksService {
  constructor(
    @InjectRepository(Book)
    private readonly bookRepo: Repository<Book>,
    // book_specs 는 조회+참조만 — bookSpecUid 검증 및 view 역해석(id→uid)용.
    @InjectRepository(BookSpec)
    private readonly bookSpecRepo: Repository<BookSpec>,
  ) {}

  private resolveEnv(site: CurrentSitePayload): 'test' | 'live' {
    return site.env === 'test' ? 'test' : 'live';
  }

  /**
   * DRAFT 도서 생성.
   *
   * ⚠️ W4 스텁: EDITOR_SESSION 승격(sessionId)·TEMPLATE/MIX 바인딩(templateSetId)의
   * 실제 소유/완료 검증과 자산 연결은 W4 다. 본 배치는 creationType 저장 + 빈 DRAFT
   * 까지 — EDITOR_SESSION 은 sessionId 를 참조로만 저장(연결·검증 없음).
   */
  async create(site: CurrentSitePayload, dto: CreateBookDto): Promise<BookView> {
    const bookSpecId = await this.resolveBookSpecId(site, dto.bookSpecUid);

    // W4 스텁 — EDITOR_SESSION 한정 참조 저장. 소유/완료 실검증은 W4(교차 테넌트
    // 승격 차단은 W4 게이트). templateSetId 는 본 배치에서 미저장(W4 바인딩 자산에서 처리).
    const editSessionId =
      dto.creationType === 'EDITOR_SESSION' ? dto.sessionId ?? null : null;

    const book = this.bookRepo.create({
      uid: `${BOOK_UID_PREFIX}${randomUUID().replace(/-/g, '')}`,
      siteId: site.siteId,
      env: this.resolveEnv(site),
      creationType: dto.creationType,
      bookSpecId,
      status: 'DRAFT',
      pageCount: dto.pageCount ?? null,
      title: dto.title ?? null,
      editSessionId,
      partnerRef: dto.partnerRef ?? null,
      finalizedAt: null,
    });

    const saved = await this.bookRepo.save(book);
    return this.toView(saved, dto.bookSpecUid ?? null);
  }

  /** 목록 — 자기 site + env 스코프, status/creationType 필터, 페이지네이션(§5.1). */
  async list(
    site: CurrentSitePayload,
    query: BookListQueryDto,
  ): Promise<{ items: BookView[]; total: number; limit: number; offset: number }> {
    const limit = Math.min(query.limit ?? PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT);
    const offset = query.offset ?? 0;

    const where: FindOptionsWhere<Book> = {
      siteId: site.siteId,
      env: this.resolveEnv(site),
    };
    if (query.status) where.status = query.status;
    if (query.creationType) where.creationType = query.creationType;

    const [rows, total] = await this.bookRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit,
    });

    return { items: await this.toViews(rows), total, limit, offset };
  }

  /** 상세 — 자기 site + env 스코프. 타 site/타 env/없음 = 404 ERR_NOT_FOUND(존재 은닉). */
  async getDetail(site: CurrentSitePayload, uid: string): Promise<BookView> {
    const book = await this.findBookForSite(site, uid);
    return (await this.toViews([book]))[0];
  }

  /**
   * 테넌트 스코프 단건 조회 — 자산 라우트(W2)·상세 공용.
   * 없음/타 site/타 env = 404 ERR_NOT_FOUND (IDOR 존재 노출 방지).
   */
  async findBookForSite(site: CurrentSitePayload, uid: string): Promise<Book> {
    const book = await this.bookRepo.findOne({
      where: { uid, siteId: site.siteId, env: this.resolveEnv(site) },
    });
    if (!book) {
      throw new PartnerApiException(
        ErrV1.ERR_NOT_FOUND,
        404,
        `도서 '${uid}' 을(를) 찾을 수 없습니다`,
      );
    }
    return book;
  }

  /**
   * bookSpecUid → 내부 id 해석 + 검증. 미제공 시 null(시드 게이트).
   * 제공 시 활성 + (전역 OR 자기 site) 스코프 — 위반 시 404 ERR_BOOK_SPEC_NOT_FOUND.
   * (BookSpecsService.findByUid 와 동일 스코프 규칙 — 결합 최소화 위해 repo 직접 조회)
   */
  private async resolveBookSpecId(
    site: CurrentSitePayload,
    bookSpecUid?: string,
  ): Promise<string | null> {
    if (!bookSpecUid) return null;
    const spec = await this.bookSpecRepo.findOne({
      where: [
        { uid: bookSpecUid, isActive: true, siteId: IsNull() },
        { uid: bookSpecUid, isActive: true, siteId: site.siteId },
      ],
      select: ['id'],
    });
    if (!spec) {
      throw new PartnerApiException(
        ErrV1.ERR_BOOK_SPEC_NOT_FOUND,
        404,
        `판형 '${bookSpecUid}' 을(를) 찾을 수 없습니다`,
      );
    }
    return spec.id;
  }

  /** 다건 view 변환 — bookSpecId → uid 역해석을 In() 1회 배치(N+1 제거). */
  private async toViews(books: Book[]): Promise<BookView[]> {
    const specIds = [
      ...new Set(books.map((b) => b.bookSpecId).filter((x): x is string => !!x)),
    ];
    const uidById = new Map<string, string>();
    if (specIds.length > 0) {
      const specs = await this.bookSpecRepo.find({
        where: { id: In(specIds) },
        select: ['id', 'uid'],
      });
      for (const s of specs) uidById.set(s.id, s.uid);
    }
    return books.map((b) =>
      this.toView(b, b.bookSpecId ? uidById.get(b.bookSpecId) ?? null : null),
    );
  }

  private toView(book: Book, bookSpecUid: string | null): BookView {
    return {
      uid: book.uid,
      env: book.env,
      creationType: book.creationType,
      status: book.status,
      bookSpecUid,
      pageCount: book.pageCount,
      title: book.title,
      partnerRef: book.partnerRef,
      createdAt: book.createdAt.toISOString(),
      updatedAt: book.updatedAt.toISOString(),
      finalizedAt: book.finalizedAt ? book.finalizedAt.toISOString() : null,
    };
  }
}
