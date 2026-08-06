import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * 컷아웃(배경제거) 서버 오프로드 클라이언트 회귀 잠금 — S-P2A-B 샤드3.
 *
 * 잠그는 불변식:
 *  - 업로드는 `/storage/upload-public` 으로, **직결 base**(임베드 호스트 프록시 우회)로 간다.
 *  - 잡 생성 본문은 fileId(+model) 뿐 — 픽셀 캡 같은 파라미터는 서버 권위다.
 *  - 폴링은 completed/failed 를 구분하고, 실패는 **서버가 준 사용자 문구**를 그대로 쓴다.
 *  - 기능 플래그 off(404 NOT_FOUND)와 파일 없음(404 FILE_NOT_FOUND)은 다른 코드로 분류된다.
 */

const post = vi.fn()
const get = vi.fn()
const getDirectBaseUrl = vi.fn(() => 'https://api.example.com/api')

vi.mock('./client', () => ({
  apiClient: {
    post: (...args: unknown[]) => post(...args),
    get: (...args: unknown[]) => get(...args),
    getDirectBaseUrl: () => getDirectBaseUrl(),
  },
}))

import {
  CutoutError,
  createCutoutJob,
  fetchCutoutStatus,
  pollCutoutJob,
  resolveCutoutUrl,
  uploadCutoutSource,
} from './cutout'

/** axios 스타일 에러(응답 본문 포함) */
const httpError = (status: number, data: unknown) =>
  Object.assign(new Error('request failed'), { response: { status, data } })

beforeEach(() => {
  post.mockReset()
  get.mockReset()
  getDirectBaseUrl.mockReturnValue('https://api.example.com/api')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('resolveCutoutUrl', () => {
  it('상대 /storage 경로를 API origin 기준 절대 URL 로 바꾼다 (/api 접미사 제거)', () => {
    expect(resolveCutoutUrl('/storage/cutouts/job-1/out.png')).toBe(
      'https://api.example.com/storage/cutouts/job-1/out.png',
    )
  })

  it('이미 절대 URL 이면 그대로 둔다', () => {
    const abs = 'https://cdn.example.com/x.png'
    expect(resolveCutoutUrl(abs)).toBe(abs)
  })
})

describe('uploadCutoutSource', () => {
  it('게스트 통로(/storage/upload-public)로, 직결 base 로 올리고 files.id 를 돌려준다', async () => {
    post.mockResolvedValueOnce({ data: { id: 'file-1', url: '/storage/uploads/a.png' } })

    const id = await uploadCutoutSource(new Blob(['x']), 'cutout-source.png')

    expect(id).toBe('file-1')
    const [url, body, config] = post.mock.calls[0] as [string, FormData, { baseURL?: string }]
    expect(url).toBe('/storage/upload-public?category=uploads')
    expect(body).toBeInstanceOf(FormData)
    // 임베드 호스트가 base 를 자사 프록시로 덮어써도 업로드는 Storige API 원본으로 간다(413 전례).
    expect(config.baseURL).toBe('https://api.example.com/api')
  })

  it('응답에 id 가 없으면 조용히 넘어가지 않는다', async () => {
    post.mockResolvedValueOnce({ data: { url: '/storage/uploads/a.png' } })
    await expect(uploadCutoutSource(new Blob(['x']), 'a.png')).rejects.toThrow(CutoutError)
  })
})

describe('createCutoutJob', () => {
  it('model 미지정이면 fileId 만 보낸다 — 기본 모델은 서버 env(u2net)가 정한다', async () => {
    post.mockResolvedValueOnce({ data: { id: 'job-1', status: 'pending' } })

    const jobId = await createCutoutJob('file-1')

    expect(jobId).toBe('job-1')
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>]
    expect(url).toBe('/worker-jobs/cutout')
    expect(body).toEqual({ fileId: 'file-1' })
  })

  it('model 을 명시하면 함께 보낸다', async () => {
    post.mockResolvedValueOnce({ data: { id: 'job-2', status: 'pending' } })
    await createCutoutJob('file-1', 'u2net')
    expect(post.mock.calls[0][1]).toEqual({ fileId: 'file-1', model: 'u2net' })
  })

  it('기능 플래그 off(404 NOT_FOUND)는 파일 없음과 구분해 분류한다', async () => {
    post.mockRejectedValueOnce(httpError(404, { code: 'NOT_FOUND', message: 'Cannot resolve route' }))
    await expect(createCutoutJob('file-1')).rejects.toMatchObject({ code: 'CUTOUT_DISABLED' })
  })

  it('파일 없음(404 FILE_NOT_FOUND)은 서버 문구를 유지한다', async () => {
    post.mockRejectedValueOnce(
      httpError(404, { code: 'FILE_NOT_FOUND', message: '파일을 찾을 수 없습니다.' }),
    )
    await expect(createCutoutJob('file-1')).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND',
      message: '파일을 찾을 수 없습니다.',
    })
  })

  it('무인증 컴퓨트 throttle(429)은 재시도 안내 문구로 바꾼다', async () => {
    post.mockRejectedValueOnce(httpError(429, {}))
    await expect(createCutoutJob('file-1')).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })

  it('CVE 가드(400 CUTOUT_MODEL_FORBIDDEN)도 코드로 식별된다', async () => {
    post.mockRejectedValueOnce(httpError(400, { code: 'CUTOUT_MODEL_FORBIDDEN' }))
    await expect(createCutoutJob('file-1', 'u2net_custom')).rejects.toMatchObject({
      code: 'CUTOUT_MODEL_FORBIDDEN',
    })
  })
})

