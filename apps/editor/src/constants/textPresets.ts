/**
 * 텍스트 프리셋 정의 — S-E3 (F5 스타일 3종 + F6 곡선 4종)
 *
 * 프리셋은 선언적 데이터로만 정의한다(로직 하드코딩 금지 — 추후 library API 이관 가능 형태).
 * 폰트는 지정하지 않으면 삽입 측의 기본 폰트(기보유 폰트 목록의 Noto Sans KR)를 쓴다 —
 * 폰트 목록은 런타임(API) 로드라 여기서 임의 폰트를 박으면 미로드 폰트 참조가 된다.
 *
 * 크기는 pt 고정이 아니라 워크스페이스 짧은 변 대비 비율(sizeRatio)이다 —
 * 명함부터 포스터까지 판형 무관 일관 비율(AppText 기본 텍스트 0.1 전례).
 */

export interface TextStylePresetDef {
  id: string
  label: string
  /** 워크스페이스 짧은 변 대비 글자 크기 비율 */
  sizeRatio: number
  fontWeight?: 'normal' | 'bold'
  /** 선택 폰트 — 미지정 시 삽입 측 기본 폰트 */
  fontFamily?: string
  /** fabric charSpacing (1/1000 em) */
  letterSpacing?: number
  lineHeight?: number
  sampleText: string
}

export const TEXT_STYLE_PRESETS: TextStylePresetDef[] = [
  {
    id: 'title',
    label: '제목',
    sizeRatio: 0.1,
    fontWeight: 'bold',
    sampleText: '제목을 입력하세요',
  },
  {
    id: 'subtitle',
    label: '부제목',
    sizeRatio: 0.065,
    fontWeight: 'normal',
    sampleText: '부제목을 입력하세요',
  },
  {
    id: 'body',
    label: '본문',
    sizeRatio: 0.04,
    fontWeight: 'normal',
    lineHeight: 1.3,
    sampleText: '본문을 입력하세요',
  },
]

export interface CurveTextPresetDef {
  id: string
  label: string
  pathType: 'arc' | 'wave'
  direction: 'upward' | 'downward'
  /** arc 전용 — 호 각도(도). 180=반원, 320≈원형 */
  arcDeg?: number
  /** 워크스페이스 짧은 변 대비 글자 크기 비율 */
  sizeRatio: number
  sampleText: string
}

/** 곡선 프리셋 4종: 위 아치 / 아래 아치 / 웨이브 / 원형 */
export const CURVE_TEXT_PRESETS: CurveTextPresetDef[] = [
  {
    id: 'arc-up',
    label: '위 아치',
    pathType: 'arc',
    direction: 'upward',
    arcDeg: 180,
    sizeRatio: 0.06,
    sampleText: '곡선 텍스트',
  },
  {
    id: 'arc-down',
    label: '아래 아치',
    pathType: 'arc',
    direction: 'downward',
    arcDeg: 180,
    sizeRatio: 0.06,
    sampleText: '곡선 텍스트',
  },
  {
    id: 'wave',
    label: '웨이브',
    pathType: 'wave',
    direction: 'upward',
    sizeRatio: 0.06,
    sampleText: '곡선 텍스트',
  },
  {
    id: 'circle',
    label: '원형',
    pathType: 'arc',
    direction: 'upward',
    arcDeg: 320,
    sizeRatio: 0.05,
    sampleText: '동그란 곡선 텍스트',
  },
]

/**
 * 프리셋 글자 크기(px) — 워크스페이스 짧은 변 × 비율, 최소 12px.
 * (AppText 기본 텍스트와 동일 규약)
 */
export function presetFontSize(
  workspaceWidth: number,
  workspaceHeight: number,
  sizeRatio: number
): number {
  const baseLength = Math.min(workspaceWidth, workspaceHeight)
  return Math.max(12, Math.round(baseLength * sizeRatio))
}
