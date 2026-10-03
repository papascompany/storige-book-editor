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
 *   - 게스트 세션 재편집: 위 재편집 URL 에 `#guestToken=<게스트 토큰>` fragment 를 붙인다.
 *     편집기는 fragment 에서만 읽고(쿼리 `guestToken` 은 읽지 않음) 주소창에서 곧바로 지운다.
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
import { normalizeSpineCode, parseSpineWidthMmParam } from '@/utils/hostSpine'
import { parsePageCountLimitParam, parsePageStepParam } from '@/utils/hostPageLimits'
import {
  EmbeddedEditor,
  EMBED_MESSAGE_SOURCE,
  EMBED_MESSAGE_VERSION,
  type EditorConfig,
  type EditorResult,
  type SaveResult,
  type EditorError,
  type EditorInstanceMethods,
  type EmbedMessageEnvelope,
} from '@/embed'
import { setAdminEditTab, setAuthToken, setEmbedRefreshToken } from '@/utils/authTokenStorage'
import { readAuthFragment, stripAuthFragment, type AuthFragment } from '@/utils/adminEditUrl'
import {
  readGuestTokenFragment,
  recallEmbedGuestToken,
  stripGuestTokenFragment,
} from '@/utils/embedGuestTokenStore'
import {
  fetchSessionForReopen,
  httpStatusOf,
  redactGuestTokenInError,
  sessionNotFoundMessage,
  sessionNotFoundReasonOf,
} from '@/utils/embedSessionReopen'
import { EMBED_FAILURE_MESSAGES, resolveInitFailure } from '@/utils/embedFailurePolicy'

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

/**
 * 부모(호스트) 윈도우로 정식 `editor.error` 엔벨로프 발신 — EmbeddedEditor 가 마운트되기 전에
 * 실패한 경우에 쓴다. 규칙은 EmbeddedEditor 의 발신과 같다(parentOrigin 필수, top-level 이면 스킵).
 */
function emitFormalError(parentOrigin: string | undefined, payload: EditorError): void {
  if (!parentOrigin) return
  if (typeof window === 'undefined') return
  if (window.parent === window) return
  const envelope: EmbedMessageEnvelope<EditorError> = {
    source: EMBED_MESSAGE_SOURCE,
    version: EMBED_MESSAGE_VERSION,
    event: 'editor.error',
    payload,
    timestamp: new Date().toISOString(),
  }
  try {
    window.parent.postMessage(envelope, parentOrigin)
  } catch (err) {
    console.warn('[EmbedView] postMessage failed:', err)
  }
}

/** fragment 로 받은 게스트 토큰 — 받은 시점의 sessionId 에 묶는다 */
interface FragmentGuestToken {
  sessionId: string | null
  token: string
}

