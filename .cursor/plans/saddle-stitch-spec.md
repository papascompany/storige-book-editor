# Saddle Stitch (중철) 표지 펼침면 합성 spec — P4 v1

> **버전**: v1 (2026-04-29)
> **범위**: 표지(cover) 펼침면 2-up imposition 만. saddle stitch 페이지 재배열은 추후 고객 요청 시 별도 작업.

## 적용 조건
- `bindingType === 'saddle'`
- 다른 binding (`perfect`, `hardcover`, `spring`, `spiral` 등)은 본 spec 적용 안 함 → 기존 흐름 유지

## 입력
| 파일 | 페이지 수 | 의미 |
|---|---|---|
| `cover.pdf` | 4 (예상) | 사용자가 편집한 표지 4면. 페이지 순서: `[p1=앞표지, p2=앞표지 안쪽, p3=뒷표지 안쪽, p4=뒷표지]` (책 페이지 순서 기준) |
| `content.pdf` | N | 본문 N개 페이지 (단일 페이지) |

## 출력
| 파일 | 페이지 수 | 내용 |
|---|---|---|
| `cover.pdf` (새로 생성) | 2 | **펼침면 2-up**<br>p1 (외부) = `[뒷표지 \| 앞표지]` = `[input.p4 \| input.p1]`<br>p2 (내부) = `[뒷표지 안쪽 \| 앞표지 안쪽]` = `[input.p3 \| input.p2]` |
| `content.pdf` (변경 없음) | N | 입력 그대로 단일 페이지 그대로 결합. reorder/imposition 없음. |

## 출력 페이지 크기
- 입력 페이지 너비/높이를 W, H 라 할 때
- 출력 펼침면 페이지 = W*2 가로 × H 세로 (좌우로 두 페이지를 붙임)
- spine 폭 0 (saddle stitch는 스테이플 묶음, 별도 spine 폭 무시)

## 알고리즘 (의사코드)

```ts
function composeSaddleCover(inputCoverPdf, outputPath) {
  const doc = PDFDocument.load(inputCoverPdf);
  const pageCount = doc.getPageCount();

  // 폴백: 4페이지가 아니면 입력 그대로 복사 (warning 로그)
  if (pageCount !== 4) {
    logger.warn(`saddle cover expected 4 pages, got ${pageCount}; copy as-is`);
    fs.copyFile(inputCoverPdf, outputPath);
    return;
  }

  const [front, insideFront, insideBack, back] = doc.getPages();
  const W = front.getWidth();
  const H = front.getHeight();

  const out = PDFDocument.create();
  const [eFront, eInsideF, eInsideB, eBack] = out.embedPdf(doc, [0, 1, 2, 3]);

  // p1 외부면 = [뒷표지 | 앞표지]
  const outerSheet = out.addPage([W * 2, H]);
  outerSheet.drawPage(eBack,  { x: 0, y: 0, width: W, height: H });
  outerSheet.drawPage(eFront, { x: W, y: 0, width: W, height: H });

  // p2 내부면 = [뒷표지 안쪽 | 앞표지 안쪽]
  const innerSheet = out.addPage([W * 2, H]);
  innerSheet.drawPage(eInsideB, { x: 0, y: 0, width: W, height: H });
  innerSheet.drawPage(eInsideF, { x: W, y: 0, width: W, height: H });

  fs.writeFile(outputPath, out.save());
}
```

## 폴백 동작 (입력이 4페이지가 아닐 때)
| 입력 페이지 수 | 동작 |
|---|---|
| 1 | 그대로 복사 (단일 표지) |
| 2 | 그대로 복사 (앞+뒤 별도) |
| 3 | 그대로 복사 + warning |
| 4 | **본 spec 적용** (펼침면 2-up) |
| 5+ | 그대로 복사 + warning |

향후 다른 케이스 정책이 정해지면 본 표를 갱신.

## 미구현 / 추후 고객 요청 시 작업
- saddle stitch 페이지 재배열 (16페이지 책 → `[16,1,2,15,...]` 표준 imposition)
- 본문 펼침면 2-up 합성 (현재는 단일 페이지 그대로)
- A4 → A3 가로 또는 다른 인쇄 시트 크기 변환

## 검증 시나리오
1. 더미 4페이지 PDF (각 페이지 표시: 1·2·3·4) 만들어 합성 호출
2. 출력 PDF가 정확히 2페이지인지 확인
3. p1 좌측 = 입력 p4 (뒷표지)
4. p1 우측 = 입력 p1 (앞표지)
5. p2 좌측 = 입력 p3 (뒷표지 안쪽)
6. p2 우측 = 입력 p2 (앞표지 안쪽)
7. 페이지 크기: W*2 × H

## 운영 정합
- bindingType: `'perfect'`, `'hardcover'`, `'spring'` 등은 변경 없음
- bindingType: `'saddle'`만 위 spec 적용
- 변경 영향 범위: `apps/worker/src/services/pdf-synthesizer.service.ts:257-261` (TODO 영역)
