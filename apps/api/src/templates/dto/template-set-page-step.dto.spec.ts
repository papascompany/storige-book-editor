/**
 * S8 (2026-09-28): pageStep(내지 증감 단위) DTO 검증 — 전역 ValidationPipe 설정과 동일 조건.
 * @IsOptional @IsInt @Min(1), null 허용(해제).
 */
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateTemplateSetDto, UpdateTemplateSetDto } from './template-set.dto';

describe('TemplateSet DTO pageStep (S8)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  });
  const base = { name: 'Step Set', type: 'book', width: 210, height: 297 };

  const create = (extra: Record<string, unknown>) =>
    pipe.transform({ ...base, ...extra }, { type: 'body', metatype: CreateTemplateSetDto });
  const update = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: UpdateTemplateSetDto });

  it('create: 정수 >=1 통과', async () => {
    await expect(create({ pageStep: 2 })).resolves.toMatchObject({ pageStep: 2 });
    await expect(create({ pageStep: 1 })).resolves.toMatchObject({ pageStep: 1 });
  });

  it('create: 미지정/null 통과 (제약 없음)', async () => {
    const out = await create({});
    expect(out.pageStep).toBeUndefined();
    await expect(create({ pageStep: null })).resolves.toMatchObject({ pageStep: null });
  });

  it('create: 0·음수·소수·문자열 거부', async () => {
    for (const bad of [0, -2, 1.5, 'two']) {
      await expect(create({ pageStep: bad })).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('update: 설정/해제(null) 통과, 0 거부', async () => {
    await expect(update({ pageStep: 2 })).resolves.toMatchObject({ pageStep: 2 });
    await expect(update({ pageStep: null })).resolves.toMatchObject({ pageStep: null });
    await expect(update({ pageStep: 0 })).rejects.toBeInstanceOf(BadRequestException);
  });
});
