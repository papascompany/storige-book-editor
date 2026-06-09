import { describe, it, expect } from 'vitest'
import { cleanFontFamilyValue } from './svgTextToPath'

/**
 * Tests for font-family value normalization used by the PDF text→outline path.
 *
 * fabric.js (5.x) emits font-family in two shapes that convertSvgTextToPath must parse:
 *   - <text font-family="Nanum Gothic">  (root element, raw name)
 *   - <tspan style="font-family: 'Nanum Gothic';">  (per-run, single-quoted)
 *   - sometimes with a CSS fallback list: "'Foo', sans-serif"
 *
 * cleanFontFamilyValue must return the FIRST family name, unquoted, so that the
 * FontPlugin resolver (keyed by the loaded font name + NFD/NFC variants) can match it.
 */
describe('cleanFontFamilyValue', () => {
  it('returns a plain family name unchanged', () => {
    expect(cleanFontFamilyValue('Arial')).toBe('Arial')
  })

  it('strips single quotes', () => {
    expect(cleanFontFamilyValue("'Nanum Gothic'")).toBe('Nanum Gothic')
  })

  it('strips double quotes', () => {
    expect(cleanFontFamilyValue('"Nanum Gothic"')).toBe('Nanum Gothic')
  })

  it('takes only the first family from a CSS fallback list', () => {
    expect(cleanFontFamilyValue("'Nanum Gothic', sans-serif")).toBe('Nanum Gothic')
    expect(cleanFontFamilyValue('Arial, Helvetica, sans-serif')).toBe('Arial')
  })

  it('trims surrounding whitespace', () => {
    expect(cleanFontFamilyValue('  Spoqa Han Sans  ')).toBe('Spoqa Han Sans')
  })

  it('preserves internal spaces in the family name', () => {
    expect(cleanFontFamilyValue('Noto Sans KR')).toBe('Noto Sans KR')
  })

  it('handles Korean (multibyte) family names', () => {
    expect(cleanFontFamilyValue("'나눔고딕'")).toBe('나눔고딕')
    expect(cleanFontFamilyValue('맑은 고딕, sans-serif')).toBe('맑은 고딕')
  })

  it('returns null for empty / nullish input', () => {
    expect(cleanFontFamilyValue('')).toBeNull()
    expect(cleanFontFamilyValue(null)).toBeNull()
    expect(cleanFontFamilyValue(undefined)).toBeNull()
  })

  it('returns null when the value is only quotes / whitespace', () => {
    expect(cleanFontFamilyValue("''")).toBeNull()
    expect(cleanFontFamilyValue('   ')).toBeNull()
  })
})
