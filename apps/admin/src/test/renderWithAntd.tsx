// 컴포넌트 테스트 공용 도우미 (2026-10-03) — happy-dom 전용.
// 쓰는 쪽 규약: 파일 첫 줄 `// @vitest-environment happy-dom`, 이 모듈을 **첫 import** 로 둔다
// (아래 Storage 폴리필이 import 시점에 localStorage 를 읽는 모듈보다 먼저 설치되도록).
import { afterEach, vi, type MockInstance } from 'vitest';
import { cleanup, render, within, type RenderResult } from '@testing-library/react';
import { ConfigProvider, Modal, message } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';

if (typeof document === 'undefined') {
  throw new Error('[admin test] DOM 환경이 아닙니다 — 첫 줄에 // @vitest-environment happy-dom');
}

// Node 26 은 localStorage 를 globalThis 의 own property(undefined getter)로 두어 환경 주입이 건너뛰어진다.
// 없을 때만 인메모리 Storage 를 설치한다(apps/editor/src/test/setup.ts 와 같은 처리, Node 24 에서는 no-op).
function makeMemoryStorage(): typeof localStorage {
  let store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(String(k), String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store = new Map();
    },
  };
}
for (const key of ['localStorage', 'sessionStorage'] as const) {
  if (typeof globalThis[key] === 'undefined') {
    Object.defineProperty(globalThis, key, { configurable: true, value: makeMemoryStorage() });
  }
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// vitest globals 를 쓰지 않으므로 RTL 자동 cleanup 이 등록되지 않는다 — 직접 등록한다.
afterEach(() => {
  cleanup();
});

/** 재시도 없는 QueryClient — 실패 응답이 곧바로 오류 상태가 된다 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

/**
 * antd 컴포넌트 렌더 — ConfigProvider(motion off)로 감싸고, queryClient 가 있으면 QueryClientProvider 도 씌운다.
 * wrapper 옵션이라 rerender 에도 그대로 적용된다. Modal·Popconfirm 은 document.body 포털이므로
 * container 가 아니라 document.body(또는 openDialog·openPopover 범위)에서 조회한다.
 */
export function renderWithAntd(
  ui: ReactElement,
  options: { queryClient?: QueryClient } = {},
): RenderResult {
  const { queryClient } = options;
  const Wrapper = ({ children }: { children: ReactNode }): ReactElement => {
    const themed = <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>;
    return queryClient ? (
      <QueryClientProvider client={queryClient}>{themed}</QueryClientProvider>
    ) : (
      themed
    );
  };
  return render(ui, { wrapper: Wrapper });
}

/**
 * scope 안에서 정확히 text 인 글자를 가진 버튼. antd 아이콘의 aria-label 이 버튼 접근 이름에 섞이므로
 * role 이름 대신 글자로 찾는다. 없거나 버튼 안이 아니면 throw.
 */
export function buttonByText(scope: HTMLElement, text: string): HTMLButtonElement {
  const button = within(scope).getByText(text).closest('button');
  if (!button) throw new Error(`[admin test] '${text}' 버튼이 없습니다`);
  return button;
}

function isShown(el: HTMLElement | null): boolean {
  for (let cur = el; cur; cur = cur.parentElement) {
    if (cur.style.display === 'none') return false;
  }
  return true;
}

/** 열린 antd Modal 의 dialog 요소(닫힌 Modal 의 DOM 은 남으므로 표시 중인 것만). 없으면 null */
export function openDialog(): HTMLElement | null {
  const dialogs = Array.from(document.body.querySelectorAll<HTMLElement>('.ant-modal[role="dialog"], .ant-modal [role="dialog"]'));
  return dialogs.find((d) => isShown(d)) ?? null;
}

/** 표시 중인 antd Popover·Popconfirm 요소. 없으면 null */
export function openPopover(): HTMLElement | null {
  const popovers = Array.from(document.body.querySelectorAll<HTMLElement>('.ant-popover'));
  return popovers.find((p) => !p.classList.contains('ant-popover-hidden') && isShown(p)) ?? null;
}

type MessageResult = ReturnType<typeof message.success>;

function closedMessage(): MessageResult {
  const settled = Promise.resolve(true);
  return Object.assign(() => undefined, { then: settled.then.bind(settled) });
}

export interface AntdFeedbackSpies {
  success: MockInstance<typeof message.success>;
  warning: MockInstance<typeof message.warning>;
  error: MockInstance<typeof message.error>;
  info: MockInstance<typeof message.info>;
  modalInfo: MockInstance<typeof Modal.info>;
}

/**
 * antd 정적 메서드(message.*·Modal.info)를 spy 로 대체한다 — ConfigProvider 밖에서 자체 motion·타이머로
 * 렌더되므로 실제 렌더 없이 호출만 기록한다. beforeEach 에서 매번 호출하고 afterEach 의 vi.restoreAllMocks 로 되돌린다.
 */
export function stubAntdFeedback(): AntdFeedbackSpies {
  return {
    success: vi.spyOn(message, 'success').mockImplementation(closedMessage),
    warning: vi.spyOn(message, 'warning').mockImplementation(closedMessage),
    error: vi.spyOn(message, 'error').mockImplementation(closedMessage),
    info: vi.spyOn(message, 'info').mockImplementation(closedMessage),
    modalInfo: vi.spyOn(Modal, 'info').mockImplementation(() => ({ destroy: vi.fn(), update: vi.fn() })),
  };
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

/** 테스트가 끝나는 시점을 정하는 Promise — 진행 중 상태·경합 순서를 고정할 때 쓴다 */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
