import { memo } from 'react'
import { AlertCircle as WarningCircle, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PageLimitModalProps {
  isOpen: boolean
  type: 'min' | 'max'
  currentCount: number
  limitCount: number
  onClose: () => void
}

/**
 * 페이지 수량 제한 알림 모달
 */
export const PageLimitModal = memo(function PageLimitModal({
  isOpen,
  type,
  currentCount,
  limitCount,
  onClose,
}: PageLimitModalProps) {
  if (!isOpen) return null

  const isMin = type === 'min'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full mx-4 overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center',
              isMin ? 'bg-yellow-100' : 'bg-orange-100'
            )}>
              <WarningCircle className={cn(
                'w-5 h-5',
                isMin ? 'text-yellow-600' : 'text-orange-600'
              )} />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">
              {isMin ? '최소 페이지 제한' : '최대 페이지 제한'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* 본문 */}
        <div className="px-6 py-4">
          <div className={cn(
            'p-4 rounded-lg mb-4',
            isMin ? 'bg-yellow-50' : 'bg-orange-50'
          )}>
            <div className="text-center">
              <div className="text-3xl font-bold text-gray-900 mb-1">
                {currentCount}
                <span className="text-lg text-gray-400 mx-2">/</span>
                {limitCount}
              </div>
              <div className="text-sm text-gray-500">
                현재 페이지 수 / {isMin ? '최소' : '최대'} 페이지 수
              </div>
            </div>
          </div>
          <p className="text-gray-600 text-center">
            {isMin ? (
              <>
                이 상품은 최소 <span className="font-medium">{limitCount}페이지</span>가 필요합니다.
                <br />
                더 이상 페이지를 삭제할 수 없습니다.
              </>
            ) : (
              <>
                이 상품은 최대 <span className="font-medium">{limitCount}페이지</span>까지 추가할 수 있습니다.
                <br />
                더 이상 페이지를 추가할 수 없습니다.
              </>
            )}
          </p>
        </div>

        {/* 버튼 */}
        <div className="px-6 py-4 bg-gray-50 border-t">
          <button
            onClick={onClose}
            className={cn(
              'w-full px-4 py-2.5 rounded-lg transition-colors',
              'bg-blue-600 text-white hover:bg-blue-700'
            )}
          >
            확인
          </button>
        </div>
      </div>
    </div>
  )
})
