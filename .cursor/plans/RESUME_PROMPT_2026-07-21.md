# RESUME PROMPT — 2026-07-21 (세션 종료 정본: 15h 장애 복구 → G3 ON → R-44 책등 SSOT 정합 LIVE)

> 이 문서가 **최신 정본**이다. 직전 정본은 `RESUME_PROMPT_2026-07-14.md`(가로형→판형 체계→방향 쌍).
> 작업 기반: **워크트리 `../storige-fix-20260713`**(브랜치 chore/infra-restart-policy-g3 = origin/master **b3e77b8** 동기).
> 메인 체크아웃(storige/)은 여전히 chore/source-exposure-gate + 가이드 미커밋 상태로 무접촉 유지(아래 §2-1).

## 1. 완료·배포된 것 (전부 프로덕션 LIVE)

### 🚨 프로덕션 15시간 장애 발견·복구 + 재발 방지 (036e7c7)
- 07-21 02:51 KST 호스트 재부팅(커널 자동업데이트 176→185) 후 api·worker·mariadb·redis·editor **미복귀**, nginx 재시작 루프 → 17:44 복구까지 ~15h 전면 다운. **원인 = 코어 5서비스에 restart 정책 부재**(모니터링 스택만 unless-stopped).
- 조치: 복구 + compose에 코어 5종 `restart: unless-stopped` + **G3 env 매핑 추가**(아래) → docker inspect 실증. 다운 창(02:51~17:44) 동안 bookmoa발 API 호출 전부 실패했을 것 — bookmoa측 오류로그 원인 참조.

### G3 게이트 ON (WORKER_WIRED_FIXABLE_GATING=true, 프로덕션)
- 선결(§5 회신)은 bookmoa R-19 **종결**(07-14 가로 캔버스 육안 확인)로 기충족 확인.
- **함정 실적발**: `.env`만으론 silent no-op — compose worker environment **매핑 자체가 없었음**(WH-001 전례 동일, 주석 경고까지 있었는데 매핑 부재). 매핑 추가(기본 false) 후 컨테이너 printenv=true 실증. 롤백 = VPS `.env` 플래그 제거 + worker 재생성.

### R-44 책등(세네카) 계산 SSOT 정합 — 전 트랙 LIVE (b3e77b8)
- 발단: bookmoa R-44 작업지시(`HANDOFF_bookmoa_spine_calc_2026-07-21.md`) — 무선(youshindang)/양장(mybookmake) 공식·두께표 이식 요청.
- **라이브 결함 실확정 2건**: ① 구 `/products/spine/calculate`가 한글 지종명 미해석 → bookmoa validate.js spine 보강이 **404→catch 무음 실패 중**이었음 ② Bull에 raw DTO 탑재 → site-default 머지·주입값이 워커에 미전달(백로그 "머지 미적용 의심" 실확정).
- 구현(4렌즈 정찰 워크플로 → 설계 → C0~C3):
  - **C0 packages/types `spine-calc.ts`**: SSOT 자구 이식(무선 홀수+1·round2·무마진 / 양장 toFixed3→ceil+합지4+min8 — `hardcoverSpineRaw` 산술 코어 단일화), 두께표 무선29+양장35+aliases, 싸바리 전개 산식(`hardcoverCoverSpreadFromSpine`). API·워커·Track C가 이 모듈만 import(기하 정본 공유).
  - **C1 api**: paper_types v2 컬럼 additive(마이그레이션 `20260721_add_paper_type_spine_v2.sql` — **프로덕션 적용·시드 64종 생성 확인**), spine.service **binding별 v2 분기 + 지종 해석 사다리**(code→alias→정규화, binding-aware 우선 — "미색모조80"+perfect가 양장행에 걸려 v1 오폴백하는 갭 차단), legacy 8코드는 v1 유지(하위호환).
  - **C2 api**: createValidationJob **서버 spine 재계산 주입**(cover+perfect/hardcover+paperType 시 fail-closed 덮어쓰기, clientSpineWidthMm 보존·불일치 warn 계측, v1/미해석은 SOFT 클라값 유지) + **Bull 머지본 탑재**.
  - **C3 worker**: validateSpine 재설계 — `resolveExpectedSpine` 단일 해석기(게이트=폭결정 동일 소스 불변식), **양장 싸바리 전개 기대치**((W+8)×2+spine+40 × (H+8)+40), 높이 축 검증, 표지 SIZE_MISMATCH/BLEED_MISSING **이중발행 해소**(콜사이트 게이트 — validatePageSize 본문 무접촉·48케이스 계약 보존), details `{expectedMm,actualMm,axis,toleranceMm}`, 오차 env 파라미터화(현행 2mm 유지)+상한 클램프(MAX 5).
