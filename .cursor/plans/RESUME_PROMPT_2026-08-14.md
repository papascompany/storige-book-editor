# RESUME PROMPT — 2026-08-14 (내지 PDF 첨부 401 조사)

> **이 문서가 최신 날짜 정본이다.** 배경·G8/G9/커버슬롯 구현은 `RESUME_PROMPT_2026-08-13.md`.
> 작성 2026-08-14. 코드 미변경. 조사만.

---

## 판정 (구현하지 않음 — 오너 결정 대기)

스크린샷 `Unauthorized`는 **임포지션이 아니라 인증/워크플로 계약 불일치**.
401을 고쳐도 **표지없음 세트는 앉히기 인덱스 규약이 표지=캔버스0만 가정**해서 화면에 안 앉는다.

| 질문 | 답 |
|---|---|
| 직접 링크(`/?templateSetId=`)라서? | 재현 조건은 맞음. shop-session JWT 없음. 다만 `/`에서 버튼을 켜는 것은 설계. |
| 프런트에서 PDF를 미리 붙여야만? | **아님.** `/embed`+세션이면 에디터 안 첨부가 정본(W1). |
| 워크플로 버그? | **예.** 버튼·업로드는 게스트 허용, `POST /worker-jobs/validate`와 `GET /worker-jobs/:id`는 JWT 필수. |
| 임포지션 근본 결함? | 이번 401의 원인 **아님**. 표지없음+펼침면/낱장의 **2차 결함은 실재**. |

라이브 실측(무인증, 2026-08-14):
- `POST /worker-jobs/validate` → **401 Unauthorized** (스크린샷과 동일)
- `GET /worker-jobs/:id` → **401 Unauthorized**
- `POST /worker-jobs/render-pages` → 404 파일없음 (**인증은 통과**, `@Public`)

## 2026-08-14 브라우저 실측 (정상 경로)

- 스토어 `bookmoa-mobile.vercel.app` 관리자 로그인 상태. 상품 81개 중 **「표지없음」 SKU 0**.
- 상점 정본: `POST /api/storige/shop-session` → `/embed?token=&templateSetId=&orderSeqno=`.
- 게스트 shop-session JWT로 `POST /worker-jobs/validate`: **400(본문 오류) ≠ 401**. 무토큰은 401.
- 같은 JWT로 `/embed` + 표지없음+내지펼침면 세트 오픈: 첨부 버튼 노출, 모달이 페이지수 확인까지 진행(**validate 통과**). 콘솔: member 세션 400 → 게스트 세션 폴백(seqno=0, 예상).
- **수정 방향(확정):** validate를 무인증 공개하지 않는다. `/?templateSetId=` 첨부 버튼은 숨기거나 /embed 안내.

## 2026-08-14 앉히기 기하 (구현, 미커밋)

펼침면: 좌=PDF 2k, 우=2k+1. 워크스페이스=재단 2W. 작업사이즈는 각 trim 중심·원본 mm → 안쪽 블리드가 접힘선에서 2B 중첩. 재단본은 trim 칸 중심(2(W+2B) 반쪽 중심 아님).
단면: 1장=1캔버스, 원본 mm 중앙, 축 독립 늘리기 없음.
파일: `contentPdfSeatLayout.ts` + `contentPdfGuide.ts`. 테스트 31 pass.

---

## 샘플 세트 (표지없음)

- 표지없음+내지펼침면 A4: `54358e2a-0d23-460d-89dc-552ea8af57c6`
- 표지없음+내지낱장 A4: `3e13ef43-03a9-46ae-b3a3-b2d95c1b45fc`
