/**
 * pdfPageGeometry — 다페이지 PDF 의 렌더/페이지 크기·오프셋 산출(순수 함수).
 *
 * ServicePlugin._createMultiPagePDF 가 페이지 기하를 이 헬퍼로 계산한다.
 * 모든 값의 단위는 mm 이다(contentWidthMm/HeightMm 는 단위 변환·봉투 크기 적용이 끝난 콘텐츠 크기).
 *
 * 우선순위:
 *  1) 싸바리 여분(wrapMm > 0, 봉투 아님): 렌더 = 페이지 = 콘텐츠 + 사방 wrapMm, 오프셋 0.
 *     printSize·재단 마커 옵션은 쓰지 않고 TrimBox/코너 마커도 넣지 않는다.
 *     workspace 사각형 클립은 렌더 크기로 임시 확장한다(page-outline 등 모양 클립은 확장하지 않는다).
 *  2) 작업사이즈(cropMarkEnabled && bleedMm > 0, 봉투 아님): 렌더 = 페이지 = 콘텐츠 + 사방 bleedMm.
 *  3) 그 밖: 렌더 = 콘텐츠, 페이지 = printSize(유효할 때) 또는 콘텐츠, 렌더는 페이지 중앙 배치.
 */

export interface PdfPageSizeOptions {
  width: number
  height: number
  cutSize: number
  printSize?: { width: number; height: number }
  /** 사방(per-edge) 블리드 mm. 작업사이즈 = 재단 + bleedMm*2. */
  bleedMm?: number
  /** 재단선(crop mark) 마커 표기 ON/OFF. */
  cropMarkEnabled?: boolean
  /** 사방(per-edge) 싸바리 여분 mm. 양수일 때 페이지 = 콘텐츠 + wrapMm*2. */
  wrapMm?: number
}

export interface PdfPageGeometry {
  /** SVG viewBox·svg2pdf 렌더 크기(mm) */
  renderWidth: number
  renderHeight: number
  /** PDF 페이지(MediaBox) 크기(mm) */
  pageWidth: number
  pageHeight: number
  /** 페이지 안 렌더 시작 위치(mm) */
  offsetX: number
  offsetY: number
  /** 작업사이즈(재단+블리드) 출력 여부 — true 일 때만 코너 마커·TrimBox/BleedBox 를 넣는다 */
  useEditSize: boolean
  /** 싸바리 여분 출력 여부 */
  wrapActive: boolean
  /** toSVG 동안 workspace 사각형 클립을 렌더 크기로 임시 확장할지 여부 */
  expandClip: boolean
  /** 코너 마커·박스 산출에 쓰는 사방 블리드 mm (싸바리 출력에서는 0) */
  bleedMm: number
}

export function computePdfPageGeometry(
  contentWidthMm: number,
  contentHeightMm: number,
  size: PdfPageSizeOptions,
  isEnvelope: boolean
): PdfPageGeometry {
  const wrapMm = size.wrapMm
  const wrapActive =
    !isEnvelope && typeof wrapMm === 'number' && Number.isFinite(wrapMm) && wrapMm > 0

  if (wrapActive) {
    const renderWidth = contentWidthMm + wrapMm * 2
    const renderHeight = contentHeightMm + wrapMm * 2
    return {
      renderWidth,
      renderHeight,
      pageWidth: renderWidth,
      pageHeight: renderHeight,
      offsetX: 0,
      offsetY: 0,
      useEditSize: false,
      wrapActive: true,
      expandClip: true,
      bleedMm: 0,
    }
  }

  const bleedMm = size.bleedMm ?? 0
  const useEditSize = !!size.cropMarkEnabled && bleedMm > 0 && !isEnvelope

  let renderWidth = contentWidthMm
  let renderHeight = contentHeightMm
  if (useEditSize) {
    renderWidth = contentWidthMm + bleedMm * 2
    renderHeight = contentHeightMm + bleedMm * 2
  }

  let pageWidth = useEditSize ? renderWidth : contentWidthMm
  let pageHeight = useEditSize ? renderHeight : contentHeightMm
  if (!useEditSize && size.printSize && size.printSize.width && size.printSize.height) {
    pageWidth = size.printSize.width
    pageHeight = size.printSize.height
  }

  return {
    renderWidth,
    renderHeight,
    pageWidth,
    pageHeight,
    offsetX: Math.max(0, (pageWidth - renderWidth) / 2),
    offsetY: Math.max(0, (pageHeight - renderHeight) / 2),
    useEditSize,
    wrapActive: false,
    expandClip: useEditSize,
    bleedMm,
  }
}
