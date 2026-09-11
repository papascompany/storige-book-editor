const eslint = require('@eslint/js');
const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');

module.exports = [
  eslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        // lint 전용 프로그램(tsconfig.eslint.json) — 빌드 tsconfig 는 src 만 포함하므로
        // test/·scripts/ 를 린트 범위에 넣으려면 별도 프로젝트가 필요하다(빌드 무영향).
        // 2026-09-11: 이 3범위가 api 의 .ts 전량이다. `storage/` 는 픽스처 PDF·README 만
        // 남아 .ts 0개 — 여기 있던 generate-fixtures.ts 는 apps/worker/test/fixtures/pdf/
        // 동명 파일과 바이트 동일한 사본(참조처 0건, api 에 없는 pdf-lib import)이라 삭제했다.
        // 다시 추가하지 말 것: include 에 넣으면 아래 EXIT=0 불변식이 TS2307 로 깨진다.
        project: './tsconfig.eslint.json',
        sourceType: 'module',
      },
      globals: {
        process: 'readonly',
        Express: 'readonly',
        // NodeJS 네임스페이스 타입(NodeJS.ErrnoException 등) — 미등록 시 no-undef 오탐
        NodeJS: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Promise: 'readonly',
        // Jest globals
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-unused-vars': 'off',
      // TS 파일에서 core no-undef 는 끈다 — typescript-eslint 공식 권고.
      // 미정의 식별자는 tsc 가 이미 TS2304 로 잡는다(린트 대상 317개 == tsconfig
      // 프로그램 317개, `tsc --noEmit` EXIT=0). 반면 이 룰은 @types/node·@types/jest·
      // Express 의 앰비언트 전역을 languageOptions.globals 에 **손으로 열거**해야만 통과한다.
      // 여기서는 parserOptions.project 덕분에 lib.es2022.full(DOM 포함) 전역이 자동
      // 주입돼 오탐 범위가 좁아졌을 뿐, 열거 누락 = 오탐 구조는 그대로다
      // (NodeJS 한 줄만 빼도 즉시 오탐 발생). 끄기 전후 산출물 동일 = 36/0/36.
      'no-undef': 'off',
      'no-case-declarations': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', '**/*.js'],
  },
];
