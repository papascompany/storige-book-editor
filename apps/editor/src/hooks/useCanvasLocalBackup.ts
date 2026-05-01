import { useEffect, useRef } from 'react'
import { useAppStore } from '@/stores/useAppStore'

const KEY_PREFIX = 'storige.editor.backup.'
const MAX_BACKUPS = 3 // 최근 3개 세션만 보관 — localStorage quota 회피
const SAVE_INTERVAL_MS = 5000 // 5초마다 1회

/**
 * 캔버스 작업 내용을 localStorage 에 주기적으로 백업하는 훅.
 *
 * iOS Safari WebContent 프로세스가 메모리 한계로 강제 종료/reload 되는 경우,
 * fresh 마운트 시 이 훅이 backup 을 발견해서 사용자에게 복원 옵션을 제공.
 *
 * 백업 키 형식: `storige.editor.backup.<sessionKey>`
 * 값: { ts, json }  (json 은 fabric canvas.toJSON 결과)
 *
 * sessionKey 가 없으면 백업/복원 모두 스킵 (예: 빈 새 작업).
 */
export function useCanvasLocalBackup(sessionKey: string | null | undefined, ready: boolean) {
  const lastSavedRef = useRef<string>('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!ready || !sessionKey) return

    const save = () => {
      try {
        const canvas = useAppStore.getState().canvas
        if (!canvas || (canvas as any).disposed) return
        // toJSON 은 동기 — 큰 캔버스에서 비싸지만 5초 한 번이라 허용 범위
        const jsonObj = canvas.toJSON([
          'id', 'extensionType', 'selectable', 'evented', 'hasControls',
          'lockUniScaling', 'lockScalingFlip', 'name', 'meta',
        ])
        const json = JSON.stringify(jsonObj)
        if (json === lastSavedRef.current) return // 변경 없으면 스킵
        lastSavedRef.current = json

        const key = KEY_PREFIX + sessionKey
        const payload = JSON.stringify({ ts: Date.now(), json })
        try {
          window.localStorage.setItem(key, payload)
        } catch (e) {
          // QuotaExceeded 등 — 오래된 백업 정리 후 재시도
          pruneOldBackups()
          try {
            window.localStorage.setItem(key, payload)
          } catch {
            /* 그래도 실패하면 포기 */
          }
        }
      } catch (e) {
        console.warn('[useCanvasLocalBackup] save error:', e)
      }
    }

    intervalRef.current = setInterval(save, SAVE_INTERVAL_MS)
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [ready, sessionKey])
}

/**
 * 마운트 시 1회 호출 — 해당 sessionKey 의 backup 이 있으면 반환.
 * 호출자가 사용자에게 복원 여부를 묻고, 복원하면 별도로 canvas.loadFromJSON.
 */
export function readCanvasBackup(sessionKey: string): { ts: number; json: string } | null {
  if (!sessionKey) return null
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + sessionKey)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.json === 'string' && typeof parsed.ts === 'number') {
      return parsed
    }
  } catch {
    /* 무시 */
  }
  return null
}

/**
 * 명시적 삭제 (사용자가 "복원 안함" 선택 시).
 */
export function clearCanvasBackup(sessionKey: string) {
  try {
    window.localStorage.removeItem(KEY_PREFIX + sessionKey)
  } catch {
    /* 무시 */
  }
}

/**
 * MAX_BACKUPS 초과한 오래된 백업을 ts 기준 오름차순으로 제거.
 */
function pruneOldBackups() {
  try {
    const entries: Array<{ key: string; ts: number }> = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (!k || !k.startsWith(KEY_PREFIX)) continue
      try {
        const raw = window.localStorage.getItem(k)
        if (!raw) continue
        const parsed = JSON.parse(raw)
        entries.push({ key: k, ts: parsed?.ts ?? 0 })
      } catch {
        // 손상된 항목은 즉시 제거 후보
        entries.push({ key: k, ts: 0 })
      }
    }
    if (entries.length <= MAX_BACKUPS) return
    entries.sort((a, b) => a.ts - b.ts)
    const toRemove = entries.slice(0, entries.length - MAX_BACKUPS)
    toRemove.forEach((e) => window.localStorage.removeItem(e.key))
  } catch {
    /* 무시 */
  }
}
