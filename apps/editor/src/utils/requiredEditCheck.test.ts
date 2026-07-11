import { describe, it, expect } from 'vitest'
import {
  requiredEditKindOf,
  isUneditedRequired,
  markRequiredEditTouched,
  collectUneditedRequired,
  formatItemNames,
  attachRequiredEditTracking,
} from './requiredEditCheck'
import { core } from '@storige/canvas-core'

const textObj = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  type: 'textbox',
  text: '이름을 입력하세요',
  requiredEdit: true,
  ...over,
})

const frameObj = (over: Record<string, unknown> = {}) => ({
  id: 'f1',
  type: 'image',
  extensionType: 'frame',
  requiredEdit: true,
  ...over,
})

const canvasOf = (...objects: unknown[]) => ({ getObjects: () => objects })

describe('requiredEditKindOf', () => {
  it('텍스트류 3종은 text', () => {
    expect(requiredEditKindOf({ type: 'text' })).toBe('text')
    expect(requiredEditKindOf({ type: 'i-text' })).toBe('text')
    expect(requiredEditKindOf({ type: 'textbox' })).toBe('text')
  })
  it('extensionType=frame 은 frame (type 무관)', () => {
    expect(requiredEditKindOf({ type: 'image', extensionType: 'frame' })).toBe('frame')
  })
  it('그 외 타입은 null — 지정 UI 비활성 대상', () => {
    expect(requiredEditKindOf({ type: 'image' })).toBeNull()
    expect(requiredEditKindOf({ type: 'rect' })).toBeNull()
    expect(requiredEditKindOf(null)).toBeNull()
  })
})

describe('isUneditedRequired — 판정 시나리오', () => {
  it('신규주문: requiredEdit 텍스트 미터치 → 미편집', () => {
    expect(isUneditedRequired(textObj())).toBe(true)
  })
  it('고객이 편집(touched 마킹) → 편집됨', () => {
    expect(isUneditedRequired(textObj({ requiredEditTouched: true }))).toBe(false)
  })
  it('재편집(세션 복원): touched 가 영속 저장돼 있으면 재경고 없음', () => {
    // 세션 canvasData 왕복 후에도 requiredEditTouched=true 가 남아 있는 상태를 모사
    const restored = JSON.parse(JSON.stringify(textObj({ requiredEditTouched: true })))
    expect(isUneditedRequired(restored)).toBe(false)
  })
  it('default-permissive: requiredEdit 미지정/false 는 항상 비대상', () => {
    expect(isUneditedRequired(textObj({ requiredEdit: undefined }))).toBe(false)
    expect(isUneditedRequired(textObj({ requiredEdit: false }))).toBe(false)
  })
  it('사진틀: fillImage 없음 → 미편집, 있음 → 편집됨 (touched 불필요)', () => {
    expect(isUneditedRequired(frameObj())).toBe(true)
    expect(isUneditedRequired(frameObj({ fillImage: 'photo_1' }))).toBe(false)
  })
  it('텍스트/프레임 외 타입은 requiredEdit=true 라도 판정 제외(안전 기본값)', () => {
    expect(isUneditedRequired({ type: 'rect', requiredEdit: true })).toBe(false)
  })
})

describe('markRequiredEditTouched', () => {
  it('requiredEdit 텍스트에만 1회 마킹', () => {
    const t = textObj()
    expect(markRequiredEditTouched(t)).toBe(true)
    expect((t as { requiredEditTouched?: boolean }).requiredEditTouched).toBe(true)
    expect(markRequiredEditTouched(t)).toBe(false) // 이미 마킹 → no-op
  })
  it('비필수 텍스트/프레임은 no-op', () => {
    const plain = textObj({ requiredEdit: undefined })
    expect(markRequiredEditTouched(plain)).toBe(false)
    expect((plain as { requiredEditTouched?: boolean }).requiredEditTouched).toBeUndefined()
    expect(markRequiredEditTouched(frameObj())).toBe(false)
  })
})

