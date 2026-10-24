import { fabric } from 'fabric';
import { v4 as uuid } from 'uuid';
import { PluginBase } from '../plugin';
import type Editor from '../Editor';
import type CanvasHotkey from '../models/CanvasHotkey';
import {
  CALENDAR_YEAR_MONTH_COUNT,
  addMonths,
  resolveCalendarYearSpan,
  resolveCalendarYearStart,
  type CalendarYearSpan,
} from '@storige/types';
import type { CalendarData, AnniversaryInput, AnniversaryTextStyle, DateKey, MonthCell, MonthMatrix } from '../calendar/types';
import { buildMonthMatrix, buildYearMatrix, getMinorTermsForMonth } from '../calendar/core';

/**
 * CalendarPlugin — 캘린더 날짜 그리드(`extensionType:'calendar-grid'`) 생성·재합성 (P1, 2026-10-17)
 *
 * - 그리드는 fabric.Group 하나. 내부 텍스트(fabric.Text)는 사용자가 개별 편집하지 않는다(그룹 해제는 GroupPlugin 이 차단).
 * - 월은 `extension.monthOffset`(시작연월 기준 상대 월, 선택) 또는 캔버스 위치(`ctx.canvasMonthOffset`)+`monthDelta` 로 정한다.
 *   시작연월을 바꾸면 그리드만 다시 그리고 사진·텍스트는 보존된다.
 * - lifecycle 훅(beforeSave/afterLoad)에 의존하지 않는다. 캔버스 로드 뒤 편집기가 `rehydrate(ctx)` 를 명시 호출한다.
 *   (임베드 저장 경로는 ServicePlugin.saveJSON 훅을 우회하기 때문 — 설계 §2.4)
 * - 그룹 내부 텍스트는 인쇄 대상이므로 `meta.system` 을 붙이지 않는다(ServicePlugin.collectGlyphValidationTargets 가 그룹을 재귀 수집).
 * - 직렬화: 그룹·자식 모두 `extendFabricOption` 등재 속성(id/extensionType/extension/lockInfo/deleteable/movable/contentEditable …)만으로 왕복.
 * - variant 'year'(연달력, 설계 C8, v1.26): 시작연월·`yearSpan`·`yearDelta` 로 정한 첫 달부터 12개월을 날짜 숫자 + 요일/공휴일 색으로만 그린다.
 *   캔버스 위치(monthOffset·monthDelta·canvasMonthOffset)는 쓰지 않고, 날짜 hitTest 대상이 아니다(기념일 폼 미진입). 그 밖 variant 는 rehydrate 가 건너뛴다.
 * - 기념일 문구 스타일(D1(b), T3b): `ctx.anniversaries[].style {fill, fontWeight}` 을 core 가 정제해 칸에 싣고('#rgb'/'#rrggbb'·'normal'|'bold'),
 *   'month' 칸 문구에서 그 기념일 텍스트의 fill·fontWeight 로 쓴다. 문구 3개 제한·순서(공휴일 → 기념일 → 절기 → 잡절 → 음력)는 같다.
 */

export type CalendarGridVariant = 'month' | 'mini' | 'year';

export interface CalendarGridStyle {
  fontFamily?: string;
  /** 날짜 숫자 글자 크기(캔버스 단위). 미지정 시 칸 높이에 비례 */
  fontSize?: number;
  colors?: {
    weekday?: string;
    sunday?: string;
    saturday?: string;
    holiday?: string;
    text?: string;
    muted?: string;
    line?: string;
  };
  /** 요일 헤더 언어 */
  headerLang?: 'en' | 'ko';
  /** 월 제목(큰 숫자·연도·영문 월명) 표시 여부 — month 기본 true, mini 기본 true(작은 'YYYY.M'), year 기본 true(연도 제목) */
  showTitle?: boolean;
  /** 전월·익월 날짜를 흐리게 채울지(기본 false) */
  fillAdjacent?: boolean;
  /** 칸 구분선(기본 month true / mini·year false) */
  showLines?: boolean;
  /** 행 수 — 'fixed6'(기본, 항상 6행) | 'used'(실제 주 수) */
  rows?: 'fixed6' | 'used';
}

