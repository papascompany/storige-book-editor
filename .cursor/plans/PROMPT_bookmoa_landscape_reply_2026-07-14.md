# [Storige → bookmoa 세션] R-13 가로 templateSetId 회신 — 연결·검증 작업 요청 (v2, 2026-07-14)

Storige가 HANDOFF_bookmoa_landscape_templateset_2026-07-14.md §4 요청에 회신한다.
아래 내용만으로 작업을 완결하라(자기완결 프롬프트 — 다른 대화 컨텍스트 불필요).
v1 대비 변경: 하드커버 세트 내부 정리가 완료되어 **두 상품 모두 즉시 검증 가능** 상태다.

## 1. 회신된 가로 templateSetId (Storige 생성·정합 검증 완료)

| bookmoa 상품 | 상품 id | 가로 templateSetId (storigeTemplateSetIdLandscape에 입력) |
|---|---|---|
| A4 하드커버 책자 | `mpkte2zbqo5w` | `83e6ec80-482b-4cee-a22b-ce1b08af33e0` |
| 교재 및 부교재 | `noriter-14-교재-및-부교재` | `e66588b2-490b-4fea-ac03-44b76b3fb137` |

두 세트 모두: **active, 판형 297×210mm(가로 오리엔트, 재단 기준), bleed 3mm, book(스프레드) 구성,
가로형 내지 템플릿(297×210) 연결·치수 정합 검증 완료**(2026-07-14, Storige 정합 가드 기준 '재단 일치').
세로판(f0335fda / a2cc2939)도 동일 기준 정합 상태다.

## 2. 할 일

1. 상품편집기(`src/admin/ProductEditor.jsx` '🔄 가로 templateSetId' 입력란, 저장 필드
   `product.storigeTemplateSetIdLandscape`)에 위 두 ID를 각각 입력·저장한다.
   (운영자 수동 입력이 기본 경로 — 세션이 DB/시드로 처리한다면 동일 필드에 기입)
2. 수용 기준 검증(핸드오프 §5 왕복) — **두 상품 모두** 진행:
   a. 고객 화면에서 각 상품 **가로형 토글** 선택 → "셀프편집하기" → 편집기가 **가로 캔버스(297×210)** 로 열리는지.
   b. 가로 편집 완료 → 표지/내지 PDF 합성 → 주문 항목 박제까지 기존 세로 플로우와 동일하게 동작하는지.
   c. 재편집(sessionId 재진입) 시에도 가로 캔버스 유지되는지.
   d. (내지 PDF 첨부 상품인 경우) 가로 재단(297×210) 파일 업로드 → 정상 통과 + 도련 자동 삽입(303×216)되는지.
3. 검증 결과(성공/실패, 스크린샷 또는 재현 URL/파라미터)를 Storige로 회신.

## 3. 알아둘 Storige 측 동작 (2026-07-13~14 배포분 — bookmoa 코드 변경 불필요)

- **스왑 정규화 안전망**: embed에 넘기는 width/height가 templateSet 판형과 정확히 W↔H 스왑
  관계면 Storige 서버가 검증 기준을 자동 정합시킨다. 현행 bookmoa 계약(가로 선택 시 스왑 치수
  전달, `src/lib/size-dims.js orientDims`)과 충돌 없음 — 원칙은 오리엔트 전달(정규화 발생은
  Storige warn 로그로 계측, 로그 소멸=교정 완료 상호확인).
- **ORIENTATION_MISMATCH 경고(비차단)**: 업로드 PDF 페이지 방향이 상품 방향과 다르면 검증
  결과에 경고 포함 — 주문 차단 아님. 고객 노출 문구는 bookmoa 재량.
- **판형 규격표는 Storige admin 설정(판형 프리셋)으로 정본화**됨(A4/A5/B5/46배판/16절/B6/정사각,
  재단+사방3mm) — 전달 계약은 기존 NOTICE_bookmoa_inner_pdf_size_spec_2026-07-14 그대로 유효.
- (예고·현재 작업 중) Storige에 **방향 쌍(세로↔가로 세트 페어링) 관리**가 도입되는 중 —
  장기적으로 세로 ID 하나로 가로판 자동 resolve 계약이 가능해질 수 있다. 현 시점 bookmoa 측
  변경 사항 없음(두 ID 슬롯 방식 그대로).

## 4. 알려진 잔여 (Storige 측 — bookmoa 작업·검증 실패 사유 아님)

- 가로 세트의 **표지 아트워크(디자인)는 아직 빈/기초 상태** — 표지 가로 레이아웃 저작은 Storige
  잔여 작업(하드커버 표지=책등·싸바리 규격 트랙 포함). §2-b 검증에서 표지가 비어 있어도
  파이프라인(합성·박제) 동작이 정상이면 합격이며, 표지 디자인 완성도는 합격 기준이 아니다.
- 검증 중 이상(캔버스 세로로 열림·SIZE_MISMATCH 오탐·합성 실패 등) 발견 시 재현
  URL/파라미터·세션 ID와 함께 회신.
