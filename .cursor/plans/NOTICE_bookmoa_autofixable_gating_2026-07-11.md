# [사전 고지] PDF 검증 autoFixable 정직화 (C+ 게이팅) — bookmoa 전달용 + 내부 활성화 게이트

> 작성 2026-07-11 · Storige worker 변경 (브랜치 `feat/autofixable-wired-gating`)
> **킬스위치 `WORKER_WIRED_FIXABLE_GATING` 기본 OFF — 배포해도 행동 변화 0. 아래 선결 게이트 통과 후 ON.**
> 배경 정본: CTO 리포트 §GAP/§DECISION/§UX (Artifact) + PDF_VALIDATION_GUIDE.md "자동 수정 가능 에러" 갱신본
> 적대검증 리뷰(3렌즈)에서 소비처 flip 2건 적발 → 즉시 ON 이 아니라 킬스위치+선결 게이트 방식으로 확정.

## 무엇이 바뀌나 (ON 시)

검증 결과의 `autoFixable=true` 를 **실제 자동수정 실행기가 존재하는 항목(빈 페이지 추가 = addBlankPages)에만** 부여.
실행 수단이 없는 3개 항목(판형 `SIZE_MISMATCH`·책등 `SPINE_SIZE_MISMATCH`·재단여백 `BLEED_MISSING`)은
`autoFixable=false` 로 내려간다. **fixMethod 필드는 그대로 유지**(향후 실행기 출시 대비 의도 메타데이터).

## 파트너(bookmoa) 관측 가능 변화 (ON 시)

1. **잡 status**: `SIZE_MISMATCH`/`SPINE_SIZE_MISMATCH` 가 **포함된**(단독뿐 아니라
   addBlankPages 에러와 **혼재해도** — `errors.every(autoFixable)` 파생) 검증 잡이
   기존 `FIXABLE` → **`FAILED`** 로 내려간다.
   실측 하한: 현 FIXABLE 잡의 62%(SIZE 단독 50/81) + 혼재 21건 포함 시 **88%**.
   ⚠️ 혼재 잡은 종전엔 FIXABLE 로 d1 모달(빈페이지 추가)이 떴지만, ON 후엔 FAILED —
   **status 로 d1 모달을 트리거하면 혼재 잡에서 모달이 사라진다**(항목별
   `errors[].autoFixable` 게이트라면 무영향). bookmoa 트리거 방식 확인 요망.
2. **항목 플래그**: 위 3개 항목의 `errors[]/warnings[].autoFixable` 이 `false`.
3. **웹훅**: 위 잡들의 `validation.completed` payload status 도 FAILED 로 동행.

## bookmoa 필요 작업 (ON 전)

- **모달 CTA**: 기존 지시문(2026-06-16 HANDOFF §3.4)대로 [자동 보정] 버튼을
  `autoFixable===true` 로 게이트하고 있다면 **코드 수정 불필요** — 실행 불가 항목의 버튼이 자동 소멸.
- **d1 모달 트리거 확인(위 1번)**: status 기반이면 항목 기반(`errors[].autoFixable`)으로 전환 권장.
- **FIXABLE status 별도 소비 로직**(통계·자동 재시도 등)이 있다면 FAILED 이동 반영.
- **권장**: 차단 항목 '해결 방법' 카피 보강 — SIZE_MISMATCH 는 `details.expected.withBleed`
  vs `details.actual`(mm) 표기 + "문서 크기를 OOOmm(재단여백 포함)로 설정 후 다시 내보내기".
  카피 맵 전문은 CTO 리포트 §UX.

## ⚠️ 내부 선결 게이트 (Storige — ON 전 필수, 적대검증 적발분)

| # | 소비처 | 문제 | 상태 |
|---|---|---|---|
| G1 | `apps/editor` ContentPdfAttachModal | 검증 orderOptions.size 가 **A4(210×297) 하드코드** + FIXABLE=첨부허용 소비. ON 시 비-A4 상품의 정상 크기 PDF 가 SIZE_MISMATCH→FAILED→**첨부 전면 차단** | ✅ **해소(2026-07-11)** — templateSet 판형(trimSize prop) 주입 + 폴링 result 이중중첩 파싱 수정(종전 pageCount/issues 항상 undefined 버그 동시 해소). FAILED 시 실제 에러 목록 표시(재업로드 안내) 동작 |
| G2 | `apps/api` 세션 검증 경로 (`worker-jobs.service.ts` updateEditSessionWorkerStatus) | FIXABLE→`VALIDATED`(session.validated 웹훅=주문 진행) 매핑이 ON 시 FAILED→`session.failed`+workerError 로 flip. 생성 PDF 세션의 A4 디폴트·spine 회귀 시 해소 불가 실패 | ✅ **해소(2026-07-11) — 양쪽 다 구현(택일 아님, 역할 상이)**: **G2a** size 폴백(metadata.size 부재 시 A4 대신 templateSet 판형 — 오검증 자체 제거) + **G2b** 세션 한정 FIXABLE 동등 처리(전에러 fixMethod 보유 VALIDATE 잡의 FAILED 를 세션 전이에서 VALIDATED 동등 취급, jobType 게이트 — spine 회귀 등 잔여 케이스 보존). 세션 상태 전이·웹훅 이벤트는 게이팅 ON/OFF 무관 종전 동일(웹훅 payload 내 result.errors[].autoFixable 값만 정직화로 변화) |
| G3 | bookmoa 고지 | 위 "파트너 관측 변화" 회신 수령 | ⏳ **잔여** — 회신 후 ON |

## 변하지 않는 것

- **킬스위치 OFF(기본·현 배포 상태)**: 전부 레거시와 byte-identical — 스펙으로 잠금.
- ON 이어도: `PAGE_COUNT_INVALID`·`SADDLE_STITCH_INVALID` 의 자동수정(빈 페이지 추가,
  `POST /worker-jobs/fix-pagecount/external`)은 그대로 동작.
- ON 이어도: 검증 규칙 자체(임계값·에러/경고 분류·메시지·isValid)는 전부 불변 —
  **파일의 통과/차단 여부는 안 바뀌고**, '수정 가능' 라벨과 그 파생(status·웹훅 status·세션 상태)만 정직해짐.

## 적용 절차

1. ✅ 킬스위치 OFF 로 배포 — 무변화 (2026-07-11 master 2261df0).
2. ✅ G1·G2 수정 (2026-07-11 — editor 는 Vercel CLI 수동배포, api 는 VPS 수동배포 필요).
3. ⏳ G3 bookmoa 회신.
4. VPS `.env` 에 `WORKER_WIRED_FIXABLE_GATING=true` + worker 재시작. 롤백 = env 제거 후 재시작(즉시).
