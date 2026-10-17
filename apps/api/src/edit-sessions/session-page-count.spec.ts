/**
 * resolveSessionPageCount 우선순위 고정(2026-10-16, 낱장 N장 duplex-split 결함 수정).
 */
import { resolveSessionPageCount } from './session-page-count';

describe('resolveSessionPageCount', () => {
  it('① 배열 canvasData 3장 → 3', () => {
    expect(
      resolveSessionPageCount({
        metadata: null,
        canvasData: [{ objects: [] }, { objects: [] }, { objects: [] }],
      }),
    ).toBe(3);
  });

  it('② metadata.pages=4(숫자) + 단일 canvasData → 4', () => {
    expect(
      resolveSessionPageCount({ metadata: { pages: 4 }, canvasData: { objects: [] } }),
    ).toBe(4);
  });

  it('② 숫자 pages 가 0·음수·소수·NaN 이면 다음 분기로', () => {
    expect(resolveSessionPageCount({ metadata: { pages: 0 }, canvasData: { objects: [] } })).toBe(1);
    expect(resolveSessionPageCount({ metadata: { pages: -2 }, canvasData: null })).toBe(0);
    expect(resolveSessionPageCount({ metadata: { pages: 1.5 }, canvasData: null })).toBe(0);
    expect(resolveSessionPageCount({ metadata: { pages: Number.NaN }, canvasData: null })).toBe(0);
  });

  it('③ metadata.pages 객체 배열 2 → 2', () => {
    expect(
      resolveSessionPageCount({
        metadata: { pages: [{ sortOrder: 0 }, { sortOrder: 1 }] },
        canvasData: null,
      }),
    ).toBe(2);
  });

  it('④ legacy canvasData.pages 배열 → length', () => {
    expect(
      resolveSessionPageCount({ metadata: {}, canvasData: { pages: [{}, {}, {}, {}] } }),
    ).toBe(4);
  });

  it('⑤ 단일 fabric JSON {objects:[]} → 1', () => {
    expect(resolveSessionPageCount({ metadata: null, canvasData: { objects: [] } })).toBe(1);
  });

  it('⑥ 아무것도 없음 → 0', () => {
    expect(resolveSessionPageCount({ metadata: null, canvasData: null })).toBe(0);
    expect(resolveSessionPageCount({ metadata: {}, canvasData: undefined })).toBe(0);
    expect(resolveSessionPageCount({ metadata: { pages: '3' }, canvasData: {} })).toBe(0);
  });

  it('우선순위: 배열 canvasData 3 + metadata.pages 4 → 3', () => {
    expect(
      resolveSessionPageCount({
        metadata: { pages: 4 },
        canvasData: [{ objects: [] }, { objects: [] }, { objects: [] }],
      }),
    ).toBe(3);
  });
});
