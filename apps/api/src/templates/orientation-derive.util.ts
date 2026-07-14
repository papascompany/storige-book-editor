/**
 * 방향(orientation) 파생 순수 변환 유틸 — 가로↔세로 templateSet 파생 (2026-07-14).
 *
 * NestJS/TypeORM 의존 없음(순수 함수) — orientation-derive.spec.ts 단위테스트 대상.
 * 페어링/파생 규칙의 mm 비교 시맨틱은 admin 헬퍼(apps/admin/src/components/
 * formatPresetHelpers.ts — DIM_TOLERANCE_MM=0.01)와 동일하게 유지한다.
 *
 * 좌표 규약(reference_coordinate_convention):
 * - canvasData top-level width/height = 판형 메타(mm). 객체 left/top = 중앙원점 px@150dpi.
 * - 오너 승인 설계(2026-07-14) ④: 파생 시 객체의 크기·회전·스타일·잠금·z순서·requiredEdit 는
 *   유지하고 "위치만" 축별 비율 재배치 — left×(newW/oldW), top×(newH/oldH).
 *
 * workspace 계열 처리 방침(실코드 근거 — notes 요구사항):
 * - id='workspace' rect: 저장 canvasData 에 포함되는 실객체다(픽스처 MA-348 확인).
 *   WorkspacePlugin.afterLoad(packages/canvas-core/src/plugins/WorkspacePlugin.ts:575~)는
 *   로드된 workspace 가 "있으면 그대로" clipPath 로 사용하고, 없을 때만 _options.size 로
 *   만든 폴백을 복원한다(IDML/PSD 변환 템플릿 구제용 — "일반 템플릿은 canvasData 에
 *   workspace 가 포함" 주석). 즉 재생성되지 않으므로 drop 금지 — 치수 변환(W↔H 스왑)한다.
 * - cut-border / crop-marks / safe-zone-border: WorkspacePlugin 이 afterLoad 마다
 *   createOrUpdateCutBorder/createOrUpdateSafeSize 로 재생성하며 생성 시
 *   excludeFromExport:true (WorkspacePlugin.ts:1259·1363·safe-zone-border 생성부) —
 *   정상 저장물에는 아예 직렬화되지 않는다. 발견 시(레거시/변환기 잔재) drop.
 * - center-guideline-h / center-guideline-v: RulerPlugin 이 재생성 + excludeFromExport:true
 *   (RulerPlugin.ts:170~186) — 동일하게 drop.
 */
import type { CanvasData, FabricObject } from '@storige/types';

/** mm 비교 허용오차 — admin formatPresetHelpers.DIM_TOLERANCE_MM 과 동일 시맨틱(±0.01mm). */
export const ORIENTATION_MM_TOLERANCE = 0.01;

export function nearlyEqualMm(a: number, b: number): boolean {
  return Math.abs(a - b) <= ORIENTATION_MM_TOLERANCE;
}

/** 정사각(±0.01mm) — 방향 페어링/파생이 무의미(스왑해도 동일)하므로 금지 대상. */
export function isNearlySquare(widthMm: number, heightMm: number): boolean {
  return nearlyEqualMm(widthMm, heightMm);
}

/** 두 판형이 정확 W↔H 스왑 관계(±0.01mm)인지 — 페어링 성립 조건. */
export function isExactOrientationSwap(
  aWidthMm: number,
  aHeightMm: number,
  bWidthMm: number,
  bHeightMm: number,
): boolean {
  return nearlyEqualMm(aWidthMm, bHeightMm) && nearlyEqualMm(aHeightMm, bWidthMm);
}

/** 방향 이름 접미 — 가로형 ' (가로)' / 세로형 ' (세로)'. */
export function orientationNameSuffix(widthMm: number, heightMm: number): string {
  return widthMm > heightMm ? ' (가로)' : ' (세로)';
}

/** 기존 방향 접미를 제거한 뒤 새 접미를 부착 — "A4 (세로) (가로)" 같은 중첩 방지. */
export function withOrientationSuffix(name: string, suffix: string): string {
  const stripped = name.replace(/ \((가로|세로)\)$/u, '');
  return `${stripped}${suffix}`;
}

/** 작업영역 실객체 — drop 금지, 치수 변환 대상 (근거는 파일 헤더 주석). */
export const WORKSPACE_OBJECT_ID = 'workspace';

/**
 * 로드 시 플러그인이 재생성하는 화면 전용 가이드(excludeFromExport) id 목록 — 발견 시 drop.
 * (정상 저장물에는 직렬화되지 않음 — 레거시/변환기 잔재 방어.)
 */
