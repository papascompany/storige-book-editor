/**
 * 사이트 편집데이터 보관기간(editRetentionDays) — DTO 검증 + 변경 감사(fail-closed, 저장 전) (2026-09-29).
 */
import 'reflect-metadata';
import { BadRequestException, HttpException, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { Repository } from 'typeorm';
import { SitesService } from './sites.service';
import { SitesController } from './sites.controller';
import { SitesModule } from './sites.module';
import { Site } from './entities/site.entity';
import { UpdateSiteDto, CreateSiteDto } from './dto/site.dto';
import { PartnerOperatorAuditWriter } from '../auth/partner-operator/partner-operator-audit.writer';

const SITE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('UpdateSiteDto / CreateSiteDto — editRetentionDays', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const validate = (metatype: typeof UpdateSiteDto | typeof CreateSiteDto, body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype });

  it.each([null, 1, 3650])('%p 허용', async (v) => {
    const dto = (await validate(UpdateSiteDto, { editRetentionDays: v })) as UpdateSiteDto;
    expect(dto.editRetentionDays).toBe(v);
    await expect(validate(CreateSiteDto, { name: 'x', editRetentionDays: v })).resolves.toBeDefined();
  });

  it.each([0, 3651, -1, 1.5, '30'])('%p 거부(400)', async (v) => {
    await expect(validate(UpdateSiteDto, { editRetentionDays: v })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('키 없음 → 통과(값 없음)', async () => {
    const dto = (await validate(UpdateSiteDto, { name: 'y' })) as UpdateSiteDto;
    expect(dto).not.toHaveProperty('editRetentionDays');
  });
});

describe('SitesService.update — 편집데이터 보관기간 변경 감사', () => {
  let repo: { findOne: jest.Mock; save: jest.Mock };
  let audit: { recordOrThrow: jest.Mock };
  let service: SitesService;
  const order: string[] = [];

  beforeEach(() => {
    order.length = 0;
    repo = {
      findOne: jest.fn().mockResolvedValue({ id: SITE_ID, name: 'A', editRetentionDays: null } as Partial<Site>),
      save: jest.fn(async (s: Site) => {
        order.push('save');
        return s;
      }),
    };
    audit = {
      recordOrThrow: jest.fn(async () => {
        order.push('audit');
      }),
    };
    service = new SitesService(
      repo as unknown as Repository<Site>,
      audit as unknown as PartnerOperatorAuditWriter,
    );
  });

  it('값이 바뀌면 저장 전에 감사(origin staff, site.edit_retention.update, {from,to})', async () => {
    const saved = await service.update(SITE_ID, { editRetentionDays: 365 }, ACTOR);
    expect(order).toEqual(['audit', 'save']);
    expect(audit.recordOrThrow).toHaveBeenCalledWith({
      grantId: null,
      origin: 'staff',
      siteId: SITE_ID,
      sessionId: null,
      operatorId: `staff.${ACTOR}`,
      actorUserId: ACTOR,
      action: 'site.edit_retention.update',
      detail: { from: null, to: 365 },
    });
    expect(saved.editRetentionDays).toBe(365);
  });

  it('null 로 비우는 것도 변경으로 감사', async () => {
    repo.findOne.mockResolvedValue({ id: SITE_ID, editRetentionDays: 30 });
    await service.update(SITE_ID, { editRetentionDays: null }, ACTOR);
    expect(audit.recordOrThrow.mock.calls[0][0].detail).toEqual({ from: 30, to: null });
  });

  it('감사 실패 → 503 STAFF_AUDIT_UNAVAILABLE, 저장 안 함', async () => {
    audit.recordOrThrow.mockRejectedValueOnce(new ServiceUnavailableException());
    let caught: unknown;
    try {
      await service.update(SITE_ID, { editRetentionDays: 7 }, ACTOR);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(503);
    expect(((caught as HttpException).getResponse() as Record<string, unknown>).code).toBe('STAFF_AUDIT_UNAVAILABLE');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('감사 기록기 미주입 구성에서 값 변경 → 503, 저장 안 함', async () => {
    const bare = new SitesService(repo as unknown as Repository<Site>);
    await expect(bare.update(SITE_ID, { editRetentionDays: 7 })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('키 없음 또는 값 동일 → 감사 없음(종전 동작)', async () => {
    await service.update(SITE_ID, { name: 'B' }, ACTOR);
    repo.findOne.mockResolvedValue({ id: SITE_ID, editRetentionDays: 30 });
    await service.update(SITE_ID, { editRetentionDays: 30 }, ACTOR);
    expect(audit.recordOrThrow).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalledTimes(2);
  });

  it('actor 없음 → operatorId staff.unknown', async () => {
    await service.update(SITE_ID, { editRetentionDays: 1 });
    expect(audit.recordOrThrow.mock.calls[0][0]).toMatchObject({ operatorId: 'staff.unknown', actorUserId: null });
  });
});

describe('SitesController.update — admin JWT id 전달', () => {
  it('user.id 를 actor 로 넘긴다(문자열일 때만)', async () => {
    const svc = { update: jest.fn().mockResolvedValue({ id: SITE_ID }) };
    const controller = new SitesController(svc as unknown as SitesService);
    await controller.update(SITE_ID, { editRetentionDays: 5 }, { id: ACTOR });
    expect(svc.update).toHaveBeenCalledWith(SITE_ID, { editRetentionDays: 5 }, ACTOR);
    await controller.update(SITE_ID, {}, { id: 42 });
    expect(svc.update).toHaveBeenLastCalledWith(SITE_ID, {}, undefined);
  });
});

describe('SitesModule 배선', () => {
  it('감사 기록기를 자체 등록한다', () => {
    const providers = (Reflect.getMetadata('providers', SitesModule) ?? []) as unknown[];
    expect(providers).toContain(PartnerOperatorAuditWriter);
  });
});
