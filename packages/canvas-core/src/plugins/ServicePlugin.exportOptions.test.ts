// P1 캘린더 (2026-10-17): 프로파일 세트 전용 PDF export 옵션의 fabric 측 계약.
//
// 배경: 워커 preflight 가 캘린더 완료 PDF 에서 TRANSPARENCY_DETECTED(`/ca 0` ExtGState)를 경고했다.
// 원인은 fabric 이 'transparent' 색을 SVG 로 `fill: rgb(0,0,0); fill-opacity: 0` 으로 내보내고
// svg2pdf 가 fill-opacity<1 을 ExtGState 로 실현하기 때문(워크스페이스 rect + 캘린더 그리드 경계 rect).
// `fill: none`(fabric 값 '') 은 svg2pdf 에서 fill=null → ExtGState 없이 그리기만 생략된다.
//
// 고정하는 계약(실 fabric 5.5.2 dist + node-canvas):
//  (1) neutralizeTransparentFills: 그룹 하위 재귀 포함 fill/stroke 'transparent' → '' 치환, toSVG 에 `*-opacity: 0` 없음
//  (2) 반환된 원복 함수가 원래 값('transparent')으로 되돌린다
//  (3) excludeFromExport 객체는 건드리지 않는다(어차피 toSVG 미포함)
//  (4) 'transparent' 문자열만 대상 — rgba(…,0)·opacity<1 같은 사용자 투명도는 그대로(치환 범위 한정)
//  (5) excludeWorkspaceFromExport 전제: 워크스페이스 rect 에 excludeFromExport=true 를 줘도 canvas.clipPath 로서의
//      <clipPath> 마크업은 유지되고(fabric createSVGClipPathMarkup 은 excludeFromExport 미참조) 본문 rect 만 빠진다
import { describe, it, expect } from 'vitest'
import { fabric } from 'fabric'
import ServicePlugin from './ServicePlugin'

type Identified = fabric.Object & { id?: string }

function makeCanvas(): fabric.Canvas {
  return new fabric.StaticCanvas(null as unknown as HTMLCanvasElement, {
    width: 400,
    height: 300,
    renderOnAddRemove: false,
  }) as unknown as fabric.Canvas
}

function workspaceRect(): Identified {
  return new fabric.Rect({
    id: 'workspace',
    width: 400,
    height: 300,
    left: 0,
    top: 0,
    originX: 'center',
    originY: 'center',
    fill: 'transparent',
  } as fabric.IRectOptions) as Identified
}

describe('ServicePlugin.isTransparentColor', () => {
  it("'transparent'(공백·대소문자 무관)만 true", () => {
    expect(ServicePlugin.isTransparentColor('transparent')).toBe(true)
    expect(ServicePlugin.isTransparentColor(' Transparent ')).toBe(true)
    expect(ServicePlugin.isTransparentColor('')).toBe(false)
    expect(ServicePlugin.isTransparentColor('rgba(0,0,0,0)')).toBe(false)
    expect(ServicePlugin.isTransparentColor('#fff')).toBe(false)
    expect(ServicePlugin.isTransparentColor(undefined)).toBe(false)
    expect(ServicePlugin.isTransparentColor(null)).toBe(false)
    expect(ServicePlugin.isTransparentColor(new fabric.Gradient({ colorStops: [] }))).toBe(false)
  })
})

