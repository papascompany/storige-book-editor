/** C9 §6-2: 단축키 도움말 모달 카테고리(자동 생성 그룹핑용). */
export type CanvasHotkeyCategory = 'clipboard' | 'arrange' | 'move' | 'object' | 'view'

export default interface CanvasHotkey {
  name: string
  input: string | string[]
  // callback
  callback: () => void
  onlyForActiveObject: boolean
  hideContext?: boolean | (() => boolean)
  // C9 §6-2 (additive): 도움말 모달 자동 생성 메타. 미지정 시 모달이 input 포매팅/기본
  // 그룹으로 폴백한다. hideContext(컨텍스트 메뉴 은폐)와 hideInHelp(도움말 은폐)는 분리 —
  // 화살표 이동·스포이드는 hideContext:true 지만 도움말에는 노출되어야 한다.
  category?: CanvasHotkeyCategory
  /** Mac 표기 키캡 배열(미지정 시 모달이 input 에서 파생). 예: ['⌘','['] */
  displayKeys?: string[]
  /** 도움말 모달에서 숨김(중복 shift 변형 등). hideContext 와 독립. */
  hideInHelp?: boolean
}
