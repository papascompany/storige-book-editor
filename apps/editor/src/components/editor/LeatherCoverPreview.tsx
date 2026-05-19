/**
 * 레더 커버 미리보기 — 인쇄 워크플로우 v1 Phase 4-J (2026-05-19).
 *
 * templateSet.coverEditable === false 인 경우 표지 캔버스 대신 표시하는
 * 미리보기 이미지 컴포넌트. 표지는 빈 PDF 로 인쇄되고, 실제 표지 디자인은
 * 사전 인쇄된 레더 / 화보집 표지로 대체됨 (Phase 5 worker 단계에서 빈 PDF 생성).
 */
import { resolveStorageUrl } from '../../utils/fontManager'

interface Props {
  coverPreviewImage: string | null
  width: number  // mm
  height: number // mm
  /** 표시 영역 최대 px (작은 화면 대응) */
  maxDisplayPx?: number
}

export function LeatherCoverPreview({ coverPreviewImage, width, height, maxDisplayPx = 480 }: Props) {
  const url = coverPreviewImage ? resolveStorageUrl(coverPreviewImage) : null

  // 비율 유지하면서 maxDisplayPx 안에 맞추기 (1mm = ~3px 대략 표시용)
  const ratio = width / height
  const displayW = ratio >= 1 ? maxDisplayPx : Math.round(maxDisplayPx * ratio)
  const displayH = ratio >= 1 ? Math.round(maxDisplayPx / ratio) : maxDisplayPx

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 24,
        height: '100%',
        background: '#f5f5f5',
      }}
    >
      <div
        style={{
          width: displayW,
          height: displayH,
          background: url ? '#fff' : '#e0e0e0',
          backgroundImage: url ? `url(${url})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          border: '2px solid #999',
          borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#999',
          fontSize: 14,
        }}
      >
        {!url && <span>표지 미리보기 이미지 미등록</span>}
      </div>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#444' }}>
          레더 커버 (편집 불가)
        </div>
        <p style={{ fontSize: 13, color: '#666', marginTop: 8, lineHeight: 1.5 }}>
          이 표지는 사전 인쇄된 레더 커버 / 화보집 표지로 대체됩니다. 인쇄용 PDF 의 표지 페이지는 빈 페이지로 생성되며,
          위 이미지는 운영자가 등록한 표지 미리보기입니다. ({width} × {height} mm)
        </p>
      </div>
    </div>
  )
}
