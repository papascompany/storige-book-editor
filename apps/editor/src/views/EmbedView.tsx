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
      // 표지 날개(2026-08-03): 날개는 종전까지 템플릿 spec 전용 정적값이라, 같은 표지 템플릿으로
      // 상품별 날개 유무를 가를 수 없었다. 호스트(bookmoa 관리자)가 상품 세팅을 주문 옵션으로
      // 전달하면 편집기가 반영한다. 미전달이면 템플릿 값 그대로 = 기존 동작 불변.
      const wingEnabledRaw = get('wingEnabled')
      const wingEnabled =
        wingEnabledRaw === undefined ? undefined : wingEnabledRaw === '1' || wingEnabledRaw === 'true'
      const wingWidthMmRaw = get('wingWidthMm')
      const wingWidthMm = wingWidthMmRaw ? Number(wingWidthMmRaw) : undefined
      // 내지 PDF 첨부 진입점(W1-G2, 2026-08-13): book 모드면 기본 노출.
      // 첨부를 쓰지 않는 호스트는 `contentPdfAttach=0|false` 로 끈다(미전달=노출).
      const contentPdfAttachRaw = get('contentPdfAttach')
      const contentPdfAttach =
        contentPdfAttachRaw === undefined
          ? undefined
          : !(contentPdfAttachRaw === '0' || contentPdfAttachRaw === 'false')
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
        options: {
          pageCount, paperType, bindingType, size, quantity, title, productName,
          wingEnabled, wingWidthMm, contentPdfAttach,
        },
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
            // S2 (2026-07-04): 실측 페이지수/규격/가격메타 — 정식 envelope 와 동일하게
            // legacy 형식에도 additive 동봉 (bookmoa-mobile 은 storige:completed 를 주 수신).
            //
            // 🔴 2026-09-21: needsAuth·guestToken 도 동봉한다. **이 2키가 없으면 게스트 완료가
            //    파트너에게 "완료"로 전달된다.** 게스트 완료 분기(embed.tsx)의 발신 순서가
            //      ① onComplete(=이 legacy) → ② 'editor.complete'(needsAuth 보유) → ③ 'editor.needAuth'
            //    이라, legacy 를 먼저 처리하고 중복방지 플래그를 세우는 호스트는 ②③을 버린다.
            //    그 결과 파트너가 구현해 둔 needsAuth 분기와 needAuthRef 폴백이 **구조적으로
            //    발화하지 못했다**(needAuth 는 완료보다 먼저 나가는 경로가 없다 — 발신처는
            //    embed.tsx 의 완료 분기 2곳뿐이고 GuestAuthPromptModal 은 사용처 0건).
            //    실피해 확인: bookmoa 장바구니 2건이 files 0·guestToken null 로 담겼다.
            // ⚠️ 위의 `status: 'completed'` 는 **게스트 완료에도 하드코딩 리터럴**이다.
            //    수신 측은 status 로 판정하면 안 되고 needsAuth·files 로 판정해야 한다.
            //    (교정하면 리터럴을 읽는 미확인 파트너를 깨뜨릴 수 있어 의도적으로 유지 —
            //     `docs/PLATFORM_INTEGRATION_GUIDE.md` 에 수신 측 경고를 명기한다.)
            //
            // 🔒 `needsAuth` 는 무조건 동봉(불리언 — 자격증명 아님).
            //    `guestToken` 은 **`parentOrigin` 이 지정된 경우에만** 동봉한다.
            //    emitLegacy 는 `parentOrigin` 이 없으면 `targetOrigin='*'` 로 송신하므로(위 38행),
            //    무조건 동봉하면 임베드 페이지의 다른 스크립트·프레임에 게스트 토큰이 샌다.
            //    PLATFORM_INTEGRATION_GUIDE §3.2 가 "레거시 페이로드는 필드 화이트리스트라
            //    token·guestToken 같은 자격증명은 실리지 않는다" 를 완화 근거로 명시하고 있어,
            //    그 보안 속성을 깨지 않으려면 오리진 고정이 전제여야 한다.
            //    ⇒ 파트너가 게스트 승계를 쓰려면 `parentOrigin` 을 지정해야 한다(가이드에 명기).
            ...(r.needsAuth ? { needsAuth: r.needsAuth } : {}),
            ...(parentOrigin && r.guestToken ? { guestToken: r.guestToken } : {}),
            ...(r.pageCount != null ? { pageCount: r.pageCount } : {}),
            ...(r.size ? { size: r.size } : {}),
            ...(r.pricing ? { pricing: r.pricing } : {}),
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
