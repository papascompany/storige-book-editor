import { defineConfig } from 'tsup';

/**
 * @storige/sdk 번들 — dual(cjs+esm) + dts.
 *
 * external 목록이 비어 있는 것이 정상이다: SDK 는 runtime 의존성 0 —
 * fetch/crypto.subtle/AbortController 등 표준 런타임 API 만 사용한다
 * (@storige/types 는 devDependency 로 구조 등가성 테스트에서만 쓰이며
 *  src/ 런타임 코드는 import 하지 않는다 → 번들에 유입되지 않음).
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'client/index': 'src/client/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
});
