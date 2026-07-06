import { describe, it, expect } from 'vitest'
import { applyObjectPermissions, revertObjectPermissions } from './objectPermissions'

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
