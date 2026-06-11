// flat-spine 모드 크롭 지오메트리 — 순수 함수(래스터 의존 없음, 단위테스트 대상).
//
// 전폭 300dpi 아트워크 1장을 3크롭으로 나눈다:
//   - back  : content x ∈ [0, spine.x)            → id='back-artwork',  regionRef='back-cover'
//   - front : content x ∈ [spine.x+spine.w, totalW) → id='front-artwork', regionRef='front-cover'
//   - spine : 책등 중심 기준 3배폭(별도 크롭 — back/front 와 겹침 허용, 최하단 z 에 깔림)
//             → id='spine-artwork', regionRef=null, canvas anchor(scene x=0)
//
// 픽셀 공식(절대 규칙 #5): px = Math.round(mm / 25.4 * dpi). canvasData 는 150dpi, 래스터는 300dpi.
// 반올림 일관성: back/spine밴드/front 의 경계(spineLeftPx/spineRightPx)는 같은 누적 mm 값을
// 한 번씩만 반올림 → back.width + spineBandWidth + front.width === fullWidthPx 가 항상 성립.
// spine 크롭 폭은 3×spineWidthMm 를 직접 px 환산(정확한 3배폭) 후 중심 정렬한다.

import { layoutRegionsMm, computeTotalWidthMm } from '../geometry/regions.mjs';
import { MM_PER_INCH } from '../geometry/units.mjs';

/**
 * spec(mm) → 300dpi 크롭 경계.
 * @param {object} spec  SpreadSpec ({coverWidthMm, coverHeightMm, spineWidthMm, wingEnabled, wingWidthMm})
 * @param {{dpi?:number}} [opts]  래스터 dpi(기본 300)
 * @returns {{
 *   dpi:number, fullWidthPx:number, fullHeightPx:number, totalWidthMm:number,
 *   spineLeftPx:number, spineRightPx:number, spineCenterMm:number,
 *   back:{left:number, width:number, centerPx:number},
 *   front:{left:number, width:number, centerPx:number},
 *   spine:{left:number, width:number, centerPx:number},
 * }}
 */
export function computeFlatSpineCrops(spec, opts = {}) {
  const dpi = opts.dpi || 300;
  const px = (mm) => Math.round((mm / MM_PER_INCH) * dpi);

  const totalWidthMm = computeTotalWidthMm(spec);
  const fullWidthPx = px(totalWidthMm);
  const fullHeightPx = px(spec.coverHeightMm);

  const spineRegion = layoutRegionsMm(spec).find((r) => r.kind === 'spine');
  if (!spineRegion || !(spineRegion.widthMm > 0)) {
    throw new Error('flat-spine: spec 에 유효한 책등(spine) 폭이 없습니다');
  }

  // 경계 px: 누적 mm 를 각각 한 번만 반올림 → 3분할 폭 합 = 전폭 보장.
  const spineLeftPx = px(spineRegion.xMm);
  const spineRightPx = px(spineRegion.xMm + spineRegion.widthMm);

  // centerPx: 크롭 중심(px, 콘텐츠 좌상단원점) — 소비측(index.mjs 객체 배치)이 left/width 에서
  // 따로 유도하지 않고 이 값을 단일 출처로 쓴다. 일반식 (left + left + width)/2 = left + width/2
  // 이므로 back.left=0 같은 암묵 전제에 결합되지 않는다.
  const back = { left: 0, width: spineLeftPx, centerPx: 0 + spineLeftPx / 2 };
  const front = {
    left: spineRightPx,
    width: fullWidthPx - spineRightPx,
    centerPx: (spineRightPx + fullWidthPx) / 2,
  };

  // spine 크롭: 정확한 3배폭(mm 기반) + 책등 중심 정렬. 표지가 극단적으로 좁아
  // 크롭이 캔버스를 벗어나는 경우만 경계로 클램프(중심이 살짝 이동하는 퇴화 케이스).
  const spineCenterMm = spineRegion.xMm + spineRegion.widthMm / 2;
  const spineCropWidth = Math.min(px(spineRegion.widthMm * 3), fullWidthPx);
  const spineCenterPxF = (spineCenterMm / MM_PER_INCH) * dpi;
  let spineCropLeft = Math.round(spineCenterPxF - spineCropWidth / 2);
  spineCropLeft = Math.max(0, Math.min(spineCropLeft, fullWidthPx - spineCropWidth));

  return {
    dpi,
    fullWidthPx,
    fullHeightPx,
    totalWidthMm,
    spineLeftPx,
    spineRightPx,
    spineCenterMm,
    back,
    front,
    // spine.centerPx 는 클램프/반올림 후의 실제 크롭 중심 — 클램프 퇴화 케이스의 중심 이동이
    // 자동으로 흡수된다(가정값 '책등 중심' 과 다를 수 있음).
    spine: { left: spineCropLeft, width: spineCropWidth, centerPx: spineCropLeft + spineCropWidth / 2 },
  };
}
