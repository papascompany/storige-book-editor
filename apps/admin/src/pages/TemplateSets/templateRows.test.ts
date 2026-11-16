import { describe, expect, it } from 'vitest';
import { createRowKeyFactory, moveRowByKey, removeRowByKey, toggleRequiredByKey } from './templateRows';

interface Row {
  rowKey: string;
  templateId: string;
  required: boolean;
}

// 같은 템플릿(t1)을 세 번 연결한 세트
const rows = (): Row[] => [
  { rowKey: 'row-1', templateId: 't1', required: false },
  { rowKey: 'row-2', templateId: 't2', required: true },
  { rowKey: 'row-3', templateId: 't1', required: false },
  { rowKey: 'row-4', templateId: 't1', required: false },
];
const keys = (list: Row[]) => list.map((r) => r.rowKey);

describe('createRowKeyFactory', () => {
  it('호출마다 다른 키를 만들고, 공장끼리는 서로 영향을 주지 않는다', () => {
    const next = createRowKeyFactory();
    const made = [next(), next(), next()];
    expect(new Set(made).size).toBe(3);
    expect(createRowKeyFactory()()).toBe(made[0]);
  });
});

describe('removeRowByKey', () => {
  it('같은 템플릿이 여러 번 있어도 고른 행 하나만 뺀다', () => {
    const result = removeRowByKey(rows(), 'row-3');
    expect(keys(result)).toEqual(['row-1', 'row-2', 'row-4']);
    expect(result.filter((r) => r.templateId === 't1')).toHaveLength(2);
  });

  it('없는 키면 원래 배열을 그대로 돌려준다', () => {
    const input = rows();
    expect(removeRowByKey(input, 'row-9')).toBe(input);
  });
});

describe('toggleRequiredByKey', () => {
  it('고른 행 하나의 필수 여부만 바꾼다', () => {
    const result = toggleRequiredByKey(rows(), 'row-1');
    expect(result.map((r) => r.required)).toEqual([true, true, false, false]);
  });

  it('입력 배열과 행을 바꾸지 않는다', () => {
    const input = rows();
    toggleRequiredByKey(input, 'row-1');
    expect(input[0].required).toBe(false);
  });
});

describe('moveRowByKey', () => {
  it('같은 템플릿끼리도 고른 행을 고른 자리로 옮긴다', () => {
    expect(keys(moveRowByKey(rows(), 'row-4', 'row-1'))).toEqual(['row-4', 'row-1', 'row-2', 'row-3']);
    expect(keys(moveRowByKey(rows(), 'row-1', 'row-3'))).toEqual(['row-2', 'row-3', 'row-1', 'row-4']);
  });

  it('같은 자리이거나 없는 키면 원래 배열을 그대로 돌려준다', () => {
    const input = rows();
    expect(moveRowByKey(input, 'row-2', 'row-2')).toBe(input);
    expect(moveRowByKey(input, 'row-9', 'row-1')).toBe(input);
    expect(moveRowByKey(input, 'row-1', 'row-9')).toBe(input);
  });
});
