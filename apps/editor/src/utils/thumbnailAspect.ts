/**
 * 페이지/펼침면 썸네일 박스를 **판형 비율**로 산출한다.
 *
 * 배경(2026-08-03 오너 보고): 페이지 네비게이션 썸네일이 판형과 무관하게 고정 박스였다
 * (PageItem `w-20 h-28` 5:7 세로 / SpreadThumbnailItem 2:1 / PageThumbnail 88×60·88×72).
 * 정방형(8×8) 템플릿도 세로로 길쭉한 카드에 들어가고, 같은 펼침면 세션 안에서도
 * 캔버스 0 만 2:1 로 그려져 모양이 갈렸다.
 *
 * 규약: **폭을 예산으로 고정하고 높이를 비율로 유도**한다. 세로/가로 패널의 폭 레이아웃 예산이
 * 바뀌지 않아 기존 화면 구성을 깨지 않으면서, 정방형=정사각·펼침면=와이드가 자연히 나온다.
 * A4 세로(210×297)는 폭 80 기준 높이 113px 로 종전 `h-28`(112px)과 사실상 동일해 무회귀다.
 */

/** 썸네일 박스 크기(px). CSS 클래스가 아니라 inline style 로 써야 한다 — Tailwind JIT 는 동적 클래스 문자열을 컴파일하지 못한다. */
export interface ThumbBox {
  width: number;
  height: number;
}

export interface ThumbAspectOptions {
  /** 폭 예산(px). 기본 80(= Tailwind w-20) */
  widthPx?: number;
  /** 높이 하한(px) — 극단적 가로형에서 카드가 선처럼 얇아지는 것 방지 */
  minHeightPx?: number;
  /** 높이 상한(px) — 극단적 세로형에서 목록이 무너지는 것 방지 */
  maxHeightPx?: number;
}

const DEFAULT_WIDTH_PX = 80;
const DEFAULT_MIN_HEIGHT_PX = 36;
const DEFAULT_MAX_HEIGHT_PX = 120;

/**
 * 판형(mm 또는 px — 비율만 쓰므로 단위 무관)에서 썸네일 박스를 구한다.
 * 치수를 못 읽는 경우(0/음수/비유한)는 `fallbackRatio` 로 폴백한다.
 */
export function computeThumbBox(
  widthMm: number | undefined,
  heightMm: number | undefined,
  options: ThumbAspectOptions = {},
): ThumbBox {
  const boxWidth = options.widthPx ?? DEFAULT_WIDTH_PX;
  const minH = options.minHeightPx ?? DEFAULT_MIN_HEIGHT_PX;
  const maxH = options.maxHeightPx ?? DEFAULT_MAX_HEIGHT_PX;

  const w = Number(widthMm);
  const h = Number(heightMm);
  const usable = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;

  // 치수 미상 → 종전 세로형 카드 비율(80×112 = 5:7)을 유지해 기존 화면과 동일하게 보이게 한다.
  if (!usable) {
    return { width: boxWidth, height: Math.round(boxWidth * (112 / 80)) };
  }

  const height = Math.round((boxWidth * h) / w);
  return { width: boxWidth, height: Math.min(maxH, Math.max(minH, height)) };
}
