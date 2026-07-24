import { useEffect } from 'react'
import { useUiPrefStore } from '@/stores/useUiPrefStore'
import { useAppStore } from '@/stores/useAppStore'

/**
 * §6-3: 스냅 설정(useUiPrefStore) → canvas-core 플러그인 setter 배선.
 *
 * showRuler→ruler 배선이 EditorView 전용이라, 스냅 토글도 뷰마다 배선하지 않으면 /embed 등에서
 * 팝오버가 무반응이 된다(적대 리뷰 함정 a). 이 공유 훅을 EditorView·EmbeddedEditor·
 * TemplateEditorView 가 모두 호출한다.
 *
 * - allEditors 전체에 적용(스프레드/커버의 다중 에디터·페이지 누락 방지, 함정 c). allEditors 변화
 *   (페이지 추가)에도 재적용되도록 의존성에 포함.
 * - **중앙 스냅 토글은 RulerPlugin.setCenterSnapEnabled 와 SmartGuides.setCenterYieldEnabled 를
 *   함께 제어** — 중앙스냅 OFF 시 SmartGuides 가 중앙축을 룰러에 양보하던 것을 해제해, 중앙 근처가
 *   아무 스냅도 안 되는 데드존을 없앤다(적대 리뷰 함정 b).
 * - setter 는 순수 거동 게이트(early-return)라 직렬화·이벤트 바인딩·생성 순서 계약 무영향.
 */
// 킬스위치: off 면 팝오버 UI 숨김(EditorHeader)뿐 아니라 이 배선도 강제 기본값(상시-ON)으로
// 주입해 persist 된 OFF 상태를 무시한다 — 그래야 플래그가 거동까지 실제로 롤백한다(적대 리뷰).
const SNAP_SETTINGS_ENABLED = import.meta.env.VITE_ENABLE_SNAP_SETTINGS !== 'false'

export function useSnapSettingsSync(ready: boolean): void {
  const persistedGuides = useUiPrefStore((s) => s.snapGuidesEnabled)
  const persistedCenter = useUiPrefStore((s) => s.snapCenterEnabled)
  const persistedAngle = useUiPrefStore((s) => s.snapAngleEnabled)
  const allEditors = useAppStore((s) => s.allEditors)

  // 플래그 off → 기능 롤백: persist 무시하고 전부 ON(플러그인 생성 기본값과 동일).
  const snapGuidesEnabled = SNAP_SETTINGS_ENABLED ? persistedGuides : true
  const snapCenterEnabled = SNAP_SETTINGS_ENABLED ? persistedCenter : true
  const snapAngleEnabled = SNAP_SETTINGS_ENABLED ? persistedAngle : true

  useEffect(() => {
    if (!ready) return
    allEditors.forEach((editor) => {
      const ed = editor as unknown as {
        getPlugin?: (name: string) => unknown
      }
      const sg = ed.getPlugin?.('SmartGuidesPlugin') as
        | {
            setObjectSnapEnabled?: (v: boolean) => void
            setAngleSnapEnabled?: (v: boolean) => void
            setCenterYieldEnabled?: (v: boolean) => void
          }
        | undefined
      sg?.setObjectSnapEnabled?.(snapGuidesEnabled)
      sg?.setAngleSnapEnabled?.(snapAngleEnabled)
      sg?.setCenterYieldEnabled?.(snapCenterEnabled)

      const ruler = ed.getPlugin?.('RulerPlugin') as
        | { setCenterSnapEnabled?: (v: boolean) => void }
        | undefined
      ruler?.setCenterSnapEnabled?.(snapCenterEnabled)
    })
  }, [ready, snapGuidesEnabled, snapCenterEnabled, snapAngleEnabled, allEditors])
}
