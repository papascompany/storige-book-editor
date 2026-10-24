/**
 * calendar/skin.test.ts — 캘린더 스킨 병합 순수 함수(설계 C10 §3.3 · §7.1, T7a)
 * + §9 R1 특성 테스트(기존 교체 경로의 속성 손실·예외를 고정 — 스킨 경로는 그 함수를 쓰지 않음).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fabric } from 'fabric'
import {
  collectSkinTemplateIds,
  isSkinMergeSuspect,
  mergeSkinCanvas,
  summarizeSkinMergeReports,
  SKIN_MERGE_SUSPECT_MIN_CUSTOMER,
  SKIN_MERGE_SUSPECT_RATIO,
  type SkinCanvasJson,
} from './skin'
import { core } from '../utils/canvas'
import TemplatePlugin from '../plugins/TemplatePlugin'

type Obj = Record<string, unknown>

// ─── 픽스처 ──────────────────────────────────────────────────────────────────

const ws = (width = 800, height = 600): Obj => ({ type: 'rect', id: 'workspace', left: 0, top: 0, width, height, originX: 'center', originY: 'center' })
const bg = (id: string, fill = '#fff'): Obj => ({ type: 'rect', id, extensionType: 'background', left: -400, top: -300, width: 800, height: 600, fill })
const frame = (id: string, left: number, top: number, patch: Obj = {}): Obj =>
  ({ type: 'rect', id, extensionType: 'frame', left, top, width: 200, height: 150, scaleX: 1, scaleY: 1, angle: 0, ...patch })
const imageFrame = (id: string, left: number, top: number, src: string, patch: Obj = {}): Obj =>
  frame(id, left, top, { type: 'image', src, crossOrigin: 'anonymous', ...patch })
const grid = (id: string, ext: Obj = { variant: 'month' }): Obj =>
  ({ type: 'group', id, extensionType: 'calendar-grid', extension: ext, deleteable: false, objects: [{ type: 'rect', id: `${id}-bounds` }] })
const text = (id: string, str: string, patch: Obj = {}): Obj =>
  ({ type: 'textbox', id, text: str, left: -300, top: -250, fontFamily: 'SkinA', fontSize: 24, styles: {}, ...patch })
/** 편집기 fillImage/fillImageIntoFrame 이 만드는 채움 사진 모양 */
const photo = (frameId: string, src: string, patch: Obj = {}): Obj => ({
  type: 'image',
  id: `${frameId}_fillImage`,
  extensionType: 'fillImage',
  frameRef: frameId,
  parentLayerId: frameId,
  src,
  left: 100,
  top: 75,
  originX: 'center',
  originY: 'center',
  scaleX: 0.42,
  scaleY: 0.42,
  cropX: 12,
  extension: { takenAt: '2026-05-01' },
  clipPath: { type: 'rect', id: `${frameId}_rearClip`, absolutePositioned: true, left: 100, top: 75, width: 200, height: 150 },
  ...patch,
})
const sticker = (id: string, patch: Obj = {}): Obj => ({ type: 'image', id, extensionType: 'clipart', src: `/s/${id}.png`, left: 10, top: 10, ...patch })
const canvas = (objects: Obj[], extra: Obj = {}): SkinCanvasJson => ({ version: '5.5.2', background: '#ffffff', objects, ...extra })

const objs = (json: SkinCanvasJson | null): Obj[] => (json?.objects ?? []) as Obj[]
const ids = (json: SkinCanvasJson | null): unknown[] => objs(json).map((o) => o.id)
const byId = (json: SkinCanvasJson | null, id: string): Obj | undefined => objs(json).find((o) => o.id === id)

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v)
  }
  return value
}

/** 순번 id 생성기(테스트 주입) */
const seqIds = () => {
  let n = 0
  return () => `new-${(n += 1)}`
}

// 기준 템플릿(from) — workspace·배경·사진틀·그리드·문구
const FROM = (): SkinCanvasJson => canvas([ws(), bg('bg-1'), frame('f1', 0, 0), grid('g1'), text('t1', '2027 CALENDAR')])
// 스킨 템플릿(to) — 복제본이라 문구·틀 id 를 공유, 배경·그리드는 새 id
const TO = (): SkinCanvasJson => canvas([ws(), bg('bg-s', '#fde'), frame('f1', 0, 0), grid('g-s', { variant: 'month', style: { fontFamily: 'SkinB' } }), text('t1', '2027 SPRING', { fontFamily: 'SkinB', left: -200 })], { background: '#fde' })

