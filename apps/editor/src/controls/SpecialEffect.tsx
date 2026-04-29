import { useState, useMemo, useCallback } from 'react'
import { useAppStore, useActiveSelection } from '@/stores/useAppStore'
import AppSection from '@/components/AppSection'
import { FilterPlugin } from '@storige/canvas-core'
import { Check } from 'lucide-react'

// Import effect images
import embossingImage from '@/assets/image/embossing.png'
import goldenImage from '@/assets/image/golden.png'
import cuttingImage from '@/assets/image/cutting.png'

interface EffectOption {
  id: string
  name: string
  description: string
  image: string
}

const EFFECTS: EffectOption[] = [
  {
    id: 'emboss',
    name: '엠보싱',
    description: '이미지의 경계선을 강조하여 입체감을 부여합니다.',
    image: embossingImage,
  },
  {
    id: 'gold',
    name: '박',
    description: '박 효과를 통해 고급스러운 디자인을 완성합니다.',
    image: goldenImage,
  },
  {
    id: 'cutting',
    name: '컷팅',
    description: '특정 부분을 컷팅함으로써 입체감을 부여합니다.',
    image: cuttingImage,
  },
]

export default function SpecialEffect() {
  const [expanded, setExpanded] = useState(true)
  const activeSelection = useActiveSelection()
  const getPlugin = useAppStore((state) => state.getPlugin)
  const canvas = useAppStore((state) => state.canvas)

  const filterPlugin = useMemo(() => {
    return getPlugin<FilterPlugin>('FilterPlugin')
  }, [getPlugin])

  // Get current effects applied to the selected object
  const currentEffects = useMemo(() => {
    if (!activeSelection || !Array.isArray(activeSelection) || activeSelection.length === 0) {
      return []
    }

     
    const obj = activeSelection[0] as any
    return obj?.effects || []
  }, [activeSelection])

  // Toggle effect
  const toggleEffect = useCallback(
    (effectId: string) => {
      if (!filterPlugin || !activeSelection || activeSelection.length === 0) {
        return
      }

      const obj = activeSelection[0]
      if (!obj) return

      switch (effectId) {
        case 'emboss':
          filterPlugin.emboss(obj)
          break
        case 'gold':
          filterPlugin.gold(obj)
          break
        case 'cutting':
          filterPlugin.cutting(obj)
          break
      }

      canvas?.requestRenderAll()
    },
    [filterPlugin, activeSelection, canvas]
  )

  // Don't render if no selection or no plugin
  if (!activeSelection || activeSelection.length === 0 || !filterPlugin) {
    return null
  }

  return (
    <AppSection
      id="special-effect-control"
      title="특수효과"
      expanded={expanded}
      onExpand={() => setExpanded(!expanded)}
    >
      {expanded && (
        <div className="flex flex-col gap-2 px-4">
          {EFFECTS.map((effect) => {
            const isChecked = currentEffects.includes(effect.id)
            return (
              <div
                key={effect.id}
                className="flex flex-row gap-3 p-2 rounded-lg bg-editor-surface-lowest cursor-pointer border border-transparent hover:border-primary transition-colors"
                onClick={() => toggleEffect(effect.id)}
              >
                {/* Image box */}
                <div className="relative min-w-16 min-h-16 max-w-16 max-h-16 rounded overflow-hidden">
                  <img
                    src={effect.image}
                    alt={`${effect.name} sample`}
                    className="w-full h-full object-cover"
                  />
                  {isChecked && (
                    <>
                      <div className="absolute inset-0 bg-black/30 rounded" />
                      <Check className="absolute inset-0 m-auto h-6 w-6 text-white" />
                    </>
                  )}
                </div>

                {/* Text */}
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-editor-text mt-0.5">
                    {effect.name}
                  </span>
                  <p className="text-xs text-editor-text-muted">
                    {effect.description}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </AppSection>
  )
}