describe('ServicePlugin.neutralizeTransparentFills (PdfExportOptions.neutralizeTransparentFills)', () => {
  it("(1)(2) 'transparent' fill/stroke(그룹 하위 포함)를 ''(SVG none) 로 치환하고 원복한다", () => {
    const canvas = makeCanvas()
    const ws = workspaceRect()
    const bounds = new fabric.Rect({ id: 'g-bounds', left: 0, top: 0, width: 100, height: 60, fill: 'transparent', stroke: undefined, strokeWidth: 0 } as fabric.IRectOptions)
    const day = new fabric.Text('15', { left: 10, top: 10, fontSize: 12, fill: '#222222' })
    const grid = new fabric.Group([bounds, day], { id: 'grid', left: 20, top: 20 } as fabric.IGroupOptions)
    const outline = new fabric.Rect({ id: 'outline', left: 150, top: 100, width: 80, height: 40, fill: 'transparent', stroke: 'transparent', strokeWidth: 2 } as fabric.IRectOptions)
    const solid = new fabric.Rect({ id: 'solid', left: 10, top: 200, width: 50, height: 50, fill: '#ff0000' } as fabric.IRectOptions)
    canvas.add(ws, grid, outline, solid)

    // 사전 조건: 종전 출력에는 fill-opacity: 0 이 들어간다(= /ca 0 의 원천)
    const before = canvas.toSVG()
    expect(before).toMatch(/fill-opacity: 0/)
    expect(before).toMatch(/stroke-opacity: 0/)

    const restore = ServicePlugin.neutralizeTransparentFills(canvas)
    expect(ws.fill).toBe('')
    expect(bounds.fill).toBe('')
    expect(outline.fill).toBe('')
    expect(outline.stroke).toBe('')
    expect(solid.fill).toBe('#ff0000')
    expect(day.fill).toBe('#222222')

    const after = canvas.toSVG()
    expect(after).not.toMatch(/fill-opacity: 0/)
    expect(after).not.toMatch(/stroke-opacity: 0/)
    expect(after).toMatch(/fill: none;/)
    // 실 콘텐츠는 그대로 남는다
    expect(after).toMatch(/fill: rgb\(255,0,0\)/)
    expect(after).toMatch(/15<\/tspan>/)

    restore()
    expect(ws.fill).toBe('transparent')
    expect(bounds.fill).toBe('transparent')
    expect(outline.fill).toBe('transparent')
    expect(outline.stroke).toBe('transparent')
    expect(canvas.toSVG()).toMatch(/fill-opacity: 0/)
  })

  it('(3) excludeFromExport 객체는 건드리지 않는다', () => {
    const canvas = makeCanvas()
    const hidden = new fabric.Rect({ id: 'hidden', left: 0, top: 0, width: 10, height: 10, fill: 'transparent', excludeFromExport: true } as fabric.IRectOptions)
    const hiddenChild = new fabric.Rect({ left: 0, top: 0, width: 10, height: 10, fill: 'transparent' } as fabric.IRectOptions)
    const hiddenGroup = new fabric.Group([hiddenChild], { id: 'hg', excludeFromExport: true } as fabric.IGroupOptions)
    canvas.add(hidden, hiddenGroup)
    const restore = ServicePlugin.neutralizeTransparentFills(canvas)
    expect(hidden.fill).toBe('transparent')
    expect(hiddenChild.fill).toBe('transparent')
    expect(canvas.toSVG()).not.toMatch(/fill-opacity: 0/)
    restore()
  })

  it("(4) 'transparent' 문자열만 치환 — rgba(…,0)·opacity<1 은 사용자 지정 투명도로 보존", () => {
    const canvas = makeCanvas()
    const rgba = new fabric.Rect({ left: 0, top: 0, width: 10, height: 10, fill: 'rgba(0,0,0,0)' } as fabric.IRectOptions)
    const faded = new fabric.Rect({ left: 20, top: 0, width: 10, height: 10, fill: '#000', opacity: 0.5 } as fabric.IRectOptions)
    canvas.add(rgba, faded)
    const restore = ServicePlugin.neutralizeTransparentFills(canvas)
    expect(rgba.fill).toBe('rgba(0,0,0,0)')
    expect(faded.opacity).toBe(0.5)
    expect(canvas.toSVG()).toMatch(/fill-opacity: 0/) // 의도적 보존
    restore()
  })
})

describe('excludeWorkspaceFromExport 전제 — 워크스페이스 excludeFromExport 와 canvas.clipPath', () => {
  it('(5) excludeFromExport=true 워크스페이스는 본문에서 빠지지만 <clipPath> 마크업은 유지된다', () => {
    const canvas = makeCanvas()
    const ws = workspaceRect()
    const content = new fabric.Rect({ id: 'content', left: 0, top: 0, width: 50, height: 50, fill: '#00ff00' } as fabric.IRectOptions)
    canvas.add(ws, content)
    canvas.clipPath = ws

    const before = canvas.toSVG()
    expect(before).toMatch(/<clipPath id="CLIPPATH_\d+"/)
    expect(before).toMatch(/fill-opacity: 0/) // 종전: 워크스페이스 rect 본문 출력 = /ca 0 원천

    ws.excludeFromExport = true
    const after = canvas.toSVG()
    expect(after).toMatch(/<clipPath id="CLIPPATH_\d+"/)
    expect(after).toMatch(/clip-path="url\(#CLIPPATH_\d+\)"/)
    expect(after).not.toMatch(/fill-opacity: 0/)
    expect(after).toMatch(/fill: rgb\(0,255,0\)/)
    // 본문 rect 는 clipPath 정의 안의 1개뿐
    expect((after.match(/<rect /g) ?? []).length).toBe(2) // clipPath 내 workspace + content
    expect((before.match(/<rect /g) ?? []).length).toBe(3) // + 본문 workspace
  })
})
