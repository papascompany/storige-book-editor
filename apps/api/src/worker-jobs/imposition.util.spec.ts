import { computeReaderSpreadLayout } from './imposition.util';

describe('computeReaderSpreadLayout (리더 스프레드 계산)', () => {
  // 헬퍼: [left,right] 쌍 배열로 압축해 비교 가독성 향상
  const pairs = (totalPages: number, startSide: 'left' | 'right', binding = 'perfect') =>
    computeReaderSpreadLayout(totalPages, startSide, binding).spreads.map((s) => [
      s.left,
      s.right,
    ]);

  describe('우수(startSide=right) — 1페이지 단독 우측', () => {
    it('8p → [null,1],[2,3],[4,5],[6,7],[8,null]', () => {
      expect(pairs(8, 'right')).toEqual([
        [null, 1],
        [2, 3],
        [4, 5],
        [6, 7],
        [8, null],
      ]);
    });

    it('1p → [null,1]', () => {
      expect(pairs(1, 'right')).toEqual([[null, 1]]);
    });

    it('0p → [] (빈 레이아웃)', () => {
      expect(pairs(0, 'right')).toEqual([]);
    });

    it('홀수(7p) → 마지막 우측 빈면', () => {
      expect(pairs(7, 'right')).toEqual([
        [null, 1],
        [2, 3],
        [4, 5],
        [6, 7],
      ]);
    });
  });

  describe('좌수(startSide=left) — 1페이지부터 왼쪽 펼침', () => {
    it('8p → [1,2],[3,4],[5,6],[7,8]', () => {
      expect(pairs(8, 'left')).toEqual([
        [1, 2],
        [3, 4],
        [5, 6],
        [7, 8],
      ]);
    });

    it('1p → [1,null] (우측 빈면)', () => {
      expect(pairs(1, 'left')).toEqual([[1, null]]);
    });

    it('홀수(5p) → 마지막 우측 빈면', () => {
      expect(pairs(5, 'left')).toEqual([
        [1, 2],
        [3, 4],
        [5, null],
      ]);
    });

    it('0p → []', () => {
      expect(pairs(0, 'left')).toEqual([]);
    });
  });

  describe('seamlessFold (사철 힌트)', () => {
    it("binding='saddle' → seamlessFold=true", () => {
      expect(computeReaderSpreadLayout(8, 'right', 'saddle').seamlessFold).toBe(true);
    });

    it("binding='perfect' → seamlessFold=false", () => {
      expect(computeReaderSpreadLayout(8, 'right', 'perfect').seamlessFold).toBe(false);
    });

    it('임의 제본값 → seamlessFold=false', () => {
      expect(computeReaderSpreadLayout(8, 'right', 'spiral').seamlessFold).toBe(false);
    });
  });

  describe('반환 메타/방어적 입력 정규화', () => {
    it('startSide / totalPages 를 그대로 반영', () => {
      const layout = computeReaderSpreadLayout(4, 'left', 'perfect');
      expect(layout.startSide).toBe('left');
      expect(layout.totalPages).toBe(4);
    });

    it('index 가 0부터 연속', () => {
      const layout = computeReaderSpreadLayout(8, 'right', 'perfect');
      expect(layout.spreads.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
    });

    it('음수/NaN → 빈 레이아웃 + totalPages 정규화(0)', () => {
      const neg = computeReaderSpreadLayout(-3, 'right', 'perfect');
      expect(neg.spreads).toEqual([]);
      expect(neg.totalPages).toBe(0);

      const nan = computeReaderSpreadLayout(Number.NaN, 'left', 'saddle');
      expect(nan.spreads).toEqual([]);
      expect(nan.totalPages).toBe(0);
      // 입력 메타(startSide/seamlessFold)는 그대로 유지
      expect(nan.startSide).toBe('left');
      expect(nan.seamlessFold).toBe(true);
    });

    it('소수 페이지는 내림 처리(3.9 → 3)', () => {
      const layout = computeReaderSpreadLayout(3.9, 'left', 'perfect');
      expect(layout.totalPages).toBe(3);
      expect(layout.spreads.map((s) => [s.left, s.right])).toEqual([
        [1, 2],
        [3, null],
      ]);
    });
  });
});
