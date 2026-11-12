/**
 * 세션 canvasData 직렬화 — embed.tsx handleFinish·instance.save·instance.complete 의 단일 진실원.
 *
 * instance.save / instance.complete(IIFE 파트너 API)가 `canvas?.toJSON(...) || null` 로 현재 캔버스
 * 1장만 보내면 멀티페이지 세션의 canvasData 배열을 단일 객체로 덮어쓴다. 그래서 handleFinish 의 식과 정확히 같다:
 *   allCanvas.length > 1 ? allCanvas.map((c) => c.toJSON(props)) : (canvas?.toJSON(props) || null)
 * allCanvas 가 0·1장이면 단일 객체 또는 null(종전과 동일), 2장 이상이면 배열.
 */
import type { fabric } from 'fabric'
import { core } from '@storige/canvas-core'

type CanvasJson = ReturnType<fabric.Canvas['toJSON']>

export function collectCanvasData(
  allCanvas: ReadonlyArray<fabric.Canvas>,
  canvas: fabric.Canvas | null | undefined,
  props: string[] = core.extendFabricOption,
): CanvasJson[] | CanvasJson | null {
  return allCanvas.length > 1
    ? allCanvas.map((c) => c.toJSON(props))
    : (canvas?.toJSON(props) || null)
}
