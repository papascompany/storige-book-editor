/**
 * resolvePrintGeometry 단위 테스트 — Node 내장 러너(node:test) + TypeScript type stripping(Node >= 24).
 *
 * 실행: node --test packages/types/src/print-geometry.test.mjs
 * (@storige/types 에는 테스트 러너 의존성이 없어 소스 .ts 를 직접 import 한다.
 *  .mjs 라 tsc 빌드·dist 산출물에는 포함되지 않는다.)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePrintGeometry } from './print-geometry.ts';

const A4 = { width: 210, height: 297 };

describe('resolvePrintGeometry — 도련 게이트(cropMarkEnabled × bleedMm)', () => {
  it('재단선 ON + bleed 3: 유효 도련 3, 작업 216×303, 마커, cutSizeMm 6', () => {
    assert.deepEqual(resolvePrintGeometry({ ...A4, cropMarkEnabled: true, bleedMm: 3 }), {
      trimMm: { w: 210, h: 297 },
      bleedMm: 3,
      workMm: { w: 216, h: 303 },
      cropMarks: true,
      coverSpreadCutSizeMm: 6,
    });
  });

  it('재단선 ON + bleed 0: 유효 도련 0, 작업 = 재단, 마커 없음, cutSizeMm 2', () => {
    assert.deepEqual(resolvePrintGeometry({ ...A4, cropMarkEnabled: true, bleedMm: 0 }), {
      trimMm: { w: 210, h: 297 },
      bleedMm: 0,
      workMm: { w: 210, h: 297 },
      cropMarks: false,
      coverSpreadCutSizeMm: 2,
    });
  });

  it('재단선 OFF + bleed 3: 세트 bleedMm 이 있어도 유효 도련 0, cutSizeMm 2', () => {
    assert.deepEqual(resolvePrintGeometry({ ...A4, cropMarkEnabled: false, bleedMm: 3 }), {
      trimMm: { w: 210, h: 297 },
      bleedMm: 0,
      workMm: { w: 210, h: 297 },
      cropMarks: false,
      coverSpreadCutSizeMm: 2,
    });
  });

  it('재단선 OFF + bleed 0: 유효 도련 0, cutSizeMm 2', () => {
    assert.deepEqual(resolvePrintGeometry({ ...A4, cropMarkEnabled: false, bleedMm: 0 }), {
      trimMm: { w: 210, h: 297 },
      bleedMm: 0,
      workMm: { w: 210, h: 297 },
      cropMarks: false,
      coverSpreadCutSizeMm: 2,
    });
  });

  it('재단선 ON + bleed 1: 작업 212×299, cutSizeMm 2(변당 1)', () => {
    assert.deepEqual(resolvePrintGeometry({ ...A4, cropMarkEnabled: true, bleedMm: 1 }), {
      trimMm: { w: 210, h: 297 },
      bleedMm: 1,
      workMm: { w: 212, h: 299 },
      cropMarks: true,
      coverSpreadCutSizeMm: 2,
    });
  });

  it('재단선 ON + bleed 5: 작업 220×307, cutSizeMm 10(변당 5)', () => {
    assert.deepEqual(resolvePrintGeometry({ ...A4, cropMarkEnabled: true, bleedMm: 5 }), {
      trimMm: { w: 210, h: 297 },
      bleedMm: 5,
      workMm: { w: 220, h: 307 },
      cropMarks: true,
      coverSpreadCutSizeMm: 10,
    });
  });

  it('재단선 ON + bleed 0.5: 작업 211×298, cutSizeMm 1', () => {
    const g = resolvePrintGeometry({ ...A4, cropMarkEnabled: true, bleedMm: 0.5 });
    assert.deepEqual(g.workMm, { w: 211, h: 298 });
    assert.equal(g.coverSpreadCutSizeMm, 1);
  });

  it('재단선 OFF + bleed 1·5: 유효 도련 0, cutSizeMm 2', () => {
    for (const bleedMm of [1, 5]) {
      const g = resolvePrintGeometry({ ...A4, cropMarkEnabled: false, bleedMm });
      assert.equal(g.bleedMm, 0);
      assert.deepEqual(g.workMm, { w: 210, h: 297 });
      assert.equal(g.cropMarks, false);
      assert.equal(g.coverSpreadCutSizeMm, 2);
    }
  });

  it('필드 누락·null: 게이트 OFF 로 본다', () => {
    for (const input of [
      { ...A4 },
      { ...A4, cropMarkEnabled: null, bleedMm: 3 },
      { ...A4, cropMarkEnabled: true, bleedMm: null },
      { ...A4, cropMarkEnabled: true },
    ]) {
      const g = resolvePrintGeometry(input);
      assert.equal(g.bleedMm, 0);
      assert.deepEqual(g.workMm, { w: 210, h: 297 });
      assert.equal(g.cropMarks, false);
      assert.equal(g.coverSpreadCutSizeMm, 2);
    }
  });

  it('음수·NaN bleed: 게이트 OFF', () => {
    for (const bleedMm of [-3, Number.NaN]) {
      const g = resolvePrintGeometry({ ...A4, cropMarkEnabled: true, bleedMm });
      assert.equal(g.bleedMm, 0);
      assert.equal(g.cropMarks, false);
      assert.equal(g.coverSpreadCutSizeMm, 2);
    }
  });

  it('재단 크기는 입력 width×height 그대로(정사각·가로형)', () => {
    const g = resolvePrintGeometry({ width: 300, height: 150, cropMarkEnabled: true, bleedMm: 3 });
    assert.deepEqual(g.trimMm, { w: 300, h: 150 });
    assert.deepEqual(g.workMm, { w: 306, h: 156 });
  });
});

/**
 * 편집기 PDF 페이지 기하(canvas-core plugins/pdfPageGeometry.test.ts)의 기준 산식 중
 * 템플릿셋 규격에 해당하는 부분(봉투 아님·wrap 없음)을 그대로 옮긴 것. 렌더 크기 = 작업 크기.
 */