describe('mergeSkinCanvas — 템플릿·workspace', () => {
  it('템플릿만 있는 캔버스 → to 요소 + 현재 workspace(도련 반영 크기 유지)', () => {
    const cur = canvas([ws(830, 630), bg('bg-1'), frame('f1', 0, 0), grid('g1'), text('t1', '2027 CALENDAR')])
    const { json, refills, report } = mergeSkinCanvas(cur, FROM(), TO())
    expect(ids(json)).toEqual(['workspace', 'bg-s', 'f1', 'g-s', 't1'])
    expect(byId(json, 'workspace')).toEqual(ws(830, 630))
    expect(byId(json, 't1')).toEqual(text('t1', '2027 SPRING', { fontFamily: 'SkinB', left: -200 }))
    expect(json?.background).toBe('#fde')
    expect(json?.version).toBe('5.5.2')
    expect(refills).toEqual([])
    expect(report).toMatchObject({ templateRemoved: 4, gridsRemoved: 1, customerKept: 0, textsMoved: 0, suspect: false })
  })

  it('옛 그리드는 제거되고 새 그리드만 남는다(extension 은 스킨 값)', () => {
    const cur = canvas([ws(), grid('g1', { variant: 'month', monthOffset: 3 }), grid('g-old-mini', { variant: 'mini', monthDelta: -1 })])
    const to = canvas([ws(), grid('g-new', { variant: 'year', yearDelta: 0 })])
    const { json, report } = mergeSkinCanvas(cur, null, to, { templateIds: ['g1', 'g-old-mini'] })
    const grids = objs(json).filter((o) => o.extensionType === 'calendar-grid')
    expect(grids.map((g) => g.id)).toEqual(['g-new'])
    expect(grids[0].extension).toEqual({ variant: 'year', yearDelta: 0 })
    expect(report.gridsRemoved).toBe(2)
  })

  it('최상위 디자인 키(background 등)는 to 값, to 에 없으면 지운다 · 그 밖의 최상위 키는 현재 값', () => {
    const cur = canvas([ws()], { background: '#000', backgroundImage: { src: '/old.png' }, custom: 1 })
    const { json } = mergeSkinCanvas(cur, null, canvas([ws()], { background: '#abc' }))
    expect(json?.background).toBe('#abc')
    expect(json && 'backgroundImage' in json).toBe(false)
    expect(json?.custom).toBe(1)
  })
})

