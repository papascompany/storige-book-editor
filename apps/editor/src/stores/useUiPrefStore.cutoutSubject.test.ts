// useUiPrefStore 배경제거 피사체 선택 (2026-08-06, D-12b 3차 후속)
//
//  ① 기본값 'person' — 서버 기본 모델(u2net_human_seg)과 같은 쪽에서 시작해야
//     UI 표시와 실제 추론 결과가 어긋나지 않는다.
//  ② setter 동작 + 다른 pref 불변
//  ③ persist v8→9 마이그레이션: 기존 사용자(키 부재)도 'person' 으로 채워진다
//     (얕은 병합이라 미이관 시 undefined → UI 가 아무 것도 선택되지 않은 상태로 보인다)
//  ④ 선택지 → 서버 모델 매핑이 서버 화이트리스트와 어긋나지 않는다
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CUTOUT_SUBJECT_MODELS } from '@/api/cutout'

describe('useUiPrefStore — 배경제거 피사체', () => {
  beforeEach(() => localStorage.clear())

  it('① 기본값은 person (서버 기본 모델과 같은 쪽)', async () => {
    vi.resetModules()
    const { useUiPrefStore } = await import('./useUiPrefStore')
    expect(useUiPrefStore.getState().cutoutSubject).toBe('person')
  })

  it('② setter 로 general 전환, 다른 pref 는 불변', async () => {
    vi.resetModules()
    const { useUiPrefStore } = await import('./useUiPrefStore')
    const before = useUiPrefStore.getState().showRuler

    useUiPrefStore.getState().setCutoutSubject('general')

    expect(useUiPrefStore.getState().cutoutSubject).toBe('general')
    expect(useUiPrefStore.getState().showRuler).toBe(before)
  })

  it('③ v8 사용자(키 부재)는 person 으로 채워지고 기존 값은 보존된다', async () => {
    localStorage.setItem(
      'storige-ui-pref',
      JSON.stringify({ state: { showRuler: true, theme: 'dark' }, version: 8 })
    )
    vi.resetModules()
    const { useUiPrefStore } = await import('./useUiPrefStore')
    const s = useUiPrefStore.getState()

    expect(s.cutoutSubject).toBe('person')
    expect(s.showRuler).toBe(true)
    expect(s.theme).toBe('dark')
  })
})

describe('피사체 → 서버 모델 매핑', () => {
  it('④ 두 선택지 모두 서버 화이트리스트에 있는 키로 매핑된다', () => {
    // apps/api WorkerJobsService.CUTOUT_ALLOWED_MODELS 와 동기화된 값이어야 한다.
    // (여기가 어긋나면 잡 생성이 400 CUTOUT_MODEL_NOT_ALLOWED 로 떨어진다)
    expect(CUTOUT_SUBJECT_MODELS.person).toBe('u2net_human_seg')
    expect(CUTOUT_SUBJECT_MODELS.general).toBe('isnet-general-use')
    // `*_custom` 은 CVE-2026-40086 경로 순회 벡터라 UI 선택지에 절대 들어오면 안 된다.
    for (const model of Object.values(CUTOUT_SUBJECT_MODELS)) {
      expect(model.toLowerCase()).not.toContain('_custom')
    }
  })
})
