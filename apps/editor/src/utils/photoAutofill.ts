/**
 * 포토북 자동편집(autofill) — EXIF 추출 + 정렬 모델 (Phase 2, 2026-06-23).
 *
 * CTO 결정(GPS 기준 질문): **GPS 는 유일 기준이 아니다.** 정렬 기준 4종 중 기본은 '날짜'(촬영일시)이며,
 * GPS 는 'location'(장소별) 모드 한정으로 **근접 군집(clustering) + GPS 없는 사진 날짜 폴백**으로 쓴다.
 * 이유: GPS 는 자주 결손(실내/스캔/구형/프라이버시)되고, 위/경도를 선형 정렬하는 건 무의미하며,
 * 포토북은 본질적으로 시간순 이야기라 날짜가 가장 안정적·자연스럽다.
 *
 * 이 모듈은 순수 함수(정렬) + EXIF 파서 래퍼다. 실제 프레임 배치(레이아웃)는 별도(Phase 3).
 */
import type { ExternalPhoto, PhotoSortMode } from '@storige/types'

/** 장소 군집 임계(km). 이 거리 이내면 같은 '장소'로 묶는다. */
export const LOCATION_CLUSTER_KM = 1.5

// ────────────────────────────────────────────────────────────────────────────
// EXIF 파싱 (exifr, 브라우저)
// ────────────────────────────────────────────────────────────────────────────

export interface PhotoExif {
  takenAt?: string // DateTimeOriginal ISO
  gps?: { lat: number; lng: number }
  orientation?: number
}

/**
 * 이미지(Blob/ArrayBuffer/URL/File)에서 EXIF 의 촬영일시·GPS·orientation 만 경량 추출.
 * 실패/메타 없음 → 빈 객체(throw 안 함). exifr 는 동적 import(번들 분리).
 */
export async function parsePhotoExif(
  input: Blob | ArrayBuffer | string | File,
): Promise<PhotoExif> {
  try {
    const exifr = (await import('exifr')).default
    const out: any = await exifr.parse(input as any, {
      // 필요한 태그만 — DateTimeOriginal/CreateDate + GPS + Orientation
      pick: ['DateTimeOriginal', 'CreateDate', 'GPSLatitude', 'GPSLongitude', 'Orientation'],
      gps: true,
    })
    if (!out) return {}
    const dt = out.DateTimeOriginal ?? out.CreateDate
    const takenAt =
      dt instanceof Date ? dt.toISOString() : typeof dt === 'string' ? dt : undefined
    const lat = out.latitude
    const lng = out.longitude
    const gps =
      typeof lat === 'number' && typeof lng === 'number' && isFinite(lat) && isFinite(lng)
        ? { lat, lng }
        : undefined
    const orientation = typeof out.Orientation === 'number' ? out.Orientation : undefined
    return { takenAt, gps, orientation }
  } catch {
    return {}
  }
}

/**
 * 사진 목록에 EXIF 를 채운다(exifParsed 미완료 + URL 있는 것만, 병렬 한도 제한).
 * 호스트가 takenAt/gps 를 이미 준 경우는 건드리지 않는다(존중).
 */
export async function enrichPhotosWithExif(
  photos: ExternalPhoto[],
  opts: { concurrency?: number; fetchUrl?: boolean } = {},
): Promise<ExternalPhoto[]> {
  const concurrency = opts.concurrency ?? 4
  const result = photos.map((p) => ({ ...p }))
  const targets = result
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !p.exifParsed && (p.takenAt === undefined || p.gps === undefined) && !!p.url)

  let cursor = 0
  async function worker() {
    while (cursor < targets.length) {
      const { p, i } = targets[cursor++]
      try {
        // URL 에서 바이트를 받아 파싱(opts.fetchUrl=false 면 스킵 = 호스트 제공 메타만 사용)
        if (opts.fetchUrl === false) {
          result[i].exifParsed = true
          continue
        }
        const res = await fetch(p.url)
        const buf = await res.arrayBuffer()
        const exif = await parsePhotoExif(buf)
        result[i] = {
          ...result[i],
          takenAt: result[i].takenAt ?? exif.takenAt,
          gps: result[i].gps ?? exif.gps,
          exifParsed: true,
        }
      } catch {
        result[i].exifParsed = true
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker))
  return result
}

