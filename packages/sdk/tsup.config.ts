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
 *
 * ## 🚨 `node:` 프리픽스 보존 — **두 곳**이 벗기려 든다 (둘 다 꺼야 한다)
 * 종전 아티팩트는 위 주석의 주장과 어긋나 있었다: 소스의 `from 'node:crypto'` 가
 * dist 에선 `require('crypto')` / `from 'crypto'` 로 방출됐다. 범인이 둘이다 —
 * 하나만 고치면 그대로 벗겨진다(실측으로 확인):
 *
 *  ① **tsup `removeNodeProtocol`** — 기본값이 `true` 라 tsup 이 스스로 벗긴다.
 *     (tsup 자체 주석: "다음 major 에서 기본값을 false 로 뒤집을 예정")
 *  ② **esbuild `target`** — target 이 프리픽스 지원을 보장 못 하면 벗긴다.
 *     실측: `--target=es2022` → `require("crypto")` / `--target=node18` → `require("node:crypto")`.
 *
 * 왜 보존해야 하나: 프리픽스 없는 `'crypto'` 는 번들러가 npm 패키지로 오인하거나
 * 브라우저 shim 으로 치환할 여지를 준다. 이 SDK 는 **Next 어댑터를 제공하므로
 * 실제로 번들러를 통과한다** — `node:` 는 "이건 Node 빌트인이다"라는 명시 신호이자
 * 위 "런타임 의존성 0" 주장의 아티팩트 수준 증거다.
 *
 * `target: 'node18'` 은 package.json `engines.node>=18` 과도 정합한다.
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
  // engines.node>=18 정합 + esbuild 가 node: 프리픽스를 벗기지 않는 하한
  target: 'node18',
  // tsup 이 프리픽스를 벗기지 못하게 한다(기본 true — 위 ① 참조)
  removeNodeProtocol: false,
});
