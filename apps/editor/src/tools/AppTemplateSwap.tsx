import { useCallback, useMemo, useState } from 'react'
import { fabric } from 'fabric'
import { TemplatePlugin, SpreadPlugin, type ImageProcessingPlugin, core } from '@storige/canvas-core'
import {
  classifyPrintTemplate,
  filterSwapCandidates,
  printKindLabel,
  type PrintTemplateLike,
} from '@storige/types'
import { useAppStore } from '@/stores/useAppStore'
import { useEditorStore, useCurrentPage } from '@/stores/useEditorStore'
import { useSettingsStore, type LinkedPrintTemplate } from '@/stores/useSettingsStore'
import { sessionsApi } from '@/api/sessions'
import { templatesApi } from '@/api/templates'
import { useImageStore } from '@/stores/useImageStore'
import { applyCoverMaterialLock } from '@/utils/objectPermissions'
import { rehydrateCalendarGrids } from '@/utils/calendarRehydrate'
import { resolveAssetUrl } from '@/utils/resolveAssetUrl'
import { TemplateReplaceModal } from '@/components/TemplatePanel/TemplateReplaceModal'

/**
 * 교체 때 템플릿 유래로 볼 top-level 객체 id — 연결 템플릿 전체 ∪ 현재 페이지 템플릿.
 * 저장본은 isUserAdded 를 남기지 않고, 다시 열면 pages[].templateId 가 세트 원본으로 돌아올 수 있어
 * (앞 세션에서 다른 연결 템플릿으로 바꾼 캔버스) 현재 템플릿 하나만으로는 옛 요소를 가려낼 수 없다.
 * canvasData 가 없는 연결 템플릿·목록 밖 현재 템플릿은 상세를 조회하고, 일부 실패면 얻은 것만으로 합집합,
 * 하나도 못 구하면 undefined(종전 판정).
 */
async function swapTemplateObjectIds(
  templateId: string | undefined,
  linked: LinkedPrintTemplate[],
): Promise<string[] | undefined> {
  const ids = new Set<string>()
  let resolved = 0
  const toFetch: string[] = []
  for (const t of linked) {
    const objects = t.canvasData?.objects
    if (Array.isArray(objects)) {
      TemplatePlugin.templateObjectIds(objects).forEach((id) => ids.add(id))
      resolved += 1
    } else if (t.id) {
      toFetch.push(t.id)
    }
  }
  if (templateId && !linked.some((t) => t.id === templateId)) toFetch.push(templateId)
  const fetched = await Promise.allSettled(toFetch.map((id) => templatesApi.getTemplate(id)))
  fetched.forEach((r, i) => {
    const objects = r.status === 'fulfilled' ? r.value?.canvasData?.objects : undefined
    if (Array.isArray(objects)) {
      TemplatePlugin.templateObjectIds(objects).forEach((id) => ids.add(id))
      resolved += 1
    } else {
      console.warn('[AppTemplateSwap] 템플릿 조회 실패 — 이 템플릿 id 없이 교체:', toFetch[i], r.status === 'rejected' ? r.reason : '')
    }
  })
  return resolved > 0 ? Array.from(ids) : undefined
}

function swapProbe(
  currentLinked: LinkedPrintTemplate | null,
  currentPage: { templateId?: string; templateType?: string } | null | undefined,
  pageIndex: number,
): PrintTemplateLike & { id?: string } {
  if (currentLinked) return currentLinked
  const settings = useSettingsStore.getState()
  const spread = settings.spreadConfig
  const size = settings.currentSettings.size
  const isInner =
    !!spread?.innerSpec && (spread.regionScope === 'inner' || pageIndex > 0)
  if (isInner && spread?.innerSpec) {
    return {
      id: currentPage?.templateId,
      type: 'spread',
      spreadConfig: { regionScope: 'inner', innerSpec: spread.innerSpec },
    }
  }
  if (pageIndex === 0 && spread) {
    return {
      id: currentPage?.templateId,
      type: 'spread',
      width: spread.spec?.coverWidthMm ?? size.width,
      height: spread.spec?.coverHeightMm ?? size.height,
      spreadConfig: spread,
    }
  }
  return {
    id: currentPage?.templateId,
    type: currentPage?.templateType ?? 'page',
    width: spread?.spec?.coverWidthMm ?? size.width,
    height: spread?.spec?.coverHeightMm ?? size.height,
  }
}

