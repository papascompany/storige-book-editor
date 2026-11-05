// fontFamilyResolve — 미등록 폰트 패밀리의 기본 폰트 대체 규칙(순수 함수) 스펙.
//
// 증명 대상:
//  ① CSS font-family 목록·따옴표 → 첫 패밀리만 추출
//  ② 등록 폰트(NFC/NFD 어느 변형이든)는 그대로
//  ③ 미등록 + 기본 폰트 등록 → 기본 폰트로 대체(substituted)
//  ④ 미등록 + 기본 폰트도 미등록(목록 미로드) → 대체하지 않고 원문 유지(가드)
import { describe, it, expect } from 'vitest'
import {
  parsePrimaryFontFamily,
  resolveFontFamily,
  isFontRegistered,
  fontNameVariants
} from './fontFamilyResolve'

const DEFAULT = '본고딕(Noto Sans) Regular'

const registryOf = (...names: string[]) => {
  const set = new Set<string>()
  for (const n of names) for (const v of fontNameVariants(n)) set.add(v)
  return { has: (name: string) => set.has(name) }
}

describe('parsePrimaryFontFamily', () => {
  it('CSS 목록은 첫 항목만, 따옴표·공백은 제거한다', () => {
    expect(parsePrimaryFontFamily('Arial, sans-serif')).toBe('Arial')
    expect(parsePrimaryFontFamily('"Noto Sans KR", sans-serif')).toBe('Noto Sans KR')
    expect(parsePrimaryFontFamily("'나눔고딕'")).toBe('나눔고딕')
    expect(parsePrimaryFontFamily('  본고딕(Noto Sans) Regular ')).toBe('본고딕(Noto Sans) Regular')
  })

  it('빈 값·비문자열은 빈 문자열', () => {
    expect(parsePrimaryFontFamily('')).toBe('')
    expect(parsePrimaryFontFamily(undefined as unknown as string)).toBe('')
  })
})

describe('isFontRegistered', () => {
  it('NFC 로 등록된 한글 폰트를 NFD 요청으로도 찾는다(역도 성립)', () => {
    const nfcOnly = { has: (n: string) => n === '나눔고딕'.normalize('NFC') }
    expect(isFontRegistered(nfcOnly, '나눔고딕'.normalize('NFD'))).toBe(true)
    const nfdOnly = { has: (n: string) => n === '나눔고딕'.normalize('NFD') }
    expect(isFontRegistered(nfdOnly, '나눔고딕'.normalize('NFC'))).toBe(true)
  })
})

describe('resolveFontFamily', () => {
  const registry = registryOf(DEFAULT, 'Noto Sans KR', '나눔고딕')

  it('등록 폰트는 그대로(registered, 대체 없음)', () => {
    const r = resolveFontFamily('Noto Sans KR', registry, DEFAULT)
    expect(r).toMatchObject({ family: 'Noto Sans KR', registered: true, substituted: false })
  })

  it('CSS 목록의 첫 항목이 등록돼 있으면 그 이름으로 해석한다', () => {
    const r = resolveFontFamily('"나눔고딕", sans-serif', registry, DEFAULT)
    expect(r).toMatchObject({ primary: '나눔고딕', family: '나눔고딕', registered: true })
  })

  it("미등록 'Times New Roman'(fabric 기본값) → 기본 폰트로 대체", () => {
    const r = resolveFontFamily('Times New Roman', registry, DEFAULT)
    expect(r).toMatchObject({
      requested: 'Times New Roman',
      primary: 'Times New Roman',
      family: DEFAULT,
      registered: false,
      substituted: true
    })
  })

  it("로드 실패 폴백 'Arial, sans-serif' → 기본 폰트로 대체", () => {
    const r = resolveFontFamily('Arial, sans-serif', registry, DEFAULT)
    expect(r).toMatchObject({ primary: 'Arial', family: DEFAULT, substituted: true })
  })

  it('기본 폰트가 등록돼 있지 않으면(목록 미로드) 대체하지 않고 원문을 유지한다', () => {
    const empty = registryOf()
    const r = resolveFontFamily('Times New Roman', empty, DEFAULT)
    expect(r).toMatchObject({ family: 'Times New Roman', registered: false, substituted: false })
  })

  it('기본 폰트 자신을 요청하면 등록 폰트로 해석된다(대체 아님)', () => {
    const r = resolveFontFamily(DEFAULT, registry, DEFAULT)
    expect(r).toMatchObject({ family: DEFAULT, registered: true, substituted: false })
  })

  it('빈 요청은 기본 폰트로 대체된다', () => {
    const r = resolveFontFamily('', registry, DEFAULT)
    expect(r).toMatchObject({ primary: '', family: DEFAULT, substituted: true })
  })
})
