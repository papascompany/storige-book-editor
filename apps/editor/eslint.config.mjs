import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

export default [
  eslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        requestIdleCallback: 'readonly',
        Promise: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        FileList: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        // DOM Elements
        HTMLElement: 'readonly',
        HTMLCanvasElement: 'readonly',
        HTMLImageElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLSpanElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLSelectElement: 'readonly',
        HTMLFormElement: 'readonly',
        HTMLIFrameElement: 'readonly',
        Image: 'readonly',
        Element: 'readonly',
        Node: 'readonly',
        NodeList: 'readonly',
        // Canvas
        CanvasRenderingContext2D: 'readonly',
        ImageData: 'readonly',
        CanvasGradient: 'readonly',
        CanvasPattern: 'readonly',
        // Events
        Event: 'readonly',
        MouseEvent: 'readonly',
        KeyboardEvent: 'readonly',
        ClipboardEvent: 'readonly',
        DragEvent: 'readonly',
        WheelEvent: 'readonly',
        PointerEvent: 'readonly',
        TouchEvent: 'readonly',
        FocusEvent: 'readonly',
        MessageEvent: 'readonly',
        CustomEvent: 'readonly',
        // Observers
        ResizeObserver: 'readonly',
        MutationObserver: 'readonly',
        IntersectionObserver: 'readonly',
        // Storage
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        // React
        React: 'readonly',
        // Node.js globals (for config files)
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        NodeJS: 'readonly',
        // Other
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        XMLHttpRequest: 'readonly',
        Headers: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        BeforeUnloadEvent: 'readonly',
        FontFace: 'readonly',
        global: 'readonly',
        globalThis: 'readonly',
        fabric: 'readonly',
        DOMParser: 'readonly',
        XMLSerializer: 'readonly',
        // Vitest globals
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
        test: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react': reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-unused-vars': 'off',
      // TS 파일에서 core no-undef 는 끈다 — typescript-eslint 공식 권고.
      // 미정의 식별자는 tsc 가 이미 TS2304 로 잡고, 이 룰은 lib.dom 전역을 languageOptions.globals
      // 에 **손으로 열거**해야만 통과한다. 열거가 빠진 전역(performance·Storage 등)이 곧 오탐이 되고,
      // 그 오탐이 "베이스라인 4건"으로 굳어 lint 게이트를 무력화한 게 2026-08-18~24 상태였다.
      'no-undef': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'no-useless-escape': 'off',
    },
  },
  {
    ignores: [
      'dist/**',
      'dist-embed/**',
      'node_modules/**',
      '*.js',
      '*.cjs',
      '*.mjs',
      'vite.config.ts',
      'vite.embed.config.ts',
      'vitest.config.ts',
    ],
  },
];