- **적대검증 4렌즈(23발견→CONFIRMED 16) 전량 수정**: major 4 = 양장 paperThickness 폴백 무선식 확정오탐 / spine 대체 표지 허위 BLEED_MISSING(extendBleed 오발화 루프 위험) / spineToleranceMm 무상한 / spineSource 위조. minor 12 = 0.77→0.8 양자화·NaN 게이트 공백·alias tie-break 비결정·시드 부트 크래시·aliases JSON 오염 500 등.
- 게이트: 골든 파리티 21 + api 790/790 + worker 486/486 + spine e2e 28/28 + **라이브 스모크 6/6**(9.6/9.7/0.77/14/8 v2 + legacy 10.5 v1) + editor·admin Vercel Ready.
- **bookmoa 회신문 작성 완료**: `PROMPT_bookmoa_spine_calc_reply_2026-07-21.md`(§4-C 4항목 + SPINE_SIZE_MISMATCH details 계약 + 미매핑 지종 목록 + 권장 1건: orderOptions.paperType 병기) — **오너가 bookmoa 세션에 전달**.

### 기타
- 병행 세션 미푸시 docs 커밋(1850b50, WH-001 배너) master 인계(566e5cf).
- 부산물 수정: 워커 jest `@storige/types` 오경로 매핑(잠복 결함).

## 2. 다음 세션이 이어받을 것 (우선순위순)

1. **가이드 배치 오너 결정**: 메인 체크아웃 `docs/PLATFORM_INTEGRATION_GUIDE.md` 미커밋 수정 = 원본(3유형 파트너 가이드)을 **Shopify 최종 설계본으로 통째 대체**하는 내용(16섹션 완결). 권고=`docs/SHOPIFY_INTEGRATION_GUIDE.md` 분리 커밋+원본 유지(파트너 참조 삭제 방지). HTML 트윈 미제작. compose-mixed @Public 서술은 동결 계약이라 신규 노출 아님.
2. **bookmoa 회신 후속**: ① 미매핑 지종 두께 회신 오면 시드 추가(D-6) ② validate.js `orderOptions.paperType` 병기 여부 ③ 허용오차 2단계 승격(관찰 후 env `SPINE_TOLERANCE_MM_PERFECT=1.0/_HARDCOVER=1.5`) — [spine-inject]·[spine] warn 로그가 계측.
3. **트랙 C(표지 spread 방향 파생)**: 착수 조건(책등 기하 정본) **이번에 충족** — `@storige/types` spine-calc 모듈 공유로 설계노트 §3 그대로 진행 가능. A-3 잔여 2건(무선 3mm 미만 책등 텍스트 경고·책등 세이프존 inset)도 이 트랙에 편입.
4. **G3 관찰**: FIXABLE→실거부 전환 모니터링(worker 로그), bookmoa 고지문은 NOTICE_bookmoa_autofixable_gating_2026-07-11 기전달.
5. 보안 후속·백로그: RESUME_2026-07-14 §2-4·§2-5 그대로(3포트 루프백은 "bookmoa 직결 아님" 증거 확보됨 — SESSION_NOTE_2026-07-14 §4).

## 3. 환경·함정 (추가분만 — 기존은 2026-07-14 정본 §3 유지)

- **compose env 매핑 함정 재확인**: worker 신규 env는 `.env`+compose environment 매핑 **둘 다** 필요(이번 G3 실적발, WH-001 전례). 이제 코어 서비스 restart: unless-stopped — 재부팅 후 자동 복귀.
- **VPS는 이제 master(b3e77b8) 동기** — Stage3/4 트랙 코드도 함께 배포됨(examples/sdk는 무실행 코드).
- 워커 spine 검증 불변식: 게이트(hasSpineExpectation)와 폭 결정(resolveExpectedSpine)은 **단일 함수** — 한쪽만 고치면 표지 검증 전무 공백 발생. spineSource/clientSpineWidthMm 은 서버 전유(injectServerSpine 선소독).
- zsh 단어분할(unquoted 변수 미분할)·python urllib SSL(→curl) — 스모크 스크립트 함정.
