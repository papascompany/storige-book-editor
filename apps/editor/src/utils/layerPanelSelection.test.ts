import { describe, it, expect, vi } from 'vitest'
// 재현 테스트는 **실제 fabric 5.5.2** 동작이 근거여야 하므로 전역 mock(test/setup.ts) 해제
vi.unmock('fabric')
import { fabric } from 'fabric'
import {
  isMultiSelectableInLayerPanel,
  buildNextMultiSelection,
  layerStepReorderArgs,
  type MultiSelectCandidate,
} from './layerPanelSelection'

// fabric 5.5.2 controlsUtils 는 @types/fabric 에 없음 — 재현 테스트용 최소 시그니처 캐스트
const controlsUtils = (
  fabric as unknown as {
    controlsUtils: {
      dragHandler: (e: unknown, transform: unknown, x: number, y: number) => boolean
    }
  }
).controlsUtils

describe('A1-2 선행 재현: fabric 5.5.2 ActiveSelection 드래그의 자식 lockMovement 존중 여부', () => {
  it('대조군 — 단일 객체 드래그는 자신의 lockMovementX/Y 를 존중한다', () => {
    const rect = new fabric.Rect({
      left: 0,
      top: 0,
      width: 10,
      height: 10,
      lockMovementX: true,
      lockMovementY: true,
    })
    const moved = controlsUtils.dragHandler({}, { target: rect, offsetX: 0, offsetY: 0 }, 30, 40)
    expect(moved).toBe(false)
    expect(rect.left).toBe(0)
    expect(rect.top).toBe(0)
  })

  it('재현 — ActiveSelection 드래그는 자식 lockMovementX/Y 를 존중하지 않는다(제외 가드 필요)', () => {
    const locked = new fabric.Rect({
      left: 0,
      top: 0,
      width: 10,
      height: 10,
      lockMovementX: true,
      lockMovementY: true,
    })
    const free = new fabric.Rect({ left: 100, top: 100, width: 10, height: 10 })
    const selection = new fabric.ActiveSelection([locked, free])

    // dragHandler 는 transform.target(= selection 자체)의 lock 만 검사한다
    const moved = controlsUtils.dragHandler(
      {},
      { target: selection, offsetX: 0, offsetY: 0 },
      250,
      260
    )
    expect(moved).toBe(true) // 자식이 잠겨 있어도 selection 은 이동

    // 선택 해제(그룹 상대좌표 → 절대좌표 원복) 시 잠긴 자식의 절대 위치도 함께 이동해 있다
    selection._restoreObjectsState()
    expect(locked.left).not.toBe(0)
    expect(locked.top).not.toBe(0)
  })

  it('참고 — selection 자체에 lock 을 걸면 이동이 막힌다(자식 lock 집계는 없음)', () => {
    const a = new fabric.Rect({ left: 0, top: 0, width: 10, height: 10 })
    const b = new fabric.Rect({ left: 100, top: 100, width: 10, height: 10 })
    const selection = new fabric.ActiveSelection([a, b], {
      lockMovementX: true,
      lockMovementY: true,
    } as fabric.IObjectOptions)
    const before = selection.left
    const moved = controlsUtils.dragHandler(
      {},
      { target: selection, offsetX: 0, offsetY: 0 },
      250,
      260
    )
    expect(moved).toBe(false)
    expect(selection.left).toBe(before)
  })
})