describe('fetchCutoutStatus', () => {
  it('전용 폴링 라우트를 친다 — 기존 GET /worker-jobs/:id 는 게스트 401 이라 쓸 수 없다', async () => {
    get.mockResolvedValueOnce({ data: { id: 'job-1', status: 'pending', result: null } })
    await fetchCutoutStatus('job-1')
    expect(get.mock.calls[0][0]).toBe('/worker-jobs/job-1/cutout-status')
  })
})

describe('pollCutoutJob', () => {
  const completed = {
    data: {
      id: 'job-1',
      status: 'completed',
      result: {
        cutoutUrl: '/storage/cutouts/job-1/out.png',
        inputWidth: 2560,
        inputHeight: 1707,
        sourceWidth: 6000,
        sourceHeight: 4000,
        capEngaged: true,
        model: 'u2net',
        processedAt: '2026-08-06T02:00:00.000Z',
      },
      errorCode: null,
      errorMessage: null,
      completedAt: '2026-08-06T02:00:00.000Z',
    },
  }

  it('pending 을 지나 completed 가 되면 결과를 돌려준다', async () => {
    get
      .mockResolvedValueOnce({ data: { id: 'job-1', status: 'pending', result: null } })
      .mockResolvedValueOnce({ data: { id: 'job-1', status: 'processing', result: null } })
      .mockResolvedValueOnce(completed)

    const result = await pollCutoutJob('job-1', { intervalMs: 0 })

    expect(result.cutoutUrl).toBe('/storage/cutouts/job-1/out.png')
    expect(result.model).toBe('u2net')
    expect(get).toHaveBeenCalledTimes(3)
  })

  it('failed 는 서버가 만든 사용자 문구·errorCode 를 그대로 전달한다', async () => {
    get.mockResolvedValueOnce({
      data: {
        id: 'job-1',
        status: 'failed',
        result: null,
        errorCode: 'CUTOUT_INPUT_TOO_LARGE',
        errorMessage: '이미지가 너무 커서 배경을 제거할 수 없습니다. 더 작은 이미지로 다시 시도해 주세요.',
        completedAt: null,
      },
    })

    await expect(pollCutoutJob('job-1', { intervalMs: 0 })).rejects.toMatchObject({
      code: 'CUTOUT_INPUT_TOO_LARGE',
    })
  })

  it('completed 인데 결과 URL 이 없으면 성공으로 위장하지 않는다', async () => {
    get.mockResolvedValueOnce({
      data: { id: 'job-1', status: 'completed', result: null, errorCode: null, errorMessage: null },
    })
    await expect(pollCutoutJob('job-1', { intervalMs: 0 })).rejects.toMatchObject({
      code: 'CUTOUT_NO_RESULT',
    })
  })

  it('상한을 넘기면 무한 폴링하지 않고 타임아웃으로 끝낸다', async () => {
    get.mockResolvedValue({ data: { id: 'job-1', status: 'pending', result: null } })
    await expect(
      pollCutoutJob('job-1', { intervalMs: 0, timeoutMs: -1 }),
    ).rejects.toMatchObject({ code: 'CUTOUT_TIMEOUT' })
  })

  it('abort 신호가 서면 즉시 중단한다', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      pollCutoutJob('job-1', { intervalMs: 0, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'CUTOUT_ABORTED' })
    expect(get).not.toHaveBeenCalled()
  })
})
