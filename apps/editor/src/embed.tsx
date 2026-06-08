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
import { useSettingsStore } from './stores/useSettingsStore'
import { useSaveStore } from './stores/useSaveStore'
import { useEditorContents } from './hooks/useEditorContents'
import { useEmbedAutoSave } from './hooks/useEmbedAutoSave'
import { useEmbedBackGuard } from './hooks/useEmbedBackGuard'
import { createCanvas } from './utils/createCanvas'
import { buildSpreadSnapshots } from './utils/buildSpreadSnapshots'
import { templatesApi, editSessionsApi, filesApi, apiClient, type EditSessionResponse } from './api'
import { core, ServicePlugin } from '@storige/canvas-core'
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
import { Sentry } from './lib/sentry'
import { applyContentPdfGuides } from './utils/contentPdfGuide'
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
  // eslint-disable-next-line no-console
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
  code: 'AUTH_EXPIRED' | 'NETWORK_ERROR' | 'SAVE_FAILED' | 'INVALID_DATA' | 'SESSION_NOT_FOUND'
  message: string
}

export interface EditorResult {
  sessionId: string
  orderSeqno?: number
  editCode?: string
  pages: {
    initial: number
    final: number
  }
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

  const { loadEmptyEditor, loadTemplateSetEditor } = useEditorContents()

