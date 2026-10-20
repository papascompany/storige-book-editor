import { mergeSessionMetadata, SESSION_METADATA_SERVER_OWNED_KEYS } from './edit-sessions.service';

/**
 * P2-b 보안 리뷰(2026-10-18 #1): 세션 PATCH metadata 얕은 병합에서 서버 소유 키(launch·revision·production)는
 * 클라이언트 값이 무시되고 기존 값이 유지된다. 그 밖의 키는 종전과 같이 덮어쓴다.
 * P2-d 보안 리뷰 security-2(2026-10-19): productProfile 도 서버 소유 — 클라이언트가 NULL 세트에 copies 상한·sheet-map 모드를
 * 스스로 정의하지 못한다(서버가 템플릿셋 프로파일로 (재)기록: EditSessionsService.stampProductProfileSnapshot).
 */
describe('mergeSessionMetadata — 서버 소유 키 보호', () => {
  it('서버 소유 키 목록', () => {
    expect([...SESSION_METADATA_SERVER_OWNED_KEYS]).toEqual(['launch', 'revision', 'production', 'productProfile']);
  });
  it('security-2: 클라이언트가 보낸 productProfile(copies 999999999·sheet-map) 은 무시, 기존 서버 기록값 유지', () => {
    const injected = { version: 1, kind: 'photo-print', photoPrint: { copies: { min: 1, max: 999999999 } }, output: { mode: 'sheet-map' } };
    expect(mergeSessionMetadata({ revision: 0 }, { productProfile: injected, items: [{ copies: 999999999 }] })).toEqual({
      revision: 0,
      items: [{ copies: 999999999 }],
    });
    const serverProfile = { version: 1, kind: 'sheet' };
    expect(mergeSessionMetadata({ productProfile: serverProfile }, { productProfile: injected })).toEqual({ productProfile: serverProfile });
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
    expect(mergeSessionMetadata(undefined, { productProfile: { version: 1 } })).toEqual({});
    expect(mergeSessionMetadata(undefined, { calendar: { startYear: 2027 } })).toEqual({ calendar: { startYear: 2027 } });
  });
});