describe('mergeSkinCanvas — 채움 사진', () => {
  it('같은 id·같은 기하 틀 → 사진 JSON 그대로 유지(링크 그대로), 틀 아래에 끼우고 틀에 fillImage 기록', () => {
    const p = photo('f1', '/u/a.jpg')
    const cur = canvas([ws(), bg('bg-1'), p, frame('f1', 0, 0, { fillImage: 'f1_fillImage' }), grid('g1')])
    const { json, refills, report } = mergeSkinCanvas(cur, FROM(), TO())
    expect(byId(json, 'f1_fillImage')).toEqual(p)
    expect(ids(json)).toEqual(['workspace', 'bg-s', 'f1_fillImage', 'f1', 'g-s', 't1'])
    expect(byId(json, 'f1')?.fillImage).toBe('f1_fillImage')
    expect(refills).toEqual([])
    expect(report).toMatchObject({ photosKept: 1, photosRelinked: 0, photosRefilled: 0, photosDropped: 0 })
  })

  it('사진이 틀 위에 있던 경우 → 대상 틀 바로 위에 끼운다', () => {
    const cur = canvas([ws(), frame('f1', 0, 0), photo('f1', '/u/a.jpg')])
    const { json } = mergeSkinCanvas(cur, FROM(), TO())
    expect(ids(json)).toEqual(['workspace', 'bg-s', 'f1', 'f1_fillImage', 'g-s', 't1'])
  })

  it('id 가 달라 읽는 순서(중심 top→left)로 짝지은 사진 → frameRef·parentLayerId·id·clipPath id 를 대상 틀로', () => {
    const cur = canvas([ws(), frame('fa', 0, 0), frame('fb', 300, 0), photo('fa', '/u/a.jpg'), photo('fb', '/u/b.jpg', { left: 400 })])
    // to 배열 순서는 오른쪽 틀이 먼저 — 짝은 배열 순서가 아니라 읽는 순서로 정한다
    const to = canvas([ws(), frame('sb', 300, 0), frame('sa', 0, 0)])
    const { json, report } = mergeSkinCanvas(cur, null, to, { templateIds: ['fa', 'fb'] })
    const a = byId(json, 'sa_fillImage') as Obj
    const b = byId(json, 'sb_fillImage') as Obj
    expect([a.src, a.frameRef, a.parentLayerId, (a.clipPath as Obj).id]).toEqual(['/u/a.jpg', 'sa', 'sa', 'sa_rearClip'])
    expect([b.src, b.frameRef, b.parentLayerId, (b.clipPath as Obj).id]).toEqual(['/u/b.jpg', 'sb', 'sb', 'sb_rearClip'])
    // 변환(이동·확대·자르기)은 그대로
    expect([a.left, a.top, a.scaleX, a.cropX]).toEqual([100, 75, 0.42, 12])
    expect(byId(json, 'sa')?.fillImage).toBe('sa_fillImage')
    expect(ids(json)).toEqual(['workspace', 'sb', 'sb_fillImage', 'sa', 'sa_fillImage'])
    expect(report).toMatchObject({ photosKept: 2, photosRelinked: 2 })
  })

  it('같은 id 틀이 먼저 짝을 잡고, 남은 틀만 읽는 순서로 짝짓는다', () => {
    const cur = canvas([ws(), frame('f1', 300, 0), frame('fx', 0, 0), photo('f1', '/u/1.jpg'), photo('fx', '/u/x.jpg')])
    const to = canvas([ws(), frame('s0', 0, 0), frame('f1', 300, 0)])
    const { json } = mergeSkinCanvas(cur, null, to, { templateIds: ['fx'] })
    expect(byId(json, 'f1_fillImage')?.src).toBe('/u/1.jpg')
    expect(byId(json, 's0_fillImage')?.src).toBe('/u/x.jpg')
  })

  it('대상 틀 기하가 다르면 사진 JSON 을 빼고 refills 큐(자르기 초기화 — 편집기가 다시 채움)', () => {
    const cur = canvas([ws(), photo('f1', '/u/a.jpg'), frame('f1', 0, 0, { fillImage: 'f1_fillImage' })])
    const to = canvas([ws(), frame('f1', 0, 0, { width: 260, fillImage: 'f1_sample' }), { type: 'image', id: 'f1_sample', extensionType: 'fillImage', frameRef: 'f1', src: '/t/sample.jpg' }])
    const { json, refills, report } = mergeSkinCanvas(cur, null, to)
    expect(refills).toEqual([{ frameId: 'f1', src: '/u/a.jpg', extension: { takenAt: '2026-05-01' }, photoId: 'f1_fillImage', reason: 'geometry' }])
    expect(byId(json, 'f1_fillImage')).toBeUndefined()
    // 대상 틀에 걸린 스킨 견본 사진은 빼고 틀의 fillImage 도 비운다(다시 채울 자리)
    expect(byId(json, 'f1_sample')).toBeUndefined()
    expect(byId(json, 'f1') && 'fillImage' in (byId(json, 'f1') as Obj)).toBe(false)
    expect(report).toMatchObject({ photosRefilled: 1, photosKept: 0 })
  })

  it('대상 틀 없음(Q2 정책 — 호환 검사 밖의 방어) → 캔버스에서 빼고 보고', () => {
    const cur = canvas([ws(), frame('fa', 0, 0), frame('fb', 300, 0), photo('fa', '/u/a.jpg'), photo('fb', '/u/b.jpg')])
    const to = canvas([ws(), frame('s1', 0, 0)])
    const { json, report } = mergeSkinCanvas(cur, null, to, { templateIds: ['fa', 'fb'] })
    expect(byId(json, 's1_fillImage')?.src).toBe('/u/a.jpg')
    expect(objs(json).filter((o) => o.extensionType === 'fillImage')).toHaveLength(1)
    expect(report.photosDropped).toBe(1)
    expect(report.dropped).toEqual([{ kind: 'photo', id: 'fb_fillImage', src: '/u/b.jpg' }])
  })

  it('기하 같고 이미지 틀 src 만 다름 → 사진 변환 유지 + clipPath 를 새 틀 이미지로 재생성', () => {
    const imgClip = { type: 'image', id: 'f1_frameClip', src: '/t/old-frame.png', crossOrigin: 'anonymous', inverted: true, absolutePositioned: true, left: 100, top: 75, scaleX: 1, scaleY: 1, width: 200, height: 150 }
    const p = photo('f1', '/u/a.jpg', { clipPath: imgClip })
    const cur = canvas([ws(), p, imageFrame('f1', 0, 0, '/t/old-frame.png')])
    const to = canvas([ws(), imageFrame('f1', 0, 0, '/t/new-frame.png')])
    const { json, refills, report } = mergeSkinCanvas(cur, null, to)
    const out = byId(json, 'f1_fillImage') as Obj
    expect([out.left, out.top, out.scaleX, out.cropX]).toEqual([100, 75, 0.42, 12])
    expect(out.clipPath).toEqual({ ...imgClip, src: '/t/new-frame.png' })
    expect(refills).toEqual([])
    expect(report).toMatchObject({ photosClipRebuilt: 1, photosKept: 0 })
  })

  it('기하 같고 틀 type 이 다름(이미지 ↔ 벡터) → clipPath 를 만들 수 없어 refills(frame-shape)', () => {
    const cur = canvas([ws(), photo('f1', '/u/a.jpg'), frame('f1', 0, 0)])
    const to = canvas([ws(), imageFrame('f1', 0, 0, '/t/new-frame.png')])
    const { refills, report } = mergeSkinCanvas(cur, null, to)
    expect(refills.map((r) => [r.frameId, r.reason])).toEqual([['f1', 'frame-shape']])
    expect(report.photosRefilled).toBe(1)
  })

  it('템플릿 견본 채움 사진(from 과 같은 id·src)은 고객 사진이 아니다 — 스킨 견본을 쓴다', () => {
    const sample = photo('f1', '/t/sample.jpg')
    const from = canvas([ws(), sample, frame('f1', 0, 0)])
    const toSample = photo('f1', '/t/skin-sample.jpg')
    const to = canvas([ws(), toSample, frame('f1', 0, 0)])
    const { json, report } = mergeSkinCanvas(canvas([ws(), sample, frame('f1', 0, 0)]), from, to)
    expect(byId(json, 'f1_fillImage')?.src).toBe('/t/skin-sample.jpg')
    expect(report.photosKept).toBe(0)
    // 고객이 견본을 바꿔 채웠으면(같은 id, 다른 src) 고객 사진으로 옮긴다
    const { json: j2 } = mergeSkinCanvas(canvas([ws(), photo('f1', '/u/mine.jpg'), frame('f1', 0, 0)]), from, to)
    expect(objs(j2).filter((o) => o.extensionType === 'fillImage').map((o) => o.src)).toEqual(['/u/mine.jpg'])
  })
})

