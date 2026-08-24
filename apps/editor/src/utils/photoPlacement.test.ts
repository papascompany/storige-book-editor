import { describe, it, expect } from 'vitest'
import {
  measureFrame,
  imageAspect,
  computeEffectiveDpi,
  matchPhotosToFrames,
  canvasDpi,
  isFrameFilled,
  collectEmptyFrames,
  hasEmptyFrame,
  adaptUploadedPhotoMeta,
  mergeAutofillPhotoInputs,
  autofillPhotosIntoFrames,
  type UploadedPhotoMeta,
} from './photoPlacement'
import type { ExternalPhoto, PhotoSortMode } from '@storige/types'

// ────────────────────────────────────────────────────────────────────────────
// measureFrame / imageAspect / canvasDpi
// ────────────────────────────────────────────────────────────────────────────

describe('measureFrame', () => {
  it('scale 을 반영한 화면 크기와 가로세로비', () => {
    const m = measureFrame({ width: 100, height: 50, scaleX: 2, scaleY: 2 })
    expect(m.widthPx).toBe(200)
    expect(m.heightPx).toBe(100)
    expect(m.aspect).toBeCloseTo(2)
  })

  it('scale 미지정 → 1 로 간주', () => {
    const m = measureFrame({ width: 300, height: 300 })
    expect(m.widthPx).toBe(300)
    expect(m.aspect).toBeCloseTo(1)
  })

  it('0 크기 → aspect 1 폴백(0 나눗셈 방지)', () => {
    const m = measureFrame({ width: 0, height: 0 })
    expect(m.aspect).toBe(1)
  })
})

describe('imageAspect', () => {
  it('가로 이미지', () => {
    expect(imageAspect({ width: 4000, height: 3000 })).toBeCloseTo(4 / 3)
  })
  it('치수 없음 → 1 폴백', () => {
    expect(imageAspect({})).toBe(1)
  })
})

