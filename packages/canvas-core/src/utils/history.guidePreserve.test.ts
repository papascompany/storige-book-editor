// 히스토리 _loadHistory — 가이드 요소 보존 판정 회귀 테스트 (E1, 2026-07-15)
//
// 배경(Wave A0 정찰 신규 발견): `_historyNext` 스냅샷은 excludeFromExport/guideline
// 객체를 애초에 포함하지 않는데, `_loadHistory` 1단계(삭제 판정)의 가이드 보존 예외가
// id 3종(cut-border/safe-zone-border/cutline-template) 하드코딩뿐이라 **id 가 부여된
// 가이드**(RulerPlugin 의 center-guideline-h/v)가 첫 undo 에서 삭제되는 버그가 있었다.
// (RulerPlugin.ts 는 non-null 가드로 재생성도 하지 않아 센터 가이드가 조용히 사망)
//
// 수정: isGuideElement 판정에 `extensionType==='guideline' || excludeFromExport===true`
// 추가. 이 테스트는 "id 있는 guideline 객체가 undo(_loadHistory) 후 생존"을 고정한다.
//
// fabric 은 node 에서 native canvas 바인딩이 필요해 최소 mock — _loadHistory 는
// fabric.Canvas.prototype 에 부착되는 함수라 fake this 로 직접 호출 가능
// (history.meta.test.ts 와 동일 패턴).
import { describe, it, expect, vi } from 'vitest'

vi.mock('fabric', () => ({
  fabric: {
    Canvas: class MockCanvas {},
    util: {
      // 추가(enliven) 경로 — 본 테스트 시나리오에서는 추가 객체 0건이지만 안전하게 구현
      enlivenObjects: (objects: unknown[], callback: (enlivened: unknown[]) => void) => {
        callback(objects as unknown[])
      },
    },
  },
}))

// utils/canvas(core) 는 무거운 의존을 끌고 옴 → 필요한 것만 mock
vi.mock('./canvas', () => ({
  core: {
    extendFabricOption: ['id', 'meta'],
    ensureImageCrossOrigin: (objects: unknown[]) => objects,
  },
}))

import { fabric } from 'fabric'
import './history' // fabric.Canvas.prototype 패치 부착

interface FakeObject {
  id: string
  type?: string
  extensionType?: string
  excludeFromExport?: boolean
  set: (props: unknown) => void
  setCoords: () => void
}

function makeFakeObject(partial: Partial<FakeObject> & { id: string }): FakeObject {
  return {
    type: 'rect',
    set: vi.fn(),
    setCoords: vi.fn(),
    ...partial,
  }
}

/** _loadHistory 가 사용하는 최소 캔버스 표면 */
function makeFakeCanvas(objects: FakeObject[]) {
  const removed: FakeObject[] = []
  const canvas = {
    _guideElements: [] as string[],
    _svgElements: {} as Record<string, unknown>,
    historyProcessing: true,
    getObjects: () => objects,
    remove: (...objs: FakeObject[]) => {
      objs.forEach((o) => {
        removed.push(o)
        const idx = objects.indexOf(o)
        if (idx >= 0) objects.splice(idx, 1)
      })
    },
    renderAll: vi.fn(),
    fire: vi.fn(),
  }
  return { canvas, removed }
}

function loadHistory(canvas: unknown, snapshot: unknown): void {
  ;(fabric.Canvas.prototype as unknown as {
    _loadHistory: (h: string, e: string, cb?: () => void) => void
  })._loadHistory.call(canvas, JSON.stringify(snapshot), 'history:undo')
}

describe('history._loadHistory — 가이드 보존 판정 (id 있는 guideline 생존)', () => {
  it('extensionType=guideline + id 객체는 스냅샷에 없어도 undo 에서 삭제되지 않는다 (center-guideline 버그 회귀)', () => {
    const centerGuideH = makeFakeObject({
      id: 'center-guideline-h',
      type: 'GuideLine',
      extensionType: 'guideline',
      excludeFromExport: true,
    })
    const centerGuideV = makeFakeObject({
      id: 'center-guideline-v',
      type: 'GuideLine',
      extensionType: 'guideline',
      excludeFromExport: true,
    })
    const userRect = makeFakeObject({ id: 'r1' })
    const objects = [centerGuideH, centerGuideV, userRect]
    const { canvas, removed } = makeFakeCanvas(objects)

    // 스냅샷: 사용자 객체만 존재 (가이드는 _historyNext 필터로 원래 미포함)
    loadHistory(canvas, {
      objects: [{ id: 'r1', type: 'rect', left: 10, top: 20 }],
      _guideElements: [],
    })

    expect(removed).not.toContain(centerGuideH)
    expect(removed).not.toContain(centerGuideV)
    expect(objects).toContain(centerGuideH)
    expect(objects).toContain(centerGuideV)
    // 사용자 객체는 update 경로로 생존 + set 호출
    expect(objects).toContain(userRect)
    expect(userRect.set).toHaveBeenCalled()
  })

  it('excludeFromExport=true (extensionType 없음) 객체도 삭제 대상에서 제외된다', () => {
    const overlay = makeFakeObject({ id: 'temp-overlay-1', excludeFromExport: true })
    const objects = [overlay]
    const { canvas, removed } = makeFakeCanvas(objects)

    loadHistory(canvas, { objects: [], _guideElements: [] })

    expect(removed).toHaveLength(0)
    expect(objects).toContain(overlay)
  })

  it('일반 사용자 객체(비가이드)는 스냅샷에 없으면 여전히 삭제된다 — 기존 undo 시맨틱 불변', () => {
    const staleRect = makeFakeObject({ id: 'r-stale' })
    const keptRect = makeFakeObject({ id: 'r-kept' })
    const objects = [staleRect, keptRect]
    const { canvas, removed } = makeFakeCanvas(objects)

    loadHistory(canvas, {
      objects: [{ id: 'r-kept', type: 'rect', left: 0, top: 0 }],
      _guideElements: [],
    })

    expect(removed).toContain(staleRect)
    expect(objects).not.toContain(staleRect)
    expect(objects).toContain(keptRect)
  })

  it('기존 id 하드코딩 3종(cut-border 등) 보존 동작 불변', () => {
    const cutBorder = makeFakeObject({ id: 'cut-border' })
    const safeZone = makeFakeObject({ id: 'safe-zone-border' })
    const objects = [cutBorder, safeZone]
    const { canvas, removed } = makeFakeCanvas(objects)

    loadHistory(canvas, { objects: [], _guideElements: [] })

    expect(removed).toHaveLength(0)
    expect(objects).toEqual([cutBorder, safeZone])
  })
})
