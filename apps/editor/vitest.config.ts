import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Node 25+ 는 globalThis 에 내장 Web Storage(localStorage·sessionStorage)를 둔다. vitest 의
    // 환경 주입은 이미 있는 키를 건너뛰므로 테스트가 happy-dom 대신 Node 내장 Storage 를 쓰게 되고,
    // 그 객체에서는 vi.spyOn(sessionStorage, 'getItem') 이 메서드를 바꾸지 못하고 'getItem' 항목을
    // 저장한다(embed.guestReopen O2 가 Node 26 에서만 실패한 원인). 테스트 워커에서 내장 저장소를 꺼
    // Node 24(CI)와 같은 happy-dom 저장소를 쓰게 한다. 이 플래그는 Node 24 에서도 허용되는 no-op 이다.
    pool: 'forks',
    poolOptions: {
      forks: { execArgv: ['--no-experimental-webstorage'] },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@storige/types': resolve(__dirname, '../../packages/types/src/index.ts'),
      '@storige/canvas-core': resolve(__dirname, '../../packages/canvas-core/src/index.ts'),
    },
  },
});