export interface CalendarGridExtension {
  variant: CalendarGridVariant;
  /** 시작연월 기준 절대 상대 월(0~11). 없으면 캔버스 월 + monthDelta. month/mini 전용 — 'year' 에서는 무시 */
  monthOffset?: number;
  /** 캔버스 월 기준 상대 이동(mini 전월 -1 / 익월 +1). 기본 0. month/mini 전용 — 'year' 에서는 무시 */
  monthDelta?: number;
  weekStart?: 0 | 1;
  /** `yearTitle` 은 'year' 전용(연도 제목 표시, 생략 = ctx.show.yearTitle). `minorTerms` 는 'month' 칸 문구 전용(생략 = ctx.show.minorTerms) */
  show?: { holidays?: boolean; lunar?: boolean; solarTerms?: boolean; temporaryHolidays?: boolean; yearTitle?: boolean; minorTerms?: boolean };
  style?: CalendarGridStyle;
  /** 'year' 전용 — 시작연도 기준 연도 이동(기본 0). ctx.yearDelta 가 정수면 그 값이 우선 */
  yearDelta?: number;
}

export interface CalendarRenderContext {
  startYear: number;
  /** 1~12 */
  startMonth: number;
  /** 이 캔버스의 상대 월(0~11). 표지·에필로그 캔버스면 null */
  canvasMonthOffset: number | null;
  weekStart: 0 | 1;
  /**
   * `temporaryHolidays`(임시공휴일·선거일 표시)는 생략 시 false — 법정 공휴일만 휴일로 칠한다.
   * `yearTitle`('year' 연도 제목 표시)은 생략 시 true.
   * `minorTerms`(잡절 — 초복·중복·말복 칸 문구, T4)는 생략 시 false. 'month' 칸 문구에만 쓰고 'mini'·'year' 는 문구를 그리지 않는다.
   */
  show: { holidays: boolean; lunar: boolean; solarTerms: boolean; temporaryHolidays?: boolean; yearTitle?: boolean; minorTerms?: boolean };
  anniversaries: AnniversaryInput[];
  data: CalendarData;
  /** 'year' 전용 — 프로파일 calendar.yearPolicy.span. 생략 = 기본 규칙(resolveCalendarYearSpan: 1월 시작이면 calendar-year, 아니면 start-span) */
  yearSpan?: CalendarYearSpan;
  /** 'year' 전용 — 이 캔버스의 고객 선택 연도 이동(세션 yearDeltas[역할]). 생략·비정수 = ext.yearDelta ?? 0 */
  yearDelta?: number;
}

export interface CalendarGridBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CalendarPluginOptions {
  /** 폰트 사전 로드(FontPlugin.ensureFontLoaded 등). 없으면 즉시 렌더 */
  ensureFont?: (fontFamily: string) => Promise<void>;
  defaultFontFamily?: string;
}

export const CALENDAR_GRID_EXTENSION_TYPE = 'calendar-grid';

const DEFAULT_COLORS: Required<NonNullable<CalendarGridStyle['colors']>> = {
  weekday: '#333333',
  sunday: '#d93025',
  saturday: '#1a56db',
  holiday: '#d93025',
  text: '#222222',
  muted: '#9aa0a6',
  line: '#d9d9d9',
};

const WEEKDAY_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
/** 연달력 요일 헤더(en) — 칸이 작아 1글자 */
const WEEKDAY_EN_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
/** rehydrate 가 다시 그리는 variant. 그 밖(구 번들이 모르는 미래 variant 등)은 건너뛴다 */
const KNOWN_GRID_VARIANTS: ReadonlySet<string> = new Set<CalendarGridVariant>(['month', 'mini', 'year']);
const MONTH_EN = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

/** 그리드 그룹에 붙는 커스텀 속성(extendFabricOption 등재분) */
interface GridObjectProps {
  id?: string;
  name?: string;
  extensionType?: string;
  extension?: CalendarGridExtension;
  lockInfo?: unknown;
  movable?: boolean;
  deleteable?: boolean;
  contentEditable?: boolean;
  isUserAdded?: boolean;
  printExclude?: boolean;
  requiredEdit?: boolean;
}

type GridGroup = fabric.Group & GridObjectProps;
/** fabric 옵션 + 커스텀 id(extendFabricOption 등재) */
type TextOpts = Omit<fabric.ITextOptions, 'id'> & { id?: string };

/** fabric-history(utils/history.ts) 가 fabric.Canvas 에 붙이는 필드 — 정적 캔버스(테스트)에는 없을 수 있어 선택 */
interface HistoryCanvasFields {
  historyProcessing?: boolean;
  isHistoryReady?: boolean;
  historyNextState?: string | null;
  _historyNext?: () => string;
}

/** 렌더 결과 캐시(직렬화 안 함) — hitTestDate 용 */
interface RenderedLayout {
  width: number;
  height: number;
  cellLeft: number;
  cellTop: number;
  cellW: number;
  cellH: number;
  rows: number;
  matrix: MonthMatrix;
}

