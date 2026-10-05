import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  HARDCOVER_WRAP_MARGIN_MM,
  HARDCOVER_WRAP_PER_SIDE_MM,
  hardcoverCoverSpreadFromSpine,
} from '@storige/types'
import {
  canvasDataHasPageOutline,
  resolveHardcoverWrapMode,
  resolveInnerPageCutSizeMm,
  buildCoverPdfSizeOpt,
  buildCoverOutputMeta,
  type HardcoverWrapMode,
  type ResolveHardcoverWrapModeInput,
} from './hardcoverWrap'
import { computePdfPageOutputMm } from './pdfPageSize'

/** 판형 210×297, 표지 한 면 218×305(판형+8), 날개 없음, 화면 cutSize 2 */
const onInput: ResolveHardcoverWrapModeInput = {
  coverType: 'hardcover_wrap',
  hasCaseBind: false,
  isInnerOnly: false,
  templateSetSize: { width: 210, height: 297 },
  spec: { coverWidthMm: 218, coverHeightMm: 305, wingEnabled: false, cutSizeMm: 2 },
  hasPageOutline: false,
}

const onMode: HardcoverWrapMode = {
  trimWidthMm: 210,
  trimHeightMm: 297,
  wrapPerSideMm: HARDCOVER_WRAP_PER_SIDE_MM,
  screenCutSizeMm: HARDCOVER_WRAP_MARGIN_MM,
  innerCutSizeMm: 2,
}

/** 기존 embed/useWorkSave 인라인 표지 size 식 사본 */
function legacyCoverSizeOpt(
  width: number,
  height: number,
  cutSize: number,
  caseBindOutput: { widthMm: number; heightMm: number } | null,
  markOpt: { bleedMm?: number; cropMarkEnabled?: boolean },
) {
  return {
    width,
    height,
    cutSize,
    ...(caseBindOutput
      ? { printSize: { width: caseBindOutput.widthMm, height: caseBindOutput.heightMm } }
      : markOpt),
  }
}

