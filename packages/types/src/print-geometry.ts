/**
 * 인쇄 기하 파생 — 템플릿셋 규격 필드(재단 width×height · 사방 bleedMm · cropMarkEnabled)에서
 * 재단 크기·유효 도련·작업 크기·재단 마커 여부·표지 스프레드 cutSizeMm 을 계산하는 순수 함수.
 *
 * 작업 크기는 저장하지 않고 이 함수로 파생한다. 식은 편집기와 같다.
 * - 유효 도련 게이트: `cropMarkEnabled === true && bleedMm > 0`
 *   (canvas-core `plugins/pdfPageGeometry.ts` 의 작업사이즈 게이트와 같은 식).
 * - 표지 스프레드 cutSizeMm: 게이트 ON = bleedMm × 2, OFF = 2
 *   (editor `hooks/useEditorContents.ts` 의 spread spec 구성과 같은 식).
 *
 * 모든 값의 단위는 mm 이다.
 */

/** 게이트 OFF 일 때 표지 스프레드 cutSizeMm(양변 합) 기본값 — 변당 1mm. */
const COVER_SPREAD_CUT_SIZE_GATE_OFF_MM = 2;

/** resolvePrintGeometry 입력 — 템플릿셋 규격 필드의 최소 부분형. */
export interface PrintGeometrySource {
  /** 재단 가로(mm) — 템플릿셋 `width` */
  width: number;
  /** 재단 세로(mm) — 템플릿셋 `height` */
  height: number;
  /** 사방(per-edge) 도련 mm — 템플릿셋 `bleedMm`. 없으면 0 으로 본다. */
  bleedMm?: number | null;
  /** 재단선(crop mark) 스위치 — 템플릿셋 `cropMarkEnabled`. `true` 일 때만 게이트 ON. */
  cropMarkEnabled?: boolean | null;
}

export interface PrintGeometrySize {
  w: number;
  h: number;
}

export interface PrintGeometry {
  /** 재단 크기 = 템플릿셋 width×height */
  trimMm: PrintGeometrySize;
  /** 유효 사방 도련 mm — 게이트 ON 이면 세트 bleedMm, OFF 면 0 */
  bleedMm: number;
  /** 작업 크기 = 재단 + 2 × 유효 도련 */
  workMm: PrintGeometrySize;
  /** 재단 마커·TrimBox 출력 여부 = 게이트(cropMarkEnabled === true && bleedMm > 0) */
  cropMarks: boolean;
  /**
   * 표지 스프레드 cutSizeMm — **양변 합** 단위(변당 = 값 / 2).
   * 게이트 ON = bleedMm × 2, OFF = 2.
   *
   * 호출부 책임(이 함수는 템플릿 데이터를 보지 않는다):
   * - 게이트 OFF 이고 표지 템플릿 `spreadConfig.spec.cutSizeMm` 이 저장돼 있으면 그 값이 우선한다
   *   (`spec.cutSizeMm || coverSpreadCutSizeMm`). 게이트 ON 이면 편집기는 저장값을 이 값으로 덮어쓴다.
   * - 양장 싸바리(wrap) 모드·포토북 내지 placeholder spec 은 이 값을 쓰지 않는다.
   * - 표지 스프레드가 있는 세트인지 판단해 표시·사용 여부를 정한다.
   */
  coverSpreadCutSizeMm: number;
}

/**
 * 템플릿셋 규격에서 재단·유효 도련·작업 크기·재단 마커 여부·표지 스프레드 cutSizeMm 을 계산한다.
 *
 * 범위 밖(호출부 책임): 호스트 주문 옵션 `metadata.size`/`metadata.bleed` 우선 규칙,
 * 봉투 상품(편집기는 봉투에서 작업사이즈를 쓰지 않는다), 싸바리 wrap 여분, printSize 중앙 배치,
 * 표지 템플릿 저장 `spec.cutSizeMm` 우선 규칙.
 */
export function resolvePrintGeometry(set: PrintGeometrySource): PrintGeometry {
  const rawBleedMm = set.bleedMm;
  const cropMarks = set.cropMarkEnabled === true && typeof rawBleedMm === 'number' && rawBleedMm > 0;
  const bleedMm = cropMarks ? rawBleedMm : 0;

  return {
    trimMm: { w: set.width, h: set.height },
    bleedMm,
    workMm: { w: set.width + bleedMm * 2, h: set.height + bleedMm * 2 },
    cropMarks,
    coverSpreadCutSizeMm: cropMarks ? bleedMm * 2 : COVER_SPREAD_CUT_SIZE_GATE_OFF_MM,
  };
}
