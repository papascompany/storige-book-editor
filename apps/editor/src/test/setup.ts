import '@testing-library/jest-dom';
import { vi } from 'vitest';

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