describe('mergeSkinCanvas — 템플릿 문구(Q3 (a) 문자열만)', () => {
  const from = canvas([ws(), text('t1', '2027 CALENDAR'), text('t2', '우리 가족'), text('t3', 'Thank you')])
  const to = canvas([ws(), text('t1', '2027 SPRING', { fontFamily: 'SkinB', left: -200 }), text('t2', 'OUR FAMILY', { fill: '#f00' })])

  it('고친 문구는 문자열만(+requiredEditTouched) 옮기고, 안 고친 문구는 스킨 기본값', () => {
    const cur = canvas([ws(), text('t1', '김씨네 2027', { requiredEditTouched: true, left: 50 }), text('t2', '우리 가족')])
    const { json, report } = mergeSkinCanvas(cur, from, to)
    expect(byId(json, 't1')).toEqual(text('t1', '김씨네 2027', { fontFamily: 'SkinB', left: -200, requiredEditTouched: true }))
    expect(byId(json, 't2')).toEqual(text('t2', 'OUR FAMILY', { fill: '#f00' }))
    expect(report).toMatchObject({ textsMoved: 1, textsDropped: 0, textsUnverified: 0 })
  })

  it('고친 문구인데 스킨에 같은 id 자리가 없음 → 빼고 보고', () => {
    const cur = canvas([ws(), text('t3', '고마워요')])
    const { json, report } = mergeSkinCanvas(cur, from, to)
    expect(byId(json, 't3')).toBeUndefined()
    expect(report.textsDropped).toBe(1)
    expect(report.dropped).toEqual([{ kind: 'text', id: 't3', text: '고마워요' }])
  })

  it('from 알 수 없음 → 문구를 옮기지 않고 판정 불가로 보고(스킨 문구와 다른 것만)', () => {
    const cur = canvas([ws(), text('t1', '김씨네 2027'), text('t2', 'OUR FAMILY')])
    const { json, report } = mergeSkinCanvas(cur, null, to)
    expect(byId(json, 't1')?.text).toBe('2027 SPRING')
    expect(report).toMatchObject({ textsMoved: 0, textsUnverified: 1 })
  })
})

