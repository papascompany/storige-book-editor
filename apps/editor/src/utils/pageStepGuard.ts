/**
 * S8 (2026-09-28): pageStep 배수 가드 — 스토어 결선부.
 * 순수 산식은 utils/pageStep. 여기서는 라이브 스토어(캔버스 수·스프레드 설정·pageStep)를 읽어
 * 완료 payload pageCount 와 같은 기준으로 위반 여부를 판정한다.
 * 사용처: EditorHeader 편집완료(UI) 차단, embed complete()(프로그래매틱) 차단, PageStepWarning 배지.
 */
import { useAppStore } from '@/stores/useAppStore'
import { useEditorStore } from '@/stores/useEditorStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import {
  getPageStepViolation,
  livePhysicalPageCount,
  pageStepViolationMessage,
  type PageStepViolation,
} from './pageStep'

export function getLivePageStepViolation(): PageStepViolation | null {
  const step = useEditorStore.getState().pageStep
  if (!step) return null
  const app = useAppStore.getState()
  const physical = livePhysicalPageCount({
    canvasCount: app.allCanvas.length,
    isSpreadMode: app.isSpreadMode,
    regionScope: useSettingsStore.getState().spreadConfig?.regionScope ?? null,
    pagesPerCanvas: useEditorStore.getState().pagesPerCanvas,
  })
  return getPageStepViolation(physical, step)
}

/** 위반이면 고객 안내 메시지, 아니면 null (편집완료 차단 판단용). */
export function getPageStepBlockMessage(): string | null {
  const v = getLivePageStepViolation()
  return v ? pageStepViolationMessage(v) : null
}
