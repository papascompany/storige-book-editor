import { apiClient } from './client'
import { computeInferenceCap } from '@storige/types'
import type { CutoutJobResult } from '@storige/types'

/**
 * 배경제거(컷아웃) 서버 오프로드 클라이언트 — S-P2A-B 샤드3 (2026-08-06).
 *
 * 종전에는 브라우저가 `@imgly/background-removal`(ONNX·AGPL-3.0)로 직접 추론했다.
 * 이제 추론은 서버(rembg 사이드카, 모델 u2net — D-12b)가 하고 편집기는 3단계만 한다:
 *
 *   1) 추론 입력 PNG 를 `POST /storage/upload-public` 으로 올려 **fileId** 를 받는다.
 *      이 라우트는 게스트 `@Public` 이면서 내부적으로 `filesService.registerExternalFile`
 *      까지 수행한다 — 컷아웃 잡이 요구하는 것이 그 `files.id` 다(다른 업로드 라우트는
 *      PDF 전용 필터이거나 presigned(s3) 전용이라 이 경로가 유일한 게스트 통로다).
 *   2) `POST /worker-jobs/cutout` 으로 잡 생성(무인증, 10/min).
 *   3) `GET /worker-jobs/:id/cutout-status` 폴링(무인증, 120/min).
 *
 * ⚠️ 업로드·잡 요청은 모두 `getDirectBaseUrl()`(빌드타임 API 원본)로 직결한다. 임베드 호스트가
 *    `setBaseUrl` 로 base 를 자사 프록시로 덮어쓴 경우 업로드가 본문 한도에 걸린다(413 전례).
 */

/** 폴링 간격 — 라우트 throttle 120/min 이므로 1.5s(=40회/분)면 한 잡이 3분을 끌어도 여유가 있다. */
const POLL_INTERVAL_MS = 1500
/** 전체 대기 상한 — 워커 REMBG_TIMEOUT_MS(180s) + 큐 대기 여유. */
const POLL_TIMEOUT_MS = 210_000
/**
 * PNG 로 인코딩했을 때 이 크기를 넘으면 JPEG 로 재인코딩한다.
 * 서버 입력 상한은 30MB(`CUTOUT_MAX_INPUT_BYTES`)이고, 추론 입력은 배경이 있는 원본이라
 * 알파가 없다 — JPEG 로 바꿔도 정보 손실이 결과 알파에 영향을 주지 않는다.
 */
const PNG_TO_JPEG_THRESHOLD_BYTES = 20 * 1024 * 1024

/**
 * 피사체별 모델 프리셋 — 서버 화이트리스트(`WorkerJobsService.CUTOUT_ALLOWED_MODELS`)의 부분집합이다.
 *
 * 두 모델은 성격이 갈린다(2026-08-06 동일 원본 실측, 알파 히스토그램 기준):
 *  - `person`  : `u2net_human_seg` — 인물 전용. 반투명 2.7% · 2.9s. 사람이면 압도적으로 정확하다.
 *  - `general` : `isnet-general-use` — 범용. 반투명 18.0% · 4.5s. 상품·캐릭터·반려동물은 이쪽.
 *
 * ⚠️ 기본값을 바꿀 때는 서버 기본(`REMBG_MODEL`)과 어긋나도 무방하다 — 클라가 명시하면
 *    그 값이 우선이고, 서버 기본은 model 미지정 잡에만 적용된다.
 */
export const CUTOUT_SUBJECT_MODELS = {
  person: 'u2net_human_seg',
  general: 'isnet-general-use',
} as const

export type CutoutSubject = keyof typeof CUTOUT_SUBJECT_MODELS

export class CutoutError extends Error {
  constructor(
    message: string,
    /** 서버 errorCode 또는 클라 분류 코드 — 호출부 분기·로깅용 */
    readonly code: string,
  ) {
    super(message)
    this.name = 'CutoutError'
  }
}

interface CutoutStatusResponse {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | string
  result: CutoutJobResult | null
  errorCode: string | null
  errorMessage: string | null
  completedAt: string | null
}

/** 서버 에러 응답에서 코드/문구를 뽑는다(NestJS 예외 필터의 {code,message} 규약). */
function toCutoutError(e: unknown, fallback: string): CutoutError {
  const res = (e as { response?: { status?: number; data?: { code?: string; message?: string } } })?.response
  const status = res?.status
  const code = res?.data?.code
  const message = res?.data?.message

  if (status === 429) {
    return new CutoutError('요청이 많습니다. 잠시 후 다시 시도해 주세요.', 'RATE_LIMITED')
  }
  // 기능 플래그가 꺼져 있으면 라우트 자체를 숨긴다(404 + 'Cannot resolve route').
  if (status === 404 && code === 'NOT_FOUND') {
    return new CutoutError('배경 제거 기능이 현재 비활성화되어 있습니다.', 'CUTOUT_DISABLED')
  }
  if (status === 400 && (code === 'CUTOUT_MODEL_NOT_ALLOWED' || code === 'CUTOUT_MODEL_FORBIDDEN')) {
    return new CutoutError('배경 제거 설정이 올바르지 않습니다.', code)
  }
  if (status === 400 && code === 'FILE_NOT_IMAGE') {
    return new CutoutError('배경 제거는 PNG·JPEG·WebP 이미지만 가능합니다.', code)
  }
  return new CutoutError(message || fallback, code || 'CUTOUT_REQUEST_FAILED')
}

