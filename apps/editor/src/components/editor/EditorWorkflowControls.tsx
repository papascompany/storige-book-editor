/**
 * 인쇄 워크플로우 v1 Phase 5-D (2026-05-19) — Editor floating workflow controls.
 *
 * 침습 최소 통합: EditorView 의 핵심 로직 (캔버스/페이지 패널) 건드리지 않고
 * 우측 상단 floating UI 로 다음 기능 노출.
 *
 *   - 내지 PDF 첨부 버튼 (book mode + 내지 가능 시) → ContentPdfAttachModal
 *   - templateSet.coverEditable=false → 페브릭·기성 소재 잠금 안내 배너 (레거시 `/` 만)
 *   - 게스트 세션 자동 생성 (token 없을 때, templateSetId 있을 때만)
 *
 * W1(2026-08-13) — 사용처 2곳 대칭(G2·G3):
 *   - EditorView(`/`, 레거시): `<EditorWorkflowControls templateSetId="..." />`
 *     → 게스트 세션을 스스로 만들고(기존 동작), 그 세션이 underlay 면 로드 시 자동으로 앉힌다.
 *   - EmbeddedEditor(`/embed`, 파트너 정본): `sessionId`(+게스트면 `guestToken`) 를 명시 주입
 *     → 게스트 세션 자동생성·자동 앉히기를 하지 않는다(세션 소유·로드 앉히기는 embed 가 수행).
 *   두 경우 모두 **첨부 완료 시점**에는 여기서 `seatContentPdf` 로 즉시 앉힌다(G1·G5).
 */
import { useEffect, useRef, useState } from 'react'
import { templateSetsApi } from '../../api/template-sets'
import type { TemplateSet } from '@storige/types'
import { useAuthStore } from '../../stores/useAuthStore'
import { useGuestStore } from '../../stores/useGuestStore'
import { useAppStore } from '../../stores/useAppStore'
import { editSessionsApi, type EditSessionResponse } from '../../api/edit-sessions'
import { ensureSeatExistingContentPdf, isEditorOutputContentFile, seatContentPdf } from '../../utils/contentPdfGuide'
import { showToast } from '../../stores/useToastStore'
import { ContentPdfAttachModal } from './ContentPdfAttachModal'

interface Props {
  templateSetId?: string | null
  /**
   * 명시 편집 세션 id (임베드). 주어지면 게스트 세션 자동생성을 하지 않고 이 세션에 첨부한다.
   * 미지정 시 기존 동작(게스트 세션 자동 생성/복원) — EditorView(`/`) 경로.
   */
  sessionId?: string | null
  /** 명시 세션이 게스트 세션인 경우의 토큰 (임베드 게스트 폴백) */
  guestToken?: string | null
  /**
   * floating 패널의 우측 오프셋(px). 우측 페이지 네비(150px)와 겹치지 않게 호출자가 지정.
   * 기본 16 = 기존 위치 그대로.
   */
  offsetRight?: number
  /** 첨부 완료 알림 (호출자 세션 상태 동기화용) */
  onAttached?: (result: { contentPdfFileId: string; contentPdfPageCount: number }) => void
}

