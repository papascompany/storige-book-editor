/**
 * 고객 첨부 내지 PDF 모달 — 인쇄 워크플로우 v1 Phase 4 (2026-05-19).
 *
 * 흐름 (사용자 결정 6건 반영):
 *   1) 파일 선택 (application/pdf 만)
 *   2) /storage/upload-public 또는 /files/upload 로 업로드
 *   3) /worker-jobs/validate (또는 external) 로 검증 잡 생성
 *   4) 폴링: 검증 완료까지 대기 (최대 30s)
 *   5) 결정 3-4: 실패 시 첨부 거부 + 사용자에게 issue 표시
 *   6) 결정 3-2: passed + PDF 페이지수 > 내지 수 인 경우 자동확장 선택 모달
 *   7) /edit-sessions/guest/:id 또는 /edit-sessions/:id 에 contentPdfFileId 저장
 *
 * 결정 3-3: 첨부 성공 시 캔버스 편집 차단 (호출자가 readonly 처리).
 */
import { useState } from 'react'
import { apiClient } from '../../api/client'
import { editSessionsApi } from '../../api/edit-sessions'
import { useGuestStore } from '../../stores/useGuestStore'

interface Issue {
  code: string
  message: string
  autoFixable?: boolean
}

interface ValidationResult {
  status: 'completed' | 'fixable' | 'failed'
  pageCount?: number
  issues?: Issue[]
  warnings?: Issue[]
}

interface Props {
  open: boolean
  sessionId: string
  /** 현재 내지 페이지 수 (자동확장 비교용) */
  currentContentPageCount: number
  /** 자동확장 가능 여부 (templateSet.canAddPage) */
  canAddPage: boolean
  /** 닫기 */
  onClose: () => void
  /** 첨부 성공 + 페이지수 합의 끝났을 때 호출 */
  onAttached: (result: {
    contentPdfFileId: string
    contentPdfPageCount: number
    targetPageCount: number  // 자동확장 후 내지 페이지 수
    validationResult: ValidationResult
  }) => void
}

