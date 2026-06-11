/**
 * EmbedView — iframe 임베드 전용 라우트 (`/embed`).
 *
 * 외부 서비스(bookmoa-mobile 등)가 편집기를 iframe URL 로 띄울 때 진입하는 경로.
 * 기존 `/`(EditorView) 와 달리, **완전 배선된** `EmbeddedEditor`(embed.tsx) 를 그대로
 * 마운트한다 → 세션 자동저장 / 세션 영속 / 정식 postMessage 엔벨로프 / **sessionId 재편집**
 * 을 별도 구현 없이 재사용한다.
 *
 * 진입 형태 2종:
 *   - 신규 편집: `/embed?templateSetId=<id>&token=<jwt>&orderSeqno=<n>&pageCount=&paperType=&bindingType=&parentOrigin=`
 *   - 재편집  : `/embed?sessionId=<id>&token=<jwt>&parentOrigin=`  (templateSetId 는 세션에서 자동 도출, 명시해도 됨)
 *
 * postMessage (dual-emit):
 *   - 정식 엔벨로프 `{ source:'storige-editor', event:'editor.*' }` → EmbeddedEditor 가 parentOrigin 으로 발신
 *   - 레거시 `{ type:'storige:completed'|'storige:saved'|... }` → 아래 콜백이 함께 발신 (기존 호스트 하위호환)
 *
 * 파라미터는 camelCase / snake_case 양쪽 허용 (getParamCompat).
 */
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getParamCompat } from '@/utils/searchParams'
import {
  EmbeddedEditor,
  type EditorConfig,
  type EditorResult,
  type SaveResult,
  type EditorError,
  type EditorInstanceMethods,
} from '@/embed'
import { editSessionsApi } from '@/api'

/**
 * 부모(호스트) 윈도우로 레거시 `storige:*` 메시지 발신 (하위호환).
 * 정식 엔벨로프는 EmbeddedEditor 가 별도로 발신하므로, 여기서는 기존 호스트가 듣던 포맷만 보강한다.
 * - top-level(iframe 아님)이면 스킵.
 * - targetOrigin: parentOrigin 있으면 그 origin, 없으면 하위호환을 위해 '*'.
 */
function emitLegacy(parentOrigin: string | undefined, type: string, payload: unknown): void {
  if (typeof window === 'undefined') return
  if (window.parent === window) return
  try {
    window.parent.postMessage({ type, payload }, parentOrigin || '*')
  } catch (err) {
    console.warn('[EmbedView] legacy postMessage failed:', err)
  }
}