  // Auto-save hook integration
  const { saveNow, markDirty } = useEmbedAutoSave({
    sessionId: currentSession?.id || sessionId || null,
    currentSession,
    onSessionUpdate: (updatedSession) => {
      setCurrentSession(updatedSession)
    },
    onError: (error) => {
      console.error('[EmbeddedEditor] Auto-save error:', error)
      // Don't call onError for auto-save failures to avoid disrupting user flow
    },
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
        let editSession: EditSessionResponse | null = null
        if (orderSeqno && mode) {
          setLoadingMessage('편집 세션을 불러오는 중...')

          if (sessionId) {
            // 기존 세션 불러오기
            try {
              editSession = await editSessionsApi.get(sessionId)
              console.log('[EmbeddedEditor] Existing session loaded:', editSession.id)
            } catch (err) {
              console.warn('[EmbeddedEditor] Session not found, creating new one:', sessionId)
            }
          }

          // sessionId 없거나 조회 실패 → orderSeqno로 기존 세션 검색
          if (!editSession) {
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
          }

          // 기존 세션이 없으면 새로 생성
          if (!editSession) {
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

          setCurrentSession(editSession)
        }

        if (!isMounted) return

        // 3. Fetch template set info
        let effectiveTemplateSetId = templateSetId;
        let showMappingAlert = false;

        if (!effectiveTemplateSetId) {
          throw new Error('템플릿셋 ID가 필요합니다. (templateSetId)')
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
          console.warn('[EmbeddedEditor] Failed to load requested template set. Falling back to sample.', err)
          showMappingAlert = true
          effectiveTemplateSetId = 'sample-8x8-book-24p'
          const fallback = await templatesApi.getTemplateSetWithTemplates(effectiveTemplateSetId)
          templateSet = fallback?.templateSet || fallback
          if (!templateSet || !templateSet.id) {
            throw new Error('샘플 템플릿셋마저 불러올 수 없습니다.')
          }
        }
        console.log('[EmbeddedEditor] TemplateSet loaded:', templateSet.name)

        if (!isMounted) return

        // 2. Create canvas
        setLoadingMessage('캔버스를 초기화하는 중...')
        const fabricCanvas = await createCanvas({}, canvasContainerRef.current!, initId)

        if (!isMounted) {
          fabricCanvas.dispose()
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
          fabricCanvas.dispose()
          return
        }

        // 3. Load content based on template set
        setLoadingMessage('콘텐츠를 불러오는 중...')
        console.log('[EmbeddedEditor] Loading template set with options:', {
          templateSetId: effectiveTemplateSetId,
          pageCount: options?.pageCount,
          paperType: options?.paperType,
          bindingType: options?.bindingType,
        })
        try {
          await loadTemplateSetEditor({
            templateSetId: effectiveTemplateSetId,
            pageCount: options?.pageCount,
            paperType: options?.paperType,
            bindingType: options?.bindingType,
          })
        } catch (loadErr) {
          console.warn('[EmbeddedEditor] Failed to load template set editor. Falling back to sample.', loadErr)
          showMappingAlert = true
          effectiveTemplateSetId = 'sample-8x8-book-24p'
          await loadTemplateSetEditor({
            templateSetId: effectiveTemplateSetId,
            pageCount: options?.pageCount,
            paperType: options?.paperType,
            bindingType: options?.bindingType,
          })
        }

        if (showMappingAlert) {
          setTimeout(() => {
            alert('템플릿셋 매핑이 맞지 않아 테스트모드로 구동됩니다. 편집내용에 대한 주문에 문제가 있을 수 있습니다.');
          }, 500);
        }

        if (!isMounted) return

        // 기존 세션의 canvasData가 있으면 복원 (재편집)
        // canvasData가 배열이면 멀티페이지 복원, 객체면 단일 캔버스 복원
        if (editSession?.canvasData) {
          setLoadingMessage('저장된 작업을 복원하는 중...')
          const saved = editSession.canvasData
          const { allCanvas: canvases } = useAppStore.getState()

          if (Array.isArray(saved) && saved.length > 0) {
            // 멀티페이지: 각 페이지 canvasData를 대응 캔버스에 로드
            for (let i = 0; i < saved.length && i < canvases.length; i++) {
              if (saved[i]) await core.loadFromJSON(canvases[i], saved[i])
            }
            console.log('[EmbeddedEditor] Multi-page canvasData restored:', saved.length, 'pages')
          } else if (!Array.isArray(saved) && fabricCanvas) {
            // 단일 캔버스 (legacy 및 cover 전용 세션)
            await core.loadFromJSON(fabricCanvas, saved)
            console.log('[EmbeddedEditor] Single canvasData restored:', editSession.id)
          }
        }

        if (!isMounted) return

        // 3-A. 내지 PDF 표시전용 가이드 배치 (underlay 모드) — 캔버스 복원 후.
        // 가이드는 excludeFromExport 라 export/저장에서 제외, 최종 인쇄는 첨부 원본 PDF 그대로.
        if (editSession) {
          await applyContentPdfGuides(editSession, effectiveTemplateSetId)
        }

        if (!isMounted) return

        // 4. Complete initialization
        setReady(true)
        isInitializedRef.current = true
        setIsLoading(false)

        console.log('[EmbeddedEditor] Initialization complete')
        onReady?.()
        postToParent(parentOrigin, 'editor.ready', {
          sessionId: editSession?.id,
          templateSetId,
          version: '1.0.0',
        })
      } catch (err) {
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

        try {
          // First save current state
          const canvasData = canvas?.toJSON(core.extendFabricOption) || null

          // 게스트 세션: 회원 전용 complete 불가 → 저장만 하고 로그인 유도(editor.needAuth)
          const guestToken = currentSession?.guestToken
          if (guestToken) {
            await editSessionsApi.updateGuest(currentSessionId, guestToken, { canvasData })
            postToParent(parentOrigin, 'editor.needAuth', {
              guestToken,
              reason: 'complete_save',
              ts: new Date().toISOString(),
            })
            console.log('[EmbeddedEditor] Guest complete → needAuth emitted')
            return
          }

          await editSessionsApi.update(currentSessionId, {
            canvasData,
          })

          // Then mark as completed
          const completedSession = await editSessionsApi.complete(currentSessionId)
          setCurrentSession(completedSession)

          const result: EditorResult = {
            sessionId: completedSession.id,
            orderSeqno: Number(completedSession.orderSeqno),
            editCode: `EDIT-${completedSession.id.substring(0, 8).toUpperCase()}`,
            pages: {
              initial: options?.pages || 1,
              final: options?.pages || 1,
            },
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

      // 게스트 세션: PDF 생성/회원 complete 불가 → 저장만 하고 로그인 유도(editor.needAuth)
      const guestToken = currentSession?.guestToken
      if (guestToken) {
        await editSessionsApi.updateGuest(currentSessionId, guestToken, { canvasData })
        postToParent(parentOrigin, 'editor.needAuth', {
          guestToken,
          reason: 'complete_save',
          ts: new Date().toISOString(),
        })
        console.log('[EmbeddedEditor] Guest finish → needAuth emitted')
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
            const innerW = (spreadCfg!.spec as any)?.coverWidthMm ?? options?.size?.width ?? 210
            const innerH = (spreadCfg!.spec as any)?.coverHeightMm ?? options?.size?.height ?? 297
            console.log('[EmbeddedEditor] Spread PDF 시작 — pages:', allCanvas.length, 'cover:', spreadCfg!.totalWidthMm, 'x', spreadCfg!.totalHeightMm, 'inner:', innerW, 'x', innerH)

            // 표지 cover PDF (스프레드 전체 크기) — 독립 try (실패해도 내지는 시도)
            let coverFileId: string | undefined
            try {
              await finishMark('spread:cover:gen:start', { w: spreadCfg!.totalWidthMm, h: spreadCfg!.totalHeightMm })
              const coverBlob = await withWatchdog(
                coverPlugin.saveMultiPagePDFAsBlob(
                  [allCanvas[0]] as any, [allEditors[0]], `cover-${currentSessionId}`,
                  { width: spreadCfg!.totalWidthMm, height: spreadCfg!.totalHeightMm, cutSize: bleed },
                  undefined, 300,
                ),
                120000, 'spread-cover-gen',
              )
              await finishMark('spread:cover:gen:done', { bytes: coverBlob.size })
              setLoadingMessage('PDF를 업로드하는 중...')
              const coverUpload = await filesApi.upload({
                file: coverBlob, type: 'cover', orderSeqno,
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
              const contentBlob = await withWatchdog(
                coverPlugin.saveMultiPagePDFAsBlob(
                  innerCanvases as any, innerEditors, `content-${currentSessionId}`,
                  { width: innerW, height: innerH, cutSize: bleed },
                  undefined, 300,
                ),
                180000, 'spread-content-gen',
              )
              await finishMark('spread:content:gen:done', { bytes: contentBlob.size })
              const contentUpload = await filesApi.upload({
                file: contentBlob, type: 'content', orderSeqno,
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
            await finishMark('single:gen:start', { mode })
            const pdfBlob = await withWatchdog(
              servicePlugin.saveMultiPagePDFAsBlob(
                [canvas], [editor], `session-${currentSessionId}`,
                { width: options?.size?.width || 210, height: options?.size?.height || 297, cutSize: bleed },
                undefined, 300,
              ),
              120000, 'single-gen',
            )
            await finishMark('single:gen:done', { bytes: pdfBlob?.size })
            if (pdfBlob) {
              setLoadingMessage('PDF를 업로드하는 중...')
              const fileType: 'cover' | 'content' | 'template' | 'other' =
                mode === 'cover' ? 'cover'
                : mode === 'content' ? 'content'
                : mode === 'template' ? 'template'
                : 'other'
              const uploadResponse = await filesApi.upload({
                file: pdfBlob, type: fileType, orderSeqno,
                metadata: { generatedBy: 'editor', editSessionId: currentSessionId, mode },
              })
              const updatePayload: { coverFileId?: string; contentFileId?: string } = {}
              if (mode === 'content') updatePayload.contentFileId = uploadResponse.id
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

      const result: EditorResult = {
        sessionId: completedSession.id,
        orderSeqno: Number(completedSession.orderSeqno),
        editCode: `EDIT-${completedSession.id.substring(0, 8).toUpperCase()}`,
        pages: {
          initial: options?.pages || 1,
          final: options?.pages || 1,
        },
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
