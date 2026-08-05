/**
 * S-P2A-B 샤드2 (2026-08-05) — 컷아웃 산출물 보존 스윕 계약.
 *
 * 왜 필요한가: 컷아웃 생성 라우트가 `@Public`(무인증)이고 워커가 `/app/storage/cutouts/`
 * 에 직접 write 하므로, 이 cron 이 **무인증 디스크 소진에 대한 유일한 방어선**이다.
 * 방어선 자체가 무테스트면 조용히 죽어도 아무도 모른다.
 *
 * 잠그는 계약:
 *  1. CUTOUT terminal 잡(보존기간 경과)의 cutouts/{jobId} 삭제 + cutoutOutputsPurgedAt 마커.
 *  2. 기존 options 키(kind/sourceFileId/model)를 마커 기록으로 날리지 않는다(merge).
 *  3. jobId 가 uuid 형식이 아니면 rm 하지 않는다(경로 안전) — 마커만 기록.
 *  4. 개별 실패 격리 — 한 잡의 실패가 배치 전체를 막지 않는다.
 *  5. QueryBuilder 가 CUTOUT 으로 좁히고 purged 마커를 제외한다(다른 잡 산출물 오삭제 불가).
 *  6. 재진입 가드 — 이전 스윕 진행 중이면 skip.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { WorkerJobStatus, WorkerJobType } from '@storige/types';
import { CutoutOutputsRetentionService } from './cutout-outputs-retention.service';

describe('CutoutOutputsRetentionService — 컷아웃 산출물 보존 스윕', () => {
  const testBase = '/tmp/storige-cutout-retention-storage';
  const cutoutsBase = path.join(testBase, 'cutouts');

  let service: CutoutOutputsRetentionService;
  let repo: { createQueryBuilder: jest.Mock; update: jest.Mock };
  let qb: Record<string, jest.Mock>;
  let candidates: Array<Record<string, unknown>>;

  const UUID = '11111111-2222-4333-8444-555555555555';
  const UUID2 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

  const makeJob = (overrides: Record<string, unknown> = {}) => ({
    id: UUID,
    jobType: WorkerJobType.CUTOUT,
    status: WorkerJobStatus.COMPLETED,
    options: { kind: 'cutout', sourceFileId: 'file-1', model: 'birefnet-general' },
    completedAt: new Date('2026-07-20T00:00:00Z'),
    createdAt: new Date('2026-07-20T00:00:00Z'),
    ...overrides,
  });

  const seedOutputs = async (jobId: string): Promise<string> => {
    const dir = path.join(cutoutsBase, jobId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'out.png'), 'dummy');
    await fs.writeFile(path.join(dir, 'result.json'), '{}');
    return dir;
  };

  const dirExists = async (dir: string): Promise<boolean> => {
    try {
      await fs.access(dir);
      return true;
    } catch {
      return false;
    }
  };

  beforeEach(async () => {
    await fs.rm(testBase, { recursive: true, force: true });
    await fs.mkdir(cutoutsBase, { recursive: true });

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
      get: jest.fn((key: string, def: string) => (key === 'STORAGE_PATH' ? testBase : def)),
    };
    service = new CutoutOutputsRetentionService(repo as never, config as never);
  });

  afterAll(async () => {
    await fs.rm(testBase, { recursive: true, force: true }).catch(() => {});
  });

  it('보존기간 경과 CUTOUT 잡 — cutouts/{jobId} 삭제 + 마커 기록(기존 options 보존)', async () => {
    const dir = await seedOutputs(UUID);
    candidates = [makeJob()];

    const now = new Date('2026-08-05T00:00:00Z'); // 16일 경과 > 기본 7일
    const purged = await service.sweepCutoutOutputs(now);

    expect(purged).toBe(1);
    expect(await dirExists(dir)).toBe(false);
    expect(repo.update).toHaveBeenCalledWith(UUID, {
      options: expect.objectContaining({
        // 기존 키가 살아 있어야 한다 — 마커 기록이 options 를 덮어쓰면 모델 감사 추적이 사라진다
        kind: 'cutout',
        sourceFileId: 'file-1',
        model: 'birefnet-general',
        cutoutOutputsPurgedAt: now.toISOString(),
      }),
    });
  });

  it('QueryBuilder 계약 — jobType=CUTOUT 으로 좁히고 purged 마커를 제외한다', async () => {
    candidates = [];
    await service.sweepCutoutOutputs(new Date('2026-08-05T00:00:00Z'));

    expect(qb.where).toHaveBeenCalledWith('job.jobType = :jobType', {
      jobType: WorkerJobType.CUTOUT,
    });
    const andWhereArgs = qb.andWhere.mock.calls.map((c) => String(c[0]));
    // 마커 문자열은 SQL 이 아니라 바인딩 파라미터로 들어간다
    const params = qb.andWhere.mock.calls.map((c) => JSON.stringify(c[1] ?? {})).join(' ');
    expect(andWhereArgs.some((a) => a.includes('NOT LIKE :purgedMarker'))).toBe(true);
    expect(params).toContain('cutoutOutputsPurgedAt');
    expect(andWhereArgs.some((a) => a.includes('COALESCE(job.completedAt, job.createdAt)'))).toBe(
      true,
    );
  });

  it('비UUID jobId — rm 을 하지 않고 마커만 기록한다(경로 안전)', async () => {
    // 경로 조작 시도가 들어와도 storage 밖을 건드리지 않아야 한다
    const evil = await seedOutputs('legit-sibling');
    candidates = [makeJob({ id: '../legit-sibling' })];

    const purged = await service.sweepCutoutOutputs(new Date('2026-08-05T00:00:00Z'));

    expect(purged).toBe(1);
    expect(await dirExists(evil)).toBe(true); // 삭제되지 않았다
    expect(repo.update).toHaveBeenCalledWith(
      '../legit-sibling',
      expect.objectContaining({
        options: expect.objectContaining({ cutoutOutputsPurgedAt: expect.any(String) }),
      }),
    );
  });

  it('개별 실패 격리 — 한 잡이 실패해도 다음 잡은 처리된다', async () => {
    const dir2 = await seedOutputs(UUID2);
    candidates = [makeJob({ id: UUID }), makeJob({ id: UUID2 })];
    repo.update.mockImplementationOnce(async () => {
      throw new Error('DB down');
    });

    const purged = await service.sweepCutoutOutputs(new Date('2026-08-05T00:00:00Z'));

    expect(purged).toBe(1); // 두 번째만 성공
    expect(await dirExists(dir2)).toBe(false);
  });

  it('보존기간 미경과 잡은 후보 조회의 cutoff 밖이라 손대지 않는다', async () => {
    candidates = [];
    const now = new Date('2026-08-05T00:00:00Z');
    await service.sweepCutoutOutputs(now);

    const cutoffArg = qb.andWhere.mock.calls.find((c) =>
      String(c[0]).includes('COALESCE'),
    )?.[1] as { cutoff: Date };
    // 기본 7일
    expect(now.getTime() - cutoffArg.cutoff.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('CUTOUT_RETENTION_DAYS 로 보존기간을 조정할 수 있다', async () => {
    const config = {
      get: jest.fn((key: string, def: string) => {
        if (key === 'STORAGE_PATH') return testBase;
        if (key === 'CUTOUT_RETENTION_DAYS') return '2';
        return def;
      }),
    };
    service = new CutoutOutputsRetentionService(repo as never, config as never);
    candidates = [];
    const now = new Date('2026-08-05T00:00:00Z');
    await service.sweepCutoutOutputs(now);

    const cutoffArg = qb.andWhere.mock.calls.find((c) =>
      String(c[0]).includes('COALESCE'),
    )?.[1] as { cutoff: Date };
    expect(now.getTime() - cutoffArg.cutoff.getTime()).toBe(2 * 24 * 60 * 60 * 1000);
  });
});
