/**
 * 트랙 C G-1 — 표지 spread 방향 파생 순수 유틸 왕복 spec (2026-07-23).
 *
 * 잠그는 계약:
 *  1. 세로→가로→세로 왕복: 전 객체 중심 오차 <0.01px · 크기/각도/styles/z순서 불변 ·
 *     소속 면 보존 · workspace/clipPath 결정론 기하 · 입력 불변.
 *  2. B 임시조치(전체비율 근사)가 실패하는 형상(spine 30mm·wing 활성)에서 면 경계 정확.
 *  3. 게이트 skip 사유(flat-spread/flat-spine/inner/spec 없음).
 *  4. 레거시 잔재(spread-guide-* line·무id "N.Nmm" text) drop + reviewNotes 수집.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { CanvasData, FabricObject, SpreadConfig } from '@storige/types';
import { SPREAD_CONFIG_VERSION, computeSpreadDimensions } from '@storige/types';
import {
  evaluateSpreadDeriveGate,
  transformSpreadCanvasDataOrientation,
} from './spread-orientation-derive.util';

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '__fixtures__', 'canvasdata_cover_d765713a.json'),
    'utf-8',
  ),
) as { canvasData: CanvasData; spreadConfig: SpreadConfig; widthMm: number; heightMm: number };

/** 합성 픽스처 — B 전체비율 근사가 확실히 실패하는 형상: spine 30mm + wing 60mm */
function syntheticFixture(): { canvasData: CanvasData; spreadConfig: SpreadConfig } {
  const spec = {
    coverWidthMm: 214,
    coverHeightMm: 301,
    spineWidthMm: 30,
    wingEnabled: true,
    wingWidthMm: 60,
    cutSizeMm: 3,
    safeSizeMm: 3,
    dpi: 150,
  };
  const dims = computeSpreadDimensions(spec); // (60×2)+(214×2)+30 = 578 × 301
  const mm = (v: number) => (v / 25.4) * 150;
  const objAtContentCenter = (
    id: string,
    contentXmm: number,
    contentYmm: number,
    extra: Partial<FabricObject> = {},
  ): FabricObject => ({
    type: 'rect',
    id,
    originX: 'center',
    originY: 'center',
    left: mm(contentXmm) - mm(dims.totalWidthMm) / 2,
    top: mm(contentYmm) - mm(dims.totalHeightMm) / 2,
    width: 40,
    height: 40,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    ...extra,
  });
  return {
    canvasData: {
      version: '5.5.2',
      objects: [
        {
          type: 'rect',
          id: 'workspace',
          originX: 'center',
          originY: 'center',
          left: 0,
          top: 0,
          width: mm(dims.totalWidthMm + 6),
          height: mm(dims.totalHeightMm + 6),
          scaleX: 1,
          scaleY: 1,
          fill: 'rgba(184, 207, 255, 1)',
        },
        // 면별 대표 객체: 뒤날개/뒤표지/책등/앞표지/앞날개 중앙 부근
        objAtContentCenter('o-back-wing', 30, 150),
        objAtContentCenter('o-back-cover', 60 + 107, 150),
        objAtContentCenter('o-spine', 60 + 214 + 15, 40, { angle: 90 }),
        objAtContentCenter('o-front-cover', 60 + 214 + 30 + 107, 260),
        objAtContentCenter('o-front-wing', dims.totalWidthMm - 30, 150),
      ],
    } as unknown as CanvasData,
    spreadConfig: {
      version: 2,
      spec,
      regions: [],
      totalWidthMm: dims.totalWidthMm,
      totalHeightMm: dims.totalHeightMm,
    },
  };
}

const centerOf = (o: FabricObject) => ({ x: o.left as number, y: o.top as number }); // 픽스처 전부 center origin

