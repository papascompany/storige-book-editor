// 아핀 변환 행렬 — IDML ItemTransform 합성/적용.
//
// IDML PageItem 의 ItemTransform 은 "a b c d tx ty" 6값으로, 다음 2x3 아핀행렬이다:
//   | a c tx |
//   | b d ty |
//   | 0 0  1 |
// 점 변환:  x' = a*x + c*y + tx,  y' = b*x + d*y + ty
// (HTML canvas/Fabric 의 [a b c d e f] 와 동일 규약. e=tx, f=ty)
//
// 중첩(Spread → Group → Item)은 부모 행렬과 자식 행렬을 곱해 합성한다:
//   world = compose(M_spread, M_group, M_item)  // 적용 순서는 item 이 먼저

/** 항등행렬 */
export const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** IDML ItemTransform 배열 [a,b,c,d,tx,ty] → 행렬 객체 */
export function fromItemTransform(arr) {
  if (!arr || arr.length < 6) {
    throw new Error(`잘못된 ItemTransform: ${JSON.stringify(arr)}`);
  }
  const [a, b, c, d, tx, ty] = arr.map(Number);
  return { a, b, c, d, e: tx, f: ty };
}

/** m1 ∘ m2 (m2 를 먼저 적용한 뒤 m1 을 적용하는 합성 = 행렬곱 m1·m2) */
export function multiply(m1, m2) {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

/** 여러 행렬을 좌→우 순서로 합성. compose(A,B,C) = A·B·C (C 가 가장 먼저 적용됨) */
export function compose(...mats) {
  return mats.reduce((acc, m) => multiply(acc, m), IDENTITY);
}

/** 점 (x,y) 에 행렬 적용 → { x, y } */
export function applyToPoint(m, x, y) {
  return {
    x: m.a * x + m.c * y + m.e,
    y: m.b * x + m.d * y + m.f,
  };
}

/**
 * 행렬을 translate/scale/rotation 으로 분해 (skew 없다고 가정 — IDML 일반 케이스).
 * 음수 행렬식(det<0)은 한 축의 반전을 의미하며 scaleY 부호로 표현한다.
 * Fabric 객체의 left/top/scaleX/scaleY/angle 매핑에 사용.
 */
export function decompose(m) {
  const det = m.a * m.d - m.b * m.c;
  const scaleX = Math.hypot(m.a, m.b);
  let scaleY = Math.hypot(m.c, m.d);
  if (det < 0) scaleY = -scaleY; // 반전(flip) 흡수
  const rotationDeg = (Math.atan2(m.b, m.a) * 180) / Math.PI;
  return {
    translateX: m.e,
    translateY: m.f,
    scaleX,
    scaleY,
    rotationDeg,
    det,
    flipped: det < 0,
  };
}
