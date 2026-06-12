// core.ensureImageCrossOrigin — 교차출처 캔버스 taint 방어 새니타이저 회귀 고정.
//
// 배경(2026-06-12 라이브 관측): 변환기 출력/기존 등록 템플릿 canvasData 의 image 객체에
// crossOrigin 이 없으면 fabric 5.5 Image.fromObject → loadImage 가 <img> 를 비-CORS 모드로
// 로드한다. editor.papascompany.co.kr 캔버스가 api.papascompany.co.kr 스토리지 PNG 를
// 그리면 캔버스가 taint → 썸네일 자동저장/미리보기 toDataURL·getImageData SecurityError.
// (서버 nginx 는 ACAO:* + CORP cross-origin 정상 — 클라이언트 로드 모드 문제)
//
// 이 테스트는 다음 계약을 고정한다:
//  1) http(s)/protocol-relative 교차출처 src + crossOrigin 미지정(undefined/null) → 'anonymous' 주입
//  2) dataURL/blob/상대경로/동일출처 절대 URL → 불변 (회귀 금지)
//  3) 기존 crossOrigin 값('', 'anonymous', 'use-credentials') → 보존
//  4) group/clipPath/backgroundImage/overlayImage 중첩 재귀
//  5) 비파괴(원본 불변) + 변경 없으면 동일 참조 반환
import { describe, it, expect, afterEach } from 'vitest'
import { core } from './canvas'

const HTTP_SRC = 'https://api.papascompany.co.kr/storage/templates/artwork.png'
const DATA_SRC = 'data:image/png;base64,iVBORw0KGgo='

const img = (overrides: Record<string, unknown> = {}) => ({
  type: 'image',
  src: HTTP_SRC,
  left: 0,
  top: 0,
  ...overrides
})

const canvasData = (objects: unknown[], extra: Record<string, unknown> = {}) => ({
  version: '5.5.2',
  objects,
  ...extra
})

afterEach(() => {
  delete (globalThis as any).window
})

describe('crossOrigin 주입 (교차출처 http src)', () => {
  it('http(s) src + crossOrigin 미지정 image 객체에 anonymous 를 주입한다', () => {
    const input = canvasData([img()])
    const out: any = core.ensureImageCrossOrigin(input)
    expect(out.objects[0].crossOrigin).toBe('anonymous')
  })

  it('crossOrigin:null(fabric 비-CORS 직렬화 산물)도 미지정으로 간주해 주입한다', () => {
    // fabric Image.toObject 는 비-CORS 로드 이미지를 crossOrigin:null 로 직렬화한다 —
    // 기존 등록 템플릿/세션 canvasData 구제의 핵심 케이스.
    const input = canvasData([img({ crossOrigin: null })])
    const out: any = core.ensureImageCrossOrigin(input)
    expect(out.objects[0].crossOrigin).toBe('anonymous')
  })

  it('protocol-relative(//) src 에도 주입한다', () => {
    const input = canvasData([img({ src: '//api.papascompany.co.kr/storage/a.png' })])
    const out: any = core.ensureImageCrossOrigin(input)
    expect(out.objects[0].crossOrigin).toBe('anonymous')
  })

  it('배열 입력(enlivenObjects 경로)도 처리한다', () => {
    const input = [img(), { type: 'textbox', text: 'x', styles: {} }]
    const out: any = core.ensureImageCrossOrigin(input)
    expect(out[0].crossOrigin).toBe('anonymous')
    expect(out[1]).toBe(input[1]) // 비이미지 객체는 동일 참조
  })
})

