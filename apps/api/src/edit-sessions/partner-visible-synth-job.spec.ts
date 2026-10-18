/**
 * 파트너 조회에서 조용한 관리자 합성 잡 제외(2026-09-29) — SQL 조건 고정.
 * 실제 MariaDB 동작(JSON_EXTRACT 불리언 → 'true')은 운영 DB 읽기 전용 확인으로 검증했다.
 */
import { EditSessionsService, partnerVisibleSynthJobSql } from './edit-sessions.service';

describe('partnerVisibleSynthJobSql', () => {
  it('마커 없음 또는 notifyPartner=true 인 잡만 파트너에게 보인다', () => {
    const sql = partnerVisibleSynthJobSql('job');
    expect(sql).toBe(
      "(JSON_EXTRACT(job.options, '$.staffInitiated') IS NULL OR JSON_EXTRACT(job.options, '$.staffInitiated.notifyPartner') = 'true')",
    );
  });

  it('별칭을 그대로 사용한다(테이블명 직접 참조 쿼리 포함)', () => {
    expect(partnerVisibleSynthJobSql('worker_jobs')).toContain('worker_jobs.options');
  });
});

describe('EditSessionsService.findLatestPartnerVisibleSynthJob — P2-c options 컬럼(additive)', () => {
  const query = jest.fn();
  const service = new EditSessionsService(
    { manager: { query } } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const SESSION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const sheets = [
    { index: 0, front: { page: 0 }, back: { page: 1, rotate: 180 } },
    { index: 1, front: { page: 2 }, back: null },
  ];

  beforeEach(() => query.mockReset());

  it('SQL 은 job.options 를 함께 읽고 파트너 가시 조건·사이트 일치 조건을 유지한다', async () => {
    query.mockResolvedValue([]);
    await expect(service.findLatestPartnerVisibleSynthJob(SESSION_ID)).resolves.toBeNull();
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain('job.options AS options');
    expect(sql).toContain('job.result AS result');
    expect(sql).toContain('job.site_id <=> sess.site_id');
    expect(sql).toContain(partnerVisibleSynthJobSql('job'));
    expect(query.mock.calls[0][1]).toEqual([SESSION_ID]);
  });

  it('options 문자열(JSON) → 객체, result 도 종전처럼 파싱', async () => {
    query.mockResolvedValue([
      {
        id: 'job-1',
        status: 'COMPLETED',
        result: JSON.stringify({ outputFiles: [{ type: 'set', url: '/storage/outputs/job-1/set-0.pdf', setIndex: 0 }] }),
        options: JSON.stringify({ mode: 'sheet-map', totalExpectedPages: 3, sheets, output: 'per-sheet' }),
        outputFileUrl: null,
        createdAt: '2026-10-18T00:00:00.000Z',
        completedAt: '2026-10-18T00:01:00.000Z',
      },
    ]);
    const row = await service.findLatestPartnerVisibleSynthJob(SESSION_ID);
    expect(row?.options).toEqual({ mode: 'sheet-map', totalExpectedPages: 3, sheets, output: 'per-sheet' });
    expect(row?.result?.outputFiles?.[0]).toMatchObject({ type: 'set', setIndex: 0 });
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(row?.completedAt).toBeInstanceOf(Date);
  });

  it('options 가 이미 객체(드라이버 JSON 파싱)면 그대로, NULL·깨진 JSON 은 null', async () => {
    const base = { id: 'job-2', status: 'PENDING', result: null, outputFileUrl: null, createdAt: new Date(), completedAt: null };
    query.mockResolvedValueOnce([{ ...base, options: { mode: 'duplex-split', totalExpectedPages: 4 } }]);
    expect((await service.findLatestPartnerVisibleSynthJob(SESSION_ID))?.options).toEqual({
      mode: 'duplex-split',
      totalExpectedPages: 4,
    });
    query.mockResolvedValueOnce([{ ...base, options: null }]);
    expect((await service.findLatestPartnerVisibleSynthJob(SESSION_ID))?.options).toBeNull();
    query.mockResolvedValueOnce([{ ...base, options: '{not json' }]);
    expect((await service.findLatestPartnerVisibleSynthJob(SESSION_ID))?.options).toBeNull();
    query.mockResolvedValueOnce([{ ...base }]);
    expect((await service.findLatestPartnerVisibleSynthJob(SESSION_ID))?.options).toBeNull();
  });
});
