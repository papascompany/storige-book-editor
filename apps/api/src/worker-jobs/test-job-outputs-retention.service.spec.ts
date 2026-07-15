/**
 * S2-5 (2026-07-16) — test env 잡 산출물 24h retention 스윕 계약.
 *
 * 잠그는 계약:
 *  1. options.isTest===true 인 SYNTHESIZE terminal 잡(24h 경과)의 outputs/{jobId}
 *     디렉토리 삭제 + options.testOutputsPurgedAt 마커 기록(재스캔 제외).
 *  2. LIKE 프리필터 오탐 방어 — 코드 재확인(isTest!==true / 이미 purged)은 무접촉.
 *     live 잡은 isTest 키 자체가 없어 구조적으로 선정 불가(오삭제 불가능).
 *  3. jobId 가 uuid 형식이 아니면 rm 을 하지 않는다(경로 안전) — 마커만 기록.
 *  4. 개별 실패 격리 — 한 잡의 실패가 배치 전체를 막지 않는다.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { WorkerJobStatus, WorkerJobType } from '@storige/types';
import { TestJobOutputsRetentionService } from './test-job-outputs-retention.service';

describe('TestJobOutputsRetentionService — S2-5 test 잡 산출물 24h retention', () => {
  const testBase = '/tmp/storige-test-retention-storage';
  const outputsBase = path.join(testBase, 'outputs');

  let service: TestJobOutputsRetentionService;
  let repo: {
    createQueryBuilder: jest.Mock;
    update: jest.Mock;
  };
  let qb: Record<string, jest.Mock>;
  let candidates: any[];

  const UUID = '11111111-2222-4333-8444-555555555555';
  const UUID2 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

  function makeJob(overrides: Record<string, unknown>) {
    return {
      id: UUID,
      jobType: WorkerJobType.SYNTHESIZE,
      status: WorkerJobStatus.COMPLETED,
      options: { isTest: true, outputFormat: 'merged' },
      completedAt: new Date('2026-07-14T00:00:00Z'),
      createdAt: new Date('2026-07-14T00:00:00Z'),
      ...overrides,
    };
  }

  async function seedOutputs(jobId: string): Promise<string> {
    const dir = path.join(outputsBase, jobId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'merged.pdf'), 'dummy');
    await fs.writeFile(path.join(dir, '.synthesis-complete.json'), '{}');
    return dir;
  }

  async function dirExists(dir: string): Promise<boolean> {
    try {
      await fs.access(dir);
      return true;
    } catch {
      return false;
    }
  }

  beforeEach(async () => {
    await fs.rm(testBase, { recursive: true, force: true });
    await fs.mkdir(outputsBase, { recursive: true });

    candidates = [];
    qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => candidates),
    };
    repo = {
      createQueryBuilder: jest.fn(() => qb),
      update: jest.fn(async () => ({})),
    };
    const config = {
      get: jest.fn((key: string, def: string) =>
        key === 'STORAGE_PATH' ? testBase : def,
      ),
    };

    service = new TestJobOutputsRetentionService(repo as any, config as any);
  });

  afterAll(async () => {
    await fs.rm(testBase, { recursive: true, force: true }).catch(() => {});
  });

  it('isTest 잡(24h 경과) — outputs/{jobId} 삭제 + testOutputsPurgedAt 마커 기록', async () => {
    const dir = await seedOutputs(UUID);
    candidates = [makeJob({})];

    const now = new Date('2026-07-16T00:00:00Z');
    const purged = await service.sweepTestJobOutputs(now);

    expect(purged).toBe(1);
    expect(await dirExists(dir)).toBe(false);
    expect(repo.update).toHaveBeenCalledWith(UUID, {
      options: expect.objectContaining({
        isTest: true,
        outputFormat: 'merged', // 기존 옵션 보존(merge)
        testOutputsPurgedAt: now.toISOString(),
      }),
    });
  });

  it('LIKE 오탐 방어 — options.isTest!==true 후보는 무접촉(삭제·마커 없음)', async () => {
    const dir = await seedOutputs(UUID);
    // 예: 중첩 문자열 등으로 LIKE 에 걸렸지만 실제 isTest 아님
    candidates = [makeJob({ options: { note: '"isTest":true snippet' } })];

    const purged = await service.sweepTestJobOutputs();

    expect(purged).toBe(0);
    expect(await dirExists(dir)).toBe(true);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('이미 purge 마커가 있으면 skip(재처리 방지)', async () => {
    candidates = [
      makeJob({
        options: { isTest: true, testOutputsPurgedAt: '2026-07-15T00:00:00Z' },
      }),
    ];

    const purged = await service.sweepTestJobOutputs();

    expect(purged).toBe(0);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('비정형 jobId — rm 하지 않고(경로 안전) 마커만 기록', async () => {
    const evilId = '../../uploads';
    candidates = [makeJob({ id: evilId })];
    const uploadsDir = path.join(testBase, 'uploads');
    await fs.mkdir(uploadsDir, { recursive: true });

    const purged = await service.sweepTestJobOutputs();

    expect(purged).toBe(1); // 마커 기록으로 종결(재선정 안 됨)
    expect(await dirExists(uploadsDir)).toBe(true); // 삭제 안 됨
    expect(repo.update).toHaveBeenCalledWith(
      evilId,
      expect.objectContaining({}),
    );
  });

  it('개별 실패 격리 — 앞 잡 update 실패해도 다음 잡은 처리', async () => {
    const dir1 = await seedOutputs(UUID);
    const dir2 = await seedOutputs(UUID2);
    candidates = [makeJob({ id: UUID }), makeJob({ id: UUID2 })];
    repo.update
      .mockRejectedValueOnce(new Error('DB down'))
      .mockResolvedValueOnce({});

    const purged = await service.sweepTestJobOutputs();

    expect(purged).toBe(1);
    // 1번 잡: rm 은 됐지만 마커 실패 → 다음 사이클 재선정(무해 재시도)
    expect(await dirExists(dir1)).toBe(false);
    expect(await dirExists(dir2)).toBe(false);
  });

  it('후보 0건이면 아무 것도 하지 않는다', async () => {
    candidates = [];
    const purged = await service.sweepTestJobOutputs();
    expect(purged).toBe(0);
    expect(repo.update).not.toHaveBeenCalled();
  });
});
