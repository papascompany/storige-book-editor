import { describe, it, expect, beforeEach } from 'vitest'
import type { ProductProfile } from '@storige/types'
import { usePhotoPrintStore } from './usePhotoPrintStore'

/**
 * P2-d 사진인화 (2026-10-19): 항목 스토어 — 프로파일 기본값·캔버스 수 동기화·옵션 클램프·복원.
 */
function digitalProfile(over: Partial<NonNullable<ProductProfile['photoPrint']>> = {}): ProductProfile {
  return {
    version: 1,
    kind: 'photo-print',
    editorType: 'photo_digital_free',
    pages: { kind: 'range', min: 2, max: 40, step: 2, labelRule: 'photo' },
    sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'none', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
    photoPrint: {
      process: 'digital',
      composition: 'per-photo-free-back',
      sizes: [{ code: '4x6', widthMm: 102, heightMm: 152, minDpi: 200 }],
      options: { border: ['none', 'white'], fit: ['paper-full', 'image-full'], finish: ['matte', 'glossy'], brightnessFix: true, dateOverlay: true, grayscale: true, borderInsetMm: 2 },
      copies: { min: 1, max: 5 },
      upload: { maxPhotos: 10, maxMb: 25 },
      ...over,
    },
    output: { mode: 'sheet-map', sheetFiles: 'per-sheet' },
  }
}

function chemicalProfile(): ProductProfile {
  return {
    version: 1,
    kind: 'photo-print',
    editorType: 'photo_chem',
    pages: { kind: 'range', min: 1, max: 200, labelRule: 'photo' },
    sheet: { faces: 1, canvasLayout: 'canvas-per-sheet', binding: 'none', backRotation: 0, duplexFlip: 'short-edge' },
    photoPrint: {
      process: 'chemical',
      composition: 'per-photo-free-back',
      sizes: [{ code: '4x6', widthMm: 102, heightMm: 152, minDpi: 200 }],
      options: { border: ['white'], fit: ['paper-full'], finish: ['glossy'], brightnessFix: false, dateOverlay: false, grayscale: false },
      copies: { min: 2, max: 10 },
      upload: { maxPhotos: 200, maxMb: 25 },
    },
    output: { mode: 'single-pdf' },
  }
}

beforeEach(() => {
  usePhotoPrintStore.getState().reset()
})

describe('usePhotoPrintStore — setFromProfile / syncWithCanvasCount', () => {
  it('digital 6캔버스 → 항목 3건(canvasIndex 0/2/4), 기본값 = 허용 어휘 첫째·copies.min·플래그 false·sizeCode 고정', () => {
    usePhotoPrintStore.getState().setFromProfile(digitalProfile())
    const items = usePhotoPrintStore.getState().syncWithCanvasCount(6)
    expect(items).toHaveLength(3)
    expect(items.map((i) => i.canvasIndex)).toEqual([0, 2, 4])
    expect(items[0]).toEqual({
      index: 0,
      canvasIndex: 0,
      sizeCode: '4x6',
      copies: 1,
      border: 'none',
      fit: 'paper-full',
      finish: 'matte',
      brightnessFix: false,
      dateOverlay: false,
      grayscale: false,
      lowRes: false,
    })
    // 홀수 캔버스(뒷면만 남은 경우)도 ceil(N/2)
    expect(usePhotoPrintStore.getState().syncWithCanvasCount(5)).toHaveLength(3)
    // 감소 시 뒤에서 잘린다
    expect(usePhotoPrintStore.getState().syncWithCanvasCount(2)).toHaveLength(1)
    // 0 이하 → 변경 없음
    expect(usePhotoPrintStore.getState().syncWithCanvasCount(0)).toHaveLength(1)
  })

  it('chemical 5캔버스 → 항목 5건, copies 기본 = copies.min(2), 어휘 1개면 그 값', () => {
    usePhotoPrintStore.getState().setFromProfile(chemicalProfile())
    const items = usePhotoPrintStore.getState().syncWithCanvasCount(5)
    expect(items).toHaveLength(5)
    expect(items.map((i) => i.canvasIndex)).toEqual([0, 1, 2, 3, 4])
    expect(items[4]).toMatchObject({ index: 4, copies: 2, border: 'white', fit: 'paper-full', finish: 'glossy' })
  })

  it('동기화는 기존 항목 옵션을 보존하고 부족분만 기본값으로 채운다', () => {
    usePhotoPrintStore.getState().setFromProfile(digitalProfile())
    usePhotoPrintStore.getState().syncWithCanvasCount(2)
    usePhotoPrintStore.getState().setItemOption(0, { copies: 4, grayscale: true })
    const items = usePhotoPrintStore.getState().syncWithCanvasCount(6)
    expect(items[0]).toMatchObject({ copies: 4, grayscale: true })
    expect(items[1]).toMatchObject({ copies: 1, grayscale: false })
    expect(items[2]).toMatchObject({ index: 2, canvasIndex: 4 })
  })

  it('NULL·캘린더 프로파일 → profile null, 동기화·옵션 변경 모두 no-op([])', () => {
    usePhotoPrintStore.getState().setFromProfile(null)
    expect(usePhotoPrintStore.getState().profile).toBeNull()
    expect(usePhotoPrintStore.getState().syncWithCanvasCount(6)).toEqual([])
    usePhotoPrintStore.getState().setItemOption(0, { copies: 3 })
    expect(usePhotoPrintStore.getState().items).toEqual([])
    const calendar = { ...digitalProfile(), kind: 'calendar' as const, photoPrint: undefined }
    usePhotoPrintStore.getState().setFromProfile(calendar)
    expect(usePhotoPrintStore.getState().profile).toBeNull()
  })
})

