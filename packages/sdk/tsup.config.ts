import { defineConfig } from 'tsup';

/**
 * @storige/sdk 번들 — dual(cjs+esm) + dts.
 *
 * external 목록이 비어 있는 것이 정상이다: SDK 는 **npm runtime 의존성 0** —
 * fetch/crypto.subtle/AbortController 등 표준 런타임 API 만 사용한다
 * (@storige/types 는 devDependency 로 구조 등가성 테스트에서만 쓰이며
 *  src/ 런타임 코드는 import 하지 않는다 → 번들에 유입되지 않음).
 *
 * 예외처럼 보이는 것: `./webhook` 서브패스는 node:crypto(createHmac·
 * timingSafeEqual)를 쓴다. 이는 Node **빌트인**이라 npm 의존성이 아니고,
 * tsup 기본 platform:'node' 가 자동 external 처리한다(external 등재 불요).
 * 대신 그 서브패스는 Node 전용이다 — 웹훅 수신은 서버측 동작이라 무해하다.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'client/index': 'src/client/index.ts',
    'webhook/index': 'src/webhook/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
});
