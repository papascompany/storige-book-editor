/**
 * duplex-split 잡 request_id 길이 고정 (2026-10-18).
 *
 * worker_jobs.request_id 는 VARCHAR(36)(worker-job.entity.ts). 종전 86자 키는
 * "Data too long for column 'request_id'" 로 잡 생성이 조용히 실패했다 — 회귀 방지.
 */
import 'reflect-metadata';
import { getMetadataArgsStorage } from 'typeorm';
import { WorkerJob } from '../worker-jobs/entities/worker-job.entity';
import { DUPLEX_SPLIT_AUTO_REQUEST_ID, duplexSplitRevisionRequestId } from './edit-sessions.service';

function requestIdColumnLength(): number {
  const col = getMetadataArgsStorage().columns.find(
    (c) => c.target === WorkerJob && c.propertyName === 'requestId',
  );
  expect(col).toBeDefined();
  const len = Number(col!.options.length);
  expect(Number.isFinite(len)).toBe(true);
  return len;
}

describe('duplex-split request_id ≤ worker_jobs.request_id VARCHAR 길이', () => {
  it('엔티티 컬럼 길이는 36', () => {
    expect(requestIdColumnLength()).toBe(36);
  });

  it('DUPLEX_SPLIT_AUTO_REQUEST_ID(편집 완료 자동 잡)', () => {
    expect(DUPLEX_SPLIT_AUTO_REQUEST_ID).toBe('duplex-split');
    expect(DUPLEX_SPLIT_AUTO_REQUEST_ID.length).toBeLessThanOrEqual(requestIdColumnLength());
  });

  it.each([1, 9999, 999999999])('duplexSplitRevisionRequestId(%d)', (rev) => {
    const id = duplexSplitRevisionRequestId(rev);
    expect(id).toBe(`duplex-split-r${rev}`);
    expect(id.length).toBeLessThanOrEqual(requestIdColumnLength());
  });
});
