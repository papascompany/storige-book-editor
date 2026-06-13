/**
 * migrate-files-to-r2.ts — 기존 local 파일을 R2(객체스토리지)로 이전 (2026-06-13).
 *
 * 대상: files 테이블에서 storage_backend='local' 인 레코드 중, 앱-프록시 다운로드로만
 * 접근하는 업로드 PDF (file_url LIKE '/storage/uploads/%').
 *   → /storage/* nginx 직접서빙 자산(라이브러리/썸네일/워커 outputs)은 **제외**(Phase 2).
 *
 * 동작: 각 파일을 디스크에서 읽어 R2 put → storage_backend='s3', storage_key 갱신, file_path 마커.
 * 검증 후 원본 디스크 파일은 **삭제하지 않음**(안전 — 별도 확인 후 수동/후속 정리).
 *
 * 실행 (VPS, api 컨테이너 또는 호스트에서):
 *   STORAGE_DRIVER=s3 S3_BUCKET=... S3_ENDPOINT=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
 *   STORAGE_PATH=/app/storage DATABASE_URL=... \
 *   DRY_RUN=1 npx ts-node apps/api/scripts/migrate-files-to-r2.ts   # 먼저 dry-run
 *   (확인 후 DRY_RUN 제거하여 실제 이전)
 *
 * 멱등: 이미 s3 인 레코드는 스킵. 실패 건은 로그만 남기고 계속(다음 실행에서 재시도).
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as fs from 'fs/promises';
import * as path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const DRY_RUN = process.env.DRY_RUN === '1';
const STORAGE_PATH = process.env.STORAGE_PATH || '/app/storage';

async function main() {
  const bucket = required('S3_BUCKET');
  const s3 = new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    credentials: {
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
  });

  const ds = new DataSource({
    type: 'mariadb',
    url: process.env.DATABASE_URL,
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 3306),
    username: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    synchronize: false,
  });
  await ds.initialize();

  const rows: Array<{ id: string; file_path: string; file_name: string; mime_type: string }> =
    await ds.query(
      `SELECT id, file_path, file_name, mime_type FROM files
       WHERE storage_backend = 'local' AND file_url LIKE '/storage/uploads/%'
       AND deleted_at IS NULL`,
    );

  console.log(`[migrate] 대상 ${rows.length}건 (dryRun=${DRY_RUN})`);
  let ok = 0, skip = 0, fail = 0;

  for (const r of rows) {
    const key = `uploads/${r.file_name}`;
    try {
      const abs = path.isAbsolute(r.file_path)
        ? r.file_path
        : path.join(STORAGE_PATH, r.file_path.replace(/^\/storage\//, '').replace(/^storage\//, ''));
      const buf = await fs.readFile(abs).catch(() => null);
      if (!buf) { console.warn(`[skip] 디스크 없음 ${r.id} ${abs}`); skip++; continue; }

      if (DRY_RUN) { console.log(`[dry] ${r.id} → s3:${key} (${buf.length}b)`); ok++; continue; }

      await s3.send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: buf, ContentType: r.mime_type || 'application/pdf',
      }));
      await ds.query(
        `UPDATE files SET storage_backend='s3', storage_key=?, file_path=? WHERE id=?`,
        [key, `s3://${key}`, r.id],
      );
      ok++;
      if (ok % 50 === 0) console.log(`[migrate] 진행 ${ok}/${rows.length}`);
    } catch (e) {
      fail++;
      console.error(`[fail] ${r.id}: ${(e as Error).message}`);
    }
  }
  console.log(`[migrate] 완료 — 이전 ${ok} / 스킵 ${skip} / 실패 ${fail}`);
  console.log(`[migrate] ⚠️ 원본 디스크 파일은 보존됨. 다운로드 검증 후 별도 정리할 것.`);
  await ds.destroy();
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`env ${name} 필요`);
  return v;
}

main().catch((e) => { console.error(e); process.exit(1); });