describe('usePhotoPrintStore — 옵션 변경(프로파일 정책 클램프)', () => {
  beforeEach(() => {
    usePhotoPrintStore.getState().setFromProfile(digitalProfile())
    usePhotoPrintStore.getState().syncWithCanvasCount(4)
  })

  it('setItemOption: copies 는 [min,max] 클램프, 허용 어휘 밖은 첫 허용값, 범위 밖 index 는 무시', () => {
    usePhotoPrintStore.getState().setItemOption(1, { copies: 99, fit: 'image-full', border: 'white' })
    expect(usePhotoPrintStore.getState().items[1]).toMatchObject({ copies: 5, fit: 'image-full', border: 'white' })
    usePhotoPrintStore.getState().setCopies(1, 0)
    expect(usePhotoPrintStore.getState().items[1].copies).toBe(1)
    usePhotoPrintStore.getState().setItemOption(1, { finish: 'satin' as unknown as 'matte' })
    expect(usePhotoPrintStore.getState().items[1].finish).toBe('matte')
    const before = usePhotoPrintStore.getState().items
    usePhotoPrintStore.getState().setItemOption(5, { copies: 3 })
    expect(usePhotoPrintStore.getState().items).toBe(before)
  })

  it('정책이 false 인 플래그는 true 로 바꿔도 false 고정', () => {
    usePhotoPrintStore.getState().setFromProfile(digitalProfile({ options: { border: ['none'], fit: ['paper-full'], finish: ['matte'], brightnessFix: false, dateOverlay: false, grayscale: false } }))
    usePhotoPrintStore.getState().syncWithCanvasCount(2)
    usePhotoPrintStore.getState().setItemOption(0, { grayscale: true, dateOverlay: true, brightnessFix: true })
    expect(usePhotoPrintStore.getState().items[0]).toMatchObject({ grayscale: false, dateOverlay: false, brightnessFix: false })
  })

  it('applyAll: 모든 항목에 같은 옵션, index/canvasIndex 는 유지', () => {
    usePhotoPrintStore.getState().applyAll({ border: 'white', grayscale: true, copies: 3 })
    const items = usePhotoPrintStore.getState().items
    expect(items).toHaveLength(2)
    for (const it of items) expect(it).toMatchObject({ border: 'white', grayscale: true, copies: 3 })
    expect(items.map((i) => [i.index, i.canvasIndex])).toEqual([[0, 0], [1, 2]])
  })
})

describe('usePhotoPrintStore — restore(세션 metadata.items)', () => {
  it('PhotoItemInput 부분형을 정제해 시드(copies 클램프·sourcePhotoId 보존·불량 원소 생략)', () => {
    usePhotoPrintStore.getState().setFromProfile(digitalProfile())
    const ok = usePhotoPrintStore.getState().restore([
      { copies: 9, border: 'white', sourcePhotoId: 'p-1' },
      'bad',
      { fit: 'image-full', grayscale: true, canvasIndex: 77 },
    ])
    expect(ok).toBe(true)
    const items = usePhotoPrintStore.getState().items
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ index: 0, canvasIndex: 0, copies: 5, border: 'white', sourcePhotoId: 'p-1' })
    expect(items[1]).toMatchObject({ index: 1, canvasIndex: 2, fit: 'image-full', grayscale: true })
    expect(items[1]).not.toHaveProperty('sourcePhotoId')
    // 복원 뒤 캔버스 수 동기화는 기존 항목을 보존
    expect(usePhotoPrintStore.getState().syncWithCanvasCount(6)[2]).toMatchObject({ index: 2, copies: 1 })
  })

  it('배열 아님·빈 배열·프로파일 없음 → false, 상태 불변', () => {
    usePhotoPrintStore.getState().setFromProfile(digitalProfile())
    usePhotoPrintStore.getState().syncWithCanvasCount(2)
    const before = usePhotoPrintStore.getState().items
    expect(usePhotoPrintStore.getState().restore({ items: [] })).toBe(false)
    expect(usePhotoPrintStore.getState().restore([])).toBe(false)
    expect(usePhotoPrintStore.getState().items).toBe(before)
    usePhotoPrintStore.getState().reset()
    expect(usePhotoPrintStore.getState().restore([{ copies: 1 }])).toBe(false)
    expect(usePhotoPrintStore.getState().items).toEqual([])
  })
})

