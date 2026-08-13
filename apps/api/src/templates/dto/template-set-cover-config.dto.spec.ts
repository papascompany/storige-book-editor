/**
 * coverConfig.finishing 은 forbidNonWhitelisted 전역 파이프를 통과해야 한다.
 * DTO 미등록이면 Admin 저장이 400 이 된다.
 */
import { ValidationPipe } from '@nestjs/common';
import { CreateTemplateSetDto } from './template-set.dto';

describe('CoverConfigDto.finishing (G8)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  });

  it('caseBind + finishing 페이로드를 통과시킨다', async () => {
    const out = await pipe.transform(
      {
        name: 'Fabric Cover Set',
        type: 'book',
        width: 210,
        height: 297,
        coverEditable: false,
        coverConfig: {
          caseBind: { boardThicknessMm: 2, turnInMm: 15, wrapMarginMm: 8 },
          finishing: { emboss: true, gold: false, silver: true },
        },
      },
      { type: 'body', metatype: CreateTemplateSetDto },
    );
    expect(out.coverConfig.finishing).toEqual({
      emboss: true,
      gold: false,
      silver: true,
    });
    expect(out.coverConfig.caseBind).toEqual({
      boardThicknessMm: 2,
      turnInMm: 15,
      wrapMarginMm: 8,
    });
  });

  it('finishing 만 있어도 통과한다', async () => {
    const out = await pipe.transform(
      {
        name: 'Fabric Cover Set',
        type: 'book',
        width: 210,
        height: 297,
        coverEditable: false,
        coverConfig: { finishing: { gold: true } },
      },
      { type: 'body', metatype: CreateTemplateSetDto },
    );
    expect(out.coverConfig).toEqual({ finishing: { gold: true } });
  });
});
