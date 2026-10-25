import { core } from '@storige/canvas-core'
import { useCalendarStore } from '@/stores/useCalendarStore'
import { useImageStore } from '@/stores/useImageStore'
import { getAssetBaseUrl, resolveAssetUrl } from '@/utils/resolveAssetUrl'

/**
 * calendarSkinUploads.ts — 캘린더 디자인(스킨) 적용 때 캔버스에서 빠지는 고객 배경·사진의 원본 판정과 '내 업로드' 등록
 *
 * - `classifyBackgroundSrc` 는 배경(또는 빠진 사진) src 가 다시 쓸 수 있는 원본인지 판정한다.
 *   canvas-core `mergeSkinCanvas` 의 `srcKind 'storage-url'` 은 경로 어디든 `storage/` 가 있으면 잡을 만큼 넓어서
 *   등록·강제 유지 판단에는 쓰지 않는다. 이 함수가 최종 판정이다.
 * - `registerUploadsFromUrls` 는 '내 업로드'(`useImageStore.uploaded`) 목록에만 넣는다. 배경은 자동편집 입력이 아니므로
 *   `uploadedPhotoMeta`·`uploadedPhotoIdByUrl`·사진 수 한도는 건드리지 않는다.
 * - `keepSkinUploads` 는 적용 경로가 부르는 단일 진입점이다. 세션 메타 `calendar.skinUploads` 에 기록하고(다시 열 때
 *   `restoreCalendarSessionMeta` 가 '내 업로드'로 되살림) '내 업로드'에 등록한다.
 * - `normalizeSkinUploads` 는 기록·판독 공용 정제기다: 같은 API 의 `/storage/uploads/<파일>` 절대 URL 만, 2048자 이하,
 *   중복 제거(나중 것이 남음), 최대 `SKIN_UPLOADS_MAX` 개(넘치면 오래된 것부터 뺌). 서버는 이 키를 검사하지 않는다.
 */

/** 세션 메타 `calendar.skinUploads` 상한(개) */
export const SKIN_UPLOADS_MAX = 50
/** URL 1개 길이 상한(프로파일 thumbnailUrl 과 같은 값) */
export const SKIN_UPLOAD_URL_MAX = 2048

/**
 * - `data`: data URL — canvas-core 가 이미 캔버스에 남긴다
 * - `upload`: 같은 API 의 `/storage/uploads/<파일>` — 빼고 '내 업로드'에 등록할 수 있다
 * - `library`: 같은 API 의 `/storage/library/…` — 빼기만 한다(배경 라이브러리에서 다시 고를 수 있음)
 * - `unrecoverable`: 그 밖 전부(다른 저장소 경로·다른 origin·blob:·빈 값·파싱 불가) — 그 캔버스는 '내 배경 유지'로 강제
 */
export type BackgroundSrcClass = 'data' | 'upload' | 'library' | 'unrecoverable'

const STORAGE_PATH_RE = /^\/storage\/(uploads|library)\/(.+)$/

/** 디코드한 경로 조각에 상위 경로·구분자 위장이 있으면 true */
function hasUnsafeSegment(rest: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(rest)
  } catch {
    return true
  }
  if (decoded.includes('\\')) return true
  // 인코딩된 '/'·'\' 는 디코드 전 원문에서 본다(디코드 뒤에는 진짜 구분자와 구분할 수 없음)
  if (/%2f|%5c/i.test(rest)) return true
  return decoded.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
}

/**
 * API 기준 경로(`/storage/...`)를 돌려준다. 상대 경로면 그대로, 절대 URL 이면 origin 과 base 경로 접두가 정확히 같을 때만.
 * 그 밖은 null.
 */
