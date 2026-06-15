import type Editor from '@storige/canvas-core'
import type { ImageProcessingPlugin } from '@storige/canvas-core'
import type { fabric } from 'fabric'
import { useImageStore } from '@/stores/useImageStore'

/**
 * 사진틀(프레임) 인터랙션 재바인딩 — 캔버스 복원(loadFromJSON) 직후 호출.
 *
 * 프레임의 hover "이미지 채우기" 오버레이와 click→파일선택→채우기 핸들러는 fabric 이벤트
 * 리스너라 toObject/toJSON 으로 직렬화되지 않는다(런타임 전용). 따라서 저장된 캔버스를
 * 복원하면 프레임 객체는 시각적으로는 보이지만 클릭해도 사진을 채울 수 없는 死객체가 된다.
 * 복원 직후 extensionType==='frame' 객체마다 makeFrameInteractive 를 다시 부여해야 한다.
 *
 * 이미 채워진 프레임은 makeFrameInteractive 내부 _frameInteractiveBound 가드 + isFilled()
 * (frameRef 기준)로 중복 바인딩·재채움이 모두 방지되므로 멱등하게 호출해도 안전하다.
 *
 * loadCanvasData(레거시 standalone) · embed(운영 iframe 임베드) · useEmbedAutoSave(로컬 백업)
 * 세 복원 경로가 이 헬퍼를 공유한다 — 새 복원 경로 추가 시 이 함수만 호출하면 재발 방지.
 */
export function rebindFrameInteractivity(
  editor: Editor | null | undefined,
  canvas: fabric.Canvas | null | undefined,
): void {
  if (!editor || !canvas) return
  const plugin = editor.getPlugin<ImageProcessingPlugin>('ImageProcessingPlugin')
  if (!plugin) return
  const frames = (canvas.getObjects() as fabric.Object[]).filter(
    (obj) => (obj as { extensionType?: string }).extensionType === 'frame',
  )
  for (const frame of frames) {
    useImageStore.getState().makeFrameInteractive(canvas, frame, plugin)
  }
}
