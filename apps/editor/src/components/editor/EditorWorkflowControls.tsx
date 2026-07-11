/**
 * 인쇄 워크플로우 v1 Phase 5-D (2026-05-19) — Editor floating workflow controls.
 *
 * 침습 최소 통합: EditorView 의 핵심 로직 (캔버스/페이지 패널) 건드리지 않고
 * 우측 상단 floating UI 로 다음 기능 노출.
 *
 *   - 내지 PDF 첨부 버튼 (book mode + 내지 가능 시) → ContentPdfAttachModal
 *   - templateSet.coverEditable=false → LeatherCoverPreview 안내 배너
 *   - 게스트 세션 자동 생성 (token 없을 때, templateSetId 있을 때만)
 *
 * 사용:
 *   <EditorWorkflowControls templateSetId="..." />
 */
import { useEffect, useState } from 'react'
import { templateSetsApi } from '../../api/template-sets'
import type { TemplateSet } from '@storige/types'
import { useAuthStore } from '../../stores/useAuthStore'
import { useGuestStore } from '../../stores/useGuestStore'
import { ContentPdfAttachModal } from './ContentPdfAttachModal'

interface Props {
  templateSetId?: string | null
}

export function EditorWorkflowControls({ templateSetId }: Props) {
  const [templateSet, setTemplateSet] = useState<TemplateSet | null>(null)
  const [showAttachModal, setShowAttachModal] = useState(false)
  const [attached, setAttached] = useState<{
    fileId: string
    pageCount: number
  } | null>(null)

  const token = useAuthStore((s) => s.token)
  const guestSessionId = useGuestStore((s) => s.sessionId)
  const ensureGuestSession = useGuestStore((s) => s.ensureGuestSession)

  // templateSet 로딩 (coverEditable / endpaperConfig 확인용)
  useEffect(() => {
    if (!templateSetId) {
      setTemplateSet(null)
      return
    }
    let cancelled = false
    templateSetsApi
      .getTemplateSet(templateSetId)
      .then((ts) => {
        if (!cancelled) setTemplateSet(ts)
      })
      .catch((err) => {
        console.warn('[EditorWorkflowControls] getTemplateSet failed:', err)
      })
    return () => {
      cancelled = true
    }
  }, [templateSetId])

  // 게스트 세션 자동 생성 (token 없고 templateSet 로드 완료 후)
  useEffect(() => {
    if (token) return
    if (!templateSet) return
    if (guestSessionId) return
    ensureGuestSession({
      templateSetId: templateSet.id,
      mode: 'both',
    }).catch((err) => {
      console.warn('[EditorWorkflowControls] ensureGuestSession failed:', err)
    })
  }, [token, templateSet, guestSessionId, ensureGuestSession])

  if (!templateSet) return null

  const isBookMode = templateSet.editorMode === 'book' || templateSet.type === 'book'
  const canAttach = isBookMode // 책 모드에서만 PDF 첨부 의미 있음
  const currentContentPageCount = (templateSet as any).pageCountRange?.[0] ?? 16

  const isLeather = templateSet.coverEditable === false
  const endpaper = (templateSet as any).endpaperConfig as
    | { frontCount: number; backCount: number }
    | null
    | undefined

  return (
    <>
      {/* 우측 상단 floating control panel */}
      <div
        style={{
          position: 'fixed',
          top: 80,
          right: 16,
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          pointerEvents: 'none',
        }}
      >
        {isLeather && (
          <div
            style={{
              pointerEvents: 'auto',
              background: '#fff3e0',
              border: '1px solid #ffb74d',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 12,
              color: '#5d4037',
              maxWidth: 240,
              boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
            }}
          >
            <strong>🏷 레더 커버</strong>
            <div style={{ marginTop: 4 }}>
              표지는 사전 인쇄된 레더로 대체됩니다. 빈 표지 페이지로 인쇄용 PDF 생성.
            </div>
          </div>
        )}

        {endpaper && (endpaper.frontCount > 0 || endpaper.backCount > 0) && (
          <div
            style={{
              pointerEvents: 'auto',
              background: '#fff8e1',
              border: '1px solid #ffd54f',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 12,
              color: '#5d4037',
              maxWidth: 240,
              boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
            }}
          >
            <strong>📄 면지</strong>
            <div style={{ marginTop: 4 }}>
              앞면지 {endpaper.frontCount} / 뒷면지 {endpaper.backCount}
            </div>
          </div>
        )}

        {canAttach && (guestSessionId || token) && (
          <button
            type="button"
            disabled={!!attached}
            onClick={() => setShowAttachModal(true)}
            style={{
              pointerEvents: 'auto',
              background: attached ? '#4caf50' : '#1976d2',
              color: 'white',
              border: 0,
              borderRadius: 6,
              padding: '10px 14px',
              cursor: attached ? 'default' : 'pointer',
              fontSize: 13,
              fontWeight: 600,
              boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
            }}
          >
            {attached
              ? `✓ PDF 첨부됨 (${attached.pageCount}p)`
              : '📎 내지 PDF 첨부'}
          </button>
        )}
      </div>

      {/* PDF 첨부 모달 */}
      {showAttachModal && guestSessionId && (
        <ContentPdfAttachModal
          open={showAttachModal}
          sessionId={guestSessionId}
          currentContentPageCount={currentContentPageCount}
          canAddPage={!!templateSet.canAddPage}
          // C+ G1(2026-07-11): 검증 기준을 A4 하드코드 대신 templateSet 판형으로 주입.
          trimSize={{ width: templateSet.width, height: templateSet.height }}
          onClose={() => setShowAttachModal(false)}
          onAttached={(result) => {
            setAttached({
              fileId: result.contentPdfFileId,
              pageCount: result.contentPdfPageCount,
            })
            setShowAttachModal(false)
          }}
        />
      )}
    </>
  )
}
