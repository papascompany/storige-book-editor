---
name: ruler-style-refresh
description: D3 — 눈금자(Ruler) 비주얼 스타일 리프레시. 밝은 헤더 + 그레이 80% 눈금. 영역 컬러풀 시각화는 유지.
model: sonnet
---

# 11. Ruler Style Refresh (D3, 후속)

## 컨텍스트
- 위치: `packages/canvas-core/src/ruler/ruler.ts` (실제 그리기 로직), `packages/canvas-core/src/plugins/RulerPlugin.ts` (플러그인 래퍼)
- 현재: `backgroundColor: '#fff'` 단순 흰색, 눈금/숫자 색상 별도 정의
- 사용자 의도: 포토샵·일러스트 스타일의 깔끔한 톤 + 영역(safe/bleed) 컬러풀 표시는 유지

## 변경 안

### A. 색상 토큰 정리 (`constants.ts` 또는 `ruler.ts` 옵션)
```ts
export const RULER_COLORS = {
  background:     '#FAFAFA',  // 거의 흰색에 가까운 매우 옅은 회색 (Ps/Ai 분위기)
  tickMajor:      '#525252',  // 그레이 80% 정도 (큰 눈금)
  tickMinor:      '#A3A3A3',  // 그레이 50% (작은 눈금)
  textColor:      '#404040',  // 숫자 라벨
  borderColor:    '#E5E5E5',  // 캔버스 경계선
  // 영역 시각화 (유지)
  safeAreaFill:   'rgba(34,197,94,0.08)',   // 옅은 그린 — safe area
  bleedAreaFill:  'rgba(239,68,68,0.08)',   // 옅은 레드 — bleed
  trimAreaFill:   'rgba(59,130,246,0.06)',  // 옅은 블루 — trim
}
```

### B. 큰 눈금 vs 작은 눈금 구분
- 1cm 단위: 굵은 라인 (1px), 검정에 가까운 그레이
- 1mm 단위: 얇은 라인 (0.5px), 옅은 그레이
- 5mm 단위: 중간 라인

### C. 폰트
- 숫자는 `font: 10px ui-monospace, SFMono-Regular`
- 단위 표시(cm/mm)는 우측 상단 모서리에 작게

### D. 영역 시각화 강도 — **현재 그대로 유지**
- safe/bleed/trim 색상이 옅은 fill로 캔버스 위에 깔리는 동작은 변경하지 않음
- 사용자가 명시: "컬러풀하게 영역을 시각화해서 보여주는 기존 기능은 유지"

## 작업 절차

1. `packages/canvas-core/src/ruler/constants.ts` (없으면 생성)에 `RULER_COLORS` 정의
2. `ruler.ts`의 `_options.backgroundColor`, fillStyle, strokeStyle 호출 위치를 RULER_COLORS 참조로 교체
3. RulerPlugin이 옵션 override 가능하도록 prop 노출 (어드민 미래 설정용)
4. `packages/canvas-core` 빌드 (`pnpm --filter @storige/canvas-core build`)
5. Editor 재빌드 → Vercel preview 확인

## 검증

- 브라우저에서 ruler 표시 ON 시:
  - 배경 매우 옅은 회색
  - 큰 눈금 검정에 가깝게, 작은 눈금 옅게
  - safe/bleed 영역은 색상 그대로 (변경 안 됨)
- 텍스트 가독성, 다크 모드 영향 없는지

## 우선순위

D2-NEW와 함께 **컷오버 후 후속** 트랙. P1~P5 코드 보완이 끝난 뒤 진행.

## DoD

- [ ] RULER_COLORS 정의
- [ ] ruler.ts 색상 참조 일괄 교체
- [ ] canvas-core 빌드 + editor 빌드 OK
- [ ] preview에서 시각 검증 (스크린샷 첨부)
- [ ] 영역(safe/bleed/trim) 동작 회귀 테스트
