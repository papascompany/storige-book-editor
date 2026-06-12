// 유닛테스트 전용 vitest 설정 — vite.config.ts(react 플러그인/프록시)를 로드하지 않고,
// tests/ (playwright e2e)와 충돌하지 않도록 src 내 *.test.ts 만 수집한다.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
