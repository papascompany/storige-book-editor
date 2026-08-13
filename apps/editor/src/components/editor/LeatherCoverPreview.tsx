/**
 * 관리자 썸네일용 표지 미리보기 (2026-08-13: 고객 캔버스 대체 금지).
 * 고객 편집기는 표지 템플릿 캔버스를 그대로 보여 준다.
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
          페브릭 · 기성 표지
        </div>
        <p style={{ fontSize: 13, color: '#666', marginTop: 8, lineHeight: 1.5 }}>
          관리자 썸네일입니다. 고객 편집기는 표지 템플릿 캔버스(소재 배경)를 그대로 보여 줍니다.
          ({width} × {height} mm)
        </p>
      </div>
    </div>
  )
}
