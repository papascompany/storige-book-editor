/**
 * Debug 로깅 헬퍼 — production 환경에서 noisy 로그 silence
 *
 * 사용:
 *   import { dlog } from '../utils/debugLog'
 *   dlog('font', '폰트 로드 완료', fontName)
 *
 *  - 'font' 카테고리는 NODE_ENV=development 에서만 출력
 *  - import.meta.env.DEV (Vite) 또는 process.env.NODE_ENV 검사
 *  - localStorage.setItem('storige.debug.font', '1') 로 운영에서도 강제 활성화 가능
 */

type DebugCategory = 'font' | 'plugin' | 'service' | 'history' | 'general';

let cachedFlags: Record<string, boolean> | null = null;

function isDevEnv(): boolean {
  // Vite (브라우저)
  try {
    if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) {
      return true;
    }
  } catch {
    /* SSR / non-vite */
  }
  // Node (process)
  if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
    return true;
  }
  return false;
}

function getOverrideFlags(): Record<string, boolean> {
  if (cachedFlags) return cachedFlags;
  const flags: Record<string, boolean> = {};
  try {
    if (typeof localStorage !== 'undefined') {
      // localStorage 키: storige.debug.<category>=1
      for (const key of ['font', 'plugin', 'service', 'history', 'general']) {
        if (localStorage.getItem(`storige.debug.${key}`) === '1') {
          flags[key] = true;
        }
      }
    }
  } catch {
    /* localStorage 차단된 환경 */
  }
  cachedFlags = flags;
  return flags;
}

/**
 * Debug log — DEV 환경 또는 localStorage 플래그 활성 시에만 출력
 */
export function dlog(category: DebugCategory, ...args: any[]): void {
  if (isDevEnv() || getOverrideFlags()[category]) {
    // eslint-disable-next-line no-console
    console.log(`[${category}]`, ...args);
  }
}

/**
 * Debug warn — 동일하지만 console.warn 사용
 */
export function dwarn(category: DebugCategory, ...args: any[]): void {
  if (isDevEnv() || getOverrideFlags()[category]) {
    // eslint-disable-next-line no-console
    console.warn(`[${category}]`, ...args);
  }
}

/**
 * Always-error: 운영에서도 항상 출력 (에러 추적용)
 */
export function elog(...args: any[]): void {
  // eslint-disable-next-line no-console
  console.error(...args);
}
