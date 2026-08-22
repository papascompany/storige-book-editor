/**
 * 임베드 편집기 로드(재진입) 단계별 프로파일러 (P1-5, 2026-08-22).
 *
 * 배경: 펼침면 세트 재진입(내지 9캔버스 시드)이 30s+ 걸리는데 어느 단계가 먹는지 알 수 없었다.
 * 정적 검토로는 고정 대기(sleep)가 없어 실측이 필요 → 단계 진입마다 mark 하고 ready 시점에
 * **한 번만** 요약을 콘솔·Sentry(info)로 남긴다(finishMark 처럼 단계마다 flush 하지 않는다 —
 * flush 대기 자체가 로드 시간을 늘린다).
 *
 * 사용: const p = createLoadProfiler(); p.mark('session:loaded'); … p.summary()
 * 페이지 단위 반복(복원 loadFromJSON 등)은 p.lap('restore:page', i) 로 개별 기록.
 */

export interface LoadProfilePhase {
  phase: string
  /** 직전 mark 로부터의 경과(ms) */
  deltaMs: number
  /** 프로파일러 생성 시점부터의 누적(ms) */
  atMs: number
  extra?: Record<string, unknown>
}

export interface LoadProfileSummary {
  totalMs: number
  phases: LoadProfilePhase[]
  /** 반복 구간 집계: key → { count, totalMs, maxMs } */
  laps: Record<string, { count: number; totalMs: number; maxMs: number }>
  /** 가장 오래 걸린 단계(반복 집계 포함) */
  slowest: { phase: string; ms: number } | null
}

export interface LoadProfiler {
  mark(phase: string, extra?: Record<string, unknown>): void
  /** 반복 구간 1회 측정 시작 → 반환된 함수를 끝에서 호출 */
  lapStart(key: string): () => void
  summary(): LoadProfileSummary
}

const nowMs = (): number => {
  const perf = globalThis.performance
  return perf && typeof perf.now === 'function' ? perf.now() : Date.now()
}

export function createLoadProfiler(now: () => number = nowMs): LoadProfiler {
  const t0 = now()
  let last = t0
  const phases: LoadProfilePhase[] = []
  const laps: LoadProfileSummary['laps'] = {}

  return {
    mark(phase, extra) {
      const t = now()
      phases.push({
        phase,
        deltaMs: Math.round((t - last) * 10) / 10,
        atMs: Math.round((t - t0) * 10) / 10,
        ...(extra ? { extra } : {}),
      })
      last = t
    },
    lapStart(key) {
      const s = now()
      return () => {
        const d = now() - s
        const agg = laps[key] ?? { count: 0, totalMs: 0, maxMs: 0 }
        agg.count += 1
        agg.totalMs = Math.round((agg.totalMs + d) * 10) / 10
        agg.maxMs = Math.max(agg.maxMs, Math.round(d * 10) / 10)
        laps[key] = agg
      }
    },
    summary() {
      const totalMs = Math.round((now() - t0) * 10) / 10
      let slowest: LoadProfileSummary['slowest'] = null
      for (const p of phases) {
        if (!slowest || p.deltaMs > slowest.ms) slowest = { phase: p.phase, ms: p.deltaMs }
      }
      for (const [k, v] of Object.entries(laps)) {
        if (!slowest || v.totalMs > slowest.ms) slowest = { phase: `${k}×${v.count}`, ms: v.totalMs }
      }
      return { totalMs, phases: [...phases], laps: { ...laps }, slowest }
    },
  }
}

/** 콘솔 한 줄 요약 — "[load-profile] total=31240ms slowest=restore:page×9 27800ms | session:loaded 420 > …" */
export function formatLoadProfile(s: LoadProfileSummary): string {
  const parts = s.phases.map((p) => `${p.phase} ${p.deltaMs}`)
  const lapParts = Object.entries(s.laps).map(
    ([k, v]) => `${k}×${v.count} total=${v.totalMs} max=${v.maxMs}`,
  )
  const slow = s.slowest ? ` slowest=${s.slowest.phase} ${s.slowest.ms}ms` : ''
  return `total=${s.totalMs}ms${slow} | ${[...parts, ...lapParts].join(' > ')}`
}
