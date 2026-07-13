/**
 * T3 적대검증 후속(2026-07-13) — ContentPdfAttachModal 도련 자동변환(fix-bleed) 로직 잠금.
 *
 * 모달 컴포넌트에서 추출한 순수 헬퍼를 검증한다(컴포넌트 렌더 없이):
 *  - P1-3: shouldRunBleedFix — completed 한정 게이트(fixable/failed 미발화)
 *  - P1-2: pollBleedFixJob — COMPLETED+outputFileId=null 레이스 grace 재폴링
 *  - P1-1: pollBleedFixJob — isCancelled 신호 시 즉시 cancelled(추가 조회 중단)
 *  - P2-5: computeBleedFixPollLimit — 파일 크기 비례 폴링 상한(총 상한 200회≈5분)
 */
import { describe, it, expect } from 'vitest'
import {
  computeBleedFixPollLimit,
  computeBleedFixTargetSize,
  shouldRunBleedFix,
  pollBleedFixJob,
  type ValidationResult,
} from './ContentPdfAttachModal'

const MB = 1024 * 1024

describe('computeBleedFixPollLimit (P2-5: 파일 크기 비례 폴링 상한)', () => {
  it('0 byte → 기본 40회(≈60s)', () => {
    expect(computeBleedFixPollLimit(0)).toBe(40)
  })

  it('100MB 이하 → +20회 (100MB 당 20회 = ≈30s)', () => {
    expect(computeBleedFixPollLimit(1 * MB)).toBe(60)
    expect(computeBleedFixPollLimit(100 * MB)).toBe(60)
  })

  it('150MB → ceil(1.5)=2 구간 → 80회', () => {
    expect(computeBleedFixPollLimit(150 * MB)).toBe(80)
  })

  it('800MB 이상은 추가분 160회 상한 → 총 200회(≈5분) 캡', () => {
    expect(computeBleedFixPollLimit(800 * MB)).toBe(200)
    expect(computeBleedFixPollLimit(2 * 1024 * MB)).toBe(200) // 2GB 상한 파일
  })

  it('음수 방어 → 기본 40회', () => {
    expect(computeBleedFixPollLimit(-1)).toBe(40)
  })
})

describe('computeBleedFixTargetSize (배너/마커 목표 작업 사이즈)', () => {
  it('판형 297×210 + bleed 3 → 303×216', () => {
    expect(computeBleedFixTargetSize({ width: 297, height: 210 }, 3)).toEqual({
      width: 303,
      height: 216,
    })
  })

  it('미제공 시 A4/3mm 폴백 (validate 의 size 폴백과 동일 기준)', () => {
    expect(computeBleedFixTargetSize(undefined, undefined)).toEqual({ width: 216, height: 303 })
  })
})

describe('shouldRunBleedFix (P1-3: completed 한정 게이트)', () => {
  const warn = { code: 'BLEED_MISSING', message: '도련 없음' }

  it('completed + BLEED_MISSING 경고 → true (불변식: 재단 사이즈 매치+도련 없음)', () => {
    const r: ValidationResult = { status: 'completed', warnings: [warn] }
    expect(shouldRunBleedFix(r)).toBe(true)
  })

  it('fixable(SIZE_MISMATCH 동반) + BLEED_MISSING → false — 완전 오사이즈 유입 차단', () => {
    const r: ValidationResult = {
      status: 'fixable',
      issues: [{ code: 'SIZE_MISMATCH', message: '크기 불일치', autoFixable: true }],
      warnings: [warn],
    }
    expect(shouldRunBleedFix(r)).toBe(false)
  })

  it('failed + BLEED_MISSING → false', () => {
    const r: ValidationResult = { status: 'failed', warnings: [warn] }
    expect(shouldRunBleedFix(r)).toBe(false)
  })

  it('completed + 경고 없음/무관 경고 → false', () => {
    expect(shouldRunBleedFix({ status: 'completed' })).toBe(false)
    expect(
      shouldRunBleedFix({
        status: 'completed',
        warnings: [{ code: 'LOW_RESOLUTION', message: '저해상도' }],
      }),
    ).toBe(false)
  })
})

