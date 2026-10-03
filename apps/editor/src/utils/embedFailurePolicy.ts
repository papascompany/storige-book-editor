/**
 * 임베드 편집기 실패 분류와 고객 문구 — 초기화(세션 조회·생성)·템플릿셋 로드·저장/완료 실패를 같은 기준으로
 * 나눈다. `editor.error` 의 message 는 호스트가 고객에게 그대로 보여 주므로 아래 고정 한국어 문구만 쓴다
 * (서버 원문·식별자·axios 영문 문구를 싣지 않는다).
 *
 * 분류(classifyRequestFailure):
 *   - connectivity: 응답 없음(연결 실패·타임아웃)
 *   - server: 5xx·408·429
 *   - auth: 401
 *   - client: 그 밖의 4xx
 *   - other: HTTP 실패가 아님
 * 정규화된 오류 객체({ code: ApiError['code'], status? }, Error 가 아닌 객체)도 code 로 같은 분류를 쓴다.
 *
 * axios 와 httpErrorFields 에만 의존한다(테스트 하네스의 './api' mock 과 무관).
 */
import axios from 'axios'
import type { ApiError } from '../api/client'
import { apiErrorCodeOf, httpStatusOf } from './httpErrorFields'

export type RequestFailureKind = 'connectivity' | 'server' | 'auth' | 'client' | 'other'

export interface RequestFailure {
  kind: RequestFailureKind
  /** HTTP 상태 — 응답이 있을 때만 */
  status?: number
  /** 응답 본문 code 문자열(MEMBER_REQUIRED 등). 없으면 null */
  apiCode: string | null
}

/**
 * 편집기가 초기화 중 직접 던지는 고객 안내 오류. message 를 고객 문구로 그대로 쓴다.
 * 그 밖의 Error(런타임 오류 등)는 고정 문구로 알린다.
 */
export class EmbedInitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmbedInitError'
  }
}

export const EMBED_FAILURE_MESSAGES = {
  sessionConnectivity: '편집 작업을 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해주세요.',
  sessionServer: '일시적인 서버 오류로 편집 작업을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.',
  sessionRejected: '편집 작업을 시작할 수 없습니다. 이전 화면으로 돌아가 다시 열어 주세요.',
  templateSetNotFound:
    '이 상품의 편집 정보를 찾을 수 없습니다. 이전 화면으로 돌아가 다시 열거나, 계속되면 고객센터에 문의해 주세요.',
  authExpired: '인증이 만료되었습니다. 페이지를 새로고침해주세요.',
  initGeneric: '초기화 중 오류가 발생했습니다.',
  /** 편집기 안 '저장된 작업 불러오기' 실패(INVALID_DATA, fatal:false) */
  workspaceLoadFailed: '작업을 불러오는데 실패했습니다.',
} as const

const NORMALIZED_KIND: Record<ApiError['code'], RequestFailureKind> = {
  NETWORK_ERROR: 'connectivity',
  TIMEOUT: 'connectivity',
  SERVER_ERROR: 'server',
  AUTH_EXPIRED: 'auth',
  VALIDATION_ERROR: 'client',
  UNKNOWN: 'client',
}

/** Error 가 아닌 정규화 오류 객체의 code(ApiError['code'] 중 하나일 때만) */
function normalizedCodeOf(err: unknown): ApiError['code'] | null {
  if (err === null || typeof err !== 'object' || err instanceof Error) return null
  const code = (err as { code?: unknown }).code
  if (typeof code !== 'string') return null
  return Object.prototype.hasOwnProperty.call(NORMALIZED_KIND, code) ? (code as ApiError['code']) : null
}

/** HTTP 실패 분류. 알 수 없는 입력은 other. throw 하지 않는다. */
export function classifyRequestFailure(err: unknown): RequestFailure {
  try {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status
      const apiCode = apiErrorCodeOf(err)
      if (typeof status !== 'number') return { kind: 'connectivity', apiCode }
      if (status === 401) return { kind: 'auth', status, apiCode }
      if (status >= 500 || status === 408 || status === 429 || status < 400) {
        return { kind: 'server', status, apiCode }
      }
      return { kind: 'client', status, apiCode }
    }
    const normalized = normalizedCodeOf(err)
    if (normalized) {
      const status = httpStatusOf(err)
      return { kind: NORMALIZED_KIND[normalized], ...(status !== undefined ? { status } : {}), apiCode: null }
    }
  } catch {
    // 분류 실패는 other 로 본다.
  }
  return { kind: 'other', apiCode: null }
}

/**
 * 회원 세션 생성 실패 뒤 비회원 세션 생성으로 넘어갈지.
 * 400(code 가 MEMBER_REQUIRED 이거나 없음)·403 PERMISSION_DENIED 만 넘어간다.
 */
export function shouldCreateGuestAfterMemberCreateFailure(err: unknown): boolean {
  const f = classifyRequestFailure(err)
  if (f.kind !== 'client') return false
  if (f.status === 400) return f.apiCode === null || f.apiCode === 'MEMBER_REQUIRED'
  if (f.status === 403) return f.apiCode === 'PERMISSION_DENIED'
  return false
}

/**
 * 주문별 세션 목록 조회 실패 뒤 새 세션 생성으로 진행할지.
 * 그 밖의 4xx·HTTP 가 아닌 실패는 진행, 연결 실패·타임아웃·5xx·408·429·401 은 중단.
 */