describe('resolveHardcoverWrapMode — 판정', () => {
  it('hardcover_wrap · caseBind 없음 · 날개 없음 · 면=판형+8 → 켜짐', () => {
    expect(resolveHardcoverWrapMode(onInput)).toEqual({ mode: onMode })
    expect(HARDCOVER_WRAP_PER_SIDE_MM).toBe(20)
    expect(HARDCOVER_WRAP_MARGIN_MM).toBe(40)
  })

  it('coverType 이 hardcover_wrap 이 아니면 NOT_HARDCOVER_WRAP', () => {
    for (const coverType of [null, undefined, '', 'softcover', 'HARDCOVER_WRAP']) {
      expect(resolveHardcoverWrapMode({ ...onInput, coverType })).toEqual({
        mode: null,
        reason: 'NOT_HARDCOVER_WRAP',
      })
    }
  })

  it('caseBind 가 있으면 CASE_BIND', () => {
    expect(resolveHardcoverWrapMode({ ...onInput, hasCaseBind: true })).toEqual({ mode: null, reason: 'CASE_BIND' })
  })

  it('내지 전용 세트면 INNER_ONLY', () => {
    expect(resolveHardcoverWrapMode({ ...onInput, isInnerOnly: true })).toEqual({ mode: null, reason: 'INNER_ONLY' })
  })

  it('날개가 켜져 있으면 WING', () => {
    expect(
      resolveHardcoverWrapMode({ ...onInput, spec: { ...onInput.spec!, wingEnabled: true } }),
    ).toEqual({ mode: null, reason: 'WING' })
  })

  it('판형이 없거나 비정상이면 NO_TRIM', () => {
    for (const templateSetSize of [
      null,
      undefined,
      { width: 0, height: 297 },
      { width: 210, height: Number.NaN },
      { width: Number.POSITIVE_INFINITY, height: 297 },
    ]) {
      expect(resolveHardcoverWrapMode({ ...onInput, templateSetSize })).toEqual({ mode: null, reason: 'NO_TRIM' })
    }
  })

  it('표지 면 ≠ 판형+8 이면 FACE_MISMATCH (면=판형 세트 포함)', () => {
    expect(
      resolveHardcoverWrapMode({ ...onInput, spec: { ...onInput.spec!, coverWidthMm: 210, coverHeightMm: 297 } }),
    ).toEqual({ mode: null, reason: 'FACE_MISMATCH' })
    expect(resolveHardcoverWrapMode({ ...onInput, spec: null })).toEqual({ mode: null, reason: 'FACE_MISMATCH' })
  })

  it('면 대조 허용 오차 ±0.2mm 경계', () => {
    const withFace = (w: number, h: number) =>
      resolveHardcoverWrapMode({ ...onInput, spec: { ...onInput.spec!, coverWidthMm: w, coverHeightMm: h } })
    expect(withFace(218.2, 305).mode).not.toBeNull()
    expect(withFace(217.8, 304.8).mode).not.toBeNull()
    expect(withFace(218.25, 305)).toEqual({ mode: null, reason: 'FACE_MISMATCH' })
    expect(withFace(218, 304.75)).toEqual({ mode: null, reason: 'FACE_MISMATCH' })
  })

  it('표지에 외곽선이 있으면 PAGE_OUTLINE (다른 조건이 모두 켜짐일 때만 이 사유)', () => {
    expect(resolveHardcoverWrapMode({ ...onInput, hasPageOutline: true })).toEqual({
      mode: null,
      reason: 'PAGE_OUTLINE',
    })
    expect(resolveHardcoverWrapMode({ ...onInput, coverType: null, hasPageOutline: true })).toEqual({
      mode: null,
      reason: 'NOT_HARDCOVER_WRAP',
    })
    expect(
      resolveHardcoverWrapMode({
        ...onInput,
        hasPageOutline: true,
        spec: { ...onInput.spec!, coverWidthMm: 210, coverHeightMm: 297 },
      }),
    ).toEqual({ mode: null, reason: 'FACE_MISMATCH' })
  })
})

describe('canvasDataHasPageOutline — 표지 외곽선 탐지', () => {
  const ws = { id: 'workspace', type: 'rect' }

  it('최상위 objects 의 id outline · page-outline 을 찾는다', () => {
    expect(canvasDataHasPageOutline({ objects: [ws, { id: 'outline', type: 'path' }] })).toBe(true)
    expect(canvasDataHasPageOutline({ objects: [ws, { id: 'page-outline', type: 'rect' }] })).toBe(true)
  })

  it('그룹 안 · 캔버스 배열 · JSON 문자열도 본다', () => {
    const grouped = { objects: [ws, { type: 'group', objects: [{ id: 'img' }, { id: 'outline' }] }] }
    expect(canvasDataHasPageOutline(grouped)).toBe(true)
    expect(canvasDataHasPageOutline([{ objects: [ws] }, grouped])).toBe(true)
    expect(canvasDataHasPageOutline(JSON.stringify(grouped))).toBe(true)
  })

  it('외곽선이 없거나 데이터가 비어 있거나 깨져 있으면 false', () => {
    expect(canvasDataHasPageOutline({ objects: [ws, { id: 'outline-2' }, { id: 'cutline' }] })).toBe(false)
    expect(canvasDataHasPageOutline({ objects: [] })).toBe(false)
    for (const v of [null, undefined, '', '{not json', 0, {}]) {
      expect(canvasDataHasPageOutline(v)).toBe(false)
    }
  })
})

