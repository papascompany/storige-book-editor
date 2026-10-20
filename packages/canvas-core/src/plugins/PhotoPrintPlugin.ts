import { fabric } from 'fabric';
import { PluginBase } from '../plugin';
import type Editor from '../Editor';
import type CanvasHotkey from '../models/CanvasHotkey';

/**
 * PhotoPrintPlugin — 사진인화(P2-d, 2026-10-19) 사진틀 채움 규칙·촬영일·흑백 적용
 *
 * - 대상: 캔버스의 사진틀(`extensionType:'frame'`)과 그 틀에 채워진 사진(`extensionType:'fillImage'`,
 *   `parentLayerId === frame.id` — FrameInteractionPlugin 과 같은 링크 규약).
 * - 틀 객체 자체·clipPath 의 absolutePositioned/inverted 규약은 바꾸지 않는다. fitMode 는 사진 스케일 한 줄
 *   (cover=Math.max / contain=Math.min — 기본 cover 는 기존 fillImageIntoFrame 산식과 동일), 유테(frameInsetMm)는
 *   clip 복제본의 scale 에 `frameInsetScale` 비율을 곱해 마스크 창만 줄인다(띠는 캔버스 배경이 보이는 방식).
 * - 직렬화: 프레임의 `fitMode`/`frameInsetMm` 는 utils/canvas.ts `core.extendFabricOption` 에 등재(미등재 = 저장 1회
 *   왕복에 침묵 유실). 촬영일은 fillImage 의 기존 `extension` 키(`{ takenAt }`) 를 재사용한다.
 *   `FRAME_INSET_PX_RUNTIME_KEY`(__frameInsetPx) 는 FrameInteractionPlugin 이 드래그 중 읽는 런타임 값이며 저장하지 않는다
 *   — 복원 뒤 편집기가 `rehydrate(opts)` 를 명시 호출해 다시 채운다(CalendarPlugin 과 같은 계약, lifecycle 훅 비의존).
 * - 창(window, D3 2026-10-19): 유테 창은 프레임이 아니라 **재단 상자** 기준이다. 도련(bleed) 세트의 풀블리드 틀은 workspace 전체
 *   (재단+도련)라 프레임 가장자리 기준 inset 은 재단 뒤 사라지므로, `opts.bleedPx`(workspace 가 재단 상자보다 각 변에서 바깥으로
 *   확장된 px) 로 trim = workspace − bleed 를 구해 (frame ∩ trim) 을 inset 만큼 줄인 창을 쓴다. 결과는 프레임 런타임 키
 *   `FRAME_WINDOW_RUNTIME_KEY`(__frameWindow, `{ sx, sy, cx, cy }`) 에, bleedPx 는 캔버스 런타임 키
 *   `PHOTO_PRINT_BLEED_PX_RUNTIME_KEY`(__photoPrintBleedPx) 에 둔다(둘 다 비직렬화). insetPx 0 이면 창 = 프레임(종전과 동일).
 *   FrameInteractionPlugin 은 런타임 키가 없어도(undo 로 틀 인스턴스 재생성) 직렬화된 `frameInsetMm` + 캔버스 bleed 로 창을
 *   다시 계산하고, apply/rehydrate 는 옵션이 같아도 clip 복제본을 창에 다시 맞춘다(자가 복구).
 * - 흑백: `fabric.Image.filters.Grayscale` 에 `effectType:'photo-print'` 태그로 멱등 토글(FilterPlugin 의 effectType 패턴).
 *   fabric 은 필터의 커스텀 태그를 직렬화하지 않으므로 fillImage `extension.grayscale` 에 소유 여부를 함께 기록하고,
 *   복원 뒤에는 태그 없는 Grayscale 1개를 다시 입양한다(없으면 중복 추가·해제 불가가 된다).
 * - undo 미기록: historyProcessing 플래그만 올리고 끝나면 history 기준 상태를 현재로 맞춘다(CalendarPlugin.rehydrate 패턴).
 */

export type PhotoFitMode = 'cover' | 'contain';

export interface PhotoPrintCanvasOptions {
  /** 페이퍼풀(cover, 기본) | 이미지풀(contain) */
  fitMode: PhotoFitMode;
  /** 유테 — 사진틀 창을 사방 이만큼(mm) 줄인다. 0 = 유테 없음(기존 동작) */
  frameInsetMm: number;
  /** 촬영일(`date-overlay` 텍스트) 표시 여부 */
  dateOverlay: boolean;
  /** 흑백 필터 */
  grayscale: boolean;
  /** 캔버스 단위 환산(편집기 주입) */
  mmToPx: (mm: number) => number;
  /**
   * workspace(id 'workspace')가 재단 상자보다 각 변에서 바깥으로 확장된 px(도련). 재단선 없음·cropMark off 면 0/생략.
   * 유테 창은 (프레임 ∩ (workspace − bleed)) 기준으로 줄어든다.
   */
  bleedPx?: number;
}

