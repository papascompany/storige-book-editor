/**
 * WorkerJobsService.assertEditSessionLink — 잡 생성 라우트의 세션 연결 확인 판정.
 *
 *  - staff·내부 워커 키: 조회 없이 통과.
 *  - 운영자: 권한 세션 목록에 있고 존재하는 세션.
 *  - 사이트 키: 같은 사이트 세션(비회원 세션 포함, X-Guest-Token 불요) 또는 사이트 미지정 회원 세션.
 *  - shop: 세션 사이트가 토큰 사이트와 같거나 미지정이고, 회원 세션은 회원 번호 일치 또는 주문권한(0 제외),
 *    비회원 세션은 유효한 X-Guest-Token.
 *  - 운영자·사이트 키·shop 호출자가 증명하지 못하면 404 SESSION_NOT_FOUND(세션 부재와 같은 응답).
 *  - 그 밖의 호출자(none)는 유효한 X-Guest-Token 이면 통과, 아니면 요청을 진행하고 `[job-link] would-deny` 로그.
 *  - 로그는 라우트·호출자 유형·세션 사이트만(세션 id·토큰·회원 번호 미기록).
 *
 *  - strictUnverified(JOB_LINK_STRICT): 그 밖의 호출자도 증명하지 못하면 같은 404, 조회 오류는 전파.
 *
 * observeJobInputFileSites — 입력 파일 사이트가 호출자 사이트와 다르면 `[job-file] cross-site` 로그(파일 id 미기록).
 * strict(JOB_FILE_SITE_STRICT)면 403 FILE_SITE_MISMATCH. `api://<uuid>` URL 입력도 같은 대상이다.
 */
import { ForbiddenException, HttpException, Logger, NotFoundException } from '@nestjs/common';
import { WorkerJobsService, apiFileRefIdOf, type SessionLinkCaller } from './worker-jobs.service';

const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEMBER_A = '11111111-1111-4111-8111-111111111111'; // 회원 123 · 주문 100 · site A
const GUEST_A = '22222222-2222-4222-8222-222222222222'; // 비회원 · site A
const MEMBER_NULL = '33333333-3333-4333-8333-333333333333'; // 회원 123 · 사이트 미지정
const GUEST_NULL = '44444444-4444-4444-8444-444444444444'; // 비회원 · 사이트 미지정
const MEMBER_B = '55555555-5555-4555-8555-555555555555'; // 회원 123 · site B
const NO_ORDER_A = '66666666-6666-4666-8666-666666666666'; // 회원 456 · 주문 0 · site A
const EXPIRED_GUEST_A = '77777777-7777-4777-8777-777777777777'; // 만료된 비회원 · site A
const MISSING = '99999999-9999-4999-8999-999999999999';
const GUEST_TOKEN = 'guest-token-value-7c1e';
const FILE_A = 'f0000000-0000-4000-8000-00000000000a';
const FILE_B = 'f0000000-0000-4000-8000-00000000000b';
const FILE_NULL = 'f0000000-0000-4000-8000-0000000000ff';

interface Row {
  id: string;
  siteId: string | null;
  memberSeqno: number;
  orderSeqno: number;
  guestToken: string | null;
  guestExpiresAt: Date | null;
}

function table(): Record<string, Row> {
  const future = new Date(Date.now() + 3600_000);
  const row = (id: string, extra: Partial<Row>): Row => ({
    id,
    siteId: SITE_A,
    memberSeqno: 123,
    orderSeqno: 100,
    guestToken: null,
    guestExpiresAt: null,
    ...extra,
  });
  return {
    [MEMBER_A]: row(MEMBER_A, {}),
    [GUEST_A]: row(GUEST_A, { memberSeqno: 0, guestToken: GUEST_TOKEN, guestExpiresAt: future }),
    [MEMBER_NULL]: row(MEMBER_NULL, { siteId: null }),
    [GUEST_NULL]: row(GUEST_NULL, { siteId: null, memberSeqno: 0, guestToken: GUEST_TOKEN, guestExpiresAt: future }),
    [MEMBER_B]: row(MEMBER_B, { siteId: SITE_B }),
    [NO_ORDER_A]: row(NO_ORDER_A, { memberSeqno: 456, orderSeqno: 0 }),
    [EXPIRED_GUEST_A]: row(EXPIRED_GUEST_A, {
      memberSeqno: 0,
      guestToken: GUEST_TOKEN,
      guestExpiresAt: new Date(Date.now() - 1000),
    }),
  };
}