describe('resolveInnerPageCutSizeMm — 낱장 내지 workspace cutSize', () => {
  it('모드가 꺼져 있으면 입력값 그대로', () => {
    expect(resolveInnerPageCutSizeMm(2, null)).toBe(2)
    expect(resolveInnerPageCutSizeMm(6, undefined)).toBe(6)
  })

  it('모드가 켜져 있으면 표지 덮어쓰기 전 값(innerCutSizeMm)', () => {
    expect(resolveInnerPageCutSizeMm(HARDCOVER_WRAP_MARGIN_MM, onMode)).toBe(2)
  })

  it('P3 게이트 ON 세트(bleed 3 → 화면 cutSize 6): 내지 = 6, 표지 PDF 는 wrap 만(재단 마커 옵션 없음)', () => {
    const p3 = resolveHardcoverWrapMode({ ...onInput, spec: { ...onInput.spec!, cutSizeMm: 3 * 2 } })
    expect(p3.mode).not.toBeNull()
    expect(p3.mode!.screenCutSizeMm).toBe(40)
    expect(resolveInnerPageCutSizeMm(p3.mode!.screenCutSizeMm, p3.mode)).toBe(6)
    const sizeOpt = buildCoverPdfSizeOpt({
      contentWidthMm: 444,
      contentHeightMm: 305,
      cutSize: 3,
      hardcoverWrap: p3.mode,
      caseBindOutput: null,
      markOpt: { bleedMm: 3, cropMarkEnabled: true },
    })
    expect(sizeOpt).toEqual({ width: 444, height: 305, cutSize: 3, wrapMm: 20 })
  })

  it('모드가 꺼진 세트에 템플릿 cutSize 40 이 저장돼 있어도 기존 값 그대로', () => {
    const off = resolveHardcoverWrapMode({ ...onInput, coverType: null, spec: { ...onInput.spec!, cutSizeMm: 40 } })
    expect(off.mode).toBeNull()
    expect(resolveInnerPageCutSizeMm(40, off.mode)).toBe(40)
    const markOpt = { bleedMm: 3, cropMarkEnabled: true }
    expect(
      buildCoverPdfSizeOpt({
        contentWidthMm: 444,
        contentHeightMm: 305,
        cutSize: 3,
        hardcoverWrap: off.mode,
        caseBindOutput: null,
        markOpt,
      }),
    ).toEqual(legacyCoverSizeOpt(444, 305, 3, null, markOpt))
  })
})

describe('buildCoverPdfSizeOpt — 표지 PDF size 옵션', () => {
  const markOn = { bleedMm: 3, cropMarkEnabled: true }
  const markUnset = { bleedMm: undefined, cropMarkEnabled: undefined }

  it('모드 null · caseBind 없음 → 기존 식과 deep-equal (markOpt 키 포함)', () => {
    for (const markOpt of [markOn, markUnset]) {
      const out = buildCoverPdfSizeOpt({
        contentWidthMm: 430,
        contentHeightMm: 297,
        cutSize: 3,
        hardcoverWrap: null,
        caseBindOutput: null,
        markOpt,
      })
      expect(out).toStrictEqual(legacyCoverSizeOpt(430, 297, 3, null, markOpt))
    }
  })

  it('모드 null · caseBind 출력 있음 → printSize 경로, 기존 식과 deep-equal', () => {
    const caseBindOutput = { widthMm: 470, heightMm: 337 }
    const out = buildCoverPdfSizeOpt({
      contentWidthMm: 430,
      contentHeightMm: 297,
      cutSize: 3,
      hardcoverWrap: null,
      caseBindOutput,
      markOpt: markOn,
    })
    expect(out).toStrictEqual(legacyCoverSizeOpt(430, 297, 3, caseBindOutput, markOn))
  })

  it('싸바리 모드 → { width, height, cutSize, wrapMm } 만', () => {
    const out = buildCoverPdfSizeOpt({
      contentWidthMm: 444,
      contentHeightMm: 305,
      cutSize: 3,
      hardcoverWrap: onMode,
      caseBindOutput: null,
      markOpt: markOn,
    })
    expect(out).toStrictEqual({ width: 444, height: 305, cutSize: 3, wrapMm: 20 })
  })
})

