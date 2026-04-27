---
name: cover-edit-modes
description: 표지(cover) 편집 유형별 view & edit 화면 표시 방식 정리. 펼침면/분할면/단면/wing 포함 표지/spine 포함 등 케이스별 캔버스·툴·네비 분기.
model: sonnet
---

# 12. Cover Edit Modes (D4 후속)

## 컨텍스트

D4 첫 단계(이번 진행분)에서는 다음만 적용:
- 책자(BOOK) + 표지(COVER) 있는 템플릿 → 표지 → 내지 1, 2, ... 순차 페이지 네비게이션
- 우측/하단 토글, PC/모바일 반응형

이 후속 에이전트(12)는 **표지 편집의 다양한 모드를 정리하고 view/edit을 분기 적용**합니다.

## 현재 데이터 모델 (참고)

`packages/types/src/index.ts`:

```ts
export enum TemplateType {
  WING = 'wing',     // 날개
  COVER = 'cover',   // 표지
  SPINE = 'spine',   // 책등
  PAGE = 'page',     // 내지 일반
  SPREAD = 'spread', // 펼침면
}

export type EditorMode = 'single' | 'spread' | ... // editor_mode 컬럼

export type TemplateSetType = 'book' | 'leaflet' | ...
```

## 표지 편집 시나리오

| # | 케이스 | 캔버스 표시 | 페이지 네비 라벨 | 비고 |
|---|--------|-------------|------------------|------|
| 1 | 단면 표지 (COVER 1장) | 단일 캔버스 | "표지" | 가장 단순 |
| 2 | 펼침면 표지 (SPREAD type) | 좌(뒤표지) + 책등 + 우(앞표지) 펼친 한 화면 | "표지 (펼침면)" | spreadConfig 필요 |
| 3 | 분할 표지 (앞+뒤 각각 COVER, 책등 SPINE 별도) | 페이지마다 따로 편집, 미리보기는 합쳐서 | "앞표지" / "뒤표지" / "책등" | 인쇄 시 합본 |
| 4 | 날개 포함 (WING + COVER + WING) | 펼침면 + 좌우 날개 | "표지 (날개 포함)" | 양장본 등 |
| 5 | 표지 없음 | 표시 안 함 | "1쪽"부터 시작 | LEAFLET 등 |

## 구현 단계

### A. 데이터 진단 함수 (utility)
```ts
// apps/editor/src/utils/coverMode.ts
export type CoverMode = 'none' | 'single' | 'spread' | 'split' | 'spread-with-wings'

export function detectCoverMode(pages: EditPage[]): CoverMode {
  const hasSpread  = pages.some(p => p.templateType === 'spread')
  const hasCover   = pages.some(p => p.templateType === 'cover')
  const hasWing    = pages.some(p => p.templateType === 'wing')
  const coverCount = pages.filter(p => p.templateType === 'cover').length

  if (!hasCover && !hasSpread) return 'none'
  if (hasSpread && hasWing)    return 'spread-with-wings'
  if (hasSpread)               return 'spread'
  if (coverCount >= 2)         return 'split'
  return 'single'
}
```

### B. 라벨 생성기
```ts
export function getPageLabel(page: EditPage, allPages: EditPage[], coverMode: CoverMode): string {
  if (page.templateType === 'cover')  return coverMode === 'split' ? '앞표지' : '표지'
  if (page.templateType === 'spread') return '표지 (펼침면)'
  if (page.templateType === 'spine')  return '책등'
  if (page.templateType === 'wing')   return '날개'
  // 내지: 'PAGE' 만 카운트
  const pageOnly = allPages.filter(p => p.templateType === 'page').sort((a,b) => a.sortOrder - b.sortOrder)
  const idx = pageOnly.findIndex(p => p.id === page.id)
  return idx >= 0 ? `${idx + 1}쪽` : page.id.slice(0, 6)
}
```

### C. 캔버스 표시 모드 분기
- `single`/`split` → 한 페이지 한 캔버스 (현재 동작)
- `spread` → SpreadPagePanel (이미 존재) + 캔버스 좌우 합쳐 표시
- `spread-with-wings` → 좌측 날개, 펼침면, 우측 날개 한 화면 (3개 컴포지트)
- `none` → 표지 없이 1쪽부터

### D. 변경할 파일

- `apps/editor/src/utils/coverMode.ts` (신규)
- `apps/editor/src/components/PageNavigation/BookNavigation.tsx` (D4 첫 단계에서 만들고 12에서 라벨 로직 통합)
- `apps/editor/src/views/EditorView.tsx` (캔버스 분기 통합)
- `apps/editor/src/components/PagePanel/SpreadPagePanel.tsx` (spread-with-wings 확장)

## 우선순위

D4 첫 단계 + P1~P5 + 컷오버까지 끝난 후 적용. 운영 데이터(템플릿셋)가 들어와 분기 케이스가 실제로 발생하기 시작하면 본격 작업.

## DoD

- [ ] `detectCoverMode` + `getPageLabel` 유틸 작성 + 단위 테스트
- [ ] EditorView에서 케이스별 캔버스 모드 분기
- [ ] BookNavigation이 `coverMode`를 받아 라벨/순서 결정
- [ ] 5가지 케이스 모두 시각 검증 (각 케이스용 더미 templateSet 1개씩)
- [ ] 운영 1주 모니터링 무사고
