# fixtures — 변환 검증용 샘플

여기에 **실제 표지 펼침면 IDML 샘플**을 넣어 주세요. PoC end-to-end(언집→파싱→좌표추출→템플릿 JSON) 검증에 사용합니다.

## 넣어야 할 것

1. `cover-sample.idml` — 표지 펼침면 1종 (앞표지 + 책등 + 뒤표지, 가능하면 날개 포함)
2. (선택) `cover-sample.indd` — INDD 경로 검증용. `scripts/indd-to-idml.jsx` 로 IDML 변환 후 사용.
3. (선택) 링크 이미지가 있다면 `Links/` 폴더째 함께 (없으면 임베드 프록시만 추출됨)

## InDesign 에서 IDML 내보내는 법

- 단건: `파일 > 내보내기 > 형식: InDesign Markup (IDML)`
- 일괄: `scripts/indd-to-idml.jsx` 를 InDesign 에서 실행 → 폴더 내 .indd 전부 .idml 변환

> ⚠️ 이 폴더의 샘플은 고객 디자인일 수 있으므로 커밋하지 마세요(.gitignore 권장).
