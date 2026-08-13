/**
 * 내지 PDF 표시전용 가이드 배치 (2026-06-08) + 첨부 직후 즉시 '앉히기'(W1, 2026-08-13).
 *
 * underlay 모드 세션 로드 시, 워커가 래스터한 내지 PDF 페이지 이미지를 각 내지 캔버스에
 * `excludeFromExport:true` 잠금 가이드 배경으로 깐다.
 * ⚠️ 가이드는 export/저장에서 제외(C1) — 최종 인쇄는 첨부 원본 PDF 그대로(표시전용 계약).
 *
 * templateSet.contentPdfEditable===false 면 내지 기존 객체를 잠그고(LockPlugin)
 * 첫 내지 페이지에 "편집 불가" 레이블을 표시한다.
 *
 * 좌표: workspace 객체의 박스(left/top/width/height/scale/origin)에 가이드를 맞춘다.
 *
 * W1(2026-08-13): 종전엔 세션 **재로드** 시에만 배치돼 첨부 직후 화면은 그대로였다(G1).
 * `seatContentPdf()` 가 재로드 없이 ①내지 페이지 수를 PDF 페이지 수로 확장(G5)하고
 * ②가이드를 배치한다 — /embed 와 EditorView(/) 양쪽이 같은 함수를 쓴다(G2·G3 대칭).
 * 로드 경로가 이미 확장/배치한 뒤 다시 호출돼도 안전하도록 **멱등**이다(기존 가이드 제거 후 재배치).
 */
import { imageFromURL, getFabricSync } from '@storige/canvas-core'
import { resolveStorageUrl } from './fontManager'
import { useAppStore } from '../stores/useAppStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { templateSetsApi } from '../api/template-sets'
import { editSessionsApi } from '../api/edit-sessions'
import { permuteContentPdfPageOrder } from './innerPageReorder'

const GUIDE_SYSTEM = 'innerPdfGuide'
const LABEL_SYSTEM = 'innerPdfGuideLabel'

/**
 * 내지 PDF 표시 상한(페이지). 워커 CONTENT_PDF_GUIDE_MAX_PAGES(래스터 상한)와 정렬된
 * 메모리 안전 상한 — useEditorContents 의 로드 경로도 이 상수를 공유한다(중복 선언 제거).
 */
export const UNDERLAY_MAX_PAGES = 200

/**
 * G4: 내지 슬롯 → 원본 PDF 페이지 인덱스.
 * 세션 metadata.contentPdfPageOrder (shallow-merge 안전, contentPdfGuide 를 덮지 않음).
 * 메모리 캐시는 같은 세션 안에서 재배치(재로드 전)에 쓰인다.
 */
let rememberedPageOrder: number[] | undefined

export function readContentPdfPageOrder(editSession: unknown): number[] | undefined {
  const meta = (editSession as { metadata?: { contentPdfPageOrder?: unknown } } | null)
    ?.metadata
  const order = meta?.contentPdfPageOrder
  if (
    !Array.isArray(order) ||
    order.length === 0 ||
    !order.every((n) => Number.isInteger(n) && Number(n) >= 0)
  ) {
    return undefined
  }
  return order.map((n) => Number(n))
}

export function rememberContentPdfPageOrder(order: number[] | undefined): void {
  rememberedPageOrder = order
}

export async function persistContentPdfPageOrderAfterReorder(opts: {
  newIndices: number[]
  innerStart: number
  sessionId?: string | null
  guestToken?: string | null
}): Promise<number[]> {
  const next = permuteContentPdfPageOrder(
    rememberedPageOrder,
    opts.newIndices,
    opts.innerStart,
  )
  rememberedPageOrder = next
  const sessionId = opts.sessionId
  if (!sessionId) return next
  const payload = { metadata: { contentPdfPageOrder: next } }
  try {
    if (opts.guestToken) {
      await editSessionsApi.updateGuest(sessionId, opts.guestToken, payload)
    } else {
      await editSessionsApi.update(sessionId, payload)
    }
  } catch (e) {
    console.warn('[contentPdfGuide] persist pageOrder failed', e)
  }
  return next
}

