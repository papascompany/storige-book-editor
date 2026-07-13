/**
 * Storige Editor - Embeddable Entry Point
 *
 * PHP 쇼핑몰 등 외부 페이지에서 에디터를 임베딩할 수 있는 진입점
 *
 * 사용 예시:
 * ```html
 * <div id="editor-root"></div>
 * <script src="editor-bundle.js"></script>
 * <script>
 *   const editor = window.StorigeEditor.create({
 *     templateSetId: 'ts-001',
 *     productId: 'PROD-001',
 *     token: 'jwt-token',
 *     onComplete: (result) => console.log(result)
 *   });
 *   editor.mount('editor-root');
 * </script>
 * ```
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createRoot, Root } from 'react-dom/client'
import { useAppStore } from './stores/useAppStore'
import { rebindFrameInteractivity } from './utils/frameInteractive'
import { applyObjectPermissions } from './utils/objectPermissions'
import { trackRequiredEdits, collectUneditedRequiredForCustomer } from './utils/requiredEditGate'
import { runWithAutosaveSuspended } from './utils/autosaveSuspend'
import { useAuthStore } from './stores/useAuthStore'
import { useSettingsStore } from './stores/useSettingsStore'
import { useSaveStore } from './stores/useSaveStore'
import { useEditorContents } from './hooks/useEditorContents'
import { useEmbedAutoSave } from './hooks/useEmbedAutoSave'
import { useEmbedBackGuard } from './hooks/useEmbedBackGuard'
import { useCanvasContainerSizeSync } from './hooks/useCanvasContainerSizeSync'
import { createCanvas, safeDisposeCanvas, CanvasInitCancelledError } from './utils/createCanvas'
import { buildSpreadSnapshots } from './utils/buildSpreadSnapshots'
import {
  computeInnerContentSizeMm,
  computeCoverOutputSizeMm,
  computeLivePageCount,
  resolveTemplateSetCoverMeta,
} from './utils/photobookSpread'
import { templatesApi, editSessionsApi, filesApi, apiClient, type EditSessionResponse } from './api'
import { core, ServicePlugin } from '@storige/canvas-core'
import type { PhotobookPricing, TemplateSetCoverMeta } from '@storige/types'
import type { ApiError } from './api/client'
import ToolBar from './components/editor/ToolBar'
import FeatureSidebar from './components/editor/FeatureSidebar'
import ControlBar from './components/editor/ControlBar'
import SidePanel from './components/editor/SidePanel'
import EditorHeader from './components/editor/EditorHeader'
import { BookNavigation } from './components/PageNavigation/BookNavigation'
import { SpreadPagePanel } from './components/PagePanel/SpreadPagePanel'
import { useResolvedPageNavPosition } from './hooks/useResolvedPageNavPosition'
import { WorkspaceModal } from './components/modals'
import { RestoreBackupBanner } from './components/RestoreBackupBanner'
import { Sentry } from './lib/sentry'
import { applyContentPdfGuides } from './utils/contentPdfGuide'
import { detectOrientationMismatch, type OrientationMismatch } from './utils/orientationGuard'
import { useExternalPhotosStore } from './stores/useExternalPhotosStore'
import './index.css'

// ============================================================
// 편집완료(finish) 진단 · 안전 유틸
// ============================================================

/**
 * finish 단계 마커.
 * 무거운 PDF 생성이 프로덕션 렌더러를 프리즈시켜도 "마지막으로 통과한 단계"를 알 수 있도록,
 * 각 단계 진입 직전에 호출해 Sentry 로 즉시 전송(await flush)하고 콘솔에도 타임스탬프로 남긴다.
 * Sentry 미설정/네트워크 실패는 무시(throw 하지 않음 — finish 흐름을 막지 않는다).
 */
async function finishMark(phase: string, extra?: Record<string, unknown>): Promise<void> {
  const ts = new Date().toISOString()
  console.log(`[EmbeddedEditor][finish] ${phase}`, extra ?? '', ts)
  try {
    Sentry.captureMessage(`[finish] ${phase}`, { level: 'info', extra: { ...extra, ts } } as any)
    await Sentry.flush(1500)
  } catch {
    /* Sentry 미설정/네트워크 — 무시 */
  }
}

/**
 * 워치독: 비동기 행(hang) 방지. p 가 ms 안에 끝나지 않으면 reject.
 * (주의: 메인스레드 동기 블록은 setTimeout 자체가 지연되어 못 잡는다 — 비동기 행/네트워크 stall 대비용.)
 */
function withWatchdog<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`WATCHDOG_TIMEOUT_${ms}ms:${label}`)), ms),
    ),
  ])
}

// ============================================================
// Types
// ============================================================

export interface EditorConfig {
  /** 편집 모드 (bookmoa 연동용) */
  mode?: 'cover' | 'content' | 'both' | 'template'
  /** 주문 번호 (bookmoa 연동용) */
  orderSeqno?: number
  /** 템플릿셋 ID (필수) */
  templateSetId: string
  /** 쇼핑몰 상품 ID */
  productId?: string
  /** API 인증 토큰 (필수, 없으면 쿠키 기반 인증 사용) */
  token?: string
  /** 리프레시 토큰(30d) — 401 시 사일런트 갱신용(포토북 다일 편집 지원) */
  refreshToken?: string
  /** 기존 편집 세션 ID (재편집시) */
  sessionId?: string
  /** 표지 파일 ID (bookmoa 연동용) */
  coverFileId?: string
  /** 내지 파일 ID (bookmoa 연동용) */
  contentFileId?: string
  /** API 기본 URL */
  apiBaseUrl?: string
  /** Worker 완료 시 콜백 URL (bookmoa 웹훅 수신용) */
  callbackUrl?: string
  /**
   * 부모 페이지 origin (Phase A-1, 2026-05-16).
   *
   * iframe 으로 임베드되는 경우 postMessage 의 targetOrigin 으로 사용된다.
   * 보안 요구: 부모-자식 통신이 필요한 모든 inline embed 배포에서는 반드시 명시.
   * 명시되지 않으면 postMessage 송신을 비활성화 (콜백 함수만 동작).
   */
  parentOrigin?: string
  /** 동적 옵션 */
  options?: {
    /** 페이지 수 */
    pages?: number
    /** 요청된 내지 페이지 수 (자동 맞춤용) */
    pageCount?: number
    /** 종이 타입 (책등 계산용) */
    paperType?: string
    /** 제본 방식 코드 (책등 계산용) */
    bindingType?: string
    /** 부수(수량) — metadata.orderOptions 스냅샷용 (2026-06-11) */
    quantity?: number
    /** 인쇄제목(작업 제목) — metadata.orderOptions 스냅샷용 */
    title?: string
    /** 상품명 — metadata.orderOptions 스냅샷용 */
    productName?: string
    /** 판형 크기 */
    size?: { width: number; height: number }
    /** 제본 방식 */
    binding?: 'perfect' | 'saddle' | 'spring'
    /** 재단 여백 */
    bleed?: number
    /** 종이 두께 */
    paperThickness?: number
    /** 날개 설정 */
    coverWing?: { front: number; back: number }
    /** 종이 정보 */
    paper?: { type: string; weight: number }
  }
  /** 편집 완료 콜백 */
  onComplete?: (result: EditorResult) => void
  /** 편집 취소 콜백 */
  onCancel?: () => void
  /** 에러 발생 콜백 */
  onError?: (error: Error | EditorError) => void
  /** 저장 완료 콜백 */
  onSave?: (result: SaveResult) => void
  /** 준비 완료 콜백 */
  onReady?: () => void
}

export interface EditorError {
  code:
    | 'AUTH_EXPIRED'
    | 'NETWORK_ERROR'
    | 'SAVE_FAILED'
    | 'INVALID_DATA'
    | 'SESSION_NOT_FOUND'
    | 'TEMPLATE_SET_NOT_FOUND'
  message: string
}

export interface EditorResult {
  sessionId: string
  orderSeqno?: number
  editCode?: string
  /**
   * 게스트 세션 완료 시 true — 로그인 유도 신호 (STALE-CLOSURE-001).
   * 이 값이 true이면 guestToken도 함께 포함됨. bookmoa는 editor.complete.needsAuth로 분기.
   */
  needsAuth?: boolean
  /** 게스트 세션 토큰 — needsAuth=true일 때만 포함 */
  guestToken?: string
  pages: {
    initial: number
    final: number
  }
  /**
   * 편집 완료 시점의 현재 총 페이지 수 (2026-06-24, 포토북 페이지 가변 가격용).
   * 라이브 캔버스 페이지 수(allCanvas.length). pages.final 과 동일 값을 가지나,
   * 파트너 장바구니가 가/감 가격 계산에 사용하는 명시 필드로 별도 노출(additive).
   */
  pageCount?: number
  /**
   * 포토북 페이지 가변 가격 메타 (2026-06-24). 템플릿셋에 pricing 이 설정된 경우에만 포함.
   * storige 는 가격을 계산하지 않는다 — 이 메타 + pageCount 로 **파트너 장바구니가 가격을 계산**.
   * 미설정(BOOK/LEAFLET 등)이면 생략(기존 동작 비파괴).
   */
  pricing?: PhotobookPricing
  /**
   * S2 (2026-07-04): 편집 완료 시점의 캔버스 규격(mm, additive).
   * 파트너가 주문 옵션 규격과의 정합 검증에 사용할 수 있는 참고값 — 규격의 권위는
   * 여전히 상품 옵션이며(embed 는 S1 로 편집기 내 규격 변경 차단), 이 값은 감사/검증용.
   */
  size?: { width: number; height: number; unit: 'mm' }
  files: {
    coverFileId?: string
    contentFileId?: string
    cover?: string
    content?: string
    thumbnailUrl?: string
    thumbnail?: string
  }
  savedAt: string
}

export interface SaveResult {
  sessionId: string
  savedAt: string
  thumbnail?: string
}

/**
 * D-3 (2026-07-06): `editor.pricingChange` payload — 가격 영향 변경(페이지 증감 등)의 실시간 통지.
 * 가격 계산 주체는 **호스트 서비스**(D-3 오너 결정) — 편집기는 변경된 값만 전달한다.
 * 발신 조건(보수 기본): 초기화 완료 후 + 회원 세션 + 템플릿셋 pricing 설정 시에만.
 */
export interface PricingChangePayload {
  sessionId: string | null
  /** 현재 총 물리 페이지 수 (포토북 내지 펼침면 = 캔버스 ×2) — editor.complete 의 pageCount 와 동일 산식 */
  pageCount: number
  /** 템플릿셋 가변 가격 메타 (설정된 셋만 — 미설정이면 이벤트 자체가 발신되지 않음) */
  pricing?: PhotobookPricing
  /** 커버 종류 코드 (templateSet.coverType 설정 시에만, string 코드 — 고정 enum 아님) */
  coverType?: string
}

export interface EditorState {
  ready: boolean
  modified: boolean
  currentPage: number
  totalPages: number
}

// ============================================================
// Embedded Editor Component
// ============================================================

interface EmbeddedEditorProps extends EditorConfig {
  instanceRef: React.MutableRefObject<EditorInstanceMethods | null>
}

// ============================================================
// postMessage Standard (Phase A-1, 2026-05-16)
// ============================================================
// 외부 사이트가 Storige Editor 를 iframe 으로 임베드하는 경우의 부모↔자식 통신 규약.
// 자세한 사양: docs/PHASE_0_CONTRACT_DECISIONS_2026-05-16.md §4

