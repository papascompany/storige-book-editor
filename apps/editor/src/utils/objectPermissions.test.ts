import { describe, it, expect } from 'vitest'
import {
  applyObjectPermissions,
  revertObjectPermissions,
  isAppearanceLocked,
} from './objectPermissions'

/**
 * B1 (2026-07-04): contentEditable 축 강제/원복 회귀 테스트.
 * fabric 실캔버스 없이 최소 mock — applyObjectPermissions 는 getObjects/requestRenderAll 만 사용.
 */
type Flags = Record<string, unknown>

function makeObj(over: Flags) {
  const obj: Flags = {
    type: 'textbox',
    editable: true,
    set(props: Flags) {
      Object.assign(obj, props)
    },
    setCoords() {},
    ...over,
  }
  return obj
}

function makeCanvas(objects: Flags[]) {
  return {
    getObjects: () => objects,
    requestRenderAll: () => {},
  } as never
}

describe('applyObjectPermissions — contentEditable (B1)', () => {
  it('customer(비-editMode): contentEditable=false 텍스트는 editable=false 강제', () => {
    const text = makeObj({ contentEditable: false })
    applyObjectPermissions(makeCanvas([text]), false)
    expect(text.editable).toBe(false)
  })

  it('customer: contentEditable 미지정(undefined)은 무개입 (default-permissive)', () => {
    const text = makeObj({})
    applyObjectPermissions(makeCanvas([text]), false)
    expect(text.editable).toBe(true)
  })

  it('customer: 텍스트가 아닌 객체의 editable 은 건드리지 않음', () => {
    const rect = makeObj({ type: 'rect', contentEditable: false })
    applyObjectPermissions(makeCanvas([rect]), false)
    expect(rect.editable).toBe(true)
  })

  it('admin(editMode): 강제 마커가 있는 텍스트의 editable 역오염 원복', () => {
    // 고객 세션 저장본에 editable=false 가 영속된 상황
    const text = makeObj({ contentEditable: false, editable: false })
    applyObjectPermissions(makeCanvas([text]), true)
    expect(text.editable).toBe(true)
  })

  it('admin: 마커 없는 editable=false 는 원복하지 않음 (의도적 설정 보존)', () => {
    const text = makeObj({ editable: false })
    applyObjectPermissions(makeCanvas([text]), true)
    expect(text.editable).toBe(false)
  })

  it('customer: movable=false 강제는 기존 동작 유지 (회귀 가드)', () => {
    const shape = makeObj({ type: 'rect', movable: false, hasControls: true })
    applyObjectPermissions(makeCanvas([shape]), false)
    expect(shape.lockMovementX).toBe(true)
    expect(shape.hasControls).toBe(false)
  })
})

describe('revertObjectPermissions — 고객 시점 미리보기 원복 (L3 B-3)', () => {
  it('movable=false 강제분(lock 5속성+hasControls)을 정확 원복', () => {
    const shape = makeObj({ type: 'rect', movable: false, hasControls: true })
    applyObjectPermissions(makeCanvas([shape]), false)
    expect(shape.lockMovementX).toBe(true)
    expect(shape.hasControls).toBe(false)

    revertObjectPermissions(makeCanvas([shape]))
    expect(shape.lockMovementX).toBe(false)
    expect(shape.lockMovementY).toBe(false)
    expect(shape.lockScalingX).toBe(false)
    expect(shape.lockScalingY).toBe(false)
    expect(shape.lockRotation).toBe(false)
    expect(shape.hasControls).toBe(true)
  })

  it('마커 없는 객체는 건드리지 않음 (고객 단순잠금 보존)', () => {
    const locked = makeObj({ type: 'rect', lockMovementX: true, hasControls: false })
    revertObjectPermissions(makeCanvas([locked]))
    expect(locked.lockMovementX).toBe(true)
    expect(locked.hasControls).toBe(false)
  })

  it('미리보기 왕복(apply false → revert → apply true)에 editable 도 원복', () => {
    const text = makeObj({ contentEditable: false, movable: false, hasControls: true })
    applyObjectPermissions(makeCanvas([text]), false)
    expect(text.editable).toBe(false)
    expect(text.lockMovementX).toBe(true)

    revertObjectPermissions(makeCanvas([text]))
    applyObjectPermissions(makeCanvas([text]), true)
    expect(text.editable).toBe(true)
    expect(text.lockMovementX).toBe(false)
    expect(text.hasControls).toBe(true)
  })
})

/** L4-③: 그룹 자식 텍스트 contentEditable 강제/원복 (그룹 해제 후 진입 구멍 봉쇄) */
function makeGroup(children: Flags[], over: Flags = {}) {
  return makeObj({ type: 'group', getObjects: () => children, ...over })
}

describe('applyObjectPermissions — 그룹 자식 재귀 (L4-③)', () => {
  it('customer: 그룹 내부 contentEditable=false 텍스트도 editable=false 강제', () => {
    const child = makeObj({ contentEditable: false })
    const group = makeGroup([child])
    applyObjectPermissions(makeCanvas([group]), false)
    expect(child.editable).toBe(false)
  })

  it('customer: 중첩 그룹(그룹 속 그룹)의 텍스트까지 강제', () => {
    const deep = makeObj({ contentEditable: false })
    const inner = makeGroup([deep])
    const outer = makeGroup([inner])
    applyObjectPermissions(makeCanvas([outer]), false)
    expect(deep.editable).toBe(false)
  })

  it('customer: 마커 없는 그룹 자식은 무개입 (default-permissive)', () => {
    const child = makeObj({})
    const group = makeGroup([child])
    applyObjectPermissions(makeCanvas([group]), false)
    expect(child.editable).toBe(true)
  })

  it('admin(editMode): 그룹 자식의 강제분(editable=false)도 재귀 원복 — 저장 왕복 대칭', () => {
    const child = makeObj({ contentEditable: false, editable: false })
    const group = makeGroup([child])
    applyObjectPermissions(makeCanvas([group]), true)
    expect(child.editable).toBe(true)
  })

  it('그룹 자체의 movable 강제는 그룹(최상위) 단위로만 — 자식 lock 미전파(그룹 단위 조작 유지)', () => {
    const child = makeObj({ type: 'rect' })
    const group = makeGroup([child], { movable: false, hasControls: true })
    applyObjectPermissions(makeCanvas([group]), false)
    expect(group.lockMovementX).toBe(true)
    expect(child.lockMovementX).toBeUndefined()
  })
})

/** L4-④ (CTO 결정): '내용편집 잠금' = 내용+스타일 모두 잠금 — 스타일 컨트롤 게이트 판정 */
describe('isAppearanceLocked (L4-④)', () => {
  it('비-editMode + contentEditable=false → 스타일 잠금', () => {
    expect(isAppearanceLocked([makeObj({ contentEditable: false })], false)).toBe(true)
  })

  it('editMode(디자이너)는 면제', () => {
    expect(isAppearanceLocked([makeObj({ contentEditable: false })], true)).toBe(false)
  })

  it('contentEditable 미지정은 잠금 아님 (default-permissive)', () => {
    expect(isAppearanceLocked([makeObj({})], false)).toBe(false)
  })

  it('빈 선택/null 은 잠금 아님', () => {
    expect(isAppearanceLocked([], false)).toBe(false)
    expect(isAppearanceLocked(null, false)).toBe(false)
  })

  it('다중선택: 하나라도 잠겨 있으면 잠금 취급', () => {
    expect(isAppearanceLocked([makeObj({}), makeObj({ contentEditable: false })], false)).toBe(true)
  })
})
