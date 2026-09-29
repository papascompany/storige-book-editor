/**
 * 관리자 편집 직전 스냅샷(staff-baseline, 2026-09-29) + 트림 보호.
 *  - pinStaffBaseline: 'staff-baseline' 1행, 같은 내용이면 중복 없음, canvasData 없으면 no-op, 오류 전달
 *  - trimVersions: 가장 오래된 staff-baseline 1건 + 최근 2건 보호, 기존 shrink 보호 불변
 * 버전 저장소는 메모리 구현(생성 시각 단조 증가).
 */
import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EditSessionsService } from './edit-sessions.service';
import { EditSessionEntity, SessionStatus } from './entities/edit-session.entity';
import {
  EditSessionVersionEntity,
  EditSessionVersionReason,
} from './entities/edit-session-version.entity';
import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import { TemplateSetsService } from '../templates/template-sets.service';

const SID = '11111111-1111-4111-8111-111111111111';

interface Row {
  id: string;
  reason: EditSessionVersionReason;
  canvasData: unknown;
  createdAt: Date;
  createdBy: number | null;
}

/** HEAD(변경 전) trimVersions 알고리즘 — baseline 이 없을 때 결과가 같아야 한다 */
function legacyKeep(all: Row[]): Set<string> {
  const sorted = [...all].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (sorted.length <= EditSessionsService.VERSION_KEEP) return new Set(sorted.map((r) => r.id));
  let shrinkSeen = 0;
  const protectedIds = new Set<string>();
  for (const v of sorted) {
    if (v.reason === 'shrink' && shrinkSeen < EditSessionsService.SHRINK_KEEP) {
      protectedIds.add(v.id);
      shrinkSeen++;
    }
  }
  const keep = new Set<string>();
  let kept = 0;
  for (const v of sorted) {
    if (protectedIds.has(v.id)) { kept++; keep.add(v.id); continue; }
    if (kept < EditSessionsService.VERSION_KEEP) { kept++; keep.add(v.id); continue; }
  }
  return keep;
}

