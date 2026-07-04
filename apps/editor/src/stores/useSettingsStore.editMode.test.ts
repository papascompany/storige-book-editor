import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore } from './useSettingsStore'

/**
 * B0-① (2026-07-04): empty 프리셋 editMode:true 스프레드 오염 회귀 테스트.
 * 고객 embed 는 loadTemplateSetEditor → setupEmptyEditor 를 경유하므로,
 * setupEmptyEditor 가 명시 인자 없이 editMode 를 켜면 고객에게 관리자 토글이
 * 노출되고 applyObjectPermissions 가 무력화된다(e326b4c 이래의 오염).
 */
describe('setupEmptyEditor editMode isolation (B0-①)', () => {
  beforeEach(async () => {
    // 이전 테스트 잔류 상태 제거 — 명시적으로 false 로 되돌린 뒤 시작
    await useSettingsStore.getState().updateSettings({ editMode: false })
  })

  it('defaults editMode to false (preset true must NOT leak)', async () => {
    await useSettingsStore.getState().setupEmptyEditor({
      name: '고객 embed 세션',
      size: { width: 100, height: 100, cutSize: 5, safeSize: 5 },
      unit: 'mm',
    })
    expect(useSettingsStore.getState().currentSettings.editMode).toBe(false)
  })

  it('resets a polluted editMode=true back to false on customer load', async () => {
    // 관리자 세션 등으로 store 에 editMode=true 가 남아 있어도
    await useSettingsStore.getState().updateSettings({ editMode: true })
    await useSettingsStore.getState().setupEmptyEditor({
      name: '고객 embed 세션',
      size: { width: 100, height: 100 },
      unit: 'mm',
    })
    expect(useSettingsStore.getState().currentSettings.editMode).toBe(false)
  })

  it('honors an explicit editMode:true request (admin caller)', async () => {
    await useSettingsStore.getState().setupEmptyEditor({
      name: '관리자 템플릿 제작',
      editMode: true,
    })
    expect(useSettingsStore.getState().currentSettings.editMode).toBe(true)
  })
})
