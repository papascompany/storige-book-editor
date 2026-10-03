import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import EditorHeader from './EditorHeader'
import { useAppStore } from '@/stores/useAppStore'
import { useToastStore } from '@/stores/useToastStore'
import { SAVE_FAILURE_MESSAGES } from '@/utils/embedFailurePolicy'
import type { FinishOutcome } from '@/utils/finishOutcome'

/**
 * 헤더 '편집완료' 안내 토스트 — onFinish 결과(FinishOutcome)에 따라 문구·종류를 고른다.
 * 실패는 분류별 고정 한국어 문구(호스트 SAVE_FAILED 문구와 같음).
 */

vi.mock('../Mockup3D/BookMockup3D', () => ({ BookMockup3D: () => null }))
vi.mock('./KeyboardShortcutsModal', () => ({ default: () => null }))
vi.mock('./CommandPaletteModal', () => ({ default: () => null }))
vi.mock('./HistoryPanel', () => ({ default: () => null }))
vi.mock('./AutoSaveIndicator', () => ({ AutoSaveIndicator: () => null }))
vi.mock('./RequiredEditConfirmModal', () => ({ default: () => null }))
vi.mock('@/hooks/useWorkSave', () => ({
  useWorkSave: () => ({ saveWork: vi.fn(), saveWorkForAdmin: vi.fn() }),
}))
vi.mock('@/hooks/useTemplateSetSave', () => ({
  useTemplateSetSave: () => ({ saving: false, saveTemplateSet: vi.fn() }),
}))
vi.mock('@/utils/requiredEditGate', () => ({ confirmRequiredEditsBeforeComplete: async () => true }))
vi.mock('@/utils/pageStepGuard', () => ({ getPageStepBlockMessage: () => null }))
vi.mock('@/stores/useAuthStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/useAuthStore')>()
  return { ...actual, useIsAdmin: () => false }
})

function toasts() {
  return useToastStore.getState().toasts.map(({ message, type }) => ({ message, type }))
}

async function clickFinish(onFinish: () => Promise<FinishOutcome | void>) {
  render(<EditorHeader onFinish={onFinish} orderContext />)
  const button = screen.getByRole('button', { name: '편집완료' })
  fireEvent.click(button)
  await waitFor(() => expect(useToastStore.getState().toasts.length).toBeGreaterThan(0))
  await waitFor(() => expect(button).not.toBeDisabled())
}

describe('EditorHeader 편집완료 안내 토스트', () => {
  beforeEach(() => {
    useToastStore.getState().clear()
    useAppStore.setState({ ready: true, canvas: {} } as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    useToastStore.getState().clear()
    useAppStore.setState({ ready: false, canvas: null } as never)
  })

  it('H1 비회원 완료면 저장 안내 info 토스트만 띄운다', async () => {
    await clickFinish(async () => 'needsAuth')
    expect(toasts()).toEqual([{ message: '작업이 저장되었습니다. 로그인하면 이어서 주문할 수 있어요.', type: 'info' }])
  })

  it('H2 결과값이 없으면 완료 success 토스트', async () => {
    await clickFinish(async () => undefined)
    expect(toasts()).toEqual([{ message: '편집이 완료되었습니다.', type: 'success' }])
  })

  it('H3 completed 면 완료 success 토스트', async () => {
    await clickFinish(async () => 'completed')
    expect(toasts()).toEqual([{ message: '편집이 완료되었습니다.', type: 'success' }])
  })

  it('H4 skipped 면 warning 안내만 띄운다', async () => {
    await clickFinish(async () => 'skipped')
    expect(toasts()).toEqual([
      { message: '편집 작업 정보가 없어 완료할 수 없습니다. 이전 화면으로 돌아가 다시 열어 주세요.', type: 'warning' },
    ])
  })

  it('H5 완료 실패는 분류별 고정 문구 error 토스트이고 로그는 요약 문자열이다', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cfg = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
    cfg.headers.set('Authorization', 'Bearer member-jwt-secret')
    const thrown = new AxiosError('Request failed with status code 503', 'ERR_BAD_RESPONSE', cfg, undefined, {
      status: 503,
      data: {},
      statusText: '',
      headers: {},
      config: cfg,
    })
    await clickFinish(async () => {
      throw thrown
    })
    expect(toasts()).toEqual([{ message: SAVE_FAILURE_MESSAGES.complete.server, type: 'error' }])
    expect(toasts()[0].message).not.toContain('Request failed')
    const line = errorSpy.mock.calls.find(([first]) => first === '디자인 저장 실패:')
    expect(typeof line?.[1]).toBe('string')
    expect(String(line?.[1])).not.toContain('member-jwt-secret')
  })

  it('H6 완료 요청 거절(413)은 용량 문구 error 토스트', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const cfg = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
    const thrown = new AxiosError('Request failed with status code 413', 'ERR_BAD_REQUEST', cfg, undefined, {
      status: 413,
      data: {},
      statusText: '',
      headers: {},
      config: cfg,
    })
    await clickFinish(async () => {
      throw thrown
    })
    expect(toasts()).toEqual([{ message: SAVE_FAILURE_MESSAGES.complete.tooLarge, type: 'error' }])
  })
})
