import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes, timingSafeEqual } from 'crypto';
import { FileEntity, FileType } from './entities/file.entity';
import { ObjectStorageService } from '../storage/object-storage.service';
import { StorageConfigService } from '../settings/storage-config.service';

/** presigned PUT/part URL 만료(초). R2 권장 단명. */
const PRESIGN_EXPIRES_SEC = 900;

/**
 * presigned 직결 허용 contentType 화이트리스트.
 * 게스트(@Public)도 발급하므로 임의 MIME 업로드를 차단한다.
 * key=허용 MIME, value=storageKey 확장자.
 */
const ALLOWED_CONTENT_TYPES: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  // 'image/svg+xml' 제외: presigned 발급이 @Public(게스트 도달)이라 JS 내장 SVG 인라인 서빙 시
  // Stored XSS 위험(보안 적대검증 high). SVG 에셋은 ≤50MB 레거시 업로드 경로 사용.
};
/** 미지정 시 기본(하위호환 — 기존 PDF 흐름). */
const DEFAULT_CONTENT_TYPE = 'application/pdf';

/** expected_size 상한(2GB). 클라 선언값 검증 + complete HeadObject 대조. */
const MAX_EXPECTED_SIZE = 2 * 1024 * 1024 * 1024;
/** 발급된 pending 업로드의 미완 방치 TTL(24h). complete 시 retention 으로 재설정. */
const PRESIGN_PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export interface PresignInitResult {
  fileId: string;
  uploadUrl: string;
  storageKey: string;
  /** 업로드 세션 소유 토큰 — complete 호출 시 그대로 되돌려줘야 한다(IDOR 차단). */
  uploadToken: string;
  expiresIn: number;
}
export interface MultipartInitResult {
  fileId: string;
  uploadId: string;
  storageKey: string;
  /** 업로드 세션 소유 토큰 — sign/complete/abort 호출 시 그대로 되돌려줘야 한다(IDOR 차단). */
  uploadToken: string;
}
export interface MultipartSignResult {
  url: string;
  partNumber: number;
  expiresIn: number;
}

@Injectable()
export class PresignedUploadService {
  private readonly logger = new Logger(PresignedUploadService.name);

  constructor(
    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,
    private readonly objectStorage: ObjectStorageService,
    private readonly storageConfig: StorageConfigService,
  ) {}

  /** s3 드라이버가 아니면 503 STORAGE_NOT_S3 (비파괴 게이트). 모든 진입점에서 선행 호출. */
  private async assertS3Driver(): Promise<void> {
    const cfg = await this.storageConfig.getEffectiveConfig();
    if (cfg.driver !== 's3') {
      throw new ServiceUnavailableException({
        code: 'STORAGE_NOT_S3',
        message: 'presigned 직결 업로드는 객체스토리지(s3/R2) 드라이버에서만 가능합니다.',
      });
    }
  }