describe('불변 케이스 (회귀 금지)', () => {
  it('dataURL src 는 불변 — 동일 참조 반환', () => {
    const input = canvasData([img({ src: DATA_SRC })])
    expect(core.ensureImageCrossOrigin(input)).toBe(input)
  })

  it('상대경로 src(/storage/... dev vite proxy)는 불변', () => {
    const input = canvasData([img({ src: '/storage/templates/a.png' })])
    expect(core.ensureImageCrossOrigin(input)).toBe(input)
  })

  it('blob: src 는 불변', () => {
    const input = canvasData([img({ src: 'blob:https://editor.papascompany.co.kr/uuid' })])
    expect(core.ensureImageCrossOrigin(input)).toBe(input)
  })

  it('동일출처 절대 URL 은 불변 (브라우저 환경)', () => {
    ;(globalThis as any).window = {
      location: { origin: 'https://editor.papascompany.co.kr' }
    }
    const input = canvasData([
      img({ src: 'https://editor.papascompany.co.kr/assets/logo.png' })
    ])
    expect(core.ensureImageCrossOrigin(input)).toBe(input)
  })

  it('동일출처 판정은 prefix 사칭 도메인에 속지 않는다', () => {
    ;(globalThis as any).window = {
      location: { origin: 'https://editor.papascompany.co.kr' }
    }
    const input = canvasData([
      img({ src: 'https://editor.papascompany.co.kr.evil.com/a.png' })
    ])
    const out: any = core.ensureImageCrossOrigin(input)
    expect(out.objects[0].crossOrigin).toBe('anonymous')
  })

  it('기존 crossOrigin 값은 보존한다 (use-credentials/빈문자열/anonymous)', () => {
    const input = canvasData([
      img({ crossOrigin: 'use-credentials' }),
      img({ crossOrigin: '' }),
      img({ crossOrigin: 'anonymous' })
    ])
    const out: any = core.ensureImageCrossOrigin(input)
    expect(out).toBe(input) // 변경 없음 → 동일 참조
    expect(out.objects[0].crossOrigin).toBe('use-credentials')
    expect(out.objects[1].crossOrigin).toBe('')
    expect(out.objects[2].crossOrigin).toBe('anonymous')
  })

  it('비이미지 객체(textbox/rect/group 빈)는 불변', () => {
    const input = canvasData([
      { type: 'textbox', text: 'a', styles: {} },
      { type: 'rect', fill: '#fff' }
    ])
    expect(core.ensureImageCrossOrigin(input)).toBe(input)
  })

  it('src 가 문자열이 아니면 불변', () => {
    const input = canvasData([img({ src: undefined }), img({ src: 123 })])
    expect(core.ensureImageCrossOrigin(input)).toBe(input)
  })
})

describe('중첩 재귀', () => {
  it('group 내부 image 객체에 주입한다', () => {
    const input = canvasData([
      { type: 'group', objects: [img(), { type: 'rect' }] }
    ])
    const out: any = core.ensureImageCrossOrigin(input)
    expect(out.objects[0].objects[0].crossOrigin).toBe('anonymous')
    expect(out.objects[0].objects[1]).toEqual({ type: 'rect' })
  })

  it('clipPath/backgroundImage/overlayImage 의 image 객체에 주입한다', () => {
    const input = canvasData([img({ src: DATA_SRC })], {
      clipPath: img({ src: HTTP_SRC }),
      backgroundImage: img({ src: HTTP_SRC }),
      overlayImage: img({ src: HTTP_SRC })
    })
    const out: any = core.ensureImageCrossOrigin(input)
    expect(out.clipPath.crossOrigin).toBe('anonymous')
    expect(out.backgroundImage.crossOrigin).toBe('anonymous')
    expect(out.overlayImage.crossOrigin).toBe('anonymous')
    expect(out.objects).toBe((input as any).objects) // dataURL 만 있는 objects 는 동일 참조
  })

  it('객체에 달린 clipPath image 에도 주입한다', () => {
    const input = canvasData([
      { type: 'rect', clipPath: img() }
    ])
    const out: any = core.ensureImageCrossOrigin(input)
    expect(out.objects[0].clipPath.crossOrigin).toBe('anonymous')
  })
})

describe('비파괴성', () => {
  it('원본 입력 객체를 변형하지 않는다', () => {
    const original = img()
    const input = canvasData([original])
    const out: any = core.ensureImageCrossOrigin(input)
    expect((original as any).crossOrigin).toBeUndefined()
    expect(out.objects[0]).not.toBe(original)
    expect(out).not.toBe(input)
    // 주입 외 키는 모두 보존
    expect(out.objects[0].src).toBe(HTTP_SRC)
    expect(out.objects[0].left).toBe(0)
    expect(out.version).toBe('5.5.2')
  })
})
