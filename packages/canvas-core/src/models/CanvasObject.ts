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
  // B1 (2026-07-04): 레이어 행 배지/판정용 속성 스냅샷 (undefined=허용, 기본 permissive)
  /** false = 고객 삭제 잠금 */
  deleteable?: boolean
  /** false = 고객 내용편집 잠금 */
  contentEditable?: boolean
  /** true = PDF 출력 제외 */
  printExclude?: boolean
  /** true = 레이어 순서 잠금 */
  lockLayerOrder?: boolean
  /** LockPlugin 고급 잠금 레벨 (lockInfo.isLocked 인 경우만 세팅) */
  lockLevel?: 'user' | 'designer' | 'admin' | 'system'
  name?: string
  displayOrder: number
}
