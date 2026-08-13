import { describe, it, expect } from 'vitest'
import { resolveCoverFinishing, buildTemplateSetCoverConfig } from '@storige/types'

describe('resolveCoverFinishing', () => {
  it('coverEditable 기본(true/undefined)은 잠금 없음 + 후가공 빈 목록', () => {
    expect(resolveCoverFinishing(true, { gold: true })).toEqual({
      materialLocked: false,
      allowed: [],
    })
    expect(resolveCoverFinishing(undefined, { emboss: true })).toEqual({
      materialLocked: false,
      allowed: [],
    })
  })

  it('coverEditable=false + finishing 없으면 잠금만 (후가공 OFF)', () => {
    expect(resolveCoverFinishing(false, null)).toEqual({ materialLocked: true, allowed: [] })
    expect(resolveCoverFinishing(false, undefined)).toEqual({ materialLocked: true, allowed: [] })
    expect(resolveCoverFinishing(false, {})).toEqual({ materialLocked: true, allowed: [] })
  })

  it('켜진 후가공만 allowed 에 올린다 (컷팅 없음)', () => {
    expect(
      resolveCoverFinishing(false, { emboss: true, gold: false, silver: true }),
    ).toEqual({ materialLocked: true, allowed: ['emboss', 'silver'] })
  })
})

describe('buildTemplateSetCoverConfig', () => {
  const caseBind = { boardThicknessMm: 2, turnInMm: 15, wrapMarginMm: 8 }

  it('편집 가능 표지는 finishing 을 저장하지 않고 caseBind 만 유지', () => {
    expect(
      buildTemplateSetCoverConfig({
        coverEditable: true,
        caseBind,
        finishing: { gold: true },
      }),
    ).toEqual({ caseBind })
  })

  it('소재 잠금 + 후가공 ON 은 caseBind 와 finishing 을 병합', () => {
    expect(
      buildTemplateSetCoverConfig({
        coverEditable: false,
        caseBind,
        finishing: { emboss: true, gold: false, silver: true },
      }),
    ).toEqual({ caseBind, finishing: { emboss: true, silver: true } })
  })

  it('caseBind 없이 후가공만 있어도 coverConfig 를 만든다', () => {
    expect(
      buildTemplateSetCoverConfig({
        coverEditable: false,
        caseBind: null,
        finishing: { gold: true },
      }),
    ).toEqual({ finishing: { gold: true } })
  })

  it('둘 다 없으면 null (기존 셋 비파괴)', () => {
    expect(buildTemplateSetCoverConfig({ coverEditable: false })).toBeNull()
    expect(
      buildTemplateSetCoverConfig({
        coverEditable: false,
        finishing: { emboss: false, gold: false, silver: false },
      }),
    ).toBeNull()
  })
})