export const REGENERATED_GUIDE_IDS: readonly string[] = [
  'cut-border',
  'safe-zone-border',
  'crop-marks',
  'center-guideline-h',
  'center-guideline-v',
];

export interface OrientationTransformParams {
  /** 원본 판형 가로 (mm) */
  oldWmm: number;
  /** 원본 판형 세로 (mm) */
  oldHmm: number;
  /** 새 판형 가로 (mm) */
  newWmm: number;
  /** 새 판형 세로 (mm) */
  newHmm: number;
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`transformCanvasDataOrientation: ${label} 는 양의 유한수여야 합니다 (got ${value})`);
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * canvasData 방향 변환 (순수 — 입력 불변, JSON 클론 반환).
 *
 * - top-level width/height(mm) → newWmm/newHmm 로 갱신 (reference_loadjson_dimension_trap:
 *   판형 메타이므로 새 값으로 스왑 기록).
 * - 일반 객체: left×(newW/oldW), top×(newH/oldH) 위치만 재배치. 크기(width/height/scaleX/Y)·
 *   회전(angle)·styles·잠금류·requiredEdit·id·z순서(배열 순서) 전부 보존.
 * - id='workspace': 유효 치수(width×scaleX, height×scaleY)를 변환. 정확 W↔H 스왑이면
 *   유효 치수를 그대로 스왑(대칭 블리드 보존 — 정확해), 그 외 일반 리사이즈면 축별 비율.
 *   scaleX/scaleY 는 1 로 정규화해 기록. 위치도 축별 비율(중앙원점 0,0 은 불변).
 * - REGENERATED_GUIDE_IDS: drop (로드 시 플러그인이 재생성 — 파일 헤더 근거).
 * - 클론은 순수 JSON 딥클론 — textbox styles 키 누락 함정(reference_fabric_styles_trap)
 *   없이 원형 그대로 보존된다.
 */
export function transformCanvasDataOrientation(
  canvasData: CanvasData,
  params: OrientationTransformParams,
): CanvasData {
  const { oldWmm, oldHmm, newWmm, newHmm } = params;
  assertPositiveFinite(oldWmm, 'oldWmm');
  assertPositiveFinite(oldHmm, 'oldHmm');
  assertPositiveFinite(newWmm, 'newWmm');
  assertPositiveFinite(newHmm, 'newHmm');

  // 순수 JSON 딥클론 — 입력 불변 + styles 등 임의 키 보존
  const cloned = JSON.parse(JSON.stringify(canvasData)) as CanvasData;
  cloned.width = newWmm;
  cloned.height = newHmm;

  const ratioX = newWmm / oldWmm;
  const ratioY = newHmm / oldHmm;
  const exactSwap = isExactOrientationSwap(oldWmm, oldHmm, newWmm, newHmm);

  const sourceObjects: FabricObject[] = Array.isArray(cloned.objects) ? cloned.objects : [];
  const transformed: FabricObject[] = [];

  for (const obj of sourceObjects) {
    const objId = typeof obj.id === 'string' ? obj.id : undefined;

    // 화면 전용 재생성 가이드 잔재 — drop
    if (objId !== undefined && REGENERATED_GUIDE_IDS.includes(objId)) {
      continue;
    }

    if (objId === WORKSPACE_OBJECT_ID) {
      // 작업영역: 유효 치수 변환 (정확 스왑이면 W↔H 그대로 교환 — 블리드 여분 보존)
      const scaleX = numberOr(obj.scaleX, 1);
      const scaleY = numberOr(obj.scaleY, 1);
      const effW = numberOr(obj.width, 0) * scaleX;
      const effH = numberOr(obj.height, 0) * scaleY;
      const newEffW = exactSwap ? effH : effW * ratioX;
      const newEffH = exactSwap ? effW : effH * ratioY;
      obj.width = newEffW;
      obj.height = newEffH;
      obj.scaleX = 1;
      obj.scaleY = 1;
      if (typeof obj.left === 'number') obj.left = obj.left * ratioX;
      if (typeof obj.top === 'number') obj.top = obj.top * ratioY;
      transformed.push(obj);
      continue;
    }

    // 일반 객체: 위치만 축별 비율 재배치 — 나머지 속성 전부 보존
    if (typeof obj.left === 'number') obj.left = obj.left * ratioX;
    if (typeof obj.top === 'number') obj.top = obj.top * ratioY;
    transformed.push(obj);
  }

  cloned.objects = transformed;
  return cloned;
}