/**
 * `CutoutJobResult.cutoutUrl`(상대 `/storage/cutouts/...`)을 절대 URL 로 바꾼다.
 *
 * nginx 가 `/storage/*` 를 무인증·ACAO `*` 로 서빙하므로 `crossOrigin='anonymous'` 로 로드해도
 * 캔버스가 tainted 되지 않는다(이후 `processImage` 의 OpenCV 트림이 픽셀을 읽어야 한다).
 *
 * origin 은 `VITE_API_URL`(스토리지 직접 접근용 — `fontManager.resolveStorageUrl` 과 같은 규약)을
 * 먼저 본다. API base 가 상대경로('/api', dev 프록시)인 환경에서도 storage 는 원본에서 받아야
 * 하기 때문이다. 미설정이면 API base 에서 `/api` 접미사를 떼어 쓴다.
 */
export function resolveCutoutUrl(cutoutUrl: string): string {
  if (/^https?:\/\//i.test(cutoutUrl)) return cutoutUrl
  const path = cutoutUrl.startsWith('/') ? cutoutUrl : `/${cutoutUrl}`

  const storageOrigin = (import.meta.env?.VITE_API_URL as string | undefined)?.replace(/\/+$/, '')
  if (storageOrigin) return `${storageOrigin}${path}`

  const origin = apiClient.getDirectBaseUrl().replace(/\/+$/, '').replace(/\/api$/, '')
  return `${origin}${path}`
}

/**
 * 추론 입력 이미지를 만든다 — 장변 캡(2560, `CUTOUT_MAX_LONG_EDGE`)을 **클라에서 먼저** 적용한다.
 *
 * 서버도 같은 캡을 강제하지만(서버 권위), 여기서 줄여야 업로드 바이트가 줄어든다.
 * 캡이 걸리지 않아도 캔버스로 한 번 굽는다 — element 가 무엇이든(HTMLImageElement·canvas)
 * 동일한 PNG 바이트로 정규화하기 위함이다.
 */
export async function buildCutoutInput(
  element: HTMLImageElement | HTMLCanvasElement,
): Promise<{ blob: Blob; filename: string; width: number; height: number }> {
  const naturalW =
    (element as HTMLImageElement).naturalWidth || element.width || 0
  const naturalH =
    (element as HTMLImageElement).naturalHeight || element.height || 0
  if (!naturalW || !naturalH) {
    throw new CutoutError('이미지 크기를 읽을 수 없습니다.', 'CUTOUT_INPUT_INVALID')
  }

  const cap = computeInferenceCap(naturalW, naturalH)
  const targetW = cap.engaged ? cap.targetWidth : naturalW
  const targetH = cap.engaged ? cap.targetHeight : naturalH

  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new CutoutError('이미지를 준비할 수 없습니다.', 'CUTOUT_INPUT_INVALID')
  }
  ctx.drawImage(element, 0, 0, targetW, targetH)

  // toBlob 은 tainted canvas 에서 null 을 준다(crossOrigin 미설정 이미지) — 명시적으로 안내한다.
  const png = await canvasToBlob(canvas, 'image/png')
  if (png && png.size <= PNG_TO_JPEG_THRESHOLD_BYTES) {
    return { blob: png, filename: 'cutout-source.png', width: targetW, height: targetH }
  }
  const jpeg = await canvasToBlob(canvas, 'image/jpeg', 0.92)
  const chosen = jpeg ?? png
  if (!chosen) {
    throw new CutoutError(
      '이미지를 읽을 수 없습니다. 다시 업로드한 뒤 시도해 주세요.',
      'CUTOUT_INPUT_TAINTED',
    )
  }
  return {
    blob: chosen,
    filename: chosen.type === 'image/jpeg' ? 'cutout-source.jpg' : 'cutout-source.png',
    width: targetW,
    height: targetH,
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), type, quality)
    } catch {
      resolve(null) // SecurityError(tainted) — 호출부가 null 을 사용자 문구로 바꾼다
    }
  })
}