export function canCreateSessionAfterOrderLookupFailure(err: unknown): boolean {
  const kind = classifyRequestFailure(err).kind
  return kind === 'client' || kind === 'other'
}

export type InitFailureResolution =
  /** 401 — 인증 만료 알림은 인터셉터 리스너가 맡는다. 화면 문구만 쓴다. */
  | { action: 'screenOnly'; screenMessage: string }
  | { action: 'notifyHost'; code: 'NETWORK_ERROR' | 'INVALID_DATA'; message: string }

/** 초기화 실패 → 호스트 알림 code·고정 문구 */
export function resolveInitFailure(err: unknown): InitFailureResolution {
  if (err instanceof EmbedInitError) {
    return { action: 'notifyHost', code: 'INVALID_DATA', message: err.message || EMBED_FAILURE_MESSAGES.initGeneric }
  }
  switch (classifyRequestFailure(err).kind) {
    case 'connectivity':
      return { action: 'notifyHost', code: 'NETWORK_ERROR', message: EMBED_FAILURE_MESSAGES.sessionConnectivity }
    case 'server':
      return { action: 'notifyHost', code: 'NETWORK_ERROR', message: EMBED_FAILURE_MESSAGES.sessionServer }
    case 'auth':
      return { action: 'screenOnly', screenMessage: EMBED_FAILURE_MESSAGES.authExpired }
    case 'client':
      return { action: 'notifyHost', code: 'INVALID_DATA', message: EMBED_FAILURE_MESSAGES.sessionRejected }
    default:
      return { action: 'notifyHost', code: 'INVALID_DATA', message: EMBED_FAILURE_MESSAGES.initGeneric }
  }
}

export type TemplateSetLoadResolution =
  /** 401 — 인증 만료 알림은 인터셉터 리스너가 맡는다. 화면 문구만 쓴다. */
  | { action: 'screenOnly'; screenMessage: string }
  | { action: 'notifyHost'; code: 'NETWORK_ERROR' | 'TEMPLATE_SET_NOT_FOUND'; message: string }

/** 템플릿셋 조회·로드 실패 → 일시 오류는 NETWORK_ERROR, 거절·형식 오류는 TEMPLATE_SET_NOT_FOUND */
export function resolveTemplateSetLoadFailure(err: unknown): TemplateSetLoadResolution {
  switch (classifyRequestFailure(err).kind) {
    case 'connectivity':
      return { action: 'notifyHost', code: 'NETWORK_ERROR', message: EMBED_FAILURE_MESSAGES.sessionConnectivity }
    case 'server':
      return { action: 'notifyHost', code: 'NETWORK_ERROR', message: EMBED_FAILURE_MESSAGES.sessionServer }
    case 'auth':
      return { action: 'screenOnly', screenMessage: EMBED_FAILURE_MESSAGES.authExpired }
    default:
      return {
        action: 'notifyHost',
        code: 'TEMPLATE_SET_NOT_FOUND',
        message: EMBED_FAILURE_MESSAGES.templateSetNotFound,
      }
  }
}

export type SaveFailurePhase = 'save' | 'complete'
export type SaveFailureBucket = 'connectivity' | 'server' | 'auth' | 'rejected' | 'tooLarge' | 'other'

export const SAVE_FAILURE_MESSAGES: Record<SaveFailurePhase, Record<SaveFailureBucket, string>> = {
  save: {
    connectivity: '저장하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해주세요.',
    server: '일시적인 서버 오류로 저장하지 못했습니다. 잠시 후 다시 시도해주세요.',
    auth: '인증이 만료되어 저장하지 못했습니다. 페이지를 새로고침해주세요.',
    rejected: '저장 요청을 처리할 수 없습니다. 이전 화면으로 돌아가 다시 열어 주세요.',
    tooLarge: '편집 내용의 용량이 서버 한도를 넘어 저장하지 못했습니다. 이미지 수나 크기를 줄인 뒤 다시 시도해주세요.',
    other: '저장하지 못했습니다. 잠시 후 다시 시도해주세요.',
  },
  complete: {
    connectivity: '편집을 완료하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해주세요.',
    server: '일시적인 서버 오류로 편집을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.',
    auth: '인증이 만료되어 편집을 완료하지 못했습니다. 페이지를 새로고침해주세요.',
    rejected: '편집 완료 요청을 처리할 수 없습니다. 이전 화면으로 돌아가 다시 열어 주세요.',
    tooLarge:
      '편집 내용의 용량이 서버 한도를 넘어 편집을 완료하지 못했습니다. 이미지 수나 크기를 줄인 뒤 다시 시도해주세요.',
    other: '편집을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.',
  },
}

/** 저장·완료 실패 → SAVE_FAILED 고정 문구. 4xx 는 거절(413 은 용량) 문구, HTTP 가 아닌 실패는 other. */
export function saveFailureMessage(err: unknown, phase: SaveFailurePhase): string {
  const f = classifyRequestFailure(err)
  const messages = SAVE_FAILURE_MESSAGES[phase]
  switch (f.kind) {
    case 'connectivity':
    case 'server':
    case 'auth':
      return messages[f.kind]
    case 'client':
      return f.status === 413 ? messages.tooLarge : messages.rejected
    default:
      return messages.other
  }
}
