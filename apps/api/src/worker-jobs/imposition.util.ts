/**
 * 고객 첨부 내지 PDF "리더 스프레드" 임포지션 계산 (2026-06-16).
 *
 * ⚠️ 용어 주의: 여기서 계산하는 것은 "리더 스프레드"(reader-spread) —
 *   사람이 완성된 책을 펼쳐 읽는 순서로 좌/우 페이지를 짝짓는 표시용 레이아웃이다.
 *   인쇄소가 한 장의 큰 종이에 페이지를 배치하는 "프린터 스프레드"(printer-spread)/
 *   면付(imposition for press)와는 전혀 다르다. 이 모듈은 절대 면付을 계산하지 않는다.
 *
 * 산출물은 bookmoa-mobile 같은 외부 호출자가 미리보기 UI에서
 * "이 PDF가 책으로 묶이면 펼침면이 이렇게 보입니다"를 그릴 때 사용한다.
 *
 * 순수 함수(부수효과 없음, 외부 의존성 없음) — 단위 테스트 대상.
 */

/** 펼침 시작 면 — 'right'(우수, 기본): 1p 단독 우측 / 'left'(좌수): 1p부터 좌측 펼침 */
export type SpreadStartSide = 'left' | 'right';

/**
 * 리더 스프레드 1개(펼침면 한 쌍).
 * left/right 는 1-기반 페이지 번호이며, 비어 있는 면(맨 처음/맨 끝의 홀로 남는 칸)은 null.
 */
export interface ReaderSpread {
  index: number;
  left: number | null;
  right: number | null;
}

/**
 * 리더 스프레드 레이아웃 전체.
 */
export interface PageImpositionLayout {
  startSide: SpreadStartSide;
  /** 사철(saddle) 제본 힌트 — 거터 없이 연속 렌더 권장 여부 */
  seamlessFold: boolean;
  totalPages: number;
  spreads: ReaderSpread[];
}

/**
 * 리더 스프레드 레이아웃을 계산한다.
 *
 * @param totalPages 내지 총 페이지 수 (0 이하면 빈 레이아웃)
 * @param startSide  펼침 시작 면 ('right'=우수 기본, 'left'=좌수)
 * @param binding    제본 방식 문자열 (예: 'perfect', 'saddle' …). 'saddle' 이면 seamlessFold=true.
 *
 * 규칙:
 *  - startSide='right'(우수, 기본): 1페이지는 오른쪽 단독.
 *      spreads[0] = { index:0, left:null, right: 1 (totalPages>=1 일 때) }
 *      이후 (2,3),(4,5)… → left=p, right=(p+1<=totalPages ? p+1 : null), p=2,4,6…
 *  - startSide='left'(좌수): 1페이지부터 왼쪽 펼침.
 *      (1,2),(3,4)… → left=p, right=(p+1<=totalPages ? p+1 : null), p=1,3,5…
 *  - 마지막에 홀로 남는 페이지의 짝 칸은 null(빈면).
 *  - totalPages<=0 → spreads:[].
 */
export function computeReaderSpreadLayout(
  totalPages: number,
  startSide: SpreadStartSide,
  binding: string,
): PageImpositionLayout {
  // 사철(saddle)만 거터 없이 연속 렌더 힌트(seamlessFold). 그 외 제본은 false.
  const seamlessFold = binding === 'saddle';

  // 0 이하/비정상 입력은 빈 레이아웃으로 정규화.
  const safeTotal =
    Number.isFinite(totalPages) && totalPages > 0 ? Math.floor(totalPages) : 0;

  const spreads: ReaderSpread[] = [];

  if (safeTotal <= 0) {
    return { startSide, seamlessFold, totalPages: safeTotal, spreads };
  }

  let index = 0;

  if (startSide === 'right') {
    // 우수: 1페이지는 오른쪽 단독 펼침.
    spreads.push({ index: index++, left: null, right: 1 });
    // 이후 (2,3),(4,5)… — 왼쪽이 짝수에서 시작.
    for (let p = 2; p <= safeTotal; p += 2) {
      spreads.push({
        index: index++,
        left: p,
        right: p + 1 <= safeTotal ? p + 1 : null,
      });
    }
  } else {
    // 좌수: 1페이지부터 (1,2),(3,4)… — 왼쪽이 홀수에서 시작.
    for (let p = 1; p <= safeTotal; p += 2) {
      spreads.push({
        index: index++,
        left: p,
        right: p + 1 <= safeTotal ? p + 1 : null,
      });
    }
  }

  return { startSide, seamlessFold, totalPages: safeTotal, spreads };
}
