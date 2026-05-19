/**
 * 마이페이지 — 인쇄 워크플로우 v1 Phase 6-C (2026-05-19).
 *
 * 로그인 사용자 본인의 편집 세션 목록을 보여주는 페이지.
 * 라우트: /my-works
 *
 * 항목:
 *   - 제목 (templateSet 이름 또는 sessionId 첫 8자)
 *   - 상태 (draft / editing / complete)
 *   - 업데이트 시각
 *   - 다운로드 (complete 상태일 때 outputFileUrl 안내)
 *   - 재편집 링크
 *
 * 비로그인 시 안내 + 로그인 페이지 안내 (외부 임베드 시 부모로 postMessage).
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { editSessionsApi, EditSessionResponse } from '../api/edit-sessions'
import { useAuthStore } from '../stores/useAuthStore'
import { apiClient } from '../api/client'

export default function MyWorksView() {
  const token = useAuthStore((s) => s.token)
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<EditSessionResponse[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setLoading(true)
    apiClient
      .get<{ sessions: EditSessionResponse[]; total: number }>('/edit-sessions/my')
      .then((res) => {
        if (!cancelled) {
          setSessions(res.data.sessions || [])
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || '세션 목록을 불러오지 못했습니다.')
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [token])

  if (!token) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>
        <h2>로그인이 필요합니다</h2>
        <p style={{ marginTop: 12 }}>
          마이페이지는 로그인한 사용자만 접근할 수 있습니다.
        </p>
        <button
          onClick={() => navigate('/')}
          style={{
            marginTop: 16,
            padding: '8px 16px',
            background: '#1976d2',
            color: 'white',
            border: 0,
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          편집기로 돌아가기
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>내 작업</h1>
        <p style={{ color: '#666', fontSize: 13, marginTop: 4 }}>
          편집한 세션을 최근순으로 표시합니다 (최대 200건).
        </p>
      </header>

      {loading && <div style={{ color: '#999' }}>불러오는 중…</div>}
      {error && (
        <div style={{ background: '#ffebee', color: '#c62828', padding: 12, borderRadius: 6 }}>
          {error}
        </div>
      )}

      {!loading && sessions.length === 0 && (
        <div style={{ color: '#999', textAlign: 'center', padding: 40 }}>
          아직 저장된 작업이 없습니다.
        </div>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {sessions.map((s) => (
          <li
            key={s.id}
            style={{
              padding: '14px 16px',
              border: '1px solid #eee',
              borderRadius: 6,
              marginBottom: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                {s.templateSetId
                  ? `템플릿셋: ${s.templateSetId.slice(0, 8)}…`
                  : `세션 ${s.id.slice(0, 8)}…`}
              </div>
              <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                상태: <strong>{s.status}</strong> · 업데이트:{' '}
                {new Date(s.updatedAt).toLocaleString('ko-KR')}
              </div>
              {s.contentPdfFileId && (
                <div style={{ fontSize: 11, color: '#1976d2', marginTop: 2 }}>
                  📎 PDF 첨부됨 ({s.contentPdfPageCount}p)
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Link
                to={`/?sessionId=${s.id}${s.templateSetId ? `&templateSetId=${s.templateSetId}` : ''}`}
                style={{
                  padding: '6px 12px',
                  background: '#e3f2fd',
                  color: '#1976d2',
                  textDecoration: 'none',
                  borderRadius: 4,
                  fontSize: 12,
                }}
              >
                재편집
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