export const EMBED_MESSAGE_SOURCE = 'storige-editor'
export const EMBED_MESSAGE_VERSION = '1'
/** 호스트(bookmoa 등)가 편집기로 보내는 명령 메시지의 source 식별자 */
export const EMBED_HOST_MESSAGE_SOURCE = 'storige-host'

export type EmbedMessageEvent =
  | 'editor.ready'
  | 'editor.save'
  | 'editor.complete'
  | 'editor.cancel'
  | 'editor.error'
  | 'editor.needAuth'
  // 호스트 명령(getState/saveNow)에 대한 응답
  | 'editor.state'
  | 'editor.saved'
  // D-3 (2026-07-06, additive — needAuth 선례): 페이지 증감 등 가격 영향 변경 실시간 통지.
  // 수신부는 event 스위치로 미지 이벤트를 무시하므로 비파괴. 게스트 세션·pricing 미설정 셋 미발신.
  | 'editor.pricingChange'

/** 호스트 → 편집기 명령 종류 */
export type EmbedHostCommand = 'getState' | 'saveNow' | 'setBackGuard'

/** 호스트 → 편집기 명령 메시지 봉투 */
export interface EmbedHostCommandEnvelope<T = unknown> {
  source: typeof EMBED_HOST_MESSAGE_SOURCE
  version: typeof EMBED_MESSAGE_VERSION
  command: EmbedHostCommand
  /** 응답 매칭용(에디터가 응답 payload 에 그대로 echo) */
  requestId?: string
  payload?: T
}

export interface EmbedMessageEnvelope<T = unknown> {
  source: typeof EMBED_MESSAGE_SOURCE
  version: typeof EMBED_MESSAGE_VERSION
  event: EmbedMessageEvent
  payload: T
  timestamp: string
}

/**
 * 부모 페이지로 postMessage 전송.
 *
 * 보안 규칙:
 * - parentOrigin 이 제공되지 않으면 송신하지 않는다 (콜백 함수만 동작).
 * - targetOrigin 은 절대 '*' 사용 금지 — parentOrigin 그대로 사용.
 * - top-level window 인 경우(iframe 아닌 경우) 송신 스킵.
 */
function postToParent<T>(
  parentOrigin: string | undefined,
  event: EmbedMessageEvent,
  payload: T,
): void {
  if (!parentOrigin) return // 콜백 함수만 사용하는 IIFE 마운트 모드
  if (typeof window === 'undefined') return
  if (window.parent === window) return // top-level — iframe 아님

  const envelope: EmbedMessageEnvelope<T> = {
    source: EMBED_MESSAGE_SOURCE,
    version: EMBED_MESSAGE_VERSION,
    event,
    payload,
    timestamp: new Date().toISOString(),
  }

  try {
    // parentOrigin 만 신뢰. '*' 절대 금지.
    window.parent.postMessage(envelope, parentOrigin)
  } catch (err) {
    console.warn('[Editor] postMessage failed:', err)
  }
}

/**
 * 샘플 템플릿셋 폴백 허용 여부 (2026-06-11).
 *
 * 과거: 템플릿셋 로드 실패 시 사용자 모르게 'sample-8x8-book-24p' 로 무음 바꿔치기 →
 * 고객이 잘못된 지오메트리(판형/책등) 위에서 편집·주문하는 사고 위험.
 * 현재: DEV 빌드 또는 URL 파라미터 `allowSampleFallback=1` 일 때만 폴백 허용.
 * 프로덕션 기본은 폴백 없이 오류 화면 + editor.error(TEMPLATE_SET_NOT_FOUND) 발신.
 */
function isSampleFallbackAllowed(): boolean {
  if (import.meta.env.DEV === true) return true
  try {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).get('allowSampleFallback') === '1'
  } catch {
    return false
  }
}

// Edit Session API integration
interface EditSessionCreatePayload {
  orderSeqno: number
  mode: 'cover' | 'content' | 'both' | 'template'
  coverFileId?: string
  contentFileId?: string
  templateSetId?: string
  callbackUrl?: string
  metadata?: Record<string, any>
}

export interface EditorInstanceMethods {
  save: () => Promise<SaveResult>
  complete: () => Promise<void>
  cancel: () => void
  undo: () => void
  redo: () => void
  getState: () => EditorState
}

