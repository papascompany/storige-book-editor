/**
 * jspdf 4.x 업그레이드 회귀 카나리 (2026-06-22).
 *
 * ServicePlugin._drawCropMarksAndBoxes 는 jspdf 의 **private API**
 * (internal.getCurrentPageInfo().pageContext + ctx.trimBox/bleedBox/mediaBox,
 *  internal.scaleFactor)에 의존해 인쇄 재단정보(TrimBox/BleedBox/MediaBox)를 주입한다.
 * jspdf 메이저 업그레이드(2.x→4.x) 시 이 내부 구조가 바뀌면 박스가 조용히 누락돼도
 * (try/catch 가 에러를 삼킴) PDF 는 정상 생성되어 시각/타입 테스트로는 못 잡는다.
 *
 * 이 테스트는 그 private API 시퀀스를 동일하게 재현해 생성 PDF 바이트에
 * /TrimBox /BleedBox /MediaBox 가 올바른 pt 치수로 출력되는지 검증한다 = API 생존 카나리.
 * (node 환경, DOM 불필요. svg2pdf 렌더 경로는 별도 — 시각 회귀는 PREVIEW 육안.)
 */
import { describe, it, expect } from 'vitest'
import { jsPDF } from 'jspdf'

describe('jspdf 4.x 박스주입 private API 카나리 (ServicePlugin._drawCropMarksAndBoxes)', () => {
  it('scaleFactor 가 mm→pt 배율(≈2.8346)을 노출한다', () => {
    const pdf = new jsPDF('p', 'mm', [216, 303])
    const internal: any = (pdf as any).internal
    expect(typeof internal?.scaleFactor).toBe('number')
    expect(internal.scaleFactor).toBeCloseTo(72 / 25.4, 3) // 2.8346 pt/mm
  })

  it('getCurrentPageInfo().pageContext 에 박스 주입 후 PDF 출력에 TrimBox/BleedBox/MediaBox 가 정확한 pt 치수로 포함된다', () => {
    // 210x297 trim + 3mm bleed = 216x303 작업사이즈(= ServicePlugin 게이트 ON 시나리오)
    const pageWidthMm = 216
    const pageHeightMm = 303
    const bleedMm = 3
    const pdf = new jsPDF('p', 'mm', [pageWidthMm, pageHeightMm])

    // ── ServicePlugin._drawCropMarksAndBoxes 의 박스주입 시퀀스 미러 ──
    const internal: any = (pdf as any).internal
    const scaleFactor: number = internal?.scaleFactor ?? 1
    const pageInfo = internal?.getCurrentPageInfo?.()
    const ctx = pageInfo?.pageContext
    expect(ctx).toBeTruthy() // ← 4.x 에서 private 구조 생존 확인(핵심 카나리)

    const sx = (mm: number) => mm * scaleFactor
    ctx.bleedBox = { bottomLeftX: 0, bottomLeftY: 0, topRightX: sx(pageWidthMm), topRightY: sx(pageHeightMm) }
    ctx.trimBox = {
      bottomLeftX: sx(bleedMm),
      bottomLeftY: sx(bleedMm),
      topRightX: sx(pageWidthMm - bleedMm),
      topRightY: sx(pageHeightMm - bleedMm),
    }
    if (ctx.mediaBox) {
      ctx.mediaBox.bottomLeftX = 0
      ctx.mediaBox.bottomLeftY = 0
      ctx.mediaBox.topRightX = sx(pageWidthMm)
      ctx.mediaBox.topRightY = sx(pageHeightMm)
    }

    // PDF 바이트 출력(기본 비압축 → 텍스트 검색 가능)
    const buf = pdf.output('arraybuffer')
    const pdfStr = Buffer.from(buf).toString('latin1')

    // 박스 키 존재(= putPage 가 pageContext 박스를 출력함 = private API 생존)
    expect(pdfStr).toMatch(/\/TrimBox/)
    expect(pdfStr).toMatch(/\/BleedBox/)
    expect(pdfStr).toMatch(/\/MediaBox/)

    // 치수 정합: 작업사이즈 = 216x303mm → pt. (소수 출력 가변성 대비 정수부로 검증)
    const wPt = Math.round(sx(pageWidthMm)) // 612
    const hPt = Math.round(sx(pageHeightMm)) // 859
    expect(wPt).toBe(612)
    expect(hPt).toBe(859)
    // MediaBox 가 작업사이즈 pt 를 담는다(정수부 포함 정규식)
    expect(pdfStr).toMatch(new RegExp(`/MediaBox\\s*\\[\\s*0\\s+0\\s+${wPt}`))
    // TrimBox 하한 = bleed(3mm≈8.5pt) 안쪽 → 0 이 아님
    expect(pdfStr).toMatch(/\/TrimBox\s*\[\s*8\.\d+\s+8\.\d+/)
  })

  it('compress:true(ServicePlugin 실사용) 에서도 박스주입이 생존하고 Flate 압축이 활성화된다', () => {
    // ServicePlugin 은 new jsPDF(orientation,'mm',[w,h], true) 로 생성한다(ⓐ, 2026-06-23):
    // jspdf 4.x 가 임베드 래스터를 기본 무압축 저장 → compress 로 콘텐츠/이미지 Flate.
    // 박스는 page dict 엔트리라 콘텐츠 스트림 압축과 무관하게 평문 출력되어야 한다.
    const pdf = new jsPDF('p', 'mm', [216, 303], true)
    pdf.setFillColor(0, 0, 0)
    pdf.rect(20, 20, 100, 100, 'F') // 콘텐츠 스트림이 비어있지 않게(=압축 대상 존재)

    const internal: any = (pdf as any).internal
    const sf: number = internal?.scaleFactor ?? 1
    const ctx = internal?.getCurrentPageInfo?.()?.pageContext
    expect(ctx).toBeTruthy()
    const sx = (mm: number) => mm * sf
    ctx.bleedBox = { bottomLeftX: 0, bottomLeftY: 0, topRightX: sx(216), topRightY: sx(303) }
    ctx.trimBox = { bottomLeftX: sx(3), bottomLeftY: sx(3), topRightX: sx(213), topRightY: sx(300) }
    if (ctx.mediaBox) {
      ctx.mediaBox.bottomLeftX = 0; ctx.mediaBox.bottomLeftY = 0
      ctx.mediaBox.topRightX = sx(216); ctx.mediaBox.topRightY = sx(303)
    }

    const pdfStr = Buffer.from(pdf.output('arraybuffer')).toString('latin1')
    // 박스 평문 생존(압축돼도 page dict 는 평문)
    expect(pdfStr).toMatch(/\/TrimBox/)
    expect(pdfStr).toMatch(/\/BleedBox/)
    expect(pdfStr).toMatch(/\/MediaBox/)
    // 압축 활성: 콘텐츠 스트림이 FlateDecode 로 인코딩됨(=무압축 회귀 방지)
    expect(pdfStr).toMatch(/\/FlateDecode/)
  })

  it('output(blob)/output(arraybuffer) 가 node 환경에서 동작한다(편집기 저장 경로 스모크)', () => {
    const pdf = new jsPDF('p', 'mm', [210, 297])
    const buf = pdf.output('arraybuffer')
    expect(buf.byteLength).toBeGreaterThan(0)
    // PDF 시그니처
    expect(Buffer.from(buf).toString('latin1').slice(0, 5)).toBe('%PDF-')
  })
})
