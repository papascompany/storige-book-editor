// 저장 데이터에 남은 책등 가이드·치수 라벨 잔재 제거 — 판정 범위 고정.
import { describe, it, expect } from 'vitest'
import { isSpreadGuideResidue, stripSpreadGuideResidue } from './spreadGuideResidue'

// 실제 저장 데이터에서 확인된 형상(표지 템플릿 1벌): 책등 선 2개 + 치수 라벨 3개가 일반 객체로 저장됨.
const residueSet = () => [
  { type: 'line', id: 'spread-guide-0', left: -5, top: -632, stroke: '#999' },
  { type: 'line', id: 'spread-guide-1', left: 5, top: -632, stroke: '#999' },
  { type: 'text', text: '301.0mm', left: -893, top: -618 },
  { type: 'text', text: '1.2mm', left: 0, top: -618 },
  { type: 'text', text: '301.0mm', left: 893, top: -618 },
]

describe('stripSpreadGuideResidue', () => {
  it('일반 객체로 저장된 책등 선·치수 라벨을 빼고 나머지는 순서대로 남긴다', () => {
    const workspace = { type: 'rect', id: 'workspace' }
    const title = { type: 'i-text', id: 'a1', text: '제목을 넣어주세요' }
    const author = { type: 'i-text', id: 'a2', text: '저자명' }
    const input = { version: '5.3.0', objects: [workspace, ...residueSet(), title, author] }

    const out = stripSpreadGuideResidue(input)

    expect(out.objects).toEqual([workspace, title, author])
    expect(out.version).toBe('5.3.0')
    expect(input.objects).toHaveLength(8) // 입력은 바꾸지 않는다
  })

  it('시스템 표시가 붙은 채 저장된 가이드·라벨도 뺀다', () => {
    const input = {
      objects: [
        { type: 'line', id: 'spread-guide-0', meta: { system: 'spreadGuide' } },
        { type: 'rect', meta: { system: 'spreadGuide' } },
        { type: 'text', text: '203.2mm', meta: { system: 'dimensionLabel', regionPosition: 'front' } },
      ],
    }
    expect(stripSpreadGuideResidue(input).objects).toEqual([])
  })

  it('템플릿 id 채우기가 id 를 붙인 치수 라벨도 뺀다', () => {
    const input = { objects: [{ type: 'text', id: 'tplobj-0a1b2c3d-4', text: '203.2mm' }] }
    expect(stripSpreadGuideResidue(input).objects).toEqual([])
  })

  it('사용자·템플릿 콘텐츠는 건드리지 않는다', () => {
    const keep = [
      { type: 'i-text', id: 'u1', text: '210mm' }, // 사용자가 쓴 글(유형이 다름)
      { type: 'textbox', text: '297mm' },
      { type: 'text', id: 'c0ffee00-0000-4000-8000-000000000000', text: '10mm' }, // 다른 id 를 가진 text
      { type: 'text', text: '가로 210mm' }, // 치수만으로 된 문구가 아님
      { type: 'line', id: 'divider-1' },
      { type: 'line' },
      { type: 'rect', id: 'spread-guide-0' }, // line 이 아님
      { type: 'group', meta: { system: 'calendarGrid' } }, // 다른 시스템 객체
      { type: 'image', meta: { system: null } },
    ]
    const input = { objects: keep }
    expect(stripSpreadGuideResidue(input)).toBe(input)
  })

  it('걸러낼 것이 없거나 objects 가 없으면 입력을 그대로 돌려준다', () => {
    const clean = { objects: [{ type: 'rect', id: 'workspace' }] }
    expect(stripSpreadGuideResidue(clean)).toBe(clean)
    const noObjects = { version: '5.3.0' }
    expect(stripSpreadGuideResidue(noObjects)).toBe(noObjects)
    expect(stripSpreadGuideResidue(null)).toBeNull()
    expect(stripSpreadGuideResidue('x')).toBe('x')
  })

  it('그룹 안의 객체는 보지 않는다', () => {
    const input = { objects: [{ type: 'group', objects: [{ type: 'text', text: '10mm' }] }] }
    expect(stripSpreadGuideResidue(input)).toBe(input)
    expect(isSpreadGuideResidue(input.objects[0])).toBe(false)
  })
})
