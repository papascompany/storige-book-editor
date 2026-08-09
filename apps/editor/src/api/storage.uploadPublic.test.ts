import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 게스트 업로드 통로 회귀 잠금 (2026-08-09).
 *
 * 잠그는 불변식:
 *  - 고객(비로그인) 이미지 업로드는 `/storage/upload-public` 으로 간다.
 *    `/storage/upload` 는 ADMIN/MANAGER 전용이라 게스트에게 **401** 이다.
 *  - 임베드 호스트 프록시를 우회해 **직결 base** 로 올린다(본문 한도 413 전례).
 *  - 응답은 컨트롤러 반환값 그대로의 **평면 객체**다 — API 에 전역 응답 래핑
 *    인터셉터가 없으므로 `{ success, data }` 를 가정하면 안 된다.
 */

const post = vi.fn()
const getDirectBaseUrl = vi.fn(() => 'https://api.example.com/api')

vi.mock('./client', () => ({
  apiClient: {
    post: (...args: unknown[]) => post(...args),
    getDirectBaseUrl: () => getDirectBaseUrl(),
  },
}))

vi.mock('./presigned-upload', () => ({
  uploadViaPresigned: vi.fn(),
  PresignedNotConfiguredError: class extends Error {},
}))

import { storageApi } from './storage'

beforeEach(() => {
  post.mockReset()
  getDirectBaseUrl.mockReturnValue('https://api.example.com/api')
})

describe('storageApi.uploadFilePublic', () => {
  it('게스트 통로(/storage/upload-public)로, 직결 base 로 올린다', async () => {
    post.mockResolvedValueOnce({ data: { id: 'db-record-id', url: '/storage/uploads/a.png' } })

    await storageApi.uploadFilePublic(new File(['x'], 'a.png', { type: 'image/png' }))

    const [url, body, config] = post.mock.calls[0] as [
      string,
      FormData,
      { baseURL?: string; headers?: Record<string, string> },
    ]
    // ⚠️ '/storage/upload' 로 되돌리면 게스트 401 재발.
    expect(url).toBe('/storage/upload-public?category=uploads')
    expect(body).toBeInstanceOf(FormData)
    expect(config.baseURL).toBe('https://api.example.com/api')
    expect(config.headers?.['Content-Type']).toBe('multipart/form-data')
  })

  it('평면 응답을 그대로 돌려준다 — { success, data } 래핑을 가정하지 않는다', async () => {
    post.mockResolvedValueOnce({ data: { id: 'db-record-id', url: '/storage/uploads/a.png' } })

    const res = await storageApi.uploadFilePublic(new File(['x'], 'a.png', { type: 'image/png' }))

    // id 는 물리 파일명이 아니라 files 레코드 id (validate/fix-bleed 의 findById 정합).
    expect(res.id).toBe('db-record-id')
    expect(res.url).toBe('/storage/uploads/a.png')
  })

  // 서버는 originalname 으로 fileType/MIME 을 판정한다(storage.controller uploadFilePublic).
  // 이름 없이 보내면 files 레코드가 'blob' 으로 등록된다.
  // ⚠️ append 의 filename 인자는 jsdom 이 반영하지 않아 FormData 를 되읽어서는 확인할 수 없다 —
  //    호출 자체를 본다.
  it('Blob 은 명시 filename 을, File 은 자기 name 을 파트 이름으로 붙인다', async () => {
    const append = vi.spyOn(FormData.prototype, 'append')
    post.mockResolvedValue({ data: { id: 'id-1', url: '/storage/uploads/b.png' } })

    await storageApi.uploadFilePublic(new Blob(['x'], { type: 'image/png' }), 'b.png')
    expect(append).toHaveBeenLastCalledWith('file', expect.anything(), 'b.png')

    await storageApi.uploadFilePublic(new File(['x'], 'photo.jpg', { type: 'image/jpeg' }))
    expect(append).toHaveBeenLastCalledWith('file', expect.anything(), 'photo.jpg')

    append.mockRestore()
  })
})
