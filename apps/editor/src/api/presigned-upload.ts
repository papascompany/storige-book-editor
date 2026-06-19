/**
 * R2 presigned 직결 업로드 클라이언트 (2026-06-19).
 *
 * 대용량 PDF(>50MB)를 호스트 프록시/API multer(50MB)를 우회해 브라우저 → R2 직결 PUT
 * 으로 업로드한다. presign 발급/complete 만 `apiClient`(직결 base) 경유, 실제 PUT 은
 * 순수 XHR(progress 이벤트 + 인증헤더/JSON 변환 없음).
 *
 * 서버가 driver !== 's3' 이면 presigned 엔드포인트가 503 STORAGE_NOT_S3 → 호출부가
 * PresignedNotConfiguredError 로 폴백 분기한다.
 *
 * ⚠️ R2 버킷 CORS 에 ExposeHeaders: ETag 필요(멀티파트 파트 etag 수집). 미설정 시
 *    rawPut 의 getResponseHeader('ETag') 가 null → 멀티파트 실패.
 */
import { apiClient } from './client'

const SINGLE_PART_THRESHOLD = 80 * 1024 * 1024 // 80MB 이하=single, 초과=multipart
const PART_SIZE = 16 * 1024 * 1024 // 16MB/part (R2 min 5MB, 마지막 제외)

export class PresignedNotConfiguredError extends Error {
  code = 'STORAGE_NOT_S3' as const
}

interface UploadOpts {
  isPublic?: boolean
  type?: 'cover' | 'content' | 'template' | 'other'
  orderSeqno?: number
  memberSeqno?: number
  onProgress?: (pct: number) => void
}

/** R2 직결 PUT — XHR 로 progress, 인증헤더/JSON 변환 없음. etag 반환(멀티파트용). */
function rawPut(
  url: string,
  body: Blob,
  contentType: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url, true)
    xhr.setRequestHeader('Content-Type', contentType) // 서명 contentType 바인딩 일치 필수
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // R2 가 ETag 헤더를 노출하도록 버킷 CORS 에 ExposeHeaders: ETag 필요(인프라 메모 참조)
        resolve(xhr.getResponseHeader('ETag'))
      } else {
        reject(new Error(`R2 PUT 실패 (${xhr.status})`))
      }
    }
    xhr.onerror = () => reject(new Error('R2 PUT 네트워크 오류'))
    xhr.send(body)
  })
}

/** 503 STORAGE_NOT_S3 식별 → 호출부가 폴백 분기. */
function asNotConfigured(err: any): never {
  const code = err?.response?.data?.code ?? err?.response?.status
  if (code === 'STORAGE_NOT_S3' || err?.response?.status === 503) {
    throw new PresignedNotConfiguredError('presigned 미구성(503)')
  }
  throw err
}

export async function uploadViaPresigned(
  file: File,
  opts: UploadOpts = {},
): Promise<{ fileId: string }> {
  const base = apiClient.getDirectBaseUrl()
  const pubSuffix = opts.isPublic ? '-public' : ''
  const body = {
    type: opts.type ?? 'content',
    expectedSize: file.size,
    originalName: file.name,
    orderSeqno: opts.orderSeqno,
    memberSeqno: opts.memberSeqno,
  }

  if (file.size <= SINGLE_PART_THRESHOLD) {
    // ── single-part ──
    let init
    try {
      init = await apiClient.post<{ fileId: string; uploadUrl: string; uploadToken: string }>(
        `/files/presigned-upload${pubSuffix}`,
        body,
        { baseURL: base },
      )
    } catch (e) {
      asNotConfigured(e)
    }
    const { fileId, uploadUrl, uploadToken } = init!.data
    await rawPut(uploadUrl, file, 'application/pdf', (l, t) =>
      opts.onProgress?.(Math.round((l / t) * 100)),
    )
    // uploadToken 동봉 — 발급받은 클라만 complete 가능(IDOR 차단).
    await apiClient.post(`/files/${fileId}/complete`, { uploadToken }, { baseURL: base })
    return { fileId }
  }

  // ── multipart ──
  let init
  try {
    init = await apiClient.post<{ fileId: string; uploadId: string; uploadToken: string }>(
      `/files/multipart/init`,
      body,
      { baseURL: base },
    )
  } catch (e) {
    asNotConfigured(e)
  }
  const { fileId, uploadToken } = init!.data
  const totalParts = Math.ceil(file.size / PART_SIZE)
  const parts: { partNumber: number; etag: string }[] = []
  let uploadedBytes = 0
  try {
    for (let i = 0; i < totalParts; i++) {
      const partNumber = i + 1
      const chunk = file.slice(i * PART_SIZE, Math.min((i + 1) * PART_SIZE, file.size))
      // uploadToken 동봉 — 발급받은 클라만 파트 서명 가능(IDOR/파트주입 차단).
      const sign = await apiClient.post<{ url: string }>(
        `/files/multipart/sign`,
        { fileId, partNumber, uploadToken },
        { baseURL: base },
      )
      const etag = await rawPut(sign.data.url, chunk, 'application/pdf', (l) => {
        const done = uploadedBytes + l
        opts.onProgress?.(Math.round((done / file.size) * 100))
      })
      uploadedBytes += chunk.size
      if (!etag) throw new Error('파트 ETag 누락(R2 CORS ExposeHeaders 확인)')
      parts.push({ partNumber, etag })
    }
    const done = await apiClient.post<{ id: string }>(
      `/files/multipart/complete`,
      { fileId, parts, uploadToken },
      { baseURL: base },
    )
    return { fileId: done.data.id ?? fileId }
  } catch (err) {
    // 실패 시 R2 멀티파트 abort(best-effort) — 고아 파트 정리. uploadToken 동봉.
    try {
      await apiClient.post(`/files/multipart/abort`, { fileId, uploadToken }, { baseURL: base })
    } catch {
      /* noop */
    }
    throw err
  }
}
