import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { FileEntity, FileType } from './entities/file.entity';
import { FileResponseDto } from './dto/file-response.dto';
import { ObjectStorageService } from '../storage/object-storage.service';

const execAsync = promisify(exec);

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
      originalName: fileName,
      filePath: resolvedPath,
      fileUrl: normalizedUrl,
      thumbnailUrl: null,
      fileSize,
      mimeType: 'application/pdf',
      fileType: opts.fileType ?? FileType.CONTENT,
      orderSeqno: opts.orderSeqno ?? undefined,
      memberSeqno: opts.memberSeqno ?? undefined,
      metadata: opts.metadata,
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
      filePath: file.filePath,
      thumbnailUrl: file.thumbnailUrl,
      fileSize: Number(file.fileSize),
      mimeType: file.mimeType,
      fileType: file.fileType,
      orderSeqno: file.orderSeqno,
      memberSeqno: file.memberSeqno,
      metadata: file.metadata,
      storageBackend: file.storageBackend,
      expiresAt: file.expiresAt,
      createdAt: file.createdAt,
    };
  }

  /**
   * 파일 버퍼 읽기 (다운로드용) — storage_backend 로 라우팅.
   * s3 파일은 R2 에서, local 파일은 디스크에서 읽는다(혼재 보장).
   */
  async getFileBuffer(id: string): Promise<{ buffer: Buffer; file: FileEntity }> {
    const file = await this.findById(id);

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
      throw new NotFoundException({
        code: 'FILE_NOT_FOUND',
        message: '파일을 읽을 수 없습니다.',
        details: { fileId: id, backend: file.storageBackend, key: file.storageKey, path: file.filePath },
      });
    }
  }

  /**
   * 파일 하드 삭제 (2026-06-13 보존정책/테넌트 삭제용).
   * 저장 백엔드의 실제 객체 + DB 레코드를 모두 제거. 멱등(없으면 무시).
   * ⚠️ 외부 테넌트가 주문 이행 완료 후 호출(DELETE /files/:id/external) 하거나 retention cron 이 사용.
   */
  async hardDelete(id: string): Promise<void> {
    const file = await this.findById(id);
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
    // DB 레코드 영구 삭제 (soft delete 아님 — 보존정책상 완전 제거)
    await this.fileRepository.delete(file.id);
    this.logger.log(`Hard-deleted file ${id} (backend=${file.storageBackend})`);
  }

  /**
   * 보존 만료 시각 설정 (테넌트가 주문 이행 후 'N일 뒤 삭제' 예약).
   * null 로 설정하면 영구보관으로 되돌림.
   */
  async setExpiry(id: string, expiresAt: Date | null): Promise<FileEntity> {
    const file = await this.findById(id);
    file.expiresAt = expiresAt;
    return this.fileRepository.save(file);
  }

  /** 만료된(expires_at < now) 파일 조회 — retention cron 용. limit 으로 배치 제한. */
  async findExpired(limit = 200): Promise<FileEntity[]> {
    return this.fileRepository
      .createQueryBuilder('f')
      .where('f.expires_at IS NOT NULL')
      .andWhere('f.expires_at < :now', { now: new Date() })
      .orderBy('f.expires_at', 'ASC')
      .take(limit)
      .getMany();
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
  ): Promise<string> {
    const file = await this.findById(fileId);

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
      const gsCommand = [
        this.ghostscriptPath,
        '-dSAFER',
        '-dBATCH',
        '-dNOPAUSE',
        '-sDEVICE=pngalpha',
        `-dFirstPage=${page}`,
        `-dLastPage=${page}`,
        '-r150', // 150 DPI
        '-dTextAlphaBits=4',
        '-dGraphicsAlphaBits=4',
        `-sOutputFile="${tempFilePath}"`,
        `"${file.filePath}"`,
      ].join(' ');

      this.logger.debug(`Executing Ghostscript: ${gsCommand}`);
      await execAsync(gsCommand);

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
  ): Promise<Buffer> {
    const thumbnailUrl = await this.generateThumbnail(fileId, page, width);
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