describe('evaluateSpreadDeriveGate — v1 자동 변환 대상 판정', () => {
  const base = fixture.spreadConfig;
  it('spec 없음 → SPREAD_SPEC_MISSING', () => {
    expect(evaluateSpreadDeriveGate({ ...base, spec: undefined })).toEqual({
      ok: false,
      reason: 'SPREAD_SPEC_MISSING',
    });
    expect(evaluateSpreadDeriveGate(null)).toEqual({ ok: false, reason: 'SPREAD_SPEC_MISSING' });
  });
  it('inner scope → SPREAD_INNER_SCOPE', () => {
    expect(evaluateSpreadDeriveGate({ ...base, regionScope: 'inner' })).toEqual({
      ok: false,
      reason: 'SPREAD_INNER_SCOPE',
    });
  });
  it('flat-spread/flat-spine → 각 사유', () => {
    expect(evaluateSpreadDeriveGate({ ...base, conversionMode: 'flat-spread' })).toEqual({
      ok: false,
      reason: 'FLAT_SPREAD_UNSUPPORTED',
    });
    expect(evaluateSpreadDeriveGate({ ...base, conversionMode: 'flat-spine' })).toEqual({
      ok: false,
      reason: 'FLAT_SPINE_UNSUPPORTED',
    });
  });
  it('cover(미존재 포함)+full(미존재 포함) → ok (실픽스처 = v1·mode/scope 미존재)', () => {
    expect(evaluateSpreadDeriveGate(base)).toEqual({ ok: true });
  });
});

describe('transformSpreadCanvasDataOrientation — 실픽스처(d765713a, spine 1.2)', () => {
  const r1 = transformSpreadCanvasDataOrientation(fixture.canvasData, fixture.spreadConfig);

  it('파생 spec = coverW/H 스왑·spine/wing/cut 불변, 총치수 603.2×214', () => {
    expect(r1.spec).toMatchObject({
      coverWidthMm: 301,
      coverHeightMm: 214,
      spineWidthMm: 1.2,
      wingEnabled: false,
      cutSizeMm: 3,
    });
    expect(r1.widthMm).toBe(603.2);
    expect(r1.heightMm).toBe(214);
    expect(r1.spreadConfig.version).toBe(SPREAD_CONFIG_VERSION);
    expect(r1.spreadConfig.regions.map((rg) => rg.position)).toEqual([
      'back-cover',
      'spine',
      'front-cover',
    ]);
    expect(r1.spreadConfig.regions.map((rg) => rg.label)).toEqual(['뒷표지', '책등', '앞표지']);
  });

  it('레거시 잔재 drop: spread-guide 라인 2 + 치수 라벨 3 → reviewNotes 수집', () => {
    const kept = r1.canvasData.objects as FabricObject[];
    expect(kept.some((o) => typeof o.id === 'string' && o.id.startsWith('spread-guide-'))).toBe(false);
    expect(kept.some((o) => o.type === 'text' && /mm$/.test(String(o.text)))).toBe(false);
    expect(r1.reviewNotes.filter((n) => n.startsWith('DROPPED_LEGACY_GUIDE')).length).toBe(5);
    // 남는 것: workspace + 제목 + 저자명
    expect(kept.length).toBe(3);
  });

  it('workspace/clipPath 결정론 기하 — 파생 spec 총치수+사방 cut, 중앙 대칭', () => {
    const ws = (r1.canvasData.objects as FabricObject[]).find((o) => o.id === 'workspace') as FabricObject;
    const expectW = ((603.2 + 6) / 25.4) * 150;
    const expectH = ((214 + 6) / 25.4) * 150;
    expect(ws.width).toBeCloseTo(expectW, 6);
    expect(ws.height).toBeCloseTo(expectH, 6);
    expect(ws.left).toBe(0); // originX center
    expect(ws.scaleX).toBe(1);
    const clip = (r1.canvasData as unknown as { clipPath: FabricObject }).clipPath;
    expect(clip.width).toBeCloseTo(expectW, 6);
    expect(clip.height).toBeCloseTo(expectH, 6);
  });

  it('제목/저자명(앞표지) — 면 보존 + 크기/각도/scale 불변 + meta 갱신', () => {
    const texts = (r1.canvasData.objects as FabricObject[]).filter((o) => o.type === 'i-text');
    expect(texts.length).toBe(2);
    for (const t of texts) {
      const orig = (fixture.canvasData.objects as FabricObject[]).find((o) => o.id === t.id) as FabricObject;
      expect(t.width).toBe(orig.width);
      expect(t.scaleX).toBe(orig.scaleX);
      expect(t.angle).toBe(orig.angle);
      expect((t.meta as { regionRef: string }).regionRef).toBe('front-cover');
      // 앞표지 면 내 정규화 좌표 보존: 새 중심이 새 앞표지 범위(콘텐츠 302.2~603.2mm) 안
      const contentXmm = (((t.left as number) + ((603.2 / 25.4) * 150) / 2) * 25.4) / 150;
      expect(contentXmm).toBeGreaterThan(302.2);
      expect(contentXmm).toBeLessThan(603.2);
    }
  });

  it('왕복(세로→가로→세로): 중심 오차 <0.01px · 속성 불변 · 입력 불변', () => {
    const inputSnapshot = JSON.stringify(fixture.canvasData);
    const r2 = transformSpreadCanvasDataOrientation(r1.canvasData, r1.spreadConfig);
    expect(JSON.stringify(fixture.canvasData)).toBe(inputSnapshot); // 입력 불변

    const round1Kept = (r1.canvasData.objects as FabricObject[]).filter((o) => o.id !== 'workspace');
    const back = (r2.canvasData.objects as FabricObject[]).filter((o) => o.id !== 'workspace');
    expect(back.length).toBe(round1Kept.length);
    for (const o of back) {
      const orig = (fixture.canvasData.objects as FabricObject[]).find((s) => s.id === o.id) as FabricObject;
      expect(Math.abs((o.left as number) - (orig.left as number))).toBeLessThan(0.01);
      expect(Math.abs((o.top as number) - (orig.top as number))).toBeLessThan(0.01);
      expect(o.width).toBe(orig.width);
      expect(o.height).toBe(orig.height);
      expect(o.angle).toBe(orig.angle);
    }
    expect(r2.widthMm).toBe(429.2);
    expect(r2.heightMm).toBe(301);
  });
});