const shop = (memberSeqno: number, extra: Partial<Extract<SessionLinkCaller, { kind: 'shop' }>> = {}): SessionLinkCaller => ({
  kind: 'shop',
  siteId: SITE_A,
  memberSeqno,
  ...extra,
});
const siteKey = (siteId: string = SITE_A): SessionLinkCaller => ({ kind: 'siteKey', siteId });
const none: SessionLinkCaller = { kind: 'none' };

describe('WorkerJobsService.assertEditSessionLink', () => {
  let service: WorkerJobsService;
  let rows: Record<string, Row>;
  const editSessionRepository = { findOne: jest.fn() };
  const filesService = { findById: jest.fn() };
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  const linkLogs = (): string[] =>
    [...logSpy.mock.calls, ...warnSpy.mock.calls]
      .map((c: unknown[]) => String(c[0]))
      .filter((m: string) => m.startsWith('[job-link]'));

  const check = (id: string, callers: SessionLinkCaller[], token?: string): Promise<boolean> =>
    service.assertEditSessionLink(id, callers, token, 'test-route');

  async function expect404(p: Promise<boolean>, id: string): Promise<void> {
    let caught: unknown;
    try {
      await p;
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NotFoundException);
    expect((caught as HttpException).getResponse()).toEqual({
      code: 'SESSION_NOT_FOUND',
      message: '편집 세션을 찾을 수 없습니다.',
      details: { sessionId: id },
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    rows = table();
    editSessionRepository.findOne.mockImplementation(async (opts: { where: { id: string } }) => {
      const r = rows[opts.where.id];
      return r ? { ...r } : null;
    });
    service = new WorkerJobsService(
      {} as never, // workerJobRepository
      editSessionRepository as never,
      { add: jest.fn() } as never,
      { add: jest.fn() } as never,
      { add: jest.fn() } as never,
      filesService as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const logger = (service as unknown as { logger: Logger }).logger;
    logSpy = jest.spyOn(logger, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  it('K1: 세션 미존재 → 운영자·사이트 키·shop 모두 404 SESSION_NOT_FOUND {details.sessionId}', async () => {
    await expect404(check(MISSING, [{ kind: 'operator', sessionIds: [MISSING] }]), MISSING);
    await expect404(check(MISSING, [siteKey()]), MISSING);
    await expect404(check(MISSING, [shop(123)], GUEST_TOKEN), MISSING);
  });

  it('K1-b: 삭제된 세션은 조회 결과에 없으므로 같은 404(기본 findOne 은 삭제 행 제외)', async () => {
    delete rows[MEMBER_A];
    await expect404(check(MEMBER_A, [siteKey()]), MEMBER_A);
    expect(editSessionRepository.findOne).toHaveBeenCalledWith(
      expect.not.objectContaining({ withDeleted: true }),
    );
  });

  it('K1-c: 조회 컬럼은 판정에 쓰는 컬럼만', async () => {
    await check(MEMBER_A, [siteKey()]);
    expect(editSessionRepository.findOne).toHaveBeenCalledWith({
      where: { id: MEMBER_A },
      select: ['id', 'siteId', 'memberSeqno', 'orderSeqno', 'guestToken', 'guestExpiresAt'],
    });
  });

  it('K2: staff·내부 워커 키 → 조회 없이 통과·반환 true(다른 호출자와 함께 와도 동일)', async () => {
    await expect(check(MEMBER_B, [{ kind: 'staff' }])).resolves.toBe(true);
    await expect(check(MISSING, [{ kind: 'internalWorkerKey' }])).resolves.toBe(true);
    await expect(check(MEMBER_B, [none, { kind: 'staff' }])).resolves.toBe(true);
    expect(editSessionRepository.findOne).not.toHaveBeenCalled();
    expect(linkLogs()).toEqual([]);
  });

  it('K3: 운영자 — 권한 세션 목록 포함·존재 → 통과 / 미포함 → 404', async () => {
    await expect(check(MEMBER_A, [{ kind: 'operator', sessionIds: [MEMBER_A] }])).resolves.toBe(true);
    await expect404(check(MEMBER_A, [{ kind: 'operator', sessionIds: [GUEST_A] }]), MEMBER_A);
  });

  describe('K4: 사이트 키', () => {
    it('같은 사이트 회원 세션 → 통과', async () => {
      await expect(check(MEMBER_A, [siteKey()])).resolves.toBe(true);
    });
    it('같은 사이트 비회원 세션 → X-Guest-Token 없이 통과', async () => {
      await expect(check(GUEST_A, [siteKey()])).resolves.toBe(true);
    });
    it('사이트 미지정 회원 세션 → 통과', async () => {
      await expect(check(MEMBER_NULL, [siteKey()])).resolves.toBe(true);
    });
    it('다른 사이트 세션 → 404', async () => {
      await expect404(check(MEMBER_B, [siteKey()]), MEMBER_B);
    });
    it('사이트 미지정 비회원 세션 → 유효한 X-Guest-Token 이 있어도 404', async () => {
      await expect404(check(GUEST_NULL, [siteKey()], GUEST_TOKEN), GUEST_NULL);
    });
    it('다른 사이트 비회원 세션 → 유효한 X-Guest-Token 이 있어도 404', async () => {
      await expect404(check(GUEST_A, [siteKey(SITE_B)], GUEST_TOKEN), GUEST_A);
    });
  });

  describe('K5: shop', () => {
    it('같은 사이트 + 같은 회원 → 통과', async () => {
      await expect(check(MEMBER_A, [shop(123)])).resolves.toBe(true);
    });
    it('다른 회원 → 404', async () => {
      await expect404(check(MEMBER_A, [shop(456)]), MEMBER_A);
    });
    it('주문권한에 세션 주문 번호 → 통과', async () => {
      await expect(check(MEMBER_A, [shop(Number.NaN, { allowedOrderSeqnos: [100] })])).resolves.toBe(true);
    });
    it('세션 주문 번호 0 은 주문권한으로 인정하지 않음 → 404', async () => {
      await expect404(check(NO_ORDER_A, [shop(Number.NaN, { allowedOrderSeqnos: [0] })]), NO_ORDER_A);
    });
    it('회원 번호가 양의 정수가 아닌 토큰(NaN) → 404', async () => {
      await expect404(check(MEMBER_A, [shop(Number.NaN)]), MEMBER_A);
    });
    it('다른 사이트 세션 → 회원·주문권한이 맞아도 404', async () => {
      await expect404(check(MEMBER_B, [shop(123, { allowedOrderSeqnos: [100] })]), MEMBER_B);
    });
    it('사이트 미지정 회원 세션 + 같은 회원 → 통과', async () => {
      await expect(check(MEMBER_NULL, [shop(123)])).resolves.toBe(true);
    });
    it('사이트 없는 토큰 → 사이트 미지정 세션만 통과', async () => {
      await expect(check(MEMBER_NULL, [shop(123, { siteId: null })])).resolves.toBe(true);
      await expect404(check(MEMBER_A, [shop(123, { siteId: null })]), MEMBER_A);
    });
  });

  describe('K6: 비회원 세션 — X-Guest-Token', () => {
    it('유효한 토큰 → none·shop 통과', async () => {
      await expect(check(GUEST_A, [none], GUEST_TOKEN)).resolves.toBe(true);
      await expect(check(GUEST_A, [shop(Number.NaN)], GUEST_TOKEN)).resolves.toBe(true);
      expect(linkLogs()).toEqual([]);
    });
    it('shop — 토큰 불일치·만료·헤더 없음 → 404', async () => {
      await expect404(check(GUEST_A, [shop(Number.NaN)], 'wrong-token'), GUEST_A);
      await expect404(check(EXPIRED_GUEST_A, [shop(Number.NaN)], GUEST_TOKEN), EXPIRED_GUEST_A);
      await expect404(check(GUEST_A, [shop(Number.NaN)], undefined), GUEST_A);
      await expect404(check(GUEST_A, [shop(Number.NaN)], ''), GUEST_A);
    });
    it('shop — 다른 사이트 토큰은 유효한 게스트 토큰이 있어도 404', async () => {
      await expect404(check(GUEST_A, [shop(Number.NaN, { siteId: SITE_B })], GUEST_TOKEN), GUEST_A);
    });
    it('shop 회원 번호 일치만으로는 비회원 세션을 연결하지 않는다', async () => {
      await expect404(check(GUEST_A, [shop(0, { allowedOrderSeqnos: [100] })]), GUEST_A);
    });
  });

  describe('K7: none(무인증 등) — 요청 진행(반환 false = 연결 미확인), 운영 로그', () => {
    it('회원 세션 → 통과(예외 없음) + would-deny 로그 1줄', async () => {
      await expect(check(MEMBER_A, [none])).resolves.toBe(false);
      expect(linkLogs()).toEqual([`[job-link] would-deny route=test-route caller=none site=${SITE_A}`]);
    });
    it('세션 미존재 → 통과 + would-deny 로그(site=-)', async () => {
      await expect(check(MISSING, [none])).resolves.toBe(false);
      expect(linkLogs()).toEqual(['[job-link] would-deny route=test-route caller=none site=-']);
    });
    it('비회원 세션 + 토큰 불일치·만료 → 통과 + would-deny 로그', async () => {
      await expect(check(GUEST_A, [none], 'wrong-token')).resolves.toBe(false);
      await expect(check(EXPIRED_GUEST_A, [none], GUEST_TOKEN)).resolves.toBe(false);
      expect(linkLogs()).toHaveLength(2);
    });
    it('조회 오류 → 통과 + check-error 로그', async () => {
      editSessionRepository.findOne.mockRejectedValueOnce(new Error('db down'));
      await expect(check(MEMBER_A, [none])).resolves.toBe(false);
      expect(linkLogs()).toEqual(['[job-link] check-error route=test-route caller=none']);
    });
  });

  it('K8: 거부 로그 1줄 — 라우트·호출자 유형·세션 사이트만(세션 id·토큰·회원 번호 미기록)', async () => {
    await expect404(check(MEMBER_A, [shop(456), siteKey(SITE_B)], GUEST_TOKEN), MEMBER_A);
    expect(linkLogs()).toEqual([`[job-link] denied route=test-route caller=shop,siteKey site=${SITE_A}`]);
    await check(MEMBER_A, [none], GUEST_TOKEN);
    for (const call of [...logSpy.mock.calls, ...warnSpy.mock.calls] as unknown[][]) {
      const text = JSON.stringify(call);
      expect(text).not.toContain(MEMBER_A);
      expect(text).not.toContain(GUEST_TOKEN);
      expect(text).not.toContain('456');
      expect(text).not.toContain('123');
    }
  });

  it('K9: 강제 대상 호출자의 조회 오류는 그대로 전파', async () => {
    editSessionRepository.findOne.mockRejectedValueOnce(new Error('db down'));
    await expect(check(MEMBER_A, [siteKey()])).rejects.toThrow('db down');
  });

  describe('strictUnverified(JOB_LINK_STRICT)', () => {
    const strictCheck = (id: string, callers: SessionLinkCaller[], token?: string): Promise<boolean> =>
      service.assertEditSessionLink(id, callers, token, 'test-route', { strictUnverified: true });

    it('K7-S1: none + 회원 세션 → 404, denied 로그 1줄', async () => {
      await expect404(strictCheck(MEMBER_A, [none]), MEMBER_A);
      expect(linkLogs()).toEqual([`[job-link] denied route=test-route caller=none site=${SITE_A}`]);
    });

    it('K7-S2: 세션 없음 → 404(site=-)', async () => {
      await expect404(strictCheck(MISSING, [none]), MISSING);
      expect(linkLogs()).toEqual(['[job-link] denied route=test-route caller=none site=-']);
    });

    it('K7-S3: 비회원 세션 + 유효 토큰 통과 / 불일치·만료 404', async () => {
      await expect(strictCheck(GUEST_A, [none], GUEST_TOKEN)).resolves.toBe(true);
      expect(linkLogs()).toEqual([]);
      await expect404(strictCheck(GUEST_A, [none], 'other-token'), GUEST_A);
      await expect404(strictCheck(EXPIRED_GUEST_A, [none], GUEST_TOKEN), EXPIRED_GUEST_A);
    });

    it('K7-S4: 세션 조회 오류는 전파', async () => {
      editSessionRepository.findOne.mockRejectedValueOnce(new Error('db down'));
      await expect(strictCheck(MEMBER_A, [none])).rejects.toThrow('db down');
      expect(linkLogs()).toEqual([]);
    });

    it('K7-S5: staff·내부 워커 키는 조회 없이 통과, 사이트 키·shop 판정은 기본값과 같다', async () => {
      await expect(strictCheck(MEMBER_B, [{ kind: 'staff' }])).resolves.toBe(true);
      await expect(strictCheck(MEMBER_B, [{ kind: 'internalWorkerKey' }])).resolves.toBe(true);
      expect(editSessionRepository.findOne).not.toHaveBeenCalled();
      await expect(strictCheck(MEMBER_A, [siteKey()])).resolves.toBe(true);
      await expect(strictCheck(MEMBER_A, [shop(123)])).resolves.toBe(true);
      await expect404(strictCheck(MEMBER_B, [siteKey()]), MEMBER_B);
    });

    it('K8-S: 거부 로그에도 세션 id·토큰·회원 번호 미기록', async () => {
      await expect404(strictCheck(MEMBER_A, [none], GUEST_TOKEN), MEMBER_A);
      for (const call of [...logSpy.mock.calls, ...warnSpy.mock.calls] as unknown[][]) {
        const text = JSON.stringify(call);
        expect(text).not.toContain(MEMBER_A);
        expect(text).not.toContain(GUEST_TOKEN);
        expect(text).not.toContain('123');
      }
    });

    it('opts 미전달·strictUnverified:false → none 은 관측 로그만', async () => {
      await expect(
        service.assertEditSessionLink(MEMBER_A, [none], undefined, 'test-route', { strictUnverified: false }),
      ).resolves.toBe(false);
      await expect(check(MEMBER_A, [none])).resolves.toBe(false);
      expect(linkLogs()).toEqual([
        `[job-link] would-deny route=test-route caller=none site=${SITE_A}`,
        `[job-link] would-deny route=test-route caller=none site=${SITE_A}`,
      ]);
    });
  });

  it('K10: 여러 호출자는 각자 판정 — 하나라도 증명하면 통과(shop 불일치 + 같은 사이트 키)', async () => {
    await expect(check(MEMBER_A, [shop(456), siteKey()])).resolves.toBe(true);
    expect(linkLogs()).toEqual([]);
  });

  describe('observeJobInputFileSites', () => {
    const fileLogs = (): string[] =>
      logSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.startsWith('[job-file]'));

    beforeEach(() => {
      const files: Record<string, { id: string; siteId: string | null }> = {
        [FILE_A]: { id: FILE_A, siteId: SITE_A },
        [FILE_B]: { id: FILE_B, siteId: SITE_B },
        [FILE_NULL]: { id: FILE_NULL, siteId: null },
      };
      filesService.findById.mockImplementation(async (id: string) => {
        const f = files[id];
        if (!f) throw new NotFoundException({ code: 'FILE_NOT_FOUND' });
        return f;
      });
    });

    it('F1: 다른 사이트 파일 → cross-site 로그 1줄(파일 id 미기록)', async () => {
      await service.observeJobInputFileSites('synthesize/external', { kind: 'siteKey', siteId: SITE_A }, [FILE_A, FILE_B]);
      expect(fileLogs()).toEqual([
        `[job-file] cross-site route=synthesize/external caller=siteKey site=${SITE_A} fileSite=${SITE_B}`,
      ]);
      expect(JSON.stringify(logSpy.mock.calls)).not.toContain(FILE_B);
    });

    it('F2: 같은 사이트·사이트 미지정·없는 파일·빈 값 → 로그 없음, 예외 없음', async () => {
      await expect(
        service.observeJobInputFileSites('validate', { kind: 'shop', siteId: SITE_A }, [
          FILE_A,
          FILE_NULL,
          MISSING,
          undefined,
          null,
          '',
        ]),
      ).resolves.toBeUndefined();
      expect(fileLogs()).toEqual([]);
    });

    it('F3: 같은 파일 id 는 한 번만 조회', async () => {
      await service.observeJobInputFileSites('validate', { kind: 'operator', siteId: SITE_A }, [FILE_B, FILE_B]);
      expect(filesService.findById).toHaveBeenCalledTimes(1);
      expect(fileLogs()).toHaveLength(1);
    });

    const forbidden = async (p: Promise<void>): Promise<{ status: number; body: unknown }> => {
      try {
        await p;
      } catch (e) {
        expect(e).toBeInstanceOf(ForbiddenException);
        return { status: (e as HttpException).getStatus(), body: (e as HttpException).getResponse() };
      }
      throw new Error('expected rejection');
    };

    it('F4: strict → 다른 사이트 파일 403 FILE_SITE_MISMATCH(details.fileId), denied 로그에 파일 id 없음', async () => {
      const r = await forbidden(
        service.observeJobInputFileSites('validate/external', { kind: 'siteKey', siteId: SITE_A }, [FILE_A, FILE_B], {
          strict: true,
        }),
      );
      expect(r).toEqual({
        status: 403,
        body: {
          code: 'FILE_SITE_MISMATCH',
          message: '이 사이트에서 사용할 수 없는 파일입니다.',
          details: { fileId: FILE_B },
        },
      });
      expect(fileLogs()).toEqual([
        `[job-file] denied route=validate/external caller=siteKey site=${SITE_A} fileSite=${SITE_B}`,
      ]);
      expect(JSON.stringify(logSpy.mock.calls)).not.toContain(FILE_B);
    });

    it('F5: strict → 같은 사이트·사이트 미지정·없는 파일·빈 값 통과', async () => {
      await expect(
        service.observeJobInputFileSites(
          'validate',
          { kind: 'shop', siteId: SITE_A },
          [FILE_A, FILE_NULL, MISSING, undefined, null, ''],
          { strict: true, urls: [`api://${FILE_NULL}`, `api://${MISSING}`] },
        ),
      ).resolves.toBeUndefined();
      expect(fileLogs()).toEqual([]);
    });

    it('F6: strict → NotFound 외 조회 오류 전파 / strict 꺼짐 → 무시', async () => {
      filesService.findById.mockRejectedValueOnce(new Error('db down'));
      await expect(
        service.observeJobInputFileSites('validate', { kind: 'shop', siteId: SITE_A }, [FILE_A], { strict: true }),
      ).rejects.toThrow('db down');
      filesService.findById.mockRejectedValueOnce(new Error('db down'));
      await expect(
        service.observeJobInputFileSites('validate', { kind: 'shop', siteId: SITE_A }, [FILE_A]),
      ).resolves.toBeUndefined();
    });

    it('F7: urls 의 api://<uuid>(대소문자 무관)는 파일로 확인, 그 밖의 형식은 대상 아님, fileIds 와 같은 id 는 1회 조회, URL 유래 로그는 ref=url', async () => {
      await service.observeJobInputFileSites('synthesize/external', { kind: 'siteKey', siteId: SITE_A }, [], {
        urls: [`api://${FILE_B.toUpperCase()}`, '/storage/a.pdf', 'https://example.com/a.pdf', 'api://x', undefined],
      });
      expect(filesService.findById).toHaveBeenCalledTimes(1);
      expect(filesService.findById).toHaveBeenCalledWith(FILE_B);
      expect(fileLogs()).toEqual([
        `[job-file] cross-site route=synthesize/external caller=siteKey site=${SITE_A} fileSite=${SITE_B} ref=url`,
      ]);

      filesService.findById.mockClear();
      logSpy.mockClear();
      await service.observeJobInputFileSites('synthesize/external', { kind: 'siteKey', siteId: SITE_A }, [FILE_B], {
        urls: [`api://${FILE_B.toUpperCase()}`],
      });
      expect(filesService.findById).toHaveBeenCalledTimes(1);
      expect(fileLogs()).toEqual([
        `[job-file] cross-site route=synthesize/external caller=siteKey site=${SITE_A} fileSite=${SITE_B}`,
      ]);
    });

    it('F8: fileIds 대문자 + URL 소문자 같은 id → 소문자로 1회 조회', async () => {
      await service.observeJobInputFileSites('validate', { kind: 'shop', siteId: SITE_A }, [FILE_B.toUpperCase()], {
        urls: [`api://${FILE_B}`],
      });
      expect(filesService.findById).toHaveBeenCalledTimes(1);
      expect(filesService.findById).toHaveBeenCalledWith(FILE_B);
    });

    it('F9: strict + api://<다른 사이트 파일> URL → 403(details.fileId = 소문자 id), denied 로그 ref=url', async () => {
      const r = await forbidden(
        service.observeJobInputFileSites('compose-mixed', { kind: 'siteKey', siteId: SITE_A }, [], {
          strict: true,
          urls: [`api://${FILE_B.toUpperCase()}`],
        }),
      );
      expect(r.body).toMatchObject({ code: 'FILE_SITE_MISMATCH', details: { fileId: FILE_B } });
      expect(fileLogs()).toEqual([
        `[job-file] denied route=compose-mixed caller=siteKey site=${SITE_A} fileSite=${SITE_B} ref=url`,
      ]);
    });
  });

  describe('apiFileRefIdOf', () => {
    it.each<[unknown, string | null]>([
      [`api://${FILE_A}`, FILE_A],
      [`api://${FILE_A.toUpperCase()}`, FILE_A],
      ['api://x', null],
      [` api://${FILE_A}`, null],
      [`api://${FILE_A}/x`, null],
      ['/storage/a.pdf', null],
      ['https://example.com/a.pdf', null],
      [undefined, null],
      [123, null],
    ])('%j → %j', (raw, expected) => {
      expect(apiFileRefIdOf(raw)).toBe(expected);
    });
  });
});
