/**
 * 표지 spread 방향 파생 순수 변환 유틸 — 트랙 C (2026-07-23).
 *
 * NestJS/TypeORM/fabric 의존 없음(순수 함수) — spread-orientation-derive.spec.ts 대상.
 * 내지 파생(orientation-derive.util.ts)의 원칙을 승계하되, 표지는 [뒤|책등|앞](+날개)
 * 3~5영역 펼침면이라 "전체 W↔H 스왑"이 성립하지 않는다(세로 429.2×301 → 가로 603.2×214).
 * 따라서 **면 단위**로 처리한다: 파생 spec = coverW↔coverH 스왑(spine·wing 불변),
 * 객체는 소속 면의 로컬 정규화 좌표(xNorm/yNorm)를 보존한 채 평행이동 — 크기·회전·
 * styles·잠금·requiredEdit·id·z순서 전부 보존(내지 "위치만 재배치" 정책의 면 단위 준용).
 *
 * 기하 정본: @storige/types(computeSpreadDimensions/computeSpreadRegionRangesMm/
 * normalizeSpreadSpec) — 산식 인라인 복제 금지. 영역 시맨틱은 SpreadLayoutEngine
 * parity spec 이 봉쇄.
 *
 * 좌표 규약(reference_coordinate_convention): 객체 left/top = 중앙원점 px@150dpi.
 * 콘텐츠(trim) 좌표 = scene 좌표 + 총치수/2 (SpreadPlugin.getContentOrigin 시맨틱).
 *
 * B 임시조치(2026-07-14, 전체비율 근사 — spine 1.2mm에서만 우연히 통과) 대체 정본.
 */
import type {
  CanvasData,
  FabricObject,
  SpreadConfig,
  SpreadRegion,
  SpreadRegionPosition,
  SpreadRegionRangeMm,
  SpreadSpec,
} from '@storige/types';
import {
  SPREAD_CONFIG_VERSION,
  SPREAD_REGION_LABELS,
  computeSpreadDimensions,
  computeSpreadRegionRangesMm,
  normalizeSpreadSpec,
  roundMm01,
} from '@storige/types';
import { REGENERATED_GUIDE_IDS, WORKSPACE_OBJECT_ID } from './orientation-derive.util';

// ── 게이트 ──────────────────────────────────────────────────────────

export type SpreadDeriveSkipReason =
  | 'SPREAD_SPEC_MISSING'
  | 'SPREAD_INNER_SCOPE'
  | 'FLAT_SPREAD_UNSUPPORTED'
  | 'FLAT_SPINE_UNSUPPORTED';

/**
 * v1 자동 변환 대상 판정 — regionScope cover(또는 미존재) ∧ conversionMode full(또는 미존재).
 * skip 은 파생 전체 중단(404)이 아니라 "표지만 제외 + meta 사유 안내"로 처리된다(서비스 책임).
 */
export function evaluateSpreadDeriveGate(
  spreadConfig: SpreadConfig | null | undefined,
): { ok: true } | { ok: false; reason: SpreadDeriveSkipReason } {
  if (!spreadConfig?.spec) return { ok: false, reason: 'SPREAD_SPEC_MISSING' };
  if (spreadConfig.regionScope === 'inner') return { ok: false, reason: 'SPREAD_INNER_SCOPE' };
  if (spreadConfig.conversionMode === 'flat-spread') {
    return { ok: false, reason: 'FLAT_SPREAD_UNSUPPORTED' };
  }
  if (spreadConfig.conversionMode === 'flat-spine') {
    return { ok: false, reason: 'FLAT_SPINE_UNSUPPORTED' };
  }
  return { ok: true };
}

// ── 결과 타입 ────────────────────────────────────────────────────────

export interface SpreadOrientationDeriveResult {
  canvasData: CanvasData;
  spec: SpreadSpec;
  spreadConfig: SpreadConfig;
  widthMm: number;
  heightMm: number;
  /** 사람 검수 필요 항목(전폭 자유객체·absolutePositioned clipPath·레거시 잔재 드롭 등) */
  reviewNotes: string[];
}

