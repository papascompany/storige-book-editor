import { useEffect } from 'react'
import { fabric } from 'fabric'
import { type RulerPlugin } from '@storige/canvas-core'
import { useAppStore } from '@/stores/useAppStore'
import { useUiPrefStore, resolveTheme } from '@/stores/useUiPrefStore'
import { getDefaultControls } from '@/stores/useSettingsStore'

// 모바일/터치 환경 감지 (iOS Safari 메모리 한계 회피용 — 모바일은 객체 set 스킵)
function isTouchEnv(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  try { return window.matchMedia('(pointer: coarse)').matches } catch { return false }
}
const TOUCH_ENV = isTouchEnv()

// 시스템 객체 식별 패턴 (EmptyCanvasHint와 동일 정책 + SpreadPlugin 가이드)
const SYSTEM_IDS = new Set(['workspace', 'cut-border', 'safe-zone-border', 'template-background'])
const SYSTEM_EXTENSION_TYPES = new Set([
  'guideline',
  'background',
  'overlay',
  'outline',
  'moldIcon',
  'clipping',
])

function isSystemObject(obj: any): boolean {
  if (!obj) return true
  if (obj.meta?.system) return true
  if (obj.excludeFromExport) return true
  if (typeof obj.id === 'string') {
    if (SYSTEM_IDS.has(obj.id)) return true
    if (obj.id.startsWith('center-guideline-')) return true
    if (obj.id.startsWith('spread-guide-')) return true
  }
  if (obj.extensionType && SYSTEM_EXTENSION_TYPES.has(obj.extensionType)) return true
  if (obj.type === 'GuideLine') return true
  return false
}

/**
 * 캔버스 측 다크 모드 동기화 (editor_layout_custom.md §8.3 다크 모드 Phase 3).
 *
 * `useThemeSync()`가 <html data-theme>를 갱신하면 CSS 토큰은 자동 반영되지만
 * 캔버스 내부의 fabric 객체(룰러·선택 핸들)는 fabric의 자체 색상 옵션을 사용한다.
 * 이 hook이 테마 변경을 구독해서 모든 캔버스의 RulerPlugin과 활성 객체 controls를
 * light/dark 셋으로 갱신한다.
 *
 * - 룰러: `RulerPlugin.setTheme(theme)` (canvas-core API)
 * - 선택 핸들: 모든 사용자 fabric 객체의 borderColor/cornerColor/cornerStrokeColor 일괄 적용
 * - 시스템 객체(workspace/cut-border/safe-zone-border/guideline 등)는 skip
 *
 * 워크스페이스 흰 페이지 배경은 인쇄용지로서 다크에서도 흰색을 유지(가이드라인).
 */
export function useCanvasThemeSync(ready: boolean): void {
  const theme = useUiPrefStore((s) => s.theme)

  useEffect(() => {
    if (!ready) return
    const apply = () => {
      const mode = resolveTheme(theme)
      const editors = useAppStore.getState().allEditors
      const canvases = useAppStore.getState().allCanvas

      // 1. 룰러 테마 적용
      editors.forEach((ed) => {
        const ruler = ed?.getPlugin<RulerPlugin>('RulerPlugin')
        ruler?.setTheme?.(mode)
      })

      // 2. 객체 선택 핸들 색상 적용 (사용자 객체에만)
      // 모바일 가드: TOUCH_ENV에서는 모든 객체 순회 + obj.set + requestRenderAll이
      // iOS Safari 메모리 한계(~384MB) 위협 가능. 모바일은 fabric default 핸들로
      // 충분 — 다크 모드 핸들 색상은 desktop 전용으로 한정.
      if (TOUCH_ENV) return
      const controls = getDefaultControls(mode)

      // 2-A. fabric.Object.prototype + 특수 prototype 기본값 갱신
      // (기존엔 시작 시점의 light theme 색상이 prototype에 박혀있어 테마 전환 후
      // 추가된 객체는 hover/selection 색상이 light로 남아있는 버그 수정)
      // P2-13: ActiveSelection (다중 선택 그룹) + IText caret color 동기화 추가
      try {
        ;(fabric.Object.prototype as any).borderColor = controls.borderColor
        ;(fabric.Object.prototype as any).cornerColor = controls.cornerColor
        ;(fabric.Object.prototype as any).cornerStrokeColor = controls.cornerStrokeColor

        // ActiveSelection: 다중 선택 시 wrapping group이 별도 prototype 사용
        const ActiveSelection = (fabric as any).ActiveSelection
        if (ActiveSelection?.prototype) {
          ActiveSelection.prototype.borderColor = controls.borderColor
          ActiveSelection.prototype.cornerColor = controls.cornerColor
          ActiveSelection.prototype.cornerStrokeColor = controls.cornerStrokeColor
        }

        // IText / Textbox: 텍스트 편집 시 caret(커서) 색상 — prototype의 cursorColor
        const caretColor = mode === 'dark' ? '#e5e7eb' : '#1f2937'
        const IText = (fabric as any).IText
        const Textbox = (fabric as any).Textbox
        if (IText?.prototype) IText.prototype.cursorColor = caretColor
        if (Textbox?.prototype) Textbox.prototype.cursorColor = caretColor
      } catch (e) {
        console.warn('[useCanvasThemeSync] prototype update error:', e)
      }

      // 2-B. 기존 캔버스의 사용자 객체에도 즉시 적용
      canvases.forEach((cv) => {
        if (!cv || (cv as any).disposed) return
        try {
          // selectionColor는 캔버스 단위 (drag-rectangle 색상)
          ;(cv as any).selectionColor = mode === 'dark'
            ? 'rgba(142, 207, 69, 0.18)'
            : 'rgba(39, 99, 138, 0.18)'
          ;(cv as any).selectionBorderColor = controls.borderColor
          ;(cv as any).selectionLineWidth = 1

          const objs = cv.getObjects?.() ?? []
          for (const obj of objs) {
            if (isSystemObject(obj)) continue
            obj.set({
              borderColor: controls.borderColor,
              cornerColor: controls.cornerColor,
              cornerStrokeColor: controls.cornerStrokeColor,
            })
          }
          cv.requestRenderAll?.()
        } catch (e) {
          console.warn('[useCanvasThemeSync] controls apply error:', e)
        }
      })
    }

    apply()

    if (theme === 'system' && typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [ready, theme])
}