function editorRenderSize(contentWidth, contentHeight, size) {
  const bleedMm = size.bleedMm ?? 0;
  const useEditSize = !!size.cropMarkEnabled && bleedMm > 0;
  return {
    renderWidth: useEditSize ? contentWidth + bleedMm * 2 : contentWidth,
    renderHeight: useEditSize ? contentHeight + bleedMm * 2 : contentHeight,
    useEditSize,
    bleedMm: useEditSize ? bleedMm : 0,
  };
}

describe('resolvePrintGeometry — 편집기 PDF 기하 기존 케이스 대조', () => {
  // pdfPageGeometry.test.ts legacyCases 중 봉투가 아닌 케이스의 규격 입력(printSize 는 세트 규격이 아니라 제외).
  const cases = [
    { name: 'plain', size: { bleedMm: undefined, cropMarkEnabled: undefined }, work: { w: 210, h: 297 } },
    { name: 'printSize', size: { bleedMm: undefined, cropMarkEnabled: undefined }, work: { w: 210, h: 297 } },
    { name: '게이트 ON', size: { bleedMm: 3, cropMarkEnabled: true }, work: { w: 216, h: 303 } },
    { name: '게이트 ON + printSize', size: { bleedMm: 3, cropMarkEnabled: true }, work: { w: 216, h: 303 } },
    { name: 'cropMark 만', size: { bleedMm: undefined, cropMarkEnabled: true }, work: { w: 210, h: 297 } },
    { name: 'bleed 만', size: { bleedMm: 3, cropMarkEnabled: undefined }, work: { w: 210, h: 297 } },
  ];

  for (const { name, size, work } of cases) {
    it(`${name}: 재단 210×297, 작업 ${work.w}×${work.h} — 편집기 렌더 크기와 같다`, () => {
      const g = resolvePrintGeometry({ ...A4, ...size });
      const editor = editorRenderSize(210, 297, size);
      assert.deepEqual(g.trimMm, { w: 210, h: 297 });
      assert.deepEqual(g.workMm, work);
      assert.deepEqual(g.workMm, { w: editor.renderWidth, h: editor.renderHeight });
      assert.equal(g.cropMarks, editor.useEditSize);
      assert.equal(g.bleedMm, editor.bleedMm);
    });
  }
});
