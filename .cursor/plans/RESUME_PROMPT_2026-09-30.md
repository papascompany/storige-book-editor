# RESUME PROMPT — 2026-09-30 (Storige · CTO 오케스트레이션 · 파트너 협업)

> **이 문서가 최신 날짜 정본이다.** 이 문서에는 새 세션이 바로 일할 수 있도록 현재 상태·채널·대기·결정만 압축했다.
> 상세 이력은 두 곳에 있다.
> - 09-28~09-30: `RESUME_PROMPT_2026-09-28.md` §5 — 결정 근거, 리뷰 반영, 배포 시각
> - 09-12~09-28: `RESUME_PROMPT_2026-09-12.md` §8
>
> 옛 문서와 서술이 충돌하면 이 문서가 우선한다. 다만 이 문서도 2026-09-30 ~04:30Z 시점의 스냅샷이므로 파일·Git·운영 상태로 다시 확인하고 쓴다.

---

## ▶ 새 세션 시작 프롬프트 (그대로 붙여 넣기)

```text
Storige 편집기·워커 개발을 이어서 진행합니다. 이 세션은 CTO(메인 에이전트)로서 서브에이전트 오케스트레이션으로 일하고, 새로 시작한 bookmoa 세션·printy 세션과 크로스세션 메시지로 협업합니다. 모든 사고과정과 대화, 파트너 메시지는 한국어로 씁니다(코드·식별자만 영어).

1) 시작 절차
   - CLAUDE.local.md 는 운영 규칙과 참조 위치만 확인합니다. 비밀값은 출력·복제하지 않습니다.
   - .cursor/plans/RESUME_PROMPT_2026-09-30.md 를 먼저 읽습니다. 경위가 필요할 때만 RESUME_PROMPT_2026-09-28.md §5 와 09-12 §8 을 봅니다.
   - git log --oneline -10 과 git status -sb 를 확인합니다. untracked 타 세션 파일은 건드리지 않고, git add 는 명시 목록으로만 합니다.
   - SSH 가 필요하면 ssh-add -l 을 먼저 확인합니다. 접속 대상은 deploy@(CLAUDE.local.md §1.1) 하나뿐입니다.

2) 파트너 채널 확인 (bookmoa·printy 모두 새 세션으로 교대함)
   - ListAgents 로 활성 세션을 찾습니다. 기준은 이 문서 §2 입니다: bookmoa = cwd ~/Developer/claude/bookmoa-mobile, printy = cwd ~/Developer/claude/printy.
   - 이름만 믿지 않습니다. from 이 uds:/tmp/cc-socks/<PID>.sock 이면 lsof -a -p <PID> -d cwd -Fn 으로 cwd 를 확증합니다. printcard-studio-* 세션은 printy 가 아닙니다.
   - 양사에 "Storige 새 세션 시작 + 이 세션 이름 + 통지 창구 확인" 을 한 줄로 통지하고 ACK 를 요청합니다. 창구가 확정되면 §2 를 갱신합니다.

3) 첫 작업
   - §4 대기 항목 중 회신이 온 것부터 처리합니다. 회신마다 운영 DB·로그와 읽기 전용으로 대조하고, 집계 시각을 UTC 로 적습니다. 결과는 RESUME 에 기록합니다.
   - 그다음 §5 후보 목록을 CTO 관점에서 다시 점검합니다(완료·미완·스테일 구분). 우선순위 3~5개와 오케스트레이션 계획(레인·에이전트 수·검증·배포 순서)을 사용자에게 제안하고, 승인을 받은 뒤 착수합니다.

4) 오케스트레이션 방식
   - 메인(CTO)의 책임: 목표·분해·순서·파일 소유권·통합·최종 판단.
   - 서브에이전트: o5-repo-scout·o5-architect·o5-implementer·o5-test-build·o5-security-reviewer·o5-frontend-qa·o5-final-reviewer 를 필요한 것만 씁니다. 사용자가 ultracode·워크플로를 켜면 Workflow 로 돌립니다.
   - 표준 흐름: 판독(읽기 전용 병렬) → 설계 + 비판 → 구현 레인(파일 배타 소유) → 레인별 2렌즈 리뷰 + 발견별 반박 검증 → 통합 검증(§1 기준선) → 사용자 승인 → 배포(DB 마이그레이션 → master push → api 재생성 + nginx 재시작) → 파트너 통지·ACK → RESUME 기록.
   - 서브에이전트 결과는 주장으로 봅니다. 파일·명령 증거로 확인한 뒤 통합합니다.
   - 파트너 코드가 필요하면 파트너 세션에 판독·사실 질의를 보냅니다. 파트너 저장소를 직접 수정하지 않습니다.

5) 규칙
   - 배포, 운영 DB 쓰기, 파트너 약속(착수 시점), 제품 결정은 사용자 승인 후에만 합니다.
   - 사실 확인 회신(코드·운영 실측)은 바로 보내도 됩니다. 보낸 내용은 RESUME 에 남깁니다.
   - 3-B 운영 원칙을 상시 적용합니다: Storige 관리자가 주문 연결 세션을 수정·완료·삭제하기 전에 해당 파트너에 sessionId 로 사전 통지하고, 작업 뒤 sessionId·새 fileId·UTC 로 사후 통지합니다.
   - 보안 취약점 서술은 교정이 배포되기 전에는 공개 저장소에 커밋하지 않습니다.
   - 커밋 전 gitleaks 를 통과시킵니다. 사용자에게는 결과부터 짧게 한국어로 보고합니다.
```

