/**
 * 게스트 편집완료 로그인 유도 모달 — 인쇄 워크플로우 v1 Phase 6-A (2026-05-19).
 *
 * 결정 3-6: 게스트가 편집완료/저장을 누르면 로그인/회원가입을 안내.
 * 로그인 성공 후에는 호출자가 useGuestStore.guestToken 으로 migrate API 호출.
 *
 * UI 정책:
 * - 로그인 / 회원가입 / 게스트로 계속 (저장 안 함) 3개 옵션 노출
 * - 외부 사이트 임베드 (iframe) 환경에서는 부모에 'editor.needAuth' postMessage 가능 (Phase 7 PHP 가이드)
 *   본 컴포넌트는 콜백 props 로 위임 — 통합 측에서 처리.
 */
import { apiClient } from '../../api/client'
import { useGuestStore } from '../../stores/useGuestStore'

interface Props {
  open: boolean
  onClose: () => void
  /** 로그인 후 게스트 세션을 회원으로 마이그레이션 + onComplete 호출 */
  onAuthSuccess: () => void
  /** 로그인 없이 진행 (저장 안 함) — 호출자가 마무리 흐름 결정 */
  onContinueAsGuest?: () => void
}

export function GuestAuthPromptModal({ open, onClose, onAuthSuccess, onContinueAsGuest }: Props) {
  const guestToken = useGuestStore((s) => s.guestToken)
  const clearGuest = useGuestStore((s) => s.clearGuest)

  if (!open) return null

  /**
   * 부모 사이트(외부 임베드)로 '로그인 필요' postMessage 발신.
   * 외부 사이트의 storige editor 호스트가 처리.
   */
  const notifyParentNeedAuth = () => {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          {
            source: 'storige-editor',
            event: 'editor.needAuth',
            payload: {
              guestToken,
              reason: 'complete_save',
              ts: Date.now(),
            },
          },
          '*',
        )
      }
    } catch {
      // 부모 사이트 미연동 환경 — 무시
    }
  }

  const handleLoginRedirect = () => {
    notifyParentNeedAuth()
    // 부모가 처리 안 하면 자체 로그인 페이지로 (구현 측 결정)
    // 여기서는 안내만 — 실제 로그인 후 onAuthSuccess() 호출은 외부 흐름에서.
  }

  const handleContinueGuest = () => {
    if (onContinueAsGuest) {
      onContinueAsGuest()
    }
    onClose()
  }

  /**
   * 마이그레이션 헬퍼 — 외부 흐름에서 로그인 완료된 직후 호출:
   *   const result = await migrateNow()
   * → 게스트 세션을 회원 소유로 흡수, useGuestStore 클리어.
   *
   * 본 컴포넌트는 모달이지만 메서드를 props 로 노출하기 위해 ref 패턴은 생략.
   * 대신 외부에서 직접 apiClient.post('/edit-sessions/guest/migrate', { guestToken }) 호출 + clearGuest().
   */
  const migrateNow = async (): Promise<{ migratedCount: number } | null> => {
    if (!guestToken) return null
    try {
      const res = await apiClient.post<{ migratedCount: number; sessionIds: string[] }>(
        '/edit-sessions/guest/migrate',
        { guestToken },
      )
      clearGuest()
      onAuthSuccess()
      return { migratedCount: res.data.migratedCount }
    } catch (err) {
      console.error('[GuestAuthPromptModal] migrateNow failed:', err)
      return null
    }
  }

  // 외부 흐름에서 호출 가능하도록 window 에 노출 (개발 디버깅 + 통합 wiring 용)
  // 운영에서는 사용 측에서 직접 useGuestStore + apiClient 호출 권장.
  if (typeof window !== 'undefined') {
    (window as any).__storigeMigrateNow = migrateNow
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'white', padding: 28, borderRadius: 8, minWidth: 420, maxWidth: 520,
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: 0, marginBottom: 8, fontSize: 18 }}>편집 완료 — 작업 저장</h2>
        <p style={{ color: '#666', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
          작업을 영구 보관하려면 로그인이 필요합니다. 게스트 작업은 <strong>24시간 후 자동 삭제</strong>됩니다.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={handleLoginRedirect}
            style={{
              background: '#1976d2', color: 'white', border: 0, borderRadius: 6,
              padding: '12px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            로그인 / 회원가입
          </button>
          <button
            onClick={handleContinueGuest}
            style={{
              background: 'transparent', color: '#666', border: '1px solid #ddd', borderRadius: 6,
              padding: '10px 16px', fontSize: 13, cursor: 'pointer',
            }}
          >
            게스트로 계속 (24시간 후 삭제됨)
          </button>
        </div>

        <div style={{ marginTop: 16, fontSize: 11, color: '#999' }}>
          💡 외부 사이트에서 임베드된 경우 부모 페이지로 <code>editor.needAuth</code> 이벤트가 전달됩니다.
        </div>
      </div>
    </div>
  )
}
