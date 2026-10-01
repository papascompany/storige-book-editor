/**
 * POST /auth/shop-session 요청 검증 — memberSeqno 는 0 이상 정수(0 = 비회원 방문자).
 * 전역 ValidationPipe 와 같은 옵션(whitelist·transform·forbidNonWhitelisted)으로 검증한다.
 */
import 'reflect-metadata';
import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateShopSessionDto } from './shop-session.dto';

describe('CreateShopSessionDto — memberSeqno 검증', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const meta: ArgumentMetadata = { type: 'body', metatype: CreateShopSessionDto, data: '' };
  const body = (memberSeqno: unknown): Record<string, unknown> => ({
    memberSeqno,
    memberId: 'user@example.com',
    memberName: '홍길동',
  });

  it.each([0, 123, 1607115440])('memberSeqno %p → 통과', async (memberSeqno) => {
    const out = (await pipe.transform(body(memberSeqno), meta)) as CreateShopSessionDto;
    expect(out).toBeInstanceOf(CreateShopSessionDto);
    expect(out.memberSeqno).toBe(memberSeqno);
  });

  it.each<unknown>([-1, 0.5, 1.5, '123', null, Number.NaN])('memberSeqno %p → 400', async (memberSeqno) => {
    await expect(pipe.transform(body(memberSeqno), meta)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('memberSeqno 누락 → 400', async () => {
    const { memberSeqno: _omit, ...rest } = body(1);
    await expect(pipe.transform(rest, meta)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('orderSeqno·allowedOrderSeqnos 검증은 그대로(숫자 통과)', async () => {
    const out = (await pipe.transform(
      { ...body(0), orderSeqno: 12345, allowedOrderSeqnos: [12345, 12346] },
      meta,
    )) as CreateShopSessionDto;
    expect(out.orderSeqno).toBe(12345);
    expect(out.allowedOrderSeqnos).toEqual([12345, 12346]);
  });
});