describe('collectUneditedRequired — 혼합/멀티페이지/그룹', () => {
  it('텍스트+프레임 혼합 수집, canvasIndex 부여', () => {
    const c0 = canvasOf(textObj(), { id: 'x', type: 'rect' })
    const c1 = canvasOf(frameObj(), textObj({ id: 't2', requiredEditTouched: true }))
    const items = collectUneditedRequired([c0, c1])
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ canvasIndex: 0, objectId: 't1', kind: 'text' })
    expect(items[1]).toMatchObject({ canvasIndex: 1, objectId: 'f1', kind: 'frame' })
  })
  it('그룹 내부의 requiredEdit 텍스트도 검출(은폐 구멍 방지)', () => {
    const group = { type: 'group', getObjects: () => [textObj({ id: 'inGroup' })] }
    const items = collectUneditedRequired([canvasOf(group)])
    expect(items).toHaveLength(1)
    expect(items[0].objectId).toBe('inGroup')
  })
  it('라벨: name 우선 > 텍스트 12자 절단 > 종류명', () => {
    const items = collectUneditedRequired([
      canvasOf(
        textObj({ id: 'a', name: '수취인 이름' }),
        textObj({ id: 'b', text: '가나다라마바사아자차카타파하' }),
        frameObj({ id: 'c' }),
      ),
    ])
    expect(items[0].label).toBe('수취인 이름')
    expect(items[1].label).toBe('가나다라마바사아자차카타…')
    expect(items[2].label).toBe('사진틀')
  })
  it('null 캔버스는 무시', () => {
    expect(collectUneditedRequired([null, undefined, canvasOf()])).toHaveLength(0)
  })
})

describe('formatItemNames', () => {
  const item = (label: string) => ({ canvasIndex: 0, objectId: label, label, kind: 'text' as const })
  it('3개 이하는 전부 나열', () => {
    expect(formatItemNames([item('이름')])).toBe("'이름'")
  })
  it('4개 이상은 최대 3개 + 외 N개', () => {
    expect(formatItemNames([item('a'), item('b'), item('c'), item('d'), item('e')])).toBe(
      "'a', 'b', 'c' 외 2개",
    )
  })
})

describe('attachRequiredEditTracking', () => {
  const makeCanvas = () => {
    const handlers: Record<string, Array<(e: { target?: unknown }) => void>> = {}
    return {
      on(event: string, h: (e: { target?: unknown }) => void) {
        ;(handlers[event] ||= []).push(h)
      },
      fire(event: string, e: { target?: unknown }) {
        for (const h of handlers[event] || []) h(e)
      },
      handlers,
    }
  }

  it('text:changed 시 고객 컨텍스트(shouldTrack=true)에서만 touched 마킹', () => {
    const canvas = makeCanvas()
    let customer = false
    attachRequiredEditTracking(canvas, () => customer)
    const t = textObj()
    canvas.fire('text:changed', { target: t }) // admin 컨텍스트 — 미마킹
    expect((t as { requiredEditTouched?: boolean }).requiredEditTouched).toBeUndefined()
    customer = true
    canvas.fire('text:changed', { target: t })
    expect((t as { requiredEditTouched?: boolean }).requiredEditTouched).toBe(true)
  })

  it('멱등 — 재부착해도 리스너 1개', () => {
    const canvas = makeCanvas()
    attachRequiredEditTracking(canvas, () => true)
    attachRequiredEditTracking(canvas, () => true)
    expect(canvas.handlers['text:changed']).toHaveLength(1)
  })
})

describe('직렬화 왕복 — extendFabricOption 등재 (침묵유실 가드)', () => {
  it('requiredEdit/requiredEditTouched 가 화이트리스트에 존재한다', () => {
    expect(core.extendFabricOption).toContain('requiredEdit')
    expect(core.extendFabricOption).toContain('requiredEditTouched')
  })
  it('화이트리스트 pick + JSON 왕복에서 두 플래그가 보존된다 (toObject 시맨틱 모사)', () => {
    const obj: Record<string, unknown> = {
      ...textObj({ requiredEditTouched: true }),
      notWhitelisted: 'drop-me',
    }
    const picked: Record<string, unknown> = {}
    for (const key of core.extendFabricOption) {
      if (key in obj) picked[key] = obj[key]
    }
    const roundTripped = JSON.parse(JSON.stringify(picked)) as Record<string, unknown>
    expect(roundTripped.requiredEdit).toBe(true)
    expect(roundTripped.requiredEditTouched).toBe(true)
    expect(roundTripped.notWhitelisted).toBeUndefined()
  })
})
