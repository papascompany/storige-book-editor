# RESUME PROMPT — 2026-08-14

> **이 문서가 최신 날짜 정본이다.** 배경·G8/G9/커버슬롯 구현은 `RESUME_PROMPT_2026-08-13.md`.

## 동화책 하드커버 무지 템플릿 (LIVE 2026-08-14)

CSV `/Users/yohan/Desktop/하드커버 템플릿 판형.csv` 7판형 → admin 시스템공유 등록. 코드 변경 없음.

- 카테고리 `동화책` (`DONGHWA`) `b6e1cf5d-e9ca-4f0a-ba56-47f82820f4dc`
- 템플릿 21 (표지펼침면 7 + 내지낱장 7 + 내지펼침면 7), 흰색 빈 캔버스
- 세트 14 (판형×내지낱장/내지펼침면), `photobook`/`book`, `bleedMm=3`, `coverType=hardcover_wrap`, `innerRepeat=cycle`

표지: `conversionMode=flat-spread`, 책등 1.2mm, 캔버스=CSV 표지 펼침면 편집사이즈(싸바리 포함).
내지낱장: 재단 W×H 저장(세트 조립이 판형 일치 강제). 블리드 3mm는 세트 `bleedMm`.
내지펼침면: `innerSpec` 재단 1면, `cutSizeMm=3`, 캔버스 2W×H. CSV 편집사이즈(2W+6)×(H+6)는 작업사이즈.

| 판형 | 재단 | 표지캔버스 | 낱장 세트 | 펼침면 세트 |
|---|---|---|---|---|
| 국판 | 148×210 | 372×286 | d96fef6a | 6cc1979f |
| 46배판 | 190×260 | 436×326 | 972a3696 | 0dfb2eba |
| 국배판 | 210×297 | 496×363 | e0cb34b6 | 6563895e |
| 정사각형 | 210×210 | 496×276 | 5a938fba | 207c458f |
| 국판가로 | 210×148 | 496×214 | 46262d19 | 8bc452ae |
| 46배판가로 | 260×190 | 596×256 | f71d11b6 | fa4de84f |
| 국배판가로 | 297×210 | 670×276 | e7f6b768 | b08624af |

Admin: 템플릿/템플릿셋 목록에서 카테고리 `동화책` 필터.

목록 깨짐 수정 LIVE `0b7630e`: 이름 컬럼 너비 없음 + 고정 컬럼 합이 뷰포트보다 커서 한글이 한 글자씩 세로로 접힘. 이름 360px·말줄임 + `scroll.x`. 템플릿셋/템플릿 목록 동일.

---

## 내지 PDF 첨부 401 조사 (코드 미변경)

> 작성 2026-08-14 오전. 조사만.

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
