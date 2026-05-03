# Worker 합성 E2E 검증 보고서 (2026-05-04)

## 요약

Worker synthesize E2E 전체 시나리오 **3/3 통과**.

| 시나리오 | 설정 | 결과 | 페이지 수 | 다운로드 |
|----------|------|------|-----------|----------|
| A — perfect/merged | 표지 1p + 내지 16p | ✅ COMPLETED | 17p | HTTP 200 |
| B — perfect/separate | 표지 1p + 내지 16p | ✅ COMPLETED | 17p + 분리파일 2개 | HTTP 200 |
| C — saddle/4p | 표지 4p + 내지 16p | ✅ COMPLETED | 18p (4→2 스프레드) | HTTP 200 |

## 테스트 환경

- **API**: https://api.papascompany.co.kr/api
- **Worker**: VPS Docker `storige-worker` (Ghostscript 활성)
- **테스트 날짜**: 2026-05-04

## 테스트 파일

| 파일 | 크기/페이지 | 파일 ID |
|------|-------------|---------|
| test-cover-1p.pdf | 426×297mm, 1p | `d12473c6-3a68-49bb-950c-3d2f35b2a22c` |
| test-cover-4p.pdf | A4, 4p (saddle) | `b0ba635c-7ba5-4924-a4d2-233903fc761a` |
| test-content-16p.pdf | A4, 16p | `2dac9a23-6ca3-428c-aeab-13883dd9d3c5` |

## 시나리오 A — perfect/merged

```
입력: coverFileId=d12473c6, contentFileId=2dac9a23, spineWidth=6.0, bindingType=perfect, outputFormat=merged
잡 ID: dcc5d57b-e731-4b25-a943-e7688a7a19c4
결과: COMPLETED, 17p
outputFileUrl: /storage/outputs/dcc5d57b-e731-4b25-a943-e7688a7a19c4/merged.pdf
다운로드: HTTP 200 application/pdf (10786 bytes)
```

**Worker 로그:**
```
[SynthesisProcessor] Processing synthesis job dcc5d57b (queue: 1), format=merged
[PdfSynthesizerService] Ghostscript available: true
[GhostscriptUtil] Merged 2 PDFs
[PdfSynthesizerService] Merged PDF created: 17 pages
[SynthesisProcessor] Synthesis job dcc5d57b completed successfully
```

## 시나리오 B — perfect/separate

```
입력: coverFileId=d12473c6, contentFileId=2dac9a23, spineWidth=6.0, bindingType=perfect, outputFormat=separate
잡 ID: a2ecea7b-d1f4-471e-9e53-e07431115a5e
결과: COMPLETED, 17p
outputFileUrl: /storage/outputs/a2ecea7b.../merged.pdf
outputFiles:
  [cover]   /storage/outputs/a2ecea7b.../cover.pdf
  [content] /storage/outputs/a2ecea7b.../content.pdf
다운로드: HTTP 200 application/pdf (10786 bytes)
```

## 시나리오 C — saddle stitch (4p cover)

```
입력: coverFileId=b0ba635c (4p), contentFileId=2dac9a23, spineWidth=0.0, bindingType=saddle
잡 ID: 2c23a2ca-760a-4a99-a139-b710d05a2efa
결과: COMPLETED, 18p
outputFileUrl: /storage/outputs/2c23a2ca.../merged.pdf
다운로드: HTTP 200 application/pdf (11633 bytes)
```

**Worker 로그 (saddle 분기):**
```
[PdfSynthesizerService] Saddle cover composed: 4 pages → 2 spread pages (1190.5512×841.8898)
[GhostscriptUtil] Merged 2 PDFs
[PdfSynthesizerService] Merged PDF created: 18 pages
```

- 표지 4p → 외부면(뒷|앞) + 내부면(뒷안|앞안) = 2 스프레드 페이지 ✅
- 2 스프레드 + 16 내지 = **18p 합계** ✅

## 검증 포인트 체크리스트

| 항목 | 결과 |
|------|------|
| Worker 로그 합성 분기 진입 | ✅ format=merged/separate, bindingType=perfect/saddle 정상 |
| Ghostscript 활성 | ✅ `Ghostscript available: true` |
| outputFileUrl 형식 | ✅ `/storage/outputs/{jobId}/merged.pdf` 상대 경로 |
| 다운로드 HTTP 200 | ✅ 3/3 |
| 시나리오 A: 17p (1cover+16content) | ✅ |
| 시나리오 B: 17p + 분리파일 2개 | ✅ |
| 시나리오 C: 18p (2spread+16content) | ✅ |
| 임시 파일 정리 | ✅ "Cleaned up N temp files" |

## 발견 사항

### 정상 동작
- Ghostscript 기반 PDF 병합 안정적으로 작동
- outputFileUrl: `/storage/outputs/{jobId}/merged.pdf` 형식 (결함 #13 없음 — API 다운로드 엔드포인트에서 정상 매핑)
- separate 모드: `outputFiles` 배열에 cover/content URL 포함

### 확인된 부수 결함
- **linkTemplateSet API 버그**: `product.templateSetId = id` 할당이 `@RelationId` 데코레이터로 인해 무시됨 → 별도 결함 등록 (spawn_task)

## 결론

Worker synthesize E2E **100% 통과**. 운영 환경에서 3가지 합성 시나리오 모두 정상 동작 확인.