describe('mergeSkinCanvas — 템플릿 유래 판정(판정 집합 · 보조 판정)', () => {
  it('from 불명·템플릿 개정 후: 판정 집합(기준 ∪ 모든 스킨 ids)과 보조 판정으로 옛 디자인 요소를 템플릿 유래로 분류', () => {
    // 현재 캔버스는 삭제된 스킨(옛 디자인)을 따르고 있었다 — from 은 알 수 없음
    const cur = canvas([
      ws(),
      { type: 'path', id: 'old-deco-shared' }, // 다른 등록 스킨과 공유하는 id → 판정 집합
      { type: 'path', id: 'old-deco-locked', deleteable: false }, // 보조: deleteable:false
      { type: 'path', id: 'old-deco-admin-lock', lockInfo: { isLocked: true, lockLevel: 'admin' } }, // 보조: 템플릿 잠금
      { type: 'rect', id: 'old-bg', extensionType: 'background', deleteable: false }, // 보조: deleteable:false
      grid('old-grid'), // 보조: 날짜 그리드(고객 추가 경로 없음)
      sticker('st-1'),
      // 고객이 직접 잠근(또는 잠갔다 푼) 요소는 고객 요소로 남긴다
      sticker('st-locked', { lockInfo: { isLocked: true, lockLevel: 'user' } }),
      sticker('st-unlocked', { lockInfo: { isLocked: false, lockLevel: 'user' } }),
    ])
    const baseTpl = canvas([ws(), bg('bg-1'), grid('g1')])
    const otherSkinTpl = canvas([ws(), { type: 'path', id: 'old-deco-shared' }])
    const to = canvas([ws(), bg('bg-s'), grid('g-s')])
    const templateIds = collectSkinTemplateIds([baseTpl, otherSkinTpl, JSON.stringify(to)])
    expect([...templateIds].sort()).toEqual(['bg-1', 'bg-s', 'g-s', 'g1', 'old-deco-shared', 'workspace'])
    const { json, report } = mergeSkinCanvas(cur, null, to, { templateIds })
    expect(ids(json)).toEqual(['workspace', 'bg-s', 'g-s', 'st-1', 'st-locked', 'st-unlocked'])
    expect(report).toMatchObject({ templateRemoved: 5, auxiliaryTemplateCount: 4, customerKept: 3, suspect: false })
  })

  it('판정 집합 밖 객체는 extensionType(frame·background·template-element)만으로는 고객 요소로 남는다', () => {
    const cur = canvas([
      ws(),
      { type: 'rect', id: 'x-bg', extensionType: 'background' },
      { type: 'group', id: 'x-el', extensionType: 'template-element' },
      frame('x-frame', 0, 0),
    ])
    const { json, report } = mergeSkinCanvas(cur, null, canvas([ws(), bg('bg-s')]))
    expect(ids(json)).toEqual(['workspace', 'bg-s', 'x-bg', 'x-el', 'x-frame'])
    expect(report).toMatchObject({ templateRemoved: 0, auxiliaryTemplateCount: 0, customerKept: 3 })
  })

  it("'고객 추가' 개수가 임계 이상이면 차단 보고(suspect) — 합계 blocked, 임계 미만은 통과", () => {
    // 기준 템플릿 객체 8개(workspace 제외). 판정 집합에 없는 새로 만든 스킨 디자인 6개가 남은 경우 = 판정 오류
    const baseTpl = canvas([ws(), bg('bg-1'), frame('f1', 0, 0), grid('g1'), ...Array.from({ length: 5 }, (_, i) => ({ type: 'path', id: `deco-${i}` }))])
    const cur = canvas([ws(), ...Array.from({ length: 6 }, (_, i) => ({ type: 'path', id: `scratch-${i}` }))])
    const suspect = mergeSkinCanvas(cur, null, baseTpl, { referenceObjectCount: 8 })
    expect(suspect.report).toMatchObject({ customerKept: 6, referenceObjectCount: 8, suspect: true })
    const ok = mergeSkinCanvas(canvas([ws(), sticker('a'), sticker('b')]), null, baseTpl)
    expect(ok.report).toMatchObject({ customerKept: 2, referenceObjectCount: 8, suspect: false })
    const sum = summarizeSkinMergeReports([ok.report, suspect.report])
    expect(sum).toMatchObject({ blocked: true, suspectIndices: [1], customerKept: 8 })
    expect(summarizeSkinMergeReports([ok.report]).blocked).toBe(false)
  })

  it('isSkinMergeSuspect: 하한 4 · 비율 0.5 · 기준 0 이면 false', () => {
    expect([SKIN_MERGE_SUSPECT_MIN_CUSTOMER, SKIN_MERGE_SUSPECT_RATIO]).toEqual([4, 0.5])
    expect(isSkinMergeSuspect(3, 2)).toBe(false) // 하한 미만 — 샘플 크기(2~4개) 템플릿에 스티커 3개는 정상
    expect(isSkinMergeSuspect(4, 4)).toBe(true)
    expect(isSkinMergeSuspect(4, 9)).toBe(false) // ceil(4.5)=5 미만
    expect(isSkinMergeSuspect(5, 9)).toBe(true)
    expect(isSkinMergeSuspect(10, 0)).toBe(false)
  })
})

