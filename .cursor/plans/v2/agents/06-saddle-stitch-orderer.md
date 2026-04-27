---
name: saddle-stitch-orderer
description: P4 — 중철 제본을 위한 페이지 imposition (큰 종이 한 장에 4페이지가 어떻게 배치되는지) 구현.
model: sonnet
---

# 06. Saddle Stitch Orderer (P4)

## 컨텍스트
- 위치: `apps/worker/src/services/pdf-synthesizer.service.ts:259` `// TODO: Implement saddle stitch page ordering`
- 중철 제본: 16페이지 책의 경우 한 장에 (16,1) (2,15) ... 같은 식으로 배치되어야 인쇄 후 접을 때 순서가 맞음.

## 작업
중철 imposition 함수:
```ts
function saddleStitchOrder(totalPages: number): number[][] {
  // [front, back] 4페이지가 한 면 (또는 2페이지가 한 면)
  // totalPages는 4의 배수 (보장 안 되면 빈 페이지 추가)
  const result: number[][] = [];
  let left = 1, right = totalPages;
  while (left < right) {
    // 한 면 앞: [right, left], 뒤: [left+1, right-1]
    result.push([right, left]);
    result.push([left + 1, right - 1]);
    left += 2;
    right -= 2;
  }
  return result;
}
```

`pdf-lib`로 새 PDF 만들 때 위 순서로 페이지 복사:
```ts
const order = saddleStitchOrder(srcDoc.getPageCount());
for (const [a, b] of order) {
  const page = newDoc.addPage();
  // a, b 페이지를 좌우에 배치 (transform로 회전/위치 지정)
}
```

## 검증
- 8페이지 더미 PDF로 합성 → 결과 PDF의 페이지 순서가 [8,1, 2,7, 6,3, 4,5] 패턴
- 실제 인쇄·접지 시뮬레이션 (수동 테스트, 제작팀과 1건 검증)

## 주의
- spread mode와 saddle stitch는 다름 (spread = 좌우 페이지 펼침, 중철 = 인쇄 imposition)
- 페이지 회전 / 마진 / 출혈 처리도 함께
