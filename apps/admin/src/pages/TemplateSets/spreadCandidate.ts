/**
 * 템플릿셋 조립 화면의 **스프레드 템플릿 후보 판정** (2026-08-03).
 *
 * 세트 판형 규약: `templateSet.width/height` = **내지 재단(한 면) 치수**.
 * 따라서 스프레드 후보도 '한 면' 기준으로 비교한다.
 *
 * - 표지 펼침면: `spec.coverWidthMm/coverHeightMm` (표지 한 면)
 * - **내지 펼침면(regionScope='inner')**: `innerSpec.pageWidthMm/pageHeightMm` (내지 한 면)
 *   종전에는 inner 가 `spec` 을 갖지 않아 '높이만 비교' 폴백으로 빠져 **폭 검증이 전혀 없었다**.
 *   그래서 폭이 다른 내지 펼침면도 후보에 떠 잘못 연결될 수 있었다.
 */

/** mm 비교 허용오차 — 폼 입력/JSON 왕복의 부동소수 잔차 흡수(0.01mm = 실무상 동일 치수) */
export function nearlyEqualMm(a: number | undefined, b: number | undefined): boolean {
  return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 0.01;
}

export interface SpreadCandidateInput {
  height?: number;
  spreadConfig?: {
    regionScope?: string;
    spec?: { coverWidthMm?: number; coverHeightMm?: number };
    innerSpec?: { pageWidthMm?: number; pageHeightMm?: number };
  } | null;
}

/**
 * 스프레드 템플릿이 세트 판형(한 면 width×height)에 맞는 후보인지 판정한다.
 * @returns true 면 후보 목록에 노출
 */
export function matchesSpreadCandidate(
  template: SpreadCandidateInput,
  setWidth: number | undefined,
  setHeight: number | undefined,
): boolean {
  const sc = template.spreadConfig;

  // 내지 펼침면 — innerSpec(한 면)이 권위. 폭·높이 모두 검증한다.
  if (sc?.regionScope === 'inner' && sc.innerSpec) {
    return (
      nearlyEqualMm(sc.innerSpec.pageWidthMm, setWidth) &&
      nearlyEqualMm(sc.innerSpec.pageHeightMm, setHeight)
    );
  }

  // 표지 펼침면 — spec(표지 한 면).
  // ⚠️ 정확 비교(===)를 **의도적으로 유지**한다. 프로덕션에서 이 규칙으로 운용돼 온 경로라,
  //    허용오차를 넣으면 종전에 숨겨졌던 템플릿이 후보에 새로 뜨는 동작 변화가 생긴다.
  //    허용오차는 신규 경로(inner)에만 적용한다.
  if (sc?.spec) {
    return sc.spec.coverWidthMm === setWidth && sc.spec.coverHeightMm === setHeight;
  }

  // spreadConfig 없음(레거시) — 높이만 비교하는 종전 폴백 유지
  return template.height === setHeight;
}
