// 히스토리 경량상태(lightState) — spread meta(regionRef/anchor) 보존 회귀 테스트.
//
// 배경(라이브 P1, 2026-06-11/12): `_historyNext` 는 성능을 위해 하드코딩 화이트리스트로
// 객체를 경량 직렬화하는데 `meta` 가 누락되어 있었다. undo/redo 시 삭제→복원되는 객체는
// `_loadHistory` 의 enliven 재추가 경로를 타며 meta(regionRef/anchor) 가 통째로 소실 →
// 편집기 useSpreadAutoAnchor(object:added) 가 meta 없는 객체로 보고 재앵커를 시도,
// (당시 viewport bbox 결함과 결합해) front 객체가 back-cover 로 오염되는 연쇄의 한 축.
//
// fabric 은 node 에서 native canvas 바인딩이 필요해 최소 mock — _historyNext 는
// fabric.Canvas.prototype 에 부착되는 순수 직렬화 함수라 fake this 로 직접 호출 가능.
import { describe, it, expect, vi } from 'vitest'

vi.mock('fabric', () => ({
  fabric: {
    Canvas: class MockCanvas {},
    util: {},
  },
}))

// utils/canvas(core) 는 ImageProcessingPlugin 등 무거운 의존을 끌고 옴 → extendFabricOption 만 mock
vi.mock('./canvas', () => ({
  core: { extendFabricOption: ['id', 'meta'] },
}))

import { fabric } from 'fabric'
import './history' // fabric.Canvas.prototype 패치 부착

describe('history._historyNext — meta(regionRef/anchor) 직렬화 보존', () => {
  it('lightState 에 meta 가 포함된다 (undo 재추가 시 spread 재배치 메타 보존)', () => {
    const textbox = {
      id: 'idml-u715',
      type: 'textbox',
      left: 365.4,
      top: -733.5,
      width: 400,
      height: 80,
      text: '도서 제목',
      meta: {
        regionRef: 'front-cover',
        anchor: { kind: 'region', xNorm: 0.2708, yNorm: 0.0818 },
      },
    }
    const fakeCanvas = {
      getObjects: () => [textbox],
      _guideElements: [],
    }

    const json = (fabric.Canvas.prototype as any)._historyNext.call(fakeCanvas)
    const state = JSON.parse(json)

    expect(state.objects).toHaveLength(1)
    expect(state.objects[0].id).toBe('idml-u715')
    // 핵심 회귀 고정: meta 누락 시 undo 복원 객체가 regionRef/anchor 를 잃는다
    expect(state.objects[0].meta).toEqual({
      regionRef: 'front-cover',
      anchor: { kind: 'region', xNorm: 0.2708, yNorm: 0.0818 },
    })
  })

  it('meta 없는 객체는 meta 키가 undefined (JSON 직렬화에서 자연 생략) — 기존 동작 불변', () => {
    const rect = {
      id: 'r1',
      type: 'rect',
      left: 0,
      top: 0,
      width: 10,
      height: 10,
    }
    const fakeCanvas = { getObjects: () => [rect], _guideElements: [] }
    const json = (fabric.Canvas.prototype as any)._historyNext.call(fakeCanvas)
    const state = JSON.parse(json)
    expect(state.objects[0].meta).toBeUndefined()
  })
})
