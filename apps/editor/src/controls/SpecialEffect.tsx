import { useState, useMemo, useCallback } from 'react'
import { useAppStore, useActiveSelection } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import AppSection from '@/components/AppSection'
import { FilterPlugin } from '@storige/canvas-core'
import type { CoverFinishingKind } from '@storige/types'
import { Check } from 'lucide-react'

import embossingImage from '@/assets/image/embossing.png'
import goldenImage from '@/assets/image/golden.png'

interface EffectOption {
  id: CoverFinishingKind
  name: string
  description: string
  image: string | null
}

const FINISHING_EFFECTS: EffectOption[] = [
  {
    id: 'emboss',
    name: '형압',
    description: '텍스트·이미지에 입체 형압 느낌을 줍니다. 화면 표시용입니다.',
    image: embossingImage,
  },
  {
    id: 'gold',
    name: '금박',
    description: '금박 느낌을 줍니다. 화면 표시용입니다.',
    image: goldenImage,
  },
  {
    id: 'silver',
    name: '은박',
    description: '은박 느낌을 줍니다. 화면 표시용입니다.',
    image: null,
  },
]

export default function SpecialEffect() {
  const [expanded, setExpanded] = useState(true)
  const activeSelection = useActiveSelection()
  const getPlugin = useAppStore((state) => state.getPlugin)
  const canvas = useAppStore((state) => state.canvas)
  const allowed = useSettingsStore((s) => s.coverFinishingAllowed)
  const materialLocked = useSettingsStore((s) => s.coverMaterialLocked)
  const allCanvas = useAppStore((s) => s.allCanvas)
  const isCoverPage = !!canvas && allCanvas[0] === canvas

  const filterPlugin = useMemo(() => {
    return getPlugin<FilterPlugin>('FilterPlugin')
  }, [getPlugin])

  const visibleEffects = useMemo(
    () => FINISHING_EFFECTS.filter((e) => allowed.includes(e.id)),
    [allowed],
  )

  const currentEffects = useMemo(() => {
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return []
    }
    const obj = activeSelection[0] as { effects?: string[] }
    return obj?.effects || []
  }, [activeSelection])

  const toggleEffect = useCallback(
    (effectId: CoverFinishingKind) => {
      if (!filterPlugin || !activeSelection || activeSelection.length === 0) return
      const obj = activeSelection[0]
      if (!obj) return
      switch (effectId) {
        case 'emboss':
          filterPlugin.emboss(obj)
          break
        case 'gold':
          filterPlugin.gold(obj)
          break
        case 'silver':
          filterPlugin.silver(obj)
          break
      }
      canvas?.requestRenderAll()
    },
    [filterPlugin, activeSelection, canvas],
  )

  if (!materialLocked || !isCoverPage || visibleEffects.length === 0) return null
  if (!activeSelection || activeSelection.length === 0 || !filterPlugin) return null

  return (
    <AppSection
      id="special-effect-control"
      title="후가공"
      expanded={expanded}
      onExpand={() => setExpanded(!expanded)}
    >
      {expanded && (
        <div className="flex flex-col gap-2 px-4">
          {visibleEffects.map((effect) => {
            const isChecked = currentEffects.includes(effect.id)
            return (
              <div
                key={effect.id}
                className="flex flex-row gap-3 p-2 rounded-lg bg-editor-surface-lowest cursor-pointer border border-transparent hover:border-primary transition-colors"
                onClick={() => toggleEffect(effect.id)}
              >
                <div className="relative min-w-16 min-h-16 max-w-16 max-h-16 rounded overflow-hidden bg-gradient-to-br from-slate-200 to-slate-500">
                  {effect.image ? (
                    <img
                      src={effect.image}
                      alt={`${effect.name} sample`}
                      className="w-full h-full object-cover"
                    />
                  ) : null}
                  {isChecked && (
                    <>
                      <div className="absolute inset-0 bg-black/30 rounded" />
                      <Check className="absolute inset-0 m-auto h-6 w-6 text-white" />
                    </>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-editor-text mt-0.5">{effect.name}</span>
                  <p className="text-xs text-editor-text-muted">{effect.description}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </AppSection>
  )
}