/** 축 정렬 상자(캔버스 좌표, left/top = 좌상단) */
export interface FrameBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 마스크 창 — 프레임 bbox 대비 축별 비율(sx, sy)과 창 중심(cx, cy — 캔버스 좌표). inset 0 = {1, 1, 프레임 중심} */
export interface FrameWindow {
  sx: number;
  sy: number;
  cx: number;
  cy: number;
}

/** 촬영일 텍스트 객체(템플릿 저작)의 extensionType */
export const DATE_OVERLAY_EXTENSION_TYPE = 'date-overlay';
/** 이 플러그인이 붙이는 Grayscale 필터의 effectType 태그 */
export const PHOTO_PRINT_EFFECT_TYPE = 'photo-print';
/** 프레임에 붙는 런타임(비직렬화) 유테 px — FrameInteractionPlugin._syncFromFrame 이 읽는다 */
export const FRAME_INSET_PX_RUNTIME_KEY = '__frameInsetPx';
/** 프레임에 붙는 런타임(비직렬화) 마스크 창(`FrameWindow`) — apply/_syncFromFrame 이 갱신, 편집기 채움 경로가 읽는다 */
export const FRAME_WINDOW_RUNTIME_KEY = '__frameWindow';
/** 캔버스에 붙는 런타임(비직렬화) 도련 px — 틀 인스턴스가 재생성돼도 캔버스 인스턴스는 유지되므로 폴백 원천 */
export const PHOTO_PRINT_BLEED_PX_RUNTIME_KEY = '__photoPrintBleedPx';

const FRAME_EXTENSION_TYPE = 'frame';
const FILL_IMAGE_EXTENSION_TYPE = 'fillImage';
const GRAYSCALE_FILTER_TYPE = 'Grayscale';
const WORKSPACE_ID = 'workspace';

/** 사진틀에 붙는 커스텀 속성(extendFabricOption 등재분 + 런타임) */
interface FrameObjectProps {
  id?: string;
  extensionType?: string;
  fitMode?: PhotoFitMode;
  frameInsetMm?: number;
  __frameInsetPx?: number;
  __frameWindow?: FrameWindow;
}

/** 캔버스 런타임 키(비직렬화) */
interface PhotoPrintCanvasFields {
  __photoPrintBleedPx?: number;
}

/** fillImage 의 extension — 편집기가 채움 시점에 `takenAt` 을 기록, 플러그인이 `grayscale` 소유 여부를 덧붙인다 */
export interface FillImageExtension {
  takenAt?: string;
  grayscale?: boolean;
  [key: string]: unknown;
}

interface FillImageProps {
  id?: string;
  extensionType?: string;
  parentLayerId?: string;
  extension?: FillImageExtension;
}

/** date-overlay 텍스트의 extension — `frameId` 로 특정 사진틀에 묶을 수 있다(없으면 캔버스의 첫 채워진 틀) */
export interface DateOverlayExtension {
  frameId?: string;
  [key: string]: unknown;
}

interface DateOverlayProps {
  extensionType?: string;
  extension?: DateOverlayExtension;
  text?: string;
}

type FrameObject = fabric.Object & FrameObjectProps;
type FillImageObject = fabric.Image & FillImageProps;
type DateOverlayObject = fabric.Object & DateOverlayProps;
type TaggedFilter = fabric.IBaseFilter & { type?: string; effectType?: string };

