import Editor from './Editor'

// fabric 5.5.2 stylesToArray 갭 라인 병합 버그 패치 — 패키지 로드 시 무조건 부착
// (toObject/toJSON/toDatalessJSON 등 모든 직렬화 경로가 fabric.util 을 호출 시점 조회)
import './utils/textStyles'

export { default as RulerPlugin } from './plugins/RulerPlugin'
export { default as WorkspacePlugin } from './plugins/WorkspacePlugin'
export { default as ServicePlugin } from './plugins/ServicePlugin'
export { default as ObjectPlugin } from './plugins/ObjectPlugin'
export { default as DraggingPlugin } from './plugins/DraggingPlugin'
export { default as HistoryPlugin } from './plugins/HistoryPlugin'
export { default as CopyPlugin } from './plugins/CopyPlugin'
export { default as GroupPlugin } from './plugins/GroupPlugin'
export { default as ImageProcessingPlugin } from './plugins/ImageProcessingPlugin'
export { default as AlignPlugin } from './plugins/AlignPlugin'
export { default as AccessoryPlugin } from './plugins/AccessoryPlugin'
export { default as FontPlugin } from './plugins/FontPlugin'
export { default as FilterPlugin } from './plugins/FilterPlugin'
export { default as EffectPlugin } from './plugins/EffectPlugin'
export { default as SmartCodePlugin } from './plugins/SmartCodePlugin'
export { default as ControlsPlugin } from './plugins/ControlsPlugin'
export { default as TemplatePlugin } from './plugins/TemplatePlugin'
export { default as PreviewPlugin } from './plugins/PreviewPlugin'
export { default as ScreenshotPlugin } from './plugins/ScreenshotPlugin'
export { default as LockPlugin, type LockLevel, type UserRole, type LockInfo } from './plugins/LockPlugin'
export { default as SpreadPlugin } from './plugins/SpreadPlugin'
export { default as PointerShiftGuardPlugin } from './plugins/PointerShiftGuardPlugin'
export { default as FrameInteractionPlugin } from './plugins/FrameInteractionPlugin'
// E1 §5-1 — 객체 간 정렬 가이드/스냅 + 회전 각도 스냅
export { default as SmartGuidesPlugin, type SmartGuidesOptions } from './plugins/SmartGuidesPlugin'

export { PluginBase } from './plugin'

// Spread layout engine exports
export * from './spread/SpreadLayoutEngine'
export * from './spread/SpineResizeStrategy'

export * from './utils/colors'
export * from './utils/canvas'
export * from './utils/svg'
export * from './utils/save'
export * from './utils/math'
export * from './utils/utils'
export * from './utils/image'
export * from './utils/render'
export * from './utils/factory'

export * from './models'

export * from './utils/colors'
export * as SvgUtils from './utils/svg'

export * from './utils/eyeDrop'
export * from './utils/logger'
// P1-3 — 변환 중 포인터→scene 매핑 점프 보정 (PointerShiftGuardPlugin 의 순수 로직)
export * from './utils/pointerShift'
// P2-11/A — OpenCV/배경제거 lazy-loader + warmup helpers
export { getCv, getBackgroundRemoval, warmupOpenCv, warmupBackgroundRemoval } from './utils/openCv'

export default Editor
