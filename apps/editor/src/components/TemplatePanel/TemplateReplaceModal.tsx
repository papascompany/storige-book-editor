import { memo, useState, useCallback } from 'react'
import { X, AlertTriangle as Warning, RefreshCw as ArrowsClockwise } from 'lucide-react'
import { cn } from '@/lib/utils'

type ReplaceMode = 'template' | 'templateSet'

interface TemplateReplaceModalProps {
  isOpen: boolean
  mode: ReplaceMode
  templateName?: string
  templateSetName?: string
  onConfirm: () => void
  onCancel: () => void
  isReplacing?: boolean
}

export const TemplateReplaceModal = memo(function TemplateReplaceModal({
  isOpen,
  mode,
  templateName,
  templateSetName,
  onConfirm,
  onCancel,
  isReplacing = false,
}: TemplateReplaceModalProps) {
  if (!isOpen) return null

  const itemName = mode === 'template' ? templateName : templateSetName
  const itemType = mode === 'template' ? '템플릿' : '템플릿셋'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
              <ArrowsClockwise className="w-5 h-5 text-blue-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">
              {itemType} 교체
            </h3>
          </div>
          <button
            onClick={onCancel}
            disabled={isReplacing}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* 본문 */}
        <div className="px-6 py-4">
          <div className="flex items-start gap-3 p-3 bg-yellow-50 rounded-lg border border-yellow-100 mb-4">
            <Warning className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-yellow-800">
              <p className="font-medium">사용자 요소는 보존됩니다</p>
              <p className="mt-1 text-yellow-700">
                직접 추가한 텍스트, 이미지, 도형 등은 새 {itemType}으로 옮겨집니다.
              </p>
            </div>
          </div>

          <p className="text-gray-600">
            <span className="font-medium text-gray-900">
              "{itemName}"
            </span>
            (으)로 교체하시겠습니까?
          </p>

          {mode === 'templateSet' && (
            <p className="mt-2 text-sm text-gray-500">
              전체 페이지 구성이 새 템플릿셋으로 교체됩니다.
            </p>
          )}
        </div>

        {/* 버튼 */}
        <div className="px-6 py-4 bg-gray-50 border-t flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={isReplacing}
            className={cn(
              'px-4 py-2 rounded-lg transition-colors',
              'text-gray-600 hover:bg-gray-100',
              isReplacing && 'opacity-50 cursor-not-allowed'
            )}
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={isReplacing}
            className={cn(
              'px-4 py-2 rounded-lg transition-colors',
              'bg-blue-600 text-white hover:bg-blue-700',
              isReplacing && 'opacity-50 cursor-not-allowed'
            )}
          >
            {isReplacing ? (
              <span className="flex items-center gap-2">
                <ArrowsClockwise className="w-4 h-4 animate-spin" />
                교체 중...
              </span>
            ) : (
              '교체'
            )}
          </button>
        </div>
      </div>
    </div>
  )
})