---

## 1. 현재 라이브 상태 (2026-09-30 04:27Z 실측)

| 구성 | 현재 운영 | 롤백 |
|---|---|---|
| DB | 09-28: `template_sets.page_step`·`pad_to_page_step` / 09-29 09:57Z: `20260929`(운영자 권한·감사 테이블) → `20260930`(sites.edit_retention_days·origin/actor) — 전부 ADDITIVE | 백업 `~/backup-sites-pre-staff-edit-20260929.sql`·`~/backup-template_sets-pre-padstep-20260928.sql`. 컬럼·테이블은 남겨도 무해 |
| api | `47f9a61`(09-29 10:00Z) + nginx 재시작 | `storige-api:rollback-pre-staff-edit` → `rollback-pre-wave2` → `rollback-pre-wave1` → `rollback-pre-padstep` → … |
| worker | Wave 2 이미지(09-29 06:06Z) | `storige-worker:rollback-pre-wave2` → `rollback-pre-wave1` |
| editor | Vercel `3q55ujgns`(`47f9a61`) | `h55s9ttfj` promote |
| admin | Vercel `isxgg1mpv`(`947c9e6`, 09-30 02:38Z) | `hcgs4hn2c` → `purgkt41z` |

- origin/master = 최신 docs 커밋이다. VPS 체크아웃은 `47f9a61` 이다.
  - 그 뒤 커밋(`4caa7cc`·`947c9e6`)은 admin 전용이다. 나머지는 문서 커밋이라 api·worker 배포 대상이 아니다.
- 배포 방식:
  - editor·admin: master push 가 곧 배포다(**push 전 승인**). 문서만 바꾼 push 는 Vercel 빌드가 Canceled 되고 기존 Ready 가 유지된다.
  - api·worker: VPS 에서 수동 배포한다(`CLAUDE.local.md` §6). **api 를 재생성하면 nginx 재시작이 필수**다.
