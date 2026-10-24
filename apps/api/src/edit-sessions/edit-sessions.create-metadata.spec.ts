/**
 * 세션 생성 경로의 metadata 정리.
 *
 *  - 회원 생성(POST /edit-sessions)·게스트 생성(POST /edit-sessions/guest)은 update 와 같은 규칙(mergeSessionMetadata)으로
 *    서버 소유 키(launch·revision·production·productProfile)를 입력에서 버린 뒤 프로파일 스냅샷을 기록한다.
 *  - 프로파일 스냅샷 기록 때 템플릿셋이 없으면(NotFoundException) 스냅샷 키를 두지 않는다.
 *    그 밖의 조회 오류만 기존(서버 기록) 값을 유지한다(종전 동작).
 */
import { Logger, NotFoundException } from '@nestjs/common';
import { EditSessionsController } from './edit-sessions.controller';
import { EditSessionsService } from './edit-sessions.service';
import type { CreateEditSessionDto } from './dto/create-edit-session.dto';
import { SessionMode, SessionStatus, type EditSessionEntity } from './entities/edit-session.entity';

const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const clientProfile = {
  version: 1,
  kind: 'photo-print',
  output: { mode: 'sheet-map' },
};
const setProfile = { version: 1, kind: 'sheet', output: { mode: 'single-pdf' } };

const serverOwnedInput = (): Record<string, unknown> => ({
  launch: { via: 'partner-v1', env: 'live', requestId: 'r-1' },
  revision: 7,
  production: { sheetMap: { error: 'X', message: '', at: '2026-10-24T00:00:00.000Z' } },
  productProfile: clientProfile,
  calendar: { startYear: 2027, startMonth: 1 },
});

