import { useCallback, useState } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { templatesApi } from '@/api/templates'
import { core } from '@storige/canvas-core'
import type { CanvasData } from '@storige/types'

/**
 * Admin 전용 — "템플릿셋 수정" 모드의 저장 훅.
 *
 * 목적:
 *   Admin 이 templateSet 으로 진입해 모든 페이지(표지 스프레드 + 내지)에 디자인을
 *   입힌 뒤 저장하면, 각 페이지의 fabric canvasData 를 해당 templateId 의
 *   `templates.canvas_data` 로 PATCH 한다. 다음에 같은 templateSetId 로 진입하는
 *   사용자(고객 / admin) 는 이 디자인을 베이스로 시작.
 *
 * 동작 규칙:
 *   - allCanvas[i] ↔ editorTemplates[i].id (= templateId) 1:1 대응
 *   - 같은 templateId 가 여러 페이지에 반복되면 첫 번째만 저장 (마지막이 이기지 않게)
 *     ↓ 같은 templateId 라면 어차피 같은 디자인이라는 게 데이터 모델이므로
 *     ↓ 페이지마다 다른 디자인을 원하면 admin 이 templateSet "설정" 에서 페이지마다
 *       다른 templateId 를 미리 추가해 둬야 함
 *   - 시스템 객체(workspace/cut-border/safe-zone-border 등)는 fabric.toObject 의
 *     excludeFromExport 플래그로 자연스럽게 제외됨
 *
 * editor_designs 에 작품으로 저장하던 기존 saveWorkForAdmin 과는 별개 흐름.
 * 고객 흐름(saveWork / edit-sessions) 에는 영향 없음.
 */
export interface UseTemplateSetSaveReturn {
  saving: boolean
  /**
   * 모든 페이지를 templates 로 PATCH.
   * @returns 저장된 templateId 개수 (중복 제거 후)
   */
  saveTemplateSet: () => Promise<{ savedCount: number; totalPages: number }>
}

export function useTemplateSetSave(): UseTemplateSetSaveReturn {
  const [saving, setSaving] = useState(false)

  const saveTemplateSet = useCallback(async (): Promise<{ savedCount: number; totalPages: number }> => {
    if (saving) {
      throw new Error('이미 저장 중입니다')
    }

    const { allCanvas } = useAppStore.getState()
    const { editorTemplates } = useSettingsStore.getState()

    if (allCanvas.length === 0) {
      throw new Error('저장할 캔버스가 없습니다')
    }
    if (editorTemplates.length === 0) {
      throw new Error('템플릿 메타데이터가 없습니다 (loadTemplateSetEditor 호출 필요)')
    }

    try {
      setSaving(true)

      // 같은 templateId 중복 제거 — 첫 번째 캔버스의 디자인만 사용.
      const seen = new Set<string>()
      const targets: Array<{ templateId: string; pageIndex: number }> = []
      const limit = Math.min(allCanvas.length, editorTemplates.length)
      for (let i = 0; i < limit; i++) {
        const meta = editorTemplates[i] as { id?: string } | undefined
        const tplId = meta?.id
        if (!tplId || seen.has(tplId)) continue
        seen.add(tplId)
        targets.push({ templateId: tplId, pageIndex: i })
      }

      console.log(
        `[useTemplateSetSave] 저장 대상 ${targets.length}개 (전체 페이지 ${limit}개, 중복 templateId 제거)`,
        targets
      )

      // 직렬 호출 — 동시에 다중 PATCH 보내면 server load 와 race condition 우려
      let savedCount = 0
      for (const { templateId, pageIndex } of targets) {
        const cv = allCanvas[pageIndex]
        if (!cv || (cv as unknown as { disposed?: boolean }).disposed) {
          console.warn(`[useTemplateSetSave] page ${pageIndex} 캔버스 dispose됨, 스킵`)
          continue
        }
        // canvas-core 의 toJSON 이 storige 가 추가한 extension 프로퍼티까지 보존.
        // fabric toJSON 반환형이 loose(`{}`) 라 CanvasData 로 단언(런타임은 version/objects 등 포함).
        // ⚠️ 단일 템플릿 저장(saveJSON)과 동일하게 extendFabricOption 전체를 보존해야 한다.
        //   축소 목록을 쓰면 lockMovementX/Y·hasControls·lockInfo·deleteable·name·styles 등이
        //   셋 일괄저장에서 탈락 → IDML 배경 아트워크 잠금이 책등가변 셋 편집 1회로 절반 풀리고,
        //   텍스트 styles 누락 시 재저장 크래시(무한로딩) 위험. (isUserAdded/isLocked 추가 보존.)
        const canvasData = core.toJSON(cv, [
          ...core.extendFabricOption,
          'isUserAdded',
          'isLocked',
        ]) as unknown as CanvasData
        try {
          await templatesApi.updateTemplate(templateId, { canvasData })
          savedCount++
          console.log(`[useTemplateSetSave] ✓ template ${templateId} 갱신`)
        } catch (e) {
          console.error(`[useTemplateSetSave] ✗ template ${templateId} 갱신 실패:`, e)
          throw new Error(
            `template ${templateId} 갱신 실패: ${e instanceof Error ? e.message : String(e)}`
          )
        }
      }

      console.log(
        `[useTemplateSetSave] 완료: ${savedCount}/${targets.length} templates 저장 (전체 ${limit} 페이지)`
      )
      return { savedCount, totalPages: limit }
    } finally {
      setSaving(false)
    }
  }, [saving])

  return { saving, saveTemplateSet }
}