describe('mergeSkinCanvas — 고객 추가 요소', () => {
  it('원래 순서대로 맨 위에 보존 · 출력에 같은 id 가 있으면 새 id + 참조(parentLayerId·frameRef·fillImage·clipPath) 수정', () => {
    const to = canvas([ws(), grid('g-s'), frame('f1', 0, 0)])
    const cur = canvas([
      ws(),
      sticker('g-s-bounds'), // to 그리드 자식 id 와 충돌
      { type: 'rect', id: 'shape-1', extensionType: 'mold', fillImage: 'shape-1_fillImage' },
      { type: 'image', id: 'shape-1_fillImage', extensionType: 'fillImage', parentLayerId: 'shape-1', src: '/u/m.jpg', clipPath: { type: 'rect', id: 'shape-1_rearClip' } },
      text('my-text', '안녕'),
    ])
    // shape-1 은 출력의 유지 사진 id 와 충돌하도록 만든다: 현재 캔버스의 다른 틀 사진 id 를 shape-1 로 둔다
    cur.objects?.push(frame('f1', 0, 0), photo('f1', '/u/a.jpg', { id: 'shape-1' }))
    const { json, report } = mergeSkinCanvas(cur, null, to, { createId: seqIds() })
    expect(ids(json)).toEqual(['workspace', 'g-s', 'f1', 'shape-1', 'new-1', 'new-2', 'new-2_fillImage', 'my-text'])
    const mold = byId(json, 'new-2') as Obj
    const moldPhoto = byId(json, 'new-2_fillImage') as Obj
    expect(mold.fillImage).toBe('new-2_fillImage')
    expect([moldPhoto.parentLayerId, (moldPhoto.clipPath as Obj).id]).toEqual(['new-2', 'new-2_rearClip'])
    expect(byId(json, 'new-1')?.src).toBe('/s/g-s-bounds.png')
    expect(report).toMatchObject({ customerKept: 4, customerReissued: 2, photosKept: 1 })
  })

  it('충돌이 없으면 고객 요소는 그대로(id·참조 불변)', () => {
    const c = sticker('st-9', { parentLayerId: 'whatever' })
    const { json, report } = mergeSkinCanvas(canvas([ws(), c]), null, canvas([ws()]))
    expect(byId(json, 'st-9')).toEqual(c)
    expect(report.customerReissued).toBe(0)
  })
})

