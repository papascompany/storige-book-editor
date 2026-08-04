/**
 * 곡선(패스) 텍스트 유틸 — S-E3 (2026-08-04)
 *
 * fabric 5.x text-on-path 를 사용하는 곡선 텍스트의 패스 수식·적용 로직 단일 정본.
 * TextEffect(후편집)와 AppText 곡선 프리셋(삽입)이 공유한다 — 수식을 한 곳에 두어
 * 삽입/후편집 간 결과가 어긋나지 않게 한다.
 *
 * 직렬화 계약:
 * - path/pathSide/pathAlign/pathStartOffset 은 fabric Text 의 additionalProps 라
 *   toObject 에 항상 포함(화이트리스트 불필요).
 * - curvePathType/curveRadius/curveDirection/curveArcDeg/extensionType 은
 *   core.extendFabricOption 등재 필수(누락 시 저장 왕복에서 침묵 소실 — L7 전례).
 */

import type { fabric } from 'fabric'
import { getFabric, createPath } from './factory'

export type CurvePathType = 'arc' | 'wave'
export type CurveDirection = 'upward' | 'downward'

/** Flip = fabric pathSide 전환 (right = 패스 반대편, 문자 역순 순회 + 180° 회전이라 읽는 방향 유지) */
export type CurveFlip = 'left' | 'right'

export interface CurveParams {
  /** 패스 모양. arc = 원호(기존 06-02 곡선), wave = 사인형 곡선(신규) */
  pathType: CurvePathType
  /**
   * arc: 반지름(px). wave: 진폭(px).
   * 기존 직렬화 속성 curveRadius 를 재사용해 신규 속성을 최소화한다.
   */
  radius: number
  /** arc: 위/아래 호. wave: 위상(산 먼저/골 먼저) */
  direction: CurveDirection
  /** arc 전용 — 호 각도(도). 180=반원, 320≈원형. wave 에서는 무시 */
  arcDeg?: number
  /** wave 전용 — 패스 폭(px). 보통 텍스트 픽셀 폭. arc 에서는 무시 */
  width?: number
}

/**
 * 원호 패스 데이터 생성 (TextEffect 06-02 수식 이동 — 동작 불변).
 * deg=180 반원. 상단(upward)은 sweep 1, 하단(downward)은 sweep 0.
 */
export function generateArcPathData(r: number, reverse: boolean = false, deg: number = 180): string {
  const d = Math.max(10, Math.min(deg, 350))
  const h = (d / 2) * (Math.PI / 180)
  const sx = r * Math.sin(h)
  const cy = r * Math.cos(h)
  const largeArc = d > 180 ? 1 : 0
  if (!reverse) {
    // 위쪽 호 (상단 중심)
    return `M ${-sx}, ${-cy} A ${r} ${r} 0 ${largeArc} 1 ${sx}, ${-cy}`
  }
  // 아래쪽 호 (하단 중심)
  return `M ${-sx}, ${cy} A ${r} ${r} 0 ${largeArc} 0 ${sx}, ${cy}`
}

/**
 * 웨이브(1주기 사인형) 패스 데이터 생성 — 신규 (S-E3).
 * 좌→우 진행 S-커브: 산→골(upward 기준). reverse 시 위상 반전(골→산).
 * quadratic 2개로 근사 — getPathSegmentsInfo 가 Q 를 지원한다.
 */
export function generateWavePathData(width: number, amplitude: number, reverse: boolean = false): string {
  const w = Math.max(20, width)
  const a = Math.max(0, amplitude) * (reverse ? -1 : 1)
  const half = w / 2
  // M 시작 → Q(산) 중앙 → Q(골) 끝. 제어점 y = ±2a 로 정점이 대략 ±a 에 오게 한다.
  return `M ${-half} 0 Q ${-half / 2} ${-2 * a} 0 0 Q ${half / 2} ${2 * a} ${half} 0`
}

/** 파라미터 → 패스 데이터 문자열 */
export function generateCurvePathData(params: CurveParams): string {
  if (params.pathType === 'wave') {
    return generateWavePathData(params.width ?? 200, params.radius, params.direction === 'downward')
  }
  return generateArcPathData(params.radius, params.direction === 'downward', params.arcDeg ?? 180)
}

/**
 * 곡선 텍스트용 fabric.Path 생성.
 * 기존 TextEffect 동작 보존: 비가시(fill 없음, strokeWidth 0)·비선택 패스 + segmentsInfo 선계산.
 * (fabric 이 _measureLine 에서 재계산하지만, 기존 코드와 동일하게 선계산해 동작 드리프트를 없앤다.)
 */
export async function createCurveTextPath(
  params: CurveParams,
  options: { width?: number } = {}
): Promise<fabric.Path> {
  const pathData = generateCurvePathData(params)
  const path = await createPath(pathData, {
    id: 'curveText',
    stroke: '#000',
    strokeWidth: 0,
    fill: '',
    selectable: false,
    scaleX: 1,
    scaleY: 1,
    ...(options.width !== undefined ? { width: options.width } : {}),
  })

  const fb = await getFabric()
  if ((fb as any)?.util?.getPathSegmentsInfo) {
    ;(path as any).segmentsInfo = (fb as any).util.getPathSegmentsInfo((path as any).path)
  }
  return path
}

/**
 * 텍스트 객체에 곡선 적용 — path 생성 + 직렬화 속성 세팅.
 * 호출 측이 히스토리 트랜잭션(offHistory/onHistory)과 renderAll 을 관리한다
 * (기존 TextEffect 의 관리 방식 보존).
 */
export async function applyCurveToText(
  obj: fabric.Object,
  params: CurveParams,
  options: { charSpacing?: number; flip?: CurveFlip } = {}
): Promise<void> {
  const textWidth = ((obj as any).width || 0) * ((obj as any).scaleX || 1)
  const path = await createCurveTextPath(params, { width: textWidth })

  obj.set({
    path,
    extensionType: 'curveText',
    curvePathType: params.pathType,
    curveRadius: params.radius,
    curveDirection: params.direction,
    curveArcDeg: params.pathType === 'arc' ? (params.arcDeg ?? 180) : undefined,
    ...(options.charSpacing !== undefined ? { charSpacing: options.charSpacing } : {}),
    ...(options.flip !== undefined ? { pathSide: options.flip } : {}),
  } as Partial<fabric.Object>)
}

/** 곡선 제거 — TextEffect removeCurve 와 동일 계약 (속성 초기화, 렌더는 호출 측) */
export function removeCurveFromText(obj: fabric.Object): void {
  obj.set({
    path: null,
    charSpacing: 0,
    extensionType: undefined,
    curvePathType: undefined,
    pathSide: 'left',
  } as unknown as Partial<fabric.Object>)
}

/**
 * 텍스트가 호 각도(deg)를 가득 채우는 반지름.
 * 호 길이 = r × rad 이므로 r = 텍스트폭 / rad. TextEffect calcRadius(180° 고정 · /π)의 일반화.
 */
export function radiusForTextOnArc(textWidth: number, arcDeg: number = 180): number {
  const rad = (Math.max(10, Math.min(arcDeg, 350)) * Math.PI) / 180
  return Math.max(50, textWidth / rad)
}
