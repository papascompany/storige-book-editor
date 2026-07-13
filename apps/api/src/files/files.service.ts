import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Brackets, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import type { Readable } from 'stream';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { FileEntity, FileType } from './entities/file.entity';
import { FileResponseDto } from './dto/file-response.dto';
import { ObjectStorageService } from '../storage/object-storage.service';

// SEC-010: 셸을 거치지 않는 execFile — 인자가 그대로 argv 로 전달돼 메타문자 해석/인젝션 불가.
const execFileAsync = promisify(execFile);

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly uploadPath: string;
  private readonly thumbnailPath: string;
  private readonly maxFileSize: number;
  private readonly ghostscriptPath: string;

  constructor(
    @InjectRepository(FileEntity)
    private fileRepository: Repository<FileEntity>,
    private configService: ConfigService,
    private objectStorage: ObjectStorageService,
  ) {
    this.uploadPath = this.configService.get<string>(
      'UPLOAD_PATH',
      './storage/uploads',
    );
    this.thumbnailPath = this.configService.get<string>(
      'THUMBNAIL_PATH',
      './storage/thumbnails',
    );
    this.maxFileSize = this.configService.get<number>(
      'STORAGE_MAX_FILE_SIZE',
      100 * 1024 * 1024, // 100MB
    );
    this.ghostscriptPath = this.configService.get<string>(
      'GHOSTSCRIPT_PATH',
      'gs',
    );
  }

  /**
   * 파일 업로드
   */
  async uploadFile(
    file: Express.Multer.File,
    type: FileType,
    orderSeqno?: number,
    memberSeqno?: number,
    metadata?: Record<string, any>,
    siteId?: string | null,
  ): Promise<FileEntity> {
    // 파일 크기 검증
    if (file.size > this.maxFileSize) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: `파일 크기가 ${Math.round(this.maxFileSize / 1024 / 1024)}MB를 초과합니다.`,
        details: { size: file.size, maxSize: this.maxFileSize },
      });
    }

    // MIME 타입 검증 (PDF만 허용)
    const allowedMimeTypes = ['application/pdf'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_FORMAT',
        message: '지원하지 않는 파일 형식입니다. PDF 파일만 업로드해주세요.',
        details: { mimeType: file.mimetype, allowed: allowedMimeTypes },
      });
    }

    // 파일명 + 저장 key 생성 (timestamp_uuid.ext)
    const timestamp = Date.now();
    const ext = path.extname(file.originalname).toLowerCase();
    const fileName = `${timestamp}_${uuidv4()}${ext}`;
    const storageKey = `uploads/${fileName}`; // STORAGE_PATH 상대 / s3 object key 공통
    const fileUrl = `/storage/uploads/${fileName}`; // 하위호환(local 직접서빙). s3는 fileId 다운로드로 접근.

    // active 백엔드에 저장 (local=파일시스템, s3=R2). ObjectStorageService 가 디렉토리/버킷 처리.
    const { backend } = await this.objectStorage.put(storageKey, file.buffer, file.mimetype);

    // filePath: local 은 절대경로(하위호환), s3 는 마커(로컬 fs 접근 차단 — getFileBuffer 가 backend 로 분기)
    const filePath =
      backend === 's3' ? `s3://${storageKey}` : path.join(this.uploadPath, fileName);

    // 엔티티 생성 및 저장
    const fileEntity = this.fileRepository.create({
      fileName,
      originalName: file.originalname,
      filePath,
      fileUrl,
      storageBackend: backend,
      storageKey,
      thumbnailUrl: null,
      fileSize: file.size,
      mimeType: file.mimetype,
      fileType: type,
      orderSeqno,
      memberSeqno,
      metadata,
      // P2c S-2: 외부 업로드 파일에 호출자 site 스탬프(테넌트 소유). 내부 업로드(siteId 미지정)=NULL=공유.
      siteId: siteId ?? null,
    });

    return this.fileRepository.save(fileEntity);
  }

  /**
   * 워커 산출(외부 저장경로) PDF 를 File 레코드로 등록 — P4 내지 임포지션 결과 되연결용 (2026-06-10).
   *
   * 업로드(uploadFile)와 달리 파일은 이미 워커가 STORAGE_PATH 아래(예: /storage/converted/x.pdf)에
   * 생성해 둔 상태다. 본 메서드는 그 경로를 검증(존재 + storage 루트 밖 traversal 방지)하고
   * 메타데이터만 files 테이블에 등록한다. (원본 업로드 PDF 는 별개 File 레코드로 그대로 보존됨.)
   *
   * @param outputFileUrl 워커 result.outputFileUrl (예: '/storage/converted/converted_<uuid>.pdf')
   * @param opts          원본 파일에서 승계할 분류/소유 정보
   * @returns 등록된 File 엔티티 (실패 시 throw — 호출측에서 best-effort 처리)
   */
  async registerExternalFile(
    outputFileUrl: string,
    opts: {
      fileType?: FileType;
      orderSeqno?: number | null;
      memberSeqno?: number | null;
      metadata?: Record<string, any>;
      siteId?: string | null; // P2c S-3: 워커 출력 파일에 원본 잡의 site 승계(테넌트 소유)
      /** 등록 파일의 실제 MIME — 미지정 시 기존 호출자(워커 PDF 출력) 호환 기본값 */
      mimeType?: string;
      /** 업로더가 보낸 원본 파일명 보존 — 미지정 시 디스크 파일명 */
      originalName?: string;
    } = {},
  ): Promise<FileEntity> {
    if (!outputFileUrl) {
      throw new BadRequestException({
        code: 'OUTPUT_URL_REQUIRED',
        message: 'outputFileUrl 이 필요합니다.',
      });
    }

    // outputFileUrl → 절대경로 변환 (downloadOutput 컨트롤러와 동일 규약)
    const storageBase = this.configService.get<string>('STORAGE_PATH', '/app/storage');
    let absolutePath: string;
    if (outputFileUrl.startsWith('/storage/')) {
      absolutePath = path.join(storageBase, outputFileUrl.replace(/^\/storage\//, ''));
    } else if (outputFileUrl.startsWith('storage/')) {
      absolutePath = path.join(storageBase, outputFileUrl.replace(/^storage\//, ''));
    } else if (path.isAbsolute(outputFileUrl)) {
      absolutePath = outputFileUrl;
    } else {
      absolutePath = path.join(storageBase, outputFileUrl);
    }

    // 보안: storage 루트 밖 path traversal 방지
    const resolvedPath = path.resolve(absolutePath);
    const resolvedBase = path.resolve(storageBase);
    if (!resolvedPath.startsWith(resolvedBase)) {
      throw new BadRequestException({
        code: 'INVALID_PATH',
        message: 'Output path is outside storage root',
      });
    }

    // 디스크 존재 + 크기 확인
    let fileSize = 0;
    try {
      const stat = await fs.stat(resolvedPath);
      fileSize = stat.size;
    } catch {
      throw new NotFoundException({
        code: 'FILE_NOT_ON_DISK',
        message: `등록 대상 파일이 디스크에 없습니다: ${outputFileUrl}`,
        details: { outputFileUrl },
      });
    }

    // 정규 URL 보장 (외부 응답/다운스트림은 file_url 사용)
    const normalizedUrl = outputFileUrl.startsWith('/')
      ? outputFileUrl
      : `/${outputFileUrl}`;
    const fileName = path.basename(resolvedPath);

    const fileEntity = this.fileRepository.create({
      fileName,
      originalName: opts.originalName ?? fileName,
      filePath: resolvedPath,
      fileUrl: normalizedUrl,
      thumbnailUrl: null,
      fileSize,
      mimeType: opts.mimeType ?? 'application/pdf',
      fileType: opts.fileType ?? FileType.CONTENT,
      orderSeqno: opts.orderSeqno ?? undefined,
      memberSeqno: opts.memberSeqno ?? undefined,
      metadata: opts.metadata,
      siteId: opts.siteId ?? null, // P2c S-3: 워커 출력 site 스탬프(외부 라우트 격리 적용 대상)
    });

    const saved = await this.fileRepository.save(fileEntity);
    this.logger.log(
      `Registered external file ${saved.id} from worker output (${normalizedUrl}, ${fileSize} bytes)`,
    );
    return saved;
  }

  /**
   * 파일 ID로 조회
   */
  async findById(id: string): Promise<FileEntity> {
    const file = await this.fileRepository.findOne({ where: { id } });

    if (!file) {
      throw new NotFoundException({
        code: 'FILE_NOT_FOUND',
        message: '파일을 찾을 수 없습니다.',
        details: { fileId: id },
      });
    }

    return file;
  }

  /**
   * 여러 파일을 In() 1회 배치 조회해 id→entity Map 반환 (DB-003 N+1 제거용).
   * 미존재 id 는 Map 에 없음 — 호출측이 findById 와 동일한 NotFoundException 을 던져 동작 보존.
   */
  async findManyByIds(ids: string[]): Promise<Map<string, FileEntity>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const files = await this.fileRepository.findBy({ id: In(unique) });
    return new Map(files.map((f) => [f.id, f]));
  }

  /**
   * 주문 번호로 파일 목록 조회
   */
  async findByOrderSeqno(orderSeqno: number): Promise<FileEntity[]> {
    return this.fileRepository.find({
      where: { orderSeqno },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 회원 번호로 파일 목록 조회
   */
  async findByMemberSeqno(memberSeqno: number): Promise<FileEntity[]> {
    return this.fileRepository.find({
      where: { memberSeqno },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 파일 삭제 (소프트 삭제)
   */
  async softDelete(id: string): Promise<void> {
    const file = await this.findById(id);
    await this.fileRepository.softDelete(file.id);
  }

  /**
   * 썸네일 URL 업데이트
   */
  async updateThumbnailUrl(id: string, thumbnailUrl: string): Promise<FileEntity> {
    const file = await this.findById(id);
    file.thumbnailUrl = thumbnailUrl;
    return this.fileRepository.save(file);
  }

  /**
   * 메타데이터 업데이트
   */
  async updateMetadata(
    id: string,
    metadata: Record<string, any>,
  ): Promise<FileEntity> {
    const file = await this.findById(id);
    file.metadata = { ...file.metadata, ...metadata };
    return this.fileRepository.save(file);
  }

  /**
   * 엔티티를 응답 DTO로 변환
   */
  toResponseDto(file: FileEntity): FileResponseDto {
    return {
      id: file.id,
      fileName: file.fileName,
      originalName: file.originalName,
      fileUrl: file.fileUrl,
      // SEC-008: filePath(절대경로·s3키) 미노출 — DTO 에서 제거.
      thumbnailUrl: file.thumbnailUrl,
      fileSize: Number(file.fileSize),
      mimeType: file.mimeType,
      fileType: file.fileType,
      orderSeqno: file.orderSeqno,
      memberSeqno: file.memberSeqno,
      metadata: file.metadata,
      storageBackend: file.storageBackend,
      status: file.status,
      expiresAt: file.expiresAt,
      createdAt: file.createdAt,
    };
  }

  /**
   * 파일 버퍼 읽기 (다운로드용) — storage_backend 로 라우팅.
   * s3 파일은 R2 에서, local 파일은 디스크에서 읽는다(혼재 보장).
   */
  /**
   * P2c S-2 테넌트 격리 — 외부(API Key) 라우트에서 호출자 site 와 파일 소유 site 대조.
   * file.siteId 가 NULL(레거시/시스템공유)이거나 callerSiteId 와 일치할 때만 허용.
   * 불일치 시 존재 노출 방지로 404(타 테넌트 파일 다운로드/하드삭제/만료 차단).
   * callerSiteId 미지정(내부 호출·retention cron)이면 검사 생략.
   */
  private assertSiteAccess(
    file: FileEntity,
    caller?: { siteId?: string; role?: string },
  ): void {
    // P2c: worker 역할(내부 워커, WORKER_API_KEY)·caller 미지정(내부 호출)은 바이패스.
    if (!caller || caller.role === 'worker') return;
    if (file.siteId && file.siteId !== caller.siteId) {
      throw new NotFoundException({
        code: 'FILE_NOT_FOUND',
        message: '파일을 찾을 수 없습니다.',
        details: { fileId: file.id },
      });
    }
  }

  /**
   * @deprecated 트랙 B-(c) 이후 런타임 호출처 0건. 다운로드/서빙은 전부 `getFileStream`(전체버퍼
   * 미적재)으로 전환됨. 동일 권한경계(findById+assertSiteAccess)가 두 벌로 남아 드리프트 위험이
   * 있으니, 권한·라우팅 변경 시 반드시 getFileStream 을 정본으로 보고 이 메서드는 제거를 검토할 것.
   */
  async getFileBuffer(
    id: string,
    caller?: { siteId?: string; role?: string },
  ): Promise<{ buffer: Buffer; file: FileEntity }> {
    const file = await this.findById(id);
    this.assertSiteAccess(file, caller);

    try {
      let buffer: Buffer;
      if (file.storageBackend === 's3') {
        if (!file.storageKey) {
          throw new Error('s3-backed 파일에 storage_key 가 없습니다.');
        }
        buffer = await this.objectStorage.get('s3', file.storageKey);
      } else {
        // local: 레거시 레코드는 storageKey 없이 filePath(절대경로)만 있음 → filePath 사용
        buffer = await fs.readFile(file.filePath);
      }
      return { buffer, file };
    } catch (error) {
      // SEC-007: 클라 응답에 S3 키·서버 절대경로 노출 금지(getFileStream 선례 정합).
      // 진단정보는 서버 로그로만.
      this.logger.warn(
        `getFileBuffer failed (id=${id}, backend=${file.storageBackend}, key=${file.storageKey}, path=${file.filePath}): ${(error as Error)?.message}`,
      );
      throw new NotFoundException({
        code: 'FILE_NOT_FOUND',
        message: '파일을 읽을 수 없습니다.',
        details: { fileId: id },
      });
    }
  }

  /**
   * 파일 **스트림** 읽기 (다운로드/인라인 서빙용) — 트랙 B-(c).
   * getFileBuffer 와 동일한 라우팅/권한(assertSiteAccess)을 적용하되 파일을 heap 에
   * 통째로 적재하지 않는다(2GB 도 API heap 상수). 호출측은 `stream.pipe(res)` + `stream.on('error')`.
   *
   * @returns stream(Readable), file(엔티티), size(Content-Length 용: local=실제 stat, s3=DB fileSize)
   *   - size 는 정확할 때만(>0) 반환. s3 의 fileSize 는 finalize 의 HeadObject 로 검증된 값.
   *   - s3 의 키 부재(NoSuchKey)는 getStream 의 await 중 throw → 여기서 catch → 404(헤더 전 안전).
   *   - local 의 부재(ENOENT)는 fs.stat 으로 선행 검출 → 404(스트림 생성 전, 헤더 전 안전).
   */
  async getFileStream(
    id: string,
    caller?: { siteId?: string; role?: string },
  ): Promise<{ stream: Readable; file: FileEntity; size?: number }> {
    const file = await this.findById(id);
    this.assertSiteAccess(file, caller);

    try {
      if (file.storageBackend === 's3') {
        if (!file.storageKey) {
          throw new Error('s3-backed 파일에 storage_key 가 없습니다.');
        }
        const stream = await this.objectStorage.getStream('s3', file.storageKey);
        const size = Number(file.fileSize);
        return { stream, file, size: Number.isFinite(size) && size > 0 ? size : undefined };
      }
      // local: 레거시 레코드는 storageKey 없이 filePath(절대경로)만 있음 → filePath 사용.
      // stat 으로 존재 확인(부재 시 헤더 전 404) + 정확한 Content-Length 취득.
      const stat = await fs.stat(file.filePath);
      const stream = createReadStream(file.filePath);
      return { stream, file, size: stat.size > 0 ? stat.size : undefined };
    } catch (error) {
      // 객체 부재(s3 NoSuchKey/NotFound, local ENOENT)는 404, 그 외(R2 타임아웃/5xx/네트워크
      // 장애)는 503 으로 분기 — 일시장애를 영구 404 로 오인해 클라가 재시도를 포기하는 것 방지.
      // details 에 내부 경로/키 비노출(정보누출 차단), fileId 만 유지. 원인은 서버 로그로.
      const err = error as Error & { name?: string; code?: string };
      const notFound =
        err?.name === 'NoSuchKey' ||
        err?.name === 'NotFound' ||
        err?.code === 'NoSuchKey' ||
        err?.code === 'ENOENT';
      this.logger.warn(
        `getFileStream 실패(fileId=${id}, backend=${file.storageBackend}, notFound=${notFound}): ${err?.name ?? ''} ${err?.message ?? String(error)}`,
      );
      if (notFound) {
        throw new NotFoundException({
          code: 'FILE_NOT_FOUND',
          message: '파일을 찾을 수 없습니다.',
          details: { fileId: id },
        });
      }
      throw new ServiceUnavailableException({
        code: 'STORAGE_UNAVAILABLE',
        message: '파일 저장소에 일시적으로 접근할 수 없습니다. 잠시 후 다시 시도해주세요.',
        details: { fileId: id },
      });
    }
  }

  /**
   * 파일 하드 삭제 (2026-06-13 보존정책/테넌트 삭제용).
   * 외부 테넌트(DELETE /files/:id/external) 즉시삭제용 — site 대조 후 영구 제거.
   * 저장 백엔드의 실제 객체 + DB 레코드를 모두 제거. 멱등(없으면 무시).
   * ⚠️ soft-deleted 파일은 findById 가 못 찾으므로(deleted_at IS NULL 자동 적용)
   *    purge cron 은 hardDeleteEntity 를 사용한다.
   */
  async hardDelete(
    id: string,
    caller?: { siteId?: string; role?: string },
  ): Promise<void> {
    const file = await this.findById(id);
    this.assertSiteAccess(file, caller);
    await this.hardDeleteEntity(file);
  }

  /**
   * purge 전용 — 이미 (withDeleted 로) 조회한 엔티티의 백엔드 객체 + DB 행을 영구 제거.
   * findById 재조회 없음(soft-deleted 행은 findById 가 못 찾음). 멱등.
   * hardDelete 와 백엔드/DB 삭제 로직을 공유한다.
   */
  async hardDeleteEntity(file: FileEntity): Promise<void> {
    // 백엔드 객체 삭제 (storageKey 있으면 그걸로, 없으면 local filePath fallback)
    if (file.storageKey) {
      await this.objectStorage.delete(file.storageBackend, file.storageKey);
    } else if (file.storageBackend === 'local' && file.filePath) {
      try {
        await fs.unlink(file.filePath);
      } catch {
        /* 이미 없으면 무시 */
      }
    }
    // DB 레코드 영구 삭제 (soft-deleted 행도 .delete() 로 물리 제거됨 — 보존정책상 완전 제거)
    await this.fileRepository.delete(file.id);
    this.logger.log(`Hard-deleted file ${file.id} (backend=${file.storageBackend})`);
  }

  /**
   * 소프트삭제 복구 (48h 복구창 내) — deleted_at NULL 로 되돌림.
   * withDeleted 로 조회(소프트삭제 행은 기본 findById 가 못 찾음).
   * 이미 purge(hardDelete)된 경우 NotFoundException. 이미 활성이면 멱등 반환.
   * admin 라우트 노출은 P1.
   * @returns 복구된 엔티티
   */
  async restore(id: string): Promise<FileEntity> {
    const file = await this.fileRepository.findOne({
      where: { id },
      withDeleted: true,
    });
    if (!file) {
      throw new NotFoundException({
        code: 'FILE_NOT_FOUND',
        message: '파일을 찾을 수 없습니다.',
        details: { fileId: id },
      });
    }
    if (!file.deletedAt) {
      return file; // 이미 활성 — 멱등
    }
    await this.fileRepository.restore(id); // TypeORM: deleted_at = NULL
    return this.findById(id);
  }

  /**
   * 보존 만료 시각 설정 (테넌트가 주문 이행 후 'N일 뒤 삭제' 예약).
   * null 로 설정하면 영구보관으로 되돌림.
   */
  async setExpiry(
    id: string,
    expiresAt: Date | null,
    caller?: { siteId?: string; role?: string },
  ): Promise<FileEntity> {
    const file = await this.findById(id);
    this.assertSiteAccess(file, caller);
    file.expiresAt = expiresAt;
    return this.fileRepository.save(file);
  }

  /**
   * 만료된(expires_at < now) 파일 조회 — retention cron 용. limit 으로 배치 제한.
   *
   * P0 무중단 가드 (2026-07-03): **미완결 주문에 연결된 파일은 만료 sweep 에서 제외**한다.
   * ⚠️ `order_seqno IS NULL` 단독 가드는 오답 — 100p/MD2 등 retention 오프로드 테넌트는
   *    order_seqno 와 expires_at 을 **동시 스탬프**(uploadFileExternal 이 orderSeqno 스탬프 후
   *    setExpiry)하므로, 그 방식은 이들의 정상 만료를 영구 차단해 스토리지 무한 잔존을 부른다.
   * 따라서 **주문 상태(편집세션 status)를 조인**해, 진행 중(status <> 'complete')인 세션이 존재하는
   * 주문의 파일만 보호하고, 완결됐거나 편집세션이 아예 없는(순수 워커 오프로드) 파일은 예약된
   * expires_at 대로 만료시킨다. site 스코프를 함께 대조해 파트너 간 order_seqno 충돌로 인한
   * 오보호를 줄인다(양측 site_id NULL 은 동일 스코프로 간주). 데이터손실 < 디스크 잔존 원칙상
   * 경계 사례에서는 보호(만료 제외) 쪽으로 기운다.
   *
   * ⚠️ 배포 전 retention.dryRun=ON 으로 sweep 후보 건수 before/after 표본 검증 필수
   *    (모든 파일이 미완결 주문 연결이면 '아무것도 만료 안 됨' 침묵실패 가능).
   */
  async findExpired(limit = 200): Promise<FileEntity[]> {
    return this.fileRepository
      .createQueryBuilder('f')
      .where('f.expires_at IS NOT NULL')
      .andWhere('f.expires_at < :now', { now: new Date() })
      .andWhere(
        `NOT EXISTS (
           SELECT 1 FROM file_edit_sessions s
           WHERE s.order_seqno = f.order_seqno
             AND s.status <> 'complete'
             AND s.deleted_at IS NULL
             AND (
               s.site_id = f.site_id
               OR (s.site_id IS NULL AND f.site_id IS NULL)
             )
         )`,
      )
      .orderBy('f.expires_at', 'ASC')
      .take(limit)
      .getMany();
  }

  /**
   * purge 대상 조회 — **보존정책 만료로 soft-delete 된** 파일 중 GRACE 시간 지난 것.
   * ⚠️ withDeleted(true) 필수: 기본 쿼리는 deleted_at IS NOT NULL 행을 자동 제외하므로
   * 명시적으로 포함시켜야 purge cron 이 찾을 수 있다.
   * ⚠️ expires_at IS NOT NULL 제한: 보존 sweep(만료예약 파일만)으로 soft-delete 된 것만 영구삭제.
   *    수동삭제(DELETE /files/:id → softDelete, expires_at 미설정)는 purge 대상에서 제외해
   *    소프트삭제 상태로 보존(복구 가능) — 의도치 않은 영구손실 방지. (고아 정리는 P1 별도)
   * @param cutoff  deleted_at < cutoff 인 행만 (예: now - 48h)
   * @param limit   배치 제한
   */
  async findSoftDeletedOlderThan(cutoff: Date, limit = 200): Promise<FileEntity[]> {
    return this.fileRepository
      .createQueryBuilder('f')
      .withDeleted() // soft-deleted 행 포함
      .where('f.deleted_at IS NOT NULL')
      .andWhere('f.deleted_at < :cutoff', { cutoff })
      .andWhere('f.expires_at IS NOT NULL') // 보존 만료분만 — 수동삭제 보존
      .orderBy('f.deleted_at', 'ASC')
      .take(limit)
      .getMany();
  }

  /**
   * P1 고아 파일 후보 조회 — **보수적 NOT EXISTS**. 데이터손실 방지가 최우선.
   *
   * 후보 조건 (전부 AND):
   *  1) order_seqno IS NULL          (주문 연결 없음)
   *  2) deleted_at IS NULL           (이미 soft-deleted 제외 — 중복강등 방지)
   *  3) status IN ('pending','failed','ready')
   *  4) created_at < (now - grace)   grace: pending/failed=pendingHours, ready=readyDays
   *  5) NOT EXISTS 어떤 file_edit_sessions 의 cover_file_id / content_file_id / content_pdf_file_id
   *  6) NOT EXISTS 어떤 worker_jobs 의 file_id / output_file_id / pdf_file_id (id 직접)
   *     또는 input_file_url / output_file_url 가 api://<id> · file_path · s3://<key> · %/<key> 포함
   *
   * ⚠️ 세션/잡 참조 조회는 deleted_at 무시(soft-deleted 세션의 참조도 유효 — 복구 대비).
   * ⚠️ storage_key NULL 이면 key 기반 url 매칭은 건너뜀(NULL substring 매칭 사고 방지).
   * ⚠️ 후보 0건 의심 시(쿼리 변경 후) 반드시 dryRun 로그로 표본 검증.
   *
   * @returns 강등 대상 FileEntity[] (배치 limit)
   */
  async findOrphanCandidates(
    pendingFailedGraceHours: number,
    readyGraceDays: number,
    limit = 200,
  ): Promise<FileEntity[]> {
    const now = Date.now();
    const pfCutoff = new Date(now - pendingFailedGraceHours * 60 * 60 * 1000);
    const readyCutoff = new Date(now - readyGraceDays * 24 * 60 * 60 * 1000);

    const qb = this.fileRepository
      .createQueryBuilder('f')
      .where('f.order_seqno IS NULL')
      .andWhere('f.deleted_at IS NULL')
      // status별 grace를 한 조건으로 — 애매하면 보존(범위 밖이면 후보 제외)
      .andWhere(
        new Brackets((b) => {
          b.where('(f.status IN (:...pf) AND f.created_at < :pfCutoff)', {
            pf: ['pending', 'failed'],
            pfCutoff,
          }).orWhere('(f.status = :ready AND f.created_at < :readyCutoff)', {
            ready: 'ready',
            readyCutoff,
          });
        }),
      )
      // ── (5) edit_session 참조 없음 (3개 컬럼 전부) ──
      .andWhere(
        `NOT EXISTS (
           SELECT 1 FROM file_edit_sessions s
           WHERE s.cover_file_id = f.id
              OR s.content_file_id = f.id
              OR s.content_pdf_file_id = f.id
         )`,
      )
      // ── (6) worker_job 참조 없음 (id 3컬럼 + url 2컬럼 + options JSON 역참조) ──
      // ⚠️ 데이터손실 방지: 일부 잡은 파일참조를 컬럼이 아닌 options JSON 안에만 둔다 —
      //    spread-merge(createSpreadSynthesisJob): options.spreadPdfFileId(id) · options.contentPdfFileIds[](id 배열)
      //    compose-mixed(createComposeMixedJob): options.coverUrl · options.contentPdfUrl · options.front/backEndpaperUrls[](url)
      //    컬럼만 보면 이들이 고아로 오판된다 → JSON 경로까지 역참조(JSON_CONTAINS/->>) 추가.
      .andWhere(
        `NOT EXISTS (
           SELECT 1 FROM worker_jobs w
           WHERE w.file_id = f.id
              OR w.output_file_id = f.id
              OR w.pdf_file_id = f.id
              OR w.input_file_url  = CONCAT('api://', f.id)
              OR w.output_file_url = CONCAT('api://', f.id)
              OR w.input_file_url  = f.file_path
              OR w.output_file_url = f.file_path
              OR (f.storage_key IS NOT NULL AND w.input_file_url  = CONCAT('s3://', f.storage_key))
              OR (f.storage_key IS NOT NULL AND w.output_file_url = CONCAT('s3://', f.storage_key))
              OR (f.storage_key IS NOT NULL AND w.input_file_url  LIKE CONCAT('%/', f.storage_key))
              OR (f.storage_key IS NOT NULL AND w.output_file_url LIKE CONCAT('%/', f.storage_key))
              OR (w.options IS NOT NULL AND (
                   JSON_VALUE(w.options, '$.spreadPdfFileId') = f.id
                OR JSON_VALUE(w.options, '$.pdfFileId') = f.id
                OR JSON_CONTAINS(JSON_EXTRACT(w.options, '$.contentPdfFileIds'), JSON_QUOTE(f.id))
                OR JSON_VALUE(w.options, '$.coverUrl') = f.file_url
                OR JSON_VALUE(w.options, '$.contentPdfUrl') = f.file_url
                OR JSON_CONTAINS(JSON_EXTRACT(w.options, '$.frontEndpaperUrls'), JSON_QUOTE(f.file_url))
                OR JSON_CONTAINS(JSON_EXTRACT(w.options, '$.backEndpaperUrls'), JSON_QUOTE(f.file_url))
              ))
         )`,
      )
      .orderBy('f.created_at', 'ASC')
      .take(limit);

    return qb.getMany();
  }

  /**
   * P1 고아 강등 — expires_at=now 세팅 후 softDelete. **순서 필수**.
   * purge(findSoftDeletedOlderThan)는 expires_at IS NOT NULL 만 회수하므로,
   * expires_at 없이 softDelete 하면 고아가 soft 상태로 영구잔존한다.
   * → expires_at=now 로 즉시 '만료' 표식 + deleted_at 세팅 = 48h 후 기존 purge 가 hardDelete.
   * 단일 UPDATE 로 원자적 처리(soft-delete 컬럼 deleted_at 직접 세팅).
   * @returns true=강등됨, false=대상 아님(이미 처리/없음 — 멱등)
   */
  async softDeleteWithExpiry(id: string): Promise<boolean> {
    const res = await this.fileRepository
      .createQueryBuilder()
      .update(FileEntity)
      .set({ expiresAt: () => 'NOW()', deletedAt: () => 'NOW()' })
      .where('id = :id', { id })
      .andWhere('deleted_at IS NULL') // 이미 강등된 행 재처리 방지(멱등)
      .execute();
    return (res.affected ?? 0) > 0;
  }

  /**
   * 디렉토리 존재 확인 및 생성
   */
  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  /**
   * PDF 썸네일 생성
   * Ghostscript를 사용하여 PDF의 특정 페이지를 PNG로 변환
   */
  async generateThumbnail(
    fileId: string,
    page: number = 1,
    width: number = 200,
    caller?: { siteId?: string; role?: string },
  ): Promise<string> {
    const file = await this.findById(fileId);

    // P0-3: 테넌트 격리 — findById 직후·mimeType 검사 전에 대조(getFileStream 선례와 동일 위치).
    // 불일치 시 여기서 404 로 종료되므로 아래 GS 래스터화·thumbnailUrl 저장 부수효과는
    // 인가된 테넌트(또는 내부/worker)에서만 발생한다.
    this.assertSiteAccess(file, caller);

    // PDF 파일만 썸네일 생성 가능
    if (file.mimeType !== 'application/pdf') {
      throw new BadRequestException({
        code: 'UNSUPPORTED_FORMAT',
        message: 'PDF 파일만 썸네일을 생성할 수 있습니다.',
        details: { mimeType: file.mimeType },
      });
    }

    // 썸네일 디렉토리 생성
    await this.ensureDirectoryExists(this.thumbnailPath);

    // 썸네일 파일명 생성
    const baseName = path.parse(file.fileName).name;
    const thumbnailFileName = `${baseName}_p${page}_w${width}.png`;
    const thumbnailFilePath = path.join(this.thumbnailPath, thumbnailFileName);
    const thumbnailUrl = `/storage/thumbnails/${thumbnailFileName}`;

    // 이미 생성된 썸네일이 있으면 반환
    try {
      await fs.access(thumbnailFilePath);
      this.logger.debug(`Thumbnail already exists: ${thumbnailFilePath}`);
      return thumbnailUrl;
    } catch {
      // 썸네일 없음, 새로 생성
    }

    // 임시 파일 경로 (Ghostscript 출력용)
    const tempFilePath = path.join(this.thumbnailPath, `${baseName}_p${page}_temp.png`);

    try {
      // Ghostscript를 사용해 PDF → PNG 변환
      // SEC-010: execFile(인자배열, 셸 없음)로 실행 — 따옴표/메타문자 이스케이프 불필요,
      // filePath 가 오염돼도 커맨드 인젝션 불가(argv 로 그대로 전달).
      const gsArgs = [
        '-dSAFER',
        '-dBATCH',
        '-dNOPAUSE',
        '-sDEVICE=pngalpha',
        `-dFirstPage=${page}`,
        `-dLastPage=${page}`,
        '-r150', // 150 DPI
        '-dTextAlphaBits=4',
        '-dGraphicsAlphaBits=4',
        `-sOutputFile=${tempFilePath}`,
        file.filePath,
      ];

      this.logger.debug(`Executing Ghostscript: ${this.ghostscriptPath} ${gsArgs.join(' ')}`);
      await execFileAsync(this.ghostscriptPath, gsArgs);

      // Sharp로 리사이즈
      await sharp(tempFilePath)
        .resize(width, null, { withoutEnlargement: true })
        .png({ quality: 80 })
        .toFile(thumbnailFilePath);

      // 임시 파일 삭제
      try {
        await fs.unlink(tempFilePath);
      } catch {
        // 임시 파일 삭제 실패 무시
      }

      // 파일 엔티티에 첫 번째 썸네일 URL 저장 (page=1, default width인 경우)
      if (page === 1 && !file.thumbnailUrl) {
        file.thumbnailUrl = thumbnailUrl;
        await this.fileRepository.save(file);
      }

      this.logger.log(`Thumbnail generated: ${thumbnailFilePath}`);
      return thumbnailUrl;
    } catch (error) {
      this.logger.error(`Failed to generate thumbnail: ${error.message}`, error.stack);

      // 임시 파일 정리
      try {
        await fs.unlink(tempFilePath);
      } catch {
        // 무시
      }

      throw new BadRequestException({
        code: 'THUMBNAIL_GENERATION_FAILED',
        message: '썸네일 생성에 실패했습니다.',
        details: {
          fileId,
          page,
          error: error.message,
        },
      });
    }
  }

  /**
   * 썸네일 버퍼 읽기 (다운로드용)
   */
  async getThumbnailBuffer(
    fileId: string,
    page: number = 1,
    width: number = 200,
    caller?: { siteId?: string; role?: string },
  ): Promise<Buffer> {
    const thumbnailUrl = await this.generateThumbnail(fileId, page, width, caller);
    const thumbnailPath = path.join(
      this.thumbnailPath,
      path.basename(thumbnailUrl),
    );

    try {
      return await fs.readFile(thumbnailPath);
    } catch (error) {
      throw new NotFoundException({
        code: 'THUMBNAIL_NOT_FOUND',
        message: '썸네일 파일을 읽을 수 없습니다.',
        details: { fileId, path: thumbnailPath },
      });
    }
  }
}
