// 컴포넌트 테스트 규약 — vitest (node 환경). *.test.tsx 는 첫 줄 happy-dom docblock,
// 첫 import 는 src/test/renderWithAntd(Storage 폴리필·cleanup 이 다른 모듈보다 먼저 적용)다.
// *.test.ts 는 검사하지 않는다(파일별 DOM 환경 docblock 을 그대로 쓴다).
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function componentTests(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...componentTests(full));
    else if (entry.name.endsWith('.test.tsx')) found.push(full);
  }
  return found;
}

const files = componentTests(SRC);

// 소스의 첫 import 문 하나의 모듈 경로. named·default·side-effect(`import 'x';`) 형태를 모두 받고,
// 모듈 지정자 앞부분은 따옴표를 넘지 않으므로 다음 import 문으로 이어지지 않는다.
function firstImportPath(source: string): string | undefined {
  return /^import\s+(?:[^'"]*?\s+from\s+)?(['"])([^'"]+)\1/m.exec(source)?.[2];
}

describe('firstImportPath', () => {
  it('named import 의 모듈 경로를 돌려준다', () => {
    const source = "import { renderWithAntd } from '../../test/renderWithAntd';\nimport { x } from 'y';\n";
    expect(firstImportPath(source)).toBe('../../test/renderWithAntd');
  });

  it('여러 줄 named import 의 모듈 경로를 돌려준다', () => {
    const source = "import {\n  renderWithAntd,\n  screen,\n} from '../test/renderWithAntd';\n";
    expect(firstImportPath(source)).toBe('../test/renderWithAntd');
  });

  it('side-effect import 가 첫 import 이면 그 경로를 돌려준다', () => {
    expect(firstImportPath("import '../../test/renderWithAntd';\nimport { x } from 'y';\n")).toBe(
      '../../test/renderWithAntd',
    );
    expect(
      firstImportPath("import 'some-polyfill';\nimport { renderWithAntd } from '../test/renderWithAntd';\n"),
    ).toBe('some-polyfill');
  });
});

describe('컴포넌트 테스트 규약', () => {
  it('컴포넌트 테스트 파일이 수집된다', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [relative(SRC, f), f]))('%s 는 첫 줄이 happy-dom docblock 이다', (_name, file) => {
    const firstLine = readFileSync(file, 'utf8').split('\n', 1)[0];
    expect(firstLine).toBe('// @vitest-environment happy-dom');
  });

  it.each(files.map((f) => [relative(SRC, f), f]))('%s 는 renderWithAntd 를 첫 import 로 둔다', (_name, file) => {
    expect(firstImportPath(readFileSync(file, 'utf8'))).toMatch(/\/test\/renderWithAntd$/);
  });
});