describe('mergeSkinCanvas — 고객 라이브러리 사진틀(R 재현 1~3)', () => {
  // 편집기 라이브러리 틀 추가(useEditorContents 프레임 콘텐츠 경로): extensionType 'frame' 만 붙고 잠금·deleteable 없음, id = uuid
  const libFrame = (patch: Obj = {}): Obj =>
    ({ type: 'image', id: 'lib-uuid-1', extensionType: 'frame', src: '/storage/frames/heart.png', left: 500, top: 300, width: 120, height: 120, ...patch })
  const from = canvas([ws(), bg('bgA'), frame('fA', 100, 100)])
  const to = canvas([ws(), bg('bgB'), frame('fB', 100, 100)])
  const templateIds = collectSkinTemplateIds([from, to])

  it('재현 1: 템플릿 틀 사진은 스킨 틀로, 라이브러리 틀과 그 사진·고객 문구는 고객 요소로 보존', () => {
    const libPhoto = photo('lib-uuid-1', 'p2.jpg')
    const cur = canvas([
      ws(), bg('bgA'), photo('fA', 'p1.jpg'), frame('fA', 100, 100, { fillImage: 'fA_fillImage' }),
      libPhoto, libFrame({ fillImage: 'lib-uuid-1_fillImage' }), text('t-user', 'hi'),
    ])
    const { json, refills, report } = mergeSkinCanvas(cur, from, to, { templateIds })
    expect(ids(json)).toEqual(['workspace', 'bgB', 'fB_fillImage', 'fB', 'lib-uuid-1_fillImage', 'lib-uuid-1', 't-user'])
    expect(byId(json, 'fB_fillImage')?.src).toBe('p1.jpg')
    expect(byId(json, 'lib-uuid-1_fillImage')).toEqual(libPhoto)
    expect(byId(json, 'lib-uuid-1')).toEqual(libFrame({ fillImage: 'lib-uuid-1_fillImage' }))
    expect(refills).toEqual([])
    expect(report).toMatchObject({ photosKept: 1, photosRelinked: 1, photosDropped: 0, customerKept: 3, templateRemoved: 2, auxiliaryTemplateCount: 0 })
    expect(report.dropped).toEqual([])
  })

  it('재현 2: 템플릿 틀이 없으면 고객 라이브러리 틀(과 사진)은 스킨 틀과 짝지어지지 않는다', () => {
    const cur = canvas([ws(), bg('bgA'), photo('lib-uuid-1', 'p2.jpg'), libFrame({ fillImage: 'lib-uuid-1_fillImage' })])
    const { json, refills, report } = mergeSkinCanvas(cur, from, to, { templateIds })
    expect(ids(json)).toEqual(['workspace', 'bgB', 'fB', 'lib-uuid-1_fillImage', 'lib-uuid-1'])
    expect(byId(json, 'fB')?.fillImage).toBeUndefined()
    expect(byId(json, 'lib-uuid-1_fillImage')?.frameRef).toBe('lib-uuid-1')
    expect(refills).toEqual([])
    expect(report).toMatchObject({ photosKept: 0, photosRelinked: 0, photosDropped: 0, customerKept: 2 })
  })

  it('재현 3: 빈 라이브러리 틀(사진 없음)도 고객 요소로 보존(보고 없이 사라지지 않음)', () => {
    const cur = canvas([ws(), bg('bgA'), frame('fA', 100, 100), libFrame()])
    const { json, report } = mergeSkinCanvas(cur, from, to, { templateIds })
    expect(ids(json)).toEqual(['workspace', 'bgB', 'fB', 'lib-uuid-1'])
    expect(report).toMatchObject({ templateRemoved: 2, customerKept: 1, dropped: [] })
  })
})