describe('buildCoverOutputMeta — metadata.coverOutput', () => {
  it('모드 null → computePdfPageOutputMm 결과와 같다', () => {
    const sizeOpt = legacyCoverSizeOpt(430, 297, 3, null, { bleedMm: 3, cropMarkEnabled: true })
    expect(buildCoverOutputMeta(sizeOpt, null)).toStrictEqual(computePdfPageOutputMm(sizeOpt))
  })

  it('A4 책등 8: 싸바리 전개 484×345 + layout·판형·wrapMm', () => {
    const sizeOpt = buildCoverPdfSizeOpt({
      contentWidthMm: 218 * 2 + 8,
      contentHeightMm: 305,
      cutSize: 3,
      hardcoverWrap: onMode,
      caseBindOutput: null,
      markOpt: {},
    })
    const meta = buildCoverOutputMeta(sizeOpt, onMode)
    expect(meta).toStrictEqual({
      widthMm: 484,
      heightMm: 345,
      bleedMm: 0,
      layout: 'hardcover-wrap',
      trimWidthMm: 210,
      trimHeightMm: 297,
      wrapMm: 20,
    })
    const expected = hardcoverCoverSpreadFromSpine({ widthMm: 210, heightMm: 297, spineMm: 8 })
    expect(meta.widthMm).toBe(expected.totalWMm)
    expect(meta.heightMm).toBe(expected.totalHMm)
  })

  it('모드는 있으나 size 객체에 wrapMm 가 없으면 싸바리 키를 붙이지 않는다', () => {
    const sizeOpt = { width: 444, height: 305, cutSize: 3 }
    expect(buildCoverOutputMeta(sizeOpt, onMode)).toStrictEqual(computePdfPageOutputMm(sizeOpt))
  })
})

describe('싸바리 모드 상태 리셋 결선 (useEditorContents)', () => {
  const src = readFileSync(resolve(__dirname, '..', 'hooks/useEditorContents.ts'), 'utf-8')

  it('로더가 spreadConfig 를 비우는 진입점(상품·일반)은 hardcoverWrap 도 null 로 되돌린다', () => {
    const resetPair =
      /useSettingsStore\.getState\(\)\.setSpreadConfig\(null\)\s*\n\s*useSettingsStore\.getState\(\)\.setHardcoverWrap\(null\)/g
    expect((src.match(resetPair) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('템플릿셋 로더는 판형 설정 직후 hardcoverWrap 을 null 로 되돌린다', () => {
    expect(src).toMatch(
      /setPageTrimMm\(\{ width: templateSet\.width, height: templateSet\.height \}\)[\s\S]{0,200}setHardcoverWrap\(null\)/,
    )
  })

  it('스프레드 로더는 판정 결과를 저장하고 SpreadPlugin 두 경로에 relocationBounds 를 넘긴다', () => {
    expect(src).toMatch(/setHardcoverWrap\(hardcoverWrap\)/)
    expect(src).toMatch(/hasPageOutline: canvasDataHasPageOutline\(spreadTemplate\.canvasData\)/)
    expect(src).toMatch(/adoptCoverSpec\(spreadSpec, templateConversionMode, \{ relocationBounds \}\)/)
    expect(src).toMatch(/regionScope: 'cover',\s*relocationBounds,/)
  })
})

describe('내지 추가 cutSize 결선 (useAppStore.addInnerPage)', () => {
  const src = readFileSync(resolve(__dirname, '..', 'stores/useAppStore.ts'), 'utf-8')

  it('판형 분기와 스프레드 분기 모두 내지 cutSize 를 resolveInnerPageCutSizeMm 로 정한다', () => {
    expect(src).toMatch(
      /cutSize: resolveInnerPageCutSizeMm\(currentSettings\.size\.cutSize, settingsStore\.hardcoverWrap\)/,
    )
    expect(src).toMatch(
      /cutSize: resolveInnerPageCutSizeMm\(spreadConfig\.spec\.cutSizeMm, settingsStore\.hardcoverWrap\)/,
    )
  })
})
