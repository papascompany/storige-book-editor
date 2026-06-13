import { Component, type ErrorInfo, type ReactNode } from 'react'

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
    // 운영 환경에서도 콘솔에는 남김 — Sentry 등 외부 추적 도구 연결 시 여기서 dispatch.
    console.error('[EditorErrorBoundary]', error, info?.componentStack)
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
