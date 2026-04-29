import type { LucideIcon } from 'lucide-react'

export interface AppMenu {
  type: string
  label: string
  icon?: LucideIcon
  onTap?: () => void
  component?: React.ComponentType
}
