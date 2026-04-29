import { memo, useCallback, useMemo } from 'react'
import { Lock as LockSimple, Unlock as LockSimpleOpen } from 'lucide-react'
import { useActiveSelection, useHasSelection } from '@/stores/useAppStore'
import { cn } from '@/lib/utils'

interface ElementLockControlProps {
  className?: string
  /**
   * 잠금 해제 권한 (관리자/디자이너만)
   */
  canUnlock?: boolean
}

/**
 * 요소 잠금/해제 컨트롤
 */
export const ElementLockControl = memo(function ElementLockControl({
  className,
  canUnlock = false,
}: ElementLockControlProps) {
  const activeSelectionArray = useActiveSelection()
  const hasSelection = useHasSelection()

  // 첫 번째 선택된 객체 (단일 선택 시에만 잠금 컨트롤 활성화)
  const selectedObject = useMemo(() => {
    if (activeSelectionArray.length === 1) {
      return activeSelectionArray[0] as any
    }
    return null
  }, [activeSelectionArray])

  const isLocked = selectedObject?.get?.('lockMovementX') && selectedObject?.get?.('lockMovementY')
  const isSelectable = selectedObject?.get?.('selectable') !== false

  const handleToggleLock = useCallback(() => {
    if (!selectedObject) return

    const newLocked = !isLocked

    // 잠금 해제 시 권한 확인
    if (isLocked && !canUnlock) {
      console.warn('잠금 해제 권한이 없습니다.')
      return
    }

    // 잠금 상태 토글
    selectedObject.set({
      lockMovementX: newLocked,
      lockMovementY: newLocked,
      lockRotation: newLocked,
      lockScalingX: newLocked,
      lockScalingY: newLocked,
      lockSkewingX: newLocked,
      lockSkewingY: newLocked,
      lockUniScaling: newLocked,
      hasControls: !newLocked,
      hasBorders: !newLocked,
      isLocked: newLocked,
    })

    selectedObject.canvas?.renderAll()
  }, [selectedObject, isLocked, canUnlock])

  // 단일 선택이 아니거나 선택된 객체가 없으면 표시 안함
  if (!hasSelection || !selectedObject) return null

  // 선택 불가능한 요소는 잠금 컨트롤 표시 안함
  if (!isSelectable) return null

  return (
    <button
      onClick={handleToggleLock}
      disabled={isLocked && !canUnlock}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1.5 rounded transition-colors',
        isLocked
          ? canUnlock
            ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
            : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
        className
      )}
      title={isLocked ? (canUnlock ? '잠금 해제' : '잠금됨 (해제 권한 없음)') : '요소 잠금'}
    >
      {isLocked ? (
        <LockSimple className="w-4 h-4" />
      ) : (
        <LockSimpleOpen className="w-4 h-4" />
      )}
      <span className="text-xs font-medium">
        {isLocked ? '잠김' : '잠금'}
      </span>
    </button>
  )
})

/**
 * 잠금 상태 배지 (읽기 전용 표시용)
 */
interface LockBadgeProps {
  className?: string
}

export const LockBadge = memo(function LockBadge({
  className,
}: LockBadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs',
        className
      )}
    >
      <LockSimple className="w-3 h-3" />
      <span>잠김</span>
    </div>
  )
})