describe('세션 생성 경로 — 서버 소유 metadata 키 정리', () => {
  let sessionRepo: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let templateSets: { findOne: jest.Mock };
  let service: EditSessionsService;
  let controller: EditSessionsController;

  const savedMetadata = (): Record<string, unknown> | null | undefined =>
    (sessionRepo.save.mock.calls[sessionRepo.save.mock.calls.length - 1][0] as EditSessionEntity).metadata;

  beforeEach(() => {
    sessionRepo = {
      create: jest.fn((s: Record<string, unknown>) => ({ ...s })),
      save: jest.fn(async (s: Record<string, unknown>) => ({ id: 'new-session', ...s })),
      findOne: jest.fn(),
    };
    templateSets = { findOne: jest.fn() };
    service = new EditSessionsService(sessionRepo as never, {} as never, {} as never, templateSets as never);
    controller = new EditSessionsController(service);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const shopUser = { userId: '123', role: 'customer', source: 'shop', siteId: SITE_A };
  const dto = (extra: Partial<CreateEditSessionDto> = {}): CreateEditSessionDto =>
    ({ orderSeqno: 100, mode: SessionMode.BOTH, ...extra }) as unknown as CreateEditSessionDto;

  it('① 회원 생성: 존재하지 않는 templateSetId + metadata.productProfile → 저장 metadata 에 productProfile 없음', async () => {
    templateSets.findOne.mockRejectedValue(new NotFoundException('템플릿셋을 찾을 수 없습니다: does-not-exist'));
    await controller.create(
      dto({ templateSetId: 'does-not-exist', metadata: { productProfile: clientProfile, pages: 2 } }),
      shopUser,
    );
    expect(savedMetadata()).toEqual({ pages: 2 });
    expect(savedMetadata()).not.toHaveProperty('productProfile');
  });

  it('① 서비스 직접 생성에서도 템플릿셋이 없으면 productProfile 키를 두지 않음', async () => {
    templateSets.findOne.mockRejectedValue(new NotFoundException('템플릿셋을 찾을 수 없습니다: does-not-exist'));
    await service.create(
      dto({ memberSeqno: 7, templateSetId: 'does-not-exist', metadata: { productProfile: clientProfile, pages: 2 } }),
    );
    expect(savedMetadata()).toEqual({ pages: 2 });
  });

  it('② 회원 생성: launch·revision·production·productProfile 을 넣어도 저장되지 않고 그 밖의 키와 회원 스냅샷은 유지', async () => {
    templateSets.findOne.mockResolvedValue({ id: 'ts-null', productProfile: null });
    await controller.create(dto({ templateSetId: 'ts-null', metadata: serverOwnedInput() }), {
      ...shopUser,
      email: 'm@example.com',
      name: '회원',
    });
    expect(savedMetadata()).toEqual({
      calendar: { startYear: 2027, startMonth: 1 },
      member: { memberId: 'm@example.com', memberName: '회원' },
    });
  });

  it('② 게스트 생성: launch·revision·production·productProfile 을 넣어도 저장되지 않고 그 밖의 키는 유지', async () => {
    templateSets.findOne.mockResolvedValue({ id: 'ts-null', productProfile: null });
    await controller.createGuest(dto({ templateSetId: 'ts-null', metadata: serverOwnedInput() }), undefined);
    expect(savedMetadata()).toEqual({ calendar: { startYear: 2027, startMonth: 1 } });
  });

  it('② 게스트 생성: metadata 를 보내지 않으면 종전대로 metadata 없음', async () => {
    await controller.createGuest(dto(), undefined);
    expect(savedMetadata()).toBeUndefined();
  });

  it('② 생성 후 프로파일이 있는 세트면 템플릿셋 현재 프로파일을 기록', async () => {
    templateSets.findOne.mockResolvedValue({ id: 'ts-set', productProfile: setProfile });
    await controller.createGuest(dto({ templateSetId: 'ts-set', metadata: serverOwnedInput() }), undefined);
    expect(savedMetadata()).toEqual({ calendar: { startYear: 2027, startMonth: 1 }, productProfile: setProfile });
  });

  it('③ 템플릿셋 조회가 NotFound 가 아닌 오류면 서비스에 넘어온 서버 기록값을 유지(종전 동작)', async () => {
    templateSets.findOne.mockRejectedValue(new Error('db down'));
    await service.create(
      dto({ memberSeqno: 7, templateSetId: 'ts-set', metadata: { launch: { env: 'test' }, revision: 0, productProfile: setProfile } }),
    );
    expect(savedMetadata()).toEqual({ launch: { env: 'test' }, revision: 0, productProfile: setProfile });
  });

  describe('update 경로의 같은 스냅샷 처리', () => {
    const mkSession = (metadata: Record<string, unknown>): EditSessionEntity =>
      ({
        id: 'sess-1',
        memberSeqno: 7,
        guestToken: null,
        status: SessionStatus.EDITING,
        mode: SessionMode.BOTH,
        templateSetId: 'ts-set',
        coverFileId: null,
        contentFileId: null,
        canvasData: null,
        metadata,
      }) as unknown as EditSessionEntity;

    it('③ NotFound 가 아닌 조회 오류 → 기존 서버 기록 productProfile 유지', async () => {
      templateSets.findOne.mockRejectedValue(new Error('db down'));
      sessionRepo.findOne.mockResolvedValue(mkSession({ productProfile: setProfile, revision: 0 }));
      const updated = await service.update('sess-1', { metadata: { calendar: { startYear: 2028 } } } as never, 7);
      expect(updated.metadata).toEqual({ productProfile: setProfile, revision: 0, calendar: { startYear: 2028 } });
    });

    it('템플릿셋이 없으면(NotFound) 프로파일 스냅샷 키를 두지 않음', async () => {
      templateSets.findOne.mockRejectedValue(new NotFoundException('템플릿셋을 찾을 수 없습니다: ts-set'));
      sessionRepo.findOne.mockResolvedValue(mkSession({ productProfile: setProfile, revision: 0 }));
      const updated = await service.update('sess-1', { metadata: { calendar: { startYear: 2028 } } } as never, 7);
      expect(updated.metadata).toEqual({ revision: 0, calendar: { startYear: 2028 } });
    });
  });
});
