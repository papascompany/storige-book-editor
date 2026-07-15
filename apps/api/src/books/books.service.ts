import { Injectable, NotFoundException } from '@nestjs/common';
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
import { FilesService } from '../files/files.service';
import { FileType } from '../files/entities/file.entity';
import { Book } from './entities/book.entity';
import { BookAsset } from './entities/book-asset.entity';
import {
  BOOK_ASSET_DIRECT_UPLOAD_MAX_BYTES,
  BOOK_ASSET_DIRECT_UPLOAD_MIME,
  BOOK_MAX_ACTIVE_PHOTOS,
  BOOK_UID_PREFIX,
  isAssetCompatible,
  type BookAssetType,
} from './books.constants';
import { BookListQueryDto, BookView, CreateBookDto } from './dto/book.dto';
import { BookAssetView } from './dto/book-asset.dto';

/** 자산 파일 투입 입력 — fileId 참조형 또는 직접 멀티파트 업로드형(둘 중 하나) */
export interface AssetFileInput {
  fileId?: string;
  file?: Express.Multer.File;
}

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
    @InjectRepository(BookAsset)
    private readonly bookAssetRepo: Repository<BookAsset>,
    // book_specs 는 조회+참조만 — bookSpecUid 검증 및 view 역해석(id→uid)용.
    @InjectRepository(BookSpec)
    private readonly bookSpecRepo: Repository<BookSpec>,
    // files 는 신규 등록/조회만(AD-1: 기존 파일 상태 변경 없음) — 자산 파일 투입 재사용.
    private readonly filesService: FilesService,
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

  // ── 자산(W2) ────────────────────────────────────────────────────────

  /**
   * 단수 자산(pdf_cover/pdf_contents) 신규 투입(POST) 또는 교체(PUT).
   *
   * 게이트 순서(설계서 §6.1~6.2):
   *  ① 테넌트 스코프 404 → ② FINALIZED 게이트(409 ERR_BOOK_NOT_DRAFT, 전 자산 변경 진입)
   *  → ③ creationType×asset_type 호환(422 ERR_ASSET_INCOMPATIBLE)
   *  → ④ 기존재 판정: POST 기존재=409 ERR_ASSET_ALREADY_EXISTS / PUT 미존재=404 ERR_ASSET_NOT_FOUND
   *  → ⑤ 파일 해석/투입 → ⑥ 영속(PUT 은 기존 'replaced' 전환 + 신규 'active', 이력 보존).
   */
  async putAsset(
    site: CurrentSitePayload,
    uid: string,
    assetType: BookAssetType,
    mode: 'create' | 'replace',
    input: AssetFileInput,
  ): Promise<BookAssetView> {
    const book = await this.findBookForSite(site, uid); // ①
    this.assertDraft(book); // ②
    this.assertCompatible(book, assetType); // ③

    const existing = await this.findActiveAsset(book.id, assetType); // ④
    if (mode === 'create' && existing) {
      throw new PartnerApiException(
        ErrV1.ERR_ASSET_ALREADY_EXISTS,
        409,
        `'${assetType}' 자산이 이미 존재합니다 — 교체는 PUT 을 사용하세요`,
      );
    }
    if (mode === 'replace' && !existing) {
      throw new PartnerApiException(
        ErrV1.ERR_ASSET_NOT_FOUND,
        404,
        `교체할 '${assetType}' 자산이 없습니다 — 신규 투입은 POST 를 사용하세요`,
      );
    }

    const fileId = await this.resolveAssetFile(site, input, assetType); // ⑤

    // ⑥ 이력 보존: 기존 active → replaced 전환 후 신규 active 삽입(§2.5).
    // (트랜잭션 미사용 — 실패 시 active 없음 상태로 회복 가능: 후속 POST 로 재투입)
    if (existing) {
      existing.status = 'replaced';
      await this.bookAssetRepo.save(existing);
    }
    const saved = await this.bookAssetRepo.save(
      this.bookAssetRepo.create({
        bookId: book.id,
        assetType,
        fileId,
        templateSetId: null,
        bindingParams: null,
        sortOrder: 0,
        status: 'active',
      }),
    );
    return this.toAssetView(saved);
  }

  /**
   * 사진 자산(photo) 다건 추가(POST 전용, DRAFT 전용). sort_order 는 기존 active
   * photo 최대값+1 로 부여(순서 유지). 교체 시맨틱 없음(다건 누적).
   */
  async addPhoto(
    site: CurrentSitePayload,
    uid: string,
    input: AssetFileInput,
  ): Promise<BookAssetView> {
    const book = await this.findBookForSite(site, uid);
    this.assertDraft(book);
    this.assertCompatible(book, 'photo');

    const fileId = await this.resolveAssetFile(site, input, 'photo');

    const activePhotos = await this.bookAssetRepo.find({
      where: { bookId: book.id, assetType: 'photo', status: 'active' },
      select: ['sortOrder'],
    });
    if (activePhotos.length >= BOOK_MAX_ACTIVE_PHOTOS) {
      throw new PartnerApiException(
        ErrV1.ERR_VALIDATION_FAILED,
        422,
        `사진 자산은 도서당 최대 ${BOOK_MAX_ACTIVE_PHOTOS}개까지 추가할 수 있습니다`,
      );
    }
    const nextSort =
      activePhotos.reduce((max, p) => Math.max(max, p.sortOrder), -1) + 1;

    const saved = await this.bookAssetRepo.save(
      this.bookAssetRepo.create({
        bookId: book.id,
        assetType: 'photo',
        fileId,
        templateSetId: null,
        bindingParams: null,
        sortOrder: nextSort,
        status: 'active',
      }),
    );
    return this.toAssetView(saved);
  }

  /** FINALIZED 게이트 — DRAFT 아니면 409 ERR_BOOK_NOT_DRAFT (AD-3). */
  private assertDraft(book: Book): void {
    if (book.status !== 'DRAFT') {
      throw new PartnerApiException(
        ErrV1.ERR_BOOK_NOT_DRAFT,
        409,
        `FINALIZED 도서는 자산을 변경할 수 없습니다(status=${book.status})`,
      );
    }
  }

  /** creationType×asset_type 호환(§6.1) — 불일치 시 422 ERR_ASSET_INCOMPATIBLE. */
  private assertCompatible(book: Book, assetType: BookAssetType): void {
    if (!isAssetCompatible(book.creationType, assetType)) {
      throw new PartnerApiException(
        ErrV1.ERR_ASSET_INCOMPATIBLE,
        422,
        `creationType '${book.creationType}' 에는 '${assetType}' 자산을 투입할 수 없습니다`,
      );
    }
  }

  private async findActiveAsset(
    bookId: string,
    assetType: BookAssetType,
  ): Promise<BookAsset | null> {
    return this.bookAssetRepo.findOne({
      where: { bookId, assetType, status: 'active' },
    });
  }

  /**
   * 자산 파일 해석 — 두 입력 형태.
   *  ① fileId 참조: files.findById → status='ready' + siteId===caller 검증.
   *     미존재/소프트삭제/타 테넌트 = 404 ERR_NOT_FOUND(존재 은닉), 미확정 = 409 ERR_FILE_NOT_READY.
   *  ② 직접 업로드: ≤100MB(413) + PDF(415) 사전 검증 후 files.uploadFile 재사용
   *     (PDF-only 계약 승계 — 이미지/대용량은 ① 경로). caller site 스탬프.
   * 둘 다 없으면 400 ERR_VALIDATION_FAILED.
   */
  private async resolveAssetFile(
    site: CurrentSitePayload,
    input: AssetFileInput,
    assetType: BookAssetType,
  ): Promise<string> {
    if (input.fileId) {
      let file;
      try {
        file = await this.filesService.findById(input.fileId);
      } catch (err) {
        if (err instanceof NotFoundException) {
          throw new PartnerApiException(
            ErrV1.ERR_NOT_FOUND,
            404,
            `파일 '${input.fileId}' 을(를) 찾을 수 없습니다`,
          );
        }
        throw err;
      }
      // 교차 테넌트 = 존재 은닉 위해 404(403 아님, §3.3 IDOR 방지)
      if (file.siteId !== site.siteId) {
        throw new PartnerApiException(
          ErrV1.ERR_NOT_FOUND,
          404,
          `파일 '${input.fileId}' 을(를) 찾을 수 없습니다`,
        );
      }
      // 자기 파일이나 업로드 미확정(presigned complete 전) = 409(설계서 §3.3)
      if (file.status !== 'ready') {
        throw new PartnerApiException(
          ErrV1.ERR_FILE_NOT_READY,
          409,
          `파일 '${input.fileId}' 업로드가 확정되지 않았습니다(status=${file.status})`,
        );
      }
      return file.id;
    }

    if (input.file) {
      if (input.file.size > BOOK_ASSET_DIRECT_UPLOAD_MAX_BYTES) {
        throw new PartnerApiException(
          ErrV1.ERR_FILE_TOO_LARGE,
          413,
          '직접 업로드 한도(100MB)를 초과했습니다 — presigned 업로드 후 fileId 참조 경로를 사용하세요',
        );
      }
      if (!BOOK_ASSET_DIRECT_UPLOAD_MIME.includes(input.file.mimetype)) {
        throw new PartnerApiException(
          ErrV1.ERR_UNSUPPORTED_CONTENT_TYPE,
          415,
          '직접 업로드는 PDF 만 지원합니다 — 이미지/기타 자산은 업로드 표면의 fileId 참조를 사용하세요',
        );
      }
      const saved = await this.filesService.uploadFile(
        input.file,
        this.mapAssetTypeToFileType(assetType),
        undefined,
        undefined,
        undefined,
        site.siteId,
      );
      return saved.id;
    }

    throw new PartnerApiException(
      ErrV1.ERR_VALIDATION_FAILED,
      400,
      '요청 검증에 실패했습니다',
      [],
      { file: ['fileId 참조 또는 file 직접 업로드 중 하나가 필요합니다'] },
    );
  }

  private mapAssetTypeToFileType(assetType: BookAssetType): FileType {
    if (assetType === 'pdf_cover') return FileType.COVER;
    if (assetType === 'pdf_contents') return FileType.CONTENT;
    return FileType.OTHER; // photo 등
  }

  private toAssetView(asset: BookAsset): BookAssetView {
    return {
      assetType: asset.assetType,
      fileId: asset.fileId,
      sortOrder: asset.sortOrder,
      status: asset.status,
      createdAt: asset.createdAt.toISOString(),
    };
  }
}