export function EditorWorkflowControls({
  templateSetId,
  sessionId,
  guestToken,
  offsetRight = 16,
  onAttached,
}: Props) {
  const [templateSet, setTemplateSet] = useState<TemplateSet | null>(null)
  const [showAttachModal, setShowAttachModal] = useState(false)
  const [attached, setAttached] = useState<{
    fileId: string
    pageCount: number | null
  } | null>(null)

  const token = useAuthStore((s) => s.token)
  const guestSessionId = useGuestStore((s) => s.sessionId)
  const ensureGuestSession = useGuestStore((s) => s.ensureGuestSession)
  const ready = useAppStore((s) => s.ready)

  /** 첨부 대상 세션 — 명시 주입(임베드) 우선, 없으면 게스트 세션(레거시 /) */
  const attachSessionId = sessionId ?? guestSessionId
  /** 세션 소유자 여부: 명시 주입이 없으면 이 컴포넌트가 세션을 만들고 로드 앉히기까지 책임진다 */
  const ownsSession = !sessionId
  /** 로드 시 자동 앉히기 1회 가드 (세션 id 기준) */
  const seatedSessionRef = useRef<string | null>(null)

  // templateSet 로딩 (coverEditable / endpaperConfig 확인용)
  useEffect(() => {
    if (!templateSetId) {
      setTemplateSet(null)
      return
    }
    let cancelled = false
    // ⚠️ 공개 엔드포인트(`/with-templates`, @Public)로 읽는다 — `GET /template-sets/:id` 는
    //    JWT 필수라 **비로그인 고객(게스트)에게 401**이고, 그러면 templateSet 이 null 로 남아
    //    이 컨트롤 전체가 렌더되지 않는다(= 첨부 진입점 자체가 사라짐). 2026-08-13 실기 적발.
    templateSetsApi
      .getTemplateSetWithTemplates(templateSetId)
      .then((res) => {
        if (!cancelled) setTemplateSet((res?.templateSet ?? null) as TemplateSet | null)
      })
      .catch((err) => {
        console.warn('[EditorWorkflowControls] getTemplateSetWithTemplates failed:', err)
      })
    return () => {
      cancelled = true
    }
  }, [templateSetId])

  // 게스트 세션 자동 생성 (token 없고 templateSet 로드 완료 후).
  // 명시 세션(임베드)이 주입되면 스킵 — 별도 게스트 세션을 만들면 첨부가 엉뚱한 세션에 붙는다.
  useEffect(() => {
    if (!ownsSession) return
    if (token) return
    if (!templateSet) return
    if (guestSessionId) return
    ensureGuestSession({
      templateSetId: templateSet.id,
      mode: 'both',
    }).catch((err) => {
      console.warn('[EditorWorkflowControls] ensureGuestSession failed:', err)
    })
  }, [ownsSession, token, templateSet, guestSessionId, ensureGuestSession])

  /**
   * 로드 시 앉히기 + 첨부 배지.
   * - 소유 세션(레거시 `/`): 여기서 앉힌다.
   * - 임베드: 앉히기는 embed.tsx 가 하고, 여기서는 주문에서 이미 올린 파일 배지만 맞춘다
   *   (없으면 "내지 PDF 첨부" 가 또 떠 고객이 두 번째 파일을 올리게 된다).
   */
  useEffect(() => {
    if (!ready || !attachSessionId || !templateSet) return
    if (seatedSessionRef.current === attachSessionId) return
    seatedSessionRef.current = attachSessionId

    let cancelled = false
    ;(async () => {
      try {
        const session: EditSessionResponse = await editSessionsApi.get(attachSessionId)
        if (cancelled) return
        // R5(2026-08-18): 편집완료 산출물 content.pdf(contentFileId 로 저장됨)를 고객 첨부로
        // 오인하지 않는다. 진짜 고객 첨부 = contentPdfFileId 존재 또는 contentPdfMode==='underlay'.
        // contentFileId 폴백의 산출물 판별은 contentPdfGuide.isEditorOutputContentFile 단일 판별식
        // (R5 정밀화: metadata.editorOutputContentFileId 일치 → 레거시 마커/status 폴백).
        const contentPdfMode = (
          session as EditSessionResponse & { contentPdfMode?: 'replace' | 'underlay' | null }
        ).contentPdfMode
        const fileId =
          session.contentPdfFileId ||
          (contentPdfMode === 'underlay' || !isEditorOutputContentFile(session)
            ? session.contentFileId
            : null)
        if (fileId) {
          setAttached({
            fileId,
            pageCount: session.contentPdfPageCount ?? null,
          })
        }
        if (ownsSession) {
          await ensureSeatExistingContentPdf(session, templateSet.id)
        }
      } catch (err) {
        console.warn('[EditorWorkflowControls] 로드 시 내지 PDF 앉히기 스킵:', err)
        seatedSessionRef.current = null
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ownsSession, ready, attachSessionId, templateSet])

  if (!templateSet) return null

  const isBookMode = templateSet.editorMode === 'book' || templateSet.type === 'book'
  const canAttach = isBookMode // 책 모드에서만 PDF 첨부 의미 있음
  // 현재 내지 수: 살아있는 캔버스(표지=0 제외)가 실측값. 아직 로드 전이면 템플릿 범위 최소값.
  const liveInnerPageCount = useAppStore.getState().allCanvas.length - 1
  const currentContentPageCount =
    liveInnerPageCount > 0 ? liveInnerPageCount : ((templateSet as any).pageCountRange?.[0] ?? 16)

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
          right: offsetRight,
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          pointerEvents: 'none',
        }}
      >
        {/* 레더커버·면지 안내 배너는 레거시 `/` 경로에서만 유지한다.
            임베드(명시 세션)의 안내 배선은 G8(레더커버 배선·면지) 트랙에서 별도로 다룬다 —
            W1 의 파트너 UI 변경 면적을 '첨부 진입점' 하나로 묶기 위한 의도적 제한. */}
        {ownsSession && isLeather && (
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
            <strong>🏷 페브릭 · 기성 표지</strong>
            <div style={{ marginTop: 4 }}>
              표지 소재(배경)는 바꿀 수 없습니다. 허용된 후가공만 텍스트와 이미지에 적용됩니다.
            </div>
          </div>
        )}

        {ownsSession && endpaper && (endpaper.frontCount > 0 || endpaper.backCount > 0) && (
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

        {canAttach && attachSessionId && (
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
              ? `✓ PDF 첨부됨${attached.pageCount ? ` (${attached.pageCount}p)` : ''}`
              : '📎 내지 PDF 첨부'}
          </button>
        )}
      </div>

      {/* PDF 첨부 모달 */}
      {showAttachModal && attachSessionId && (
        <ContentPdfAttachModal
          open={showAttachModal}
          sessionId={attachSessionId}
          guestToken={guestToken}
          currentContentPageCount={currentContentPageCount}
          canAddPage={!!templateSet.canAddPage}
          // C+ G1(2026-07-11): 검증 기준을 A4 하드코드 대신 templateSet 판형으로 주입.
          trimSize={{ width: templateSet.width, height: templateSet.height }}
          // T3(2026-07-13): 도련 자동변환 — 모달 orderOptions.bleed 하드코드(3) 치환용
          // templateSet.bleedMm + BLEED_MISSING 시 fix-bleed 잡 생성용 templateSetId 주입.
          // (bleedMm 은 API 컬럼(float, 기본 3)이나 @storige/types TemplateSet 미반영 —
          //  useEditorContents 의 기존 읽기 패턴과 동일하게 옵셔널 캐스팅.)
          bleedMm={(templateSet as TemplateSet & { bleedMm?: number | null }).bleedMm ?? 3}
          templateSetId={templateSet.id}
          onClose={() => setShowAttachModal(false)}
          onAttached={(result) => {
            setAttached({
              fileId: result.contentPdfFileId,
              pageCount: result.contentPdfPageCount,
            })
            setShowAttachModal(false)
            onAttached?.({
              contentPdfFileId: result.contentPdfFileId,
              contentPdfPageCount: result.contentPdfPageCount,
            })
            // W1-G1·G5: 재로드 없이 즉시 앉히기 — 내지 페이지를 PDF 페이지 수로 확장하고
            // 방금 래스터된 가이드를 각 내지에 배치한다. 모달이 세션 PATCH 를 이미 끝냈으므로
            // 여기서는 같은 payload 로 만든 세션 형태 객체를 그대로 쓴다(재조회 불필요).
            void seatContentPdf(
              {
                contentPdfMode: 'underlay',
                contentPdfFileId: result.contentPdfFileId,
                contentPdfPageCount: result.contentPdfPageCount,
                metadata: result.contentPdfGuide
                  ? { contentPdfGuide: result.contentPdfGuide }
                  : {},
              },
              templateSet.id,
              { focusFirstInnerPage: true },
            )
              .then(({ addedPages, guidesPlaced }) => {
                seatedSessionRef.current = attachSessionId
                if (guidesPlaced) {
                  showToast(
                    `내지 PDF ${result.contentPdfPageCount}p 를 편집기에 배치했습니다` +
                      (addedPages > 0 ? ` (페이지 ${addedPages}개 추가)` : '') +
                      ' — 표시전용, 인쇄는 첨부 원본 그대로입니다.',
                    'success',
                    6000,
                  )
                } else {
                  // 가이드 래스터가 실패/타임아웃(best-effort) — 첨부 자체는 성공.
                  showToast(
                    '내지 PDF 는 첨부됐지만 미리보기 생성이 지연되고 있습니다. 잠시 후 새로고침하면 표시됩니다.',
                    'warning',
                    6000,
                  )
                }
              })
              .catch((err) => {
                console.warn('[EditorWorkflowControls] 첨부 직후 앉히기 실패:', err)
                showToast(
                  '내지 PDF 는 첨부됐지만 화면 배치에 실패했습니다. 새로고침해주세요.',
                  'warning',
                  6000,
                )
              })
          }}
        />
      )}
    </>
  )
}
