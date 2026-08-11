import {
  tokenize,
  scanStreamsForWhiteOverprint,
  extractStreamBody,
  PageStreamInput,
} from './white-overprint-scan';

/**
 * R4b 화이트 오버프린트 스캐너 회귀 잠금 — 연산자 수준 상태 추적의 계약.
 */

const stream = (
  content: string,
  extGStates: PageStreamInput['extGStates'] = { GS1: { OP: true, op: true } },
  page = 1,
): PageStreamInput => ({ page, content, extGStates });

describe('tokenize', () => {
  it('문자열/16진 리터럴 내부의 연산자 모양 텍스트를 상태 오염 없이 스킵한다', () => {
    const t = tokenize('(1 1 1 rg f) Tj <414243> Tj 0 0 0 0 k');
    expect(t).toEqual(['()', 'Tj', '<>', 'Tj', '0', '0', '0', '0', 'k']);
  });

  it('중첩·이스케이프 괄호를 처리한다', () => {
    const t = tokenize('(a\\(b\\)c(d)) Tj');
    expect(t).toEqual(['()', 'Tj']);
  });
});

describe('scanStreamsForWhiteOverprint', () => {
  it('흰색 채움 + op ON 도형 페인트를 검출한다 (rg 흰색)', () => {
    const r = scanStreamsForWhiteOverprint([
      stream('/GS1 gs 1 1 1 rg 0 0 100 100 re f'),
    ]);
    expect(r.hasWhiteOverprint).toBe(true);
    expect(r.pathPages).toEqual([1]);
    expect(r.textPages).toEqual([]);
  });

  it('CMYK 흰색(0 0 0 0 k) + 텍스트 페인트 → textPages (GWG error 급)', () => {
    const r = scanStreamsForWhiteOverprint([
      stream('/GS1 gs BT 0 0 0 0 k (hi) Tj ET'),
    ]);
    expect(r.textPages).toEqual([1]);
  });

  it('흰색이어도 오버프린트 OFF 면 미검출', () => {
    const r = scanStreamsForWhiteOverprint([
      stream('1 1 1 rg 0 0 100 100 re f', { GS1: { OP: false, op: false } }),
    ]);
    expect(r.hasWhiteOverprint).toBe(false);
  });

  it('오버프린트 ON 이어도 비흰색이면 미검출', () => {
    const r = scanStreamsForWhiteOverprint([
      stream('/GS1 gs 0 0 0 rg 0 0 100 100 re f'),
    ]);
    expect(r.hasWhiteOverprint).toBe(false);
  });

  it('q/Q 스택: Q 복원 후에는 오버프린트 상태가 풀린다', () => {
    const r = scanStreamsForWhiteOverprint([
      stream('q /GS1 gs Q 1 1 1 rg 0 0 100 100 re f'),
    ]);
    expect(r.hasWhiteOverprint).toBe(false);
  });

  it('사양 준수: /op 부재 시 /OP 가 채움 오버프린트를 겸한다', () => {
    const r = scanStreamsForWhiteOverprint([
      stream('/GS1 gs 1 g 0 0 10 10 re f', { GS1: { OP: true } }),
    ]);
    expect(r.pathPages).toEqual([1]);
  });

  it('/op false 명시가 /OP true 를 채움에서 무효화한다', () => {
    const r = scanStreamsForWhiteOverprint([
      stream('/GS1 gs 1 g 0 0 10 10 re f', { GS1: { OP: true, op: false } }),
    ]);
    expect(r.hasWhiteOverprint).toBe(false);
  });

  it('획 오버프린트: 흰색 RG + S 는 pathPages, 텍스트 Tr 1(획) 은 textPages', () => {
    const r1 = scanStreamsForWhiteOverprint([
      stream('/GS1 gs 1 1 1 RG 0 0 m 100 100 l S'),
    ]);
    expect(r1.pathPages).toEqual([1]);

    const r2 = scanStreamsForWhiteOverprint([
      stream('/GS1 gs BT 1 Tr 1 1 1 RG (x) Tj ET'),
    ]);
    expect(r2.textPages).toEqual([1]);
  });

  it('Tr 3(비가시) 텍스트는 검출하지 않는다', () => {
    const r = scanStreamsForWhiteOverprint([
      stream('/GS1 gs BT 3 Tr 1 1 1 rg (x) Tj ET'),
    ]);
    expect(r.hasWhiteOverprint).toBe(false);
  });

  it('scn(비표준 색공간) 지정은 보수적으로 흰색 아님 처리 — 오탐 0', () => {
    const r = scanStreamsForWhiteOverprint([
      stream('/GS1 gs 1 1 1 rg /CS0 cs 1 1 1 scn 0 0 10 10 re f'),
    ]);
    expect(r.hasWhiteOverprint).toBe(false);
  });

  it('여러 페이지를 독립 집계한다', () => {
    const r = scanStreamsForWhiteOverprint([
      stream('/GS1 gs 1 1 1 rg 0 0 10 10 re f', undefined, 2),
      stream('0 0 0 rg 0 0 10 10 re f', { GS1: {} }, 3),
    ]);
    expect(r.pathPages).toEqual([2]);
    expect(r.scannedStreams).toBe(2);
  });
});

describe('extractStreamBody', () => {
  it('객체번호로 stream 본문을 추출한다', () => {
    const qdf = `5 0 obj\n<< /Length 20 >>\nstream\n1 1 1 rg 0 0 5 5 re f\nendstream\nendobj\n`;
    expect(extractStreamBody(qdf, 5)).toBe('1 1 1 rg 0 0 5 5 re f\n');
    expect(extractStreamBody(qdf, 6)).toBeNull();
  });
});