export default function EmbedView() {
  const [searchParams] = useSearchParams()
  const [config, setConfig] = useState<EditorConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  // EmbeddedEditor 가 명령형 메서드(save/complete/cancel…)를 노출하는 ref.
  // 라우트 마운트에서는 직접 호출하지 않지만(헤더 버튼이 구동), prop 으로 필수.
  const instanceRef = useRef<EditorInstanceMethods | null>(null)
  // fragment 게스트 토큰 보관 — 주소창에서 지운 뒤 effect 가 다시 실행돼도(StrictMode 등) 같은
  // sessionId 이면 이 값을 쓴다. 검증 전 값이므로 탭 저장소에는 쓰지 않는다.
  const fragmentGuestTokenRef = useRef<FragmentGuestToken | null>(null)

  useEffect(() => {
    let mounted = true

    async function build() {
      const get = (key: string) => getParamCompat(searchParams, key) || undefined

      // 관리자 편집 탭(2026-09-29): adminEdit=session 일 때만 토큰을 URL fragment 에서 받아
      // 탭 단위 sessionStorage 에 둔다. 일반(파트너) 임베드는 플래그를 해제 → 종전 localStorage 경로.
      const adminEdit = getParamCompat(searchParams, 'adminEdit') === 'session'
      setAdminEditTab(adminEdit)
      const frag: AuthFragment = adminEdit && typeof window !== 'undefined' ? readAuthFragment(window.location.hash) : {}

      const sessionId = get('sessionId')
      let templateSetId = get('templateSetId')
      const token = frag.token ?? get('token')
      const refreshToken = frag.refreshToken ?? get('refreshToken')
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
      // S5 (R-195): trim 후 '' 또는 '-'(호스트의 미지정 표기) → undefined.
      const paperType = normalizeSpineCode(get('paperType'))
      const bindingType = normalizeSpineCode(get('bindingType'))
      // R-195: 호스트(주문) 지정 책등 폭(mm). 유한수 ≥ 0 만 수용('0' → 0),
      // ''·NaN·음수 → undefined(비어있지 않은 무효값은 console.warn). snake `spine_width_mm` 허용.
      const spineWidthMm = parseSpineWidthMmParam(getParamCompat(searchParams, 'spineWidthMm'))
      // R-196 host page limits (2026-09-29): 상품별 내지 쪽수 범위·배수(물리 페이지). 템플릿셋
      // pageCountRange/pageStep 보다 우선. 정수만 수용(min/max 1~500, pageStep 2~500, pageStep '1'=부재),
      // 무효값은 console.warn 후 undefined → 기존 동작. snake `page_count_min`·`page_count_max`·`page_step` 허용.
      const pageCountMin = parsePageCountLimitParam(getParamCompat(searchParams, 'pageCountMin'), 'pageCountMin')
      const pageCountMax = parsePageCountLimitParam(getParamCompat(searchParams, 'pageCountMax'), 'pageCountMax')
      const pageStep = parsePageStepParam(getParamCompat(searchParams, 'pageStep'))
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

      // 토큰을 먼저 저장소에 주입 (EmbeddedEditor 와 동일 메커니즘).
      // 아래 재편집 세션 조회가 인증을 필요로 할 수 있으므로 선주입한다.
      // 저장소: 일반 임베드=localStorage(종전), 관리자 편집 탭=sessionStorage (authTokenStorage).
      if (token) {
        setAuthToken(token)
      }
      // 사일런트 리프레시용: refreshToken(30d) 저장 → 401 시 자동 갱신(포토북 다일 편집).
      if (refreshToken) {
        setEmbedRefreshToken(refreshToken)
      }
      // 게스트 세션 재오픈 토큰: fragment(`#guestToken=`)에서만 받는다. 관리자 편집 탭은 쓰지 않는다.
      // 받은 값은 sessionId 에 묶어 ref 에 두고, 검증 전이므로 탭 저장소에는 쓰지 않는다.
      const fragGuestToken = typeof window !== 'undefined' ? readGuestTokenFragment(window.location.hash) : null
      if (fragGuestToken && !adminEdit) {
        fragmentGuestTokenRef.current = { sessionId: sessionId ?? null, token: fragGuestToken }
      }
      const heldGuestToken = fragmentGuestTokenRef.current
      const guestToken =
        !adminEdit && sessionId && heldGuestToken?.sessionId === sessionId ? heldGuestToken.token : undefined

      // 주소창 fragment 에서 토큰을 지운다 — 관리자 편집 탭의 인증 토큰(새로고침은 탭 저장소로 이어감)과
      // 게스트 토큰 키. 쿼리와 다른 fragment 키는 유지한다.
      if (typeof window !== 'undefined') {
        try {
          const href = window.location.href
          const stripped = stripGuestTokenFragment(adminEdit ? stripAuthFragment(href) : href)
          if (stripped !== href) window.history.replaceState(window.history.state, '', stripped)
        } catch { /* SSR/보안 제약 무시 */ }
      }

      // 재편집: sessionId 만 받고 templateSetId 가 없으면 세션에서 도출.
      // (bookmoa 가 templateSetId 를 함께 보내면 이 조회는 생략됨)
      // 게스트 토큰이 있으면 게스트 조회 경로 → 기억된 토큰 → 기존 조회 경로 순(EmbeddedEditor 와 같은 순서).
      // 조회 실패 시 화면 문구는 호스트에 보낸 message 와 같은 고정 문구다.
      let reopenFailureMessage: string | null = null
      if (sessionId && !templateSetId) {
        try {
          const session = await fetchSessionForReopen(sessionId, {
            presented: guestToken ?? null,
            remembered: recallEmbedGuestToken(sessionId),
          })
          templateSetId = session.templateSetId || undefined
        } catch (err) {
          redactGuestTokenInError(err, guestToken)
          const status = httpStatusOf(err)
          console.warn('[EmbedView] 세션 조회 실패 — templateSetId 도출 불가:', status)
          const reason = sessionNotFoundReasonOf(err, status)
          if (reason && mounted) {
            const message = sessionNotFoundMessage(reason)
            reopenFailureMessage = message
            const payload: EditorError = { code: 'SESSION_NOT_FOUND', message, sessionId, reason, fatal: true }
            emitFormalError(parentOrigin, payload)
            emitLegacy(parentOrigin, 'storige:error', { message })
          } else if (mounted) {
            // 그 밖의 실패는 편집기 초기화와 같은 분류·고정 문구로 알린다(연결·타임아웃·5xx·408·429 →
            // NETWORK_ERROR, 그 밖 → INVALID_DATA). 이 단계에는 인증 만료 리스너가 없으므로 401 은
            // 여기서 AUTH_EXPIRED 를 1회 알린다.
            const resolution = resolveInitFailure(err)
            const payload: EditorError = resolution.action === 'notifyHost'
              ? { code: resolution.code, message: resolution.message, fatal: true }
              : { code: 'AUTH_EXPIRED', message: resolution.screenMessage, fatal: true }
            reopenFailureMessage = payload.message
            emitFormalError(parentOrigin, payload)
            emitLegacy(parentOrigin, 'storige:error', { message: payload.message })
          }
        }
      }

      if (!templateSetId) {
        if (mounted) {
          if (!sessionId) {
            setError('templateSetId 또는 유효한 sessionId 가 필요합니다.')
          } else if (reopenFailureMessage) {
            setError(reopenFailureMessage)
          } else {
            // 조회는 됐지만 세션에 템플릿셋이 없다 — 고객에게는 고정 안내 문구만 보이고 이벤트는 보내지 않는다.
            console.warn('[EmbedView] 세션에 templateSetId 가 없어 편집기를 열 수 없음 — templateSetId 를 함께 전달하면 이 조회를 생략한다')
            setError(EMBED_FAILURE_MESSAGES.templateSetNotFound)
          }
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
        // 게스트 세션 재오픈 토큰 — sessionId 가 있을 때만 전달
        ...(guestToken ? { guestToken } : {}),
        coverFileId,
        contentFileId,
        apiBaseUrl,
        callbackUrl,
        parentOrigin,
        options: {
          pageCount, paperType, bindingType, size, quantity, title, productName,
          wingEnabled, wingWidthMm, contentPdfAttach, spineWidthMm,
          pageCountMin, pageCountMax, pageStep,
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
            //    emitLegacy 는 `parentOrigin` 이 없으면 `targetOrigin='*'` 로 송신하므로(emitLegacy 본문 참조),
            //    무조건 동봉하면 임베드 페이지의 다른 스크립트·프레임에 게스트 토큰이 샌다.
            //    PLATFORM_INTEGRATION_GUIDE §3.2 가 "레거시 페이로드는 필드 화이트리스트라
            //    token·guestToken 같은 자격증명은 실리지 않는다"(와일드카드 송신 한정) 를 완화 근거로
            //    명시하고 있어, 그 보안 속성을 깨지 않으려면 오리진 고정이 전제여야 한다.
            //    (sessionId 는 기존 레거시 계약대로 와일드카드 송신에도 포함 — 이 불변식의 범위 밖.
            //     불변식은 views/EmbedView.test.tsx D24·D25 가 잠근다.)
            //    ⇒ 파트너가 게스트 승계를 쓰려면 `parentOrigin` 을 지정해야 한다(가이드에 명기).
            ...(r.needsAuth ? { needsAuth: r.needsAuth } : {}),
            ...(parentOrigin && r.guestToken ? { guestToken: r.guestToken } : {}),
            ...(r.pageCount != null ? { pageCount: r.pageCount } : {}),
            ...(r.size ? { size: r.size } : {}),
            ...(r.pricing ? { pricing: r.pricing } : {}),
            // R-195: 적용 책등 폭(mm, 스프레드 책만) — 정의된 경우에만 additive.
            ...(r.spineWidthMm != null ? { spineWidthMm: r.spineWidthMm } : {}),
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
