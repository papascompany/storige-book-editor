// IDML PathGeometry → SVG/Fabric path 'd' 복원.
//
// IDML PathPointType = { Anchor(곡선상 점), LeftDirection(들어오는 핸들), RightDirection(나가는 핸들) }.
// 핸들이 Anchor 와 같으면 직선(L), 다르면 3차 베지어(C).
// PathOpen="false" → 닫힌 경로(Z).

/** 두 점([x,y]) 근사 동일 */
export const ptEq = (a, b, eps = 1e-4) =>
  Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;

/**
 * subpaths → SVG path d 문자열.
 * @param {{closed:boolean, points:{a:number[],l:number[],r:number[]}[]}[]} subpaths
 * @param {(p:number[])=>{x:number,y:number}} mapPt  로컬점 → 출력좌표 매퍼
 * @param {(n:number)=>number} [round]
 */
export function buildPathD(subpaths, mapPt, round = (n) => Math.round(n * 100) / 100) {
  const fmt = (p) => `${round(p.x)} ${round(p.y)}`;
  let d = '';
  for (const sp of subpaths) {
    const P = sp.points;
    if (!P || P.length === 0) continue;
    d += `M ${fmt(mapPt(P[0].a))} `;
    const n = P.length;
    const last = sp.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % n;
      const straight = ptEq(P[i].r, P[i].a) && ptEq(P[j].l, P[j].a);
      const isClosing = sp.closed && j === 0;
      // 닫는 세그먼트가 직선이면 Z 가 처리하므로 생략. 곡선이면 명시(Z 는 직선 닫기만 함).
      if (isClosing && straight) continue;
      if (straight) {
        d += `L ${fmt(mapPt(P[j].a))} `;
      } else {
        d += `C ${fmt(mapPt(P[i].r))} ${fmt(mapPt(P[j].l))} ${fmt(mapPt(P[j].a))} `;
      }
    }
    if (sp.closed) d += 'Z ';
  }
  return d.trim();
}

/** subpaths 의 anchor 들을 매퍼로 변환해 bbox 계산 */
export function transformedBBox(subpaths, mapPt) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    n = 0;
  for (const sp of subpaths) {
    for (const p of sp.points || []) {
      const q = mapPt(p.a);
      minX = Math.min(minX, q.x);
      maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, q.y);
      maxY = Math.max(maxY, q.y);
      n++;
    }
  }
  if (!n) return null;
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
}