  /** contentType 검증 → 정규화. 미지정=기본(pdf), 미허용=거부(400). */
  private resolveContentType(contentType?: string): { mime: string; ext: string } {
    if (contentType == null) {
      return { mime: DEFAULT_CONTENT_TYPE, ext: ALLOWED_CONTENT_TYPES[DEFAULT_CONTENT_TYPE] };
    }
    const mime = contentType.trim().toLowerCase();
    const ext = ALLOWED_CONTENT_TYPES[mime];
    if (!ext) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_CONTENT_TYPE',
        message: '허용되지 않는 파일 형식입니다.',
        details: { contentType: mime, allowed: Object.keys(ALLOWED_CONTENT_TYPES) },
      });
    }
    return { mime, ext };
  }

  /** 서버 생성 key — 클라가 절대 지정 못 함(path traversal/덮어쓰기 방지). 확장자는 contentType 에 바인딩. */
  private newKey(ext: string): string {
    return `uploads/${Date.now()}_${uuidv4()}.${ext}`;
  }

  /** 업로드 세션 소유 토큰(고엔트로피, 64 hex chars). */
  private newToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * 소유 토큰 상수시간 대조 — pending 업로드의 sign/complete/abort 는 발급받은 토큰 보유자만 가능.
   * fileId(UUID)만 아는 제3자의 IDOR(가로채기/abort/파트 주입) 차단. 불일치/누락은 존재를 숨기려
   * NotFound 로 응답.
   */
  private assertToken(file: FileEntity, token?: string): void {
    const expected = file.uploadToken;
    const fail = () => {
      throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: '업로드 세션을 찾을 수 없습니다.' });
    };
    if (!expected || !token) return fail();
    const a = Buffer.from(expected);
    const b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return fail();
  }

  private validateExpectedSize(expectedSize?: number): number | null {
    if (expectedSize == null) return null;
    if (!Number.isFinite(expectedSize) || expectedSize <= 0) {
      throw new BadRequestException({ code: 'INVALID_SIZE', message: 'expectedSize 가 올바르지 않습니다.' });
    }
    if (expectedSize > MAX_EXPECTED_SIZE) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: `파일 크기가 ${Math.round(MAX_EXPECTED_SIZE / 1024 / 1024)}MB 상한을 초과합니다.`,
        details: { size: expectedSize, maxSize: MAX_EXPECTED_SIZE },
      });
    }
    return expectedSize;
  }

  // ── single-part ──────────────────────────────────────────────
  async presignPut(opts: {
    fileType: FileType;
    expectedSize?: number;
    originalName?: string;
    orderSeqno?: number | null;
    memberSeqno?: number | null;
    siteId?: string | null;
    contentType?: string;
  }): Promise<PresignInitResult> {
    await this.assertS3Driver();
    const expected = this.validateExpectedSize(opts.expectedSize);
    const { mime, ext } = this.resolveContentType(opts.contentType);
    const { client, bucket } = await this.objectStorage.ensureS3();
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

    const storageKey = this.newKey(ext);
    // contentType 바인딩 — 클라 PUT 헤더가 일치해야 서명 유효(화이트리스트 값).
    const cmd = new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      ContentType: mime,
      // ContentLength 는 R2 presigned PUT 에서 서명 바인딩이 까다로워 강제하지 않고
      // complete 시 HeadObject 로 검증한다(아래 finalize 참고).
    });
    const uploadUrl = await getSignedUrl(client, cmd, { expiresIn: PRESIGN_EXPIRES_SEC });

    const uploadToken = this.newToken();
    const file = await this.fileRepository.save(
      this.fileRepository.create({
        fileName: storageKey.split('/').pop()!,
        originalName: opts.originalName?.slice(0, 255) ?? storageKey.split('/').pop()!,
        filePath: `s3://${storageKey}`,
        fileUrl: `/storage/${storageKey}`,
        storageBackend: 's3',
        storageKey,
        status: 'pending',
        expiresAt: new Date(Date.now() + PRESIGN_PENDING_TTL_MS), // 미완 pending 자동만료(24h)
        expectedSize: expected,
        uploadToken,
        thumbnailUrl: null,
        fileSize: 0, // complete 시 실제 크기로 갱신
        mimeType: mime, // 화이트리스트 값으로 저장(finalize 에서 불변)
        fileType: opts.fileType,
        orderSeqno: opts.orderSeqno ?? undefined,
        memberSeqno: opts.memberSeqno ?? undefined,
        siteId: opts.siteId ?? null,
      }),
    );
    return { fileId: file.id, uploadUrl, storageKey, uploadToken, expiresIn: PRESIGN_EXPIRES_SEC };
  }

  // ── multipart ────────────────────────────────────────────────
  async initMultipart(opts: {
    fileType: FileType;
    expectedSize?: number;
    originalName?: string;
    orderSeqno?: number | null;
    memberSeqno?: number | null;
    siteId?: string | null;
    contentType?: string;
  }): Promise<MultipartInitResult> {
    await this.assertS3Driver();
    const expected = this.validateExpectedSize(opts.expectedSize);
    const { mime, ext } = this.resolveContentType(opts.contentType);
    const { client, bucket } = await this.objectStorage.ensureS3();
    const { CreateMultipartUploadCommand } = await import('@aws-sdk/client-s3');

    const storageKey = this.newKey(ext);
    const res = await client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: storageKey,
        ContentType: mime,
      }),
    );
    const uploadId = res.UploadId!;
    const uploadToken = this.newToken();
    const file = await this.fileRepository.save(
      this.fileRepository.create({
        fileName: storageKey.split('/').pop()!,
        originalName: opts.originalName?.slice(0, 255) ?? storageKey.split('/').pop()!,
        filePath: `s3://${storageKey}`,
        fileUrl: `/storage/${storageKey}`,
        storageBackend: 's3',
        storageKey,
        status: 'pending',
        expiresAt: new Date(Date.now() + PRESIGN_PENDING_TTL_MS), // 미완 pending 자동만료(24h)
        multipartUploadId: uploadId,
        expectedSize: expected,
        uploadToken,
        thumbnailUrl: null,
        fileSize: 0,
        mimeType: mime, // 화이트리스트 값으로 저장(finalize 에서 불변)
        fileType: opts.fileType,
        orderSeqno: opts.orderSeqno ?? undefined,
        memberSeqno: opts.memberSeqno ?? undefined,
        siteId: opts.siteId ?? null,
      }),
    );
    return { fileId: file.id, uploadId, storageKey, uploadToken };
  }

  async signUploadPart(
    fileId: string,
    partNumber: number,
    uploadToken: string,
  ): Promise<MultipartSignResult> {
    await this.assertS3Driver();
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
      throw new BadRequestException({ code: 'INVALID_PART', message: 'partNumber 는 1~10000 이어야 합니다.' });
    }
    const file = await this.requirePending(fileId, undefined, uploadToken);
    const { client, bucket } = await this.objectStorage.ensureS3();
    const { UploadPartCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const url = await getSignedUrl(
      client,
      new UploadPartCommand({
        Bucket: bucket,
        Key: file.storageKey!,
        UploadId: file.multipartUploadId!,
        PartNumber: partNumber,
      }),
      { expiresIn: PRESIGN_EXPIRES_SEC },
    );
    return { url, partNumber, expiresIn: PRESIGN_EXPIRES_SEC };
  }

  async completeMultipart(
    fileId: string,
    parts: { partNumber: number; etag: string }[],
    uploadToken: string,
    caller?: { siteId?: string; role?: string },
    retentionDays?: number | null,
  ): Promise<FileEntity> {
    await this.assertS3Driver();
    const file = await this.requirePending(fileId, caller, uploadToken);
    if (!parts?.length) {
      throw new BadRequestException({ code: 'NO_PARTS', message: 'parts 가 비어 있습니다.' });
    }
    const { client, bucket } = await this.objectStorage.ensureS3();
    const { CompleteMultipartUploadCommand } = await import('@aws-sdk/client-s3');
    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: file.storageKey!,
        UploadId: file.multipartUploadId!,
        MultipartUpload: {
          Parts: parts
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );
    return this.finalize(file, retentionDays);
  }

  async abortMultipart(fileId: string, uploadToken: string): Promise<void> {
    await this.assertS3Driver();
    const file = await this.fileRepository.findOne({ where: { id: fileId } });
    if (!file || file.storageBackend !== 's3' || !file.multipartUploadId) return; // 멱등(이미 정리됨)
    // 진행중(pending) 세션 abort 는 소유 토큰 보유자만 — 제3자의 임의 abort 차단.
    if (file.status === 'pending') this.assertToken(file, uploadToken);
    try {
      const { client, bucket } = await this.objectStorage.ensureS3();
      const { AbortMultipartUploadCommand } = await import('@aws-sdk/client-s3');
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: file.storageKey!,
          UploadId: file.multipartUploadId,
        }),
      );
    } catch (e) {
      this.logger.warn(`abortMultipart(${fileId}) R2 실패(무시): ${(e as Error).message}`);
    }
    file.status = 'failed';
    file.multipartUploadId = null;
    file.uploadToken = null;
    await this.fileRepository.save(file);
  }

  /** single-part complete — 클라 R2 PUT 끝난 뒤 호출. HeadObject 로 존재/크기 검증. */
  async completeSingle(
    fileId: string,
    uploadToken: string,
    caller?: { siteId?: string; role?: string },
    retentionDays?: number | null,
  ): Promise<FileEntity> {
    await this.assertS3Driver();
    const file = await this.requirePending(fileId, caller, uploadToken);
    return this.finalize(file, retentionDays);
  }

  // ── 공통 검증/마무리 ─────────────────────────────────────────
  private async requirePending(
    fileId: string,
    caller?: { siteId?: string; role?: string },
    token?: string,
  ): Promise<FileEntity> {
    const file = await this.fileRepository.findOne({ where: { id: fileId } });
    if (!file || file.storageBackend !== 's3') {
      throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: '업로드 세션을 찾을 수 없습니다.' });
    }
    // 테넌트 격리 — 외부 호출자의 site 와 대조(NULL=공유 허용, worker 바이패스).
    if (caller && caller.role !== 'worker' && file.siteId && file.siteId !== caller.siteId) {
      throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: '업로드 세션을 찾을 수 없습니다.' });
    }
    if (file.status === 'ready') return file; // complete 멱등 재호출 허용(토큰은 이미 소거됨)
    if (file.status !== 'pending') {
      throw new BadRequestException({ code: 'INVALID_STATE', message: `업로드 상태가 올바르지 않습니다(${file.status}).` });
    }
    // pending 세션 작업(sign/complete)은 발급받은 소유 토큰 보유자만 — IDOR 차단.
    this.assertToken(file, token);
    return file;
  }

  /** HeadObject 로 R2 객체 존재/ContentType/크기 검증 → status='ready' 확정. */
  private async finalize(
    file: FileEntity,
    retentionDays?: number | null,
  ): Promise<FileEntity> {
    const { client, bucket } = await this.objectStorage.ensureS3();
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    let head;
    try {
      head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: file.storageKey! }));
    } catch {
      throw new BadRequestException({
        code: 'UPLOAD_NOT_FOUND_ON_R2',
        message: '업로드된 객체가 R2 에 없습니다. 다시 업로드해주세요.',
        details: { fileId: file.id, key: file.storageKey },
      });
    }
    const actualSize = Number(head.ContentLength ?? 0);
    if (actualSize <= 0) {
      throw new BadRequestException({ code: 'EMPTY_UPLOAD', message: '업로드된 파일이 비어 있습니다.' });
    }
    const rejectAndCleanup = async (code: string, message: string, details?: unknown) => {
      await this.objectStorage.delete('s3', file.storageKey!).catch(() => undefined);
      file.status = 'failed';
      file.uploadToken = null;
      file.multipartUploadId = null;
      await this.fileRepository.save(file);
      throw new BadRequestException({ code, message, details });
    };
    if (actualSize > MAX_EXPECTED_SIZE) {
      await rejectAndCleanup(
        'FILE_TOO_LARGE',
        `업로드 파일이 ${Math.round(MAX_EXPECTED_SIZE / 1024 / 1024)}MB 상한을 초과합니다.`,
        { size: actualSize },
      );
    }
    // 선언값(expectedSize)과 실제 업로드 크기 대조 — 잘림/위변조 검출(허용오차 없음, 동일 바이트 기대).
    if (file.expectedSize != null) {
      const declared = Number(file.expectedSize);
      if (Number.isFinite(declared) && declared > 0 && declared !== actualSize) {
        await rejectAndCleanup(
          'SIZE_MISMATCH',
          '업로드 크기가 선언값과 다릅니다. 다시 업로드해주세요.',
          { declared, actual: actualSize },
        );
      }
    }
    file.fileSize = actualSize;
    file.status = 'ready';
    file.multipartUploadId = null;
    file.uploadToken = null; // ready 확정 시 소유 토큰 소거(이후 재사용 불가)
    // ── pending TTL 해제 → 영구 or retention 재설정 ──
    // null/undefined/0 → 영구(null). >0 → now + N일. (site.entity 규약: null/0=영구)
    file.expiresAt =
      retentionDays && retentionDays > 0
        ? new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000)
        : null;
    return this.fileRepository.save(file);
  }
}
