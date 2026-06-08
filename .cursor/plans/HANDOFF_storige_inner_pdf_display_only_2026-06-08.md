# HANDOFF → bookmoa 세션: 내지 PDF "표시전용" 변경 대응 (2026-06-08)

> 전달 대상: bookmoa-mobile / PHP 쇼핑몰 연동 담당 세션.
> 작성: storige 측. 내지 PDF 표시전용 임포지션 도입에 따른 **bookmoa 측 확인/대응 사항** 정리.
> 결론 먼저: **출력 계약(separate 2파일)·웹훅·기존 API는 불변**. 신규 변경은 전부 **추가적(additive)** 이라 즉시 깨지는 건 없음. 단 **내지 인쇄 소스 = 첨부 원본 PDF 그대로** 계약을 재확인하고, 곧 추가될 admin 토글을 인지할 것.

---

## 1. 무엇이 바뀌었나 (storige 측, 일부 배포됨)

storige 편집기에 **"내지 PDF 표시전용 임포지션"** 도입 중. 고객이 책/스프레드 편집기에서 내지 PDF를 첨부하면:
- 편집기에 **잠금 가이드(배경)** 로 표시됨(`excludeFromExport:true`).
- ⚠️ **최종 내지 인쇄 = 고객이 첨부한 원본 PDF 그대로**. 편집기 캔버스 편집은 내지 인쇄에 **합본되지 않음**.

### 1.1 배포 완료 (2026-06-08, api+worker 라이브)
- 신규 워커 잡 `RENDER_PAGES` + `@Public POST /api/worker-jobs/render-pages` — **편집기 내부용**(가이드 이미지 생성). **bookmoa는 호출 불필요, 무시**.
- `edit_sessions.content_pdf_mode` 컬럼 의미 활성화: `'replace'`(기본/레거시: PDF만 인쇄, 캔버스 편집 배타) | `'underlay'`(표시전용: 가이드+편집허용, 단 인쇄 미반영). NULL=replace.
- 세션 `metadata.contentPdfGuide` 에 가이드 이미지 URL 저장(편집기 내부용).

### 1.2 예정 (편집기/admin 단계, 미배포)
- storige **admin 편집기 세팅에 "PDF첨부 파일 편집 가능/불가" 토글**(templateSet 단위) 추가 예정. '편집 불가' 시 내지 첫 페이지에 안내 레이블.

---

## 2. bookmoa 측 확인/대응 사항

### ✅ T1 (필수·확인) — 내지 인쇄 소스 = 첨부 원본 PDF
- 내지 PDF가 첨부된 주문은 **고객 업로드 원본 PDF를 변형 없이** 내지로 인쇄해야 함.
- 스프레드 책은 이미 **separate 2파일(cover.pdf + content.pdf)** 강제이고, content.pdf = 첨부 원본(워커가 바이트 머지만, 캔버스 합성 없음). → **현 동작과 동일**. 바뀐 건 "편집기에서 가이드로 보여줄 뿐 인쇄엔 영향 없음"이 **공식 계약화**된 것.
- 원본 다운로드는 기존 `GET /api/files/{id}/download/external` (STORIGE-ANSWER-E4, 완료) 그대로 사용. **새 엔드포인트 불필요**.
- **확인 요청**: bookmoa 산출물 처리에서 내지 소스가 (편집결과가 아닌) **첨부 원본**으로 가는지 1회 점검.

### ℹ️ T2 (인지) — 세션 페이로드의 `contentPdfMode`
- edit session 조회 시 `contentPdfMode` 필드가 보일 수 있음('replace'/'underlay'/null). bookmoa가 **세팅할 필요 없음**(편집기/storige가 관리). 파싱 시 무시 가능, 단 미지 필드로 깨지지 않게 관용 처리.

### ⏳ T3 (예정 조율) — admin "PDF첨부 편집 가능/불가" 토글
- storige admin templateSet에 `contentPdfEditable`(가칭) 토글이 곧 추가됨.
- **질문**: bookmoa 상품 설정에서 "내지 편집 가능 여부"를 노출/제어하는가? 그렇다면 storige templateSet의 이 값과 **매핑 일관성**이 필요. (편집 자체는 storige admin에서 설정하므로, bookmoa는 인지만 해도 무방할 수 있음 — 상품-템플릿셋 매핑 구조에 따라 판단.)
- 배선 완료 시 별도 HANDOFF로 필드명·기본값 확정 통보 예정.

### 🚫 변경 없음 (회귀 보호)
- compose-mixed/synthesize 출력 계약(separate/content-only/single), 웹훅 페이로드, 기존 검증/업로드/세션 API **모두 불변**.

---

## 3. 한 줄 요약
> 내지 PDF는 이제 "편집기에선 가이드로 보이지만 인쇄엔 첨부 원본 그대로" — bookmoa는 **내지=첨부원본 1회 확인(T1)** + **admin `contentPdfEditable` 토글 인지(T3)** 만 하면 됨. 깨지는 변경 없음.
