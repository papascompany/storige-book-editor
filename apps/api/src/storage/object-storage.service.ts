import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import * as path from 'path';
import type { Readable } from 'stream';
import { StorageConfigService } from '../settings/storage-config.service';

/**
 * 저장 백엔드 식별자. files 테이블 `storage_backend` 컬럼과 1:1.
 * - 'local' : VPS 로컬 파일시스템 (/app/storage 아래). 기존 동작.
 * - 's3'    : S3 호환 객체스토리지 (Cloudflare R2 권장 — egress 무료).
 */
export type StorageBackend = 'local' | 's3';

/**
 * ObjectStorageService — 앱-프록시 파일 경로(업로드/다운로드 by fileId)의 저장 추상화.
 *
 * 설계 경계 (2026-06-13):
 *   - **앱-프록시 경로만** 사용: FilesService.uploadFile / getFileBuffer / hardDelete.
 *   - nginx 직접서빙 `/storage/*`(라이브러리/썸네일/워커 outputs)는 불변(Phase 2).
 *   - 워커는 로컬 파일 필수(GS/pdf-lib) → 워커 산출물 경로 불변.
 *
 * 설정(드라이버 local|s3 + R2 키)은 **StorageConfigService 가 DB(admin) → env 순으로 제공**.
 * admin 토글/키입력 후 재배포 없이 **즉시 반영**(짧은 캐시 + invalidate). s3 클라이언트는
 * config 시그니처가 바뀌면 재생성(예: admin 이 R2 켜거나 버킷 변경).
 *
 * key 규약: local=STORAGE_PATH 상대경로, s3=버킷 object key (동일 값).
 */
@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly storagePath: string;

  // s3 클라이언트 — config 시그니처별 캐시(변경 시 재생성)
  private s3Client: import('@aws-sdk/client-s3').S3Client | null = null;
  private s3Sig = '';
  private s3Bucket = '';

  constructor(
    private readonly config: ConfigService,
    private readonly storageConfig: StorageConfigService,
  ) {
    const configured = this.config.get<string>('STORAGE_PATH', './storage');
    this.storagePath = path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
  }

  /** 현재 active 쓰기 백엔드(비동기 — DB 설정 반영). */
  async getActiveBackend(): Promise<StorageBackend> {
    return (await this.storageConfig.getEffectiveConfig()).driver;
  }

  /**
   * config 기반으로 s3 클라이언트 확보(시그니처 변경 시 재생성).
   * presigned 서비스가 동일 S3Client/버킷을 재사용하도록 public 승격(2026-06-19).
   */
  async ensureS3(): Promise<{ client: import('@aws-sdk/client-s3').S3Client; bucket: string }> {
    const cfg = await this.storageConfig.getEffectiveConfig();
    const { s3 } = cfg;
    if (!s3.bucket || !s3.accessKeyId || !s3.secretAccessKey) {
      throw new Error('s3 설정 누락: bucket / accessKeyId / secretAccessKey (admin 저장소 설정 확인)');
    }
    if (this.s3Client && this.s3Sig === cfg.s3Signature) {
      return { client: this.s3Client, bucket: this.s3Bucket };
    }
    const { S3Client } = await import('@aws-sdk/client-s3');
    this.s3Client = new S3Client({
      region: s3.region,
      endpoint: s3.endpoint ?? undefined,
      forcePathStyle: s3.forcePathStyle,
      credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    });
    this.s3Sig = cfg.s3Signature;
    this.s3Bucket = s3.bucket;
    this.logger.log(`S3 client (re)initialized: bucket=${s3.bucket} endpoint=${s3.endpoint ?? 'aws-default'}`);
    return { client: this.s3Client, bucket: this.s3Bucket };
  }

  /** local key → 절대경로 (storage 루트 격리) */
  private localPath(key: string): string {
    const root = path.resolve(this.storagePath);
    const resolved = path.resolve(root, key);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error(`Invalid storage key (path traversal): ${key}`);
    }
    return resolved;
  }

  /** active 드라이버에 객체 저장. 반환값(backend/key)을 호출측이 DB에 기록. */
  async put(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<{ backend: StorageBackend; key: string }> {
    const driver = (await this.storageConfig.getEffectiveConfig()).driver;
    if (driver === 's3') {
      const { client, bucket } = await this.ensureS3();
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
      return { backend: 's3', key };
    }
    const abs = this.localPath(key);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body);
    return { backend: 'local', key };
  }

  /** 파일별 backend 로 객체 읽기 (혼재 보장). */
  async get(backend: StorageBackend, key: string): Promise<Buffer> {
    if (backend === 's3') {
      const { client, bucket } = await this.ensureS3();
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const bodyAny = res.Body as unknown as {
        transformToByteArray?: () => Promise<Uint8Array>;
      };
      if (bodyAny.transformToByteArray) {
        return Buffer.from(await bodyAny.transformToByteArray());
      }
      const chunks: Buffer[] = [];
      for await (const chunk of res.Body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    }
    return fs.readFile(this.localPath(key));
  }

  /**
   * 파일별 backend 로 객체를 **스트림**으로 읽기 (다운로드/인라인 서빙용).
   * `get():Buffer` 와 달리 파일을 JS heap 에 통째로 올리지 않는다 → 2GB 다운로드에도
   * API heap 상수(~64KB 청크). 트랙 B-(c) 의 핵심.
   *  - s3: `GetObjectCommand` 의 `Body`(Node 런타임에서 Readable) 를 그대로 반환(Buffer.concat 금지).
   *  - local: `fs.createReadStream`(경로 traversal 격리는 localPath 가 담당).
   * ⚠️ s3 의 NoSuchKey 등은 여기서 await 중 throw(헤더 전송 전) → 호출측이 404 로 변환.
   *    local 의 ENOENT 는 스트림 'error' 이벤트(비동기) → 호출측이 stream.on('error') 로 처리.
   */
  async getStream(backend: StorageBackend, key: string): Promise<Readable> {
    if (backend === 's3') {
      const { client, bucket } = await this.ensureS3();
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!res.Body) {
        throw new Error(`S3 GetObject 가 빈 Body 를 반환했습니다: ${key}`);
      }
      // Node 런타임에서 Body 는 Readable(IncomingMessage). 브라우저 ReadableStream 아님.
      return res.Body as Readable;
    }
    return createReadStream(this.localPath(key));
  }

  /** 파일별 backend 로 객체 삭제 (보존정책/테넌트 삭제용). 멱등 — 없으면 무시. */
  async delete(backend: StorageBackend, key: string): Promise<void> {
    try {
      if (backend === 's3') {
        const { client, bucket } = await this.ensureS3();
        const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        return;
      }
      await fs.unlink(this.localPath(key));
    } catch (err) {
      this.logger.warn(`delete(${backend}, ${key}) 실패(무시): ${(err as Error).message}`);
    }
  }
}