/** 추론 입력을 업로드하고 `files.id` 를 받는다(게스트 가능). */
export async function uploadCutoutSource(blob: Blob, filename: string): Promise<string> {
  const form = new FormData()
  form.append('file', blob, filename)
  try {
    const res = await apiClient.post<{ id: string; url: string }>(
      '/storage/upload-public?category=uploads',
      form,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        baseURL: apiClient.getDirectBaseUrl(),
      },
    )
    const id = res.data?.id
    if (!id) {
      throw new CutoutError('업로드 응답에 파일 ID 가 없습니다.', 'CUTOUT_UPLOAD_NO_ID')
    }
    return id
  } catch (e) {
    if (e instanceof CutoutError) throw e
    throw toCutoutError(e, '이미지 업로드에 실패했습니다.')
  }
}

/** 컷아웃 잡 생성 → jobId. model 미지정 시 서버 env 기본값(u2net). */
export async function createCutoutJob(fileId: string, model?: string): Promise<string> {
  try {
    const res = await apiClient.post<{ id: string; status: string }>(
      '/worker-jobs/cutout',
      model ? { fileId, model } : { fileId },
      { baseURL: apiClient.getDirectBaseUrl() },
    )
    const id = res.data?.id
    if (!id) {
      throw new CutoutError('잡 생성 응답이 올바르지 않습니다.', 'CUTOUT_JOB_NO_ID')
    }
    return id
  } catch (e) {
    if (e instanceof CutoutError) throw e
    throw toCutoutError(e, '배경 제거 요청에 실패했습니다.')
  }
}

export async function fetchCutoutStatus(jobId: string): Promise<CutoutStatusResponse> {
  try {
    const res = await apiClient.get<CutoutStatusResponse>(
      `/worker-jobs/${jobId}/cutout-status`,
      { baseURL: apiClient.getDirectBaseUrl() },
    )
    return res.data
  } catch (e) {
    throw toCutoutError(e, '배경 제거 상태를 확인할 수 없습니다.')
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 완료까지 폴링한다. 실패(FAILED)는 서버가 준 사용자 문구를 그대로 쓴다 —
 * 원문 예외 문자열은 무인증 표면에 나오지 않도록 API 가 이미 걸러 준다.
 */
export async function pollCutoutJob(
  jobId: string,
  opts: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<CutoutJobResult> {
  const interval = opts.intervalMs ?? POLL_INTERVAL_MS
  const timeout = opts.timeoutMs ?? POLL_TIMEOUT_MS
  const startedAt = Date.now()

  for (;;) {
    if (opts.signal?.aborted) {
      throw new CutoutError('배경 제거가 취소되었습니다.', 'CUTOUT_ABORTED')
    }
    const snap = await fetchCutoutStatus(jobId)
    const status = String(snap.status || '').toLowerCase()

    if (status === 'completed') {
      if (!snap.result?.cutoutUrl) {
        throw new CutoutError('배경 제거 결과를 받지 못했습니다.', 'CUTOUT_NO_RESULT')
      }
      return snap.result
    }
    if (status === 'failed') {
      throw new CutoutError(
        snap.errorMessage || '배경 제거에 실패했습니다.',
        snap.errorCode || 'CUTOUT_FAILED',
      )
    }
    if (Date.now() - startedAt > timeout) {
      throw new CutoutError(
        '배경 제거가 시간 내에 끝나지 않았습니다. 잠시 후 다시 시도해 주세요.',
        'CUTOUT_TIMEOUT',
      )
    }
    await sleep(interval)
  }
}

/** 결과 PNG 를 이미지 엘리먼트로 로드한다(트림 단계가 픽셀을 읽으므로 CORS 필수). */
export function loadCutoutImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () =>
      reject(new CutoutError('배경 제거 결과를 불러오지 못했습니다.', 'CUTOUT_RESULT_LOAD_FAILED'))
    img.src = url
  })
}

/**
 * 한 장의 이미지 element 에 대한 전체 컷아웃 왕복 —
 * 입력 준비 → 업로드 → 잡 → 폴링 → 결과 element.
 */
export async function requestCutout(
  element: HTMLImageElement | HTMLCanvasElement,
  opts: { model?: string; onPhase?: (phase: 'upload' | 'queue' | 'download') => void } = {},
): Promise<{ element: HTMLImageElement; result: CutoutJobResult }> {
  const input = await buildCutoutInput(element)
  opts.onPhase?.('upload')
  const fileId = await uploadCutoutSource(input.blob, input.filename)

  opts.onPhase?.('queue')
  const jobId = await createCutoutJob(fileId, opts.model)
  const result = await pollCutoutJob(jobId)

  opts.onPhase?.('download')
  const cutoutElement = await loadCutoutImage(resolveCutoutUrl(result.cutoutUrl))
  return { element: cutoutElement, result }
}
