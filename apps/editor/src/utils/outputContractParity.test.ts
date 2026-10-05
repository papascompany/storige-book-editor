/**
 * Track 1 (2026-07-06) — 출력 계약 경로 파리티 회귀 가드.
 *
 * embed.tsx(handleFinish/instance.complete)와 useWorkSave.completeSpreadWork 는 출력 크기
 * 산출 로직을 각자 보유해 한쪽만 고치면 경로별 출력 크기가 어긋나는 회귀 이력이 있다.
 * 이 테스트는 두 완료 경로가 공용 헬퍼(photobookSpread: resolveSpreadInnerPdfSizeMm /
 * computeCoverOutputSizeMm / computeLivePageCount, hardcoverWrap: buildCoverPdfSizeOpt /
 * buildCoverOutputMeta, buildSpreadSnapshots)를 **단일 진실원**으로 계속 사용하는지 소스 레벨에서
 * 고정하고, 양장 싸바리 모드의 출력 크기를 런타임으로 대조한다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { hardcoverCoverSpreadFromSpine, computeSpreadDimensions } from '@storige/types'
import {
  resolveHardcoverWrapMode,
  buildCoverPdfSizeOpt,
  buildCoverOutputMeta,
} from './hardcoverWrap'
import { computePdfPageOutputMm } from './pdfPageSize'
import { buildSpreadSnapshots } from './buildSpreadSnapshots'

const read = (rel: string): string =>
  readFileSync(resolve(__dirname, '..', rel), 'utf-8')

describe('출력 계약 단일 진실원 파리티 (D-1/D-4/D-3)', () => {
  const embedSrc = read('embed.tsx')
  const workSaveSrc = read('hooks/useWorkSave.ts')

  it('D-1·H1: 두 완료 경로 모두 content 페이지 크기를 resolveSpreadInnerPdfSizeMm(innerSpec → 싸바리 모드일 때만 판형 → 폴백)로 산출한다', () => {
    const innerPattern =
      /resolveSpreadInnerPdfSizeMm\(\{\s*spreadConfig: spreadCfg,\s*pageTrimMm: settingsAtFinish\.pageTrimMm,\s*hardcoverWrapActive: hardcoverWrap != null,/
    expect(embedSrc).toMatch(innerPattern)
    expect(workSaveSrc).toMatch(innerPattern)
    // 싸바리 모드가 아니면 content.pdf 크기 = 폴백. 경로별 폴백 순서(HEAD b987a81 과 동일)를 소스 수준에서 고정한다.
    // embed: 표지 spec 한 면 → 주문 옵션 → 210×297
    expect(embedSrc).toMatch(
      /hardcoverWrapActive: hardcoverWrap != null,\s*fallback: \{\s*widthMm: spreadCfg\?\.spec\?\.coverWidthMm \?\? options\?\.size\?\.width \?\? 210,\s*heightMm: spreadCfg\?\.spec\?\.coverHeightMm \?\? options\?\.size\?\.height \?\? 297,\s*\},\s*\}\)/,
    )
    // useWorkSave: 작품 sizeInfo → 210×297
    expect(workSaveSrc).toMatch(
      /hardcoverWrapActive: hardcoverWrap != null,\s*fallback: \{\s*widthMm: \(artwork as any\)\?\.sizeInfo\?\.width \?\? 210,\s*heightMm: \(artwork as any\)\?\.sizeInfo\?\.height \?\? 297,\s*\},\s*\}\)/,
    )
    // 두 경로 모두 같은 스토어 스냅샷(settingsAtFinish)에서 모드를 읽는다.
    const wrapPattern = /const hardcoverWrap = settingsAtFinish\.hardcoverWrap/
    expect(embedSrc).toMatch(wrapPattern)
    expect(workSaveSrc).toMatch(wrapPattern)
  })

  it('D-4: 두 완료 경로 모두 cover 출력 크기를 computeCoverOutputSizeMm 로 산출한다', () => {
    expect(embedSrc).toMatch(/computeCoverOutputSizeMm\(spreadCfg\)/)
    expect(workSaveSrc).toMatch(/computeCoverOutputSizeMm\(spreadCfg\)/)
  })

  it('D-4: 출력 크기는 printSize(페이지=wrap, 콘텐츠 중앙 배치) 메커니즘으로 주입된다', () => {
    // 두 경로 모두 buildCoverPdfSizeOpt 에 caseBind 출력 크기와 싸바리 모드를 넘긴다.
    const builderPattern = /buildCoverPdfSizeOpt\(\{[\s\S]*?hardcoverWrap,\s*caseBindOutput: coverOutputSize,\s*markOpt,\s*\}\)/
    expect(embedSrc).toMatch(builderPattern)
    expect(workSaveSrc).toMatch(builderPattern)
    // 헬퍼: caseBind 有 → printSize / 無 → markOpt 스프레드(byte-parity)
    const helperSrc = read('utils/hardcoverWrap.ts')
    expect(helperSrc).toMatch(
      /printSize:\s*\{\s*width:\s*caseBindOutput\.widthMm,\s*height:\s*caseBindOutput\.heightMm\s*\}\s*\}\s*:\s*i\.markOpt/,
    )
  })

  it('두 완료 경로 모두 스냅샷에 싸바리 여분(hardcoverWrapMm)을 넘긴다', () => {
    const snapshotPattern = /innerCanvases\.length,\s*\{\s*hardcoverWrapMm: hardcoverWrap\?\.wrapPerSideMm\s*\},?\s*\)/
    expect(embedSrc).toMatch(snapshotPattern)
    expect(workSaveSrc).toMatch(snapshotPattern)
  })

  it('D-3: embed 의 complete 2경로와 pricingChange 가 computeLivePageCount 를 공유한다', () => {
    const matches = embedSrc.match(/computeLivePageCount\(/g) ?? []
    // instance.complete + handleFinish + pricingChange emit = 최소 3회
    expect(matches.length).toBeGreaterThanOrEqual(3)
    // 구식 인라인 산식(× 2 직접 계산)이 재유입되지 않았는지
    expect(embedSrc).not.toMatch(/liveCanvasCount\s*\*\s*2/)
  })

  it('D-3: editor.pricingChange 는 additive 이벤트로 선언되어 있다', () => {
    expect(embedSrc).toContain("'editor.pricingChange'")
  })

  it('S9: 책등 재계산 확정값 재발신은 shouldReemitPricing 판단을 거친다', () => {
    expect(embedSrc).toMatch(/useSettingsStore\.subscribe\(/)
    expect(embedSrc).toMatch(/shouldReemitPricing\(lastEmitted,\s*current\)/)
  })

  it('R-195: metadata.coverOutput 은 표지 PDF 에 넘긴 동일 size 객체로 산출한다', () => {
    // 표지 PDF 호출이 coverPdfSizeOpt 를 그대로 넘기고, coverOutput 도 같은 객체를 입력으로 쓴다.
    expect(embedSrc).toMatch(/`cover-\$\{currentSessionId\}`,\s*coverPdfSizeOpt,/)
    expect(embedSrc).toMatch(/buildCoverOutputMeta\(coverPdfSizeOpt, hardcoverWrap\)/)
  })
})

describe('양장 싸바리 모드 출력 크기 — 두 완료 경로 대조', () => {
  /** 판형·책등별 표지 spec(면 = 판형 + 8, 화면 cutSize 는 로더가 40 으로 덮어쓴 상태) */
  const cases = [
    { trimW: 210, trimH: 297, spine: 8, golden: { w: 484, h: 345 } },
    { trimW: 210, trimH: 210, spine: 8, golden: { w: 484, h: 258 } },
    { trimW: 210, trimH: 210, spine: 9, golden: { w: 485, h: 258 } },
  ]
  const markOpt = { bleedMm: 3, cropMarkEnabled: true }

  for (const c of cases) {
    it(`${c.trimW}×${c.trimH} 책등 ${c.spine}: 표지 size·스냅샷 output 이 두 경로에서 같고 싸바리 전개 ${c.golden.w}×${c.golden.h} 와 같다`, () => {
      const { mode } = resolveHardcoverWrapMode({
        coverType: 'hardcover_wrap',
        hasCaseBind: false,
        isInnerOnly: false,
        templateSetSize: { width: c.trimW, height: c.trimH },
        spec: { coverWidthMm: c.trimW + 8, coverHeightMm: c.trimH + 8, wingEnabled: false, cutSizeMm: 2 },
      })
      expect(mode).not.toBeNull()
      const spec = {
        coverWidthMm: c.trimW + 8,
        coverHeightMm: c.trimH + 8,
        spineWidthMm: c.spine,
        wingEnabled: false,
        wingWidthMm: 0,
        cutSizeMm: mode!.screenCutSizeMm,
        safeSizeMm: 3,
        dpi: 150,
      }
      const dims = computeSpreadDimensions(spec)

      // embed: cutSize = 주문 bleed(기본 3), useWorkSave: cutSize = 상수 3 — 페이지 크기에는 쓰이지 않는다.
      const embedOpt = buildCoverPdfSizeOpt({
        contentWidthMm: dims.totalWidthMm,
        contentHeightMm: dims.totalHeightMm,
        cutSize: 5,
        hardcoverWrap: mode,
        caseBindOutput: null,
        markOpt,
      })
      const workSaveOpt = buildCoverPdfSizeOpt({
        contentWidthMm: dims.totalWidthMm,
        contentHeightMm: dims.totalHeightMm,
        cutSize: 3,
        hardcoverWrap: mode,
        caseBindOutput: null,
        markOpt,
      })
      for (const opt of [embedOpt, workSaveOpt]) {
        expect(opt.width).toBe(dims.totalWidthMm)
        expect(opt.height).toBe(dims.totalHeightMm)
        expect(opt.wrapMm).toBe(20)
        expect('printSize' in opt).toBe(false)
        expect('bleedMm' in opt).toBe(false)
        expect('cropMarkEnabled' in opt).toBe(false)
      }
      expect(computePdfPageOutputMm(embedOpt)).toEqual(computePdfPageOutputMm(workSaveOpt))

      // coverOutput 은 embed 경로만 기록한다.
      const expected = hardcoverCoverSpreadFromSpine({ widthMm: c.trimW, heightMm: c.trimH, spineMm: c.spine })
      const coverOutput = buildCoverOutputMeta(embedOpt, mode)
      expect(coverOutput).toEqual({
        widthMm: expected.totalWMm,
        heightMm: expected.totalHMm,
        bleedMm: 0,
        layout: 'hardcover-wrap',
        trimWidthMm: c.trimW,
        trimHeightMm: c.trimH,
        wrapMm: 20,
      })
      expect({ w: coverOutput.widthMm, h: coverOutput.heightMm }).toEqual(c.golden)

      // 스냅샷: 두 경로 모두 같은 함수·같은 opts.
      const spineCfg = { paperType: 'mojo_80g', bindingType: 'hardcover', calculatedSpineWidth: c.spine }
      const snap = buildSpreadSnapshots({ spec }, spineCfg, 24, { hardcoverWrapMm: mode!.wrapPerSideMm })
      expect(snap.spread!.outputWidthMm).toBe(expected.totalWMm)
      expect(snap.spread!.outputHeightMm).toBe(expected.totalHMm)
    })
  }
})