describe('mergeSkinCanvas — 고객 요소 그룹 자식·clipPath id 충돌', () => {
  it('그룹 자식·clipPath id 가 출력과 충돌하면 그 id 만 새로 받고 참조도 고친다(자신 id 는 유지)', () => {
    const to = canvas([ws(), bg('bg-s'), grid('g-s')])
    const group: Obj = {
      type: 'group', id: 'cg', extensionType: 'clipart',
      objects: [{ type: 'rect', id: 'bg-s' }, { type: 'image', id: 'cg-img', parentLayerId: 'bg-s' }],
      clipPath: { type: 'rect', id: 'g-s-bounds' },
    }
    const { json, report } = mergeSkinCanvas(canvas([ws(), group]), null, to, { createId: seqIds() })
    const out = byId(json, 'cg') as Obj
    const children = out.objects as Obj[]
    // 순회 순서(collectIds 와 같음): clipPath → 그룹 자식
    expect((out.clipPath as Obj).id).toBe('new-1')
    expect(children.map((c) => c.id)).toEqual(['new-2', 'cg-img'])
    expect(children[1].parentLayerId).toBe('new-2')
    expect(report).toMatchObject({ customerKept: 1, customerReissued: 1 })
    // 출력 전체에서 id 중복 없음(그룹 자식·clipPath 포함)
    const all: string[] = []
    const walk = (o: Obj) => {
      if (typeof o.id === 'string') all.push(o.id)
      if (o.clipPath) walk(o.clipPath as Obj)
      for (const c of (o.objects as Obj[] | undefined) ?? []) walk(c)
    }
    objs(json).forEach(walk)
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('mergeSkinCanvas — dryRun · 입력 불변', () => {
  const scenario = () => {
    const cur = canvas([
      ws(830, 630), bg('bg-1'), photo('fa', '/u/a.jpg'), frame('fa', 0, 0), photo('fb', '/u/b.jpg'), frame('fb', 300, 0),
      grid('g1'), text('t1', '김씨네'), text('t9', '없는 자리'), sticker('g-s-bounds'), sticker('st-2'),
    ])
    const from = canvas([ws(), bg('bg-1'), frame('fa', 0, 0), frame('fb', 300, 0), grid('g1'), text('t1', '2027'), text('t9', 'X')])
    const to = canvas([ws(), bg('bg-s'), frame('sa', 0, 0), frame('sb', 300, 0, { width: 180 }), grid('g-s'), text('t1', 'SPRING')])
    return { cur, from, to }
  }

  it('dryRun 보고·refills = 실제 실행의 보고·refills, json 은 null', () => {
    const { cur, from, to } = scenario()
    const dry = mergeSkinCanvas(cur, from, to, { dryRun: true, createId: seqIds() })
    const real = mergeSkinCanvas(cur, from, to, { createId: seqIds() })
    expect(dry.json).toBeNull()
    expect(real.json).not.toBeNull()
    expect(dry.report).toEqual(real.report)
    expect(dry.refills).toEqual(real.refills)
    expect(real.report).toMatchObject({
      photosKept: 1, photosRelinked: 1, photosRefilled: 1, textsMoved: 1, textsDropped: 1,
      gridsRemoved: 1, customerKept: 2, customerReissued: 1,
    })
  })

  it('입력 불변(얕은·깊은 동결) · 출력은 입력과 참조를 공유하지 않는다', () => {
    const { cur, from, to } = scenario()
    const snapshot = JSON.stringify([cur, from, to])
    deepFreeze(cur)
    deepFreeze(from)
    deepFreeze(to)
    const { json } = mergeSkinCanvas(cur, from, to)
    mergeSkinCanvas(cur, from, to, { dryRun: true })
    expect(JSON.stringify([cur, from, to])).toBe(snapshot)
    const outWs = byId(json, 'workspace')
    expect(outWs).toEqual(cur.objects?.[0])
    expect(outWs).not.toBe(cur.objects?.[0])
    expect(byId(json, 'g-s')).not.toBe(to.objects?.[4])
  })

  it('잘못된 입력(objects 없음)도 예외 없이 빈 결과', () => {
    const { json, report } = mergeSkinCanvas({}, null, {})
    expect(json).toEqual({ objects: [] })
    expect(report.customerKept).toBe(0)
  })
})

// ─── §9 R1 특성 테스트 — 기존 템플릿 교체 경로(스킨은 쓰지 않음) ───────────────────

describe('R1 특성 — fabric clone 속성 손실·TemplatePlugin.preserveUserElements 예외(기존 결함 고정)', () => {
  const customProps = { id: 'r1', extensionType: 'frame', frameRef: 'x', parentLayerId: 'x', deleteable: false, lockInfo: { isLocked: true, lockLevel: 'admin' } }

  it('fabric 5.5.2 clone() 은 속성 목록 없이 부르면 id 포함 커스텀 속성을 잃고, extendFabricOption 을 넘기면 보존한다', async () => {
    expect(fabric.version).toBe('5.5.2')
    const rect = new fabric.Rect({ width: 10, height: 10 })
    rect.set(customProps as unknown as Partial<fabric.Rect>)
    const plain = await new Promise<fabric.Object>((resolve) => rect.clone(resolve))
    for (const key of Object.keys(customProps)) expect((plain as unknown as Obj)[key]).toBeUndefined()
    const kept = await new Promise<fabric.Object>((resolve) => rect.clone(resolve, core.extendFabricOption))
    for (const [key, value] of Object.entries(customProps)) expect((kept as unknown as Obj)[key]).toEqual(value)
  })

  it('preserveUserElements: 사용자 요소가 1개 이상이면 TypeError(세미콜론 없는 줄 다음 괄호 식이 호출로 이어짐)', async () => {
    const rect = new fabric.Rect({ width: 10, height: 10 })
    ;(rect as unknown as Obj).isUserAdded = true
    const plugin = Object.create(TemplatePlugin.prototype) as { _canvas: unknown; preserveUserElements: () => Promise<unknown[]> }
    plugin._canvas = { getObjects: () => [rect] }
    await expect(plugin.preserveUserElements()).rejects.toThrow(TypeError)
    plugin._canvas = { getObjects: () => [] }
    await expect(plugin.preserveUserElements()).resolves.toEqual([])
  })

  it('스킨 병합 모듈은 fabric·TemplatePlugin 을 쓰지 않는다(교체 경로와 분리)', () => {
    const src = readFileSync(new URL('./skin.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/from ['"]fabric['"]/)
    expect(src).not.toMatch(/TemplatePlugin|replaceTemplate/)
  })
})
