import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EditSessionsService } from './edit-sessions.service';
import { EditSessionEntity, SessionStatus } from './entities/edit-session.entity';
import { EditSessionVersionEntity } from './entities/edit-session-version.entity';
import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import { TemplateSetsService } from '../templates/template-sets.service';

/**
 * restore 중복 스냅샷 억제 (2026-08-23).
 *
 * 배경: 클라이언트/프록시 재시도로 같은 (session, version) restore 가 연속 호출되면
 * 매번 reason='restore' 스냅샷이 쌓여 VERSION_KEEP(10) 트림이 오래된 autosave 시점을 밀어낸다.
 *  (1) 현재 상태 == 복원 대상(멱등 재호출) → 스냅샷 생략
 *  (2) 세션의 최신 스냅샷 == 현재 상태(직전 상태가 이미 보존됨) → 스냅샷 생략
 *  (3) 그 외 → 정상 생성 / autosave·shrink 분기는 불변
 */
describe('EditSessionsService restore 중복 스냅샷 억제', () => {
  let service: EditSessionsService;

  const mockSessionRepository = {
    createQueryBuilder: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(async (s: any) => s),
    softDelete: jest.fn(),
    manager: { createQueryBuilder: jest.fn(), query: jest.fn().mockResolvedValue([]) },
  };

  const mockVersionRepository = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    create: jest.fn((v: any) => ({ id: 'ver-new', ...v })),
    save: jest.fn(async (v: any) => v),
    delete: jest.fn(),
  };

  const mkSession = (canvasData: any): EditSessionEntity =>
    ({
      id: 'sess-1',
      memberSeqno: 7,
      guestToken: null,
      status: SessionStatus.EDITING,
      canvasData,
      metadata: null,
    }) as EditSessionEntity;

  /** versionRepository.findOne 이중 역할 분기: getVersion(where.id) vs 최신 스냅샷 조회(order) */
  const wireVersionFindOne = (target: { id: string; canvasData: any }, latest: any | null) => {
    mockVersionRepository.findOne.mockImplementation(async (opts: any) => {
      if (opts?.where?.id) return opts.where.id === target.id ? { ...target, pageCount: 0 } : null;
      return latest;
    });
  };

  const latestQueryCalls = () =>
    mockVersionRepository.findOne.mock.calls.filter(([opts]: any[]) => !opts?.where?.id);

  beforeEach(async () => {
    jest.clearAllMocks();
    mockVersionRepository.find.mockResolvedValue([]);
    mockSessionRepository.save.mockImplementation(async (s: any) => s);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EditSessionsService,
        { provide: getRepositoryToken(EditSessionEntity), useValue: mockSessionRepository },
        { provide: getRepositoryToken(EditSessionVersionEntity), useValue: mockVersionRepository },
        { provide: WorkerJobsService, useValue: { createValidationJob: jest.fn() } },
        { provide: TemplateSetsService, useValue: { findOneWithTemplates: jest.fn(), findOne: jest.fn() } },
      ],
    }).compile();

    service = module.get<EditSessionsService>(EditSessionsService);
  });

  it('(1) 동일 버전 연속 restore 2회 → restore 스냅샷은 1건만 (두 번째는 멱등 재호출로 save 미호출)', async () => {
    const current = [{ cur: true }, { cur: true }];
    const old = [{ old: true }];
    const target = { id: 'ver-old', canvasData: old };

    // 1회차: 세션 현재 상태 = current, 최신 스냅샷 없음 → restore 스냅샷 생성
    mockSessionRepository.findOne.mockResolvedValue(mkSession(current));
    wireVersionFindOne(target, null);
    const first = await service.restoreVersion('sess-1', 'ver-old', 7);
    expect(first.canvasData).toBe(old);
    expect(mockVersionRepository.save).toHaveBeenCalledTimes(1);
    expect(mockVersionRepository.save.mock.calls[0][0]).toMatchObject({ reason: 'restore', canvasData: current });
    const latestQueriesAfterFirst = latestQueryCalls().length;

    // 2회차(재시도): 세션은 이미 old 상태 — 복원 대상과 동일 → 스냅샷 생략, 복원 자체는 정상
    mockSessionRepository.findOne.mockResolvedValue(mkSession(JSON.parse(JSON.stringify(old))));
    wireVersionFindOne(target, { id: 'ver-new', reason: 'restore', canvasData: current });
    const second = await service.restoreVersion('sess-1', 'ver-old', 7);
    expect(second.canvasData).toBe(old);
    expect(mockVersionRepository.save).toHaveBeenCalledTimes(1);
    // 규칙(1)에서 단락되므로 2회차에는 최신 스냅샷 조회(DB 왕복)조차 일어나지 않는다
    expect(latestQueryCalls()).toHaveLength(latestQueriesAfterFirst);
  });

  it('(2) 현재 상태가 세션의 최신 스냅샷과 동일하면 스냅샷을 생략한다 (직전 상태 이미 보존)', async () => {
    const current = [{ a: 1 }, { a: 2 }];
    const old = [{ a: 0 }];
    mockSessionRepository.findOne.mockResolvedValue(mkSession(current));
    wireVersionFindOne(
      { id: 'ver-old', canvasData: old },
      { id: 'ver-latest', reason: 'autosave', canvasData: JSON.parse(JSON.stringify(current)) },
    );

    const restored = await service.restoreVersion('sess-1', 'ver-old', 7);

    expect(restored.canvasData).toBe(old);
    expect(mockVersionRepository.save).not.toHaveBeenCalled();
    // 최신 1건 조회 형태 고정: session.id 조건 + createdAt DESC + 경량 select
    expect(latestQueryCalls()).toHaveLength(1);
    expect(latestQueryCalls()[0][0]).toMatchObject({
      where: { session: { id: 'sess-1' } },
      order: { createdAt: 'DESC' },
      select: expect.arrayContaining(['id', 'reason', 'canvasData']),
    });
  });

  it('(3) 현재 상태가 최신 스냅샷과 다르면 restore 스냅샷을 정상 생성한다', async () => {
    const current = [{ a: 1 }, { a: 2 }, { a: 3 }];
    const old = [{ a: 0 }];
    mockSessionRepository.findOne.mockResolvedValue(mkSession(current));
    wireVersionFindOne(
      { id: 'ver-old', canvasData: old },
      { id: 'ver-latest', reason: 'autosave', canvasData: [{ a: 1 }, { a: 2 }] },
    );

    const restored = await service.restoreVersion('sess-1', 'ver-old', 7);

    expect(restored.canvasData).toBe(old);
    expect(mockVersionRepository.save).toHaveBeenCalledTimes(1);
    const snap = mockVersionRepository.save.mock.calls[0][0];
    expect(snap.reason).toBe('restore');
    expect(snap.canvasData).toBe(current);
    expect(snap.pageCount).toBe(3);
    expect(snap.nextPageCount).toBe(1);
  });

  it('(3-b) 최신 스냅샷 조회가 실패해도 restore 스냅샷은 진행한다 (보수)', async () => {
    const current = [{ a: 1 }];
    const old = [{ a: 0 }];
    mockSessionRepository.findOne.mockResolvedValue(mkSession(current));
    mockVersionRepository.findOne.mockImplementation(async (opts: any) => {
      if (opts?.where?.id) return { id: 'ver-old', canvasData: old, pageCount: 1 };
      throw new Error('db down');
    });

    const restored = await service.restoreVersion('sess-1', 'ver-old', 7);

    expect(restored.canvasData).toBe(old);
    expect(mockVersionRepository.save).toHaveBeenCalledTimes(1);
    expect(mockVersionRepository.save.mock.calls[0][0]).toMatchObject({ reason: 'restore', canvasData: current });
  });

  it('(4) 회귀 가드: autosave 경로는 최신 스냅샷 조회 없이 기존처럼 스냅샷한다', async () => {
    const prev = [{ v: 1 }];
    const next = [{ v: 1 }, { v: 2 }];
    mockSessionRepository.findOne.mockResolvedValue(mkSession(prev));
    // 최신 스냅샷이 prev 와 동일하더라도 autosave 는 영향받지 않아야 한다
    mockVersionRepository.findOne.mockResolvedValue({ id: 'ver-latest', reason: 'autosave', canvasData: [{ v: 1 }] });

    await service.update('sess-1', { canvasData: next } as any, 7);

    expect(mockVersionRepository.findOne).not.toHaveBeenCalled();
    expect(mockVersionRepository.save).toHaveBeenCalledTimes(1);
    expect(mockVersionRepository.save.mock.calls[0][0]).toMatchObject({
      reason: 'autosave',
      canvasData: prev,
      pageCount: 1,
      nextPageCount: 2,
    });
    expect(mockSessionRepository.save.mock.calls[0][0].canvasData).toBe(next);

    // 동일 내용 autosave 는 여전히 생략(기존 규칙 불변)
    service['lastVersionAt'].clear();
    mockSessionRepository.findOne.mockResolvedValue(mkSession([{ v: 9 }]));
    await service.update('sess-1', { canvasData: [{ v: 9 }] } as any, 7);
    expect(mockVersionRepository.save).toHaveBeenCalledTimes(1);
  });
});
