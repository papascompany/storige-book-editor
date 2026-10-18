import { mergeSessionMetadata, SESSION_METADATA_SERVER_OWNED_KEYS } from './edit-sessions.service';

/**
 * P2-b 보안 리뷰(2026-10-18 #1): 세션 PATCH metadata 얕은 병합에서 서버 소유 키(launch·revision·production)는
 * 클라이언트 값이 무시되고 기존 값이 유지된다. 그 밖의 키는 종전과 같이 덮어쓴다.
 */
describe('mergeSessionMetadata — 서버 소유 키 보호', () => {
  it('서버 소유 키 목록', () => {
    expect([...SESSION_METADATA_SERVER_OWNED_KEYS]).toEqual(['launch', 'revision', 'production']);
  });
  it('클라이언트가 보낸 launch/revision/production 은 무시, 기존 값 유지', () => {
    const existing = { launch: { via: 'partner-v1', env: 'test' }, revision: 2, calendar: { startYear: 2027, startMonth: 1 } };
    const merged = mergeSessionMetadata(existing, { launch: { env: 'live' }, revision: 99, production: { status: 'done' }, calendar: { startYear: 2028, startMonth: 3 } });
    expect(merged.launch).toEqual({ via: 'partner-v1', env: 'test' });
    expect(merged.revision).toBe(2);
    expect(merged.production).toBeUndefined();
    expect(merged.calendar).toEqual({ startYear: 2028, startMonth: 3 });
  });
  it('기존 metadata 가 없고 보호 키만 보내면 빈 객체, 일반 키는 그대로', () => {
    expect(mergeSessionMetadata(null, { revision: 5 })).toEqual({});
    expect(mergeSessionMetadata(undefined, { productProfile: { version: 1 } })).toEqual({ productProfile: { version: 1 } });
  });
});