export function ContentPdfAttachModal({
  open,
  sessionId,
  currentContentPageCount,
  canAddPage,
  onClose,
  onAttached,
}: Props) {
  const guestToken = useGuestStore((s) => s.guestToken)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [validating, setValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)
  const [uploadedFileId, setUploadedFileId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showPageMismatch, setShowPageMismatch] = useState(false)
  const [guideRendering, setGuideRendering] = useState(false)

  if (!open) return null

  const reset = () => {
    setFile(null)
    setUploading(false)
    setValidating(false)
    setValidationResult(null)
    setUploadedFileId(null)
    setError(null)
    setShowPageMismatch(false)
    setGuideRendering(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.type !== 'application/pdf') {
      setError('PDF 파일만 첨부 가능합니다.')
      return
    }
    if (f.size > 50 * 1024 * 1024) {
      setError('파일 크기는 50MB 이하만 허용됩니다.')
      return
    }
    setError(null)
    setFile(f)
  }

  const handleUploadAndValidate = async () => {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      // 1) /storage/upload-public 으로 업로드 (게스트도 사용 가능)
      const form = new FormData()
      form.append('file', file)
      const uploadRes = await apiClient.post<{ id: string; url: string }>(
        '/storage/upload-public?category=uploads',
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      const fileId = uploadRes.data.id
      setUploadedFileId(fileId)
      setUploading(false)

      // 2) 워커 검증 잡 생성 — 게스트도 가능한 endpoint (validate는 정책상 인증 없음 또는 게스트 허용)
      //    검증 잡 결과 폴링은 단순화 — 향후 SSE 또는 WebSocket 으로 개선.
      setValidating(true)
      const validateRes = await apiClient.post<{ id: string }>(
        '/worker-jobs/validate',
        {
          fileId,
          fileType: 'content',
          orderOptions: {
            // 결정 3-4: 검증 실패 시 거부. 정밀 옵션은 templateSet 에서 가져와도 됨.
            size: { width: 210, height: 297 },
            pages: currentContentPageCount,
            binding: 'perfect',
            bleed: 3,
          },
        }
      )
      const jobId = validateRes.data.id

      // 3) 폴링 (최대 30초)
      let attempts = 0
      let result: ValidationResult | null = null
      while (attempts < 30) {
        await new Promise((r) => setTimeout(r, 1000))
        const job = await apiClient.get<{ status: string; result?: any; errorMessage?: string }>(
          `/worker-jobs/${jobId}`,
        )
        const s = (job.data.status || '').toUpperCase()
        if (s === 'COMPLETED' || s === 'FIXABLE' || s === 'FAILED') {
          result = {
            status: s === 'COMPLETED' ? 'completed' : s === 'FIXABLE' ? 'fixable' : 'failed',
            pageCount: job.data.result?.pageCount,
            issues: job.data.result?.issues ?? (job.data.errorMessage ? [{ code: 'WORKER_ERROR', message: job.data.errorMessage }] : []),
            warnings: job.data.result?.warnings,
          }
          break
        }
        attempts++
      }
      setValidating(false)

      if (!result) {
        setError('검증 시간 초과. 다시 시도해주세요.')
        return
      }
      setValidationResult(result)

      // 결정 3-4: failed 면 첨부 거부, 사용자가 재첨부만 가능
      if (result.status === 'failed') {
        // 모달 안에서 issues 표시만 — onAttached 호출 안 함
        return
      }

      // 결정 3-2: PDF 페이지수 < 내지 수 → 자동확장 선택 모달
      const pdfPages = result.pageCount ?? 0
      if (pdfPages > currentContentPageCount && canAddPage) {
        setShowPageMismatch(true)
        return
      }

      // 정상 흐름: 그대로 첨부 (페이지수 동일 또는 PDF 가 적음)
      const targetPageCount = pdfPages > currentContentPageCount && canAddPage
        ? pdfPages
        : currentContentPageCount
      await applyAttachment(fileId, pdfPages, targetPageCount, result)
    } catch (err) {
      console.error('[ContentPdfAttachModal]', err)
      setError(err instanceof Error ? err.message : '업로드/검증 실패')
      setUploading(false)
      setValidating(false)
    }
  }

  const applyAttachment = async (
    fileId: string,
    pdfPages: number,
    targetPageCount: number,
    result: ValidationResult,
  ) => {
    try {
      // 1) 세션에 첨부 + underlay(표시전용) 모드 저장 — 게스트 / 회원 분기
      const basePayload = {
        contentPdfFileId: fileId,
        contentPdfPageCount: pdfPages,
        contentPdfValidationResult: result as unknown as Record<string, any>,
        contentPdfMode: 'underlay' as const,
      }
      if (guestToken) {
        await editSessionsApi.updateGuest(sessionId, guestToken, basePayload)
      } else {
        await editSessionsApi.update(sessionId, basePayload)
      }

      // 2) 가이드 래스터 잡 트리거 + 폴링 → metadata.contentPdfGuide 저장 (best-effort)
      //    실패해도 첨부 자체는 성공 처리(가이드는 다음 로드/재시도에 생성 가능).
      setGuideRendering(true)
      try {
        const renderRes = await apiClient.post<{ id: string }>('/worker-jobs/render-pages', {
          fileId,
          pageCount: pdfPages,
          editSessionId: sessionId,
        })
        const rjid = renderRes.data.id
        let guide: any = null
        for (let a = 0; a < 40; a++) {
          await new Promise((r) => setTimeout(r, 1500))
          const job = await apiClient.get<{ status: string; result?: any }>(`/worker-jobs/${rjid}`)
          const s = (job.data.status || '').toUpperCase()
          if (s === 'COMPLETED') { guide = job.data.result; break }
          if (s === 'FAILED') break
        }
        if (guide?.pageImageUrls?.length) {
          const metaPayload = {
            metadata: {
              contentPdfGuide: {
                sourceFileId: fileId,
                resolution: guide.resolution,
                pageImageUrls: guide.pageImageUrls,
                renderedAt: guide.renderedAt,
              },
            },
          }
          if (guestToken) {
            await editSessionsApi.updateGuest(sessionId, guestToken, metaPayload)
          } else {
            await editSessionsApi.update(sessionId, metaPayload)
          }
        }
      } catch (e) {
        console.warn('[ContentPdfAttachModal] 가이드 래스터 실패(첨부는 성공):', e)
      } finally {
        setGuideRendering(false)
      }

      onAttached({
        contentPdfFileId: fileId,
        contentPdfPageCount: pdfPages,
        targetPageCount,
        validationResult: result,
      })
      reset()
      onClose()
    } catch (err) {
      console.error('[ContentPdfAttachModal] applyAttachment', err)
      setError(err instanceof Error ? err.message : '세션 업데이트 실패')
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
      }}
      onClick={handleClose}
    >
      <div
        style={{
          background: 'white', padding: 24, borderRadius: 8, minWidth: 480, maxWidth: 640, maxHeight: '80vh', overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: 0, marginBottom: 16 }}>내지 PDF 첨부</h2>

        {guideRendering && (
          <div style={{ background: '#e3f2fd', padding: 12, borderRadius: 4, marginBottom: 12, color: '#1565c0', fontSize: 14 }}>
            내지 가이드를 생성하는 중입니다… (페이지 수에 따라 최대 1분)
          </div>
        )}

        {!validationResult && (
          <>
            <p style={{ color: '#666', fontSize: 14, marginBottom: 12 }}>
              직접 작성한 PDF 를 첨부하면 각 페이지가 내지에 <strong>가이드</strong>로 표시됩니다.
              최종 내지 인쇄는 <strong>첨부한 원본 PDF 그대로</strong> 입니다(편집 내용은 내지 인쇄에 반영되지 않습니다).
            </p>
            <input type="file" accept="application/pdf" onChange={handleFileChange} disabled={uploading || validating} />
            {file && (
              <p style={{ fontSize: 13, color: '#555', marginTop: 8 }}>
                선택: <strong>{file.name}</strong> ({Math.round(file.size / 1024)} KB)
              </p>
            )}
            {error && <div style={{ color: '#d32f2f', marginTop: 12 }}>{error}</div>}

            <div style={{ marginTop: 24, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={handleClose} disabled={uploading || validating}>취소</button>
              <button
                onClick={handleUploadAndValidate}
                disabled={!file || uploading || validating}
                style={{ background: '#1976d2', color: 'white', padding: '6px 16px', border: 0, borderRadius: 4, cursor: 'pointer' }}
              >
                {uploading ? '업로드 중…' : validating ? '검증 중…' : '업로드 + 검증'}
              </button>
            </div>
          </>
        )}

        {validationResult?.status === 'failed' && (
          <>
            <div style={{ color: '#d32f2f', marginTop: 12, fontWeight: 600 }}>검증 실패 — 첨부할 수 없습니다.</div>
            <p style={{ color: '#666', fontSize: 13 }}>
              아래 이슈를 해결 후 다시 첨부해주세요. (결정 3-4: 강제 진행 불허)
            </p>
            <ul style={{ background: '#fff3f3', padding: 12, borderRadius: 4 }}>
              {validationResult.issues?.map((i, idx) => (
                <li key={idx} style={{ marginBottom: 4 }}>
                  <strong>{i.code}</strong>: {i.message}
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button onClick={reset}>다시 시도</button>
            </div>
          </>
        )}

        {showPageMismatch && validationResult && uploadedFileId && (
          <>
            <div style={{ background: '#fff8e1', padding: 12, borderRadius: 4, marginTop: 16 }}>
              <strong>페이지 수 불일치 안내</strong>
              <p style={{ fontSize: 13, marginTop: 8 }}>
                PDF 가 <b>{validationResult.pageCount}페이지</b>, 현재 내지가 <b>{currentContentPageCount}페이지</b> 입니다. 어떻게 할까요?
              </p>
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={handleClose}>취소</button>
              <button
                onClick={() => applyAttachment(
                  uploadedFileId,
                  validationResult.pageCount ?? 0,
                  validationResult.pageCount ?? currentContentPageCount,
                  validationResult,
                )}
                style={{ background: '#1976d2', color: 'white', padding: '6px 16px', border: 0, borderRadius: 4, cursor: 'pointer' }}
              >
                자동 확장 ({validationResult.pageCount}페이지로)
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
