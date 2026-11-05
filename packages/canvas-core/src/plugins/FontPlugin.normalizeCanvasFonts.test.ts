// @vitest-environment jsdom
//
// FontPlugin.normalizeCanvasFonts — 복원 경로(core.loadFromJSON)용 미등록 폰트 정규화 스펙.
//
// 배경(2026-11-05): 임베드 세션·로컬 백업 복원은 ServicePlugin.loadJSON 의 beforeLoad/afterLoad 를
// 거치지 않아 applyFontToObject 가 호출되지 않는다. 운영 스모크에서 저장본의 'Times New Roman'
// 텍스트가 복원 뒤 화면에 그대로 남고(브라우저 세리프), PDF 는 기본 폰트로 벡터화돼 화면과
// 출력이 달랐다. 이 메서드는 복원 직후 호출돼 객체·styles 의 미등록 패밀리를 기본 폰트로 맞춘다.
//
// 증명 대상:
//  ① 기본 fontFamily 가 미등록이면 기본 폰트로 바꾸고 치수 재계산·렌더 요청, 변경 수 반환
//  ② styles 의 문자별 fontFamily 도 같은 규칙으로 정규화
//  ③ 등록 폰트·비텍스트 객체는 손대지 않는다, 그룹 내부 텍스트는 재귀 처리
//  ④ 기본 폰트가 미등록(목록 미로드)이면 아무것도 바꾸지 않는다(가드)
//  ⑤ 변경이 없으면 requestRenderAll 을 부르지 않는다
import { describe, it, expect, vi } from 'vitest'
import FontPlugin from './FontPlugin'

const DEFAULT = '본고딕(Noto Sans) Regular'
const DEFAULT_URL = 'https://cdn.example/noto.otf'

type Ctx = FontPlugin & {
  fontUrlByName: Map<string, string>
  defaultFontName: string
  substitutions: Map<string, string>
  _editor: { emit: ReturnType<typeof vi.fn> }
  _canvas: unknown
}

const variants = (name: string): string[] => {
  const nfc = name.normalize('NFC')
  const nfd = name.normalize('NFD')
  return nfc === nfd ? [nfc] : [nfc, nfd]
}

const makeCtx = (registered: string[]): Ctx => {
  const ctx = Object.create(FontPlugin.prototype) as Ctx
  ctx.fontUrlByName = new Map()
  for (const name of registered) for (const v of variants(name)) ctx.fontUrlByName.set(v, DEFAULT_URL)
  ctx.defaultFontName = DEFAULT
  ctx.substitutions = new Map()
  ctx._editor = { emit: vi.fn() }
  ctx._canvas = null
  return ctx
}

type FakeObj = {
  type: string
  fontFamily?: string
  styles?: Record<string, Record<string, { fontFamily?: string }>>
  _objects?: FakeObj[]
  dirty?: boolean
  set: ReturnType<typeof vi.fn>
  setCoords: ReturnType<typeof vi.fn>
  initDimensions: ReturnType<typeof vi.fn>
}

const text = (fontFamily: string, extra: Partial<FakeObj> = {}): FakeObj => {
  const o: FakeObj = {
    type: 'i-text',
    fontFamily,
    set: vi.fn((k: string, v: string) => {
      ;(o as Record<string, unknown>)[k] = v
    }),
    setCoords: vi.fn(),
    initDimensions: vi.fn(),
    ...extra
  }
  return o
}

const canvasOf = (objects: FakeObj[]) => ({
  getObjects: () => objects,
  requestRenderAll: vi.fn()
})

describe('FontPlugin.normalizeCanvasFonts', () => {
  it("미등록 'Times New Roman' 텍스트를 기본 폰트로 바꾸고 치수 재계산·렌더 요청한다", () => {
    const ctx = makeCtx([DEFAULT])
    const tnr = text('Times New Roman')
    const canvas = canvasOf([tnr])

    const changed = ctx.normalizeCanvasFonts(canvas as never)

    expect(changed).toBe(1)
    expect(tnr.fontFamily).toBe(DEFAULT)
    expect(tnr.initDimensions).toHaveBeenCalled()
    expect(tnr.setCoords).toHaveBeenCalled()
    expect(tnr.dirty).toBe(true)
    expect(canvas.requestRenderAll).toHaveBeenCalledTimes(1)
    expect(ctx._editor.emit).toHaveBeenCalledWith('fontSubstituted', {
      requested: 'Times New Roman',
      applied: DEFAULT
    })
  })

  it('styles 의 문자별 미등록 폰트도 기본 폰트로 정규화한다', () => {
    const ctx = makeCtx([DEFAULT, 'Pretendard'])
    const mixed = text('Pretendard', {
      styles: { 0: { 0: { fontFamily: 'Arial, sans-serif' }, 1: { fontFamily: 'Pretendard' }, 2: {} } }
    })
    const canvas = canvasOf([mixed])

    expect(ctx.normalizeCanvasFonts(canvas as never)).toBe(1)
    expect(mixed.fontFamily).toBe('Pretendard')
    expect(mixed.styles![0][0].fontFamily).toBe(DEFAULT)
    expect(mixed.styles![0][1].fontFamily).toBe('Pretendard')
    expect(mixed.set).not.toHaveBeenCalled()
  })

  it('등록 폰트·비텍스트 객체는 손대지 않고, 그룹 내부 텍스트는 재귀 처리한다', () => {
    const ctx = makeCtx([DEFAULT, '나눔고딕'])
    const ok = text('나눔고딕'.normalize('NFD'))
    const inner = text('Times New Roman')
    const group: FakeObj = {
      type: 'group',
      _objects: [inner, { type: 'rect', set: vi.fn(), setCoords: vi.fn(), initDimensions: vi.fn() }],
      set: vi.fn(),
      setCoords: vi.fn(),
      initDimensions: vi.fn()
    }
    const canvas = canvasOf([ok, group])

    expect(ctx.normalizeCanvasFonts(canvas as never)).toBe(1)
    expect(ok.set).not.toHaveBeenCalled()
    expect(ok.fontFamily).toBe('나눔고딕'.normalize('NFD'))
    expect(inner.fontFamily).toBe(DEFAULT)
    expect(group.set).not.toHaveBeenCalled()
  })

  it('기본 폰트가 미등록(목록 미로드)이면 아무것도 바꾸지 않는다', () => {
    const ctx = makeCtx([])
    const tnr = text('Times New Roman')
    const canvas = canvasOf([tnr])

    expect(ctx.normalizeCanvasFonts(canvas as never)).toBe(0)
    expect(tnr.fontFamily).toBe('Times New Roman')
    expect(canvas.requestRenderAll).not.toHaveBeenCalled()
    expect(ctx._editor.emit).not.toHaveBeenCalled()
  })

  it('변경이 없으면 렌더를 요청하지 않고 0 을 돌려준다', () => {
    const ctx = makeCtx([DEFAULT])
    const canvas = canvasOf([text(DEFAULT)])
    expect(ctx.normalizeCanvasFonts(canvas as never)).toBe(0)
    expect(canvas.requestRenderAll).not.toHaveBeenCalled()
  })

  it('캔버스 인자가 없으면 this._canvas 를 쓰고, 그것도 없으면 0', () => {
    const ctx = makeCtx([DEFAULT])
    expect(ctx.normalizeCanvasFonts()).toBe(0)
    const tnr = text('Times New Roman')
    ctx._canvas = canvasOf([tnr])
    expect(ctx.normalizeCanvasFonts()).toBe(1)
    expect(tnr.fontFamily).toBe(DEFAULT)
  })
})
