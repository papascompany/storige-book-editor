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
 * 좌표: 원본 mm 균일 스케일 + trim 칸 중심(펼침면은 좌=PDF 2k, 우=2k+1).
 * 축 독립 늘리기 금지. 작업사이즈 페이지는 접힘선에서 안쪽 블리드가 겹친다.
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
import { apiClient } from '../api/client'
import { permuteContentPdfPageOrder } from './innerPageReorder'
import {
  DEFAULT_GUIDE_DPI,
  neededInnerCanvases,
  pdfSizeMmFromRaster,
  sheetSeatSlots,
  spreadPdfIndices,
  spreadSeatSlots,
  type SeatSlot,
  uniformMmScale,
  workspacePoint,
  type WorkspaceBox,
} from './contentPdfSeatLayout'

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

/**
 * 주문 화면에서 이미 올린 내지 PDF 는 세션 `contentFileId` 에만 들어 있는 경우가 많다
 * (create DTO 에 contentPdfFileId 가 없음). underlay 로 승격할 수 있으면 그 fileId 를 돌려준다.
 * 완료 세션의 편집 산출물(contentFileId)은 승격하지 않는다.
 */
export function resolveUnderlaySource(editSession: any): {
  fileId: string
  pageCount: number | null
} | null {
  if (!editSession) return null
  if (editSession.contentPdfMode === 'replace') return null
  if (editSession.contentPdfFileId) {
    return {
      fileId: String(editSession.contentPdfFileId),
      pageCount: Number(editSession.contentPdfPageCount) || null,
    }
  }
  if (editSession.status === 'complete') return null
  if (!editSession.contentFileId) return null
  return {
    fileId: String(editSession.contentFileId),
    pageCount: Number(editSession.contentPdfPageCount) || null,
  }
}

function seatingContext(): {
  innerStart: number
  pairOnSpread: boolean
  leafWidthMm: number
  leafHeightMm: number
  workspaceWidthMm: number
} {
  const settings = useSettingsStore.getState()
  const cfg = settings.spreadConfig
  const pairOnSpread = cfg?.regionScope === 'inner' || !!cfg?.innerSpec
  const innerStart = cfg?.regionScope === 'inner' || settings.hasCoverSlot === false ? 0 : 1
  const size = settings.currentSettings?.size
  const leafWidthMm = cfg?.innerSpec?.pageWidthMm || size?.width || 210
  const leafHeightMm = cfg?.innerSpec?.pageHeightMm || size?.height || 297
  const workspaceWidthMm = pairOnSpread ? leafWidthMm * 2 : leafWidthMm
  return { innerStart, pairOnSpread, leafWidthMm, leafHeightMm, workspaceWidthMm }
}

