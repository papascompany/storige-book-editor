// @vitest-environment jsdom
//
// R6 (2026-08-18): PDF 저장 전 글리프 검증 수집기(ServicePlugin.collectGlyphValidationTargets)
// 회귀 테스트.
//
// 배경: 글리프 검증이 excludeFromExport/시스템 마커 객체(SpreadPlugin 치수 라벨 —
// fabric 기본 fontFamily 'Times New Roman')까지 검증해 'WOFF2 font URL not found'
// 콘솔 노이즈를 유발했다. export 경로(_prepareObjectsForSvgExport / fabric toSVG)는
// excludeFromExport 객체를 출력에서 제외하므로, 검증도 동일 게이트를 적용해야 한다.
//
// 고정하는 계약:
//  (1) 사용자 텍스트(text/i-text/textbox)는 수집된다 — 진짜 폰트 누락 경고 유지
//  (2) excludeFromExport===true 텍스트는 제외된다
//  (3) meta.system 시스템 마커 텍스트(치수 라벨 등)는 excludeFromExport 무관하게 제외된다
//  (4) excludeFromExport 그룹은 하위 전체가 제외된다 (toSVG 도 통째로 제외하는 것과 정합)
//  (5) 일반 그룹은 중첩 하위의 사용자 텍스트를 재귀 수집한다
//  (6) 텍스트가 아닌 객체(rect 등)는 수집되지 않는다
//
// 객체는 구조적 목(mock) — 수집기는 type/excludeFromExport/meta/_objects 만 읽는다.
import { describe, it, expect } from 'vitest'
import type { fabric } from 'fabric'
import ServicePlugin from './ServicePlugin'

interface MockObjectInit {
  type: string
  text?: string
  fontFamily?: string
  excludeFromExport?: boolean
  meta?: { system?: string }
  _objects?: MockObjectInit[]
}

function makeObj(init: MockObjectInit): fabric.Object {
  return init as unknown as fabric.Object
}

describe('ServicePlugin.collectGlyphValidationTargets (R6)', () => {
  it('사용자 텍스트(text/i-text/textbox)는 수집된다', () => {
    for (const type of ['text', 'i-text', 'textbox']) {
      const obj = makeObj({ type, text: '안녕', fontFamily: 'Pretendard' })
      expect(ServicePlugin.collectGlyphValidationTargets(obj)).toEqual([obj])
    }
  })

  it('excludeFromExport===true 텍스트는 검증 대상에서 제외된다', () => {
    const obj = makeObj({
      type: 'text',
      text: '210mm',
      fontFamily: 'Times New Roman',
      excludeFromExport: true,
    })
    expect(ServicePlugin.collectGlyphValidationTargets(obj)).toEqual([])
  })

  it('meta.system 시스템 마커(SpreadPlugin 치수 라벨)는 제외된다', () => {
    // 실제 치수 라벨은 excludeFromExport+meta.system 둘 다지만, 단독으로도 제외돼야 한다.
    const labelBoth = makeObj({
      type: 'text',
      text: '426 × 216',
      excludeFromExport: true,
      meta: { system: 'dimensionLabel' },
    })
    const labelMetaOnly = makeObj({
      type: 'text',
      text: '426 × 216',
      meta: { system: 'dimensionLabel' },
    })
    expect(ServicePlugin.collectGlyphValidationTargets(labelBoth)).toEqual([])
    expect(ServicePlugin.collectGlyphValidationTargets(labelMetaOnly)).toEqual([])
  })

  it('excludeFromExport 그룹은 하위 텍스트까지 통째로 제외된다', () => {
    const group = makeObj({
      type: 'group',
      excludeFromExport: true,
      _objects: [
        { type: 'text', text: '가이드', fontFamily: 'Times New Roman' },
        { type: 'i-text', text: '라벨' },
      ],
    })
    expect(ServicePlugin.collectGlyphValidationTargets(group)).toEqual([])
  })

  it('일반 그룹은 중첩 하위의 사용자 텍스트를 재귀 수집하고, 하위 시스템 객체만 제외한다', () => {
    const userText: MockObjectInit = { type: 'textbox', text: '본문', fontFamily: 'Pretendard' }
    const nestedUserText: MockObjectInit = { type: 'text', text: '중첩', fontFamily: 'Pretendard' }
    const systemText: MockObjectInit = {
      type: 'text',
      text: '210mm',
      excludeFromExport: true,
    }
    const group = makeObj({
      type: 'group',
      _objects: [
        userText,
        systemText,
        { type: 'group', _objects: [nestedUserText] },
      ],
    })
    const collected = ServicePlugin.collectGlyphValidationTargets(group)
    expect(collected).toEqual([userText, nestedUserText])
  })

  it('텍스트가 아닌 객체(rect/image)는 수집되지 않는다', () => {
    expect(ServicePlugin.collectGlyphValidationTargets(makeObj({ type: 'rect' }))).toEqual([])
    expect(ServicePlugin.collectGlyphValidationTargets(makeObj({ type: 'image' }))).toEqual([])
  })
})