describe('staff-baseline 스냅샷 · 트림 보호', () => {
  let service: EditSessionsService;
  let rows: Row[];
  let clock: number;
  let seq: number;
  let current: { canvasData: unknown; status: SessionStatus } | null;

  const sessionRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
    manager: { createQueryBuilder: jest.fn(), query: jest.fn() },
  };
  const versionRepo = {
    find: jest.fn(async () =>
      [...rows]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((r) => ({ id: r.id, reason: r.reason, createdAt: r.createdAt })),
    ),
    findOne: jest.fn(async (opts: { where: { reason?: string } }) => {
      const list = [...rows]
        .filter((r) => (opts.where.reason ? r.reason === opts.where.reason : true))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return list[0] ?? null;
    }),
    create: jest.fn((v: Record<string, unknown>) => ({ ...v })),
    save: jest.fn(async (v: Record<string, unknown>) => {
      clock += 1000;
      seq += 1;
      const row: Row = {
        id: `v${String(seq).padStart(3, '0')}`,
        reason: v.reason as EditSessionVersionReason,
        canvasData: v.canvasData,
        createdAt: new Date(clock),
        createdBy: (v.createdBy as number | null) ?? null,
      };
      rows.push(row);
      return row;
    }),
    delete: jest.fn(async (ids: string[]) => {
      rows = rows.filter((r) => !ids.includes(r.id));
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    rows = [];
    clock = Date.UTC(2026, 8, 29);
    seq = 0;
    current = { canvasData: [{ p: 0 }], status: SessionStatus.EDITING };
    sessionRepo.findOne.mockImplementation(async () => (current ? { id: SID, ...current } : null));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EditSessionsService,
        { provide: getRepositoryToken(EditSessionEntity), useValue: sessionRepo },
        { provide: getRepositoryToken(EditSessionVersionEntity), useValue: versionRepo },
        { provide: WorkerJobsService, useValue: {} },
        { provide: TemplateSetsService, useValue: {} },
      ],
    }).compile();
    service = module.get(EditSessionsService);
  });

  const pin = async (content: number): Promise<void> => {
    current = { canvasData: [{ p: content }], status: SessionStatus.EDITING };
    await service.pinStaffBaseline(SID);
  };

  /** 통상 autosave 스냅샷 1건(디바운스 우회를 위해 세션마다 lastVersionAt 초기화) */
  const autosave = async (n: number): Promise<void> => {
    (service as unknown as { lastVersionAt: Map<string, number> }).lastVersionAt.clear();
    await service.snapshotBeforeOverwrite(
      { id: SID, canvasData: [{ a: n }], status: SessionStatus.EDITING } as unknown as EditSessionEntity,
      [{ a: n + 0.5 }],
      777,
    );
  };

  it("pin → reason 'staff-baseline', createdBy null, 현재 canvasData 보존", async () => {
    await pin(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: 'staff-baseline', createdBy: null, canvasData: [{ p: 1 }] });
    expect(sessionRepo.findOne).toHaveBeenCalledWith({ where: { id: SID }, select: ['id', 'canvasData', 'status'] });
  });

  it('최근 staff-baseline 과 내용이 같으면 중복 저장하지 않는다, 바뀌면 새로 저장', async () => {
    await pin(1);
    await pin(1);
    expect(rows).toHaveLength(1);
    await pin(2);
    expect(rows).toHaveLength(2);
  });

  it('canvasData 없음·세션 없음 → no-op', async () => {
    current = { canvasData: null, status: SessionStatus.DRAFT };
    await expect(service.pinStaffBaseline(SID)).resolves.toBeNull();
    current = null;
    await expect(service.pinStaffBaseline(SID)).resolves.toBeNull();
    expect(versionRepo.save).not.toHaveBeenCalled();
  });

  it('저장 오류는 호출부로 전달(발급 중단은 호출부 책임)', async () => {
    versionRepo.save.mockRejectedValueOnce(new Error('db down'));
    await expect(service.pinStaffBaseline(SID)).rejects.toThrow('db down');
  });

  it('autosave 15건 이후에도 가장 오래된 baseline + 최근 baseline 2건이 남는다', async () => {
    await pin(1); // 가장 오래된
    for (let i = 0; i < 5; i++) await autosave(i);
    await pin(2); // 보호 밖(오래된 쪽도 최근 2건도 아님)
    for (let i = 5; i < 10; i++) await autosave(i);
    await pin(3); // 최근 2건
    for (let i = 10; i < 12; i++) await autosave(i);
    await pin(4); // 최근 2건
    for (let i = 12; i < 27; i++) await autosave(i);

    const baselines = rows.filter((r) => r.reason === 'staff-baseline').map((r) => (r.canvasData as Array<{ p: number }>)[0].p);
    expect(baselines.sort()).toEqual([1, 3, 4]);
    // 통상 스냅샷은 여전히 VERSION_KEEP 한도 안에서 유지된다
    const autosaves = rows.filter((r) => r.reason === 'autosave');
    expect(autosaves.length).toBeLessThanOrEqual(EditSessionsService.VERSION_KEEP);
    expect(autosaves.length).toBeGreaterThan(0);
  });

  it('회귀: baseline 이 없으면 트림 결과가 종전 알고리즘과 같다(shrink 최근 5건 보호 포함)', async () => {
    const reasons: EditSessionVersionReason[] = [];
    for (let i = 0; i < 24; i++) reasons.push(i % 3 === 0 ? 'shrink' : 'autosave');
    for (const r of reasons) {
      clock += 1000;
      seq += 1;
      rows.push({ id: `p${String(seq).padStart(3, '0')}`, reason: r, canvasData: [{}], createdAt: new Date(clock), createdBy: 1 });
    }
    const expected = legacyKeep(rows);
    await (service as unknown as { trimVersions(id: string): Promise<void> }).trimVersions(SID);
    expect(new Set(rows.map((r) => r.id))).toEqual(expected);
    const shrinkLeft = rows.filter((r) => r.reason === 'shrink');
    expect(shrinkLeft.length).toBeGreaterThanOrEqual(EditSessionsService.SHRINK_KEEP);
  });
});
