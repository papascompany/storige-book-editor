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
// E1 §5-2 — 변형 중 실시간 치수/각도/좌표 피드백 (DOM 오버레이)
export {
  default as TransformFeedbackPlugin,
  type TransformFeedbackOptions,
} from './plugins/TransformFeedbackPlugin'
// E1 §5-5 — 재단/안전영역 침범 실시간 경고 (경계 강조 + safeZoneViolation 이벤트)
export {
  default as SafeZoneWarningPlugin,
  type SafeZoneWarningOptions,
} from './plugins/SafeZoneWarningPlugin'
// R8 — 배치 이미지 유효 DPI 실시간 경고 (저해상 진입 전이 imageLowDpi 이벤트)
export {
  default as ImageDpiWarningPlugin,
  type ImageDpiWarningOptions,
  type ImageLowDpiPayload,
} from './plugins/ImageDpiWarningPlugin'

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
// S-E3 — 곡선(패스) 텍스트 수식·적용 유틸 (TextEffect 후편집 + AppText 프리셋 공유 정본)
export * from './utils/curveText'
export * from './utils/inferenceCap'
// 모양컷 '효과' 경로 진단 — 프리즈가 풀린 뒤 window.__storigeTrace 로 단계별 소요를 읽는다.
export { traceStep, traceEnter, resetTrace, TRACE_STORAGE_KEY, type TraceEntry } from './utils/perfTrace'
// P2-11/A — OpenCV/배경제거 lazy-loader + warmup helpers
// ⚠️ getBackgroundRemoval / warmupBackgroundRemoval 은 제거됐다(D-12d, 2026-08-06) —
//    배경제거 추론은 서버(rembg 사이드카)가 하고, 진입점은 editor 의 api/cutout.ts 다.
// ⚠️ 2026-08-07: ESM import 가 UMD 를 깨뜨려 무한 대기하던 문제로 `<script>` 태그 로드로 전환 —
//    소비 앱은 부트스트랩에서 configureOpenCv({ scriptUrl }) 로 자산 URL 을 주입해야 한다.
export { getCv, warmupOpenCv, configureOpenCv, OPENCV_READY_TIMEOUT_MS } from './utils/openCv'
// 2026-08-07: OpenCV 는 메인 스레드에서 실행 불능(실측) → 윤곽 추출을 워커로 주입.
export {
  configureContourExtractor,
  getContourExtractor,
  type ContourExtractInput,
  type ContourExtractResult,
  type ContourExtractor
} from './utils/contourExtractor'

export default Editor
