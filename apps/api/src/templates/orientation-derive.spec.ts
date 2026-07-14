/**
 * orientation-derive.util 순수 변환 spec (2026-07-14).
 *
 * 픽스처: __fixtures__/canvasdata_ma348.json — MA-348 실프로덕션 canvasData 덤프
 * (430×297mm spread, 중앙원점 px@150dpi, workspace rect + styles 보유 textbox 포함).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { CanvasData, FabricObject } from '@storige/types';
import {
  ORIENTATION_MM_TOLERANCE,
  nearlyEqualMm,
  isNearlySquare,
  isExactOrientationSwap,
  orientationNameSuffix,
  withOrientationSuffix,
  transformCanvasDataOrientation,
  REGENERATED_GUIDE_IDS,
  WORKSPACE_OBJECT_ID,
} from './orientation-derive.util';

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'canvasdata_ma348.json');

function loadFixture(): CanvasData {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as CanvasData;
}

describe('orientation-derive.util — mm 비교 헬퍼 (admin ±0.01mm 시맨틱)', () => {
  it('nearlyEqualMm: ±0.01mm 이내 동일 판정', () => {
    expect(ORIENTATION_MM_TOLERANCE).toBe(0.01);
    expect(nearlyEqualMm(210, 210.01)).toBe(true);
    expect(nearlyEqualMm(210, 210.011)).toBe(false);
  });

  it('isNearlySquare: 정사각(±0.01mm) 판정', () => {
    expect(isNearlySquare(210, 210)).toBe(true);
    expect(isNearlySquare(210, 210.005)).toBe(true);
    expect(isNearlySquare(210, 297)).toBe(false);
  });

  it('isExactOrientationSwap: 정확 W↔H 스왑만 성립', () => {
    expect(isExactOrientationSwap(210, 297, 297, 210)).toBe(true);
    expect(isExactOrientationSwap(210, 297, 297.01, 209.99)).toBe(true); // 허용오차 내
    expect(isExactOrientationSwap(210, 297, 297.02, 210)).toBe(false);
    expect(isExactOrientationSwap(210, 297, 210, 297)).toBe(false); // 동일 방향은 스왑 아님
  });

  it('orientationNameSuffix / withOrientationSuffix: 접미 부착 + 중첩 방지', () => {
    expect(orientationNameSuffix(297, 210)).toBe(' (가로)');
    expect(orientationNameSuffix(210, 297)).toBe(' (세로)');
    expect(withOrientationSuffix('A4 세트', ' (가로)')).toBe('A4 세트 (가로)');
    expect(withOrientationSuffix('A4 세트 (세로)', ' (가로)')).toBe('A4 세트 (가로)');
    expect(withOrientationSuffix('A4 세트 (가로)', ' (세로)')).toBe('A4 세트 (세로)');
  });
});

describe('transformCanvasDataOrientation', () => {
  // (a) A4 세로→가로 — 중앙원점 상대 위치 보존 (수치 단언)
  it('(a) A4 세로→가로: 위치만 축별 비율 재배치, 크기·회전·스케일 보존 + 상대 위치 불변', () => {
    const input: CanvasData = {
      version: '5.3.0',
      width: 210,
      height: 297,
      objects: [
        {
          type: 'rect',
          id: 'workspace',
          left: 0,
          top: 0,
          width: 1275.59,
          height: 1789.37,
          scaleX: 1,
          scaleY: 1,
          originX: 'center',
          originY: 'center',
        },
        {
          type: 'textbox',
          id: 'obj-1',
          left: 100,
          top: -50,
          width: 200,
          height: 80,
          scaleX: 2,
          scaleY: 1.5,
          angle: 15,
        },
      ],
    };

    const out = transformCanvasDataOrientation(input, {
      oldWmm: 210,
      oldHmm: 297,
      newWmm: 297,
      newHmm: 210,
    });

    // top-level mm 스왑 기록 (loadJSON 치수 오염 함정 규약)
    expect(out.width).toBe(297);
    expect(out.height).toBe(210);

    const obj = out.objects[1];
    // 위치: left×(297/210), top×(210/297)
    expect(obj.left).toBeCloseTo(100 * (297 / 210), 10); // 141.42857142857142
    expect(obj.top).toBeCloseTo(-50 * (210 / 297), 10); // -35.35353535353536
    // 중앙원점 상대 위치 보존: newLeft/newW == oldLeft/oldW (축별)
    expect((obj.left as number) / 297).toBeCloseTo(100 / 210, 10);
    expect((obj.top as number) / 210).toBeCloseTo(-50 / 297, 10);
    // 크기·스케일·회전 보존
    expect(obj.width).toBe(200);
    expect(obj.height).toBe(80);
    expect(obj.scaleX).toBe(2);
    expect(obj.scaleY).toBe(1.5);
    expect(obj.angle).toBe(15);
  });

  it('(a-보강) 잠금류·requiredEdit·id·z순서 보존', () => {
    const input: CanvasData = {
      version: '5.3.0',
      width: 210,
      height: 297,
      objects: [
        { type: 'rect', id: 'a', left: 10, top: 10, lockMovementX: true, isLocked: true },
        { type: 'textbox', id: 'b', left: 20, top: 20, requiredEdit: true },
        { type: 'image', id: 'c', left: 30, top: 30 },
      ],
    };

    const out = transformCanvasDataOrientation(input, {
      oldWmm: 210,
      oldHmm: 297,
      newWmm: 297,
      newHmm: 210,
    });

    expect(out.objects.map((o) => o.id)).toEqual(['a', 'b', 'c']); // z순서(배열 순서)
    expect(out.objects[0].lockMovementX).toBe(true);
    expect(out.objects[0].isLocked).toBe(true);
    expect(out.objects[1].requiredEdit).toBe(true);
  });

  // (b) styles 키 보존 — 픽스처 실데이터 (fabric styles 직렬화 함정)
  it('(b) 픽스처 textbox 의 styles 키가 원형 그대로 보존된다 + 입력 불변', () => {
    const fixture = loadFixture();
    const fixtureSnapshot = JSON.parse(JSON.stringify(fixture)) as CanvasData;

    const styledIndexes = fixture.objects
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => o.type === 'textbox' && typeof o.styles === 'object')
      .map(({ i }) => i);
    expect(styledIndexes.length).toBeGreaterThan(0); // 픽스처 전제 확인

    const out = transformCanvasDataOrientation(fixture, {
      oldWmm: 430,
      oldHmm: 297,
      newWmm: 297,
      newHmm: 430,
    });

    for (const i of styledIndexes) {
      expect(out.objects[i].styles).toEqual(fixtureSnapshot.objects[i].styles);
    }
    // 순수성: 입력 canvasData 는 변형되지 않는다
    expect(fixture).toEqual(fixtureSnapshot);
  });

  // (c) workspace 계열 방침 — 근거는 orientation-derive.util.ts 헤더 주석
  it('(c-1) workspace: drop 하지 않고 유효 치수를 W↔H 스왑한다 (픽스처 실측)', () => {
    const fixture = loadFixture();
    const wsBefore = fixture.objects.find((o) => o.id === WORKSPACE_OBJECT_ID);
    expect(wsBefore).toBeDefined();
    // 픽스처 실측: 2557.0866 × 1771.6535 px (433×300mm 작업영역 @150dpi)
    expect(wsBefore?.width).toBeCloseTo(2557.0866, 4);
    expect(wsBefore?.height).toBeCloseTo(1771.6535, 4);

    const out = transformCanvasDataOrientation(fixture, {
      oldWmm: 430,
      oldHmm: 297,
      newWmm: 297,
      newHmm: 430,
    });

    const wsAfter = out.objects.find((o) => o.id === WORKSPACE_OBJECT_ID);
    expect(wsAfter).toBeDefined();
    // 정확 스왑 → 유효 치수 교환(대칭 블리드 보존), scale 1 정규화
    expect(wsAfter?.width).toBeCloseTo(1771.6535, 4);
    expect(wsAfter?.height).toBeCloseTo(2557.0866, 4);
    expect(wsAfter?.scaleX).toBe(1);
    expect(wsAfter?.scaleY).toBe(1);
    // 중앙원점(0,0) 위치 불변
    expect(wsAfter?.left).toBe(0);
    expect(wsAfter?.top).toBe(0);
  });

  it('(c-2) 재생성 가이드(excludeFromExport 잔재)는 drop, 일반 객체는 유지', () => {
    const guideObjects: FabricObject[] = REGENERATED_GUIDE_IDS.map((id) => ({
      type: 'path',
      id,
      left: 0,
      top: 0,
    }));
    const input: CanvasData = {
      version: '5.3.0',
      width: 210,
      height: 297,
      objects: [
        { type: 'rect', id: 'workspace', left: 0, top: 0, width: 100, height: 200 },
        ...guideObjects,
        { type: 'textbox', id: 'content', left: 5, top: 5 },
      ],
    };

    const out = transformCanvasDataOrientation(input, {
      oldWmm: 210,
      oldHmm: 297,
      newWmm: 297,
      newHmm: 210,
    });

    expect(out.objects.map((o) => o.id)).toEqual(['workspace', 'content']);
    // 가이드 5종 전부 drop 되었는지 개별 확인
    for (const id of REGENERATED_GUIDE_IDS) {
      expect(out.objects.some((o) => o.id === id)).toBe(false);
    }
  });

  // (d) 왕복 오차 <0.01px — 픽스처 전 객체
  it('(d) 왕복(세로→가로→세로) 시 전 객체 위치 오차 <0.01px, 치수 복원', () => {
    const fixture = loadFixture();
    const once = transformCanvasDataOrientation(fixture, {
      oldWmm: 430,
      oldHmm: 297,
      newWmm: 297,
      newHmm: 430,
    });
    const roundTrip = transformCanvasDataOrientation(once, {
      oldWmm: 297,
      oldHmm: 430,
      newWmm: 430,
      newHmm: 297,
    });

    expect(roundTrip.width).toBe(430);
    expect(roundTrip.height).toBe(297);
    expect(roundTrip.objects).toHaveLength(fixture.objects.length);

    for (let i = 0; i < fixture.objects.length; i++) {
      const orig = fixture.objects[i];
      const back = roundTrip.objects[i];
      expect(back.id).toBe(orig.id);
      if (typeof orig.left === 'number') {
        expect(Math.abs((back.left as number) - orig.left)).toBeLessThan(0.01);
      }
      if (typeof orig.top === 'number') {
        expect(Math.abs((back.top as number) - orig.top)).toBeLessThan(0.01);
      }
      // workspace 는 유효 치수 기준으로 복원 (정확 스왑 2회 = 원복)
      if (orig.id === WORKSPACE_OBJECT_ID) {
        const origScaleX = typeof orig.scaleX === 'number' ? orig.scaleX : 1;
        const origScaleY = typeof orig.scaleY === 'number' ? orig.scaleY : 1;
        const origEffW = (orig.width as number) * origScaleX;
        const origEffH = (orig.height as number) * origScaleY;
        expect((back.width as number) * (back.scaleX as number)).toBeCloseTo(origEffW, 6);
        expect((back.height as number) * (back.scaleY as number)).toBeCloseTo(origEffH, 6);
      } else {
        // 일반 객체 크기/각도는 어느 방향에서도 불변
        expect(back.width).toEqual(orig.width);
        expect(back.height).toEqual(orig.height);
        expect(back.angle).toEqual(orig.angle);
      }
    }
  });

  it('판형 파라미터가 0/음수/비유한수면 throw', () => {
    const input: CanvasData = { version: '5.3.0', width: 210, height: 297, objects: [] };
    expect(() =>
      transformCanvasDataOrientation(input, { oldWmm: 0, oldHmm: 297, newWmm: 297, newHmm: 210 }),
    ).toThrow();
    expect(() =>
      transformCanvasDataOrientation(input, { oldWmm: 210, oldHmm: -1, newWmm: 297, newHmm: 210 }),
    ).toThrow();
    expect(() =>
      transformCanvasDataOrientation(input, { oldWmm: 210, oldHmm: 297, newWmm: NaN, newHmm: 210 }),
    ).toThrow();
  });
});
