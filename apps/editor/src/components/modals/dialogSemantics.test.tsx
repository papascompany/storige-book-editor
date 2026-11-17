// @vitest-environment happy-dom
//
// 화면에 쓰이는 대화상자(템플릿 교체 확인 · 저장된 작업 불러오기 · 내지 PDF 첨부)가
// 보조 기술에 대화상자로 드러나고, 제목으로 이름이 붙고, Esc 로 닫히는지 고정한다.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

const getMySessions = vi.fn(async () => ({ sessions: [] }))
vi.mock('@/api', () => ({
  editSessionsApi: { getMySessions: () => getMySessions() },
}))
vi.mock('../../api/client', () => ({
  apiClient: { post: vi.fn(), get: vi.fn(), getDirectBaseUrl: () => 'https://api.example.com' },
  toUserMessage: (_e: unknown, fallback: string) => fallback,
}))
vi.mock('../../api/edit-sessions', () => ({
  editSessionsApi: { update: vi.fn(), updateGuest: vi.fn() },
}))

import { TemplateReplaceModal } from '../TemplatePanel/TemplateReplaceModal'
import { WorkspaceModal } from './WorkspaceModal'
import { ContentPdfAttachModal } from '../editor/ContentPdfAttachModal'

const pressEscape = () => fireEvent.keyDown(document, { key: 'Escape' })

afterEach(() => cleanup())

describe('TemplateReplaceModal', () => {
  it('제목으로 이름 붙은 대화상자로 드러나고 닫기 버튼에 이름이 있다', () => {
    render(<TemplateReplaceModal isOpen mode="template" templateName="A" onConfirm={() => {}} onCancel={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: '템플릿 교체' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByRole('button', { name: '닫기' })).toBeTruthy()
  })

  it('Esc 는 취소로 처리한다', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(<TemplateReplaceModal isOpen mode="template" templateName="A" onConfirm={onConfirm} onCancel={onCancel} />)
    pressEscape()
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('교체가 진행 중이거나 닫혀 있으면 Esc 에 반응하지 않는다', () => {
    const onCancel = vi.fn()
    const { rerender } = render(
      <TemplateReplaceModal isOpen isReplacing mode="template" templateName="A" onConfirm={() => {}} onCancel={onCancel} />,
    )
    pressEscape()
    rerender(<TemplateReplaceModal isOpen={false} mode="template" templateName="A" onConfirm={() => {}} onCancel={onCancel} />)
    pressEscape()
    expect(onCancel).not.toHaveBeenCalled()
  })
})

describe('WorkspaceModal', () => {
  it('제목으로 이름 붙은 대화상자로 드러나고 Esc 로 닫힌다', async () => {
    const onClose = vi.fn()
    await act(async () => {
      render(<WorkspaceModal isOpen onLoad={() => {}} onClose={onClose} />)
    })
    const dialog = screen.getByRole('dialog', { name: '저장된 작업 불러오기' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByRole('button', { name: '닫기' })).toBeTruthy()
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('닫혀 있으면 Esc 에 반응하지 않는다', () => {
    const onClose = vi.fn()
    render(<WorkspaceModal isOpen={false} onLoad={() => {}} onClose={onClose} />)
    pressEscape()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('ContentPdfAttachModal', () => {
  it('제목으로 이름 붙은 대화상자로 드러난다', () => {
    render(
      <ContentPdfAttachModal
        open
        sessionId="sess-1"
        currentContentPageCount={8}
        canAddPage
        templateSetId="ts-1"
        onClose={() => {}}
        onAttached={() => {}}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: '내지 PDF 첨부' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })
})
