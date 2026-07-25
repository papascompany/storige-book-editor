import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Sentry } from '../lib/sentry'

/**
 * 배포 후 청크 재해시(stale chunk) 판별 — 옛 탭이 참조하는 lazy 청크 파일명이
 * 새 배포로 사라져 dynamic import 가 실패할 때 브라우저/vite 가 내는 메시지 패턴.
 * (Chrome/Safari/Firefox 문구가 제각각이라 3종을 포괄한다.)
 */
export function isStaleChunkError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : String((err as { message?: unknown } | null)?.message ?? '')
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /importing a module script failed/i.test(msg)
  )
}

/** stale chunk 자동 리로드의 sessionStorage 가드 키 + 쿨다운(ms). */
const CHUNK_RELOAD_KEY = '__chunkReloadOnce'
const CHUNK_RELOAD_COOLDOWN_MS = 10_000

/**
 * stale chunk 감지 시 딱 1회 새로고침한다. 무한 리로드 루프 절대 방지:
 * 직전 리로드 타임스탬프가 쿨다운(10s) 이내면 다시 리로드하지 않는다(연쇄 실패 차단).
 * 옛 타임스탬프는 자연 만료돼 다음 배포 때 다시 1회 리로드를 허용한다(= 성공 후 사실상 클리어).
 * sessionStorage/location 접근 실패(프라이버시 모드 등)면 조용히 생략한다.
 *
 * 편집 손실: 편집 진입(lazy 로드) 실패 지점에서 동작하며, 임베드는 자동저장 + 리로드 후
 * RestoreBackupBanner 복원 제안으로 안전하다(자동 복원 아님 — 사용자 발동).
 */
export function reloadOnceForStaleChunk(): void {
  try {
    if (typeof window === 'undefined') return
    const prev = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0)
    const now = Date.now()
    if (prev && now - prev < CHUNK_RELOAD_COOLDOWN_MS) {
      console.error('[staleChunk] reload already attempted recently — skipping to avoid loop')
      return
    }
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now))
    window.location.reload()
  } catch {
    /* sessionStorage/location 접근 실패 — 리로드 생략 */
  }
}

/**
 * 에디터 전역 ErrorBoundary —
 * - React 트리 어디서든 발생한 throw 를 잡아 흰 화면 / iOS Safari 크래시 대신
 *   사용자에게 복구 UI 를 제공.
 * - localStorage 에 마지막 캔버스 백업이 있으면 "복원" 버튼으로 작업 회복.
 *
 * 모바일에서 메모리 한계로 React 가 부분 실패할 때, 전체 페이지가 죽기 전에
 * 이 boundary 가 잡아 사용자에게 안전한 UI 를 보여주는 것이 목표.
 */

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  errorMessage?: string
}

export class EditorErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error?.message ?? '알 수 없는 오류',
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 운영 환경에서도 콘솔에는 남김.
    console.error('[EditorErrorBoundary]', error, info?.componentStack)
    // 배포 후 stale chunk 로 인한 dynamic import 실패가 window 'vite:preloadError' 를
    // 거치지 않고 React 렌더 트리 throw 로 표면화한 경우의 폴백 — 동일 가드로 1회 자동
    // 새로고침(무한 루프는 sessionStorage 쿨다운으로 차단). 리로드가 걸리면 아래 복구 UI 는
    // 잠깐 보였다가 새 페이지로 대체된다.
    if (isStaleChunkError(error)) {
      reloadOnceForStaleChunk()
    }
    // EH-002: React 렌더 트리 크래시를 Sentry 로 전송(과거 누락). DSN 미설정 시 no-op 이라 안전.
    try {
      Sentry.captureException(error, {
        extra: { componentStack: info?.componentStack },
      } as any)
    } catch {
      /* Sentry 미초기화 등 — 무시 */
    }
  }

  private handleReload = () => {
    // 안전 reload — 같은 URL 로 새로고침. 새로고침하면 서버에 저장된 마지막 시점부터
    // 다시 시작하고, 이 기기에 저장 안 된 로컬 백업이 있으면 편집기가 복원 여부를 묻는다
    // (embed: RestoreBackupBanner). 자동 복원은 하지 않는다(사용자 발동 only).
    window.location.reload()
  }

  private handleResetAndReload = () => {
    // 백업도 같이 폐기 — 백업 자체가 손상돼서 reload 후에도 즉시 같은 에러가 날 때.
    try {
      Object.keys(window.localStorage)
        .filter((k) => k.startsWith('storige.editor.backup.'))
        .forEach((k) => window.localStorage.removeItem(k))
    } catch {
      /* localStorage 접근 실패는 무시 */
    }
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div
        role="alert"
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: '#f7f7f7',
          color: '#333',
          fontFamily:
            '"Pretendard Variable", Pretendard, "Noto Sans KR", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
          zIndex: 99999,
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: '100%',
            background: '#fff',
            border: '1px solid #e0e0e0',
            borderRadius: 12,
            padding: 24,
            boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
            편집기에서 일시적인 오류가 발생했습니다
          </h2>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 16, lineHeight: 1.5 }}>
            새로고침하면 마지막 자동 저장 시점부터 이어서 작업할 수 있습니다.
            계속 같은 문제가 발생하면 데이터를 초기화해 보세요.
          </p>
          {this.state.errorMessage && (
            <details style={{ marginBottom: 16 }}>
              <summary style={{ fontSize: 12, color: '#999', cursor: 'pointer' }}>
                오류 정보
              </summary>
              <pre
                style={{
                  fontSize: 11,
                  color: '#999',
                  background: '#fafafa',
                  padding: 8,
                  borderRadius: 4,
                  overflow: 'auto',
                  marginTop: 8,
                }}
              >
                {this.state.errorMessage}
              </pre>
            </details>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                flex: 1,
                height: 44,
                background: '#7fbf34',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              새로고침
            </button>
            <button
              type="button"
              onClick={this.handleResetAndReload}
              style={{
                flex: 1,
                height: 44,
                background: '#fff',
                color: '#666',
                border: '1px solid #e0e0e0',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              데이터 초기화
            </button>
          </div>
        </div>
      </div>
    )
  }
}
