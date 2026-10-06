// 유닛테스트 전용 vitest 설정 — vite.config.ts(react 플러그인/프록시)를 로드하지 않고,
// tests/ (playwright e2e)와 충돌하지 않도록 src 내 *.test.ts·*.test.tsx 만 수집한다.
// 기본 환경은 node. 컴포넌트 테스트(*.test.tsx)는 파일 첫 줄 `// @vitest-environment happy-dom`
// 과 첫 import `src/test/renderWithAntd`(cleanup·ConfigProvider motion off·QueryClient)를 쓴다.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    testTimeout: 15000,
  },
});
