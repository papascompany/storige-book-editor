/**
 * canvas-core 테스트 프리플라이트 — node-canvas 네이티브 모듈 가용성 검사.
 *
 * 왜 이 파일이 있나 (2026-08-24):
 *   fabric 5.x 의 node 엔트리는 `canvas`(node-canvas) 네이티브 모듈을 **하드 요구**한다.
 *   이 모듈이 로드되지 않으면 두 가지 증상이 동시에 난다.
 *     ① fabric 을 최상위에서 import 하는 스위트 5개 → 로드 시점 예외로 통째 FAIL
 *     ② jsdom/노드 캔버스 컨텍스트가 null → `Cannot set properties of null (setting 'textBaseline')`
 *   문제는 **수집 자체가 줄어든다**는 것이다. 실측(2026-08-24): 정상 623 tests / 54 files 인데
 *   canvas 파손 상태에서는 551 tests 만 수집되고 "6 files failed" 로만 보였다. 즉 72개 테스트가
 *   실패도 스킵도 아닌 **부재**로 사라졌고, 이 상태가 여러 스프린트에 걸쳐 "기존 베이스라인
 *   실패 6파일(ABI)" 로 문서화돼 회귀 판정에서 제외되고 있었다.
 *
 *   그래서 경고가 아니라 **하드 실패**다. 커버리지가 조용히 줄어드는 것보다,
 *   한 줄짜리 원인+처방으로 즉시 멈추는 편이 안전하다.
 *
 * 처방:
 *   - Node 버전이 바뀌면 ABI(NODE_MODULE_VERSION)가 어긋난다 → 재빌드 필요.
 *   - canvas@2.11.2 는 **Node 26 의 V8 에서 컴파일되지 않는다**(`v8::Context::GetIsolate` 제거).
 *     CI 는 Node 24 로 소스 빌드한다(.github/workflows/ci.yml 의 시스템 의존성 스텝).
 *   - macOS 로컬 재빌드(Node 22/24 기준, Homebrew):
 *       brew install cairo pango libpng jpeg-turbo giflib pkg-config
 *       cd "$(ls -d node_modules/.pnpm/canvas@2.11.2*)"/node_modules/canvas
 *       PKG_CONFIG_PATH="$(brew --prefix)/lib/pkgconfig:$(brew --prefix jpeg-turbo)/lib/pkgconfig" \
 *         npx --yes node-gyp@11 rebuild
 *     (canvas 번들 node-gyp 8.4.1 은 Python 3.12+ 에서 distutils 부재로 실패 → node-gyp@11 명시)
 */

const REMEDY = `
canvas-core 테스트는 node-canvas 네이티브 모듈을 요구합니다(fabric 5.x node 엔트리).
이 모듈 없이 실행하면 테스트가 실패하는 게 아니라 **수집 자체가 줄어듭니다**
(실측: 623 → 551 tests, 6 files 만 FAIL 로 표시). 회귀 판정이 무의미해지므로 여기서 중단합니다.

현재 Node: ${process.version} (NODE_MODULE_VERSION ${process.versions.modules})

재빌드(macOS/Homebrew):
  brew install cairo pango libpng jpeg-turbo giflib pkg-config
  cd "$(ls -d node_modules/.pnpm/canvas@2.11.2*)"/node_modules/canvas
  PKG_CONFIG_PATH="$(brew --prefix)/lib/pkgconfig:$(brew --prefix jpeg-turbo)/lib/pkgconfig" \\
    npx --yes node-gyp@11 rebuild

⚠️ canvas@2.11.2 는 Node 26 의 V8 에서 컴파일되지 않습니다('v8::Context::GetIsolate' 제거).
   Node 24(=CI 버전) 또는 22 로 빌드/실행하세요.
`

try {
  const nodeRequire = require
  const c = nodeRequire('canvas') as { createCanvas: (w: number, h: number) => unknown }
  const ctx = (c.createCanvas(1, 1) as { getContext: (t: string) => unknown }).getContext('2d')
  if (!ctx) throw new Error('createCanvas(...).getContext("2d") 가 null 을 반환했습니다')
} catch (err) {
  throw new Error(
    `[canvas-core preflight] node-canvas 를 사용할 수 없습니다: ${
      err instanceof Error ? err.message : String(err)
    }\n${REMEDY}`
  )
}

export {}
