import { describe, it, expect } from 'vitest'
// eslint no-undef 대응 — 전역 TextEncoder 를 명시 import (사전 존재하던 lint 유일 error 제거)
import { TextEncoder } from 'util'
import type { ExternalPhoto } from '@storige/types'
import {
  sortPhotosForAutofill,
  clusterByLocation,
  parsePhotoExif,
} from './photoAutofill'

const p = (over: Partial<ExternalPhoto>): ExternalPhoto => ({ url: over.name ?? 'x', ...over })

describe('sortPhotosForAutofill', () => {
  it("date(기본): 촬영일시 오름차순, takenAt 없으면 uploadedAt 폴백, 시각 미상은 뒤로", () => {
    const photos = [
      p({ name: 'c', takenAt: '2024-03-10T10:00:00Z' }),
      p({ name: 'a', takenAt: '2024-01-01T08:00:00Z' }),
      p({ name: 'noTime' }), // 시각 미상 → 뒤
      p({ name: 'b', uploadedAt: '2024-02-05T00:00:00Z' }), // takenAt 없음 → uploadedAt 사용
    ]
    const out = sortPhotosForAutofill(photos, 'date').map((x) => x.name)
    expect(out).toEqual(['a', 'b', 'c', 'noTime'])
  })

  it('date: 동일 시각이면 파일명 자연정렬 타이브레이크', () => {
    const t = '2024-01-01T00:00:00Z'
    const out = sortPhotosForAutofill(
      [p({ name: 'img10', takenAt: t }), p({ name: 'img2', takenAt: t })],
      'date',
    ).map((x) => x.name)
    expect(out).toEqual(['img2', 'img10']) // 자연정렬: 2 < 10
  })

  it('filename: 자연 정렬(숫자 인식)', () => {
    const out = sortPhotosForAutofill(
      [p({ name: 'p12' }), p({ name: 'p2' }), p({ name: 'p1' })],
      'filename',
    ).map((x) => x.name)
    expect(out).toEqual(['p1', 'p2', 'p12'])
  })

  it('random: 원소 보존(개수·집합 동일)', () => {
    const photos = [p({ name: 'a' }), p({ name: 'b' }), p({ name: 'c' }), p({ name: 'd' })]
    const out = sortPhotosForAutofill(photos, 'random')
    expect(out).toHaveLength(4)
    expect(new Set(out.map((x) => x.name))).toEqual(new Set(['a', 'b', 'c', 'd']))
  })

  it('location: GPS 군집(군집은 최소시각순·내부 시간순), GPS 없는 사진은 날짜순으로 뒤에', () => {
    const seoul = { lat: 37.5665, lng: 126.978 }
    const busan = { lat: 35.1796, lng: 129.0756 } // 서울과 ~325km → 다른 군집
    const photos = [
      p({ name: 'busan-late', gps: busan, takenAt: '2024-05-02T10:00:00Z' }),
      p({ name: 'seoul-1', gps: seoul, takenAt: '2024-05-01T09:00:00Z' }),
      p({ name: 'busan-early', gps: busan, takenAt: '2024-05-02T08:00:00Z' }),
      p({ name: 'seoul-2', gps: seoul, takenAt: '2024-05-01T11:00:00Z' }),
      p({ name: 'noGps', takenAt: '2024-04-30T00:00:00Z' }), // GPS 없음 → 날짜순 뒤
    ]
    const out = sortPhotosForAutofill(photos, 'location').map((x) => x.name)
    // 서울 군집(최소시각 05-01)이 부산 군집(05-02)보다 앞, 내부는 시간순. GPS 없는 건 맨 뒤.
    expect(out).toEqual(['seoul-1', 'seoul-2', 'busan-early', 'busan-late', 'noGps'])
  })

  it('location: GPS 전무면 날짜로 완전 폴백', () => {
    const out = sortPhotosForAutofill(
      [p({ name: 'b', takenAt: '2024-02-01T00:00:00Z' }), p({ name: 'a', takenAt: '2024-01-01T00:00:00Z' })],
      'location',
    ).map((x) => x.name)
    expect(out).toEqual(['a', 'b'])
  })

  it('원본 배열 불변(순수 함수)', () => {
    const photos = [p({ name: 'b', takenAt: '2024-02-01T00:00:00Z' }), p({ name: 'a', takenAt: '2024-01-01T00:00:00Z' })]
    const before = photos.map((x) => x.name)
    sortPhotosForAutofill(photos, 'date')
    expect(photos.map((x) => x.name)).toEqual(before)
  })
})

describe('clusterByLocation', () => {
  it('근접 좌표는 한 군집, 먼 좌표는 분리', () => {
    const a1 = p({ name: 'a1', gps: { lat: 37.5665, lng: 126.978 } })
    const a2 = p({ name: 'a2', gps: { lat: 37.5670, lng: 126.979 } }) // a1 과 ~100m
    const b1 = p({ name: 'b1', gps: { lat: 35.1796, lng: 129.0756 } }) // 먼 곳
    const clusters = clusterByLocation([a1, a2, b1])
    expect(clusters).toHaveLength(2)
    const sizes = clusters.map((c) => c.length).sort()
    expect(sizes).toEqual([1, 2])
  })
})

describe('parsePhotoExif', () => {
  it('EXIF 없는/깨진 입력 → 빈 객체(throw 안 함)', async () => {
    const garbage = new TextEncoder().encode('not an image').buffer
    const out = await parsePhotoExif(garbage)
    expect(out).toEqual({})
  })
})