function resolveMonthIndex(ext: CalendarGridExtension, ctx: CalendarRenderContext): number {
  if (typeof ext.monthOffset === 'number' && Number.isFinite(ext.monthOffset)) return ext.monthOffset;
  const base = ctx.canvasMonthOffset ?? 0;
  return base + (ext.monthDelta ?? 0);
}

function yearMonthFromOffset(ctx: CalendarRenderContext, offset: number): { year: number; month: number } {
  const idx = ctx.startYear * 12 + (ctx.startMonth - 1) + offset;
  return { year: Math.floor(idx / 12), month: ((idx % 12) + 12) % 12 + 1 };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** 연달력 열 수 — 박스 비율 r = w/h: r ≥ 2 → 6열, r ≥ 0.9 → 4열, r ≥ 0.45 → 3열, 그 밖 2열(12개월이면 6×2·4×3·3×4·2×6) */
function yearGridColumns(width: number, height: number): number {
  const r = height > 0 ? width / height : 1;
  if (r >= 2) return 6;
  if (r >= 0.9) return 4;
  if (r >= 0.45) return 3;
  return 2;
}

/** 'year' 연도 이동: ctx(고객 선택) > extension(템플릿) > 0. 정수가 아니면 다음 순위 */
function resolveYearDelta(ext: CalendarGridExtension, ctx: CalendarRenderContext): number {
  if (Number.isInteger(ctx.yearDelta)) return ctx.yearDelta as number;
  if (Number.isInteger(ext.yearDelta)) return ext.yearDelta as number;
  return 0;
}

class CalendarPlugin extends PluginBase {
  public name = 'CalendarPlugin';
  public events: string[] = [];
  public hotkeys: CanvasHotkey[] = [];

  private readonly pluginOptions: CalendarPluginOptions;
  private readonly layouts = new Map<string, RenderedLayout>();

  constructor(canvas: fabric.Canvas, editor: Editor, options: CalendarPluginOptions = {}) {
    super(canvas, editor, {});
    this.pluginOptions = options;
  }

  /** 이 캔버스의 calendar-grid 객체 목록 */
  getGrids(): GridGroup[] {
    return (this._canvas.getObjects() as GridGroup[]).filter(
      (o) => o.extensionType === CALENDAR_GRID_EXTENSION_TYPE,
    );
  }

  /** 객체가 calendar-grid 인지 */
  static isGrid(obj: fabric.Object | null | undefined): obj is GridGroup {
    return !!obj && (obj as GridObjectProps).extensionType === CALENDAR_GRID_EXTENSION_TYPE;
  }

  /** 새 그리드 생성(캔버스에 추가하지 않음 — 호출자가 배치). 기본 잠금: 이동·크기·회전 불가, 삭제 불가, 내용편집 불가 */
  async createGrid(ext: CalendarGridExtension, ctx: CalendarRenderContext, box: CalendarGridBox): Promise<fabric.Group> {
    const id = uuid();
    const group = await this.buildGroup(id, ext, ctx, box.width, box.height, {
      left: box.left + box.width / 2,
      top: box.top + box.height / 2,
    });
    group.set({
      selectable: true,
      hasControls: false,
      lockMovementX: true,
      lockMovementY: true,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
    } as Partial<fabric.Group>);
    Object.assign(group, {
      movable: false,
      deleteable: false,
      contentEditable: false,
      isUserAdded: false,
    } satisfies GridObjectProps);
    return group;
  }

  /**
   * 캔버스의 모든 calendar-grid 를 ctx 기준으로 제자리에서 다시 그린다(id·위치·크기·각도·잠금·z-order 유지).
   * undo 스택에 기록하지 않고(historyProcessing) 끝난 뒤 history 기준 상태만 현재로 맞춘다.
   * @returns 다시 그린 그리드 수
   */
  async rehydrate(ctx: CalendarRenderContext): Promise<number> {
    const grids = this.getGrids();
    if (grids.length === 0) return 0;
    const canvas = this._canvas as fabric.Canvas & HistoryCanvasFields;
    const active = canvas.getActiveObject();
    let count = 0;
    // 재합성은 undo 단계가 아니다: offHistory/onHistory 를 쓰면 onHistory 가 상태 차이를 undo 스택에 push 해
    // 재오픈 직후 Ctrl+Z 로 그리드가 자리표시자로 되돌아간다. 처리 중 플래그만 올리고 끝나면 기준 상태를 재설정한다.
    const prevProcessing = canvas.historyProcessing;
    canvas.historyProcessing = true;
    try {
      for (const old of grids) {
        const ext = old.extension;
        if (!ext || !KNOWN_GRID_VARIANTS.has(ext.variant)) continue;
        const objects = canvas.getObjects();
        const index = objects.indexOf(old);
        if (index < 0) continue;
        const center = old.getCenterPoint();
        const id = old.id ?? uuid();
        // 기준 박스는 경계 사각형 자식(`<id>-bounds`)에서 읽는다 — 자식 텍스트가 박스를 넘쳐 그룹 경계가 커져도 드리프트하지 않는다
        const bounds = old.getObjects().find((o) => (o as GridObjectProps).id === `${id}-bounds`);
        const width = bounds?.width ?? old.width ?? 0;
        const height = bounds?.height ?? old.height ?? 0;
        if (width <= 0 || height <= 0) continue;
        const next = await this.buildGroup(id, ext, ctx, width, height, { left: center.x, top: center.y });
        this.copyPreservedProps(old, next);
        canvas.remove(old);
        canvas.insertAt(next, index, false);
        if (active === old) canvas.setActiveObject(next);
        count += 1;
      }
    } finally {
      canvas.historyProcessing = prevProcessing;
      if (canvas.isHistoryReady && typeof canvas._historyNext === 'function') {
        canvas.historyNextState = canvas._historyNext();
      }
    }
    canvas.requestRenderAll();
    return count;
  }

  /** 캔버스 좌표 → 그리드 안의 날짜. 날짜칸 밖(제목·요일 헤더·빈 칸)이면 null. rehydrate/createGrid 를 거친 그리드만 지원 */
  hitTestDate(grid: fabric.Object, point: { x: number; y: number }): DateKey | null {
    const id = (grid as GridObjectProps).id;
    const layout = id ? this.layouts.get(id) : undefined;
    if (!layout) return null;
    const inv = fabric.util.invertTransform(grid.calcTransformMatrix());
    const local = fabric.util.transformPoint(new fabric.Point(point.x, point.y), inv);
    // 그룹 로컬 원점은 중심
    const x = local.x + layout.width / 2;
    const y = local.y + layout.height / 2;
    const col = Math.floor((x - layout.cellLeft) / layout.cellW);
    const row = Math.floor((y - layout.cellTop) / layout.cellH);
    if (col < 0 || col > 6 || row < 0 || row >= layout.rows) return null;
    const cell = layout.matrix.rows[row]?.[col];
    if (!cell || !cell.inMonth) return null;
    return cell.date;
  }

  dispose(): void {
    this.layouts.clear();
  }

  // ─── 내부 ──────────────────────────────────────────────────────────────

  private copyPreservedProps(from: GridGroup, to: GridGroup): void {
    const keys: Array<keyof fabric.Group> = [
      'scaleX', 'scaleY', 'angle', 'flipX', 'flipY', 'opacity', 'visible',
      'selectable', 'evented', 'hasControls', 'hasBorders',
      'lockMovementX', 'lockMovementY', 'lockRotation', 'lockScalingX', 'lockScalingY',
    ];
    const patch: Record<string, unknown> = {};
    for (const k of keys) {
      const v = (from as unknown as Record<string, unknown>)[k as string];
      if (v !== undefined) patch[k as string] = v;
    }
    to.set(patch as Partial<fabric.Group>);
    const custom: Array<keyof GridObjectProps> = [
      'name', 'lockInfo', 'movable', 'deleteable', 'contentEditable', 'isUserAdded', 'printExclude', 'requiredEdit',
    ];
    for (const k of custom) {
      const v = from[k];
      if (v !== undefined) (to as Record<string, unknown>)[k] = v;
    }
    to.setCoords();
  }

  private async buildGroup(
    id: string,
    ext: CalendarGridExtension,
    ctx: CalendarRenderContext,
    width: number,
    height: number,
    center: { left: number; top: number },
  ): Promise<GridGroup> {
    const style = ext.style ?? {};
    const fontFamily = style.fontFamily ?? this.pluginOptions.defaultFontFamily;
    if (fontFamily && this.pluginOptions.ensureFont) {
      try {
        await this.pluginOptions.ensureFont(fontFamily);
      } catch (err) {
        console.warn('[CalendarPlugin] 폰트 로드 실패 — 기본 폰트로 렌더:', fontFamily, err);
      }
    }
    if (ext.variant === 'year') return this.buildYearGroup(id, ext, ctx, width, height, center, fontFamily);
    const offset = resolveMonthIndex(ext, ctx);
    const ym = yearMonthFromOffset(ctx, offset);
    const weekStart = ext.weekStart ?? ctx.weekStart;
    const show = {
      holidays: ext.show?.holidays ?? ctx.show.holidays,
      lunar: ext.show?.lunar ?? ctx.show.lunar,
      solarTerms: ext.show?.solarTerms ?? ctx.show.solarTerms,
      temporaryHolidays: ext.show?.temporaryHolidays ?? ctx.show.temporaryHolidays ?? false,
      minorTerms: ext.show?.minorTerms ?? ctx.show.minorTerms ?? false,
    };
    // 잡절(삼복)은 옵션을 켠 경우만 조회 — 끄면(기본) 칸 문구·자식 구성이 종전과 같다(T4)
    const minorTermByDate = new Map<DateKey, string>(
      show.minorTerms ? getMinorTermsForMonth(ym.year, ym.month, ctx.data).map((t) => [t.date, t.name]) : [],
    );
    const matrix = buildMonthMatrix(ym.year, ym.month, {
      weekStart,
      data: ctx.data,
      anniversaries: ctx.anniversaries,
      // 임시공휴일·선거일은 옵션을 켠 경우만 휴일(색·라벨)로 취급 — 기본은 법정 공휴일만(2026-10-17)
      includeTemporaryHolidays: show.temporaryHolidays,
    });

    const children: fabric.Object[] = [];
    const colors = { ...DEFAULT_COLORS, ...(style.colors ?? {}) };
    const isMini = ext.variant === 'mini';
    const showTitle = style.showTitle ?? true;
    const showLines = style.showLines ?? !isMini;
    const rows = (style.rows ?? 'fixed6') === 'used' ? Math.max(4, matrix.usedRows) : 6;

    // 경계 사각형(투명) — 그룹 크기를 박스에 고정한다.
    // fill 은 'transparent' 가 아니라 ''(none): 'transparent' 는 fabric toSVG 가 `fill: rgb(0,0,0); fill-opacity: 0`
    // 으로 내보내 svg2pdf 가 `/ca 0` ExtGState 를 만들고 워커가 TRANSPARENCY_DETECTED 로 경고한다(2026-10-17).
    // '' 는 `fill: none` 으로 나가 ExtGState 없이 그리기만 생략된다. 화면·크기·rehydrate(width/height 읽기)는 동일.
    children.push(new fabric.Rect({
      left: 0, top: 0, width, height,
      fill: '', stroke: undefined, strokeWidth: 0,
      selectable: false, evented: false, id: `${id}-bounds`,
    } as fabric.IRectOptions));

    const titleH = showTitle ? height * (isMini ? 0.16 : 0.18) : 0;
    const headerH = height * (isMini ? 0.1 : 0.07);
    const cellTop = titleH + headerH;
    const cellH = (height - cellTop) / rows;
    const cellW = width / 7;
    const numberSize = style.fontSize ?? clamp(cellH * (isMini ? 0.42 : 0.3), 4, 400);
    const smallSize = numberSize * 0.5;
    const pad = Math.max(1, numberSize * 0.25);
    // fontFamily 가 undefined 로 들어가면 fabric.Text 가 크래시한다(getFontCache) — 값이 있을 때만 지정
    const textBase: TextOpts = { selectable: false, evented: false, ...(fontFamily ? { fontFamily } : {}) };

    // 제목
    if (showTitle) {
      if (isMini) {
        children.push(new fabric.Text(`${ym.year}.${ym.month}`, {
          ...textBase, id: `${id}-title`, left: width / 2, top: titleH / 2, originX: 'center', originY: 'center',
          fontSize: clamp(titleH * 0.55, 4, 400), fill: colors.text, fontWeight: 'bold',
        } as TextOpts));
      } else {
        const big = clamp(titleH * 0.8, 6, 600);
        children.push(new fabric.Text(String(ym.month), {
          ...textBase, id: `${id}-title-month`, left: pad, top: titleH * 0.5, originX: 'left', originY: 'center',
          fontSize: big, fill: colors.text, fontWeight: 'bold',
        } as TextOpts));
        const monthW = String(ym.month).length * big * 0.6;
        children.push(new fabric.Text(String(ym.year), {
          ...textBase, id: `${id}-title-year`, left: pad + monthW + pad, top: titleH * 0.32, originX: 'left', originY: 'center',
          fontSize: clamp(titleH * 0.22, 4, 300), fill: colors.muted,
        } as TextOpts));
        children.push(new fabric.Text(MONTH_EN[ym.month - 1], {
          ...textBase, id: `${id}-title-en`, left: pad + monthW + pad, top: titleH * 0.66, originX: 'left', originY: 'center',
          fontSize: clamp(titleH * 0.24, 4, 300), fill: colors.text,
        } as TextOpts));
      }
    }

    // 요일 헤더
    const names = (style.headerLang ?? 'en') === 'ko' ? WEEKDAY_KO : WEEKDAY_EN;
    matrix.weekdayOrder.forEach((wd, col) => {
      children.push(new fabric.Text(names[wd], {
        ...textBase, id: `${id}-wd-${col}`, left: col * cellW + cellW / 2, top: titleH + headerH / 2,
        originX: 'center', originY: 'center',
        fontSize: clamp(headerH * 0.55, 3, 300),
        fill: wd === 0 ? colors.sunday : wd === 6 ? colors.saturday : colors.weekday,
      } as TextOpts));
    });

    // 구분선
    if (showLines) {
      // 선은 박스 안쪽에 둔다(바깥 선의 두께가 그룹 경계를 키우면 rehydrate 마다 크기가 누적 증가한다)
      const sw = Math.max(0.3, width / 800);
      const half = sw / 2;
      const lineOpts = { stroke: colors.line, strokeWidth: sw, selectable: false, evented: false } as fabric.ILineOptions;
      // fabric.Line(butt cap)은 두께 0 축에서 [좌표, 좌표+strokeWidth] 로 그려진다(중심이 아님) — 좌표를 half 만큼 당겨 선 중심을 맞추고 박스 안에 가둔다
      for (let r = 0; r <= rows; r += 1) {
        const y = clamp(cellTop + r * cellH - half, 0, height - sw);
        children.push(new fabric.Line([0, y, width, y], { ...lineOpts, id: `${id}-hl-${r}` } as fabric.ILineOptions));
      }
      for (let c = 0; c <= 7; c += 1) {
        const x = clamp(c * cellW - half, 0, width - sw);
        children.push(new fabric.Line([x, cellTop, x, height], { ...lineOpts, id: `${id}-vl-${c}` } as fabric.ILineOptions));
      }
    }

    // 날짜 칸
    for (let r = 0; r < rows; r += 1) {
      const row = matrix.rows[r];
      if (!row) break;
      for (let c = 0; c < 7; c += 1) {
        const cell = row[c];
        if (!cell) continue;
        if (!cell.inMonth && !(style.fillAdjacent ?? false)) continue;
        const x0 = c * cellW;
        const y0 = cellTop + r * cellH;
        const color = this.dayColor(cell, show.holidays, colors);
        children.push(new fabric.Text(String(cell.day), {
          ...textBase, id: `${id}-d-${cell.date}`,
          left: isMini ? x0 + cellW / 2 : x0 + pad,
          top: isMini ? y0 + cellH / 2 : y0 + pad,
          originX: isMini ? 'center' : 'left', originY: isMini ? 'center' : 'top',
          fontSize: numberSize, fill: color,
        } as TextOpts));
        if (isMini || !cell.inMonth) continue;
        const notes = this.cellNotes(cell, show, minorTermByDate);
        let ny = y0 + pad + numberSize * 1.15;
        for (const note of notes.slice(0, 3)) {
          if (ny + smallSize > y0 + cellH) break;
          // 기념일 문구 스타일(D1(b), T3b): 색은 fill, 굵게는 fontWeight — 스타일이 없으면 키를 더하지 않아 종전 렌더와 같다
          const noteStyle = note.style;
          children.push(new fabric.Text(note.text, {
            ...textBase, id: `${id}-n-${cell.date}-${note.kind}`,
            left: x0 + pad, top: ny, originX: 'left', originY: 'top',
            fontSize: smallSize,
            fill: noteStyle?.fill ?? (note.kind === 'holiday' ? colors.holiday : note.kind === 'anniversary' ? colors.text : colors.muted),
            ...(noteStyle?.fontWeight ? { fontWeight: noteStyle.fontWeight } : {}),
          } as TextOpts));
          ny += smallSize * 1.2;
        }
      }
    }

    const group = new fabric.Group(children, {
      id,
      left: center.left,
      top: center.top,
      originX: 'center',
      originY: 'center',
      subTargetCheck: false,
    } as fabric.IGroupOptions) as GridGroup;
    group.extensionType = CALENDAR_GRID_EXTENSION_TYPE;
    group.extension = { ...ext };
    group.setCoords();

    this.layouts.set(id, { width, height, cellLeft: 0, cellTop, cellW, cellH, rows, matrix });
    return group;
  }

  /**
   * 연달력(variant 'year'): 제목(연도) + 월마다 소제목·요일 헤더·날짜 숫자. 공휴일명·음력·절기·기념일 문구는 그리지 않는다.
   * 기존 style 키만 재사용하고 hitTest 레이아웃은 남기지 않는다(기념일 폼 대상 아님).
   */
  private buildYearGroup(
    id: string,
    ext: CalendarGridExtension,
    ctx: CalendarRenderContext,
    width: number,
    height: number,
    center: { left: number; top: number },
    fontFamily: string | undefined,
  ): GridGroup {
    const style = ext.style ?? {};
    const start = { year: ctx.startYear, month: ctx.startMonth };
    const span = resolveCalendarYearSpan(ctx.yearSpan, start);
    const first = resolveCalendarYearStart(span, start, resolveYearDelta(ext, ctx));
    const monthCount = CALENDAR_YEAR_MONTH_COUNT;
    const weekStart = ext.weekStart ?? ctx.weekStart;
    const showHolidays = ext.show?.holidays ?? ctx.show.holidays;
    const temporaryHolidays = ext.show?.temporaryHolidays ?? ctx.show.temporaryHolidays ?? false;
    const year = buildYearMatrix(first.year, first.month, {
      weekStart,
      data: ctx.data,
      anniversaries: [],
      includeTemporaryHolidays: temporaryHolidays,
    }, monthCount);

    const children: fabric.Object[] = [];
    const colors = { ...DEFAULT_COLORS, ...(style.colors ?? {}) };
    // 템플릿이 제목 자리를 두지 않았으면(style.showTitle=false) 고객 옵션과 무관하게 제목 없음
    const showTitle = (style.showTitle ?? true) && (ext.show?.yearTitle ?? ctx.show.yearTitle ?? true);
    const showLines = style.showLines ?? false;
    const weeks = (style.rows ?? 'fixed6') === 'used'
      ? Math.max(4, ...year.months.map((m) => m.usedRows))
      : 6;

    // 경계 사각형 — month/mini 와 같은 규칙(fill '' = none, PDF ExtGState 없음)
    children.push(new fabric.Rect({
      left: 0, top: 0, width, height,
      fill: '', stroke: undefined, strokeWidth: 0,
      selectable: false, evented: false, id: `${id}-bounds`,
    } as fabric.IRectOptions));

    const textBase: TextOpts = { selectable: false, evented: false, ...(fontFamily ? { fontFamily } : {}) };
    const titleH = showTitle ? height * 0.1 : 0;
    if (showTitle) {
      const last = addMonths(first, monthCount - 1);
      const title = span === 'calendar-year' ? String(first.year) : `${first.year}.${first.month} – ${last.year}.${last.month}`;
      children.push(new fabric.Text(title, {
        ...textBase, id: `${id}-title`, left: width / 2, top: titleH / 2, originX: 'center', originY: 'center',
        fontSize: clamp(titleH * 0.6, 4, 600), fill: colors.text, fontWeight: 'bold',
      } as TextOpts));
    }

    const cols = yearGridColumns(width, height);
    const blockRows = Math.ceil(monthCount / cols);
    const blockW = width / cols;
    const blockH = (height - titleH) / blockRows;
    const gap = Math.max(0.5, Math.min(blockW, blockH) * 0.05);
    const subH = blockH * 0.14;
    const headerH = blockH * 0.1;
    const cellW = (blockW - gap * 2) / 7;
    const cellH = Math.max(0, (blockH - gap * 2 - subH - headerH) / weeks);
    const numberSize = style.fontSize ?? clamp(Math.min(cellH, cellW) * 0.6, 2, 200);
    const names = (style.headerLang ?? 'en') === 'ko' ? WEEKDAY_KO : WEEKDAY_EN_SHORT;
    const sw = Math.max(0.3, width / 1600);
    const half = sw / 2;
    const lineOpts = { stroke: colors.line, strokeWidth: sw, selectable: false, evented: false } as fabric.ILineOptions;

    year.months.forEach((matrix, k) => {
      const bx = (k % cols) * blockW + gap;
      const by = titleH + Math.floor(k / cols) * blockH + gap;
      const cellTop = by + subH + headerH;

      children.push(new fabric.Text(String(matrix.month), {
        ...textBase, id: `${id}-m${k}-title`, left: bx + cellW / 2, top: by + subH / 2, originX: 'center', originY: 'center',
        fontSize: clamp(subH * 0.75, 3, 300), fill: colors.text, fontWeight: 'bold',
      } as TextOpts));

      matrix.weekdayOrder.forEach((wd, col) => {
        children.push(new fabric.Text(names[wd], {
          ...textBase, id: `${id}-m${k}-wd-${col}`, left: bx + col * cellW + cellW / 2, top: by + subH + headerH / 2,
          originX: 'center', originY: 'center',
          fontSize: clamp(headerH * 0.6, 2, 200),
          fill: wd === 0 ? colors.sunday : wd === 6 ? colors.saturday : colors.weekday,
        } as TextOpts));
      });

      if (showLines) {
        // month 와 같은 PDF 안전 규칙: 선 중심을 half 만큼 당기고 박스 안에 가둔다(rehydrate 크기 누적 방지)
        for (let r = 0; r <= weeks; r += 1) {
          const y = clamp(cellTop + r * cellH - half, 0, height - sw);
          children.push(new fabric.Line([clamp(bx, 0, width), y, clamp(bx + cellW * 7, 0, width), y], { ...lineOpts, id: `${id}-yl-${k}-h-${r}` } as fabric.ILineOptions));
        }
        for (let c = 0; c <= 7; c += 1) {
          const x = clamp(bx + c * cellW - half, 0, width - sw);
          children.push(new fabric.Line([x, clamp(cellTop, 0, height), x, clamp(cellTop + weeks * cellH, 0, height)], { ...lineOpts, id: `${id}-yl-${k}-v-${c}` } as fabric.ILineOptions));
        }
      }

      for (let r = 0; r < weeks; r += 1) {
        const row = matrix.rows[r];
        if (!row) break;
        for (let c = 0; c < 7; c += 1) {
          const cell = row[c];
          if (!cell) continue;
          if (!cell.inMonth && !(style.fillAdjacent ?? false)) continue;
          children.push(new fabric.Text(String(cell.day), {
            ...textBase, id: `${id}-m${k}-d-${cell.date}`,
            left: bx + c * cellW + cellW / 2, top: cellTop + r * cellH + cellH / 2,
            originX: 'center', originY: 'center',
            fontSize: numberSize, fill: this.dayColor(cell, showHolidays, colors),
          } as TextOpts));
        }
      }
    });

    const group = new fabric.Group(children, {
      id,
      left: center.left,
      top: center.top,
      originX: 'center',
      originY: 'center',
      subTargetCheck: false,
    } as fabric.IGroupOptions) as GridGroup;
    group.extensionType = CALENDAR_GRID_EXTENSION_TYPE;
    group.extension = { ...ext };
    group.setCoords();

    // 날짜 hitTest 대상 아님 → hitTestDate null → 더블클릭 기념일 폼이 열리지 않는다
    this.layouts.delete(id);
    return group;
  }

  private dayColor(cell: MonthCell, showHolidays: boolean, colors: typeof DEFAULT_COLORS): string {
    if (!cell.inMonth) return colors.muted;
    if (showHolidays && cell.isHoliday) return colors.holiday;
    if (cell.weekday === 0) return colors.sunday;
    if (cell.weekday === 6) return colors.saturday;
    return colors.text;
  }

  /** 칸 문구 순서: 공휴일 → 기념일 → 절기 → 잡절(삼복, minorTermByDate 가 빈 맵이면 없음) → 음력(1·15일). 렌더는 앞 3개까지 */
  private cellNotes(
    cell: MonthCell,
    show: { holidays: boolean; lunar: boolean; solarTerms: boolean },
    minorTermByDate: ReadonlyMap<DateKey, string>,
  ): Array<{ kind: 'holiday' | 'anniversary' | 'term' | 'minor' | 'lunar'; text: string; style?: AnniversaryTextStyle }> {
    const notes: Array<{ kind: 'holiday' | 'anniversary' | 'term' | 'minor' | 'lunar'; text: string; style?: AnniversaryTextStyle }> = [];
    if (show.holidays) for (const n of cell.holidayNames) notes.push({ kind: 'holiday', text: n });
    cell.anniversaries.forEach((a, i) => {
      const style = cell.anniversaryStyles?.[i];
      notes.push(style ? { kind: 'anniversary', text: a, style } : { kind: 'anniversary', text: a });
    });
    if (show.solarTerms && cell.solarTerm) notes.push({ kind: 'term', text: cell.solarTerm });
    const minor = minorTermByDate.get(cell.date);
    if (minor) notes.push({ kind: 'minor', text: minor });
    if (show.lunar && cell.lunar && (cell.lunar.day === 1 || cell.lunar.day === 15)) {
      notes.push({ kind: 'lunar', text: `${cell.lunar.isLeapMonth ? '윤' : ''}${cell.lunar.month}.${cell.lunar.day}` });
    }
    return notes;
  }
}

export default CalendarPlugin;