describe('합성 픽스처(spine 30·wing 60) — B 전체비율 근사가 실패하는 형상', () => {
  const syn = syntheticFixture();
  const r1 = transformSpreadCanvasDataOrientation(syn.canvasData, syn.spreadConfig);

  it('파생 총치수: (301×2)+30+120 = 752 × 214', () => {
    expect(r1.widthMm).toBe(752);
    expect(r1.heightMm).toBe(214);
    expect(r1.spreadConfig.regions.length).toBe(5);
  });

  it('전 객체 소속 면 보존(재분류 = 원 분류) — 면별 대표 5객체', () => {
    const byId = new Map((r1.canvasData.objects as FabricObject[]).map((o) => [o.id, o]));
    const expected: Record<string, string> = {
      'o-back-wing': 'back-wing',
      'o-back-cover': 'back-cover',
      'o-spine': 'spine',
      'o-front-cover': 'front-cover',
      'o-front-wing': 'front-wing',
    };
    for (const [id, face] of Object.entries(expected)) {
      const o = byId.get(id) as FabricObject;
      expect((o.meta as { regionRef: string }).regionRef).toBe(face);
    }
  });

  it('spine 객체: 폭 불변 면 내 위치 보존 — 새 spine 콘텐츠 범위(361~391mm) 안', () => {
    const o = (r1.canvasData.objects as FabricObject[]).find((s) => s.id === 'o-spine') as FabricObject;
    const contentXmm = (((o.left as number) + ((752 / 25.4) * 150) / 2) * 25.4) / 150;
    expect(contentXmm).toBeGreaterThan(361);
    expect(contentXmm).toBeLessThan(391);
    expect(o.angle).toBe(90); // 회전 보존
  });

  it('왕복 항등: 중심 오차 <0.01px', () => {
    const r2 = transformSpreadCanvasDataOrientation(r1.canvasData, r1.spreadConfig);
    for (const o of r2.canvasData.objects as FabricObject[]) {
      if (o.id === 'workspace') continue;
      const orig = (syn.canvasData.objects as FabricObject[]).find((s) => s.id === o.id) as FabricObject;
      expect(Math.abs((o.left as number) - (orig.left as number))).toBeLessThan(0.01);
      expect(Math.abs((o.top as number) - (orig.top as number))).toBeLessThan(0.01);
    }
  });
});
