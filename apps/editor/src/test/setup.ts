import '@testing-library/jest-dom';
import { vi } from 'vitest';

// ── Node 26 localStorage 함정 방어 (2026-08-01) ─────────────────────────────
// Node 26 은 `localStorage` 를 globalThis 의 **own property**(`--localstorage-file` 미지정 시
// undefined 를 반환하는 getter)로 노출한다. vitest 의 환경 주입(populateGlobal)은 이미 존재하는
// 키를 건너뛰므로 happy-dom/jsdom 의 localStorage 가 주입되지 않고 undefined 가 남는다 →
// localStorage 쓰는 테스트 49건이 Node 26 로컬에서만 실패(CI Node 22 무관, 실적발 2026-08-01).
// ⚠️ vitest 환경에서는 window === globalThis 라 `window.localStorage` 재바인딩으로는 못 고친다
// (같은 undefined getter). 부재 시에만 **인메모리 Storage 폴리필**을 설치한다 — Node 22/24 나
// CI 처럼 환경 주입이 정상인 곳에서는 이 블록이 no-op 이다.
function makeMemoryStorage(): Storage {
  let store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(String(k), String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store = new Map();
    },
  } as Storage;
}
for (const key of ['localStorage', 'sessionStorage'] as const) {
  if (typeof globalThis[key] === 'undefined') {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: makeMemoryStorage(),
    });
  }
}

// Mock fabric.js for testing
vi.mock('fabric', () => ({
  fabric: {
    Canvas: vi.fn(() => ({
      add: vi.fn(),
      remove: vi.fn(),
      renderAll: vi.fn(),
      setActiveObject: vi.fn(),
      getActiveObject: vi.fn(),
      getObjects: vi.fn(() => []),
      dispose: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      toJSON: vi.fn(() => ({
        version: '5.3.0',
        objects: [],
      })),
      loadFromJSON: vi.fn((json, callback) => {
        if (callback) callback();
      }),
    })),
    Object: vi.fn(),
    Textbox: vi.fn(() => ({
      type: 'textbox',
      text: '',
      set: vi.fn(),
    })),
    Rect: vi.fn(() => ({
      type: 'rect',
      set: vi.fn(),
    })),
    Circle: vi.fn(() => ({
      type: 'circle',
      set: vi.fn(),
    })),
    Image: {
      fromURL: vi.fn((url, callback) => {
        if (callback) callback({ type: 'image' });
      }),
    },
    ActiveSelection: vi.fn(),
    util: {
      groupSVGElements: vi.fn(),
      loadImage: vi.fn(),
    },
  },
}));

// Mock ResizeObserver
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserver;

// Mock IntersectionObserver
class IntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.IntersectionObserver = IntersectionObserver as unknown as typeof globalThis.IntersectionObserver;

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
