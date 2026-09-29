/**
 * 파트너 조회에서 조용한 관리자 합성 잡 제외(2026-09-29) — SQL 조건 고정.
 * 실제 MariaDB 동작(JSON_EXTRACT 불리언 → 'true')은 운영 DB 읽기 전용 확인으로 검증했다.
 */
import { partnerVisibleSynthJobSql } from './edit-sessions.service';

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
