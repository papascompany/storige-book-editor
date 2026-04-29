import { memo, useMemo } from 'react'
import { AlertTriangle as Warning, Info } from 'lucide-react'
import {
  PaperType,
  BindingType,
  calculateSpineWidth,
  type SpineWarning,
} from '@storige/types'
import { cn } from '@/lib/utils'

interface SpineCalculatorProps {
  pageCount: number
  paperType: PaperType
  bindingType: BindingType
  className?: string
  showDetails?: boolean
}

/**
 * 책등 폭 계산 결과 표시 컴포넌트
 */
export const SpineCalculator = memo(function SpineCalculator({
  pageCount,
  paperType,
  bindingType,
  className,
  showDetails = true,
}: SpineCalculatorProps) {
  const result = useMemo(() => {
    return calculateSpineWidth({
      pageCount,
      paperType,
      bindingType,
    })
  }, [pageCount, paperType, bindingType])

  const hasWarnings = result.warnings.length > 0

  return (
    <div className={cn('space-y-3', className)}>
      {/* 책등 폭 결과 */}
      <div className="flex items-center justify-between p-4 bg-white rounded-lg border">
        <div>
          <div className="text-sm text-gray-500">계산된 책등 폭</div>
          <div className="text-2xl font-bold text-gray-900">
            {result.spineWidth.toFixed(2)} mm
          </div>
        </div>
        {hasWarnings && (
          <Warning className="w-6 h-6 text-yellow-500" />
        )}
      </div>

      {/* 계산 상세 */}
      {showDetails && (
        <div className="p-3 bg-gray-50 rounded-lg text-sm">
          <div className="flex items-center gap-1 text-gray-600 mb-2">
            <Info className="w-4 h-4" />
            <span>계산 공식</span>
          </div>
          <div className="space-y-1 text-gray-700 font-mono text-xs">
            <div>= (페이지 수 ÷ 2) × 종이 두께 + 제본 여유분</div>
            <div>
              = ({pageCount} ÷ 2) × {result.paperThickness}mm +{' '}
              {result.bindingMargin}mm
            </div>
            <div>
              = {(pageCount / 2).toFixed(1)} × {result.paperThickness}mm +{' '}
              {result.bindingMargin}mm
            </div>
            <div className="font-semibold">
              = {result.spineWidth.toFixed(2)}mm
            </div>
          </div>
        </div>
      )}

      {/* 경고 메시지 */}
      {hasWarnings && (
        <div className="space-y-2">
          {result.warnings.map((warning, index) => (
            <WarningItem key={index} warning={warning} />
          ))}
        </div>
      )}
    </div>
  )
})

interface WarningItemProps {
  warning: SpineWarning
}

const WarningItem = memo(function WarningItem({ warning }: WarningItemProps) {
  const bgColor = warning.code === 'SPINE_TOO_NARROW'
    ? 'bg-yellow-50 border-yellow-200'
    : 'bg-orange-50 border-orange-200'

  const textColor = warning.code === 'SPINE_TOO_NARROW'
    ? 'text-yellow-700'
    : 'text-orange-700'

  return (
    <div className={cn('p-3 rounded-lg border', bgColor)}>
      <div className={cn('flex items-start gap-2', textColor)}>
        <Warning className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span className="text-sm">{warning.message}</span>
      </div>
    </div>
  )
})
