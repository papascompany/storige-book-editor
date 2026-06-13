import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 저장 백엔드 식별자. files 테이블 `storage_backend` 컬럼과 1:1.
 * - 'local' : VPS 로컬 파일시스템 (/app/storage 아래). 기존 동작.
 * - 's3'    : S3 호환 객체스토리지 (Cloudflare R2 권장 — egress 무료).
 */
export type StorageBackend = 'local' | 's3';

/**
 * ObjectStorageService — 앱-프록시 파일 경로(업로드/다운로드 by fileId)의 저장 추상화.
 *
 * 설계 경계 (2026-06-13, 저장계층 R2 보강):
 *   - **앱-프록시 경로만** 이 서비스를 쓴다: FilesService.uploadFile / getFileBuffer / hardDelete.
 *     (= /files/upload(/external), /files/:id/download(/external) — bookmoa·ShareSnap·100p가 fileId로 접근)
 *   - **nginx 직접 서빙 `/storage/*`** (라이브러리/썸네일/디자인/워커 outputs) 는 **건드리지 않는다**:
 *     외부 300+ 소비처가 URL 형식에 의존 + 웹훅 outputFileUrl에 박혀 있음 → Phase 2(presigned 리다이렉트).
 *   - **워커는 로컬 파일 필수**(GS/pdf-lib) → 워커 산출물 경로 불변.
 *
 * 드라이버는 env `STORAGE_DRIVER`(local|s3, 기본 local)로 선택. 쓰기는 active 드라이버,
 * 읽기/삭제는 파일별 `storage_backend`로 라우팅(혼재 보장 — 기존 local 파일 + 신규 s3 파일 공존).
 *
 * key 규약:
 *   - local: STORAGE_PATH 기준 상대 경로 (예: 'uploads/123_abc.pdf')
 *   - s3   : 버킷 내 object key (동일 값 사용)
 */
@Injectable()
export class ObjectStorageService implements OnModuleInit {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly driver: StorageBackend;
  private readonly storagePath: string;

  // s3 클라이언트는 driver='s3' 일 때만 lazy 초기화 (local 배포에서 SDK 미설치/미설정 무영향)
  private s3Client: import('@aws-sdk/client-s3').S3Client | null = null;
  private s3Bucket = '';

  constructor(private readonly config: ConfigService) {
    this.driver = (this.config.get<string>('STORAGE_DRIVER', 'local') as StorageBackend) || 'local';
    const configured = this.config.get<string>('STORAGE_PATH', './storage');
    this.storagePath = path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
  }

  async onModuleInit(): Promise<void> {
    this.logger.log(`ObjectStorage driver=${this.driver} storagePath=${this.storagePath}`);
    if (this.driver === 's3') {
      await this.initS3();
    }
  }

  /** 현재 active 쓰기 백엔드. uploadFile 이 새 파일의 storage_backend 로 기록. */
  get activeBackend(): StorageBackend {
    return this.driver;
  }

  private async initS3(): Promise<void> {
    const endpoint = this.config.get<string>('S3_ENDPOINT'); // R2: https://<acct>.r2.cloudflarestorage.com
    const region = this.config.get<string>('S3_REGION', 'auto');
    const bucket = this.config.get<string>('S3_BUCKET');
    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('S3_SECRET_ACCESS_KEY');
    const forcePathStyle = this.config.get<string>('S3_FORCE_PATH_STYLE', 'true') !== 'false';

    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'STORAGE_DRIVER=s3 인데 S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY 가 누락되었습니다.',
      );
    }

    // 동적 import — local 배포에서는 @aws-sdk/client-s3 가 로드되지 않음
    const { S3Client } = await import('@aws-sdk/client-s3');
    this.s3Client = new S3Client({
      region,
      endpoint, // R2/MinIO 등 커스텀 엔드포인트 (AWS S3 면 미지정)
      forcePathStyle,
      credentials: { accessKeyId, secretAccessKey },
    });
    this.s3Bucket = bucket;
    this.logger.log(`S3 backend ready: bucket=${bucket} endpoint=${endpoint ?? 'aws-default'}`);
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

  /** active 드라이버에 객체 저장. 반환값으로 backend/key 를 호출측이 DB에 기록. */
  async put(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<{ backend: StorageBackend; key: string }> {
    if (this.driver === 's3') {
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      await this.s3Client!.send(
        new PutObjectCommand({
          Bucket: this.s3Bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
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
      if (!this.s3Client) {
        throw new Error('s3-backed 파일이지만 S3 클라이언트가 초기화되지 않았습니다(STORAGE_DRIVER 확인).');
      }
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const res = await this.s3Client.send(
        new GetObjectCommand({ Bucket: this.s3Bucket, Key: key }),
      );
      const body = res.Body as unknown as {
        transformToByteArray?: () => Promise<Uint8Array>;
        [Symbol.asyncIterator]?: () => AsyncIterator<Buffer>;
      };
      if (body.transformToByteArray) {
        return Buffer.from(await body.transformToByteArray());
      }
      const chunks: Buffer[] = [];
      for await (const chunk of body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    }
    return fs.readFile(this.localPath(key));
  }

  /** 파일별 backend 로 객체 삭제 (보존정책/테넌트 삭제용). 멱등 — 없으면 무시. */
  async delete(backend: StorageBackend, key: string): Promise<void> {
    try {
      if (backend === 's3') {
        if (!this.s3Client) return;
        const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
        await this.s3Client.send(
          new DeleteObjectCommand({ Bucket: this.s3Bucket, Key: key }),
        );
        return;
      }
      await fs.unlink(this.localPath(key));
    } catch (err) {
      this.logger.warn(`delete(${backend}, ${key}) 실패(무시): ${(err as Error).message}`);
    }
  }
}
