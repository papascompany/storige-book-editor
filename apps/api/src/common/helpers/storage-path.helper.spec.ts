import { resolveStoragePath } from './storage-path.helper';

/**
 * 감사 §8 ⑦ 회귀 가드 — 경로 해석 4형식 + 경계 결함(형제 접두사) 봉합 검증.
 * 기준 base 는 프로덕션 기본값과 동일한 '/app/storage'.
 */
describe('resolveStoragePath', () => {
  const base = '/app/storage';

  describe('정상 해석 (4형식)', () => {
    it("'/storage/...' URL → base 하위 절대경로", () => {
      expect(resolveStoragePath('/storage/temp/converted_x.pdf', base)).toBe(
        '/app/storage/temp/converted_x.pdf',
      );
    });

    it("'storage/...' (슬래시 없는 변형) → base 하위 절대경로", () => {
      expect(resolveStoragePath('storage/temp/a.pdf', base)).toBe('/app/storage/temp/a.pdf');
    });

    it('base 안의 절대경로는 그대로 통과', () => {
      expect(resolveStoragePath('/app/storage/uploads/b.pdf', base)).toBe(
        '/app/storage/uploads/b.pdf',
      );
    });

    it('베어 상대경로 → base 하위로 합성', () => {
      expect(resolveStoragePath('temp/c.pdf', base)).toBe('/app/storage/temp/c.pdf');
    });
  });

  describe('경계 가드', () => {
    it('⑦ 핵심: 형제 접두사 디렉터리(/app/storage-evil)는 거부 — 종전 startsWith(base) 는 통과시켰다', () => {
      expect(resolveStoragePath('/app/storage-evil/x.pdf', base)).toBeNull();
      expect(resolveStoragePath('/app/storageX/x.pdf', base)).toBeNull();
    });

    it('상위 탈출(../)은 거부', () => {
      expect(resolveStoragePath('/storage/../../etc/passwd', base)).toBeNull();
      expect(resolveStoragePath('../outside.pdf', base)).toBeNull();
      expect(resolveStoragePath('temp/../../escape.pdf', base)).toBeNull();
    });

    it('base 밖 임의 절대경로는 거부', () => {
      expect(resolveStoragePath('/etc/passwd', base)).toBeNull();
      expect(resolveStoragePath('/app/other/x.pdf', base)).toBeNull();
    });

    it('base 루트 자체(디렉터리)는 거부 — 파일 기대 호출부 보호', () => {
      expect(resolveStoragePath('/storage/', base)).toBeNull();
      expect(resolveStoragePath('storage/', base)).toBeNull();
      expect(resolveStoragePath('/app/storage', base)).toBeNull();
      expect(resolveStoragePath('temp/..', base)).toBeNull();
    });

    it('.. 세그먼트가 있어도 base 안에 남으면 통과 (과차단 방지)', () => {
      expect(resolveStoragePath('temp/../uploads/d.pdf', base)).toBe('/app/storage/uploads/d.pdf');
    });
  });
});