export default function AppTemplateSwap() {
  const currentPage = useCurrentPage()
  const linked = useSettingsStore((s) => s.linkedPrintTemplates)
  const canvas = useAppStore((s) => s.canvas)
  const getPlugin = useAppStore((s) => s.getPlugin)
  const sessionId = useEditorStore((s) => s.sessionId)
  const userId = useEditorStore((s) => s.userId)
  const setPages = useEditorStore((s) => s.setPages)
  const pages = useEditorStore((s) => s.pages)
  const currentPageIndex = useEditorStore((s) => s.currentPageIndex)

  const [pending, setPending] = useState<LinkedPrintTemplate | null>(null)
  const [replacing, setReplacing] = useState(false)

  const currentLinked = useMemo(() => {
    if (!currentPage?.templateId) return null
    return linked.find((t) => t.id === currentPage.templateId) ?? null
  }, [linked, currentPage?.templateId])

  const probe = useMemo(
    () => swapProbe(currentLinked, currentPage, currentPageIndex),
    [currentLinked, currentPage, currentPageIndex],
  )
  const currentKind = classifyPrintTemplate(probe)

  const candidates = useMemo(() => {
    if (!currentLinked && !currentPage) return []
    const ids = new Set(linked.map((t) => t.id))
    return filterSwapCandidates(linked, probe, ids)
  }, [linked, currentLinked, currentPage, probe])

  const applyLive = useCallback(
    async (tpl: LinkedPrintTemplate, currentTemplateIds?: string[]) => {
      const objects = tpl.canvasData?.objects
      const plugin = getPlugin<TemplatePlugin>('TemplatePlugin')
      if (!plugin || !Array.isArray(objects) || objects.length === 0) return
      // 옛 틀에서 옮긴 채움 사진을 새 틀 기하(마스크·배율·위치)에 다시 맞춘다 — 틀 채우기와 같은 경로
      const imagePlugin = getPlugin<ImageProcessingPlugin>('ImageProcessingPlugin')
      const refitFill =
        canvas && imagePlugin
          ? (fill: fabric.Object, frame: fabric.Object) =>
              useImageStore.getState().fillImageIntoFrame(canvas, fill, frame, imagePlugin)
          : undefined
      await new Promise<void>((resolve) => {
        fabric.util.enlivenObjects(
          core.ensureImageCrossOrigin(objects) as unknown as fabric.Object[],
          async (enlivened: fabric.Object[]) => {
            try {
              await plugin.replaceTemplate(enlivened, { currentTemplateIds, refitFill })
              const kind = classifyPrintTemplate(tpl)
              const spreadPlugin = getPlugin<SpreadPlugin>('SpreadPlugin')
              if (spreadPlugin && kind === 'cover-split') {
                const spec = tpl.spreadConfig?.spec
                if (spec) spreadPlugin.init(spec)
              }
              if (kind === 'cover-fixed' || kind === 'cover-split') {
                applyCoverMaterialLock(
                  canvas,
                  useSettingsStore.getState().coverMaterialLocked,
                  useSettingsStore.getState().currentSettings.editMode,
                )
              }
              // P1 캘린더: 템플릿 교체 뒤 calendar-grid 재합성(프로파일 null 이면 즉시 0, no-op).
              if (canvas) {
                const { allCanvas, allEditors } = useAppStore.getState()
                const idx = Math.max(0, allCanvas.indexOf(canvas))
                void rehydrateCalendarGrids(allEditors[idx], canvas, idx)
              }
            } finally {
              resolve()
            }
          },
          '',
        )
      })
    },
    [canvas, getPlugin],
  )

  const confirm = useCallback(async () => {
    if (!pending) return
    setReplacing(true)
    try {
      // 교체 전(세션·store 갱신 전) 연결 템플릿 전체 ∪ 현재 페이지 템플릿 기준으로 옛 템플릿 요소 id 를 구한다
      const currentTemplateIds = await swapTemplateObjectIds(currentPage?.templateId, linked)
      if (sessionId && currentPage?.id) {
        try {
          await sessionsApi.replaceTemplate(
            sessionId,
            { newTemplateId: pending.id, pageId: currentPage.id },
            userId || undefined,
          )
        } catch (e) {
          console.warn('[AppTemplateSwap] 세션 교체 생략(라이브만 적용):', e)
        }
      }
      await applyLive(pending, currentTemplateIds)
      if (pages[currentPageIndex]) {
        const next = pages.slice()
        next[currentPageIndex] = { ...next[currentPageIndex], templateId: pending.id }
        setPages(next)
      }
      setPending(null)
    } finally {
      setReplacing(false)
    }
  }, [pending, sessionId, currentPage, userId, applyLive, pages, currentPageIndex, setPages, linked])

  return (
    <div className="w-full h-full flex flex-col">
      <div className="px-4 pt-4 pb-2">
        <p className="text-xs text-editor-text-muted">
          {printKindLabel(currentKind)} · 연결된 {candidates.length}개
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {candidates.length === 0 ? (
          <p className="py-8 text-center text-xs text-editor-text-muted">
            이 장에 연결된 같은 유형·같은 판형 템플릿이 없습니다.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {candidates.map((tpl) => {
              const selected = currentPage?.templateId === tpl.id
              const thumb = resolveAssetUrl(tpl.thumbnailUrl)
              return (
                <button
                  key={tpl.id}
                  type="button"
                  className={`text-left rounded border overflow-hidden ${
                    selected ? 'border-primary ring-1 ring-primary' : 'border-editor-border'
                  }`}
                  onClick={() => {
                    if (!selected) setPending(tpl)
                  }}
                >
                  <div className="bg-editor-surface-low aspect-square flex items-center justify-center">
                    {thumb ? (
                      <img src={thumb} alt="" className="object-contain w-full h-full" />
                    ) : (
                      <span className="text-[10px] text-editor-text-muted px-1">미리보기 없음</span>
                    )}
                  </div>
                  <div className="px-1 py-1 text-[11px] text-editor-text truncate">{tpl.name || '이름 없음'}</div>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <TemplateReplaceModal
        isOpen={!!pending}
        mode="template"
        templateName={pending?.name}
        onConfirm={() => void confirm()}
        onCancel={() => {
          if (!replacing) setPending(null)
        }}
        isReplacing={replacing}
      />
    </div>
  )
}