// ────────────────────────────────────────────────────────────────────────────
// 정렬 모델
// ────────────────────────────────────────────────────────────────────────────

/** 정렬용 시각: takenAt → uploadedAt → +Infinity(시각 미상은 뒤로). */
function effectiveTime(p: ExternalPhoto): number {
  if (p.takenAt) {
    const t = Date.parse(p.takenAt)
    if (!isNaN(t)) return t
  }
  if (p.uploadedAt) {
    const u = Date.parse(p.uploadedAt)
    if (!isNaN(u)) return u
  }
  return Number.POSITIVE_INFINITY
}

function byTime(a: ExternalPhoto, b: ExternalPhoto): number {
  const ta = effectiveTime(a)
  const tb = effectiveTime(b)
  if (ta !== tb) return ta - tb
  return (a.name ?? a.url).localeCompare(b.name ?? b.url, undefined, { numeric: true, sensitivity: 'base' })
}

function sortByTime(arr: ExternalPhoto[]): ExternalPhoto[] {
  return [...arr].sort(byTime)
}

/** 두 좌표 간 거리(km) — haversine. */
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** GPS 있는 사진을 근접 군집으로 묶는다(greedy: 기존 군집 중심에 임계 이내면 합류, 아니면 신규). */
export function clusterByLocation(
  photos: ExternalPhoto[],
  thresholdKm = LOCATION_CLUSTER_KM,
): ExternalPhoto[][] {
  const clusters: { center: { lat: number; lng: number }; items: ExternalPhoto[] }[] = []
  for (const p of photos) {
    if (!p.gps) continue
    let best: (typeof clusters)[number] | null = null
    let bestD = Infinity
    for (const c of clusters) {
      const d = haversineKm(c.center, p.gps)
      if (d <= thresholdKm && d < bestD) {
        best = c
        bestD = d
      }
    }
    if (best) {
      best.items.push(p)
      // 중심 갱신(증분 평균)
      const n = best.items.length
      best.center = {
        lat: best.center.lat + (p.gps.lat - best.center.lat) / n,
        lng: best.center.lng + (p.gps.lng - best.center.lng) / n,
      }
    } else {
      clusters.push({ center: { ...p.gps }, items: [p] })
    }
  }
  return clusters.map((c) => c.items)
}

/**
 * 자동편집 정렬. 기본 'date'. 결과는 새 배열(원본 불변).
 * location: GPS 군집(군집은 최소 촬영시각순, 내부는 시간순) → GPS 없는 사진은 날짜순 뒤에.
 *           GPS 전무면 전체 날짜 폴백.
 */
export function sortPhotosForAutofill(
  photos: ExternalPhoto[],
  mode: PhotoSortMode = 'date',
): ExternalPhoto[] {
  const arr = [...photos]
  switch (mode) {
    case 'filename':
      return arr.sort((a, b) =>
        (a.name ?? a.url).localeCompare(b.name ?? b.url, undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
      )
    case 'random': {
      // Fisher-Yates 셔플 (런타임 코드 — Math.random 허용)
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
      }
      return arr
    }
    case 'location': {
      const withGps = arr.filter((p) => p.gps)
      const without = arr.filter((p) => !p.gps)
      if (withGps.length === 0) return sortByTime(arr) // GPS 전무 → 날짜 완전 폴백
      const clusters = clusterByLocation(withGps)
      clusters.forEach((c) => c.sort(byTime)) // 군집 내부 시간순
      clusters.sort(
        (c1, c2) =>
          Math.min(...c1.map(effectiveTime)) - Math.min(...c2.map(effectiveTime)),
      ) // 군집은 최소 시각순
      return [...clusters.flat(), ...sortByTime(without)]
    }
    case 'date':
    default:
      return sortByTime(arr)
  }
}
