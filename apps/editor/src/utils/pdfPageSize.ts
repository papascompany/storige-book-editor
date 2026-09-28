/**
 * PDF 페이지 크기(mm) 산출 — canvas-core ServicePlugin.saveMultiPagePDFAsBlob 의 페이지 크기
 * 결정 로직을 그대로 미러링한 순수 함수 (R-195, 2026-09-28).
 *
 * 용도: 스프레드 완료 시 metadata.coverOutput 에 "생성된 표지 PDF 의 실제 페이지 크기와
 * 사방 블리드"를 기록한다. 반드시 saveMultiPagePDFAsBlob 에 넘긴 **같은 size 객체**를 입력한다.
 *
 * ServicePlugin 규칙(mm 단위, 봉투 아님):
 *  - useEditSize = !!cropMarkEnabled && bleedMm > 0
 *    → 페이지 = 콘텐츠 + bleedMm*2 (printSize 무시), 사방 블리드 = bleedMm
 *  - 아니면 printSize(width·height 모두 truthy)가 있으면 페이지 = printSize, 블리드 0
 *  - 아니면 페이지 = 콘텐츠, 블리드 0 (cutSize 는 페이지 크기에 더해지지 않는다)
 *
 * ⚠️ ServicePlugin 쪽 규칙이 바뀌면 이 함수도 함께 바꿔야 한다(pdfPageSize.test.ts 가 고정).
 */
import { roundMm01 } from '@storige/types'

export interface PdfSizeInput {
  width: number
  height: number
  cutSize?: number
  bleedMm?: number
  cropMarkEnabled?: boolean
  printSize?: { width: number; height: number }
}

export interface PdfPageOutputMm {
  widthMm: number
  heightMm: number
  /** 페이지에 실제로 더해진 사방(per-edge) 블리드 mm. 작업사이즈 게이트 OFF 면 0 */
  bleedMm: number
}

export function computePdfPageOutputMm(size: PdfSizeInput): PdfPageOutputMm {
  const bleed = size.bleedMm ?? 0
  const useEditSize = !!size.cropMarkEnabled && bleed > 0
  let pageWidth = size.width
  let pageHeight = size.height
  if (useEditSize) {
    pageWidth = size.width + bleed * 2
    pageHeight = size.height + bleed * 2
  } else if (size.printSize && size.printSize.width && size.printSize.height) {
    pageWidth = size.printSize.width
    pageHeight = size.printSize.height
  }
  return {
    widthMm: roundMm01(pageWidth),
    heightMm: roundMm01(pageHeight),
    bleedMm: useEditSize ? roundMm01(bleed) : 0,
  }
}