describe('usePhotoPrintStore — removeItem(사진 단위 삭제) / setItemMeta (api-sheetmap-1·tests-1·contract-1·contract-2)', () => {
  beforeEach(() => {
    usePhotoPrintStore.getState().setFromProfile(digitalProfile())
    usePhotoPrintStore.getState().syncWithCanvasCount(6)
    usePhotoPrintStore.getState().setItemOption(0, { copies: 5, border: 'white' })
    usePhotoPrintStore.getState().setItemOption(1, { copies: 2, grayscale: true })
    usePhotoPrintStore.getState().setItemOption(2, { copies: 4, fit: 'image-full' })
  })

  it('removeItem(1): 사진 2(B) 항목만 빠지고 [A, C] 의 매수·옵션 보존 + index/canvasIndex 재부여(끝 잘림이면 [A, B] 였다)', () => {
    expect(usePhotoPrintStore.getState().removeItem(1)).toBe(true)
    const items = usePhotoPrintStore.getState().items
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ index: 0, canvasIndex: 0, copies: 5, border: 'white', grayscale: false })
    expect(items[1]).toMatchObject({ index: 1, canvasIndex: 2, copies: 4, fit: 'image-full', grayscale: false })
    expect(items.some((i) => i.copies === 2)).toBe(false)
    // 이어지는 캔버스 수 동기화(4장 = 2건)는 추가/부족분만 다루므로 그대로
    expect(usePhotoPrintStore.getState().syncWithCanvasCount(4)).toEqual(items)
  })

  it('removeItem(0) 뒤 첫 항목은 종전 두 번째 사진(B)의 옵션, removeItem 범위 밖·비정수·프로파일 없음 → false·상태 불변', () => {
    expect(usePhotoPrintStore.getState().removeItem(0)).toBe(true)
    expect(usePhotoPrintStore.getState().items[0]).toMatchObject({ index: 0, canvasIndex: 0, copies: 2, grayscale: true })
    const before = usePhotoPrintStore.getState().items
    expect(usePhotoPrintStore.getState().removeItem(2)).toBe(false)
    expect(usePhotoPrintStore.getState().removeItem(-1)).toBe(false)
    expect(usePhotoPrintStore.getState().removeItem(0.5)).toBe(false)
    expect(usePhotoPrintStore.getState().items).toBe(before)
    usePhotoPrintStore.getState().reset()
    expect(usePhotoPrintStore.getState().removeItem(0)).toBe(false)
  })

  it('setItemMeta: lowRes 반영·sourcePhotoId 문자열이면 기록(이후 lowRes 만 바꿔도 유지)·null 이면 키 제거(런처 echo 금지)·옵션 불변', () => {
    usePhotoPrintStore.getState().restore([{ sourcePhotoId: 'launcher-a', copies: 5, border: 'white' }, { copies: 2 }])
    expect(usePhotoPrintStore.getState().items[0].sourcePhotoId).toBe('launcher-a')
    usePhotoPrintStore.getState().setItemMeta(0, { lowRes: true, sourcePhotoId: 'file-1' })
    expect(usePhotoPrintStore.getState().items[0]).toMatchObject({ lowRes: true, sourcePhotoId: 'file-1', copies: 5, border: 'white' })
    usePhotoPrintStore.getState().setItemMeta(0, { lowRes: false })
    expect(usePhotoPrintStore.getState().items[0]).toMatchObject({ lowRes: false, sourcePhotoId: 'file-1' })
    usePhotoPrintStore.getState().setItemMeta(0, { sourcePhotoId: null })
    expect(usePhotoPrintStore.getState().items[0]).not.toHaveProperty('sourcePhotoId')
    expect(usePhotoPrintStore.getState().items[0].lowRes).toBe(false)
    expect(usePhotoPrintStore.getState().items[1]).toMatchObject({ copies: 2, lowRes: false })
    // 범위 밖은 무시
    const before = usePhotoPrintStore.getState().items
    usePhotoPrintStore.getState().setItemMeta(9, { lowRes: true })
    expect(usePhotoPrintStore.getState().items).toBe(before)
  })
})