function EmbeddedEditor({
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
  options,
  onComplete,
  onCancel,
  onError,
  onSave,
  onReady,
  instanceRef,
}: EmbeddedEditorProps) {
  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const isInitializedRef = useRef(false)
  // 포토북 페이지 가변 가격 메타 (2026-06-24) — 로드된 템플릿셋의 pricing 을 보관해
  // editor.complete emit 시 현재 총 pageCount 와 함께 파트너로 전달한다(파트너가 가격 계산).
  // null = 가변 가격 미사용(BOOK/LEAFLET 등). 기존 동작 비파괴.
  const templateSetPricingRef = useRef<PhotobookPricing | null>(null)
  // D-4 (2026-07-06): 템플릿셋 커버 메타(coverType varchar + coverConfig.caseBind JSON) —
  // Track 3 이 만드는 optional 필드를 옵셔널 체이닝으로 읽어 보관. null = 미설정(전 경로 기존 동작).
  const templateSetCoverMetaRef = useRef<TemplateSetCoverMeta | null>(null)
  const [screenMode, setScreenMode] = useState<'mobile' | 'tablet' | 'desktop'>('desktop')
  const [isLoading, setIsLoading] = useState(true)
  const [loadingMessage, setLoadingMessage] = useState('에디터를 초기화하는 중...')
  const [error, setError] = useState<string | null>(null)
  const [currentSession, setCurrentSession] = useState<EditSessionResponse | null>(null)
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false)
  // 내부 뒤로가기 가드 on/off. 호스트가 storige.setBackGuard{enabled:false} 로 직접 제어를 가져가면 끈다.
  const [internalBackGuard, setInternalBackGuard] = useState(true)

  // Store state
  const {
    ready,
    showSidePanel,
    setShowSidePanel,
    setReady,
    startInitialization,
    cancelInitialization,
    updateObjects,
    editor,
    canvas,
    isSpreadMode,
  } = useAppStore()

  // 페이지 네비게이션 위치 (다중 페이지 템플릿셋에서 표지/내지 전환용) — admin EditorView 와 동일 배선
  const navPosition = useResolvedPageNavPosition()

  // T6 (2026-07-13): 컨테이너 크기 변화 → 캔버스 dim 동기화 + 워크스페이스 재센터링.
  // 기존에는 init 시 1회 setDimensions 뿐이라 객체 선택(ControlBar mount)·iframe 리사이즈에
  // 캔버스가 밀린 채 방치됐다 — EditorView 와 동일 훅 배선(iOS Safari 3중 방어 가드 포함).
  useCanvasContainerSizeSync(ready, canvasContainerRef)

  const { loadEmptyEditor, loadTemplateSetEditor } = useEditorContents()

  // 자동저장 복원 배너 상태 (비차단 — 사용자 발동 only). 자동 복원은 절대 하지 않는다.
  const [restoreOffer, setRestoreOffer] = useState<{ confident: boolean; backupAt?: Date } | null>(
    null,
  )

  // Auto-save hook integration
  const { saveNow, restoreFromLocal, evaluateRestore, deleteLocalBackup } =
    useEmbedAutoSave({
      sessionId: currentSession?.id || sessionId || null,
      currentSession,
      onSessionUpdate: (updatedSession) => {
        setCurrentSession(updatedSession)
      },
      onError: (error) => {
        console.error('[EmbeddedEditor] Auto-save error:', error)
        // Don't call onError for auto-save failures to avoid disrupting user flow
      },
      // 복원 완료 전 dirty 마킹 차단 — 무편집 자동저장의 지오메트리 오염 방지 (2026-06-12)
      initializedRef: isInitializedRef,
    })

  // 브라우저 "뒤로 가기" 데이터 무결성 가드 — 경고 없이 빠져나가 작업 유실되는 것 방지.
  // 변경사항이 있으면 confirm 으로 경고 + 강제 자동저장(flush) 후 이탈, 없으면 그대로 이탈.
  useEmbedBackGuard({
    enabled: internalBackGuard && ready && !!(currentSession?.id || sessionId),
    getIsDirty: () => useSaveStore.getState().isDirty,
    saveNow,
  })

  // 호스트(bookmoa 등) → 편집기 인바운드 명령 핸들러.
  // 호스트가 자체 뒤로가기/이탈 처리를 하려면 이 핸드셰이크로 미저장 여부 확인 + 강제 저장이 가능하다.
  //   · getState     → editor.state { ready, dirty, sessionId } 응답
  //   · saveNow      → 강제 저장 후 editor.saved { ok, error? } 응답
  //   · setBackGuard → { enabled } 로 편집기 내부 뒤로가기 가드 on/off (호스트가 제어 가져갈 때 off)
  // 보안: parentOrigin 일치하는 메시지 + source==='storige-host' 만 처리.
  useEffect(() => {
    if (!parentOrigin || typeof window === 'undefined') return
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== parentOrigin) return
      const data = e.data as EmbedHostCommandEnvelope | undefined
      if (!data || data.source !== EMBED_HOST_MESSAGE_SOURCE) return
      const requestId = data.requestId
      switch (data.command) {
        case 'getState':
          postToParent(parentOrigin, 'editor.state', {
            requestId,
            ready: useAppStore.getState().ready,
            dirty: useSaveStore.getState().isDirty,
            sessionId: currentSession?.id || sessionId || null,
          })
          break
        case 'saveNow':
          Promise.resolve()
            .then(() => saveNow())
            .then(() => postToParent(parentOrigin, 'editor.saved', { requestId, ok: true }))
            .catch((err) =>
              postToParent(parentOrigin, 'editor.saved', {
                requestId,
                ok: false,
                error: err instanceof Error ? err.message : String(err),
              }),
            )
          break
        case 'setBackGuard':
          setInternalBackGuard(!!(data.payload as { enabled?: boolean })?.enabled)
          break
        default:
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [parentOrigin, saveNow, currentSession?.id, sessionId])

  // Screen resize handler
  const handleResize = useCallback(() => {
    const width = window.innerWidth
    if (width < 768) {
      setScreenMode('mobile')
    } else if (width < 1024) {
      setScreenMode('tablet')
    } else {
      setScreenMode('desktop')
    }
  }, [])

  // Handle window resize
  useEffect(() => {
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [handleResize])

  // 인증 만료 이벤트 핸들링
  useEffect(() => {
    const unsubscribe = apiClient.onAuthExpired(() => {
      console.warn('[EmbeddedEditor] Auth token expired')
      const errorPayload = {
        code: 'AUTH_EXPIRED' as const,
        message: '인증이 만료되었습니다. 페이지를 새로고침해주세요.',
      }
      onError?.(errorPayload)
      postToParent(parentOrigin, 'editor.error', errorPayload)
    })
    return unsubscribe
  }, [onError, parentOrigin])

  // Main initialization
  useEffect(() => {
    if (!canvasContainerRef.current) return
    if (useAppStore.getState().ready) return

    let isMounted = true

    const initializeEditor = async () => {
      try {
        setIsLoading(true)
        setLoadingMessage('에디터를 초기화하는 중...')
        setError(null)

        // ========== 1. 인증 설정 (API 호출 전에 반드시 먼저 실행) ==========
        // API Base URL 설정
        if (apiBaseUrl) {
          const { apiClient } = await import('./api')
          apiClient.setBaseUrl(apiBaseUrl)
          console.log('[EmbeddedEditor] API Base URL set:', apiBaseUrl)
        }

        // 토큰 우선순위 처리: 파라미터 > localStorage > 에러
        let effectiveToken: string | null = null
        if (token) {
          effectiveToken = token
          localStorage.setItem('auth_token', token)
          console.log('[EmbeddedEditor] Using token from parameter')
        } else {
          effectiveToken = localStorage.getItem('auth_token')
          if (effectiveToken) {
            console.log('[EmbeddedEditor] Using token from localStorage')
          }
        }

        // 사일런트 리프레시용 refreshToken 저장(있으면). 401 시 client.ts 가 자동 사용
        // → 포토북처럼 며칠에 걸쳐 편집해도 액세스 토큰(1h) 만료 시 자동 갱신.
        if (refreshToken) {
          try { localStorage.setItem('auth_refresh_token', refreshToken) } catch { /* SSR/프라이버시 모드 무시 */ }
        }

        if (!effectiveToken) {
          throw new Error('접근 권한이 없습니다. 로그인 후 다시 시도해주세요.')
        }

        // useAuthStore 에 토큰 주입 → checkAuth(getMe) 로 me 채움(role 비동기 세팅).
        // ⚠️ 임베드는 종전 localStorage/apiClient 에만 토큰을 넣고 useAuthStore.setToken 을
        //   호출하지 않아 me=null → useIsCustomer()=false → 라이브러리 에셋 패널(요소/배경/
        //   프레임)이 isCustomer 게이트로 통째 비어 있었다(2026-06-15 라이브 확인).
        //   getMe 는 apiClient 인터셉터(localStorage 토큰)를 타므로 위 effectiveToken 으로
        //   인증되어 me.role='customer'(소문자) 세팅 → normalizeRole 로 isCustomer=true.
        //   refreshToken 은 임베드 자체 키('auth_refresh_token')로 관리하므로 미전달
        //   (setToken 의 'refresh_token' 키와 분리 — 기존 사일런트 리프레시 동작 불변).
        try {
          useAuthStore.getState().setToken(effectiveToken)
        } catch (authErr) {
          console.warn('[EmbeddedEditor] useAuthStore.setToken 실패(비차단):', authErr)
        }
        // ========== 인증 설정 완료 ==========

        // Clean up existing canvas
        const container = document.getElementById('canvas-containers')
        if (container) {
          container.innerHTML = ''
        }
        useAppStore.getState().reset()

        // Start initialization session
        const initId = startInitialization()

        // 2. Fetch or create edit session (if bookmoa integration)
        // 재편집 게이트 완화 (2026-06-11): 과거 `if (orderSeqno && mode)` 게이트 때문에
        // /embed?sessionId&token 만으로는 세션이 로드되지 않아 빈 템플릿으로 시작하고,
        // 이후 자동저장이 기존 저장본을 덮어쓸 위험이 있었다.
        // → sessionId 가 있으면 orderSeqno/mode 없이도 세션을 조회·복원하고,
        //   mode/orderSeqno/templateSetId 는 세션에서 도출한다.
        //   (orderSeqno+mode 제공 시 기존 경로 — 주문 검색/생성 폴백 — 동작 불변)
        let editSession: EditSessionResponse | null = null

        if (sessionId) {
          setLoadingMessage('편집 세션을 불러오는 중...')
          // 기존 세션 불러오기
          try {
            editSession = await editSessionsApi.get(sessionId)
            console.log('[EmbeddedEditor] Existing session loaded:', editSession.id)
          } catch (err) {
            console.warn('[EmbeddedEditor] Session not found:', sessionId, err)
          }
        }

        if (!editSession && orderSeqno && mode) {
          setLoadingMessage('편집 세션을 불러오는 중...')

          // sessionId 없거나 조회 실패 → orderSeqno로 기존 세션 검색
          try {
            const { sessions } = await editSessionsApi.findByOrder(orderSeqno)
            // 가장 최근 세션 사용 (canvasData가 있는 것 우선)
            editSession = sessions.find(s => s.canvasData) || sessions[0] || null
            if (editSession) {
              console.log('[EmbeddedEditor] Found existing session for order:', editSession.id)
            }
          } catch (err) {
            console.warn('[EmbeddedEditor] Failed to find sessions by order:', err)
          }

          // 기존 세션이 없으면 새로 생성
          if (!editSession) {
            // 주문 옵션 스냅샷 (2026-06-11): 주문 시점 옵션을 metadata.orderOptions 로 기록.
            // 정의된 값만 포함(undefined 키 제외). 기존 metadata 필드
            // (size/pages/binding/bleed/paperThickness/productId)는 호환을 위해 불변 유지.
            const orderOptionsEntries = Object.entries({
              pageCount: options?.pageCount,
              paperType: options?.paperType,
              bindingType: options?.bindingType,
              size: options?.size,
              quantity: options?.quantity,
              title: options?.title,
              productName: options?.productName,
              productId,
              orderSeqno,
            }).filter(([, value]) => value !== undefined)

            const createPayload = {
              orderSeqno,
              mode,
              coverFileId,
              contentFileId,
              templateSetId,
              callbackUrl,
              metadata: {
                // 주문 옵션 (Worker 검증에 사용)
                size: options?.size,
                pages: options?.pages,
                binding: options?.binding,
                bleed: options?.bleed,
                paperThickness: options?.paperThickness,
                productId,
                ...(orderOptionsEntries.length > 0
                  ? { orderOptions: Object.fromEntries(orderOptionsEntries) }
                  : {}),
              },
            }
            try {
              editSession = await editSessionsApi.create(createPayload)
              console.log('[EmbeddedEditor] New session created:', editSession.id)
            } catch (createErr) {
              // 토큰에 회원 식별이 없으면(MEMBER_REQUIRED 등) 회원 세션 생성이 400.
              // → 게스트 세션으로 폴백: 편집/자동저장은 가능하고, 편집완료 시 로그인 유도(editor.needAuth).
              console.warn('[EmbeddedEditor] Member session create failed — falling back to guest:', createErr)
              editSession = await editSessionsApi.createGuest(createPayload)
              console.log('[EmbeddedEditor] Guest session created (fallback):', editSession.id)
            }
          }
        }

        if (editSession) {
          setCurrentSession(editSession)
        }

        if (!isMounted) return

        // 3. Fetch template set info
        // 재편집 게이트 완화 (2026-06-11): templateSetId 미전달 시 세션에서 도출.
        let effectiveTemplateSetId = templateSetId || editSession?.templateSetId || ''
        let showMappingAlert = false
        let fallbackReason = ''
        // 방향 불일치 가드레일 (2026-07-09): 호스트 주문 규격(width/height)과 로드된 templateSet
        // 방향이 어긋나면(가로 선택했으나 가로 templateSet 미배선 → 세로 폴백 등) 채워진다. ready emit 에 additive 동봉.
        let orientationMismatch: OrientationMismatch | null = null

        if (!effectiveTemplateSetId) {
          throw new Error('템플릿셋 ID가 필요합니다. (templateSetId)')
        }
        /** 폴백 전 원래 요청된 템플릿셋 ID — 폴백 발생 판정/세션 복원 스킵에 사용 */
        const requestedTemplateSetId = effectiveTemplateSetId
        const allowSampleFallback = isSampleFallbackAllowed()

        // 템플릿셋 로드 실패 처리(프로덕션 기본): 폴백 없이 오류 화면 표시 + editor.error 발신.
        const failTemplateSetLoad = (err: unknown, phase: string) => {
          const reason = err instanceof Error ? err.message : String(err)
          const message = `템플릿셋을 불러올 수 없습니다. (templateSetId: ${requestedTemplateSetId}, ${phase}) ${reason}`
          console.error('[EmbeddedEditor]', message, err)
          setError(message)
          setIsLoading(false)
          const errPayload = {
            code: 'TEMPLATE_SET_NOT_FOUND' as const,
            message,
            templateSetId: requestedTemplateSetId,
          }
          onError?.(errPayload)
          postToParent(parentOrigin, 'editor.error', errPayload)
        }

        let templateSet;
        try {
          setLoadingMessage('템플릿셋 정보를 불러오는 중...')
          const result = await templatesApi.getTemplateSetWithTemplates(effectiveTemplateSetId)
          templateSet = result?.templateSet || result
          if (!templateSet || !templateSet.id) {
            throw new Error('템플릿셋을 찾을 수 없습니다.')
          }
        } catch (err) {
          // 프로덕션 기본: 무음 샘플 폴백 금지 — 명확히 실패 표시 후 중단 (2026-06-11)
          if (!allowSampleFallback) {
            failTemplateSetLoad(err, '조회 실패')
            return
          }
          console.warn('[EmbeddedEditor] Failed to load requested template set. Falling back to sample. (DEV/allowSampleFallback)', err)
          showMappingAlert = true
          fallbackReason = `템플릿셋 조회 실패: ${err instanceof Error ? err.message : String(err)}`
          effectiveTemplateSetId = 'sample-8x8-book-24p'
          const fallback = await templatesApi.getTemplateSetWithTemplates(effectiveTemplateSetId)
          templateSet = fallback?.templateSet || fallback
          if (!templateSet || !templateSet.id) {
            throw new Error('샘플 템플릿셋마저 불러올 수 없습니다.')
          }
        }
        console.log('[EmbeddedEditor] TemplateSet loaded:', templateSet.name)

        // 포토북 페이지 가변 가격 메타 보관 (2026-06-24) — editor.complete emit 시 사용.
        // pricing 없으면 null(가변 가격 미사용) → emit 에서 생략(기존 동작 비파괴).
        templateSetPricingRef.current = (templateSet as { pricing?: PhotobookPricing | null }).pricing ?? null

        // D-4 (2026-07-06): 커버 메타(coverType/coverConfig.caseBind) 보관 — pricingChange 의
        // coverType 동봉 + 하드커버 출력 사이즈 계산에 사용. 미설정이면 null(기존 동작).
        templateSetCoverMetaRef.current = resolveTemplateSetCoverMeta(templateSet)

        if (!isMounted) return

        // 2. Create canvas
        setLoadingMessage('캔버스를 초기화하는 중...')
        const fabricCanvas = await createCanvas({}, canvasContainerRef.current!, initId)

        if (!isMounted) {
          safeDisposeCanvas(fabricCanvas)
          return
        }

        // Set canvas dimensions
        const containerWidth = canvasContainerRef.current?.clientWidth || 800
        const containerHeight = canvasContainerRef.current?.clientHeight || 600
        fabricCanvas.setDimensions({
          width: containerWidth,
          height: containerHeight,
        })

        // Event listeners
        fabricCanvas.on('selection:created', () => updateObjects())
        fabricCanvas.on('selection:updated', () => updateObjects())
        fabricCanvas.on('selection:cleared', () => updateObjects())
        fabricCanvas.on('object:added', () => updateObjects())
        fabricCanvas.on('object:removed', () => updateObjects())
        fabricCanvas.on('object:modified', () => updateObjects())

        const appStore = useAppStore.getState()
        const newEditor = appStore.editor

        if (newEditor) {
          newEditor.on('longTask:start', (opts: { message: string }) => {
            setIsLoading(true)
            setLoadingMessage(opts.message)
          })
          newEditor.on('longTask:end', () => {
            setIsLoading(false)
            setLoadingMessage('')
          })
        }

        if (!isMounted) {
          safeDisposeCanvas(fabricCanvas)
          return
        }

        // 3. Load content based on template set
        setLoadingMessage('콘텐츠를 불러오는 중...')
        // 내지 PDF 표시전용(underlay): 첨부 PDF 페이지수만큼 내지 자동 임포지션.
        const underlayPageCount =
          (editSession as any)?.contentPdfMode === 'underlay' &&
          (editSession as any)?.contentPdfPageCount > 0
            ? (editSession as any).contentPdfPageCount
            : undefined

        // 재편집 spine 옵션 복원 (2026-06-12): /embed?sessionId 단독 진입(bookmoa 재편집 표준
        // 경로)에서는 URL/props 에 주문 옵션이 없다 → 세션 metadata 에서 도출한다.
        // 우선순위: props/URL > metadata.orderOptions(세션 생성 시 기록 — 자동저장만 된
        // 진행중 세션에도 항상 존재) > metadata.spine(편집완료 시에만 기록되는 B38 스냅샷, 폴백).
        // 세션 canvasData 는 "저장 당시 spine 폭" 기준 지오메트리이므로, 이 값들 없이 기본
        // pageCount(템플릿 내지수)로 책등을 재계산하면 resizeSpine 이 복원된 객체를 흔든다
        // (실측 사고: spine 10mm → 0.55mm, 객체 ±649.7px → ±621.9px 재배치, 2026-06-11).
        // spineWidthMm(스냅샷 결과값)이 아닌 계산 입력값(pageCount/paperType/bindingType)을
        // 복원하는 이유: 이후 내지 추가/삭제 debounce 재계산(spineCalculator)도 같은 입력으로
        // 일관 동작해야 하고, 동일 입력 재계산은 SpreadPlugin.resizeSpine 동일폭 no-op 가드로
        // 객체를 흔들지 않기 때문. (flat-spread 는 spineCalculator 에서 재계산 자체가 skip)
        const sessionMeta = (editSession?.metadata ?? {}) as Record<string, any>
        const sessionOrderOptions = (sessionMeta.orderOptions ?? {}) as Record<string, any>
        const sessionSpineSnapshot = (sessionMeta.spine ?? {}) as Record<string, any>
        const asPositiveNumber = (v: unknown): number | undefined => {
          const n = typeof v === 'string' ? Number(v) : (v as number)
          return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined
        }
        const asNonEmptyString = (v: unknown): string | undefined =>
          typeof v === 'string' && v.length > 0 ? v : undefined
        // 저장된 canvasData 배열 = [표지, ...내지] — 실제 복원될 페이지 수의 가장 충실한
        // 실측값(메타데이터 없는 레거시 세션 포함). 편집 중 내지 추가/삭제로 orderOptions 의
        // 주문 시점 pageCount 와 드리프트할 수 있으므로, 명시적 props/URL 다음 순위로 둔다 —
        // 복원 루프(min(saved.length, canvases.length))의 뒷페이지 절단도 함께 방지.
        const restoredInnerPageCount = Array.isArray(editSession?.canvasData)
          ? asPositiveNumber(editSession.canvasData.length - 1)
          : undefined
        const effectivePageCount =
          asPositiveNumber(options?.pageCount) ??
          restoredInnerPageCount ??
          asPositiveNumber(sessionOrderOptions.pageCount) ??
          asPositiveNumber(sessionSpineSnapshot.pageCount)
        const effectivePaperType =
          asNonEmptyString(options?.paperType) ??
          asNonEmptyString(sessionOrderOptions.paperType) ??
          asNonEmptyString(sessionSpineSnapshot.paperType)
        const effectiveBindingType =
          asNonEmptyString(options?.bindingType) ??
          asNonEmptyString(sessionOrderOptions.bindingType) ??
          asNonEmptyString(sessionSpineSnapshot.bindingType)

        console.log('[EmbeddedEditor] Loading template set with options:', {
          templateSetId: effectiveTemplateSetId,
          pageCount: effectivePageCount,
          underlayPageCount,
          paperType: effectivePaperType,
          bindingType: effectiveBindingType,
          optionsSource:
            asPositiveNumber(options?.pageCount) != null
              ? 'props/url'
              : restoredInnerPageCount != null
                ? 'session.canvasData(restored pages)'
                : asPositiveNumber(sessionOrderOptions.pageCount) != null
                  ? 'session.metadata.orderOptions'
                  : asPositiveNumber(sessionSpineSnapshot.pageCount) != null
                    ? 'session.metadata.spine'
                    : 'none(template-default)',
        })
        try {
          await loadTemplateSetEditor({
            templateSetId: effectiveTemplateSetId,
            pageCount: effectivePageCount,
            underlayPageCount,
            paperType: effectivePaperType,
            bindingType: effectiveBindingType,
          })
        } catch (loadErr) {
          // 프로덕션 기본: 무음 샘플 폴백 금지 — 명확히 실패 표시 후 중단 (2026-06-11)
          if (!allowSampleFallback) {
            failTemplateSetLoad(loadErr, '에디터 로드 실패')
            return
          }
          console.warn('[EmbeddedEditor] Failed to load template set editor. Falling back to sample. (DEV/allowSampleFallback)', loadErr)
          showMappingAlert = true
          if (!fallbackReason) {
            fallbackReason = `에디터 로드 실패: ${loadErr instanceof Error ? loadErr.message : String(loadErr)}`
          }
          effectiveTemplateSetId = 'sample-8x8-book-24p'
          await loadTemplateSetEditor({
            templateSetId: effectiveTemplateSetId,
            pageCount: effectivePageCount,
            underlayPageCount,
            paperType: effectivePaperType,
            bindingType: effectiveBindingType,
          })
        }

        // D-4 (2026-07-06): templateSet.coverConfig.caseBind 를 스토어 spreadConfig.spec 에 병합.
        // 화면 레이아웃은 computeSpreadDimensions(trim) 기반이라 **불변** — caseBind 는 출력(PDF)
        // 사이즈 계산(computeSpreadOutputDimensions)과 metadata.spread 스냅샷에만 쓰인다.
        // 폴백 템플릿셋(effective≠requested)에는 병합하지 않는다(지오메트리 오염 방지와 동일 원칙).
        {
          const templateSetCaseBind = templateSetCoverMetaRef.current?.coverConfig?.caseBind
          if (templateSetCaseBind && effectiveTemplateSetId === requestedTemplateSetId) {
            const settingsState = useSettingsStore.getState()
            const loadedSpreadConfig = settingsState.spreadConfig
            if (
              loadedSpreadConfig?.spec &&
              loadedSpreadConfig.regionScope !== 'inner' &&
              !loadedSpreadConfig.spec.caseBind
            ) {
              settingsState.setSpreadConfig({
                ...loadedSpreadConfig,
                spec: { ...loadedSpreadConfig.spec, caseBind: templateSetCaseBind },
              })
              console.log('[EmbeddedEditor] D-4 caseBind merged into spreadConfig.spec (output-only):', templateSetCaseBind)
            }
          }
        }

        if (showMappingAlert) {
          // 폴백은 DEV/allowSampleFallback=1 에서만 도달 — 실패한 templateSetId 와 사유를 명시.
          const alertMessage =
            `템플릿셋 매핑이 맞지 않아 테스트모드(샘플 템플릿셋)로 구동됩니다.\n` +
            `요청 템플릿셋: ${requestedTemplateSetId}\n` +
            `사유: ${fallbackReason || '알 수 없음'}\n` +
            `편집내용에 대한 주문에 문제가 있을 수 있습니다.`
          setTimeout(() => {
            alert(alertMessage)
          }, 500);
        }

        if (!isMounted) return

        // 기존 세션의 canvasData가 있으면 복원 (재편집)
        // canvasData가 배열이면 멀티페이지 복원, 객체면 단일 캔버스 복원
        // 단, 샘플 폴백으로 다른 템플릿셋이 로드된 경우 복원 스킵 (2026-06-11) —
        // 다른 spec(판형/책등) 위에 복원하면 지오메트리 오염이 일어난다.
        if (editSession?.canvasData && effectiveTemplateSetId !== requestedTemplateSetId) {
          console.warn(
            '[EmbeddedEditor] 폴백 템플릿셋 위 세션 canvasData 복원 스킵 — 지오메트리 오염 방지:',
            { requested: requestedTemplateSetId, effective: effectiveTemplateSetId, sessionId: editSession.id },
          )
        } else if (editSession?.canvasData) {
          setLoadingMessage('저장된 작업을 복원하는 중...')
          const saved = editSession.canvasData
          const { allCanvas: canvases, allEditors } = useAppStore.getState()

          if (Array.isArray(saved) && saved.length > 0) {
            // 멀티페이지: 각 페이지 canvasData를 대응 캔버스에 로드
            for (let i = 0; i < saved.length && i < canvases.length; i++) {
              if (saved[i]) await core.loadFromJSON(canvases[i], saved[i])
              // 복원 직후 사진틀 인터랙션 재바인딩 (핸들러는 직렬화 안 됨 → 미재바인딩 시 채우기 불능).
              rebindFrameInteractivity(allEditors[i], canvases[i])
              // Part B: 고객 임베드 세션 복원 시 객체별 이동/변형 잠금 적용(movable=false).
              applyObjectPermissions(canvases[i], useSettingsStore.getState().currentSettings.editMode)
              // L7: 필수 편집 touched 추적 부착(멱등) — 로드 완료 지점.
              trackRequiredEdits(canvases[i])
            }
            console.log('[EmbeddedEditor] Multi-page canvasData restored:', saved.length, 'pages')
          } else if (!Array.isArray(saved) && fabricCanvas) {
            // 단일 캔버스 (legacy 및 cover 전용 세션)
            await core.loadFromJSON(fabricCanvas, saved)
            const singleIdx = Math.max(0, canvases.indexOf(fabricCanvas))
            rebindFrameInteractivity(allEditors[singleIdx], fabricCanvas)
            applyObjectPermissions(fabricCanvas, useSettingsStore.getState().currentSettings.editMode)
            trackRequiredEdits(fabricCanvas)
            console.log('[EmbeddedEditor] Single canvasData restored:', editSession.id)
          }
        }

        if (!isMounted) return

        // 3-A. 내지 PDF 표시전용 가이드 배치 (underlay 모드) — 캔버스 복원 후.
        // 가이드는 excludeFromExport 라 export/저장에서 제외, 최종 인쇄는 첨부 원본 PDF 그대로.
        if (editSession) {
          await applyContentPdfGuides(editSession, effectiveTemplateSetId)
        }

        // 3-A'. D1 외부 사진 주입 (EDITOR.md §20.1) — 호스트가 세션 metadata 로
        // 주입한 공유방 사진 목록을 스토어에 적재. 목록이 있으면 이미지 패널에
        // "공유방 사진" 탭이 조건부 렌더된다(없으면 기존 동작 그대로 = bookmoa 영향 0).
        {
          const externalPhotos = (editSession?.metadata as Record<string, unknown> | undefined)
            ?.externalPhotos
          useExternalPhotosStore.getState().setPhotos(
            Array.isArray(externalPhotos) ? (externalPhotos as never[]) : [],
          )
        }

        // 3-B. 로드 직후 자동 선택 해제 — mode='cover'(표지 전용) 등에서 표지 영역이
        // 자동 선택된 채 로드돼 "어두운 박스(앞/뒤 비대칭처럼 보임)"로 표시되는 코스메틱 이슈 방지.
        // 선택 해제만 수행(캔버스 기하/저장 데이터 영향 없음). 일부 로드 경로가 setTimeout
        // 후처리(WorkspacePlugin.setOptions/setZoomAuto)하므로 동기 + 지연 2회 해제.
        const clearLoadSelections = () => {
          try {
            useAppStore.getState().allCanvas.forEach((c: any) => {
              try { c.discardActiveObject(); c.requestRenderAll() } catch { /* noop */ }
            })
            if (fabricCanvas) {
              try { fabricCanvas.discardActiveObject(); fabricCanvas.requestRenderAll() } catch { /* noop */ }
            }
          } catch { /* noop */ }
        }
        clearLoadSelections()
        setTimeout(clearLoadSelections, 200)

        if (!isMounted) return

        // 4. Complete initialization
        setReady(true)
        isInitializedRef.current = true
        setIsLoading(false)

        // 방향 불일치 가드레일 (2026-07-09) — 호스트 주문 규격(width/height)의 방향과 로드된
        // templateSet 방향이 어긋나면(고객이 가로 선택 → 가로 dims 전달했으나 가로 templateSet
        // 미배선으로 세로 셋 로드 등) 조용히 세로로 열리는 사고를 콘솔+Sentry+ready payload 로 표면화.
        // 비차단: 편집은 그대로 진행. 샘플 폴백(showMappingAlert)·size 미전달·정사각은 스킵(오탐 방지).
        if (!showMappingAlert) {
          orientationMismatch = detectOrientationMismatch(options?.size, {
            width: (templateSet as { width?: number }).width,
            height: (templateSet as { height?: number }).height,
          })
          if (orientationMismatch) {
            console.warn(
              `[EmbeddedEditor] ⚠️ 방향 불일치: 주문 규격은 ${orientationMismatch.requested}(${orientationMismatch.requestedSize.width}×${orientationMismatch.requestedSize.height}) 인데 ` +
                `templateSet(${effectiveTemplateSetId}) 은 ${orientationMismatch.template}(${orientationMismatch.templateSize.width}×${orientationMismatch.templateSize.height}) — ` +
                `가로 templateSet 배선(storigeTemplateSetIdLandscape) 누락 가능. 편집은 계속 진행합니다.`,
              orientationMismatch,
            )
            try {
              Sentry.captureMessage('[orientation-mismatch] 주문 규격 ≠ templateSet 방향', {
                level: 'warning',
                extra: {
                  templateSetId: effectiveTemplateSetId,
                  requestedTemplateSetId,
                  orderSeqno,
                  sessionId: editSession?.id,
                  ...orientationMismatch,
                },
              } as any)
            } catch {
              /* Sentry 미설정/네트워크 — 무시 */
            }
          }
        }

        console.log('[EmbeddedEditor] Initialization complete')
        onReady?.()
        postToParent(parentOrigin, 'editor.ready', {
          sessionId: editSession?.id,
          templateSetId,
          version: '1.0.0',
          // 샘플 폴백 구동 시(DEV/allowSampleFallback) 호스트가 인지할 수 있도록 명시 (2026-06-11)
          ...(showMappingAlert ? { fallback: true, effectiveTemplateSetId } : {}),
          // 방향 불일치 시 호스트(bookmoa 등)가 인지할 수 있도록 additive 동봉 (2026-07-09)
          ...(orientationMismatch ? { orientationMismatch } : {}),
        })
      } catch (err) {
        if (err instanceof CanvasInitCancelledError) {
          // StrictMode 이중 마운트/라우트 전환으로 교체된 초기화 — 정상 중단.
          // 파트너 호스트로 가짜 editor.error 를 발신하지 않도록 조기 반환.
          console.log('[EmbeddedEditor] Init superseded — cancelled cleanly')
          return
        }
        console.error('[EmbeddedEditor] Initialization error:', err)

        // API 에러 타입 확인
        const apiError = err as ApiError
        let errorCode: EditorError['code'] = 'INVALID_DATA'
        let errorMessage = '초기화 중 오류가 발생했습니다.'

        if (apiError.code) {
          switch (apiError.code) {
            case 'AUTH_EXPIRED':
              errorCode = 'AUTH_EXPIRED'
              errorMessage = apiError.message || '인증이 만료되었습니다.'
              break
            case 'NETWORK_ERROR':
            case 'TIMEOUT':
              errorCode = 'NETWORK_ERROR'
              errorMessage = apiError.message || '네트워크 연결을 확인해주세요.'
              break
            case 'SERVER_ERROR':
              errorCode = 'NETWORK_ERROR'
              errorMessage = apiError.message || '서버 오류가 발생했습니다.'
              break
            default:
              errorMessage = apiError.message || errorMessage
          }
        } else if (err instanceof Error) {
          errorMessage = err.message
        }

        setError(errorMessage)
        setIsLoading(false)
        const errPayload = { code: errorCode, message: errorMessage }
        onError?.(errPayload)
        postToParent(parentOrigin, 'editor.error', errPayload)
      }
    }

    initializeEditor()

    return () => {
      isMounted = false
      cancelInitialization()

      const { allCanvas: canvases, allEditors: editors, reset } = useAppStore.getState()

      canvases.forEach((cvs) => {
        try {
          if (!cvs) return
          cvs.off()
          cvs.disposed = true
          cvs.dispose()
        } catch (e) {
          // Ignore dispose errors
        }
      })

      editors.forEach((ed) => {
        try {
          ed?.dispose()
        } catch (e) {
          // Ignore dispose errors
        }
      })

      const containerEl = document.getElementById('canvas-containers')
      if (containerEl) {
        containerEl.innerHTML = ''
      }

      reset()
      isInitializedRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 자동저장 복원 제안 — 세션 로드 완료(ready) 후 1회 평가 (자동 복원 금지, 판정만).
  //
  // 데이터 유실 footgun 방어:
  //  - ready 가 true 가 된 뒤에만 평가 → 복원(loadFromJSON)이 발화하는 object:added 가
  //    초기화 중 dirty 마킹으로 오인되지 않는다(useEmbedAutoSave initializedRef 가드와 정합).
  //  - evaluateRestore 는 순수 판정(shouldOfferRestore) — 캔버스는 사용자가 [복원] 을 누른
  //    restoreFromLocal 에서만 변경된다.
  //  - 세션당 1회만 평가(restoreEvaluatedRef) — ready 토글/리렌더로 배너가 깜빡이지 않게.
  const restoreEvaluatedRef = useRef(false)
  useEffect(() => {
    if (!ready) return
    if (restoreEvaluatedRef.current) return
    restoreEvaluatedRef.current = true

    const session = currentSession
      ? { id: currentSession.id, updatedAt: currentSession.updatedAt }
      : sessionId
        ? { id: sessionId, updatedAt: null }
        : null

    const decision = evaluateRestore(session)
    if (decision.offer) {
      setRestoreOffer({ confident: decision.confident, backupAt: decision.backupAt })
    }
  }, [ready, currentSession, sessionId, evaluateRestore])

  // [복원] — 백업을 캔버스에 로드(멀티페이지 전체). 성공 시 배너 닫기.
  const handleRestoreBackup = useCallback(async (): Promise<boolean> => {
    const ok = await restoreFromLocal()
    if (ok) setRestoreOffer(null)
    return ok
  }, [restoreFromLocal])

  // [무시] — 백업 삭제 후 배너 닫기. 캔버스는 그대로(서버 세션 유지).
  const handleDismissRestore = useCallback(() => {
    deleteLocalBackup()
    setRestoreOffer(null)
  }, [deleteLocalBackup])

  // D-3 (2026-07-06): editor.pricingChange — 페이지 추가/삭제 실시간 가격 이벤트 (additive).
  //
  // zustand allCanvas.length 구독: 페이지 증감의 모든 경로(BookNavigation 추가/삭제,
  // SpreadPagePanel 의 deletePage 직접 호출 포함)가 스토어 변경으로 수렴하므로 단일 지점에서 잡힌다.
  // 가드(보수 기본):
  //  - isInitializedRef — 초기화(loadSpreadModeEditor 캔버스 생성 루프)·세션 복원 중 0건 발신.
  //  - pricing 미설정 셋(templateSetPricingRef=null) 미발신 — BOOK/LEAFLET 등 기존 셋 무영향.
  //  - 게스트 세션(guestToken 보유) 미발신 — 실제 가격 반영 주체(회원 주문 흐름)에만 통지.
  //  - debounce ~300ms — 연속 증감(다중 삭제 등)을 1건으로 합침.
  // pageCount 는 editor.complete 와 동일 산식(computeLivePageCount 단일 진실원, 내지 펼침면 ×2).
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = useAppStore.subscribe((state, prevState) => {
      if (state.allCanvas.length === prevState.allCanvas.length) return
      if (!isInitializedRef.current) return
      if (!templateSetPricingRef.current) return
      if (currentSession?.guestToken) return
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        // 발신 시점 재확인(디바운스 사이 상태 변화 대비 — 보수 기본 유지)
        const pricingMeta = templateSetPricingRef.current
        if (!pricingMeta || !isInitializedRef.current) return
        const appState = useAppStore.getState()
        const canvasCount = appState.allCanvas.length
        const spreadCfg = useSettingsStore.getState().spreadConfig
        const isInnerSpread = spreadCfg?.regionScope === 'inner'
        // T5 (2026-07-13): 표지+내지 단일 세션 spread(비-inner)는 표지 캔버스 1장을 물리
        // 페이지에서 제외(21→20). 캔버스 1(표지 단독 세션) 게이트 필수 — physical=0 방지.
        const coverCanvasCount =
          appState.isSpreadMode && spreadCfg?.regionScope !== 'inner' && canvasCount > 1 ? 1 : 0
        const payload: PricingChangePayload = {
          sessionId: currentSession?.id || sessionId || null,
          pageCount: computeLivePageCount(canvasCount, isInnerSpread, options?.pages || 1, coverCanvasCount),
          pricing: pricingMeta,
          ...(templateSetCoverMetaRef.current?.coverType
            ? { coverType: templateSetCoverMetaRef.current.coverType }
            : {}),
        }
        postToParent(parentOrigin, 'editor.pricingChange', payload)
        console.log('[EmbeddedEditor] editor.pricingChange emitted:', payload.pageCount)
      }, 300)
    })
    return () => {
      unsubscribe()
      if (debounceTimer) clearTimeout(debounceTimer)
    }
  }, [parentOrigin, currentSession, sessionId, options?.pages])

  // Expose instance methods
  useEffect(() => {
    instanceRef.current = {
      save: async () => {
        const currentSessionId = currentSession?.id || sessionId

        if (!currentSessionId) {
          throw new Error('편집 세션이 없습니다.')
        }

        try {
          // Get canvas data
          const canvasData = canvas?.toJSON(core.extendFabricOption) || null

          // Update edit session with canvas data (게스트 세션이면 guestToken 동봉)
          const guestToken = currentSession?.guestToken
          const updatedSession = guestToken
            ? await editSessionsApi.updateGuest(currentSessionId, guestToken, { canvasData, status: 'editing' })
            : await editSessionsApi.update(currentSessionId, { canvasData, status: 'editing' })

          setCurrentSession(updatedSession)

          const result: SaveResult = {
            sessionId: updatedSession.id,
            savedAt: updatedSession.updatedAt,
            thumbnail: updatedSession.coverFile?.thumbnailUrl || undefined,
          }

          console.log('[EmbeddedEditor] Save completed:', result.sessionId)
          onSave?.(result)
          postToParent(parentOrigin, 'editor.save', result)
          return result
        } catch (err) {
          console.error('[EmbeddedEditor] Save failed:', err)
          const errPayload = {
            code: 'SAVE_FAILED' as const,
            message: err instanceof Error ? err.message : '저장에 실패했습니다.',
          }
          onError?.(errPayload)
          postToParent(parentOrigin, 'editor.error', errPayload)
          throw err
        }
      },

      complete: async () => {
        const currentSessionId = currentSession?.id || sessionId

        if (!currentSessionId) {
          throw new Error('편집 세션이 없습니다.')
        }

        // L7: 프로그래매틱(파트너 IIFE API) 완료 경로는 모달 없이 경고 로그만 — 파트너의
        // await complete() 가 사용자 응답에 매달리거나 신규 reject 로 계약이 바뀌는 것을 방지.
        // UI '편집완료' 버튼 경로(EditorHeader.handleFinish)는 비차단 확인 모달로 게이트된다.
        {
          const unedited = collectUneditedRequiredForCustomer()
          if (unedited.length > 0) {
            console.warn('[EmbeddedEditor] requiredEdit 미편집 요소', unedited.length, '개 존재 — 프로그래매틱 complete 는 경고 없이 진행:', unedited.map((i) => i.label))
          }
        }

        try {
          // First save current state
          const canvasData = canvas?.toJSON(core.extendFabricOption) || null

          // 게스트 세션: 회원 전용 complete 불가 → 저장만 하고 로그인 유도
          const guestToken = currentSession?.guestToken
          if (guestToken) {
            await editSessionsApi.updateGuest(currentSessionId, guestToken, { canvasData })
            // STALE-CLOSURE-001: editor.complete에 needsAuth/guestToken 인라인 포함
            // bookmoa finishComplete가 editor.complete.needsAuth 로 분기하므로 이 이벤트를 먼저 emit
            const guestResult: EditorResult = {
              sessionId: currentSessionId,
              needsAuth: true,
              guestToken,
              pages: { initial: options?.pages || 1, final: options?.pages || 1 },
              files: {},
              savedAt: new Date().toISOString(),
            }
            onComplete?.(guestResult)
            postToParent(parentOrigin, 'editor.complete', guestResult)
            // 하위호환: editor.needAuth도 유지
            postToParent(parentOrigin, 'editor.needAuth', {
              guestToken,
              reason: 'complete_save',
              ts: new Date().toISOString(),
            })
            console.log('[EmbeddedEditor] Guest complete → editor.complete(needsAuth) + needAuth emitted')
            return
          }

          await editSessionsApi.update(currentSessionId, {
            canvasData,
          })

          // Then mark as completed
          const completedSession = await editSessionsApi.complete(currentSessionId)
          setCurrentSession(completedSession)

          // 현재 총 페이지 수(라이브 캔버스 수) — 포토북 페이지 가변 가격 emit 용 (2026-06-24).
          // 편집 중 내지 추가/삭제가 반영된 실측값. 없으면 주문 시점 pages 로 폴백(비파괴).
          // 포토북 내지(inner) 펼침면(O-2): 한 캔버스=1펼침면=2 물리페이지 → 가격용 pageCount 는 ×2.
          // (비-내지/표지/BOOK 는 캔버스 수 그대로 = 기존 동작 byte-identical.)
          // Track 1 (2026-07-06): 산식을 computeLivePageCount 헬퍼로 단일 진실원화(complete 2경로+pricingChange).
          // T5 (2026-07-13): 표지+내지 단일 세션 spread(비-inner)는 표지 캔버스 1장 제외(21→20).
          // 캔버스 1(표지 단독 세션) 게이트 필수 — physical=0 방지. 포토북 inner ×2 산식 불변.
          const appStateAtComplete = useAppStore.getState()
          const spreadCfgAtComplete = useSettingsStore.getState().spreadConfig
          const livePageCount = computeLivePageCount(
            appStateAtComplete.allCanvas.length,
            spreadCfgAtComplete?.regionScope === 'inner',
            options?.pages || 1,
            appStateAtComplete.isSpreadMode &&
              spreadCfgAtComplete?.regionScope !== 'inner' &&
              appStateAtComplete.allCanvas.length > 1
              ? 1
              : 0,
          )
          const pricingMeta = templateSetPricingRef.current

          // S2 (2026-07-04): 완료 시점 캔버스 규격(mm) — 파트너 정합 검증용(additive).
          const liveSize = useSettingsStore.getState().currentSettings.size
          const result: EditorResult = {
            sessionId: completedSession.id,
            orderSeqno: Number(completedSession.orderSeqno),
            editCode: `EDIT-${completedSession.id.substring(0, 8).toUpperCase()}`,
            pages: {
              initial: options?.pages || 1,
              // S2: final 은 실측값(라이브 캔버스 기준) — 기존 하드코딩(주문 옵션 pages) 정정.
              // 소비자 없음 확정(bookmoa-mobile 은 pages 미소비) + pageCount 와 동일 값이라 안전.
              final: livePageCount,
            },
            // 페이지 가변 가격 메타 (2026-06-24): 현재 총 pageCount 는 항상, pricing 은 설정된 셋만.
            // 파트너 장바구니가 base + max(0, pageCount − includedPages) × perPageUnit 로 가/감 계산.
            pageCount: livePageCount,
            ...(pricingMeta ? { pricing: pricingMeta } : {}),
            ...(liveSize
              ? { size: { width: liveSize.width, height: liveSize.height, unit: 'mm' as const } }
              : {}),
            files: {
              coverFileId: completedSession.coverFileId || undefined,
              contentFileId: completedSession.contentFileId || undefined,
              thumbnailUrl: completedSession.coverFile?.thumbnailUrl || undefined,
            },
            savedAt: completedSession.completedAt || completedSession.updatedAt,
          }

          console.log('[EmbeddedEditor] Complete success:', result.sessionId)
          onComplete?.(result)
          postToParent(parentOrigin, 'editor.complete', result)
        } catch (err) {
          console.error('[EmbeddedEditor] Complete failed:', err)
          const errPayload = {
            code: 'SAVE_FAILED' as const,
            message: err instanceof Error ? err.message : '편집 완료에 실패했습니다.',
          }
          onError?.(errPayload)
          postToParent(parentOrigin, 'editor.error', errPayload)
          throw err
        }
      },

      cancel: () => {
        onCancel?.()
        postToParent(parentOrigin, 'editor.cancel', {
          sessionId: currentSession?.id || sessionId,
        })
      },

      undo: () => {
        editor?.undo()
      },

      redo: () => {
        editor?.redo()
      },

      getState: () => ({
        ready,
        modified: useSaveStore.getState().isDirty,
        currentPage: 1,
        totalPages: 1,
      }),
    }
  }, [ready, canvas, sessionId, currentSession, options, onComplete, onCancel, onSave, onError, instanceRef, parentOrigin])

  // Loading state handler
  const handleLoadingChange = useCallback((loading: boolean, message?: string) => {
    setIsLoading(loading)
    setLoadingMessage(message || '')
  }, [])

  // 편집완료 핸들러 - EditorHeader에서 호출됨
  const handleFinish = useCallback(async () => {
    const currentSessionId = currentSession?.id || sessionId

    if (!currentSessionId) {
      console.log('[EmbeddedEditor] No session, skipping complete')
      return
    }

    // 재편집 게이트 완화 (2026-06-11): /embed?sessionId 단독 진입 시 mode/orderSeqno 가
    // props 로 전달되지 않으므로 세션에서 도출한다 (props 제공 시 props 우선 — 기존 경로 동작 불변).
    const effectiveMode = mode ?? currentSession?.mode
    const effectiveOrderSeqno =
      orderSeqno ?? (currentSession?.orderSeqno != null ? Number(currentSession.orderSeqno) : undefined)

    setIsLoading(true)
    try {
      setLoadingMessage('작업을 저장하는 중...')

      // 멀티페이지/스프레드 책: 전체 페이지 배열을 저장(단일 캔버스로 덮어써 다른 페이지 유실 방지)
      const { isSpreadMode, allCanvas, allEditors } = useAppStore.getState()
      const spreadCfg = useSettingsStore.getState().spreadConfig
      const isSpreadBook = isSpreadMode && allCanvas.length > 1 && !!spreadCfg
      const canvasData = allCanvas.length > 1
        ? allCanvas.map((c) => c.toJSON(core.extendFabricOption))
        : (canvas?.toJSON(core.extendFabricOption) || null)

      // 게스트 세션: PDF 생성/회원 complete 불가 → 저장만 하고 로그인 유도
      const guestToken = currentSession?.guestToken
      if (guestToken) {
        await editSessionsApi.updateGuest(currentSessionId, guestToken, { canvasData })
        // STALE-CLOSURE-001: editor.complete에 needsAuth/guestToken 인라인 포함
        const guestResult: EditorResult = {
          sessionId: currentSessionId,
          needsAuth: true,
          guestToken,
          pages: { initial: options?.pages || 1, final: options?.pages || 1 },
          files: {},
          savedAt: new Date().toISOString(),
        }
        onComplete?.(guestResult)
        postToParent(parentOrigin, 'editor.complete', guestResult)
        // 하위호환: editor.needAuth도 유지
        postToParent(parentOrigin, 'editor.needAuth', {
          guestToken,
          reason: 'complete_save',
          ts: new Date().toISOString(),
        })
        console.log('[EmbeddedEditor] Guest finish → editor.complete(needsAuth) + needAuth emitted')
        return
      }

      // Update edit session with canvas data (멀티페이지면 배열 전체)
      await finishMark('canvasData:save:start', { pages: Array.isArray(canvasData) ? canvasData.length : 1 })
      await editSessionsApi.update(currentSessionId, { canvasData })
      await finishMark('canvasData:save:done')

      // Generate PDF
      try {
        setLoadingMessage('PDF를 생성하는 중...')
        const bleed = options?.bleed ?? 3

        // P3 (2026-06-10): 작업사이즈(재단+블리드)+코너마커+TrimBox 출력 게이팅.
        // templateSet 에서 운반한 printMarkConfig 를 saveMultiPagePDFAsBlob 의 size 에 전달.
        // ServicePlugin 게이트(cropMarkEnabled && bleedMm>0)에서만 작업사이즈 경로 활성.
        // 미설정(null) → undefined → 게이트 OFF(현행 trim 출력 그대로).
        const printMarkCfg = useSettingsStore.getState().printMarkConfig
        const markOpt = {
          bleedMm: printMarkCfg?.bleedMm,
          cropMarkEnabled: printMarkCfg?.cropMarkEnabled,
        }

        if (isSpreadBook) {
          // ── 스프레드 책: 표지(allCanvas[0]) cover PDF + 내지(allCanvas[1..]) 멀티페이지 content PDF ──
          // 표지와 내지는 판형 크기가 달라 한 PDF 로 합칠 수 없으므로 분리 생성/업로드.
          const coverPlugin = allEditors[0]?.getPlugin('ServicePlugin') as ServicePlugin | undefined
          const innerCanvases = allCanvas.slice(1)
          const innerEditors = allEditors.slice(1)
          // ⚠️ 스프레드 내지 페이지 에디터는 addInnerPage 에서 WorkspacePlugin 만 등록되어
          //   ServicePlugin 이 없다. saveMultiPagePDFAsBlob 은 this._editor(=표지) 의 FontPlugin 을
          //   쓰고 전달된 canvases 를 순회하므로, 표지 ServicePlugin 으로 내지 PDF 도 생성한다.
          if (coverPlugin && innerCanvases.length > 0) {
            // D-1 1단계 (2026-07-06): 포토북 내지(regionScope='inner')는 content.pdf 페이지 크기를
            // innerSpec 기반 2-up(pageWidthMm×2 × pageHeightMm)으로 — 'content.pdf 1페이지=1펼침면' 계약.
            // 비-포토북(BOOK 등)은 헬퍼가 null → 기존 폴백 체인 그대로(byte-parity).
            const innerContentSize = computeInnerContentSizeMm(spreadCfg)
            const innerW = innerContentSize?.widthMm
              ?? (spreadCfg!.spec as any)?.coverWidthMm ?? options?.size?.width ?? 210
            const innerH = innerContentSize?.heightMm
              ?? (spreadCfg!.spec as any)?.coverHeightMm ?? options?.size?.height ?? 297
            // D-4 (2026-07-06): 하드커버(caseBind) 표지는 출력 페이지 크기 = wrap 포함 사이즈.
            // ServicePlugin 의 기존 printSize 메커니즘(페이지=printSize, 콘텐츠 trim 렌더 중앙 배치)
            // 재사용 — canvas-core 무변경. caseBind 미설정이면 null → 기존 호출 byte-parity.
            const coverOutputSize = computeCoverOutputSizeMm(spreadCfg)
            console.log('[EmbeddedEditor] Spread PDF 시작 — pages:', allCanvas.length, 'cover:', spreadCfg!.totalWidthMm, 'x', spreadCfg!.totalHeightMm, 'coverOutput:', coverOutputSize?.widthMm, 'x', coverOutputSize?.heightMm, 'inner:', innerW, 'x', innerH)

            // 표지 cover PDF (스프레드 전체 크기) — 독립 try (실패해도 내지는 시도)
            let coverFileId: string | undefined
            try {
              await finishMark('spread:cover:gen:start', {
                w: spreadCfg!.totalWidthMm, h: spreadCfg!.totalHeightMm,
                ...(coverOutputSize ? { outW: coverOutputSize.widthMm, outH: coverOutputSize.heightMm } : {}),
              })
              // L4-②: PDF 생성 창(excludeFromExport 임시 플래깅) 동안 autosave suspend —
              // 발화분은 스킵이 아니라 생성 완료 후 1회 지연 실행(autosaveSuspend.ts).
              const coverBlob = await withWatchdog(
                runWithAutosaveSuspended(() => coverPlugin.saveMultiPagePDFAsBlob(
                  [allCanvas[0]] as any, [allEditors[0]], `cover-${currentSessionId}`,
                  {
                    width: spreadCfg!.totalWidthMm, height: spreadCfg!.totalHeightMm, cutSize: bleed,
                    // D-4: caseBind 有 → 페이지=출력(wrap) 사이즈 + 콘텐츠 중앙 오프셋(printSize 경로).
                    // wrap 자체가 재단 여유 역할이므로 crop mark 게이트(markOpt)는 함께 쓰지 않는다
                    // (게이트 ON 시 ServicePlugin 이 printSize 를 무시하는 기존 시맨틱과의 충돌 회피).
                    ...(coverOutputSize
                      ? { printSize: { width: coverOutputSize.widthMm, height: coverOutputSize.heightMm } }
                      : markOpt),
                  },
                  undefined, 300,
                )),
                120000, 'spread-cover-gen',
              )
              await finishMark('spread:cover:gen:done', { bytes: coverBlob.size })
              setLoadingMessage('PDF를 업로드하는 중...')
              const coverUpload = await filesApi.upload({
                file: coverBlob, type: 'cover', orderSeqno: effectiveOrderSeqno,
                metadata: { generatedBy: 'editor', editSessionId: currentSessionId, mode: 'spread', isSpreadCover: true },
              })
              coverFileId = coverUpload.id
              console.log('[EmbeddedEditor] Spread cover PDF uploaded:', coverFileId)
            } catch (coverErr) {
              console.error('[EmbeddedEditor] Spread COVER PDF 실패:', (coverErr as Error)?.name, (coverErr as Error)?.message, (coverErr as Error)?.stack)
              try { Sentry.captureException(coverErr, { tags: { finishPhase: 'spread-cover' } } as any) } catch { /* ignore */ }
              await finishMark('spread:cover:gen:FAILED', { name: (coverErr as Error)?.name, message: (coverErr as Error)?.message })
            }

            // 내지 content 멀티페이지 PDF (내지 면 크기) — 독립 try
            let contentFileId: string | undefined
            try {
              await finishMark('spread:content:gen:start', { pages: innerCanvases.length, w: innerW, h: innerH })
              // 다페이지 내지: 워치독을 페이지수 비례로(고정 180s 는 24p 에서 타임아웃 실측,
              // 2026-06-10) + 페이지 진행 메시지(사용자 인지 + 행 지점 진단).
              const contentWatchdogMs = Math.max(180000, innerCanvases.length * 15000)
              const contentBlob = await withWatchdog(
                runWithAutosaveSuspended(() => coverPlugin.saveMultiPagePDFAsBlob(
                  innerCanvases as any, innerEditors, `content-${currentSessionId}`,
                  { width: innerW, height: innerH, cutSize: bleed, ...markOpt },
                  undefined, 300,
                  (page, total) => setLoadingMessage(`내지 PDF 생성 중 (${page}/${total})...`),
                )),
                contentWatchdogMs, 'spread-content-gen',
              )
              await finishMark('spread:content:gen:done', { bytes: contentBlob.size })
              const contentUpload = await filesApi.upload({
                file: contentBlob, type: 'content', orderSeqno: effectiveOrderSeqno,
                metadata: { generatedBy: 'editor', editSessionId: currentSessionId, mode: 'spread', pageCount: innerCanvases.length },
              })
              contentFileId = contentUpload.id
              console.log('[EmbeddedEditor] Spread content PDF uploaded:', contentFileId)
            } catch (contentErr) {
              console.error('[EmbeddedEditor] Spread CONTENT PDF 실패:', (contentErr as Error)?.name, (contentErr as Error)?.message, (contentErr as Error)?.stack)
              try { Sentry.captureException(contentErr, { tags: { finishPhase: 'spread-content' } } as any) } catch { /* ignore */ }
              await finishMark('spread:content:gen:FAILED', { name: (contentErr as Error)?.name, message: (contentErr as Error)?.message })
            }

            if (coverFileId || contentFileId) {
              // B38 출력재현 단일소스: metadata.spread/spine 스냅샷 저장(additive). 실패해도 완료 무중단.
              const snapshots = buildSpreadSnapshots(
                spreadCfg,
                useSettingsStore.getState().spineConfig,
                innerCanvases.length,
              )
              await editSessionsApi.update(currentSessionId, {
                ...(coverFileId ? { coverFileId } : {}),
                ...(contentFileId ? { contentFileId } : {}),
                metadata: {
                  spreadContentPageCount: innerCanvases.length,
                  ...(snapshots.spread ? { spread: snapshots.spread } : {}),
                  ...(snapshots.spine ? { spine: snapshots.spine } : {}),
                },
              })
            }
            console.log('[EmbeddedEditor] Spread PDFs 결과 — cover:', coverFileId, 'content:', contentFileId)
          } else {
            console.warn('[EmbeddedEditor] Spread PDF: 플러그인/내지 캔버스 누락, PDF 생성 스킵')
          }
        } else if (editor && canvas) {
          // ── 단일 페이지(표지/내지/템플릿 등) ──
          const servicePlugin = editor.getPlugin('ServicePlugin') as ServicePlugin | undefined
          if (servicePlugin) {
            await finishMark('single:gen:start', { mode: effectiveMode })
            const pdfBlob = await withWatchdog(
              runWithAutosaveSuspended(() => servicePlugin.saveMultiPagePDFAsBlob(
                [canvas], [editor], `session-${currentSessionId}`,
                { width: options?.size?.width || 210, height: options?.size?.height || 297, cutSize: bleed, ...markOpt },
                undefined, 300,
              )),
              120000, 'single-gen',
            )
            await finishMark('single:gen:done', { bytes: pdfBlob?.size })
            if (pdfBlob) {
              setLoadingMessage('PDF를 업로드하는 중...')
              const fileType: 'cover' | 'content' | 'template' | 'other' =
                effectiveMode === 'cover' ? 'cover'
                : effectiveMode === 'content' ? 'content'
                : effectiveMode === 'template' ? 'template'
                : 'other'
              const uploadResponse = await filesApi.upload({
                file: pdfBlob, type: fileType, orderSeqno: effectiveOrderSeqno,
                metadata: { generatedBy: 'editor', editSessionId: currentSessionId, mode: effectiveMode },
              })
              const updatePayload: { coverFileId?: string; contentFileId?: string } = {}
              if (effectiveMode === 'content') updatePayload.contentFileId = uploadResponse.id
              else updatePayload.coverFileId = uploadResponse.id
              await editSessionsApi.update(currentSessionId, updatePayload)
              console.log('[EmbeddedEditor] PDF uploaded:', uploadResponse.id)
            }
          } else {
            console.warn('[EmbeddedEditor] ServicePlugin not found, skipping PDF generation')
          }
        }
      } catch (pdfErr) {
        console.error('[EmbeddedEditor] PDF generation/upload failed:', pdfErr)
        try { Sentry.captureException(pdfErr, { tags: { finishPhase: 'pdf-outer' } } as any) } catch { /* ignore */ }
        // Continue without PDF - we still want to complete the session
      }

      // Mark session as completed
      await finishMark('complete:start')
      setLoadingMessage('편집을 완료하는 중...')
      const completedSession = await editSessionsApi.complete(currentSessionId)
      await finishMark('complete:done', { coverFileId: completedSession.coverFileId, contentFileId: completedSession.contentFileId })
      setCurrentSession(completedSession)

      // S2 (2026-07-04): 이 경로(헤더 '편집완료' = 라이브 임베드 실완료 경로)에도 실측
      // pageCount/size + pricing 동봉 — 인스턴스 complete 경로와 payload 파리티.
      // (pricing 은 pre-existing 갭: 인스턴스 경로만 싣고 있어 라이브 임베드에서 포토북
      //  가변가격 메타가 파트너에 전달되지 않던 것 — 적대 리뷰 major 지적으로 정렬.)
      // Track 1 (2026-07-06): 산식을 computeLivePageCount 헬퍼로 단일 진실원화(complete 2경로+pricingChange).
      // T5 (2026-07-13): 표지+내지 단일 세션 spread(비-inner)는 표지 캔버스 1장 제외(21→20).
      // 캔버스 1(표지 단독 세션) 게이트 필수 — physical=0 방지. 포토북 inner ×2 산식 불변.
      const appStateAtFinish = useAppStore.getState()
      const spreadCfgAtFinish = useSettingsStore.getState().spreadConfig
      const livePageCount2 = computeLivePageCount(
        appStateAtFinish.allCanvas.length,
        spreadCfgAtFinish?.regionScope === 'inner',
        options?.pages || 1,
        appStateAtFinish.isSpreadMode &&
          spreadCfgAtFinish?.regionScope !== 'inner' &&
          appStateAtFinish.allCanvas.length > 1
          ? 1
          : 0,
      )
      const liveSize2 = useSettingsStore.getState().currentSettings.size
      const pricingMeta2 = templateSetPricingRef.current
      const result: EditorResult = {
        sessionId: completedSession.id,
        orderSeqno: Number(completedSession.orderSeqno),
        editCode: `EDIT-${completedSession.id.substring(0, 8).toUpperCase()}`,
        pages: {
          initial: options?.pages || 1,
          final: livePageCount2,
        },
        pageCount: livePageCount2,
        ...(pricingMeta2 ? { pricing: pricingMeta2 } : {}),
        ...(liveSize2
          ? { size: { width: liveSize2.width, height: liveSize2.height, unit: 'mm' as const } }
          : {}),
        files: {
          coverFileId: completedSession.coverFileId || undefined,
          contentFileId: completedSession.contentFileId || undefined,
          thumbnailUrl: completedSession.coverFile?.thumbnailUrl || undefined,
        },
        savedAt: completedSession.completedAt || completedSession.updatedAt,
      }

      console.log('[EmbeddedEditor] Complete success:', result.sessionId)
      onComplete?.(result)
      postToParent(parentOrigin, 'editor.complete', result)
    } catch (err) {
      console.error('[EmbeddedEditor] Complete failed:', err)
      const errPayload = {
        code: 'SAVE_FAILED' as const,
        message: err instanceof Error ? err.message : '편집 완료에 실패했습니다.',
      }
      onError?.(errPayload)
      postToParent(parentOrigin, 'editor.error', errPayload)
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [canvas, editor, sessionId, currentSession, options, mode, orderSeqno, onComplete, onError, parentOrigin])

  // 내 작업에 저장 핸들러 - EditorHeader에서 호출됨
  const handleSaveWork = useCallback(async () => {
    const currentSessionId = currentSession?.id || sessionId

    if (!currentSessionId) {
      console.log('[EmbeddedEditor] No session, skipping save')
      return
    }

    try {
      // Use auto-save's saveNow for immediate save
      const success = await saveNow()

      if (success) {
        const result: SaveResult = {
          sessionId: currentSessionId,
          savedAt: new Date().toISOString(),
          thumbnail: currentSession?.coverFile?.thumbnailUrl || undefined,
        }

        console.log('[EmbeddedEditor] Manual save completed:', result.sessionId)
        onSave?.(result)
        postToParent(parentOrigin, 'editor.save', result)
      } else {
        throw new Error('저장에 실패했습니다.')
      }
    } catch (err) {
      console.error('[EmbeddedEditor] Save failed:', err)
      const errPayload = {
        code: 'SAVE_FAILED' as const,
        message: err instanceof Error ? err.message : '저장에 실패했습니다.',
      }
      onError?.(errPayload)
      postToParent(parentOrigin, 'editor.error', errPayload)
      throw err
    }
  }, [sessionId, currentSession, saveNow, onSave, onError, parentOrigin])

  // 불러오기 핸들러 - 모달 열기
  const handleOpenWorkspace = useCallback(() => {
    setShowWorkspaceModal(true)
  }, [])

  // 세션 불러오기 핸들러 - 선택한 세션으로 편집기 재진입
  //
  // ⚠️ 과거: core.loadFromJSON(canvas, session.canvasData) 단일 캔버스 로드만 수행 →
  //   멀티페이지/스프레드 세션의 canvasData 는 "페이지별 배열" 이라 fabric loadFromJSON 이
  //   배열에서 objects 를 못 찾아 캔버스가 비고(워크스페이스까지 유실) → 편집완료 PDF 가
  //   "첫 번째 캔버스에서 워크스페이스를 찾을 수 없습니다" 로 실패.
  // ✅ 수정: 선택 세션의 sessionId/templateSetId 로 **편집기를 재진입**시켜 검증된 초기화 복원
  //   경로(멀티페이지 각 캔버스 복원 + 워크스페이스 보존)를 그대로 재사용한다.
  //   현재 URL 의 token/refreshToken/parentOrigin 등은 유지하고 식별자만 교체.
  const handleLoadSession = useCallback((session: EditSessionResponse) => {
    try {
      setShowWorkspaceModal(false)
      const url = new URL(window.location.href)
      url.searchParams.set('sessionId', session.id)
      if (session.templateSetId) url.searchParams.set('templateSetId', session.templateSetId)
      if (session.orderSeqno != null) url.searchParams.set('orderSeqno', String(session.orderSeqno))
      console.log('[EmbeddedEditor] Reloading editor for session:', session.id)
      // iframe(/embed) 컨텍스트면 iframe 만 재진입(부모 페이지 영향 없음).
      window.location.href = url.toString()
    } catch (err) {
      console.error('[EmbeddedEditor] Failed to load session:', err)
      const errPayload = {
        code: 'INVALID_DATA' as const,
        message: err instanceof Error ? err.message : '작업을 불러오는데 실패했습니다.',
      }
      onError?.(errPayload)
      postToParent(parentOrigin, 'editor.error', errPayload)
    }
  }, [onError, parentOrigin])

  // Toggle side panel
  const toggleSidePanel = () => {
    setShowSidePanel(!showSidePanel)
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-editor-bg">
        <div className="bg-white rounded-lg p-6 max-w-md text-center">
          <div className="text-red-500 text-4xl mb-4">!</div>
          <h2 className="text-lg font-semibold mb-2">에디터 초기화 실패</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            다시 시도
          </button>
        </div>
      </div>
    )
  }

  return (
    <div id="editor" className="flex flex-col h-full w-full">
      <EditorHeader
        screenMode={screenMode}
        onToggleSidePanel={toggleSidePanel}
        onLoadingChange={handleLoadingChange}
        onFinish={handleFinish}
        onSaveWork={handleSaveWork}
        onOpenWorkspace={handleOpenWorkspace}
        /* S1 (2026-07-04): embed = 주문 컨텍스트 — 작업 사이즈를 읽기전용으로 강등 */
        orderContext
      />

      <div className={`flex-1 flex relative overflow-hidden ${screenMode !== 'desktop' ? 'flex-col' : 'flex-row'}`}>
        {/* ToolBar - horizontal in tablet/mobile mode */}
        <ToolBar horizontal={screenMode !== 'desktop'} />

        {/* 캔버스 + 하단 페이지 네비를 세로로 쌓는 컬럼 (다중 페이지 전환 지원) */}
        <div className="flex-1 flex flex-col relative overflow-hidden min-w-0">
          {/* Content area - always flex-row for sidebar + canvas */}
          <div className="flex-1 flex flex-row relative overflow-hidden">
            <FeatureSidebar />
            {ready && <ControlBar />}

            <main className="flex-1 relative overflow-hidden bg-editor-workspace">
              <div id="canvas-wrapper" className="h-full w-full overflow-hidden relative">
                <div id="workspace" className="workspace absolute inset-0 flex items-center justify-center">
                  <div className="inside-shadow absolute inset-0 shadow-inner pointer-events-none" />
                  <div
                    ref={canvasContainerRef}
                    id="canvas-containers"
                    className="relative"
                    style={{ width: '100%', height: '100%' }}
                  />
                </div>
              </div>
            </main>

            {/* 우측 페이지 네비 (스프레드=세로 SpreadPagePanel / 일반=세로 BookNavigation) */}
            {navPosition === 'right' &&
              (isSpreadMode ? (
                <SpreadPagePanel orientation="vertical" />
              ) : (
                <BookNavigation orientation="vertical" />
              ))}

            <SidePanel show={showSidePanel} onClose={() => setShowSidePanel(false)} />
          </div>

          {/* 하단 페이지 네비 (스프레드=가로 SpreadPagePanel / 일반=가로 BookNavigation) */}
          {navPosition === 'bottom' &&
            (isSpreadMode ? (
              <SpreadPagePanel orientation="horizontal" />
            ) : (
              <BookNavigation orientation="horizontal" />
            ))}
        </div>
      </div>

      {isLoading && (
        <div className="absolute inset-0 z-[200] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-6 flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-editor-accent" />
            <p className="text-editor-text">{loadingMessage || '로딩 중...'}</p>
          </div>
        </div>
      )}

      {/* 저장된 작업 불러오기 모달 */}
      <WorkspaceModal
        isOpen={showWorkspaceModal}
        onLoad={handleLoadSession}
        onClose={() => setShowWorkspaceModal(false)}
      />

      {/* 자동저장 복원 배너 (비차단 — 사용자 발동 only, 자동 복원 없음) */}
      <RestoreBackupBanner
        open={!!restoreOffer}
        confident={restoreOffer?.confident ?? false}
        backupAt={restoreOffer?.backupAt}
        onRestore={handleRestoreBackup}
        onDismiss={handleDismissRestore}
      />
    </div>
  )
}

// ============================================================
// Editor Instance Class
// ============================================================

class StorigeEditorInstance {
  private root: Root | null = null
  private container: HTMLElement | null = null
  private config: EditorConfig
  private methodsRef = { current: null as EditorInstanceMethods | null }

  constructor(config: EditorConfig) {
    this.config = config
  }

  mount(elementId: string): void {
    this.container = document.getElementById(elementId)
    if (!this.container) {
      throw new Error(`Element #${elementId} not found`)
    }

    // Set container style for full height
    this.container.style.height = '100%'
    this.container.style.position = 'relative'

    this.root = createRoot(this.container)
    // Note: StrictMode disabled for embed build to prevent double initialization of canvas
    // lucide-react는 IconContext 미지원 — 각 아이콘이 size/strokeWidth 직접 지정 (기본 size=24)
    this.root.render(
      <EmbeddedEditor {...this.config} instanceRef={this.methodsRef} />
    )
  }

  unmount(): void {
    if (this.root) {
      this.root.unmount()
      this.root = null
    }
    if (this.container) {
      this.container.innerHTML = ''
    }
  }

  async save(): Promise<SaveResult> {
    if (!this.methodsRef.current) {
      throw new Error('Editor not initialized')
    }
    return this.methodsRef.current.save()
  }

  async complete(): Promise<void> {
    if (!this.methodsRef.current) {
      throw new Error('Editor not initialized')
    }
    return this.methodsRef.current.complete()
  }

  cancel(): void {
    this.methodsRef.current?.cancel()
  }

  undo(): void {
    this.methodsRef.current?.undo()
  }

  redo(): void {
    this.methodsRef.current?.redo()
  }

  getState(): EditorState {
    if (!this.methodsRef.current) {
      return { ready: false, modified: false, currentPage: 0, totalPages: 0 }
    }
    return this.methodsRef.current.getState()
  }
}

// ============================================================
// Global API
// ============================================================

/**
 * 에디터 인스턴스 생성 함수
 * @param config 에디터 설정
 * @returns 에디터 인스턴스
 */
function create(config: EditorConfig): StorigeEditorInstance {
  return new StorigeEditorInstance(config)
}

const version = '1.0.0'

// Export for IIFE bundle - these become window.StorigeEditor.create and window.StorigeEditor.version
// (EditorConfig/EditorResult/SaveResult/EditorState은 이미 위에서 export interface로 노출됨)
export { StorigeEditorInstance, EmbeddedEditor, create, version }
