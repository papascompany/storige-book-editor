// 곡선(패스) 텍스트 직렬화 왕복 회귀 — R9 (2026-08-11)
//
// 실 fabric(5.5.2 dist) + 실 core.extendFabricOption / core.loadFromJSON 으로
// 저장(canvas.toJSON) → 전송(JSON 문자열) → 복원 왕복을 고정한다.
// embed.tsx / useEmbedAutoSave / ServicePlugin 의 실제 저장 경로와 동일 계약.
// (curveText.test.ts 의 화이트리스트 '소스 검사'와 달리, 여기서는 등재가 실제로
//  왕복 보존으로 이어지는지를 실 fabric 으로 실증한다.)
//
// 고정하는 계약:
//  (1) path 는 fabric Text additionalProps 라 화이트리스트 없이도 항상 직렬화되고,
//      IText.fromObject 가 Path 로 enliven 해 복원한다
//  (2) 커스텀 곡선 속성(extensionType/curvePathType/curveRadius/curveDirection/
//      curveArcDeg)은 extendFabricOption 등재로만 살아남는다 — 등재 제거 시
//      이 테스트가 침묵 소실을 적발한다 (L7 전례)
//  (3) per-char styles 는 stylesToArray/FromArray 왕복에서 보존된다
//  (4) styles 키가 아예 없는 canvasData(외부 변환기 출력)도 core.loadFromJSON 의
//      ensureTextStyles 보정으로 2차 저장이 크래시 없이 완주한다
//      (reference_fabric_styles_trap — 저장 무한로딩 실사고 회귀 가드)
//  (5) 곡선 해제(removeCurveFromText) 상태도 왕복에서 보존된다
import { describe, it, expect } from 'vitest'
import { fabric } from 'fabric'
import { core } from './canvas'
import { applyCurveToText, removeCurveFromText, generateArcPathData } from './curveText'

function staticCanvas(): fabric.StaticCanvas {
  return new fabric.StaticCanvas(null as unknown as HTMLCanvasElement, {
    width: 800,
    height: 600,
    renderOnAddRemove: false,
  })
}

/** 실 저장 경로와 동일: toJSON(extendFabricOption) → JSON 문자열 왕복 → core.loadFromJSON */
async function saveAndLoad(obj: fabric.Object) {
  const c1 = staticCanvas()
  c1.add(obj)
  const saved = c1.toJSON(core.extendFabricOption as string[]) as {
    objects: Record<string, unknown>[]
  }
  const wire = JSON.stringify(saved) // API 전송/DB 저장을 모사 (undefined 탈락 포함)
  const c2 = staticCanvas()
  await core.loadFromJSON(c2 as unknown as fabric.Canvas, JSON.parse(wire))
  return { saved, restored: c2.getObjects()[0] as fabric.IText & Record<string, unknown>, c2 }
}

const CURVE_STYLES = { 0: { 0: { fill: '#ff0000' }, 1: { fill: '#ff0000' } } }

describe('arc 곡선 텍스트 — 저장→복원 왕복 보존', () => {
  async function makeArcText(): Promise<fabric.IText> {
    const t = new fabric.IText('곡선텍스트', {
      left: 100,
      top: 120,
      fontSize: 36,
      fill: '#333333',
      styles: JSON.parse(JSON.stringify(CURVE_STYLES)),
    })
    await applyCurveToText(
      t as unknown as fabric.Object,
      { pathType: 'arc', radius: 180, direction: 'upward', arcDeg: 320 },
      { flip: 'right', charSpacing: 100 }
    )
    return t
  }

  it('path(fabric additionalProps)가 직렬화되고 Path 로 enliven 복원된다', async () => {
    const t = await makeArcText()
    const { saved, restored } = await saveAndLoad(t)

    expect(saved.objects[0].path).toBeTruthy() // 화이트리스트 없이도 항상 직렬화
    expect(restored.type).toBe('i-text')
    expect((restored.path as fabric.Path | undefined)?.type).toBe('path')
    // 패스 커맨드 무손실 (아크 수식 결과 그대로)
    expect((restored.path as fabric.Path).path).toEqual(
      (t.path as unknown as fabric.Path).path
    )
  })

  it('커스텀 곡선 속성 전부(extendFabricOption 등재분)가 왕복에서 살아남는다', async () => {
    const t = await makeArcText()
    const { restored } = await saveAndLoad(t)

    expect(restored.extensionType).toBe('curveText')
    expect(restored.curvePathType).toBe('arc')
    expect(restored.curveRadius).toBe(180)
    expect(restored.curveDirection).toBe('upward')
    expect(restored.curveArcDeg).toBe(320)
    // fabric additionalProps 쪽 UI 상태
    expect(restored.pathSide).toBe('right')
    expect(restored.charSpacing).toBe(100)
  })

  it('per-char styles 가 stylesToArray/FromArray 왕복에서 보존된다', async () => {
    const t = await makeArcText()
    const { restored } = await saveAndLoad(t)
    expect(restored.styles).toEqual(CURVE_STYLES)
  })

  it('2차 저장이 1차 저장과 동일하다 (재편집 반복 안정성)', async () => {
    const t = await makeArcText()
    const { saved, c2 } = await saveAndLoad(t)
    const saved2 = c2.toJSON(core.extendFabricOption as string[]) as {
      objects: Record<string, unknown>[]
    }

    const pick = (o: Record<string, unknown>) => ({
      extensionType: o.extensionType,
      curvePathType: o.curvePathType,
      curveRadius: o.curveRadius,
      curveDirection: o.curveDirection,
      curveArcDeg: o.curveArcDeg,
      pathSide: o.pathSide,
      charSpacing: o.charSpacing,
      styles: o.styles,
      text: o.text,
    })
    expect(pick(saved2.objects[0])).toEqual(pick(saved.objects[0]))
    expect((saved2.objects[0].path as { path: unknown }).path).toEqual(
      (saved.objects[0].path as { path: unknown }).path
    )
  })
})

