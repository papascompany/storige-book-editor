/**
 * 경량 성능 트레이스 — 프로덕션 번들에서도 살아남는 진단 수단.
 *
 * 배경(2026-08-06~07): 모양컷 '효과' 경로에서 브라우저가 멈추는 문제를 네 번 고쳤는데
 * 매번 "다음 병목"이 뒤에 있었다. `console.*` 는 프로덕션 빌드에서 제거되고(vite esbuild.pure)
 * 프리즈 중에는 개발자도구도 응답하지 않아, **끝난 뒤 읽을 수 있는 기록**이 필요했다.
 *
 * 사용: 프리즈가 풀린 뒤 콘솔에서 `window.__storigeTrace` 를 확인한다.
 * (오버헤드는 배열 push 뿐이고 상한이 있어 상시 켜 둬도 무해하다)
 */

const MAX_ENTRIES = 300

export interface TraceEntry {
  label: string
  ms: number
  [key: string]: string | number
}

/** 한 단계의 소요와 부가 수치를 기록한다. `start` 는 performance.now() 시각. */
export function traceStep(
  label: string,
  start: number,
  extra?: Record<string, number | string>
): void {
  try {
    const w = globalThis as unknown as { __storigeTrace?: TraceEntry[] }
    if (!w.__storigeTrace) w.__storigeTrace = []
    if (w.__storigeTrace.length >= MAX_ENTRIES) return
    w.__storigeTrace.push({
      label,
      ms: Math.round(performance.now() - start),
      ...(extra ?? {})
    })
  } catch {
    // 트레이스는 절대 기능을 깨뜨리지 않는다
  }
}

/** 새 측정을 시작하기 전에 이전 기록을 비운다(한 번의 '효과' 실행 단위). */
export function resetTrace(): void {
  try {
    ;(globalThis as unknown as { __storigeTrace?: TraceEntry[] }).__storigeTrace = []
  } catch {
    /* noop */
  }
}

/**
 * 메인 스레드에 숨 쉴 틈을 준다 — 무거운 단계 사이에서 호출하면
 * 브라우저가 렌더·입력을 처리할 수 있어 '응답 없음' 모달을 피한다.
 */
export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
