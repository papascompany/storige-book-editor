import { SelectionType } from './SelectionType'

export interface CanvasObject {
  id: string
  type: SelectionType
  visible: boolean
  locked: boolean
  selected: boolean
  editable?: boolean
  /** Part B 위치고정 플래그 스냅샷 — false=관리자 지정 잠금(고객 해제 불가). undefined=허용. */
  movable?: boolean
  name?: string
  displayOrder: number
}
