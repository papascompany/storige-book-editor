import { describe, it, expect } from 'vitest'
import { resolveAssetUrl } from './resolveAssetUrl'

// VITE_API_BASE_URL 미설정 시 기본값 'http://localhost:4000/api' 가 사용된다.
const BASE = 'http://localhost:4000/api'

describe('resolveAssetUrl', () => {
  it('falsy 값은 null 을 반환한다', () => {
    expect(resolveAssetUrl(null)).toBeNull()
    expect(resolveAssetUrl(undefined)).toBeNull()
    expect(resolveAssetUrl('')).toBeNull()
  })

  it('http/https 절대 URL 은 그대로 통과시킨다', () => {
    const https = 'https://cdn.example.com/a.png'
    const http = 'http://cdn.example.com/a.png'
    expect(resolveAssetUrl(https)).toBe(https)
    expect(resolveAssetUrl(http)).toBe(http)
  })

  it('protocol-relative URL(//host/..) 은 그대로 통과시킨다', () => {
    const url = '//cdn.example.com/a.png'
    expect(resolveAssetUrl(url)).toBe(url)
  })

  it('data: URL 은 그대로 통과시킨다', () => {
    const data = 'data:image/png;base64,AAAA'
    expect(resolveAssetUrl(data)).toBe(data)
  })

  it('blob: URL 은 그대로 통과시킨다', () => {
    const blob = 'blob:http://localhost:3000/9a-uuid'
    expect(resolveAssetUrl(blob)).toBe(blob)
  })

  it('루트 시작 상대 경로는 API_BASE_URL 을 prefix 한다', () => {
    expect(resolveAssetUrl('/storage/files/clipart/a.svg')).toBe(
      `${BASE}/storage/files/clipart/a.svg`
    )
  })

  it('슬래시 없이 시작하는 상대 경로에도 구분자를 넣어 prefix 한다', () => {
    expect(resolveAssetUrl('storage/files/bg/b.png')).toBe(
      `${BASE}/storage/files/bg/b.png`
    )
  })
})