async function placeGuideImage(
  canvas: { insertAt: (o: unknown, idx: number, n: boolean) => void; getObjects: () => unknown[]; requestRenderAll: () => void },
  img: { width?: number; height?: number; set: (p: Record<string, unknown>) => void; meta?: { system?: string } },
  slot: SeatSlot,
  workspaceWidthMm: number,
  guideDpi: number,
): Promise<void> {
  const objs = canvas.getObjects() as Array<{ id?: string }>
  const ws = objs.find((o) => o.id === 'workspace') as WorkspaceBox | undefined
  if (!ws || !img.width || !img.height || !(workspaceWidthMm > 0)) return
  const wsW = (ws.width || 0) * (ws.scaleX || 1)
  if (!(wsW > 0)) return
  const pdf = pdfSizeMmFromRaster(img.width, img.height, guideDpi)
  const scale = uniformMmScale(img.width, pdf.width, wsW, workspaceWidthMm)
  const pt = workspacePoint(ws, slot.centerFracX, slot.centerFracY)
  img.set({
    left: pt.x,
    top: pt.y,
    originX: 'center',
    originY: 'center',
    angle: ws.angle || 0,
    scaleX: scale,
    scaleY: scale,
  })
  img.meta = { system: GUIDE_SYSTEM }
  const wsIdx = objs.findIndex((o) => o.id === 'workspace')
  canvas.insertAt(img, wsIdx >= 0 ? wsIdx + 1 : 0, false)
  canvas.requestRenderAll()
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
    const seat = seatingContext()
    if (allCanvas.length <= seat.innerStart) return

    const guideDpi =
      Number((guide as { resolution?: number }).resolution) > 0
        ? Number((guide as { resolution?: number }).resolution)
        : DEFAULT_GUIDE_DPI
    const urls = guide.pageImageUrls as string[]
    const sheetSlots = sheetSeatSlots(seat.leafWidthMm, seat.leafHeightMm)
    const pairSlots = spreadSeatSlots(seat.leafWidthMm, seat.leafHeightMm)

    for (let i = seat.innerStart; i < allCanvas.length; i++) {
      const canvas: any = allCanvas[i]
      const innerIndex = i - seat.innerStart
      removeExistingGuides(canvas)

      const placements: { url?: string; slot: SeatSlot }[] = seat.pairOnSpread
        ? (() => {
            const idx = spreadPdfIndices(innerIndex, pageOrder)
            return [
              { url: urls[idx.left], slot: pairSlots[0] },
              { url: urls[idx.right], slot: pairSlots[1] },
            ]
          })()
        : [
            {
              url: urls[pageOrder?.[innerIndex] ?? innerIndex],
              slot: sheetSlots[0],
            },
          ]

      for (const p of placements) {
        if (!p.url) continue
        try {
          const img: any = await imageFromURL(resolveStorageUrl(p.url), {
            excludeFromExport: true,
            selectable: false,
            evented: false,
            hasControls: false,
            hasBorders: false,
          })
          await placeGuideImage(canvas, img, p.slot, seat.workspaceWidthMm, guideDpi)
        } catch (e) {
          console.warn('[contentPdfGuide] place failed page', i, p.slot.side, e)
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
    if (!editable && allCanvas[seat.innerStart]) {
      try {
        const fabric: any = getFabricSync()
        const c: any = allCanvas[seat.innerStart]
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
 * - 표지 칸이 있으면 캔버스0을 건너뛴다. 표지없음·내지펼침면은 캔버스0부터.
 * - 내지펼침면은 PDF 2장 = 캔버스 1장(좌·우). 단면은 1장 = 1캔버스.
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
  const seat = seatingContext()
  const needed = neededInnerCanvases(target, seat.pairOnSpread)
  const before = Math.max(0, app.allCanvas.length - seat.innerStart)
  let inner = before
  const grow = async () => {
    const state = useAppStore.getState()
    if (state.isSpreadMode) await state.addInnerPage()
    else await state.addPage()
  }
  for (let guard = 0; inner < needed && guard < UNDERLAY_MAX_PAGES; guard++) {
    await grow()
    const next = Math.max(0, useAppStore.getState().allCanvas.length - seat.innerStart)
    if (next <= inner) {
      console.warn('[contentPdfGuide] 페이지를 늘리지 못함 — 확장 중단', { inner, needed })
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
    const innerStart = seatingContext().innerStart
    if (allCanvas.length > innerStart) setPage(innerStart)
  }

  return { addedPages, guidesPlaced }
}

async function rasterContentPdfGuide(
  fileId: string,
  pageCount?: number | null,
): Promise<{ sourceFileId: string; pageImageUrls: string[]; resolution?: number; renderedAt?: string } | null> {
  try {
    const renderRes = await apiClient.post<{ id: string }>('/worker-jobs/render-pages', {
      fileId,
      ...(pageCount && pageCount > 0 ? { pageCount } : {}),
    })
    const jobId = renderRes.data.id
    for (let a = 0; a < 40; a++) {
      await new Promise((r) => setTimeout(r, 1500))
      const job = await apiClient.get<{
        status: string
        result?: { pageImageUrls?: string[]; resolution?: number; renderedAt?: string }
      }>(`/worker-jobs/${jobId}`)
      const s = (job.data.status || '').toUpperCase()
      if (s === 'COMPLETED') {
        const urls = job.data.result?.pageImageUrls
        if (!urls?.length) return null
        return {
          sourceFileId: fileId,
          pageImageUrls: urls,
          resolution: job.data.result?.resolution,
          renderedAt: job.data.result?.renderedAt,
        }
      }
      if (s === 'FAILED') return null
    }
  } catch (e) {
    console.warn('[contentPdfGuide] rasterContentPdfGuide failed', e)
  }
  return null
}

/**
 * 주문 화면에서 이미 올린 내지 PDF 를 편집기에 앉힌다.
 * 세션이 underlay 가 아니어도 contentFileId 만 있으면 승격한다(완료 세션 제외).
 * 가이드 래스터가 없으면 render-pages 를 한 번 돌린다.
 */
export async function ensureSeatExistingContentPdf(
  editSession: any,
  templateSetId?: string | null,
  options?: { focusFirstInnerPage?: boolean },
): Promise<SeatContentPdfResult & { sourceFileId?: string }> {
  const source = resolveUnderlaySource(editSession)
  if (!source) return { addedPages: 0, guidesPlaced: false }

  let session: Record<string, unknown> = {
    ...(editSession as Record<string, unknown>),
    contentPdfMode: 'underlay',
    contentPdfFileId: source.fileId,
    contentPdfPageCount: source.pageCount ?? editSession?.contentPdfPageCount ?? null,
  }

  const existingGuide = (editSession?.metadata as { contentPdfGuide?: { pageImageUrls?: string[] } } | undefined)
    ?.contentPdfGuide
  if (!existingGuide?.pageImageUrls?.length) {
    const guide = await rasterContentPdfGuide(source.fileId, source.pageCount)
    if (guide) {
      session = {
        ...session,
        contentPdfPageCount: guide.pageImageUrls.length,
        metadata: {
          ...((editSession?.metadata as Record<string, unknown> | undefined) ?? {}),
          contentPdfGuide: guide,
        },
      }
    }
  }

  const result = await seatContentPdf(session, templateSetId, options)
  return { ...result, sourceFileId: source.fileId }
}