export default function EmbedView() {
  const [searchParams] = useSearchParams()
  const [config, setConfig] = useState<EditorConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  // EmbeddedEditor 가 명령형 메서드(save/complete/cancel…)를 노출하는 ref.
  // 라우트 마운트에서는 직접 호출하지 않지만(헤더 버튼이 구동), prop 으로 필수.
  const instanceRef = useRef<EditorInstanceMethods | null>(null)

  useEffect(() => {
    let mounted = true

    async function build() {
      const get = (key: string) => getParamCompat(searchParams, key) || undefined

      const sessionId = get('sessionId')
      let templateSetId = get('templateSetId')
      const token = get('token')
      const refreshToken = get('refreshToken')
      const parentOrigin = get('parentOrigin')
      const orderSeqnoRaw = get('orderSeqno')
      const orderSeqno = orderSeqnoRaw ? Number(orderSeqnoRaw) : undefined
      const productId = get('productId')
      const mode = get('mode') as EditorConfig['mode'] | undefined
      const callbackUrl = get('callbackUrl')
      const coverFileId = get('coverFileId')
      const contentFileId = get('contentFileId')
      const apiBaseUrl = get('apiBaseUrl')
      const pageCount = get('pageCount') ? Number(get('pageCount')) : undefined
      const paperType = get('paperType')
      const bindingType = get('bindingType')
      // 주문 메타 스냅샷용 (2026-06-11) — admin 세션/삭제 리스트에서 부수·인쇄제목·상품명 노출
      const quantity = get('quantity') ? Number(get('quantity')) : undefined
      const title = get('title')
      const productName = get('productName')
      const widthRaw = get('width')
      const heightRaw = get('height')
      const size = widthRaw && heightRaw ? { width: Number(widthRaw), height: Number(heightRaw) } : undefined

      // 토큰을 먼저 localStorage 에 주입 (EmbeddedEditor 와 동일 메커니즘).
      // 아래 재편집 세션 조회가 인증을 필요로 할 수 있으므로 선주입한다.
      if (token) {
        try { localStorage.setItem('auth_token', token) } catch { /* SSR/프라이버시 모드 무시 */ }
      }
      // 사일런트 리프레시용: refreshToken(30d) 저장 → 401 시 자동 갱신(포토북 다일 편집).
      if (refreshToken) {
        try { localStorage.setItem('auth_refresh_token', refreshToken) } catch { /* 무시 */ }
      }

      // 재편집: sessionId 만 받고 templateSetId 가 없으면 세션에서 도출.
      // (bookmoa 가 templateSetId 를 함께 보내면 이 조회는 생략됨)
      if (sessionId && !templateSetId) {
        try {
          const session = await editSessionsApi.get(sessionId)
          templateSetId = session.templateSetId || undefined
        } catch (err) {
          console.warn('[EmbedView] 세션 조회 실패 — templateSetId 도출 불가:', err)
        }
      }

      if (!templateSetId) {
        if (mounted) {
          setError(
            sessionId
              ? '세션에서 템플릿셋을 확인할 수 없습니다. (templateSetId 를 함께 전달하세요)'
              : 'templateSetId 또는 유효한 sessionId 가 필요합니다.',
          )
        }
        return
      }

      const cfg: EditorConfig = {
        mode,
        orderSeqno,
        templateSetId,
        productId,
        token,
        refreshToken,
        sessionId,
        coverFileId,
        contentFileId,
        apiBaseUrl,
        callbackUrl,
        parentOrigin,
        options: { pageCount, paperType, bindingType, size, quantity, title, productName },
        // 레거시 dual-emit (정식 엔벨로프는 EmbeddedEditor 가 별도 발신)
        onReady: () => emitLegacy(parentOrigin, 'storige:ready', { templateSetId, sessionId }),
        onSave: (r: SaveResult) =>
          emitLegacy(parentOrigin, 'storige:saved', { sessionId: r.sessionId, savedAt: r.savedAt }),
        onComplete: (r: EditorResult) =>
          emitLegacy(parentOrigin, 'storige:completed', {
            sessionId: r.sessionId,
            orderSeqno: r.orderSeqno,
            status: 'completed',
            completedAt: r.savedAt,
            files: {
              coverFileId: r.files.coverFileId ?? null,
              contentFileId: r.files.contentFileId ?? null,
            },
          }),
        onCancel: () => emitLegacy(parentOrigin, 'storige:cancel', {}),
        onError: (err: Error | EditorError) =>
          emitLegacy(parentOrigin, 'storige:error', {
            message: err instanceof Error ? err.message : err.message,
          }),
      }

      if (mounted) setConfig(cfg)
    }

    build()
    return () => {
      mounted = false
    }
  }, [searchParams])

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-editor-bg">
        <div className="bg-white rounded-lg p-6 max-w-md text-center">
          <div className="text-red-500 text-4xl mb-4">!</div>
          <p className="text-editor-text whitespace-pre-line">{error}</p>
        </div>
      </div>
    )
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-editor-bg">
        <div className="text-editor-text">에디터를 불러오는 중...</div>
      </div>
    )
  }

  return (
    <div className="h-screen w-screen">
      <EmbeddedEditor {...config} instanceRef={instanceRef} />
    </div>
  )
}
