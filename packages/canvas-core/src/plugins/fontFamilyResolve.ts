/**
 * 폰트 패밀리 해석 — 미등록 패밀리의 기본 폰트 대체(별칭 폴백).
 *
 * 배경(2026-11-05): 텍스트 객체의 fontFamily 가 폰트 라이브러리에 없는 이름이면
 * (fabric 기본값 'Times New Roman', 로드 실패 폴백 'Arial, sans-serif', 삭제·비활성화된
 * 라이브러리 폰트 등) FontPlugin 이 TTF 를 구하지 못해 PDF 저장 시 텍스트가 벡터화되지 않고
 * 화면 크기 2배 래스터(PNG)로 떨어졌다. 인쇄 해상도에 못 미치고 사용자는 그 사실을 알 수 없었다.
 *
 * 이 모듈은 순수 함수만 둔다(DOM·네트워크 없음) — FontPlugin 의 세 경로(객체 폰트 적용·사전 로드·
 * TTF 조회)가 같은 규칙으로 패밀리를 해석하도록 한 곳에 모은다.
 *
 * 규칙:
 *  1. CSS font-family 목록(`'Arial, sans-serif'`, `"Noto Sans KR"`)은 첫 항목만 취하고 따옴표를 뗀다.
 *  2. 첫 항목이 라이브러리에 등록돼 있으면(NFC/NFD 어느 변형이든) 그 이름을 그대로 쓴다.
 *  3. 등록돼 있지 않고 **기본 폰트가 등록돼 있으면** 기본 폰트로 대체한다(`substituted: true`).
 *  4. 기본 폰트조차 등록돼 있지 않으면(라이브러리 목록 미로드·빈 목록) 대체하지 않고 종전처럼
 *     요청 이름을 돌려준다 — 목록이 일시적으로 비었을 때 문서의 모든 폰트를 기본 폰트로
 *     덮어쓰는 사고를 막는 가드다.
 */

export interface FontFamilyResolution {
  /** 호출자가 넘긴 원문(CSS 목록·따옴표 포함 가능) */
  requested: string
  /** 원문에서 뽑은 첫 패밀리(따옴표·공백 제거) */
  primary: string
  /** 실제로 적용·조회할 패밀리 */
  family: string
  /** `primary` 가 라이브러리에 등록돼 있는가 */
  registered: boolean
  /** 기본 폰트로 대체됐는가(= !registered && 기본 폰트 등록됨) */
  substituted: boolean
}

export interface FontRegistry {
  /** 정확한 이름(정규화 변형 중 하나)으로 등록 여부를 본다 */
  has(name: string): boolean
}

const normalizeSafe = (text: string, form: 'NFC' | 'NFD'): string => {
  try {
    return text.normalize(form)
  } catch {
    return text
  }
}

/** NFC/NFD 변형(중복 제거) — FontPlugin.getNormalizedVariants 와 같은 규칙 */
export const fontNameVariants = (name: string): string[] => {
  const trimmed = name.trim()
  const nfc = normalizeSafe(trimmed, 'NFC')
  const nfd = normalizeSafe(trimmed, 'NFD')
  return nfc === nfd ? [nfc] : [nfc, nfd]
}

/**
 * CSS font-family 값에서 첫 패밀리를 뽑는다.
 *  - `'Arial, sans-serif'` → `Arial`
 *  - `"Noto Sans KR", sans-serif` → `Noto Sans KR`
 *  - `  본고딕(Noto Sans) Regular ` → `본고딕(Noto Sans) Regular`
 * 빈 문자열이면 빈 문자열을 돌려준다.
 */
export const parsePrimaryFontFamily = (value: string): string => {
  if (typeof value !== 'string') return ''
  const first = value.split(',')[0] ?? ''
  return first.trim().replace(/^['"]+|['"]+$/g, '').trim()
}

export const isFontRegistered = (registry: FontRegistry, name: string): boolean => {
  if (!name) return false
  return fontNameVariants(name).some((variant) => registry.has(variant))
}

export const resolveFontFamily = (
  requested: string,
  registry: FontRegistry,
  defaultFont: string
): FontFamilyResolution => {
  const primary = parsePrimaryFontFamily(requested)

  if (isFontRegistered(registry, primary)) {
    return { requested, primary, family: primary, registered: true, substituted: false }
  }

  const fallback = parsePrimaryFontFamily(defaultFont)
  if (fallback && isFontRegistered(registry, fallback)) {
    return { requested, primary, family: fallback, registered: false, substituted: true }
  }

  return { requested, primary, family: primary || requested, registered: false, substituted: false }
}
