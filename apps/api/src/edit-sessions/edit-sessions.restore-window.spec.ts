import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { EditSessionsService } from './edit-sessions.service';

/**
 * 삭제 세션 복구 — 관리자 삭제 48시간 복구창 (2026-11-25).
 * purge_after 가 있으면(관리자 삭제) 기한 전까지만 복구, 지나면 409 RESTORE_WINDOW_CLOSED.
 * purge_after 가 없으면(고객 삭제) 기한 없이 복구.
 */
describe('EditSessionsService.restoreSession — 관리자 삭제 복구창', () => {
  const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const HOUR = 3600_000;
  let sessionRepo: { findOne: jest.Mock; restore: jest.Mock; update: jest.Mock };
  let service: EditSessionsService;

  const session = (patch: Record<string, unknown>) => ({ id: ID, deletedAt: new Date(), purgeAfter: null, ...patch });

  beforeEach(() => {
    sessionRepo = {
      findOne: jest.fn(),
      restore: jest.fn(async () => ({ affected: 1 })),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    service = new EditSessionsService(sessionRepo as never, {} as never, {} as never, {} as never);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('고객 삭제(purge_after 없음): 기한 없이 복구하고 purge_after 는 건드리지 않는다', async () => {
    sessionRepo.findOne.mockResolvedValue(session({ deletedAt: new Date(Date.now() - 400 * 24 * HOUR) }));
    const r = await service.restoreSession(ID);
    expect(sessionRepo.restore).toHaveBeenCalledWith(ID);
    expect(sessionRepo.update).not.toHaveBeenCalled();
    expect(r.deletedAt).toBeNull();
  });

  it('관리자 삭제, 기한 전: 복구하고 purge_after 를 NULL 로 되돌린다', async () => {
    sessionRepo.findOne.mockResolvedValue(session({ purgeAfter: new Date(Date.now() + HOUR) }));
    const r = await service.restoreSession(ID);
    expect(sessionRepo.restore).toHaveBeenCalledWith(ID);
    expect(sessionRepo.update).toHaveBeenCalledWith({ id: ID }, { purgeAfter: null });
    expect(r.deletedAt).toBeNull();
    expect(r.purgeAfter).toBeNull();
  });

  it('관리자 삭제, 기한 지남: 409 RESTORE_WINDOW_CLOSED, 복구하지 않는다', async () => {
    const purgeAfter = new Date(Date.now() - 1000);
    sessionRepo.findOne.mockResolvedValue(session({ purgeAfter }));
    const err = await service.restoreSession(ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'RESTORE_WINDOW_CLOSED',
      purgeAfter: purgeAfter.toISOString(),
    });
    expect(sessionRepo.restore).not.toHaveBeenCalled();
    expect(sessionRepo.update).not.toHaveBeenCalled();
  });

  it('활성 세션: 멱등(아무것도 바꾸지 않음)', async () => {
    sessionRepo.findOne.mockResolvedValue(session({ deletedAt: null }));
    await service.restoreSession(ID);
    expect(sessionRepo.restore).not.toHaveBeenCalled();
    expect(sessionRepo.update).not.toHaveBeenCalled();
  });

  it('없는 세션: 404', async () => {
    sessionRepo.findOne.mockResolvedValue(null);
    await expect(service.restoreSession(ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});
