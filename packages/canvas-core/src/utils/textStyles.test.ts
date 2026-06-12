// fabric 5.5.2 stylesToArray 갭 라인 병합 버그 — 회귀 고정 테스트.
//
// 결함(dist 1878-1913): 무스타일 라인 스킵 시 prevStyle 미리셋 → "스타일 라인 →
// 무스타일 라인 → 동일 스타일 라인" 패턴에서 직전 범위 end++ 병합 → 1차 저장이
// 단일 범위로 오염 → 리로드 시 중간 라인에 스타일 전이 + 마지막 라인 스타일 소실.
// A2+A3 변환기의 diff-only styles 산출(갭 라인에 엔트리 없음)이 이 패턴을 만들기 쉽다.
//
// 이 테스트는 mock 없이 실 fabric dist 를 로드해
//  1) 패치 전 원본으로 결함을 그대로 재현(핀 고정 — fabric 업그레이드로 상류 수정 시
//     이 테스트가 깨져 패치 제거 시점을 알려준다)
//  2) 패치 후 1차 저장→리로드→2차 저장 왕복에서 styles 가 보존됨을 고정한다.
//
// 캡처 순서가 핵심: 모듈 평가 시점(= ./textStyles 부착 전)에 원본 함수를 떠 두고,
// 패치는 beforeAll 의 동적 import 로 부착한다. (vitest 는 파일별 모듈 격리라
// 다른 테스트 파일의 fabric mock 과 충돌하지 않는다.)
import { describe, it, expect, beforeAll } from 'vitest'
import { fabric } from 'fabric'

const util = fabric.util as any

// 패치 전 dist 원본 캡처 (이 파일의 정적 import 단계에서 실행됨)
const originalStylesToArray = util.stylesToArray.bind(util)

// 갭 패턴: 1·3라인만 동일 스타일 D, 2라인은 styles 에 엔트리 자체가 없음(diff-only)
const TEXT = '제목\n본문\n부제'
const D = { fill: '#ff0000', fontWeight: 'bold' }
const gapStyles = () => ({
  0: { 0: { ...D }, 1: { ...D } },
  2: { 0: { ...D }, 1: { ...D } }
})

beforeAll(async () => {
  await import('./textStyles') // fabric.util.stylesToArray 패치 부착
})

describe('fabric 5.5.2 dist 원본 — 결함 재현 (패치 전 핀 고정)', () => {
  it('갭 패턴 1차 저장이 단일 범위로 병합된다 (잠복 결함 실증)', () => {
    const arr = originalStylesToArray(gapStyles(), TEXT)
    // 올바른 결과는 2개 범위지만, 원본은 prevStyle 미리셋으로 1개 범위로 병합
    expect(arr).toEqual([{ start: 0, end: 4, style: D }])
  })

  it('병합된 범위를 리로드하면 스타일 전이/소실이 발생한다 (오염 경로 실증)', () => {
    const arr = originalStylesToArray(gapStyles(), TEXT)
    const reloaded = util.stylesFromArray(arr, TEXT)
    // '본문'(라인 1) 첫 2글자에 스타일 전이
    expect(reloaded[1]).toEqual({ 0: D, 1: D })
    // '부제'(라인 2) 스타일 소실
    expect(reloaded[2]).toBeUndefined()
  })
})

describe('패치 후 — 갭 패턴 저장/리로드 왕복 보존', () => {
  it('1차 저장이 라인별로 분리된 2개 범위를 만든다', () => {
    const arr = util.stylesToArray(gapStyles(), TEXT)
    // charIndex 는 개행 미포함: 라인0 → 0..1, 라인1(스킵) → 2..3, 라인2 → 4..5
    expect(arr).toEqual([
      { start: 0, end: 2, style: D },
      { start: 4, end: 6, style: D }
    ])
  })

  it('1차 저장 → 리로드 → 2차 저장 왕복에서 styles 가 완전 보존된다', () => {
    const input = gapStyles()
    const firstSave = util.stylesToArray(input, TEXT)
    const reloaded = util.stylesFromArray(firstSave, TEXT)
    // 리로드가 입력 styles 객체를 그대로 복원 (전이/소실 없음)
    expect(reloaded).toEqual(gapStyles())
    // 2차 저장도 1차와 동일 — 재편집 반복에도 안정
    const secondSave = util.stylesToArray(reloaded, TEXT)
    expect(secondSave).toEqual(firstSave)
  })

  it('실 직렬화 경로(Textbox#toObject → toJSON) 커버 — 갭 패턴이 올바르게 직렬화된다', () => {
    const tb = new fabric.Textbox(TEXT, { styles: gapStyles() })
    const obj = tb.toObject()
    expect(obj.styles).toEqual([
      { start: 0, end: 2, style: D },
      { start: 4, end: 6, style: D }
    ])
    // toJSON 은 toObject 위임 — 동일 결과
    expect(tb.toJSON().styles).toEqual(obj.styles)
    // 저장물 리로드까지 일치 (loadFromJSON 의 stylesFromArray 경로)
    expect(util.stylesFromArray(obj.styles, obj.text)).toEqual(gapStyles())
  })
})

describe('패치 후 — 원본 동작/시그니처 보존 (회귀 가드)', () => {
  it('인접한 두 스타일 라인(갭 없음)은 원본과 동일하게 단일 범위로 병합된다', () => {
    const text = '제목\n본문'
    const styles = { 0: { 0: { ...D }, 1: { ...D } }, 1: { 0: { ...D }, 1: { ...D } } }
    const patched = util.stylesToArray(styles, text)
    const original = originalStylesToArray(styles, text)
    expect(patched).toEqual([{ start: 0, end: 4, style: D }])
    expect(patched).toEqual(original) // 갭 없는 입력에서 원본과 출력 동일
  })

  it('서로 다른 스타일은 갭 여부와 무관하게 별도 엔트리로 분리된다', () => {
    const E = { fill: '#0000ff', fontWeight: 'bold' }
    const styles = { 0: { 0: { ...D }, 1: { ...D } }, 2: { 0: { ...E }, 1: { ...E } } }
    expect(util.stylesToArray(styles, TEXT)).toEqual([
      { start: 0, end: 2, style: D },
      { start: 4, end: 6, style: E }
    ])
  })

  it('스타일 없는 입력은 빈 배열, 입력 객체는 변이되지 않는다(클론 보존)', () => {
    expect(util.stylesToArray({}, TEXT)).toEqual([])
    const input = gapStyles()
    const snapshot = JSON.parse(JSON.stringify(input))
    util.stylesToArray(input, TEXT)
    expect(input).toEqual(snapshot)
  })

  it('스타일 라인 내부의 무스타일 글자 뒤 동일 스타일은 원본처럼 새 엔트리로 시작한다', () => {
    // 같은 라인 안의 갭은 원본도 prevStyle 리셋(thisStyle||{}) — 동작 불변 확인
    const text = '가나다'
    const styles = { 0: { 0: { ...D }, 2: { ...D } } }
    const patched = util.stylesToArray(styles, text)
    expect(patched).toEqual([
      { start: 0, end: 1, style: D },
      { start: 2, end: 3, style: D }
    ])
    expect(patched).toEqual(originalStylesToArray(styles, text))
  })
})
