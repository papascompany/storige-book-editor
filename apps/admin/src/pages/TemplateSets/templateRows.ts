/**
 * 템플릿셋 폼의 템플릿 목록 행 연산 — 순수 함수(React·antd 의존 없음).
 *
 * 한 세트가 같은 템플릿을 여러 번 연결할 수 있다(예: 같은 디자인을 반복하는 캘린더 세트).
 * 그래서 행을 templateId 로 구분하면 React key·정렬 id 가 겹치고, 한 행을 지우거나 필수 여부를
 * 바꿀 때 같은 템플릿의 다른 행까지 함께 바뀐다. 행마다 화면 전용 rowKey 를 붙여 그것으로 구분한다.
 * rowKey 는 저장하지 않는다.
 */

export interface KeyedRow {
  rowKey: string;
}

/** 호출할 때마다 겹치지 않는 rowKey 를 돌려주는 함수를 만든다. */
export function createRowKeyFactory(prefix = 'row'): () => string {
  let seq = 0;
  return () => {
    seq += 1;
    return `${prefix}-${seq}`;
  };
}

/** rowKey 가 같은 행 하나만 뺀다. 없으면 원래 배열을 그대로 돌려준다. */
export function removeRowByKey<T extends KeyedRow>(rows: T[], rowKey: string): T[] {
  const index = rows.findIndex((row) => row.rowKey === rowKey);
  if (index < 0) {
    return rows;
  }
  return [...rows.slice(0, index), ...rows.slice(index + 1)];
}

/** rowKey 가 같은 행 하나의 required 만 뒤집는다. */
export function toggleRequiredByKey<T extends KeyedRow & { required: boolean }>(rows: T[], rowKey: string): T[] {
  return rows.map((row) => (row.rowKey === rowKey ? { ...row, required: !row.required } : row));
}

/** activeKey 행을 overKey 행의 자리로 옮긴다. 둘 중 하나라도 없거나 같으면 원래 배열을 그대로 돌려준다. */
export function moveRowByKey<T extends KeyedRow>(rows: T[], activeKey: string, overKey: string): T[] {
  const from = rows.findIndex((row) => row.rowKey === activeKey);
  const to = rows.findIndex((row) => row.rowKey === overKey);
  if (from < 0 || to < 0 || from === to) {
    return rows;
  }
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