describe('wave 곡선 텍스트 — 왕복 보존', () => {
  it('curvePathType=wave 가 보존되고 arc 전용 curveArcDeg 는 미설정으로 남는다', async () => {
    const t = new fabric.IText('WAVE', { fontSize: 30 })
    await applyCurveToText(t as unknown as fabric.Object, {
      pathType: 'wave',
      radius: 40,
      direction: 'downward',
      width: 400,
    })
    const { restored } = await saveAndLoad(t)

    expect(restored.curvePathType).toBe('wave')
    expect(restored.curveDirection).toBe('downward')
    expect(restored.curveRadius).toBe(40)
    expect(restored.curveArcDeg).toBeUndefined()
    expect((restored.path as fabric.Path).path).toEqual(
      (t.path as unknown as fabric.Path).path
    )
  })
})

describe('styles 키 누락 canvasData — ensureTextStyles 크래시 방어 (실사고 회귀)', () => {
  // 외부 변환기 출력 모사: i-text + path, styles 키 자체가 없음
  const rawWithoutStyles = () => {
    const p = new fabric.Path(generateArcPathData(150, false, 180), {})
    return {
      version: '5.5.2',
      objects: [
        {
          type: 'i-text',
          text: '곡선',
          left: 0,
          top: 0,
          fontSize: 30,
          path: p.toObject(),
          extensionType: 'curveText',
          curvePathType: 'arc',
          curveRadius: 150,
          curveDirection: 'upward',
        },
      ],
    }
  }

  it('가드 없는 fabric 원 동작: styles 가 undefined 로 전파된다 (함정 실증 핀)', async () => {
    const c = staticCanvas()
    await new Promise<void>((resolve) => {
      ;(c as unknown as fabric.Canvas).loadFromJSON(rawWithoutStyles(), () => resolve())
    })
    const r = c.getObjects()[0] as fabric.IText & { styles?: unknown }
    // fabric 5.5 IText.fromObject 가 stylesFromArray(undefined)=undefined 를 그대로
    // setOptions 로 덮어써 styles 가 undefined 가 된다 — 이후 toObject 가 크래시하는 근원.
    // (fabric 업그레이드로 상류 수정 시 이 핀이 깨져 가드 제거 시점을 알려준다)
    expect(r.styles).toBeUndefined()
    expect(() => c.toJSON(core.extendFabricOption as string[])).toThrow()
  })

  it('core.loadFromJSON 경유 시 styles={} 보정 → 2차 저장이 크래시 없이 완주한다', async () => {
    const c = staticCanvas()
    await core.loadFromJSON(c as unknown as fabric.Canvas, rawWithoutStyles())
    const r = c.getObjects()[0] as fabric.IText & Record<string, unknown>

    expect(r.styles).toEqual({}) // ensureTextStyles 보정
    expect((r.path as fabric.Path | undefined)?.type).toBe('path') // path 복원은 styles 와 무관

    let saved2: { objects: Record<string, unknown>[] } | null = null
    expect(() => {
      saved2 = c.toJSON(core.extendFabricOption as string[]) as {
        objects: Record<string, unknown>[]
      }
    }).not.toThrow()
    expect(saved2!.objects[0].styles).toEqual([])
    expect(saved2!.objects[0].curvePathType).toBe('arc') // 곡선 속성도 함께 재직렬화
  })
})

describe('곡선 해제(removeCurveFromText) — 왕복 보존', () => {
  it('해제 상태(path=null·곡선 속성 제거·pathSide 원복)가 왕복 후에도 평문 텍스트다', async () => {
    const t = new fabric.IText('FLAT', { fontSize: 30 })
    await applyCurveToText(t as unknown as fabric.Object, {
      pathType: 'arc',
      radius: 150,
      direction: 'upward',
    })
    removeCurveFromText(t as unknown as fabric.Object)

    const { restored } = await saveAndLoad(t)
    expect(restored.path).toBeFalsy()
    expect(restored.curvePathType).toBeUndefined()
    expect(restored.extensionType).toBeUndefined()
    expect(restored.pathSide).toBe('left')
    expect(restored.charSpacing).toBe(0)
  })
})
