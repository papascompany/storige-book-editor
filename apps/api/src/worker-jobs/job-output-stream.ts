import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { WorkerJobStatus } from '@storige/types';
import { resolveStoragePath } from '../common/helpers/storage-path.helper';
import type { WorkerJob } from './entities/worker-job.entity';

/**
 * 워커 잡 결과 파일(PDF) 스트리밍 — GET /worker-jobs/:id/output 본문에서 추출(2026-09-29).
 * GET /admin/edit-data/jobs/:jobId/output 도 같은 헬퍼를 쓴다. 잡 조회·범위 판정은 호출부 책임.
 *
 * 오류 코드(종전과 동일): JOB_NOT_COMPLETED(400) · OUTPUT_NOT_FOUND(404) · INVALID_PATH(400) ·
 * FILE_NOT_ON_DISK(404) · 스트리밍 중 ENOENT → 404 FILE_NOT_ON_DISK / 그 외 → 500 STREAM_ERROR.
 */
export function streamJobOutput(
  job: Pick<WorkerJob, 'status' | 'result'>,
  res: Response,
  logger: Logger,
): void {
  if (job.status !== WorkerJobStatus.COMPLETED && job.status !== WorkerJobStatus.FIXABLE) {
    throw new BadRequestException({
      code: 'JOB_NOT_COMPLETED',
      message: `Job status is ${job.status}, output not available`,
    });
  }

  // result에서 outputFileUrl 추출 — convert 잡: result.outputFileUrl, synthesize: result.outputFileUrl
  const result = job.result as
    | { outputFileUrl?: string; result?: { outputFileUrl?: string } }
    | null
    | undefined;
  const outputFileUrl: string | undefined =
    result?.outputFileUrl || result?.result?.outputFileUrl;

  if (!outputFileUrl) {
    throw new NotFoundException({
      code: 'OUTPUT_NOT_FOUND',
      message: 'No output file URL in job result',
    });
  }

  // outputFileUrl 형식: '/storage/temp/converted_xxx.pdf' 또는 'storage/...'
  // 해석+경계 가드는 공유 헬퍼로 — 종전 인라인 startsWith(base) 검사는 형제 접두사
  // (/app/storage-evil)를 통과시키는 결함이 있었다(감사 §8 ⑦, files.service 와 동일 로직 통합).
  const storageBase = process.env.STORAGE_PATH || '/app/storage';
  const resolvedPath = resolveStoragePath(outputFileUrl, storageBase);
  if (!resolvedPath) {
    throw new BadRequestException({
      code: 'INVALID_PATH',
      message: 'Output path is outside storage root',
    });
  }

  // 파일 존재 확인
  if (!fs.existsSync(resolvedPath)) {
    throw new NotFoundException({
      code: 'FILE_NOT_ON_DISK',
      message: `Output file not found on disk: ${outputFileUrl}`,
    });
  }

  const filename = path.basename(resolvedPath);
  const stat = fs.statSync(resolvedPath);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(filename)}"`,
  );
  res.setHeader('Content-Length', stat.size);

  // 스트림 가드 — files.controller/books.controller 의 기존 패턴과 동일.
  // ① close: 클라이언트 중단 시 fd 누수 방지 ② error: existsSync 통과 후 open/read 사이에
  // 파일이 지워지면(보존정책 sweep 등) unhandled 'error' 로 응답이 매달린다 — 헤더 전송 전이면
  // JSON 에러, 전송 중이면 소켓을 끊어 불완전 다운로드가 완결로 오인되지 않게 한다.
  // 라벨은 err.code 로 분기한다 — ENOENT(삭제 레이스)만 404 로, EACCES/EIO 같은 I/O 장애를
  // '파일이 사라졌다'로 오분류하면 운영 진단이 은폐된다(적대 리뷰 지적, files.controller 는 500).
  const stream = fs.createReadStream(resolvedPath);
  res.on('close', () => stream.destroy());
  stream.on('error', (err: NodeJS.ErrnoException) => {
    logger.error(`downloadOutput stream error (${err.code ?? 'unknown'}): ${err.message}`);
    if (!res.headersSent) {
      // 스트리밍용으로 걸어둔 헤더를 정리한다 — Express res.json() 은 기설정 Content-Type 을
      // 덮지 않아, 정리 없이는 에러 JSON 이 application/pdf + attachment(+옛 Content-Length)로
      // 나가 다운로더가 에러 본문을 .pdf 로 저장한다(적대 리뷰 실증, 3라우트 공통 일괄 수정).
      res.removeHeader('Content-Type');
      res.removeHeader('Content-Disposition');
      res.removeHeader('Content-Length');
      if (err.code === 'ENOENT') {
        res.status(404).json({
          code: 'FILE_NOT_ON_DISK',
          message: `Output file disappeared during read: ${outputFileUrl}`,
        });
      } else {
        res.status(500).json({
          code: 'STREAM_ERROR',
          message: '파일 스트리밍 중 오류가 발생했습니다.',
        });
      }
    } else {
      res.destroy(err);
    }
  });
  stream.pipe(res);
}