- 런타임: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`.
- 운영 사이트 편집데이터 보관기간: **전 사이트 미설정(NULL)**. 양사 요청으로 이 상태를 유지하며, 설정할 때는 사전에 통지한다.
- 실사용 전 기능(09-30 04:12~04:24Z 실측): 운영자 권한 발급·감사 0행. printy 최근 24h 신규 세션 0건.

### 검증 기준선 (이보다 낮으면 회귀)

| 대상 | 기준 |
|---|---|
| api jest | 99 스위트 / 1659 · tsc 0 |
| worker jest | 23 스위트 / 661 · tsc 0 |
| editor vitest | 79 파일 / 973 · tsc 0 · 빌드 |
| admin vitest | 7 파일 / 128 · tsc·eslint 0 · 빌드 |
| sdk | 12 / 341 |
| canvas-core | 55 / 630 |

- worker `crop-mark-validation.spec` 파리티 1건은 API 스위트와 동시에 돌릴 때만 간헐 실패한다(부하성). 단독 실행하면 통과한다.

---

## 2. 파트너 채널 (09-30 기준 — 양사 모두 막 새 세션으로 교대)

| 파트너 | cwd | 현재 창구(시작 시 ListAgents·lsof 로 재확인) | 상태 |
|---|---|---|---|
| bookmoa | `~/Developer/claude/bookmoa-mobile` | 09-30 04:19Z 에 시작한 bookmoa-mobile 세션(프로세스 95698/95699 · `local_bf71565d-…` · 목록 표시명 「20260930 북모아 관리자 수정 시작」으로 **추정** — 직전 표시명 「북모아 Printable 개발 계속」). 같은 이름의 **Remote Control 세션(오프라인)은 별개**이니 혼동 주의. 옛 창구 local_75d4aefc·local_154c5e2a 는 쓰지 않음 | 운영 new.bookmoa.com = R-206(`5f4a11a`+`a283280` · `65dg8dkm6`). R-202(쪽수 파라미터)·R-205(pageStep=1)·R-206(운영자 대리 편집) 배포. 다음 후보 R-207(bookmoa 내부 보안 수정, Storige 계약 변경 없음) |
| printy | `~/Developer/claude/printy` | 「20260930 Printy CTO 개발 계속」 · `local_6494a1a2-072f-498a-a070-e6133b50c706`(09-30 04:24:48Z 시작, cwd 확증). 옛 local_5ca0cbbf 닫힘 | 운영 `584375a`(R-206 이식). 편집기 상품 4개가 /embed 쪽수 파라미터 전송(16~300·4 / 16~500·2 ×2 / 16~48·4). 실 e2e 보류 |
| 100p Books | `100p_books` 저장소 | 「20260930 100p_books 서브에이전트 진행」(local_69303599) — 기술 통지 창구 | 유형 1(upload·validate·download external만). 편집 세션 0건, 도입 계획 없음 |
| ShareSnap·북모아 메인(PHP)·MD2Books | — | 연락 채널 없음(오너 확인 필요) | — |

- 받은 메시지에 회신할 때는 **`from` 값을 그대로 `to`** 로 쓴다. 세션 이름·id·소켓은 재시작하면 바뀐다.
- 발신 성공은 도달을 뜻하지 않는다. 중요한 통지는 ACK 를 요청하고, 레포(가이드·`docs/partner-notices/`)에도 남긴다.
- 계약 정본:
  - `docs/PLATFORM_INTEGRATION_GUIDE.md` — §3.1 파라미터(쪽수 범위·pageStep·책등), §3.2 payload·fatal, §3.3.2 운영자 대리 편집, §3.3.3 관리자 편집데이터·**주문 연결 세션 운영 원칙**
  - `docs/CONTRACT_FREEZE.md` + `apps/api/src/contract-freeze.spec.ts`(새 @Public·ApiKey 라우트는 동시 등재)
  - `docs/FILE_ORDER_BINDING_API_DESIGN_2026-09-24.md`

---

## 3. 09-28 ~ 09-30 에 끝난 것 (전부 운영 배포·양사 통지·ACK 완료)

| 커밋 | 내용 |
|---|---|
| `5367b19`·`a766e7a` | canvas-core 책등 0 TypeError 교정(spine 객체 자유 객체 강등). 편집기 0mm 가드는 제품 정책으로 유지하고 주석만 정정 |
| `2f728d4` | SidePanel pageStep 단위 추가·삭제 회귀 테스트(해소 확인) |
| `aa93216` | 첨부 PDF 쪽수 pageStep 배수 빈 페이지 채움(템플릿셋 `padToPageStep`, `POST /worker-jobs/fix-pagecount/attach`) |
| `6534354` | 펼침면 캔버스 1장 = 2쪽(표지+펼침면 세트 포함). min/max·pageCount·S8 가드 통일 |
| `b5ee912` | Wave 1: restore 시 expires_at 해제 · 세션완료 VALIDATE 에 siteId 스탬프(D6 선행 ②) · separate 뒤표지 판형 검사 |
| `a730dc4`·`3402d2d` | Wave 2: 명시 sessionId 조회 실패 시 폴백 폐지(`SESSION_NOT_FOUND`·fatal) · `editor.error.fatal` · S7 paperType 규칙 · 게스트 완료 제한 · 게스트 guestToken 저장 |
| `bb626de` | `/embed` 쪽수 범위 파라미터 `pageCountMin/Max/pageStep`(호스트 우선, 재편집 복원) |
| `85d6095` | `pageStep=1` = 배수 제약 없음 |
| `5a75222` | 운영자 대리 편집 권한(`/auth/partner-operator-session`·revoke·audit, 감사 fail-closed) |
| `47f9a61` | Storige 관리자 편집데이터 관리(사이트별 보관기간, `/api/admin/edit-data/*` 13 라우트, 관리자 편집기·완료·삭제·복구·합성) |
| `4caa7cc`·`947c9e6` | 주문 연결 세션 안전장치(확인 창·사전 통지 체크·통지 정보 복사, **sessionId 기준**) |

- **3-B 운영 원칙(09-30 오너 결정, 양사·100p ACK)**
  - 적용 방법: Storige 관리자가 주문 연결 세션을 작업하기 전에 sessionId 로 사전 통지한다. 파트너가 실제 주문 여부를 회신하며, 미주문이면 제한 없다.
  - 작업 뒤에는 sessionId, 새 fileId, UTC 시각으로 사후 통지하고, 파트너가 수동 반영한다.
  - 양사의 `orderSeqno` 는 **장바구니 초안 id(13자리)** 로, 결제 주문번호와 다르다. 이 값은 생성 뒤 바뀌지 않는다.
  - 통지문: `docs/partner-notices/PARTNER_NOTICE_ORDER_LINKED_STAFF_ACTIONS_2026-09-30.md`
- 파트너 자체 경로(bookmoa·printy R-206 운영자 편집): 파트너 관리자가 편집완료하면 파트너가 즉시 주문에 결속한다. 따라서 3-B 통지 대상이 아니다.

---

## 4. 대기 항목 (회신·실측이 오면 처리)

1. **R-206 첫 실사용**(bookmoa·printy 오너 실측)
   - 대조: `partner_operator_grants`(origin partner·session_ids 1·order_ref·reason·revoked_at)와 `partner_operator_audit_logs`(발급·요청·revoke 행), api 로그.
   - 확인할 점: 편집기 닫기 시 revoke 가 실제로 남는지(best-effort) 본다.
2. **쪽수 파라미터 첫 실편집**(양사): 세션 `metadata.orderOptions` 에 범위가 기록되는지, 재편집 시 저장 쪽수가 보존되는지, pageStep 이 강제되는지 확인한다.
3. **첫 실편집 2건**(bookmoa: S4 스프링 1 · flat-spine 무선+spineWidthMm 1)
   - 대조 대상: `metadata.{coverOutput, appliedSpine, spread.spec, spine}`, 표지 VALIDATE 잡의 orderOptions·pageSize·errors.
4. **첫 실합성**(printy `synthesize/external`, bookmoa R-193 D6)
   - 대조: `job.siteId` 스탬프(printy `009c26d5…`), 세션 VALIDATE.
   - **당사 약속**: 소요 시간을 초 단위로 실측해 공유한다.
5. **Storige 오너 관리자 화면 E2E 1회**(관리자 로그인 필요)
   - 순서: 보관기간 설정 → 편집 세션 목록 → 편집기 열기·저장·편집완료 → 합성 → 주문 연결 확인 창 → 통지 정보 복사.
6. printy 예고: 책등 옵트인 준비 단계에서 `paper_types` code 확인 요청이 온다. 해석 순서는 code → alias → 정규화이고, name 은 쓰지 않는다.
7. bookmoa S10(WH-005 v2 사이트 전용 `whsec_`) 착수 통지가 오면 Storige 선행(수신 호스트 SSRF 허용 목록·partner test 키)을 함께 진행한다.
8. bookmoa R-207(bookmoa 내부) 배포 통지가 오면 기록만 한다.

---

## 5. CTO 후보 목록 (오너 결정·착수 약속 없음 — 새 세션이 재점검 후 우선순위 제안)

- **파트너 연동 근본**
  - 3-B (3) 자동 반영: 관리자 완료 시 파트너 웹훅 v2 로 새 fileId 를 전달하고, 양사가 WH-005 v2 수신부를 만든다.
  - 결속 API 설계 O1~O5(`FILE_ORDER_BINDING_API_DESIGN_2026-09-24.md` §16).
  - D6 게이트 선행: ② 완료(Wave 1). 남은 것은 ① 편집기 산출물 스탬프, ③ 백필 재실측, ④ 거부 코드 404 금지, ⑤ 100p·MD2Books 조율.
  - 100p presigned `/files/:id/complete` site 스탬프.
  - `SPREAD_SNAPSHOT_HARD_FAIL` 승격 전 호스트 고정 책등 규칙.
- **보안·안정성**
  - 게스트 읽기 경로 토큰 검증 → 회원 경로 읽기 강화(순서 중요, 상세 비공개).
  - 운영자 권한 리뷰 minor: 가드 단계 거부의 감사 행 없음, 201 라우트 감사 status_code, 인터셉터 부하.
  - 편집기 조각 토큰의 Sentry breadcrumb 노출 가능성.
  - worker `.env` 플래그: compose 기본값이 false 라 누락 재배포 시 조용히 OFF 되는 위험.
  - branch protection: master 무보호.
- **테스트 공백**
  - EmbedView 배선 테스트.
  - admin 게이팅 컴포넌트 테스트(admin 에 testing-library 없음).
  - `/embed` 쪽수 로더의 실브라우저 QA.
- **제품·운영**
  - caseBind(양장 싸바리 기하).
  - `SPINE_PARAMS_UNRESOLVED` 경고 정책.
  - G-6 백필.
  - 폰트 시딩(0건).
  - 인쇄 정규화 ON(`PRINT_NORMALIZE`, 골든 육안 대조 후).
  - 파트너 파기 계약, 고아 정리 실가동(`FILE_ORPHAN_DRY_RUN`), 고아 판정 (a)안 — 현 형태는 기각 권고.
  - 8/24 통지 4종 미발송.
  - 동화책 왕복 실기.
  - `with-templates` 배치 조회(S11).
  - 바깥 init catch AxiosError 정규화.
  - 게스트 완료 토스트 문구.
- **로드맵 미착수**: 임베드 D6 getState 페이지 필드·D-4a/b/c, R3b 지종별 TAC, I-4 Bull attempts, 에셋 A4/A5/A8·시드, R6 CutContour, R10, admin stage1b.
- **제품 결정 필요**
  - 스프링 표지를 펼침 1장으로 받는지, 가로형 제본 변.
  - 표지 기본 디자인 필요 여부.
  - ShareSnap·북모아 메인·MD2Books 연락 채널.
- **문서 스테일**: `OWNER_DECISIONS_2026-07-07` D-11(이미 구현)·D-4 서술, `_RESUME_EDITOR_TRACKS.md`(05-02, 정본 아님).

---

## 6. 상시 함정

- **파트너**
  - "0건·없음" 결론에는 집계 시각(UTC)을 붙인다(DB `created_at` 은 UTC).
  - 오탐 차단은 곧 파트너 `session.failed` 웹훅이다. 검증을 강화하기 전에 운영 실데이터로 기대식을 먼저 대조한다.
  - 양사 `orderSeqno` = 장바구니 초안 id(주문번호 아님) → 통지·조회 식별자는 **sessionId**.
- **MariaDB**
  - `JSON_EXTRACT` 불리언은 문자열 'true' 를 돌려준다(`JSON_VALUE` 는 '1').
  - `JSON_TABLE` 조인은 collation 을 명시한다.
  - 세트-템플릿 연결은 `template_sets.templates` JSON 이다(레거시 `template_set_items` 아님).
  - 세션 status 값은 'complete' 다.
- **스키마·메타데이터**
  - prod 는 `synchronize=false` 다. SQL 을 먼저 수동 적용한 뒤 API 를 배포한다(`apps/api/migrations/`).
  - 세션 `metadata` 업데이트는 얕은 병합이라, 중첩 객체를 부분 전송하면 통째로 덮인다.
- **배포**
  - api 를 재생성하면 nginx 를 재시작한다.
  - Vercel 대기 루프는 **새 배포 id** 를 매칭한다(이전 Ready 행을 잡아 조기 종료한 사고가 있었다).
  - 문서만 바꾼 push 는 Canceled 가 정상이다.
- **셸**
  - zsh 에서 `echo ===` 금지, `GID`·`UID` 변수명 금지, `PIPESTATUS` 대신 `pipestatus`.
  - 사용자용 bash 블록에 자리표시자를 넣지 않는다.
- **리뷰**
  - 서브에이전트·워크플로 결과는 주장이다. 발견은 반박 검증을 거친 것만 반영하고, 반박된 것은 이유와 함께 기록한다.
- **커뮤니케이션**: 사용자·파트너에게 보이는 모든 텍스트(진행 안내·도구 설명 포함)는 한국어로 쓴다.

## 7. 세션 종료 규칙

- 작업마다 이 문서(또는 새 날짜 RESUME)를 갱신하고, gitleaks 를 통과시킨 뒤 커밋·푸시한다.
- 종료 전에 완료·미완료·다음 행동을 남긴다.
- 세션 히스토리(`~/.claude/projects` 등)는 절대 삭제·이동하지 않는다.