// ── 내부 도우미 (순수 스칼라 계산) ─────────────────────────────────────

function mmToPx(mm: number, dpi: number): number {
  return (mm / 25.4) * dpi;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** SpreadLayoutEngine ANCHOR_NORM_MIN/MAX 와 동일(파생은 정적 1회 — 히스테리시스 불필요) */
const NORM_MIN = -1.0;
const NORM_MAX = 2.0;
/** 1차 분류: bbox x-겹침 비율 승격 임계(resolveRegionRef PROMOTE 시맨틱 준용) */
const FACE_OVERLAP_THRESHOLD = 0.9;
/** 전폭 자유객체 검수 임계 — bbox 폭이 구 총폭의 98% 이상이면 검수 노트 */
const FULL_WIDTH_REVIEW_RATIO = 0.98;

/** 레거시(IDML/수동 주입) 잔재 치수 라벨 텍스트 패턴 — 예: "214.0mm", "1.2mm" */
const DIMENSION_LABEL_TEXT = /^\d+(\.\d+)?mm$/u;

interface SceneBBox {
  centerX: number; // scene(중앙원점) px
  centerY: number;
  width: number; // AABB px
  height: number;
}

/**
 * 객체 AABB(scene 좌표) — originX/Y('left'|'center'|'right'/'top'|'center'|'bottom') +
 * scale + angle(중심 회전) 반영. 서버에 fabric 이 없으므로 수학 산출.
 */
function getSceneBBox(obj: FabricObject): SceneBBox {
  const w = numberOr(obj.width, 0) * numberOr(obj.scaleX, 1);
  const h = numberOr(obj.height, 0) * numberOr(obj.scaleY, 1);
  const left = numberOr(obj.left, 0);
  const top = numberOr(obj.top, 0);

  const originX = typeof obj.originX === 'string' ? obj.originX : 'left';
  const originY = typeof obj.originY === 'string' ? obj.originY : 'top';
  const cx = originX === 'center' ? left : originX === 'right' ? left - w / 2 : left + w / 2;
  const cy = originY === 'center' ? top : originY === 'bottom' ? top - h / 2 : top + h / 2;

  const angle = numberOr(obj.angle, 0);
  if (angle === 0) return { centerX: cx, centerY: cy, width: w, height: h };
  const rad = (angle * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return {
    centerX: cx,
    centerY: cy,
    width: w * cos + h * sin,
    height: w * sin + h * cos,
  };
}

interface FaceRangePx {
  position: SpreadRegionPosition;
  x0: number; // 콘텐츠(trim) 좌표 px
  x1: number;
  width: number;
}

function rangesToPx(ranges: SpreadRegionRangeMm[], dpi: number): FaceRangePx[] {
  return ranges.map((r) => ({
    position: r.position,
    x0: mmToPx(r.x0Mm, dpi),
    x1: mmToPx(r.x1Mm, dpi),
    width: mmToPx(r.widthMm, dpi),
  }));
}

/**
 * 객체 → 면 분류: ① bbox x-겹침 비율 ≥0.9 (영역은 전고(全高)라 면적비 = x-겹침비)
 * ② 미달 시 중심 x 소속 영역 ③ 그 외 자유객체(null).
 * meta.regionRef 는 힌트일 뿐 — 실측 우선(SpreadPlugin 자가치유 전례, meta 오염 방어).
 */
function classifyFace(bboxContentX0: number, bboxContentX1: number, faces: FaceRangePx[]): SpreadRegionPosition | null {
  const bboxW = bboxContentX1 - bboxContentX0;
  if (bboxW > 0) {
    for (const face of faces) {
      const overlap = Math.min(bboxContentX1, face.x1) - Math.max(bboxContentX0, face.x0);
      if (overlap > 0 && overlap / bboxW >= FACE_OVERLAP_THRESHOLD) return face.position;
    }
  }
  const centerX = (bboxContentX0 + bboxContentX1) / 2;
  for (const face of faces) {
    if (centerX >= face.x0 && centerX < face.x1) return face.position;
  }
  return null;
}

/** spreadConfig.regions 파생본 — computeSpreadRegionRangesMm + px 환산 + 고정 라벨. */
function buildRegions(spec: SpreadSpec, ranges: SpreadRegionRangeMm[]): SpreadRegion[] {
  const totalHeightPx = mmToPx(spec.coverHeightMm, spec.dpi);
  return ranges.map((r) => ({
    type: r.position.includes('wing') ? 'wing' : r.position === 'spine' ? 'spine' : 'cover',
    position: r.position,
    x: mmToPx(r.x0Mm, spec.dpi),
    width: mmToPx(r.widthMm, spec.dpi),
    height: totalHeightPx,
    widthMm: r.widthMm,
    heightMm: spec.coverHeightMm,
    label: SPREAD_REGION_LABELS[r.position],
  }));
}

// ── 본체 ────────────────────────────────────────────────────────────

/**
 * 표지 spread canvasData 방향 변환 (순수 — 입력 불변, JSON 딥클론 반환).
 * 게이트(evaluateSpreadDeriveGate) 통과가 전제 — 미통과 입력은 여기서 throw.
 */
export function transformSpreadCanvasDataOrientation(
  canvasData: CanvasData,
  spreadConfig: SpreadConfig,
): SpreadOrientationDeriveResult {
  const gate = evaluateSpreadDeriveGate(spreadConfig);
  if (!gate.ok) {
    throw new Error(`transformSpreadCanvasDataOrientation: 게이트 미통과(${gate.reason})`);
  }

  const spec = normalizeSpreadSpec(spreadConfig.spec as SpreadSpec);
  // ★ 면 단위 스왑 — coverW/H 만 상호 교환. spine(동적값)·wing(물성)·cut/safe/dpi/caseBind 불변.
  //   판형에서 재계산 금지: coverW=214 는 판형 210 이 아닌 제작 정본(+4mm) — spec 필드가 유일 소스.
  const spec2 = normalizeSpreadSpec({
    ...spec,
    coverWidthMm: spec.coverHeightMm,
    coverHeightMm: spec.coverWidthMm,
  });

  const dpi = spec.dpi;
  const oldDims = computeSpreadDimensions(spec);
  const newDims = computeSpreadDimensions(spec2);
  const oldTotalWpx = mmToPx(oldDims.totalWidthMm, dpi);
  const oldTotalHpx = mmToPx(oldDims.totalHeightMm, dpi);
  const newTotalWpx = mmToPx(newDims.totalWidthMm, dpi);
  const newTotalHpx = mmToPx(newDims.totalHeightMm, dpi);

  const oldRanges = computeSpreadRegionRangesMm(spec);
  const newRanges = computeSpreadRegionRangesMm(spec2);
  const oldFaces = rangesToPx(oldRanges, dpi);
  const newFaces = new Map(rangesToPx(newRanges, dpi).map((f) => [f.position, f]));

  const reviewNotes: string[] = [];

  // 순수 JSON 딥클론 — 입력 불변 + styles 등 임의 키 보존(reference_fabric_styles_trap)
  const cloned = JSON.parse(JSON.stringify(canvasData)) as CanvasData;
  cloned.width = newDims.totalWidthMm;
  cloned.height = newDims.totalHeightMm;

  // workspace/top-level clipPath 결정론 기하 — 파생 spec 기준(총치수 + 사방 cut).
  const applyWorkspaceGeometry = (obj: FabricObject, label: string): void => {
    const oldEffW = numberOr(obj.width, 0) * numberOr(obj.scaleX, 1);
    const oldEffH = numberOr(obj.height, 0) * numberOr(obj.scaleY, 1);
    const expectedOldW = mmToPx(oldDims.totalWidthMm + 2 * spec.cutSizeMm, dpi);
    const expectedOldH = mmToPx(oldDims.totalHeightMm + 2 * spec.cutSizeMm, dpi);
    // 레거시 저작 잔재(스펙 유도값과 불일치하는 실기하) 관측 — 정규화 사실을 노트로 남긴다
    if (Math.abs(oldEffW - expectedOldW) > 1 || Math.abs(oldEffH - expectedOldH) > 1) {
      reviewNotes.push(
        `WORKSPACE_GEOMETRY_NORMALIZED(${label}): ${oldEffW.toFixed(1)}×${oldEffH.toFixed(1)}px → spec 유도 기하로 정규화`,
      );
    }
    obj.width = mmToPx(newDims.totalWidthMm + 2 * spec2.cutSizeMm, dpi);
    obj.height = mmToPx(newDims.totalHeightMm + 2 * spec2.cutSizeMm, dpi);
    obj.scaleX = 1;
    obj.scaleY = 1;
    const originX = typeof obj.originX === 'string' ? obj.originX : 'left';
    const originY = typeof obj.originY === 'string' ? obj.originY : 'top';
    obj.left = originX === 'center' ? 0 : -(obj.width as number) / 2;
    obj.top = originY === 'center' ? 0 : -(obj.height as number) / 2;
  };

  // top-level clipPath — workspace 와 한 세트(B 교훈: 배경+clipPath 동기)
  const topClip = (cloned as unknown as { clipPath?: FabricObject }).clipPath;
  if (topClip && typeof topClip === 'object') {
    applyWorkspaceGeometry(topClip, 'clipPath');
  }

  const sourceObjects: FabricObject[] = Array.isArray(cloned.objects) ? cloned.objects : [];
  const transformed: FabricObject[] = [];

  for (const obj of sourceObjects) {
    const objId = typeof obj.id === 'string' ? obj.id : undefined;
    const metaSystem =
      obj.meta && typeof obj.meta === 'object' ? (obj.meta as { system?: unknown }).system : undefined;

    // (a) 화면 전용 재생성 가이드 — drop (내지 유틸 동일 규칙)
    if (objId !== undefined && REGENERATED_GUIDE_IDS.includes(objId)) continue;
    if (metaSystem === 'spreadGuide' || metaSystem === 'dimensionLabel') continue;
    // (b) 레거시 잔재(IDML/수동 주입 — 일반 객체로 직렬화된 spread 가이드·치수 라벨):
    //     SpreadPlugin 이 로드 시 항상 재생성하므로 drop 이 정정이다. 좁은 패턴만 매칭(오탐 방어)
    //     — d765713a 실덤프에서 확인된 형상(§7-3): line 'spread-guide-N' / 무id 'N.Nmm' text.
    if (obj.type === 'line' && objId !== undefined && objId.startsWith('spread-guide-')) {
      reviewNotes.push(`DROPPED_LEGACY_GUIDE: line ${objId}`);
      continue;
    }
    if (
      obj.type === 'text' &&
      objId === undefined &&
      typeof obj.text === 'string' &&
      DIMENSION_LABEL_TEXT.test(obj.text)
    ) {
      reviewNotes.push(`DROPPED_LEGACY_GUIDE: dimension label "${obj.text}"`);
      continue;
    }

    // (c) workspace 실객체 — drop 금지, spec 기반 결정론 재계산(파란 배경 = workspace fill)
    if (objId === WORKSPACE_OBJECT_ID) {
      applyWorkspaceGeometry(obj, 'workspace');
      transformed.push(obj);
      continue;
    }

    // (d) 일반 객체 — 면 분류 후 면 로컬 정규화 좌표 보존 평행이동
    const bbox = getSceneBBox(obj);
    const contentCenterX = bbox.centerX + oldTotalWpx / 2;
    const contentCenterY = bbox.centerY + oldTotalHpx / 2;
    const face = classifyFace(
      contentCenterX - bbox.width / 2,
      contentCenterX + bbox.width / 2,
      oldFaces,
    );

    // 객체별 absolutePositioned clipPath — 평행이동으로는 어긋남 → 무변환 + 검수 노트
    const objClip = (obj as { clipPath?: { absolutePositioned?: boolean } }).clipPath;
    if (objClip && typeof objClip === 'object' && objClip.absolutePositioned === true) {
      reviewNotes.push(`ABSOLUTE_CLIPPATH_REVIEW: ${objId ?? obj.type}`);
    }

    let newCenterContentX: number;
    let newCenterContentY: number;
    if (face) {
      const oldFace = oldFaces.find((f) => f.position === face) as FaceRangePx;
      const newFace = newFaces.get(face) as FaceRangePx;
      const xNorm = clamp((contentCenterX - oldFace.x0) / oldFace.width, NORM_MIN, NORM_MAX);
      const yNorm = clamp(contentCenterY / oldTotalHpx, NORM_MIN, NORM_MAX);
      newCenterContentX = newFace.x0 + xNorm * newFace.width;
      newCenterContentY = yNorm * newTotalHpx;
    } else {
      // 자유객체: 전체 축별 비율 중심 재배치(내지 정책 동일), 크기 보존
      newCenterContentX = contentCenterX * (newTotalWpx / oldTotalWpx);
      newCenterContentY = contentCenterY * (newTotalHpx / oldTotalHpx);
      if (bbox.width >= FULL_WIDTH_REVIEW_RATIO * oldTotalWpx) {
        reviewNotes.push(`FULL_WIDTH_OBJECT_REVIEW: ${objId ?? obj.type} (폭 ${bbox.width.toFixed(0)}px)`);
      }
    }

    const deltaX = newCenterContentX - newTotalWpx / 2 - bbox.centerX;
    const deltaY = newCenterContentY - newTotalHpx / 2 - bbox.centerY;
    if (typeof obj.left === 'number') obj.left = obj.left + deltaX;
    if (typeof obj.top === 'number') obj.top = obj.top + deltaY;

    // meta 명시 갱신 — stale regionRef/anchor 를 남기지 않는다(로드 직후 resizeSpine 정합)
    const meta = (obj.meta && typeof obj.meta === 'object' ? obj.meta : {}) as Record<string, unknown>;
    if (face) {
      const newFace = newFaces.get(face) as FaceRangePx;
      meta.regionRef = face;
      meta.primaryRegionHint = face;
      meta.anchor = {
        kind: 'region',
        xNorm: clamp((newCenterContentX - newFace.x0) / newFace.width, NORM_MIN, NORM_MAX),
        yNorm: clamp(newCenterContentY / newTotalHpx, NORM_MIN, NORM_MAX),
      };
    } else {
      meta.regionRef = null;
      meta.primaryRegionHint = null;
      meta.anchor = { kind: 'canvas', x: newCenterContentX - newTotalWpx / 2, y: newCenterContentY - newTotalHpx / 2 };
    }
    obj.meta = meta;

    transformed.push(obj);
  }

  cloned.objects = transformed;

  const spreadConfig2: SpreadConfig = {
    version: SPREAD_CONFIG_VERSION,
    spec: spec2,
    regions: buildRegions(spec2, newRanges),
    totalWidthMm: newDims.totalWidthMm,
    totalHeightMm: newDims.totalHeightMm,
    ...(spreadConfig.conversionMode !== undefined
      ? { conversionMode: spreadConfig.conversionMode }
      : {}),
    ...(spreadConfig.regionScope !== undefined ? { regionScope: spreadConfig.regionScope } : {}),
  };

  return {
    canvasData: cloned,
    spec: spec2,
    spreadConfig: spreadConfig2,
    widthMm: roundMm01(newDims.totalWidthMm),
    heightMm: roundMm01(newDims.totalHeightMm),
    reviewNotes,
  };
}