function apiRelativePath(src: string, apiBase: string): string | null {
  const clean = src.split(/[?#]/)[0]
  if (clean.startsWith('/') && !clean.startsWith('//')) return clean
  let base: URL
  let url: URL
  try {
    base = new URL(apiBase)
    url = new URL(clean, base)
  } catch {
    return null
  }
  if (!/^https?:\/\//i.test(clean) && !clean.startsWith('//')) return null
  if (url.origin !== base.origin) return null
  const basePath = base.pathname.replace(/\/$/, '')
  // URL 파서는 '..' 를 접어 버리므로 원문 경로로 다시 본다
  const rawPath = clean.replace(/^(https?:)?\/\/[^/]+/i, '')
  if (!rawPath.startsWith(`${basePath}/`)) return null
  return rawPath.slice(basePath.length)
}

export function classifyBackgroundSrc(src: unknown, apiBase: string = getAssetBaseUrl()): BackgroundSrcClass {
  if (typeof src !== 'string' || src.trim().length === 0) return 'unrecoverable'
  if (/^data:/i.test(src)) return 'data'
  if (/^blob:/i.test(src)) return 'unrecoverable'
  const path = apiRelativePath(src, apiBase)
  if (!path) return 'unrecoverable'
  const m = STORAGE_PATH_RE.exec(path)
  if (!m) return 'unrecoverable'
  const [, kind, rest] = m
  if (hasUnsafeSegment(rest)) return 'unrecoverable'
  if (kind === 'uploads') return rest.includes('/') ? 'unrecoverable' : 'upload'
  return 'library'
}

/** '내 업로드' 항목에서 같은 원본인지 볼 키(AppImage 사용 배지와 같은 합산 규칙: getSrc + storagePhotoUrl) */
function uploadedKeys(item: unknown): string[] {
  const o = item as { getSrc?: () => string; storagePhotoUrl?: unknown }
  const keys: string[] = []
  try {
    const src = o.getSrc?.()
    if (typeof src === 'string' && src) keys.push(src)
  } catch {
    // getSrc 가 없는 객체는 storagePhotoUrl 만 본다
  }
  if (typeof o.storagePhotoUrl === 'string' && o.storagePhotoUrl) keys.push(o.storagePhotoUrl)
  return keys
}

export interface RegisterUploadsResult {
  /** 새로 등록한 URL(입력 순서) */
  added: string[]
  /** 이미 있거나 입력 안에서 겹쳐 건너뛴 수 */
  skipped: number
  /** 이미지 로드에 실패해 등록하지 않은 수 */
  failed: number
}

export interface RegisterUploadsDeps {
  loadImage?: (url: string) => Promise<unknown>
}

/**
 * URL 목록을 '내 업로드'에 등록한다. 중복(기존 항목의 getSrc·storagePhotoUrl, 입력 안의 중복)은 건너뛰고,
 * 로드에 실패한 URL 은 등록하지 않는다. 새 항목에는 `storagePhotoUrl = url` 을 붙인다.
 */
export async function registerUploadsFromUrls(
  urls: readonly string[],
  deps: RegisterUploadsDeps = {},
): Promise<RegisterUploadsResult> {
  const loadImage = deps.loadImage ?? ((url: string) => core.imageFromURL(url, { crossOrigin: 'anonymous' }))
  const seen = new Set<string>()
  for (const item of useImageStore.getState().uploaded) for (const k of uploadedKeys(item)) seen.add(k)
  const result: RegisterUploadsResult = { added: [], skipped: 0, failed: 0 }
  const fresh: unknown[] = []
  for (const url of urls) {
    if (typeof url !== 'string' || url.length === 0 || seen.has(url)) {
      result.skipped += 1
      continue
    }
    seen.add(url)
    try {
      const img = await loadImage(url)
      ;(img as { storagePhotoUrl?: string }).storagePhotoUrl = url
      fresh.push(img)
      result.added.push(url)
    } catch (e) {
      console.warn('[calendarSkinUploads] 내 업로드 등록 실패(이미지 로드):', e instanceof Error ? e.message : e)
      result.failed += 1
    }
  }
  if (fresh.length > 0) {
    useImageStore.setState((s) => ({ uploaded: [...s.uploaded, ...(fresh as typeof s.uploaded)] }))
  }
  return result
}

/**
 * 기록·판독 공용 정제 — 입력 순서 = 오래된 것부터. 같은 API 의 업로드 절대 URL 만 남기고(상대 경로는 API base 로 바꾼 뒤 판정),
 * 같은 URL 은 나중 것 하나만, 넘치면 앞(오래된 것)부터 뺀다. 남는 것이 없으면 빈 배열.
 */
export function normalizeSkinUploads(list: unknown, apiBase: string = getAssetBaseUrl()): string[] {
  if (!Array.isArray(list)) return []
  const base = apiBase.replace(/\/$/, '')
  const ordered: string[] = []
  for (const v of list) {
    if (typeof v !== 'string' || v.length === 0 || v.length > SKIN_UPLOAD_URL_MAX) continue
    const abs = v.startsWith('/') && !v.startsWith('//') ? `${base}${v}` : v
    if (abs.length > SKIN_UPLOAD_URL_MAX || !/^https?:\/\//i.test(abs)) continue
    if (classifyBackgroundSrc(abs, base) !== 'upload') continue
    const at = ordered.indexOf(abs)
    if (at >= 0) ordered.splice(at, 1)
    ordered.push(abs)
  }
  return ordered.slice(-SKIN_UPLOADS_MAX)
}

/**
 * 세션 메타 `calendar.skinUploads` 에 덧붙인다(기존 + 새 것, 정제). 캘린더 메타가 없으면(NULL 세트) 아무것도 하지 않는다.
 * @returns 기록한 목록(없으면 빈 배열)
 */
export function recordSkinUploads(urls: readonly string[]): string[] {
  const store = useCalendarStore.getState()
  const meta = store.meta
  if (!meta) return []
  const next = normalizeSkinUploads([...(meta.skinUploads ?? []), ...urls])
  store.setSkinUploads(next)
  return next
}

/**
 * 디자인 적용으로 캔버스에서 빠진 업로드 원본을 고객이 다시 쓸 수 있게 남긴다(적용 경로의 단일 진입점).
 * 입력은 `classifyBackgroundSrc === 'upload'` 인 URL 만 넣는다(호출자가 거른다).
 * 세션 메타 기록은 동기로 먼저 한다 — 적용 경로가 이어서 끝내는 자동저장 보류가 풀릴 때 그 값이 같이 저장된다.
 */
export async function keepSkinUploads(urls: readonly string[], deps: RegisterUploadsDeps = {}): Promise<RegisterUploadsResult> {
  // 상대 경로는 API 기준 절대 URL 로(이미지 로드·다시 열 때 같은 키가 되도록)
  const absolute = urls.map((u) => resolveAssetUrl(u) ?? u)
  recordSkinUploads(absolute)
  return registerUploadsFromUrls(absolute, deps)
}

/** 다시 연 세션의 `calendar.skinUploads` 를 '내 업로드'에 되살린다(실패는 경고만) */
export function restoreSkinUploads(urls: readonly string[] | undefined, deps: RegisterUploadsDeps = {}): Promise<RegisterUploadsResult> | null {
  if (!urls || urls.length === 0) return null
  return registerUploadsFromUrls(urls, deps).catch((e: unknown) => {
    console.warn('[calendarSkinUploads] 내 업로드 복원 실패:', e instanceof Error ? e.message : e)
    return { added: [], skipped: 0, failed: urls.length }
  })
}
