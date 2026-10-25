import { describe, it, expect, beforeEach } from 'vitest'
import { __resetSaveNowRegistryForTest, saveNowRegistry } from './saveNowRegistry'

beforeEach(() => __resetSaveNowRegistryForTest())

describe('saveNowRegistry', () => {
  it('미등록이면 undefined', () => {
    expect(saveNowRegistry.get()).toBeUndefined()
  })

  it('등록하면 get 이 그 함수를 돌려주고, 해제하면 undefined', async () => {
    const fn = async () => true
    const unregister = saveNowRegistry.register(fn)
    expect(saveNowRegistry.get()).toBe(fn)
    expect(await saveNowRegistry.get()?.()).toBe(true)
    unregister()
    expect(saveNowRegistry.get()).toBeUndefined()
  })

  it('늦게 온 이전 해제는 새 등록을 지우지 않는다(마지막 등록이 이김)', () => {
    const a = async () => true
    const b = async () => false
    const offA = saveNowRegistry.register(a)
    saveNowRegistry.register(b)
    offA()
    expect(saveNowRegistry.get()).toBe(b)
  })
})
