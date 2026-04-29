import { memo, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BookMockup3DProps {
  coverImage?: string
  spineImage?: string
  backCoverImage?: string
  spineWidthMm: number
  coverWidthMm: number
  coverHeightMm: number
  onClose: () => void
}

/**
 * BookMockup3D - CSS 3D transform 기반 책 목업 모달
 *
 * MVP 버전: 간단한 3D 회전 뷰
 * - 앞표지, 책등, 뒷표지를 3D로 배치
 * - 회전 슬라이더로 각도 조절
 */
export const BookMockup3D = memo(function BookMockup3D({
  coverImage,
  spineImage,
  backCoverImage,
  spineWidthMm,
  coverWidthMm,
  coverHeightMm,
  onClose,
}: BookMockup3DProps) {
  const [rotationY, setRotationY] = useState(30) // 초기 회전 각도

  // 비율 유지를 위한 스케일 계산 (화면에 맞게)
  const maxHeight = 400
  const scale = maxHeight / coverHeightMm
  const coverWidth = coverWidthMm * scale
  const coverHeight = coverHeightMm * scale
  const spineWidth = spineWidthMm * scale

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-2xl p-6 max-w-4xl w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">3D 책 미리보기</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 3D 뷰 컨테이너 */}
        <div
          className="relative bg-gray-100 rounded-lg overflow-hidden"
          style={{ height: maxHeight + 100 }}
        >
          <div className="absolute inset-0 flex items-center justify-center perspective-1000">
            <div
              className="relative preserve-3d transition-transform duration-300"
              style={{
                transform: `rotateY(${rotationY}deg)`,
                transformStyle: 'preserve-3d',
              }}
            >
              {/* 앞표지 */}
              <div
                className="absolute bg-white shadow-lg border border-gray-300"
                style={{
                  width: coverWidth,
                  height: coverHeight,
                  transform: `translateZ(${spineWidth / 2}px)`,
                  backgroundImage: coverImage ? `url(${coverImage})` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                {!coverImage && (
                  <div className="flex items-center justify-center h-full text-gray-400">
                    앞표지
                  </div>
                )}
              </div>

              {/* 책등 */}
              <div
                className="absolute bg-white shadow-lg border border-gray-300"
                style={{
                  width: spineWidth,
                  height: coverHeight,
                  transform: `rotateY(90deg) translateZ(${coverWidth / 2}px)`,
                  transformOrigin: 'center center',
                  backgroundImage: spineImage ? `url(${spineImage})` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                {!spineImage && (
                  <div className="flex items-center justify-center h-full text-gray-400 text-xs">
                    책등
                  </div>
                )}
              </div>

              {/* 뒷표지 */}
              <div
                className="absolute bg-white shadow-lg border border-gray-300"
                style={{
                  width: coverWidth,
                  height: coverHeight,
                  transform: `translateZ(-${spineWidth / 2}px) rotateY(180deg)`,
                  backgroundImage: backCoverImage ? `url(${backCoverImage})` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                {!backCoverImage && (
                  <div className="flex items-center justify-center h-full text-gray-400">
                    뒷표지
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 회전 슬라이더 */}
        <div className="mt-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            회전 각도: {rotationY}°
          </label>
          <input
            type="range"
            min="-90"
            max="90"
            value={rotationY}
            onChange={(e) => setRotationY(Number(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>뒷표지</span>
            <span>정면</span>
            <span>앞표지</span>
          </div>
        </div>

        {/* 안내 */}
        <div className="mt-4 text-sm text-gray-500 text-center">
          슬라이더를 움직여 책을 회전시켜 보세요
        </div>
      </div>

      {/* 3D CSS 스타일 */}
      <style>{`
        .perspective-1000 {
          perspective: 1000px;
        }
        .preserve-3d {
          transform-style: preserve-3d;
        }
      `}</style>
    </div>
  )
})
