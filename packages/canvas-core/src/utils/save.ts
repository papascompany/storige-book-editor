// 앱 컴포넌트 또는 스토어에서 사용할 코드

/**
 * 여러 PDF Blob을 하나로 병합하는 함수
 * @param pdfBlobs PDF Blob 배열
 * @param fileName 저장할 파일명
 */
async function mergeAndSavePDFs(
  pdfBlobs: Blob[],
  fileName: string = 'merged_project'
): Promise<void> {
  try {
    // pdf-lib 지연 로드 (번들 절단: Track A) — 이 함수 최초 호출 시에만 로드
    const { PDFDocument } = await import('pdf-lib')

    // 새 PDF 문서 생성
    const mergedPdf = await PDFDocument.create()

    // 각 Blob을 병합
    for (const blob of pdfBlobs) {
      // Blob을 ArrayBuffer로 변환
      const arrayBuffer = await blob.arrayBuffer()

      // PDF 문서 로드
      const pdf = await PDFDocument.load(arrayBuffer)

      // 페이지 복사
      const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices())

      // 복사한 페이지 추가
      pages.forEach((page) => {
        mergedPdf.addPage(page)
      })
    }

    // PDF Uint8Array로 저장
    const mergedPdfBytes = await mergedPdf.save()

    // Blob 생성 - Convert to proper ArrayBuffer type
    const mergedBlob = new Blob([new Uint8Array(mergedPdfBytes)], { type: 'application/pdf' })

    // 파일 다운로드
    const link = document.createElement('a')
    link.href = URL.createObjectURL(mergedBlob)
    link.download = `${fileName}.pdf`
    link.click()

    // 리소스 정리
    URL.revokeObjectURL(link.href)
  } catch (error) {
    console.error('PDF 병합 중 오류:', error)
    throw error
  }
}

export { mergeAndSavePDFs }
