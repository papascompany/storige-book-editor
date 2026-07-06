/**
 * Track 1 (2026-07-06) — 출력 계약 경로 파리티 회귀 가드.
 *
 * embed.tsx(handleFinish/instance.complete)와 useWorkSave.completeSpreadWork 는 출력 크기
 * 산출 로직을 각자 보유해 한쪽만 고치면 경로별 출력 크기가 어긋나는 회귀 이력이 있다.
 * 이 테스트는 두 완료 경로가 photobookSpread 헬퍼(computeInnerContentSizeMm /
 * computeCoverOutputSizeMm / computeLivePageCount)를 **단일 진실원**으로 계속 사용하는지
 * 소스 레벨에서 고정한다(런타임 파리티는 photobookSpread.test.ts 의 순수함수 테스트가 보증).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string): string =>
  readFileSync(resolve(__dirname, '..', rel), 'utf-8')

describe('출력 계약 단일 진실원 파리티 (D-1/D-4/D-3)', () => {
  const embedSrc = read('embed.tsx')
  const workSaveSrc = read('hooks/useWorkSave.ts')

  it('D-1: 두 완료 경로 모두 content 페이지 크기를 computeInnerContentSizeMm 로 산출한다', () => {
    expect(embedSrc).toMatch(/computeInnerContentSizeMm\(spreadCfg\)/)
    expect(workSaveSrc).toMatch(/computeInnerContentSizeMm\(spreadCfg\)/)
  })

  it('D-4: 두 완료 경로 모두 cover 출력 크기를 computeCoverOutputSizeMm 로 산출한다', () => {
    expect(embedSrc).toMatch(/computeCoverOutputSizeMm\(spreadCfg\)/)
    expect(workSaveSrc).toMatch(/computeCoverOutputSizeMm\(spreadCfg\)/)
  })

  it('D-4: 출력 크기는 printSize(페이지=wrap, 콘텐츠 중앙 배치) 메커니즘으로 주입된다', () => {
    // caseBind 有 → printSize / 無 → 기존 markOpt 스프레드(byte-parity) 패턴 유지
    const printSizePattern = /printSize:\s*\{\s*width:\s*coverOutputSize\.widthMm,\s*height:\s*coverOutputSize\.heightMm\s*\}/
    expect(embedSrc).toMatch(printSizePattern)
    expect(workSaveSrc).toMatch(printSizePattern)
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
})
