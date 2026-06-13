// @vitest-environment jsdom
//
// sanitizeSvgMarkup 단위테스트 — 프로덕션 경로(DOMParser/XMLSerializer)를 실제로
// 행사하기 위해 jsdom 환경을 강제한다(admin vitest 기본은 node).
// happy-dom 은 image/svg+xml 파싱 시 documentElement 가 null 이라 부적합.
import { describe, it, expect } from 'vitest';
import { sanitizeSvgMarkup } from './sanitizeSvg';

const wrap = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${inner}</svg>`;

describe('sanitizeSvgMarkup — 악성 콘텐츠 제거', () => {
  it('<script> 요소를 제거한다', () => {
    const out = sanitizeSvgMarkup(wrap('<script>alert(1)</script><rect width="5" height="5"/>'));
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain('rect');
  });

  it('on* 이벤트 핸들러 속성을 제거한다', () => {
    const out = sanitizeSvgMarkup(wrap('<rect width="5" height="5" onload="alert(1)" onclick="x()"/>'));
    expect(out).not.toMatch(/onload/i);
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain('rect');
  });

  it('루트 <svg> 의 onload 도 제거한다', () => {
    const out = sanitizeSvgMarkup(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="5" height="5"/></svg>'
    );
    expect(out).not.toMatch(/onload/i);
  });

  it('href 의 javascript: 스킴을 제거한다', () => {
    const out = sanitizeSvgMarkup(wrap('<image href="javascript:alert(1)" width="5" height="5"/>'));
    expect(out).not.toMatch(/javascript:/i);
  });

  it('href 의 우회 스킴(공백/제어문자 삽입)도 제거한다', () => {
    const out = sanitizeSvgMarkup(
      wrap('<image href="java\tscript:alert(1)" width="5" height="5"/>')
    );
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/java\tscript:/i);
  });

  it('xlink:href 의 javascript: 스킴을 제거한다', () => {
    const out = sanitizeSvgMarkup(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="javascript:alert(1)" width="5" height="5"/></svg>`
    );
    expect(out).not.toMatch(/javascript:/i);
  });

  it('<foreignObject> 같은 비허용 요소를 제거한다', () => {
    const out = sanitizeSvgMarkup(
      wrap('<foreignObject><div onclick="x()">hi</div></foreignObject><rect width="5" height="5"/>')
    );
    expect(out).not.toMatch(/foreignObject/i);
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain('rect');
  });

  it('style 속성(우회 벡터)을 제거한다', () => {
    const out = sanitizeSvgMarkup(wrap('<rect width="5" height="5" style="x:expression(alert(1))"/>'));
    expect(out).not.toMatch(/style=/i);
  });

  it('잘못된 XML 은 빈 문자열을 반환한다(주입 금지)', () => {
    const out = sanitizeSvgMarkup('<svg><rect</svg>');
    expect(out).toBe('');
  });

  it('루트가 svg 가 아니면 빈 문자열을 반환한다', () => {
    const out = sanitizeSvgMarkup('<html><body>x</body></html>');
    expect(out).toBe('');
  });

  it('빈/비문자열 입력은 빈 문자열', () => {
    expect(sanitizeSvgMarkup('')).toBe('');
    // @ts-expect-error 런타임 방어 확인
    expect(sanitizeSvgMarkup(null)).toBe('');
  });
});

describe('sanitizeSvgMarkup — 정상 출력 보존(화이트리스트)', () => {
  it('정상 도형/텍스트/그라디언트를 보존한다', () => {
    const svg = wrap(
      '<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs>' +
        '<rect x="0" y="0" width="5" height="5" fill="url(#g)"/>' +
        '<ellipse cx="2" cy="2" rx="1" ry="1" fill="#00f" stroke="#000"/>' +
        '<path d="M0 0 L5 5" fill="#0f0"/>' +
        '<g transform="rotate(10 5 5)"><text x="1" y="2" fill="#333">Hi</text></g>'
    );
    const out = sanitizeSvgMarkup(svg);
    expect(out).toContain('rect');
    expect(out).toContain('ellipse');
    expect(out).toContain('path');
    expect(out).toContain('linearGradient');
    expect(out).toContain('stop');
    expect(out).toContain('url(#g)');
    expect(out).toContain('Hi');
    expect(out).toContain('rotate(10 5 5)');
    expect(out).toContain('stroke');
  });

  it('data:image/png href 는 보존한다', () => {
    const out = sanitizeSvgMarkup(
      wrap('<image href="data:image/png;base64,iVBOR" width="5" height="5"/>')
    );
    expect(out).toContain('data:image/png;base64,iVBOR');
  });

  it('http(s) href 는 보존한다', () => {
    const out = sanitizeSvgMarkup(
      wrap('<image href="https://cdn.example.com/a.png" width="5" height="5"/>')
    );
    expect(out).toContain('https://cdn.example.com/a.png');
  });
});
