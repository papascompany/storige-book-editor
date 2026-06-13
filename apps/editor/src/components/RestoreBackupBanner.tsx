import { useEffect, useState } from 'react'

/**
 * 자동저장 복원 배너 (비차단 — 사용자 발동 only).
 *
 * 데이터 유실 footgun 방어 설계:
 *  - 자동 복원하지 않는다. 이 배너가 떠도 사용자가 [복원] 을 누르기 전엔 캔버스는 불변.
 *  - [복원]: restoreFromLocal() 실행(멀티페이지 전체 loadFromJSON + dirty 마킹).
 *  - [무시]: 백업 삭제(같은 백업으로 다시 묻지 않음). 캔버스는 그대로 = 서버 세션 유지.
 *  - confident=false(서버보다 최신이 아닐 수 있음) 면 문구로 명시 — 사용자가 판단하게.
 */
export interface RestoreBackupBannerProps {
  /** 노출 여부 */
  open: boolean
  /** 백업 시각 — "N분 전" 표시용. 시각 미상이면 undefined */
  backupAt?: Date
  /**
   * 백업이 서버보다 최신임이 명확한가. false 면 "서버보다 최신이 아닐 수 있음" 안내 문구.
   */
  confident: boolean
  /** [복원] 클릭 — 복원 수행. 성공/실패 boolean 반환 */
  onRestore: () => Promise<boolean> | boolean
  /** [무시] 클릭 — 백업 삭제 + 배너 닫기 */
  onDismiss: () => void
}

/** savedAt 으로부터 "방금 전 / N분 전 / N시간 전" 한국어 표기 */
function formatRelativeKo(at: Date | undefined): string {
  if (!at) return '저장 시각 미상'
  const diffMs = Date.now() - at.getTime()
  if (!Number.isFinite(diffMs)) return '저장 시각 미상'
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return '방금 전'
  if (min < 60) return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전`
  const day = Math.floor(hr / 24)
  return `${day}일 전`
}

export function RestoreBackupBanner({
  open,
  backupAt,
  confident,
  onRestore,
  onDismiss,
}: RestoreBackupBannerProps) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  // open 이 새로 켜질 때 실패 표시 초기화
  useEffect(() => {
    if (open) setFailed(false)
  }, [open])

  if (!open) return null

  const handleRestore = async () => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      const ok = await onRestore()
      if (!ok) setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const when = formatRelativeKo(backupAt)

  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute left-1/2 top-3 z-[300] -translate-x-1/2"
      style={{ maxWidth: '92%' }}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 shadow-lg sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-900">
            이 기기에 저장되지 않은 변경사항이 있습니다 ({when}).
          </p>
          <p className="mt-0.5 text-xs text-amber-700">
            {failed
              ? '복원에 실패했습니다. 백업은 보관되어 있으니 다시 시도해 주세요.'
              : confident
                ? '복원하면 마지막 자동저장 시점의 내용으로 되돌립니다. 복원 후 저장하면 서버에 반영됩니다.'
                : '이 백업이 서버에 저장된 내용보다 최신이 아닐 수 있습니다. 내용을 확인 후 복원해 주세요.'}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={handleRestore}
            disabled={busy}
            className="h-9 rounded-md bg-amber-500 px-3 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-60"
          >
            {busy ? '복원 중...' : '복원'}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="h-9 rounded-md border border-amber-300 bg-white px-3 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60"
          >
            무시
          </button>
        </div>
      </div>
    </div>
  )
}
