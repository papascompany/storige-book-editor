import { describe, it, expect, vi } from 'vitest'

const client = vi.hoisted(() => ({ patch: vi.fn() }))
vi.mock('./client', () => ({
  apiClient: { patch: (...a: unknown[]) => client.patch(...(a as [])) },
}))

import { COMPLETE_TIMEOUT_MS, editSessionsApi } from './edit-sessions'

describe('editSessionsApi.complete — 편집 완료 요청', () => {
  it('PATCH /edit-sessions/<id>/complete 를 90초 timeout 으로 보낸다(서버 CMYK 변환 대기 50초보다 길게)', async () => {
    client.patch.mockResolvedValue({ data: { id: 'sess-1', status: 'complete' } })

    await expect(editSessionsApi.complete('sess-1')).resolves.toEqual({ id: 'sess-1', status: 'complete' })

    expect(COMPLETE_TIMEOUT_MS).toBe(90_000)
    expect(client.patch).toHaveBeenCalledWith('/edit-sessions/sess-1/complete', {}, { timeout: 90_000 })
  })
})