/** 이 세션이 '앉히기' 대상(내지 PDF 표시전용)인지 */
function isUnderlaySession(editSession: any): boolean {
  return editSession?.contentPdfMode === 'underlay'
}

/** 기존 가이드/레이블 제거 — 재호출(로드 후 첨부 등) 시 중복 적재 방지 */
function removeExistingGuides(canvas: any): void {
  try {
    const stale = canvas
      .getObjects()
      .filter(
        (o: any) =>
          o?.meta?.system === GUIDE_SYSTEM || o?.meta?.system === LABEL_SYSTEM,
      )
    stale.forEach((o: any) => canvas.remove(o))
  } catch (e) {
    console.warn('[contentPdfGuide] removeExistingGuides failed', e)
  }
}

export async function applyContentPdfGuides(
  editSession: any,
  templateSetId?: string | null,
): Promise<void> {
  try {
    const guide = editSession?.metadata?.contentPdfGuide
    if (!isUnderlaySession(editSession) || !guide?.pageImageUrls?.length) return

    const pageOrder = readContentPdfPageOrder(editSession) ?? rememberedPageOrder
    if (pageOrder) rememberedPageOrder = pageOrder

    // contentPdfEditable 조회 (없으면 편집 허용 기본).
    // ⚠️ 공개 엔드포인트(`/with-templates`, @Public) — `GET /template-sets/:id` 는 JWT 필수라
    //    게스트 세션에서 401 → catch 폴백으로 항상 '편집 허용'이 되어 잠금 설정이 무력화됐다
    //    (2026-08-13 실기 적발).
    let editable = true
    if (templateSetId) {
      try {
        const res = await templateSetsApi.getTemplateSetWithTemplates(templateSetId)
        editable = (res?.templateSet as any)?.contentPdfEditable !== false
      } catch {
        /* 조회 실패 시 편집 허용 기본 유지 */
      }
    }

    const { allCanvas, allEditors } = useAppStore.getState()
    if (allCanvas.length <= 1) return // 스프레드(0) 외 내지 페이지 없음

    // 내지 페이지: allCanvas[1..N] (index 0 = 스프레드 표지)
    // G4: pageOrder[k] 가 있으면 슬롯 k 에 원본 PDF 페이지 pageOrder[k] 를 깐다.
    for (let i = 1; i < allCanvas.length; i++) {
      const canvas: any = allCanvas[i]
      const slot = i - 1
      const pdfIndex = pageOrder?.[slot] ?? slot
      const url = Number.isInteger(pdfIndex) ? guide.pageImageUrls[pdfIndex] : undefined

      // 멱등: 직전 호출(세션 로드 등)이 깔아둔 가이드/레이블을 먼저 제거한다.
      removeExistingGuides(canvas)

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

/**
 * W1-G5(2026-08-13): 첨부 PDF 페이지 수만큼 내지 캔버스를 **즉시** 확장한다.
 *
 * 종전엔 확장이 로드 경로(loadTemplateSetEditor 의 underlayPageCount)에만 있어서, 첨부
 * 직후에는 페이지 수가 그대로였고 재로드해야 늘어났다. 이 함수는 살아있는 편집기에
 * `addInnerPage()`(= 로드 경로가 쓰는 것과 동일한 생성기)로 부족분만 추가한다.
 *
 * 계약:
 * - **추가만** 한다(감소 없음) — 로드 경로도 `target > current` 일 때만 늘리므로 대칭이고,
 *   사용자가 직접 추가한 페이지를 첨부가 지우지 않는다.
 * - 스프레드 모드(표지=캔버스0) 전용. 포토북 내지 전용 세트(regionScope='inner')는 캔버스0이
 *   이미 펼침면이라 가이드의 인덱스 규약(1..N=내지)과 어긋나므로 대상에서 제외한다.
 *
 * @returns 실제로 추가된 페이지 수
 */
export async function ensureUnderlayPages(pageCount?: number | null): Promise<number> {
  const requested = Math.floor(Number(pageCount ?? 0))
  if (!Number.isFinite(requested) || requested <= 0) return 0
  const target = Math.min(requested, UNDERLAY_MAX_PAGES)
  if (requested > UNDERLAY_MAX_PAGES) {
    console.warn(
      `[contentPdfGuide] underlay ${requested}p > 상한 ${UNDERLAY_MAX_PAGES} — 상한까지만 표시`,
    )
  }

  const app = useAppStore.getState()
  if (!app.isSpreadMode) {
    console.warn('[contentPdfGuide] ensureUnderlayPages: 스프레드 모드 아님 — 확장 스킵')
    return 0
  }
  if (useSettingsStore.getState().spreadConfig?.regionScope === 'inner') {
    // 내지 전용 펼침면 세트: 캔버스0=펼침면 — 표지 인덱스 규약 불일치(가이드도 미대응)
    return 0
  }

  const before = app.allCanvas.length - 1
  let inner = before
  // 상한 회수 가드: addInnerPage 가 실패(컨테이너 부재 등)해도 무한 루프에 빠지지 않게 한다.
  for (let guard = 0; inner < target && guard < UNDERLAY_MAX_PAGES; guard++) {
    await useAppStore.getState().addInnerPage()
    const next = useAppStore.getState().allCanvas.length - 1
    if (next <= inner) {
      console.warn('[contentPdfGuide] addInnerPage 가 페이지를 늘리지 못함 — 확장 중단', {
        inner,
        target,
      })
      break
    }
    inner = next
  }
  return Math.max(0, inner - before)
}

export interface SeatContentPdfResult {
  /** 이번 호출로 추가된 내지 페이지 수 */
  addedPages: number
  /** 가이드 이미지가 배치됐는지(래스터 미완료·실패 시 false) */
  guidesPlaced: boolean
}

/**
 * W1(2026-08-13): 내지 PDF를 편집기에 '앉힌다' = 페이지 확장(G5) + 가이드 배치(G1).
 *
 * 호출 지점 3곳이 같은 함수를 쓴다(대칭 — F4 사고 전례):
 *  1) /embed 세션 로드 직후(가이드 배치. 확장은 loadTemplateSetEditor 가 이미 수행 → no-op)
 *  2) /embed 첨부 완료 직후(재로드 없이 즉시 앉히기)
 *  3) EditorView(/) 게스트 세션 로드/첨부 직후
 *
 * ⚠️ 인쇄 계약은 표시전용 그대로 — 가이드는 excludeFromExport, 최종 내지는 첨부 원본 PDF.
 */
export async function seatContentPdf(
  editSession: any,
  templateSetId?: string | null,
  options?: {
    /** 앉힌 직후 첫 내지 페이지로 이동(첨부 직후 UX). 로드 경로에서는 쓰지 않는다. */
    focusFirstInnerPage?: boolean
  },
): Promise<SeatContentPdfResult> {
  if (!isUnderlaySession(editSession)) return { addedPages: 0, guidesPlaced: false }

  // 새 앉히기: 세션에 저장된 매핑만 채택. 없으면 identity 로 리셋(이전 세션 누수 방지).
  rememberContentPdfPageOrder(readContentPdfPageOrder(editSession))

  const addedPages = await ensureUnderlayPages(editSession?.contentPdfPageCount)
  await applyContentPdfGuides(editSession, templateSetId)

  const guidesPlaced = !!editSession?.metadata?.contentPdfGuide?.pageImageUrls?.length

  if (options?.focusFirstInnerPage) {
    const { allCanvas, setPage } = useAppStore.getState()
    if (allCanvas.length > 1) setPage(1)
  }

  return { addedPages, guidesPlaced }
}