/** fabric-history(utils/history.ts) 가 fabric.Canvas 에 붙이는 필드 — 정적 캔버스(테스트)에는 없을 수 있어 선택 */
interface HistoryCanvasFields {
  historyProcessing?: boolean;
  isHistoryReady?: boolean;
  historyNextState?: string | null;
  _historyNext?: () => string;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 유테 비율 — 마스크 창(clip 복제본)의 scale 에 곱할 축별 비율.
 * inset 0·비유한·틀 크기 0 이하·inset 이 짧은 변의 절반 이상이면 {1,1}(기존 값 그대로).
 */
export function frameInsetScale(frameW: number, frameH: number, insetPx: number): { sx: number; sy: number } {
  if (!isFiniteNumber(insetPx) || insetPx <= 0) return { sx: 1, sy: 1 };
  if (!isFiniteNumber(frameW) || !isFiniteNumber(frameH) || frameW <= 0 || frameH <= 0) return { sx: 1, sy: 1 };
  if (insetPx * 2 >= Math.min(frameW, frameH)) return { sx: 1, sy: 1 };
  return { sx: (frameW - insetPx * 2) / frameW, sy: (frameH - insetPx * 2) / frameH };
}

/**
 * 사진 스케일 — cover 는 기존 fillImageIntoFrame 산식 `Math.max(frameW / imgW, frameH / imgH)` 과 바이트 동일, contain 은 Math.min.
 * 이미지 크기가 0 이하·비유한이면 1.
 */
export function resolveFillScale(frameW: number, frameH: number, imgW: number, imgH: number, fit: PhotoFitMode): number {
  if (!isFiniteNumber(imgW) || !isFiniteNumber(imgH) || imgW <= 0 || imgH <= 0) return 1;
  if (!isFiniteNumber(frameW) || !isFiniteNumber(frameH)) return 1;
  return fit === 'contain' ? Math.min(frameW / imgW, frameH / imgH) : Math.max(frameW / imgW, frameH / imgH);
}

/**
 * 마스크 창 상자 — insetPx>0 이면 (frame ∩ trim)(trim 이 null 이면 frame) 을 각 변 insetPx 만큼 안쪽으로 줄인다.
 * insetPx===0·비유한이면 frame 그대로(종전 동작·바이트 동일). 교집합이 비거나 inset 이 창을 없애면(짧은 변의 절반 이상)
 * frame 그대로 돌려준다(frameInsetScale 의 {1,1} 규칙과 동일).
 */
export function resolveFrameWindow(frame: FrameBox, trim: FrameBox | null, insetPx: number): FrameBox {
  if (!isFiniteNumber(insetPx) || insetPx <= 0) return { ...frame };
  let base: FrameBox = frame;
  if (trim) {
    const left = Math.max(frame.left, trim.left);
    const top = Math.max(frame.top, trim.top);
    const right = Math.min(frame.left + frame.width, trim.left + trim.width);
    const bottom = Math.min(frame.top + frame.height, trim.top + trim.height);
    if (right - left > 0 && bottom - top > 0) base = { left, top, width: right - left, height: bottom - top };
  }
  if (!isFiniteNumber(base.width) || !isFiniteNumber(base.height) || base.width <= 0 || base.height <= 0) return { ...frame };
  if (insetPx * 2 >= Math.min(base.width, base.height)) return { ...frame };
  return {
    left: base.left + insetPx,
    top: base.top + insetPx,
    width: base.width - insetPx * 2,
    height: base.height - insetPx * 2,
  };
}

/** 창 상자 → 프레임 bbox 대비 축별 비율 + 창 중심. 프레임 크기가 0 이하면 비율 1 */
export function frameWindowTransform(frame: FrameBox, window: FrameBox): FrameWindow {
  const sx = isFiniteNumber(frame.width) && frame.width > 0 ? window.width / frame.width : 1;
  const sy = isFiniteNumber(frame.height) && frame.height > 0 ? window.height / frame.height : 1;
  return { sx, sy, cx: window.left + window.width / 2, cy: window.top + window.height / 2 };
}

/**
 * 객체의 축 정렬 상자 — clip 복제본 규약(width = frame.width, scale = frame.scale)과 같은 기준으로
 * width×scaleX / height×scaleY 를 중심점 둘레에 둔다(stroke 폭·회전은 반영하지 않는다).
 */
function objectBox(obj: fabric.Object): FrameBox {
  const width = (obj.width ?? 0) * (obj.scaleX ?? 1);
  const height = (obj.height ?? 0) * (obj.scaleY ?? 1);
  const center = obj.getCenterPoint();
  return { left: center.x - width / 2, top: center.y - height / 2, width, height };
}

/**
 * 프레임의 마스크 창 — 프레임 bbox 와 trim(workspace bbox 를 bleedPx 만큼 안쪽으로; workspace 없으면 null)을 합성한다.
 * insetPx 0 이면 {1, 1, 프레임 중심}.
 */
export function resolveFrameWindowFor(
  frame: fabric.Object,
  canvas: fabric.Canvas,
  insetPx: number,
  bleedPx: number,
): FrameWindow {
  const frameBox = objectBox(frame);
  let trim: FrameBox | null = null;
  const workspace = canvas.getObjects().find((o) => o.id === WORKSPACE_ID);
  if (workspace) {
    const ws = objectBox(workspace);
    const bleed = isFiniteNumber(bleedPx) && bleedPx > 0 ? bleedPx : 0;
    trim = { left: ws.left + bleed, top: ws.top + bleed, width: ws.width - bleed * 2, height: ws.height - bleed * 2 };
  }
  return frameWindowTransform(frameBox, resolveFrameWindow(frameBox, trim, insetPx));
}

const TAKEN_AT_DATE_RE = /^(\d{4})[-:./](\d{2})[-:./](\d{2})/;
const TAKEN_AT_ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * 촬영일 → 'YYYY.MM.DD'.
 * - ISO 일시('YYYY-MM-DDTHH:mm…', 오프셋/Z 포함 여부 무관)는 `new Date(iso)` 의 **로컬** 연·월·일(브라우저 TZ) — exifr 가
 *   EXIF 로컬시각을 브라우저 TZ Date 로 만들어 UTC ISO 로 저장하므로 UTC 날짜 부분을 읽으면 자정 전후 촬영이 전날로 밀린다.
 * - TZ 없는 'YYYY-MM-DD' 와 EXIF 원문 'YYYY:MM:DD HH:mm:ss' 는 날짜 부분 그대로.
 * 해석 불가면 null.
 */
export function formatTakenAt(iso: string): string | null {
  if (typeof iso !== 'string') return null;
  const raw = iso.trim();
  if (TAKEN_AT_ISO_DATETIME_RE.test(raw)) {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
  }
  const m = TAKEN_AT_DATE_RE.exec(raw);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${m[1]}.${m[2]}.${m[3]}`;
}

type FilterCtor = { fromObject?: (object: Record<string, unknown>, callback?: (f: unknown) => void) => unknown };

function isLiveFilter(f: unknown): f is TaggedFilter {
  return !!f && typeof f === 'object' && typeof (f as { applyTo?: unknown }).applyTo === 'function';
}

/**
 * fabric-history `_loadHistory` 의 `set(historyObj)` 는 filters 를 plain 객체(applyTo/isNeutralState 없음)로 되돌린다 —
 * 그대로 applyFilters 하면 TypeError. 원소가 BaseFilter 인스턴스가 아니면 `fabric.Image.filters[type].fromObject` 로 되살리고,
 * 되살릴 수 없는 항목(미지 type·비동기 fromObject)은 경고 후 제외한다. `revived` 가 true 면 호출자가 목록을 다시 써야 한다.
 */
function reviveFilters(input: unknown): { filters: TaggedFilter[]; revived: boolean } {
  const list = Array.isArray(input) ? input : [];
  const filters: TaggedFilter[] = [];
  let revived = false;
  for (const f of list) {
    if (isLiveFilter(f)) {
      filters.push(f);
      continue;
    }
    revived = true;
    if (!f || typeof f !== 'object') continue;
    const type = (f as { type?: unknown }).type;
    const ctor = typeof type === 'string' ? (fabric.Image.filters as unknown as Record<string, FilterCtor | undefined>)[type] : undefined;
    if (!ctor || typeof ctor.fromObject !== 'function') {
      console.warn('[PhotoPrintPlugin] 복원할 수 없는 필터를 제외', type);
      continue;
    }
    try {
      const live = ctor.fromObject(f as Record<string, unknown>);
      if (isLiveFilter(live)) filters.push(live);
      else console.warn('[PhotoPrintPlugin] 동기 복원 불가 필터를 제외', type);
    } catch (e) {
      console.warn('[PhotoPrintPlugin] 필터 복원 실패 — 제외', type, e);
    }
  }
  return { filters, revived };
}

class PhotoPrintPlugin extends PluginBase {
  public name = 'PhotoPrintPlugin';
  public events: string[] = [];
  public hotkeys: CanvasHotkey[] = [];

  constructor(canvas: fabric.Canvas, editor: Editor) {
    super(canvas, editor, {});
  }

  /** 이 캔버스의 사진틀 목록(캔버스 순서) */
  getFrames(): FrameObject[] {
    return (this._canvas.getObjects() as FrameObject[]).filter((o) => o.extensionType === FRAME_EXTENSION_TYPE);
  }

  /** 이 캔버스의 date-overlay 텍스트 목록 */
  getDateOverlays(): DateOverlayObject[] {
    return (this._canvas.getObjects() as DateOverlayObject[]).filter(
      (o) => o.extensionType === DATE_OVERLAY_EXTENSION_TYPE,
    );
  }

  /** 객체가 date-overlay 텍스트인지 */
  static isDateOverlay(obj: fabric.Object | null | undefined): obj is DateOverlayObject {
    return !!obj && (obj as DateOverlayProps).extensionType === DATE_OVERLAY_EXTENSION_TYPE;
  }

  /** 틀에 채워진 사진 — parentLayerId 규약(FrameInteractionPlugin._findFore 와 동일) */
  findFillImage(frame: FrameObject): FillImageObject | undefined {
    const fid = frame.id;
    if (!fid) return undefined;
    return (this._canvas.getObjects() as unknown as FillImageObject[]).find(
      (o) => o.extensionType === FILL_IMAGE_EXTENSION_TYPE && o.parentLayerId === fid,
    );
  }

  /**
   * 옵션을 캔버스에 적용한다.
   *  0) 캔버스에 bleedPx 런타임 키 기록.
   *  1) 모든 사진틀에 fitMode/frameInsetMm 기록(+런타임 inset px·창 `__frameWindow`). 값이 바뀐 틀(또는 미기록 틀)은 채워진
   *     사진의 스케일·중심을 창에 다시 맞추고, 값이 같으면 사용자의 adjust(pan/zoom)를 보존하되 clip 복제본만 창에 다시 맞춘다
   *     (undo 재생성 등으로 어긋난 마스크 창 자가 복구 — clip 은 순수 파생 상태라 안전).
   *  2) date-overlay 텍스트를 연결 사진의 extension.takenAt 으로 갱신(없거나 off 면 빈 문자열).
   *  3) 채워진 사진마다 Grayscale 필터를 멱등 토글(undo 로 plain 객체가 된 필터는 fromObject 로 되살린다).
   * undo 스택에 기록하지 않는다. 한 틀의 처리 실패(필터 적용 예외 등)는 경고만 남기고 다음 틀로 진행한다.
   * @returns 처리한 사진틀 수
   */
  async apply(opts: PhotoPrintCanvasOptions): Promise<number> {
    const canvas = this._canvas as fabric.Canvas & HistoryCanvasFields;
    const prevProcessing = canvas.historyProcessing;
    canvas.historyProcessing = true;
    let count = 0;
    try {
      const fit: PhotoFitMode = opts.fitMode === 'contain' ? 'contain' : 'cover';
      const insetMm = isFiniteNumber(opts.frameInsetMm) && opts.frameInsetMm > 0 ? opts.frameInsetMm : 0;
      const insetPx = insetMm > 0 ? opts.mmToPx(insetMm) : 0;
      const bleedPx = isFiniteNumber(opts.bleedPx) && opts.bleedPx > 0 ? opts.bleedPx : 0;
      (canvas as fabric.Canvas & PhotoPrintCanvasFields)[PHOTO_PRINT_BLEED_PX_RUNTIME_KEY] = bleedPx;
      for (const frame of this.getFrames()) {
        const changed = frame.fitMode !== fit || frame.frameInsetMm !== insetMm;
        frame.fitMode = fit;
        frame.frameInsetMm = insetMm;
        frame.__frameInsetPx = insetPx;
        const window = resolveFrameWindowFor(frame, canvas, insetPx, bleedPx);
        frame.__frameWindow = window;
        const fore = this.findFillImage(frame);
        if (fore) {
          if (changed) this.syncFill(frame, fore, fit, window);
          else this.syncClip(frame, fore, window);
          try {
            this.toggleGrayscale(fore, opts.grayscale);
          } catch (e) {
            console.warn('[PhotoPrintPlugin] grayscale 적용 실패 — 다음 틀로 진행', frame.id, e);
          }
        }
        count += 1;
      }
      this.updateDateOverlays(opts.dateOverlay);
    } finally {
      canvas.historyProcessing = prevProcessing;
      if (canvas.isHistoryReady && typeof canvas._historyNext === 'function') {
        canvas.historyNextState = canvas._historyNext();
      }
    }
    canvas.requestRenderAll();
    return count;
  }

  /** 캔버스 복원(loadFromJSON) 뒤 편집기가 명시 호출 — 저장된 fitMode/frameInsetMm 를 읽어 런타임 값·필터 태그를 되살린다 */
  async rehydrate(opts: PhotoPrintCanvasOptions): Promise<number> {
    return this.apply(opts);
  }

  // ─── 내부 ──────────────────────────────────────────────────────────────

  /** 사진 scale 을 창 기준 cover/contain 으로 다시 맞추고 창 중심에 배치 + clip 복제본 동기화 */
  private syncFill(frame: FrameObject, fore: FillImageObject, fit: PhotoFitMode, window: FrameWindow): void {
    const frameW = (frame.width ?? 0) * (frame.scaleX ?? 1);
    const frameH = (frame.height ?? 0) * (frame.scaleY ?? 1);
    const scale = resolveFillScale(frameW * window.sx, frameH * window.sy, fore.width ?? 0, fore.height ?? 0, fit);
    fore.set({ scaleX: scale, scaleY: scale });
    fore.setPositionByOrigin(new fabric.Point(window.cx, window.cy), 'center', 'center');
    fore.setCoords();
    this.syncClip(frame, fore, window);
  }

  /** 마스크 창(absolutePositioned clip 복제본)을 창 중심·프레임 scale×창 비율로 — FrameInteractionPlugin._syncFromFrame 과 같은 규약 */
  private syncClip(frame: FrameObject, fore: FillImageObject, window: FrameWindow): void {
    const cp = fore.clipPath as fabric.Object | undefined;
    if (!cp) return;
    cp.set({
      left: window.cx,
      top: window.cy,
      scaleX: window.sx === 1 ? frame.scaleX : (frame.scaleX ?? 1) * window.sx,
      scaleY: window.sy === 1 ? frame.scaleY : (frame.scaleY ?? 1) * window.sy,
      angle: frame.angle,
      flipX: frame.flipX,
      flipY: frame.flipY,
    });
    cp.setCoords();
  }

  private updateDateOverlays(enabled: boolean): void {
    const overlays = this.getDateOverlays();
    if (overlays.length === 0) return;
    const frames = this.getFrames();
    for (const overlay of overlays) {
      let text = '';
      if (enabled) {
        const frameId = overlay.extension?.frameId;
        const frame = frameId
          ? frames.find((f) => f.id === frameId)
          : frames.find((f) => !!this.findFillImage(f));
        const fore = frame ? this.findFillImage(frame) : undefined;
        const takenAt = fore?.extension?.takenAt;
        text = typeof takenAt === 'string' ? formatTakenAt(takenAt) ?? '' : '';
      }
      if (overlay.text !== text) {
        overlay.set({ text } as Partial<fabric.Object>);
        overlay.setCoords();
      }
    }
  }

  private toggleGrayscale(fore: FillImageObject, on: boolean): void {
    const { filters, revived } = reviveFilters(fore.filters);
    const ext = fore.extension;
    let tagged = filters.filter((f) => f.effectType === PHOTO_PRINT_EFFECT_TYPE);
    // 복원 뒤: 태그는 직렬화되지 않으므로 extension.grayscale 이 소유를 증명하는 Grayscale 1개를 입양한다
    if (tagged.length === 0 && ext?.grayscale === true) {
      const orphan = filters.find((f) => f.type === GRAYSCALE_FILTER_TYPE && f.effectType === undefined);
      if (orphan) {
        orphan.effectType = PHOTO_PRINT_EFFECT_TYPE;
        tagged = [orphan];
      }
    }
    let next: TaggedFilter[];
    let changed = false;
    if (on) {
      if (tagged.length === 0) {
        const filter = new fabric.Image.filters.Grayscale({ effectType: PHOTO_PRINT_EFFECT_TYPE }) as TaggedFilter;
        next = [...filters, filter];
        changed = true;
      } else {
        const keep = tagged[0];
        next = filters.filter((f) => f.effectType !== PHOTO_PRINT_EFFECT_TYPE || f === keep);
        changed = next.length !== filters.length;
      }
      if (ext?.grayscale !== true) {
        fore.extension = { ...(ext ?? {}), grayscale: true };
      }
    } else {
      next = filters.filter((f) => f.effectType !== PHOTO_PRINT_EFFECT_TYPE);
      changed = next.length !== filters.length;
      if (ext && 'grayscale' in ext) {
        const rest: FillImageExtension = { ...ext };
        delete rest.grayscale;
        fore.extension = Object.keys(rest).length > 0 ? rest : undefined;
      }
    }
    if (!changed && !revived) return;
    fore.filters = next;
    if (typeof fore.applyFilters === 'function') {
      try {
        fore.applyFilters();
      } catch (e) {
        console.warn('[PhotoPrintPlugin] applyFilters 실패 — 필터 목록은 갱신됨', fore.id, e);
      }
    }
  }
}

export default PhotoPrintPlugin;