describe('canvasDpi', () => {
  it("unit==='mm' → unitOptions.dpi", () => {
    expect(canvasDpi({ unitOptions: { unit: 'mm', dpi: 300 } })).toBe(300)
  })
  it("unit==='mm' dpi 미지정 → 150 기본", () => {
    expect(canvasDpi({ unitOptions: { unit: 'mm' } })).toBe(150)
  })
  it('mm 아님 → 72(px=pt)', () => {
    expect(canvasDpi({ unitOptions: { unit: 'px' } })).toBe(72)
    expect(canvasDpi({})).toBe(72)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// computeEffectiveDpi
// ────────────────────────────────────────────────────────────────────────────

describe('computeEffectiveDpi', () => {
  it('동일 비율: imgPx*dpi/framePx', () => {
    // 프레임 300px @150dpi = 2인치. 사진 600px → 600/2 = 300dpi
    const frame = measureFrame({ width: 300, height: 300 })
    const dpi = computeEffectiveDpi({ width: 600, height: 600 }, frame, 150)
    expect(dpi).toBeCloseTo(300)
  })

  it('cover 채움: 가장 늘어나는 축(작은 dpi) 채택', () => {
    // 프레임 정사각 300px @150dpi, 사진 600x300(가로로 김) → 세로축이 더 늘어남
    const frame = measureFrame({ width: 300, height: 300 })
    const dpi = computeEffectiveDpi({ width: 600, height: 300 }, frame, 150)
    // dpiX=600*150/300=300, dpiY=300*150/300=150 → min=150
    expect(dpi).toBeCloseTo(150)
  })

  it('측정 불가(0 픽셀) → Infinity(경고 안 띄움)', () => {
    const frame = measureFrame({ width: 300, height: 300 })
    expect(computeEffectiveDpi({ width: 0, height: 0 }, frame, 150)).toBe(Infinity)
  })

  it('작은 사진 → 임계(150) 미만으로 경고 대상', () => {
    // 프레임 600px @150dpi = 4인치. 사진 300px → 75dpi (< 150)
    const frame = measureFrame({ width: 600, height: 600 })
    const dpi = computeEffectiveDpi({ width: 300, height: 300 }, frame, 150)
    expect(dpi).toBeCloseTo(75)
    expect(dpi).toBeLessThan(150)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// matchPhotosToFrames (순수 매칭)
// ────────────────────────────────────────────────────────────────────────────

describe('matchPhotosToFrames', () => {
  it('aspectMatch=false: 순서대로 zip, 적은 쪽까지', () => {
    const photos = [{ aspect: 1, id: 'p0' }, { aspect: 2, id: 'p1' }, { aspect: 3, id: 'p2' }]
    const frames = [{ aspect: 9, id: 'f0' }, { aspect: 9, id: 'f1' }]
    const r = matchPhotosToFrames(photos, frames, false)
    expect(r.pairs.map((x) => [x.photo.id, x.frame.id])).toEqual([
      ['p0', 'f0'],
      ['p1', 'f1'],
    ])
    expect(r.leftoverPhotos.map((p) => p.id)).toEqual(['p2'])
    expect(r.leftoverFrames).toEqual([])
  })

  it('aspectMatch=true: 가로사진→가로프레임 최근접 배치', () => {
    // 사진: 정사각(1) → 가로(2.0). 프레임: 가로(2.0), 정사각(1.0)
    const photos = [{ aspect: 1.0, id: 'square' }, { aspect: 2.0, id: 'wide' }]
    const frames = [{ aspect: 2.0, id: 'F-wide' }, { aspect: 1.0, id: 'F-square' }]
    const r = matchPhotosToFrames(photos, frames, true)
    const map = Object.fromEntries(r.pairs.map((x) => [x.photo.id, x.frame.id]))
    expect(map.square).toBe('F-square')
    expect(map.wide).toBe('F-wide')
  })

  it('aspectMatch=true: 동률이면 페이지 순서(앞쪽 프레임) 우선', () => {
    const photos = [{ aspect: 1.0, id: 'p0' }]
    const frames = [{ aspect: 1.0, id: 'f0' }, { aspect: 1.0, id: 'f1' }]
    const r = matchPhotosToFrames(photos, frames, true)
    expect(r.pairs[0].frame.id).toBe('f0')
    expect(r.leftoverFrames.map((f) => f.id)).toEqual(['f1'])
  })

  it('프레임 부족: 남은 사진 leftover', () => {
    const photos = [{ aspect: 1, id: 'p0' }, { aspect: 1, id: 'p1' }]
    const frames = [{ aspect: 1, id: 'f0' }]
    const r = matchPhotosToFrames(photos, frames, true)
    expect(r.pairs).toHaveLength(1)
    expect(r.leftoverPhotos.map((p) => p.id)).toEqual(['p1'])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// isFrameFilled / collectEmptyFrames (캔버스 읽기)
// ────────────────────────────────────────────────────────────────────────────

function fakeCanvas(objects: any[], unitOptions?: any): any {
  return { getObjects: () => objects, unitOptions }
}

describe('isFrameFilled', () => {
  it('parentLayerId 매칭 fillImage 있으면 채워짐', () => {
    const frame = { id: 'fr1', extensionType: 'frame' }
    const filled = { extensionType: 'fillImage', parentLayerId: 'fr1' }
    expect(isFrameFilled(fakeCanvas([frame, filled]), frame)).toBe(true)
  })
  it('frameRef 매칭도 채워짐', () => {
    const frame = { id: 'fr1', extensionType: 'frame' }
    const filled = { extensionType: 'fillImage', frameRef: 'fr1' }
    expect(isFrameFilled(fakeCanvas([frame, filled]), frame)).toBe(true)
  })
  it('매칭 fillImage 없으면 빈 틀', () => {
    const frame = { id: 'fr1', extensionType: 'frame' }
    const other = { extensionType: 'fillImage', parentLayerId: 'other' }
    expect(isFrameFilled(fakeCanvas([frame, other]), frame)).toBe(false)
  })
})

describe('collectEmptyFrames', () => {
  it('여러 캔버스에서 페이지 순서대로 빈 프레임만 수집', () => {
    const c1Frame1 = { id: 'a', extensionType: 'frame', width: 100, height: 100 }
    const c1FrameFilled = { id: 'b', extensionType: 'frame', width: 100, height: 100 }
    const c1Fill = { extensionType: 'fillImage', parentLayerId: 'b' }
    const c1Other = { id: 'txt', extensionType: 'text' } // 프레임 아님
    const c2Frame = { id: 'c', extensionType: 'frame', width: 200, height: 100 }

    const c1 = fakeCanvas([c1Frame1, c1FrameFilled, c1Fill, c1Other], { unit: 'mm', dpi: 150 })
    const c2 = fakeCanvas([c2Frame], { unit: 'mm', dpi: 300 })

    const out = collectEmptyFrames([c1, c2])
    expect(out.map((f) => f.frame.id)).toEqual(['a', 'c']) // b 는 채워짐 → 제외
    expect(out[0].dpi).toBe(150)
    expect(out[1].dpi).toBe(300)
    expect(out[1].aspect).toBeCloseTo(2) // 200/100
  })

  it('dispose 등 getObjects throw 캔버스는 건너뜀', () => {
    const bad = { getObjects: () => { throw new Error('disposed') } }
    const good = fakeCanvas([{ id: 'x', extensionType: 'frame', width: 10, height: 10 }])
    const out = collectEmptyFrames([bad as any, good])
    expect(out.map((f) => f.frame.id)).toEqual(['x'])
  })

  it('[O-급 태깅 실측] 캔버스 내 열거 순서 = getObjects() 순서(z-order/추가순), 시각적 위치순 아님', () => {
    // 시각적으로는 top-left 가 앞이어야 할 프레임(b)이 추가순으로 뒤에 있으면 뒤에 열거된다.
    // 이 동작은 오너 게이트(위치순 정렬 옵션) 전까지 의도된 현행 스펙 — 변경 시 이 테스트로 감지.
    const later = { id: 'b', extensionType: 'frame', width: 10, height: 10, top: 0, left: 0 }
    const earlier = { id: 'a', extensionType: 'frame', width: 10, height: 10, top: 500, left: 500 }
    const out = collectEmptyFrames([fakeCanvas([earlier, later])])
    expect(out.map((f) => f.frame.id)).toEqual(['a', 'b'])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// hasEmptyFrame (자동편집 UI 노출 판정 — Track 2)
// ────────────────────────────────────────────────────────────────────────────

describe('hasEmptyFrame', () => {
  it('빈 frame 있으면 true', () => {
    const frame = { id: 'f1', extensionType: 'frame', width: 10, height: 10 }
    expect(hasEmptyFrame([fakeCanvas([frame])])).toBe(true)
  })

  it('frame 이 아예 없으면 false (BOOK/LEAFLET 일반 셋 — 버튼 미노출 근거)', () => {
    const text = { id: 't', extensionType: 'text' }
    const image = { id: 'i', extensionType: 'fillImage', parentLayerId: 'x' }
    expect(hasEmptyFrame([fakeCanvas([text, image])])).toBe(false)
    expect(hasEmptyFrame([])).toBe(false)
  })

  it('모든 frame 이 채워졌으면 false', () => {
    const frame = { id: 'f1', extensionType: 'frame', width: 10, height: 10 }
    const fill = { extensionType: 'fillImage', parentLayerId: 'f1' }
    expect(hasEmptyFrame([fakeCanvas([frame, fill])])).toBe(false)
  })

  it('contentEditable=false 프레임은 고객 기준 제외, editMode 는 포함 (collectEmptyFrames 와 동일 규약)', () => {
    const locked = { id: 'f1', extensionType: 'frame', contentEditable: false, width: 10, height: 10 }
    expect(hasEmptyFrame([fakeCanvas([locked])])).toBe(false)
    expect(hasEmptyFrame([fakeCanvas([locked])], { editMode: true })).toBe(true)
  })

  it('getObjects throw 캔버스는 건너뜀', () => {
    const bad = { getObjects: () => { throw new Error('disposed') } }
    const good = fakeCanvas([{ id: 'f', extensionType: 'frame', width: 10, height: 10 }])
    expect(hasEmptyFrame([bad as any, good])).toBe(true)
    expect(hasEmptyFrame([bad as any])).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// adaptUploadedPhotoMeta / mergeAutofillPhotoInputs (혼합 입력 어댑팅 — Track 2)
// ────────────────────────────────────────────────────────────────────────────

describe('adaptUploadedPhotoMeta', () => {
  it('메타 필드를 ExternalPhoto 형태로 보존 매핑, exifParsed 기본 true', () => {
    const metas: UploadedPhotoMeta[] = [
      {
        url: 'https://s/u1.jpg',
        name: 'u1.jpg',
        uploadedAt: '2026-07-01T00:00:00.000Z', // = file.lastModified (호스트 업로드시각 아님)
        takenAt: '2026-06-30T10:00:00.000Z',
        gps: { lat: 37.5, lng: 127.0 },
      },
    ]
    const out = adaptUploadedPhotoMeta(metas)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({
      url: 'https://s/u1.jpg',
      name: 'u1.jpg',
      uploadedAt: '2026-07-01T00:00:00.000Z',
      takenAt: '2026-06-30T10:00:00.000Z',
      gps: { lat: 37.5, lng: 127.0 },
      exifParsed: true, // 업로드 시점 원본 File 파싱 완료 → URL 재페치 방지
    })
  })

  it('url 없는/빈 항목은 제외', () => {
    const out = adaptUploadedPhotoMeta([
      { url: '' },
      { url: 'https://s/ok.jpg' },
      null as unknown as UploadedPhotoMeta,
    ])
    expect(out.map((p) => p.url)).toEqual(['https://s/ok.jpg'])
  })
})

describe('mergeAutofillPhotoInputs', () => {
  it('외부주입 ∪ 내 업로드 — URL 중복은 외부주입(호스트 메타) 우선', () => {
    const external: ExternalPhoto[] = [
      { url: 'https://s/dup.jpg', name: 'host-name.jpg', takenAt: '2026-01-01T00:00:00Z' },
      { url: 'https://s/e1.jpg' },
    ]
    const uploaded: UploadedPhotoMeta[] = [
      { url: 'https://s/dup.jpg', name: 'local-name.jpg' }, // 중복 → 무시
      { url: 'https://s/u1.jpg', name: 'u1.jpg' },
    ]
    const out = mergeAutofillPhotoInputs(external, uploaded)
    expect(out.map((p) => p.url)).toEqual(['https://s/dup.jpg', 'https://s/e1.jpg', 'https://s/u1.jpg'])
    expect(out[0].name).toBe('host-name.jpg') // 외부주입 승리
  })

  it('한쪽이 비어도 동작(외부주입만 / 내 업로드만)', () => {
    expect(mergeAutofillPhotoInputs([{ url: 'https://s/e.jpg' }], []).map((p) => p.url)).toEqual([
      'https://s/e.jpg',
    ])
    expect(mergeAutofillPhotoInputs([], [{ url: 'https://s/u.jpg' }]).map((p) => p.url)).toEqual([
      'https://s/u.jpg',
    ])
    expect(mergeAutofillPhotoInputs([], [])).toEqual([])
  })

  it('외부주입 내부 중복·불량 url 도 방어적으로 제거', () => {
    const out = mergeAutofillPhotoInputs(
      [
        { url: 'https://s/a.jpg' },
        { url: 'https://s/a.jpg' },
        { url: '' },
      ],
      [],
    )
    expect(out.map((p) => p.url)).toEqual(['https://s/a.jpg'])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// autofillPhotosIntoFrames — 혼합 입력 4모드 라운드트립(엔진 통합, fake 캔버스)
// ────────────────────────────────────────────────────────────────────────────

/** add() 가 getObjects() 에 반영되는 fake 캔버스 — isFrameFilled 라운드트립 검증용. */
function liveCanvas(objects: any[], unitOptions?: any): any {
  return {
    getObjects: () => objects,
    add: (obj: any) => { objects.push(obj) },
    requestRenderAll: () => {},
    unitOptions,
  }
}

/** fillImageIntoFrame 계약(frameRef/parentLayerId/extensionType)을 흉내내는 fake. */
const fakeFillFrame = async (_canvas: any, fore: any, frame: any) => {
  fore.extensionType = 'fillImage'
  fore.frameRef = frame.id
  fore.parentLayerId = frame.id
  fore.id = `${frame.id}_fillImage`
  return fore
}

/** url → {width,height,src} 이미지 fake (정사각 1000px). */
const fakeLoadImage = async (url: string) => ({ width: 1000, height: 1000, src: url })

function makePhotos(): ExternalPhoto[] {
  // 외부주입 2장 + 내 업로드 2장(어댑팅) 혼합. takenAt 우선 → uploadedAt 폴백 순서 검증 가능.
  const external: ExternalPhoto[] = [
    { url: 'https://s/e2.jpg', name: 'e2.jpg', takenAt: '2026-05-02T00:00:00Z' },
    { url: 'https://s/e1.jpg', name: 'e1.jpg', takenAt: '2026-05-01T00:00:00Z' },
  ]
  const uploaded: UploadedPhotoMeta[] = [
    // takenAt 없음 → uploadedAt(file.lastModified) 폴백으로 맨 뒤
    { url: 'https://s/u2.jpg', name: 'u2.jpg', uploadedAt: '2026-06-01T00:00:00Z' },
    { url: 'https://s/u1.jpg', name: 'u1.jpg', takenAt: '2026-04-01T00:00:00Z' },
  ]
  return mergeAutofillPhotoInputs(external, uploaded)
}

function makeCanvases() {
  // 2페이지 × 2프레임 = 4슬롯(정사각 — aspect 매칭이 순서를 흔들지 않게)
  const p1 = [
    { id: 'p1f1', extensionType: 'frame', width: 100, height: 100 },
    { id: 'p1f2', extensionType: 'frame', width: 100, height: 100 },
  ]
  const p2 = [
    { id: 'p2f1', extensionType: 'frame', width: 100, height: 100 },
    { id: 'p2f2', extensionType: 'frame', width: 100, height: 100 },
  ]
  return [liveCanvas(p1, { unit: 'mm', dpi: 150 }), liveCanvas(p2, { unit: 'mm', dpi: 150 })]
}

describe('autofillPhotosIntoFrames — 혼합 입력 4모드 라운드트립', () => {
  const MODES: PhotoSortMode[] = ['date', 'filename', 'location', 'random']

  for (const mode of MODES) {
    it(`${mode} 모드: 혼합 입력 4장 → 4슬롯 전부 채움 + fillImage 링크 계약 유지`, async () => {
      const canvases = makeCanvases()
      const result = await autofillPhotosIntoFrames(canvases, makePhotos(), {
        mode,
        fillFrame: fakeFillFrame,
        loadImage: fakeLoadImage,
        imagePlugin: {},
      })

      expect(result.filledCount).toBe(4)
      expect(result.remainingFrames).toBe(0)
      expect(result.remainingPhotos).toBe(0)

      // 라운드트립: 채움 후 모든 프레임이 isFrameFilled=true (fillImage 규약 매칭)
      for (const cv of canvases) {
        const frames = cv.getObjects().filter((o: any) => o.extensionType === 'frame')
        for (const f of frames) expect(isFrameFilled(cv, f)).toBe(true)
        const fills = cv.getObjects().filter((o: any) => o.extensionType === 'fillImage')
        expect(fills).toHaveLength(2)
        for (const fill of fills) {
          expect(fill.frameRef).toBeTruthy()
          expect(fill.parentLayerId).toBe(fill.frameRef)
        }
      }

      // 재실행(빈 틀 없음) → 아무 것도 안 채움 (idempotent — 채워진 틀 스킵 = 보수 기본)
      const again = await autofillPhotosIntoFrames(canvases, makePhotos(), {
        mode,
        fillFrame: fakeFillFrame,
        loadImage: fakeLoadImage,
        imagePlugin: {},
      })
      expect(again.filledCount).toBe(0)
      expect(again.remainingPhotos).toBe(4)
    })
  }

  it('date 모드: takenAt → uploadedAt 폴백 순서가 프레임 열거 순서(페이지→z-order)에 그대로 매핑', async () => {
    const canvases = makeCanvases()
    await autofillPhotosIntoFrames(canvases, makePhotos(), {
      mode: 'date',
      fillFrame: fakeFillFrame,
      loadImage: fakeLoadImage,
      imagePlugin: {},
      aspectMatch: false, // 순서 검증이 목적 — zip 매칭
    })
    const srcOf = (cv: any, frameId: string) =>
      cv.getObjects().find((o: any) => o.parentLayerId === frameId)?.src
    // 시간순: u1(4/1) → e1(5/1) → e2(5/2) → u2(takenAt 없음 → uploadedAt 6/1 폴백, 맨 뒤)
    expect(srcOf(canvases[0], 'p1f1')).toBe('https://s/u1.jpg')
    expect(srcOf(canvases[0], 'p1f2')).toBe('https://s/e1.jpg')
    expect(srcOf(canvases[1], 'p2f1')).toBe('https://s/e2.jpg')
    expect(srcOf(canvases[1], 'p2f2')).toBe('https://s/u2.jpg')
  })

  it('filename 모드: 내 업로드 name(file.name) 도 자연 정렬에 참여', async () => {
    const canvases = [liveCanvas([
      { id: 'f1', extensionType: 'frame', width: 100, height: 100 },
      { id: 'f2', extensionType: 'frame', width: 100, height: 100 },
      { id: 'f3', extensionType: 'frame', width: 100, height: 100 },
    ], { unit: 'mm', dpi: 150 })]
    const photos = mergeAutofillPhotoInputs(
      [{ url: 'https://s/b.jpg', name: 'IMG_10.jpg' }],
      [
        { url: 'https://s/a.jpg', name: 'IMG_2.jpg' },
        { url: 'https://s/c.jpg', name: 'IMG_11.jpg' },
      ],
    )
    await autofillPhotosIntoFrames(canvases, photos, {
      mode: 'filename',
      fillFrame: fakeFillFrame,
      loadImage: fakeLoadImage,
      imagePlugin: {},
      aspectMatch: false,
    })
    const srcOf = (frameId: string) =>
      canvases[0].getObjects().find((o: any) => o.parentLayerId === frameId)?.src
    // 자연 정렬: IMG_2 < IMG_10 < IMG_11
    expect(srcOf('f1')).toBe('https://s/a.jpg')
    expect(srcOf('f2')).toBe('https://s/b.jpg')
    expect(srcOf('f3')).toBe('https://s/c.jpg')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 저해상도 경고 × 캔버스 dpi 기준 (2026-08-18 부수효과 ①의 회귀 가드)
//
// 배경: addPage/addInnerPage 로 만들어진 캔버스는 종전 unitOptions 미주입이라
//   canvas.unitOptions === undefined 였고, canvasDpi() 가 72(px=pt) 로 폴백했다.
//   그 결과 mm 상품(캔버스 좌표 = 150dpi px)의 **내지 페이지**에서만
//   effectiveDpi 가 실제의 72/150 = 0.48배로 산출돼,
//     ⓐ 멀쩡한 사진에 저해상도 경고가 뜨고(오탐)
//     ⓑ 토스트에 표시되는 "최저 NNNdpi" 숫자 자체가 2.08배 낮게 나왔다.
//   c5c9525(8/18)의 unitOptions 주입으로 두 증상이 함께 사라진다 —
//   즉 이 부수효과는 "경고 완화"가 아니라 **오탐 제거 + 표시값 교정**이다.
// ────────────────────────────────────────────────────────────────────────────

describe('autofillPhotosIntoFrames — 저해상도 경고는 캔버스 dpi 를 따른다', () => {
  /** 100mm 프레임의 캔버스 px = 100/25.4*150 ≈ 590px (mm 상품 좌표 규약: 150dpi px) */
  const FRAME_150DPI_PX = 590
  const loadImage1000 = async (url: string) => ({ width: 1000, height: 1000, src: url })
  const onePhoto = [{ url: 'https://s/a.jpg', name: 'a.jpg' }]

  const runOn = (unitOptions: any) =>
    autofillPhotosIntoFrames(
      [liveCanvas(
        [{ id: 'f1', extensionType: 'frame', width: FRAME_150DPI_PX, height: FRAME_150DPI_PX }],
        unitOptions,
      )],
      onePhoto,
      { fillFrame: fakeFillFrame, loadImage: loadImage1000, imagePlugin: {} },
    )

  it('mm/150 캔버스: 1000px 사진 / 100mm 프레임 = 254dpi → 경고 없음', async () => {
    const result = await runOn({ unit: 'mm', dpi: 150 })
    expect(result.filledCount).toBe(1)
    expect(result.lowResWarnings).toHaveLength(0)
  })

  it('unitOptions 미주입(=8/18 이전 addPage 캔버스): 같은 사진이 122dpi 로 오탐 경고', async () => {
    // 회귀 가드 — 이 케이스가 다시 "경고 없음"이 되면 폴백 의미가 바뀐 것이고,
    // "경고 있음"으로 남아 있는 한 addPage 주입 누락은 즉시 이 차이로 드러난다.
    const result = await runOn(undefined)
    expect(result.lowResWarnings).toHaveLength(1)
    expect(result.lowResWarnings[0].effectiveDpi).toBe(122) // 1000*72/590
    expect(result.lowResWarnings[0].thresholdDpi).toBe(150)
  })

  it('px 상품 캔버스(unit=px): 현행 규약대로 72 기준 — 590 프레임은 122dpi 경고', async () => {
    // ⚠️ 현행 동작의 고정일 뿐 "정답"의 고정은 아니다. PDF 내보내기 파이프라인
    //   (ServicePlugin._createMultiPagePDF)은 px 캔버스 좌표를 pxToMm(x, settings.dpi) 로
    //   환산한다 — 즉 px 좌표를 settings.dpi(보통 150) 기준으로 본다. 여기 72(pt) 기준과
    //   서로 다르므로, px 상품에서 프레임 기능을 쓰게 되면 저해상도 경고가 dpi/72 배만큼
    //   과다 산출된다. 현재 프레임(사진틀)은 mm 상품 전용이라 노출이 없다.
    //   정합화 여부는 오너 결정 대기 — RESUME 2026-08-24 §2 ④ 참조.
    const result = await runOn({ unit: 'px' })
    expect(result.lowResWarnings).toHaveLength(1)
    expect(result.lowResWarnings[0].effectiveDpi).toBe(122)
  })

  it('캔버스마다 자기 dpi 를 쓴다(혼재 시 첫 캔버스 기준으로 뭉뚱그리지 않음)', async () => {
    const mmCanvas = liveCanvas(
      [{ id: 'mm1', extensionType: 'frame', width: FRAME_150DPI_PX, height: FRAME_150DPI_PX }],
      { unit: 'mm', dpi: 150 },
    )
    const legacyCanvas = liveCanvas(
      [{ id: 'lg1', extensionType: 'frame', width: FRAME_150DPI_PX, height: FRAME_150DPI_PX }],
      undefined,
    )
    const result = await autofillPhotosIntoFrames(
      [mmCanvas, legacyCanvas],
      [
        { url: 'https://s/a.jpg', name: 'a.jpg' },
        { url: 'https://s/b.jpg', name: 'b.jpg' },
      ],
      { fillFrame: fakeFillFrame, loadImage: loadImage1000, imagePlugin: {} },
    )
    expect(result.filledCount).toBe(2)
    // mm 캔버스 쪽만 통과 → 경고는 legacy 캔버스 1건뿐
    expect(result.lowResWarnings).toHaveLength(1)
    expect(result.lowResWarnings[0].effectiveDpi).toBe(122)
  })
})
