/**
 * 내지 PDF 표시전용 가이드 배치 (2026-06-08).
 *
 * underlay 모드 세션 로드 시, 워커가 래스터한 내지 PDF 페이지 이미지를 각 내지 캔버스에
 * `excludeFromExport:true` 잠금 가이드 배경으로 깐다.
 * ⚠️ 가이드는 export/저장에서 제외(C1) — 최종 인쇄는 첨부 원본 PDF 그대로.
 *
 * templateSet.contentPdfEditable===false 면 내지 기존 객체를 잠그고(LockPlugin)
 * 첫 내지 페이지에 "편집 불가" 레이블을 표시한다.
 *
 * 좌표: workspace 객체의 박스(left/top/width/height/scale/origin)에 가이드를 맞춘다.
 */
import { imageFromURL, getFabricSync } from '@storige/canvas-core'
import { resolveStorageUrl } from './fontManager'
import { useAppStore } from '../stores/useAppStore'
import { templateSetsApi } from '../api/template-sets'

const GUIDE_SYSTEM = 'innerPdfGuide'
const LABEL_SYSTEM = 'innerPdfGuideLabel'

export async function applyContentPdfGuides(
  editSession: any,
  templateSetId?: string | null,
): Promise<void> {
  try {
    const mode = editSession?.contentPdfMode
    const guide = editSession?.metadata?.contentPdfGuide
    if (mode !== 'underlay' || !guide?.pageImageUrls?.length) return

    // contentPdfEditable 조회 (없으면 편집 허용 기본)
    let editable = true
    if (templateSetId) {
      try {
        const ts = await templateSetsApi.getTemplateSet(templateSetId)
        editable = (ts as any)?.contentPdfEditable !== false
      } catch {
        /* 조회 실패 시 편집 허용 기본 유지 */
      }
    }

    const { allCanvas, allEditors } = useAppStore.getState()
    if (allCanvas.length <= 1) return // 스프레드(0) 외 내지 페이지 없음

    // 내지 페이지: allCanvas[1..N] (index 0 = 스프레드 표지)
    for (let i = 1; i < allCanvas.length; i++) {
      const canvas: any = allCanvas[i]
      const url = guide.pageImageUrls[i - 1]

      // 1) 가이드 배경 배치
      if (url) {
        try {
          const img: any = await imageFromURL(resolveStorageUrl(url), {
            excludeFromExport: true,
            selectable: false,
            evented: false,
            hasControls: false,
            hasBorders: false,
          })
          const objs = canvas.getObjects()
          const ws: any = objs.find((o: any) => o.id === 'workspace')
          if (ws && img.width && img.height) {
            const wsW = (ws.width || 0) * (ws.scaleX || 1)
            const wsH = (ws.height || 0) * (ws.scaleY || 1)
            img.set({
              left: ws.left,
              top: ws.top,
              originX: ws.originX || 'left',
              originY: ws.originY || 'top',
              angle: ws.angle || 0,
              scaleX: wsW / img.width,
              scaleY: wsH / img.height,
            })
          }
          img.meta = { system: GUIDE_SYSTEM }
          // workspace 바로 위(배경 위, 사용자 객체 아래)에 삽입
          const wsIdx = objs.findIndex((o: any) => o.id === 'workspace')
          canvas.insertAt(img, wsIdx >= 0 ? wsIdx + 1 : 0, false)
          canvas.requestRenderAll()
        } catch (e) {
          console.warn('[contentPdfGuide] place failed page', i, e)
        }
      }

      // 2) 편집 불가 세팅 시 기존 객체 잠금
      if (!editable) {
        try {
          const lock: any = allEditors[i]?.getPlugin?.('LockPlugin')
          if (lock?.lockMultiple) {
            const targets = canvas
              .getObjects()
              .filter(
                (o: any) =>
                  o.id !== 'workspace' && o?.meta?.system !== GUIDE_SYSTEM,
              )
            if (targets.length) {
              lock.lockMultiple(targets, 'admin', '첨부 PDF — 편집 불가, 원본 그대로 인쇄')
            }
          }
          canvas.selection = false
        } catch (e) {
          console.warn('[contentPdfGuide] lock failed page', i, e)
        }
      }
    }

    // 3) 첫 내지 페이지 레이블 (편집 불가 시)
    if (!editable && allCanvas[1]) {
      try {
        const fabric: any = getFabricSync()
        const c: any = allCanvas[1]
        const ws: any = c.getObjects().find((o: any) => o.id === 'workspace')
        const left = ws?.left ?? 24
        const top = ws?.top ?? 24
        const label = new fabric.Text('📎 첨부 PDF — 편집 불가 (원본 그대로 인쇄)', {
          left,
          top,
          fontSize: 18,
          fontFamily: 'sans-serif',
          fill: '#b71c1c',
          backgroundColor: 'rgba(255,255,255,0.88)',
          padding: 6,
          selectable: false,
          evented: false,
          hasControls: false,
          hasBorders: false,
          excludeFromExport: true,
        })
        label.meta = { system: LABEL_SYSTEM }
        c.add(label)
        c.requestRenderAll()
      } catch (e) {
        console.warn('[contentPdfGuide] label failed', e)
      }
    }
  } catch (e) {
    console.warn('[contentPdfGuide] applyContentPdfGuides error', e)
  }
}
