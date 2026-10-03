import { describe, it, expect } from 'vitest'
import { finishToastFor } from './finishOutcome'

describe('finishToastFor', () => {
  it.each([
    ['completed', { message: '편집이 완료되었습니다.', type: 'success' }],
    [undefined, { message: '편집이 완료되었습니다.', type: 'success' }],
    ['needsAuth', { message: '작업이 저장되었습니다. 로그인하면 이어서 주문할 수 있어요.', type: 'info' }],
    [
      'skipped',
      { message: '편집 작업 정보가 없어 완료할 수 없습니다. 이전 화면으로 돌아가 다시 열어 주세요.', type: 'warning' },
    ],
  ] as const)('%s → 안내 토스트', (outcome, expected) => {
    expect(finishToastFor(outcome)).toEqual(expected)
  })
})