describe('pollBleedFixJob (P1-1 취소 / P1-2 grace 재폴링)', () => {
  const seq = (responses: Array<{ status: string; outputFileId?: string | null }>) => {
    let calls = 0
    const getJob = async () => {
      const r = responses[Math.min(calls, responses.length - 1)]
      calls++
      return r
    }
    return { getJob, callCount: () => calls }
  }

  it('COMPLETED + outputFileId 즉시 존재 → completed', async () => {
    const { getJob } = seq([
      { status: 'PROCESSING' },
      { status: 'COMPLETED', outputFileId: 'file-fixed' },
    ])
    const outcome = await pollBleedFixJob(getJob, { maxAttempts: 10, intervalMs: 0 })
    expect(outcome).toEqual({ kind: 'completed', outputFileId: 'file-fixed' })
  })

  it('P1-2: COMPLETED+null 레이스 → grace 재폴링으로 outputFileId 회수(즉시 실패 판정 금지)', async () => {
    // API 가 status=COMPLETED 저장 → 별도 save 로 outputFileId 등록하는 2단계 쓰기 재현
    const { getJob, callCount } = seq([
      { status: 'COMPLETED', outputFileId: null },
      { status: 'COMPLETED', outputFileId: null },
      { status: 'COMPLETED', outputFileId: 'file-fixed' },
    ])
    const outcome = await pollBleedFixJob(getJob, { maxAttempts: 10, intervalMs: 0 })
    expect(outcome).toEqual({ kind: 'completed', outputFileId: 'file-fixed' })
    expect(callCount()).toBe(3) // 본폴링 1 + grace 2
  })

  it('P1-2: grace 소진(5회)까지 null → completed-no-output (등록 실패 판정)', async () => {
    const { getJob, callCount } = seq([{ status: 'COMPLETED', outputFileId: null }])
    const outcome = await pollBleedFixJob(getJob, { maxAttempts: 10, intervalMs: 0 })
    expect(outcome).toEqual({ kind: 'completed-no-output' })
    expect(callCount()).toBe(6) // 본폴링 1 + grace 5(기본값)
  })

  it('FAILED → failed', async () => {
    const { getJob } = seq([{ status: 'PROCESSING' }, { status: 'FAILED' }])
    const outcome = await pollBleedFixJob(getJob, { maxAttempts: 10, intervalMs: 0 })
    expect(outcome).toEqual({ kind: 'failed' })
  })

  it('maxAttempts 내 비종결 → timeout', async () => {
    const { getJob, callCount } = seq([{ status: 'PROCESSING' }])
    const outcome = await pollBleedFixJob(getJob, { maxAttempts: 3, intervalMs: 0 })
    expect(outcome).toEqual({ kind: 'timeout' })
    expect(callCount()).toBe(3)
  })

  it('P1-1: 폴링 중 취소 → cancelled + 이후 조회 중단', async () => {
    const { getJob, callCount } = seq([{ status: 'PROCESSING' }])
    let polled = 0
    const outcome = await pollBleedFixJob(
      async () => {
        polled++
        return getJob()
      },
      { maxAttempts: 100, intervalMs: 0, isCancelled: () => polled >= 2 },
    )
    expect(outcome).toEqual({ kind: 'cancelled' })
    expect(callCount()).toBe(2) // 취소 시점 이후 추가 GET 없음
  })

  it('P1-1: grace 재폴링 중 취소 → cancelled', async () => {
    let polled = 0
    const outcome = await pollBleedFixJob(
      async () => {
        polled++
        return { status: 'COMPLETED', outputFileId: null }
      },
      { maxAttempts: 10, intervalMs: 0, isCancelled: () => polled >= 2 },
    )
    expect(outcome).toEqual({ kind: 'cancelled' })
    expect(polled).toBe(2)
  })
})
