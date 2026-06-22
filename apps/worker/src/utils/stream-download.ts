/**
 * 스트리밍 다운로드 → 임시파일 (트랙 B-(d) — 2GB 상수메모리 검증 ON 경로 전용)
 *
 * 기존 downloadFile(pdf-validator.service.ts) / downloadViaApi(api-file-download.ts)는
 * responseType:'arraybuffer' 로 파일 전체를 메모리(Uint8Array)에 올린다 → 2GB OOM.
 * 이 유틸은 응답/원본을 **스트림으로 디스크 임시파일에 흘려** 메모리를 상수로 유지하고,
 * 이후 검증(qpdf 메타·스트리밍 스캔·GS inkcov)이 그 '파일 경로'를 입력으로 쓰게 한다.
 *
 * 기존 OFF 경로(전체버퍼)는 일절 수정하지 않으며, 이 파일은 신규 ON 경로 전용.
 */
import axios from 'axios';
import { createWriteStream } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';
import { Logger } from '@nestjs/common';
import { assertSafeDownloadUrl } from './url-safety';

const logger = new Logger('StreamDownload');

/** 대용량(최대 2GB) 스트리밍 다운로드 타임아웃(ms). 디스크로 흘리므로 넉넉히. */
const DOWNLOAD_TIMEOUT_MS = Number(process.env.WORKER_DOWNLOAD_TIMEOUT_MS || 600000);

export interface DownloadedFile {
  /** 읽기 가능한 로컬 파일 경로. */
  path: string;
  /** 파일 크기(bytes). */
  size: number;
  /** 임시파일이면 삭제, 로컬 원본이면 no-op. 호출측은 항상 finally 에서 호출한다. */
  cleanup: () => Promise<void>;
}

/** 로컬 경로 해석 — pdf-validator.resolveLocalPath 와 동일 규약(파리티). */
function resolveLocalPath(url: string): string {
  const storageBase = process.env.WORKER_STORAGE_PATH || '../api';
  if (url.startsWith('/storage/')) return `${storageBase}${url}`;
  if (url.startsWith('storage/')) return `${storageBase}/${url}`;
  return url;
}

/** 스트림을 임시파일로 흘려 쓴 뒤 {path,size,cleanup} 반환. */
async function streamToTemp(getStream: () => Promise<Readable>): Promise<DownloadedFile> {
  const tmp = path.join(
    os.tmpdir(),
    `dlstream_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`,
  );
  try {
    const src = await getStream();
    await pipeline(src, createWriteStream(tmp));
    const stat = await fs.stat(tmp); // try 안에서 — stat 실패해도 아래 catch 가 임시파일 정리
    return {
      path: tmp,
      size: stat.size,
      cleanup: async () => {
        await fs.unlink(tmp).catch(() => {});
      },
    };
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * fileUrl 을 디스크의 (읽기 가능한) 로컬 경로로 확보한다.
 *  - `api://<fileId>` : API 다운로드 엔드포인트를 스트림으로 받아 임시파일에 기록(WORKER_API_KEY).
 *  - 로컬 경로(`/…`,`./…`,`storage/…`) : 복사 없이 원본 경로 그대로 사용(cleanup no-op).
 *  - 그 외 URL : 스트림으로 받아 임시파일에 기록.
 */
export async function downloadToTempFile(url: string): Promise<DownloadedFile> {
  if (url.startsWith('api://')) {
    const fileId = url.slice('api://'.length);
    const apiBase = process.env.API_BASE_URL || 'http://localhost:4000/api';
    logger.log(`Streaming s3-backed file via API to temp: ${fileId}`);
    return streamToTemp(async () => {
      const res = await axios.get(
        `${apiBase}/files/${encodeURIComponent(fileId)}/download/external`,
        {
          responseType: 'stream',
          timeout: DOWNLOAD_TIMEOUT_MS,
          headers: { 'X-API-Key': process.env.WORKER_API_KEY || '' },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        },
      );
      return res.data as Readable;
    });
  }

  if (url.startsWith('/') || url.startsWith('./') || url.startsWith('storage/')) {
    const filePath = resolveLocalPath(url);
    const stat = await fs.stat(filePath); // 존재/크기 확인(없으면 throw → 상위 손상처리)
    return { path: filePath, size: stat.size, cleanup: async () => {} };
  }

  // SSRF 방어(P0-1): 임의 외부 URL 페치 전 스킴/사설IP 검증. api://·로컬 분기는 위에서
  // 이미 분기 처리돼 여기 도달하지 않음 → 정당 내부 흐름 무영향. 리다이렉트 우회 차단(maxRedirects:0).
  await assertSafeDownloadUrl(url);
  logger.log(`Streaming from URL to temp: ${url}`);
  return streamToTemp(async () => {
    const res = await axios.get(url, {
      responseType: 'stream',
      timeout: DOWNLOAD_TIMEOUT_MS,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      maxRedirects: 0,
    });
    return res.data as Readable;
  });
}
