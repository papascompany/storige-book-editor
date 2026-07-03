import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 이 설정 파일은 각 worktree 의 <root>/fixture-golden/ 에 복사되어 실행된다.
// __dirname 기준 상대 경로로 해당 worktree 의 canvas-core "소스"를 직접 임포트한다.
// ⚠️ 'vite' 패키지 임포트 금지 — worktree 루트 node_modules 에 vite 가 없어(에디터 devDep)
//    컴파일된 config 임시본이 ERR_MODULE_NOT_FOUND 로 죽는다. 플레인 객체 export 로 대체.
const here = path.dirname(fileURLToPath(import.meta.url))
const worktreeRoot = path.resolve(here, '..')
const ccSrc = path.resolve(worktreeRoot, 'packages/canvas-core/src')

export default {
  root: here,
  resolve: {
    alias: { '@cc': ccSrc },
  },
  server: {
    port: Number(process.env.GOLDEN_PORT || 3100),
    strictPort: true,
    fs: { allow: [worktreeRoot] },
  },
  optimizeDeps: {
    exclude: ['@techstark/opencv-js', 'onnxruntime-web', '@imgly/background-removal'],
  },
}