describe('isMultiSelectableInLayerPanel — 잠긴 객체 제외 가드', () => {
  it('기본 permissive: 플래그 없는 객체는 포함', () => {
    expect(isMultiSelectableInLayerPanel({}, false)).toBe(true)
    expect(isMultiSelectableInLayerPanel({}, undefined)).toBe(true)
  })

  it('비-editMode: lockMovementX/Y 잠금 객체 제외 (단순잠금·LockPlugin·permissions 공통 경로)', () => {
    expect(isMultiSelectableInLayerPanel({ lockMovementX: true }, false)).toBe(false)
    expect(isMultiSelectableInLayerPanel({ lockMovementY: true }, false)).toBe(false)
  })

  it('비-editMode: movable===false(관리자 위치고정 마커) 제외', () => {
    expect(isMultiSelectableInLayerPanel({ movable: false }, false)).toBe(false)
    expect(isMultiSelectableInLayerPanel({ movable: true }, false)).toBe(true)
  })

  it('비-editMode: lockInfo.isLocked(LockPlugin 고급 잠금) 제외', () => {
    expect(isMultiSelectableInLayerPanel({ lockInfo: { isLocked: true } }, false)).toBe(false)
    expect(isMultiSelectableInLayerPanel({ lockInfo: { isLocked: false } }, false)).toBe(true)
  })

  it('비-editMode: selectable===false 제외 (캔버스 드래그 선택과 동작 일관)', () => {
    expect(isMultiSelectableInLayerPanel({ selectable: false }, false)).toBe(false)
  })

  it('editMode(관리자): 잠긴 객체도 포함 — 잠금 미강제 규약(B1 잔여 ⑤ 수용)', () => {
    expect(isMultiSelectableInLayerPanel({ lockMovementX: true, movable: false }, true)).toBe(true)
    expect(isMultiSelectableInLayerPanel({ lockInfo: { isLocked: true } }, true)).toBe(true)
  })

  it('null/undefined 객체는 제외', () => {
    expect(isMultiSelectableInLayerPanel(null, false)).toBe(false)
    expect(isMultiSelectableInLayerPanel(undefined, true)).toBe(false)
  })
})

describe('buildNextMultiSelection — shift/ctrl 클릭 토글', () => {
  type Row = MultiSelectCandidate & { id: string }
  const a: Row = { id: 'a' }
  const b: Row = { id: 'b' }
  const locked: Row = { id: 'locked', movable: false }

  it('미선택 객체 클릭 → 추가', () => {
    expect(buildNextMultiSelection([a], b, false)).toEqual([a, b])
  })

  it('기선택 객체 클릭 → 토글 제거', () => {
    expect(buildNextMultiSelection([a, b], b, false)).toEqual([a])
  })

  it('비-editMode: 잠긴 객체는 결과에서 제외', () => {
    expect(buildNextMultiSelection([a], locked, false)).toEqual([a])
    // 기존 선택에 잠긴 객체가 섞여 있어도 걸러낸다
    expect(buildNextMultiSelection([locked], a, false)).toEqual([a])
  })

  it('editMode: 잠긴 객체도 포함', () => {
    expect(buildNextMultiSelection([a], locked, true)).toEqual([a, locked])
  })
})

describe('layerStepReorderArgs — 모바일 ↑↓ (목록=fabric 스택 reverse 방향 함정)', () => {
  // 목록 순서: 위 = 맨앞(front). fabric 스택은 [back, mid, front].
  const rows = [{ id: 'front' }, { id: 'mid' }, { id: 'back' }]

  it('↑(위로) = 한 칸 위 행(front 쪽)을 target 으로 placeAbove=true', () => {
    expect(layerStepReorderArgs(rows, 1, 'up')).toEqual({ targetId: 'front', placeAbove: true })
  })

  it('↓(아래로) = 한 칸 아래 행(back 쪽)을 target 으로 placeAbove=false', () => {
    expect(layerStepReorderArgs(rows, 1, 'down')).toEqual({ targetId: 'back', placeAbove: false })
  })

  it('경계: 맨 위에서 ↑, 맨 아래에서 ↓ 는 null (no-op)', () => {
    expect(layerStepReorderArgs(rows, 0, 'up')).toBeNull()
    expect(layerStepReorderArgs(rows, rows.length - 1, 'down')).toBeNull()
  })

  it('경계: 잘못된 index 는 null', () => {
    expect(layerStepReorderArgs(rows, -1, 'up')).toBeNull()
    expect(layerStepReorderArgs(rows, 99, 'down')).toBeNull()
    expect(layerStepReorderArgs([], 0, 'up')).toBeNull()
  })
})
