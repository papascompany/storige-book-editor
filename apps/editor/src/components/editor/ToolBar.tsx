import { useMemo } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useImageStore } from '@/stores/useImageStore'
import { SelectionType, ImageProcessingPlugin } from '@storige/canvas-core'
import {
  Upload,
  LayoutTemplate,
  Image,
  Type,
  Shapes,
  PaintBucket,
  Frame,
  QrCode,
  Pencil,
  Scissors,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AppMenu } from '@/types/menu'

// Feature flag for image processing (OpenCV) features
const ENABLE_IMAGE_PROCESSING = import.meta.env.VITE_ENABLE_IMAGE_PROCESSING !== 'false'
// Feature flag for upload menu
const ENABLE_UPLOAD_MENU = import.meta.env.VITE_ENABLE_UPLOAD_MENU !== 'false'
// Feature flag for template menu
const ENABLE_TEMPLATE_MENU = import.meta.env.VITE_ENABLE_TEMPLATE_MENU !== 'false'
// Feature flag for frame menu
const ENABLE_FRAME_MENU = import.meta.env.VITE_ENABLE_FRAME_MENU !== 'false'
// Feature flag for smart code (QR/barcode) menu
const ENABLE_SMART_CODE_MENU = import.meta.env.VITE_ENABLE_SMART_CODE_MENU !== 'false'
// Feature flag for AI panel (recommend + generate)
const ENABLE_AI_PANEL = import.meta.env.VITE_ENABLE_AI_PANEL !== 'false'

// Tool definitions - CLIPPING requires ImageProcessingPlugin (OpenCV)
const ALL_MENUS: AppMenu[] = [
  // CLIPPING menu is only shown when image processing is enabled
  ...(ENABLE_IMAGE_PROCESSING ? [{ type: 'CLIPPING' as const, label: '모양컷', icon: Scissors }] : []),
  ...(ENABLE_TEMPLATE_MENU ? [{ type: 'TEMPLATE' as const, label: '템플릿', icon: LayoutTemplate }] : []),
  { type: 'IMAGE', label: '이미지', icon: Image },
  { type: 'TEXT', label: '텍스트', icon: Type },
  { type: 'SHAPE', label: '요소', icon: Shapes },
  { type: 'BACKGROUND', label: '배경', icon: PaintBucket },
  ...(ENABLE_FRAME_MENU ? [{ type: 'FRAME' as const, label: '프레임', icon: Frame }] : []),
  ...(ENABLE_SMART_CODE_MENU ? [{ type: 'SMART_CODE' as const, label: 'QR/바코드', icon: QrCode }] : []),
  // EDIT menu uses ImageProcessingPlugin for some features
  ...(ENABLE_IMAGE_PROCESSING ? [{ type: 'EDIT' as const, label: '편집도구', icon: Pencil }] : []),
  // AI 패널 (추천 + 생성) — 다른 메뉴 끝에 배치
  ...(ENABLE_AI_PANEL ? [{ type: 'AI' as const, label: 'AI', icon: Sparkles }] : []),
]

interface ToolBarProps {
  horizontal?: boolean
}

export default function ToolBar({ horizontal = false }: ToolBarProps) {
  const canvas = useAppStore((state) => state.canvas)
  const ready = useAppStore((state) => state.ready)
  const currentMenu = useAppStore((state) => state.currentMenu)
  const tapMenu = useAppStore((state) => state.tapMenu)
  const getPlugin = useAppStore((state) => state.getPlugin)

  const editMode = useSettingsStore((state) => state.currentSettings.editMode)
  // Note: menu config will be loaded from product settings when available
  // For now, use all menus as default
  const appMenu: string[] | undefined = undefined

  const upload = useImageStore((state) => state.upload)
  const uploadSimple = useImageStore((state) => state.uploadSimple)

  // Build menu list based on editMode and appMenu settings
  const menus = useMemo(() => {
    const uploadMenu: AppMenu = {
      type: 'upload',
      label: '업로드',
      icon: Upload,
      onTap: async () => {
        if (!ready || !canvas) return

        try {
          if (ENABLE_IMAGE_PROCESSING) {
            // 이미지 처리 기능이 활성화된 경우 ImageProcessingPlugin 사용
            const imagePlugin = getPlugin<ImageProcessingPlugin>('ImageProcessingPlugin')
            if (!imagePlugin) {
              console.warn('ImageProcessingPlugin not available, falling back to simple upload')
              await uploadSimple(canvas, 'image/*')
              return
            }
            await upload(
              canvas,
              imagePlugin,
              SelectionType.image,
              'image/*,.ai,.eps,.pdf,application/pdf,application/postscript,application/illustrator'
            )
          } else {
            // 이미지 처리 기능 비활성화 - 간단한 업로드 사용
            await uploadSimple(canvas, 'image/*')
          }
        } catch (error) {
          console.error('UploadSimple error:', error)
        }
      },
    }

    // In edit mode or development, show all menus
    const availableMenus =
      editMode || import.meta.env.DEV
        ? ALL_MENUS
        : (appMenu as string[] | undefined)
            ?.map((menuType) => ALL_MENUS.find((m) => m.type === menuType))
            .filter((m): m is AppMenu => m !== undefined) ?? ALL_MENUS

    return [...(ENABLE_UPLOAD_MENU ? [uploadMenu] : []), ...availableMenus]
  }, [editMode, appMenu, ready, canvas, getPlugin, upload, uploadSimple])

  const handleMenuClick = (menu: AppMenu) => {
    if (menu.onTap) {
      menu.onTap()
    } else {
      tapMenu(currentMenu?.type === menu.type ? null : menu)
    }
  }

  return (
    <div
      className={cn(
        'toolbar bg-editor-panel border-editor-border flex gap-1 z-[101]',
        horizontal
          ? 'flex-row h-auto max-w-full overflow-x-auto border-t px-2 scrollbar-hide'
          : 'flex-col overflow-y-auto max-h-full border-r py-2 min-w-[72px] items-center gap-3'
      )}
    >
      {menus.map((menu) => {
        const Icon = menu.icon
        const isSelected = currentMenu?.type === menu.type

        return (
          <button
            key={menu.type}
            className={cn(
              'menu-item relative flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors',
              // 터치 디바이스(pointer:coarse) 에서는 Apple HIG 44pt / Material 48dp 충족
              horizontal
                ? 'h-11 w-11 min-w-[44px] [@media(pointer:coarse)]:h-12 [@media(pointer:coarse)]:w-12 [@media(pointer:coarse)]:min-w-[48px]'
                : 'h-14 w-14',
              isSelected
                ? 'bg-editor-accent/10 text-editor-accent'
                : 'text-editor-text-muted hover:bg-editor-hover hover:text-editor-text'
            )}
            onClick={() => handleMenuClick(menu)}
            title={menu.label}
          >
            {/* 선택 시 좌측 그린 바 인디케이터 */}
            {!horizontal && isSelected && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-8 bg-editor-accent rounded-r" />
            )}
            {Icon && <Icon className={cn(horizontal ? 'h-5 w-5' : 'h-6 w-6')} />}
            {!horizontal && (
              <span className="menu-text text-[11px] font-medium">{menu.label}</span>
            )}
          </button>
        )
      })}

      {/* Edit mode indicator */}
      {editMode && (
        <div className="fixed bottom-3 m-auto bg-white pt-3">
          <span className="px-2 py-1 text-xs font-bold text-editor-accent bg-editor-accent/10 rounded">
            편집모드
          </span>
        </div>
      )}
    </div>
  )
}
