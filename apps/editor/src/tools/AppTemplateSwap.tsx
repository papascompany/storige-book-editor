import { useCallback, useMemo, useState } from 'react'
import { fabric } from 'fabric'
import { TemplatePlugin, SpreadPlugin, core } from '@storige/canvas-core'
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
import { applyCoverMaterialLock } from '@/utils/objectPermissions'
import { resolveAssetUrl } from '@/utils/resolveAssetUrl'
import { TemplateReplaceModal } from '@/components/TemplatePanel/TemplateReplaceModal'

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
    async (tpl: LinkedPrintTemplate) => {
      const objects = tpl.canvasData?.objects
      const plugin = getPlugin<TemplatePlugin>('TemplatePlugin')
      if (!plugin || !Array.isArray(objects) || objects.length === 0) return
      await new Promise<void>((resolve) => {
        fabric.util.enlivenObjects(
          core.ensureImageCrossOrigin(objects) as unknown as fabric.Object[],
          async (enlivened: fabric.Object[]) => {
            try {
              await plugin.replaceTemplate(enlivened)
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
      await applyLive(pending)
      if (pages[currentPageIndex]) {
        const next = pages.slice()
        next[currentPageIndex] = { ...next[currentPageIndex], templateId: pending.id }
        setPages(next)
      }
      setPending(null)
    } finally {
      setReplacing(false)
    }
  }, [pending, sessionId, currentPage, userId, applyLive, pages, currentPageIndex, setPages])

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
