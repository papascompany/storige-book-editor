# RESUME PROMPT — 2026-10-04 (Storige · CTO 오케스트레이션 · 파트너 협업)

> **이 문서가 최신 날짜 정본이다.** 새 세션이 바로 일할 수 있도록 라이브 상태·채널·대기·후보·함정만 압축했다.
> 이력 위치:
> - 09-30 ~ 10-04 전체 이력(결정 경위·회신 원문 요지·배포 시각): `RESUME_PROMPT_2026-09-30.md` §1~§5
> - 09-28 ~ 09-30: `RESUME_PROMPT_2026-09-28.md` §5 / 09-12 ~ 09-28: `RESUME_PROMPT_2026-09-12.md` §8
> - 비공개 결정 메모(저장소 밖, 경로만): `../_private_notes/wave2/`, `../_private_notes/wave3/` (3단계는 `../_private_notes/stage3/`)
>
> 옛 문서와 서술이 충돌하면 이 문서가 우선한다. 이 문서도 2026-10-04 ~00:45Z(HEAD `4120bab`) 시점의 스냅샷이므로 파일·Git·운영 상태로 다시 확인하고 쓴다.

---

## 1. ▶ 새 세션 시작 프롬프트 (그대로 붙여 넣기)

```text
Storige 편집기·워커 개발을 이어서 진행합니다. 이 세션은 CTO(메인 에이전트)로서 서브에이전트 오케스트레이션으로 일하고, bookmoa·printy(기술 통지는 100p 포함) 파트너 세션과 크로스세션 메시지로 협업합니다. 사용자·파트너에게 보이는 모든 텍스트(진행 안내·도구 설명·파트너 메시지)는 한국어로 씁니다(코드·식별자만 영어).

1) 시작 절차
   - CLAUDE.local.md 는 운영 규칙과 참조 위치만 확인합니다. 키·비밀번호는 출력·복사하지 않습니다.
   - .cursor/plans/RESUME_PROMPT_2026-10-04.md(정본)를 먼저 읽습니다. 경위가 필요할 때만 RESUME_PROMPT_2026-09-30.md 와 비공개 메모(../_private_notes/wave2·wave3, 저장소 밖)를 봅니다.
   - git log --oneline -15 와 git status -sb 를 확인합니다. untracked 타 세션 파일(docs/SHOPIFY_*, docs/SITE_CATALOG_*, .tmp-verify-combos/ 등)은 건드리지 않고, git add 는 명시 경로 목록으로만 합니다.
   - SSH 가 필요하면 ssh-add -l 을 먼저 확인합니다(비어 있으면 ssh-add ~/.ssh/id_ed25519). 접속 대상은 CLAUDE.local.md §1.1 의 deploy@ 하나뿐이고, 다른 사용자명은 시도하지 않습니다.
   - 런타임: export PATH="/opt/homebrew/opt/node@24/bin:$PATH"

2) 파트너 채널 확인
   - ListAgents 로 찾습니다. 파트너 세션이 실행 중이 아니면 목록에 안 나옵니다. 그때는 mcp__ccd_session_mgmt__list_sessions 로 local_ id 를 찾아 SendMessage(to="local_…") 로 보냅니다.
   - bookmoa = local_bf71565d-e946-487b-a8e4-27962fe7626a (표시명 「20260930 북모아 관리자 수정 시작」, cwd ~/Developer/claude/bookmoa-mobile). 같은 계열 이름의 Remote Control 세션(오프라인)과 혼동하지 않습니다.
   - printy = local_6494a1a2-072f-498a-a070-e6133b50c706 (「20260930 Printy CTO 개발 계속」, cwd ~/Developer/claude/printy). printcard-studio-* 세션은 printy 가 아닙니다.
   - 100p Books = local_69303599-8e93-4355-9e02-20fbe03d6d8d (「20260930 100p_books 서브에이전트 진행」, cwd ~/Developer/claude/100p_books) — 기술 통지 창구.
   - 파트너도 새 세션으로 교대했을 수 있습니다. 이름만 믿지 말고 cwd 로 확증합니다(from 이 uds:/tmp/cc-socks/<PID>.sock 이면 lsof -a -p <PID> -d cwd -Fn).
   - 받은 메시지에 회신할 때는 from 값을 그대로 to 로 씁니다. 발신 성공은 도달이 아니므로 중요한 통지는 ACK 를 요청합니다.
   - 시작 통지: bookmoa·printy 에 "Storige 새 세션 시작 + 이 세션 이름 + 통지 창구 확인" 을 한 줄로 보내고 ACK 를 요청합니다. 창구가 바뀌면 RESUME §3 을 갱신합니다.

3) 첫 작업
   - RESUME §5 대기 항목 중 회신·실측이 온 것부터 처리합니다. 운영 DB·로그와 읽기 전용으로 대조하고, 집계 시각을 UTC 로 적어 RESUME 에 기록합니다.
   - 그다음 §5 다음 후보를 CTO 관점에서 재점검합니다(완료·미완·스테일 구분, 코드 근거). 우선순위 3~5개와 오케스트레이션 계획(레인·에이전트 수·파일 소유·검증·배포 순서)을 사용자에게 제안하고, 승인을 받은 뒤 착수합니다.

4) 오케스트레이션 방식
   - 메인(CTO) 책임: 목표·분해·순서·파일 소유권·통합·최종 판단. 서브에이전트 결과는 주장으로 보고 파일·명령 증거로 확인한 뒤 통합합니다.
   - 서브에이전트: o5-repo-scout·o5-architect·o5-implementer·o5-test-build·o5-security-reviewer·o5-frontend-qa·o5-final-reviewer 중 필요한 것만 씁니다. 사용자가 ultracode·워크플로를 켜면 Workflow 로 돌립니다.
   - 표준 흐름:
     판독·재점검(읽기 전용 병렬)
     → 설계 + 적대적 비판
     → 2차 CTO 결정(비판 발견별 수용·기각·보류, 비공개 메모에 기록)
     → 구현 레인(파일 배타 소유, 같은 작업 트리, 커밋 없음)
     → 레인별 2렌즈 리뷰 + 발견별 반박 검증 → 확정분만 수정
     → 통합 검증(RESUME §2 기준선 이상)
     → 문서 워크플로(CONTRACT_FREEZE·연동 가이드·DEPLOYMENT·파트너 공지, 코드 대조)
     → 최종 리뷰 3렌즈 + 반박
     → 명시 경로 커밋(gitleaks 0)
     → 오너 배포 승인
     → 파트너 사전 통지·ACK
     → 배포(직전 이미지 태그 보존 → push → worker → api + nginx 재시작 → 스모크)
     → 완료 통지
     → RESUME·개요 시각화 갱신
   - 파트너 코드가 필요하면 파트너 세션에 판독·사실 질의를 보냅니다. 파트너 저장소를 직접 수정하지 않습니다.

5) 규칙
   - 배포, 운영 DB 쓰기, 파트너 착수 약속, 제품 결정은 오너(사용자) 승인 후에만 합니다.
   - 사실 확인 회신(코드·운영 실측)은 바로 보내고, 보낸 내용은 RESUME 에 기록합니다.
   - 3-B 운영 원칙 상시 적용: Storige 관리자가 주문 연결 세션을 수정·완료·삭제하기 전 해당 파트너에 sessionId 로 사전 통지하고, 작업 뒤 sessionId·새 fileId·UTC 로 사후 통지합니다.
   - 보안 관련 서술은 공개 저장소에 쓰지 않습니다. 결정·근거·잔여 위험은 저장소 밖 ../_private_notes/<wave>/ 에 두고, 공개 문서에는 변경 후 동작만 씁니다.
   - 커밋 전 gitleaks 를 통과시킵니다. 키·비밀번호는 출력·복사·커밋하지 않습니다.
   - 세션 히스토리(~/.claude/projects 등)는 삭제·이동하지 않습니다.
   - 배포 순서: (DB 마이그레이션이 있으면 SQL 수동 적용 먼저) → worker → api. api 를 재생성하면 nginx 재시작이 필수입니다. 배포 전 직전 이미지 태그(rollback-pre-<이름>)를 보존합니다.
   - editor·admin 은 master push 가 곧 배포입니다(push 전 오너 승인, Vercel 배포가 worker 보다 먼저 뜹니다). VPS 는 worker → api + nginx 재시작 → 기동 로그 [FLAGS] 확인 → 스모크 순서입니다. 되돌릴 때는 api → (합성 큐 delayed·active 소진 확인) → worker 순서이고, Wave 3 이전 api 로 되돌릴 때는 오너 승인 뒤 비공개 메모(../_private_notes/wave3/)의 데이터 정리 절차를 먼저 합니다.
   - 사용자에게는 결과부터 짧게 한국어로 보고합니다.
```

---

## 2. 현재 라이브 상태 (2026-10-08 14:38Z — Wave 8 전부 + 10-08 운영 정비(Wave B JOB_LINK_STRICT·킬스위치 compose 매핑·AI 탭 숨김) 배포 후)

| 구성 | 현재 운영 | 롤백 |
|---|---|---|
| DB | 09-30 Wave 1 ~ 10-04 Wave 3 **마이그레이션 없음**. 마지막 스키마 변경은 09-29 `20260929`·`20260930`(ADDITIVE) | 백업 `~/backup-sites-pre-staff-edit-20260929.sql`·`~/backup-template_sets-pre-padstep-20260928.sql`. 추가 컬럼·테이블은 남겨도 무해 |
| api | 이미지 `1c9b120`(e8f5bd686b27, N-API-3b) · 컨테이너 10-08 14:37:16Z 재생성(VPS 체크아웃 `5ef27c0` — compose `EDITOR_CONTENT_PAGE_RULES` 매핑 추가 · .env `JOB_LINK_STRICT=true`) + nginx 14:37:25Z | Wave B 원복 = .env `JOB_LINK_STRICT` 줄 제거(백업 `~/storige/.env.bak-pre-waveb-20261008T143656Z`) + api 재생성 + nginx 재시작 · 킬스위치 = .env `EDITOR_CONTENT_PAGE_RULES=off` + api 재생성(10-08 부터 유효 — 이전에는 compose 미매핑으로 무효) · 태그 `storige-api:rollback-pre-wave-b`(=e8f5bd686b27 동일 이미지) → `storige-api:rollback-pre-n-api-3b`(=`c6c38ef`, e19adc5f69de) → `rollback-pre-wave8-2`(=`776ac0e`, 4c6b0af81ac2) → `rollback-pre-wave8`(=`9381ea4`, fe75e1063d85) → `rollback-pre-wave6`(=`d3e3587`, 294b1d98554e) → `rollback-pre-wave4`(=`f63c8ae`, c732d216145f) → `rollback-pre-wave3`(=`9e2a817`) → `rollback-pre-1003`(=`4f28e52`) → `rollback-pre-stage3` → …(태그 → `latest` 재지정 후 `up -d --no-build api` + nginx 재시작). **Wave 3 이전 코드로 되돌릴 때는 오너 승인 뒤 비공개 메모(`../_private_notes/wave3/`)의 데이터 정리 절차 먼저.** 롤백 순서 api → (합성 큐 delayed·active 소진 확인) → worker |
| worker | `776ac0e`(10-06 08:09:11Z, Wave 8 1단계 — sharp 0.35.5·mysql2 3.24.5) | `storige-worker:rollback-pre-wave8`(=`d3e3587`, 3be1bd99732e) → `rollback-pre-wave4`(=`f63c8ae`, eacd43c79dfb) → `rollback-pre-wave3`(=`9e2a817`) → `rollback-pre-1003`(=`1c52c80`) → … |
| editor | Vercel `8taztq201`(`5ef27c0`, 생성 10-08 14:17:44Z·운영 번들 반영 확인 14:29Z — 도구 메뉴 AI 탭 숨김 `VITE_ENABLE_AI_PANEL=false`) | `diqgayglo`(`c8d7df5`, Wave 8 2b) → `gmboy5bm1`(`c6c38ef`) → `n8zp637da`(`776ac0e`) → `16moj714s`(`9381ea4`) → `g0haka2nu`(`599f602`) → `pwvgvgvhb`(`d3e3587`) → `qftv0kx8t`(`f63c8ae`) → `65j5xwzgg`(`9e2a817`) promote. IIFE 번들(VPS `build:embed:prod`)은 미재빌드(파트너 미사용, 오너 결정 대기) |
| admin | Vercel `kolxzkmiv`(`c6c38ef`, 10-06 — 싸바리 세트 caseBind 저장 경고) | `luw3mayxr`(`776ac0e`) → `cyho5uda8`(`9381ea4`) → `oylw176wy`(`f63c8ae`) promote | `l6f2dhp0f`(`9e2a817`) → `isxgg1mpv` promote |

- VPS 체크아웃 = `5ef27c0`(10-08). api 이미지 = `1c9b120`(N-API-3b), worker 이미지 = `776ac0e`(Wave 8 1단계) — 그 뒤 서버 코드 변경 없음(compose 매핑만). 계약 정본 **CONTRACT_FREEZE v1.16**(`docs/CONTRACT_FREEZE.md` + `apps/api/src/contract-freeze.spec.ts` — v1.16 재편집 템플릿셋 세션 세트 우선·ready/complete templateSetId(MODIFY-TARGET+ADDITIVE, editor 10-07 14:53:59Z), v1.15 편집 완료 내지 검증 쪽 단위 판정(MODIFY-TARGET, 10-06 15:39Z), v1.14 서술 정정, v1.13 동화책 싸바리 세트는 매핑 전환 시각부터 유효).
- 플래그(운영 기동 로그 `[FLAGS]` 확인값):

| 플래그 | 운영 값 | 비고 |
|---|---|---|
| `JOB_LINK_STRICT` | **true(10-08 14:37:16Z, 오너 결정)** | Wave B — 관측 7일(Loki) 실 호출 0 확인 후 전환. 3사(bookmoa·printy·100p) 사전 안내·완료 통지. 집계는 Loki `[job-link] denied … caller=none` |
| `JOB_FILE_SITE_STRICT` | false(기본) | **관측 연장(10-08 오너 결정)** — 켜려면 FREEZE 등재(403 FILE_SITE_MISMATCH, MODIFY-TARGET)·사전 통지·ACK·소급 확인 선행. 100p 요청(10-09): 켜기 전 사전 안내 — 90MB 이하 multipart 파일·P4 이전 파일의 사이트 귀속을 100p 가 확인 |
| `SESSION_JOB_OUTPUT_LOOKUP` | false(기본) | 오너 결정 대기(§5) — 연결 행·운영 EXPLAIN 선행 |
| `EDITOR_CONTENT_PAGE_RULES` | true(compose `:-on`, 10-08 매핑 추가) | N-API-3b 킬스위치. 끌 때는 `.env` 에 off 후 api 재생성 + nginx 재시작 |
| `WORKER_TRIMBOX_SIZE_CHECK` | true(compose `:-true`) | X1 TrimBox 판형 판정·합성 contentTrim. 끌 때는 `.env` 에 false 후 worker 재생성 |

- 그 밖의 worker `.env`(09-30 04:47Z, 불리언만): CUTOUT·LIGHTWEIGHT_VALIDATION·LIGHTWEIGHT_SYNTHESIS·CROP_MARK_VALIDATION·WIRED_FIXABLE_GATING = true / PRINT_NORMALIZE·FLATTEN·FILE_ORPHAN_* 미설정(코드 기본값).
- 운영 사이트 편집데이터 보관기간: **전 사이트 미설정(NULL)** — 양사 요청으로 유지, 설정할 때는 사전 통지.
- 로컬 백업 브랜치 `backup/wave1-pre-regroup-2026-09-30`(push 안 함, 09-30 커밋 재구성 전 상태 — 필요 없으면 오너 확인 뒤 삭제).
- 개요 시각화: `docs/WAVE1_TRIMBOX_OVERVIEW_2026-09-30.html` — Wave 3 반영 갱신은 10-04 세션 정리 작업에서 진행했다(커밋 여부는 `git log -- docs/WAVE1_TRIMBOX_OVERVIEW_2026-09-30.html` 로 확인).

### 검증 기준선 (이보다 낮으면 회귀)

| 대상 | 기준 |
|---|---|
| api jest | 130 스위트 / 2605 · tsc 0 (Wave 4 통합 트리 10-05. lint 오류 2건 — `shop-session-order-scope.spec.ts:24,71` no-loss-of-precision. **정정(10-06): 기존 오류가 아니라 `558c293`(10-01 Wave A)이 들여온 회귀이며, 이 때문에 master CI 가 10-01 08:53Z(`e384d60`) 이후 계속 실패 — api lint 뒤 단계(worker·canvas-core·editor·admin·golden 등)는 전부 skipped**) |
| worker jest | 33 스위트 / 1239 · tsc 0 (Wave 4. 로컬 gs 10.08.0·qpdf 12.3.2 설치 시; gs 부재 시 GS 블록 skip) |
| editor vitest | 104 파일 / 1468 · tsc 0 · build · build:embed / Playwright `tests/embed-mode` 33건(`PW_CHROMIUM_CHANNEL=chrome`, 로컬 전용·CI 미편입) |
| sdk | 12 / 359 · tsc 0 |
| admin vitest | 16 파일 / 209 · tsc·eslint 0 · build (컴포넌트 테스트는 `.test.tsx` + happy-dom docblock) |
| canvas-core | 55 / 630 |

- worker `crop-mark-validation.spec` 파리티 1건은 API 스위트와 동시에 돌릴 때만 간헐 실패한다(부하성). 단독 실행하면 통과한다.

### 배포 방식 메모

- editor·admin: master push 가 곧 배포다(**push 전 오너 승인**). 문서만 바꾼 push 는 Vercel 빌드가 Canceled 되고 기존 Ready 가 유지된다(정상). Vercel 대기 루프는 **새 배포 id** 를 매칭한다.
- api·worker: VPS 수동 배포(`CLAUDE.local.md` §6). 순서: 직전 이미지 태그 `rollback-pre-<이름>` 보존 → `git pull` → build → **worker 먼저** `up -d` → api `up -d` → **nginx 재시작** → 기동 로그 `[FLAGS]` 확인 → 스모크(health 200, 무인증 경로 401, guest 토큰 없음 403, api·worker 오류·5xx 0, 대기열 0).
- DB 변경이 있으면 prod 는 `synchronize=false` 이므로 `apps/api/migrations/` SQL 을 먼저 수동 적용하고 백업을 남긴다.

---

## 3. 파트너 채널·운영 사실

| 파트너 | 창구(시작 시 재확인) | cwd | 운영 상태(마지막 ACK) |
|---|---|---|---|
| bookmoa | **창구 교대 중(10-09 01:57Z 예고, 회신 불요)**: 현 `local_37592b91-e6d2-4adc-9cf3-2d0e9aba4034` [060c4d](자칭 「북모아 Printable 개발 계속」, 표시명 「20261007 북모아 개발 계속」) 종료 예정 → 새 세션이 이름을 직접 통지, 그 뒤 통지·ACK 는 새 세션으로. 이름이 같은 오프라인 Remote Control [d6e18b] 과 혼동 금지. 옛 `local_c092a5a6`[9b559d]·`local_bc4b2915`[652b4b]·`local_bf71565d` 는 창구 아님 | `~/Developer/claude/bookmoa-mobile` | 운영 R-224 `5ie8l4tyk`(10-09 — 관리자 주문대기 시안 흐름·디자이너 업무 큐, 표시·판정 전용 + 서버 관리자 검색 order_id · Storige 연동 경로·호출 무변경). JOB_LINK_STRICT 완료 통지(14:37Z) 원장 기록. Wave 8 1단계·2a·N-API-3b(v1.15)·2b(v1.16) 원장 기록·ACK 완료. 동화책 207c458f 유지(전환 = e2e + 인쇄팀 확인 뒤), 미연결 13세트 연결 계획 없음. e2e 최소 묶음 실행 시각 = bookmoa 오너 결정 대기(정해지면 통지) |
| printy | `local_f788c035-1825-4aeb-8498-994f2029342b` **[f6f296]** 「20261005 Printy 오픈준비 개발 계속」(10-08 표시명 통지 — 같은 세션, 회신 불요. Wave 8 2b 배포 시각 10-07 14:53:59Z 기록 확인). 옛 `local_86991aae`[88e40b]·`local_6494a1a2` 는 창구 아님 | `~/Developer/claude/printy` | 운영 printy `f7a574d`(printy 저장소) 이후 변경 없음(10-03). 실 e2e 재개 **미정**(오너 보류) |
| 100p Books | `local_3789edd3-1568-4609-8438-4ef9308bad8a` **[ab23d3]**(10-09 교대 통지 — 이름 안내만, 동의·회신 없음). 통지 본문 이름은 「100p_books CTO 세션 인수인계」, 현재 표시명은 「20261008 100p_books CTO 세션 인수인계」 → 보낼 때 ref `[ab23d3]` 를 붙인다. 옛 `local_69303599`[2eb3d6] 「20260930 100p_books 서브에이전트 진행」은 종료 예정·창구 아님(그 이름으로 보낸 통지는 새 세션에 도착하지 않음). 100p 는 받은 통지(Wave 2·4·5·6·8 1단계, JOB_LINK_STRICT 사전·완료)를 자기 STATUS §0-17 에 기록, 영향 모두 없음 | `~/Developer/claude/100p_books` | 유형 1(upload·validate·download external). 편집 세션·합성 계획 없음 |
| ShareSnap·북모아 메인(PHP)·MD2Books | 연락 채널 없음(오너 확인 필요) | — | — |

- 현재 Storige 세션: [0e5333] 「Storige 편집기·워커 개발」→ 표시명 「20261004 Storige 템플릿 변환관리 시작」(10-05 시작, 양사 ACK 03:1xZ). 직전 Storige 세션: `local_20f149cd-…` 「20260930 Storige 편집기·워커 개발」(10-04 종료, 목록에 idle 로 남아 있음 — 파트너가 옛 창구로 보내지 않도록 새 이름 통지 완료).
- 최근 ACK(괄호 안은 **파트너 저장소** 커밋):
  - Wave 2(10-03): 사전 통지 ACK bookmoa(`a6810f7`)·printy(`f7a574d`)·100p(`b0f5d3a`) — 모두 코드 변경 불필요. bookmoa 원장 기록(`4ee4261`). 완료 통지 3사 발신.
  - Wave 3(10-03~04): 사전 통지 ACK printy(`f7a574d`)·bookmoa(`1272b42`), 100p 영향 없음. 완료 통지 양사 발신(10-04 00:43Z 이후).
- 파트너 운영 사실(코드 기준 회신, 09-30 ~ 10-03):
  - **합성**: 양사 모두 합성 요청에 항상 editSessionId 를 싣는다(세션이 없으면 합성 미호출). printy compose-mixed 실호출 0.
  - **합성 상태**: 권위는 job-status 폴링이다. 상한 120s, `COMPLETED`·`FAILED` 에서 폴링 정지·항목 고정 → 늦은 `COMPLETED` 는 주문에 반영되지 않고 재합성으로 복구한다. 시스템 실패 구분은 errorCode `JOB_STALLED`·`JOB_TIMEOUT_SWEPT`.
  - **웹훅**: 양사 무저장(bookmoa R-209 `app_config['p4-orders']` 0행 유지). `session.*` 미소비 — Storige 도 v1.10 에서 `session.*` 는 카탈로그만 유지하고 현재 발신하지 않는다.
  - **편집기**: `getState` 는 `dirty` 만 사용, 작업 응답 `editSessionId` 미사용. `NETWORK_ERROR` 는 오류 카드에 `payload.message` 그대로(다시 시도 없음, 재열기 = 같은 orderSeqno). `AUTH_EXPIRED` 는 fatal(호스트 토큰 갱신 명령 없음).
  - **키**: 양사 서버 키 1개. 100p 는 검증·잡 조회 = 워커 키, 업로드·complete·다운로드·DELETE = 편집기 키이며 둘 다 100p 사이트로 판정된다. presigned complete 사이트 귀속(P4)은 Wave 2 에 배포됐다.
  - **100p DELETE**: `/files/:id/external` 는 2xx 또는 본문 `code:"FILE_NOT_FOUND"` 인 404 만 성공 처리한다. Storige 운영 원칙: ① 이 404 본문 유지(변경 시 사전 통지) ② 경로 제거·이동 시 사전 통지 ③ 다른 거부 사유에 `FILE_NOT_FOUND` 404 재사용 금지.
  - **식별자**: 양사 `orderSeqno` = 장바구니 초안 id(13자리, 생성 뒤 불변, 결제 주문번호 아님) → 통지·조회 식별자는 **sessionId**.
  - **/embed 쪽수 파라미터(bookmoa 10-05 회신)**: 신규 편집은 pageCount 와 pageCountMin·Max·pageStep 을 함께 보냄(범위만 보내는 경로 없음). 재편집(sessionId 동반)은 범위를 보내지 않고 세션 `metadata.orderOptions` 를 권위로 씀. bindingType 은 신규 편집 기본 'perfect'(운영 84상품 spinePolicy 미설정) — 단 동화책은 bookmoa R-217(10-05 운영 배포) 이후 'hardcover' 전송(W5 ACK·10-06 v1.13 ACK). printy 동화책은 'perfect' 유지(10-06 ACK). 운영 조합: 동화책 하드커버 207c458f 16/48/4 · A4 하드커버 f0335fda 16/300/4 · 교육·교재 a2cc2939 16/500/2(초기 16·100).
  - **도련**: 양사 편집기 상품 템플릿셋 `bleed_mm` 전부 3 → 합성 내지 contentTrim 예: A4 216×303 · 정사각 216×216 · 가로 303×216.
- 3-B 운영 원칙(09-30 오너 결정, 양사·100p ACK): 통지문 `docs/partner-notices/PARTNER_NOTICE_ORDER_LINKED_STAFF_ACTIONS_2026-09-30.md`. 파트너 자체 운영자 편집(R-206)은 파트너가 즉시 결속하므로 3-B 대상이 아니다.
- 계약·공지 정본: `docs/PLATFORM_INTEGRATION_GUIDE.md` · `docs/CONTRACT_FREEZE.md`(새 @Public·ApiKey 라우트는 `contract-freeze.spec.ts` 동시 등재) · `docs/FILE_ORDER_BINDING_API_DESIGN_2026-09-24.md` · `docs/DEPLOYMENT.md` · `docs/PDF_VALIDATION_GUIDE.md` · `docs/partner-notices/PARTNER_NOTICE_WAVE2_2026-10-03.md` · `docs/partner-notices/PARTNER_NOTICE_WAVE3_2026-10-03.md`.

---

## 4. 09-30 ~ 10-04 완료 요약 (전부 운영 배포·파트너 통지·ACK 완료)

> 09-30 Wave 1 은 09-29 의 Wave 1·2(`b5ee912`·`a730dc4`)와 별개다. 09-28~09-30 이전 완료분은 `RESUME_PROMPT_2026-09-30.md` §3.

| 일자(UTC) | 묶음 | Storige 커밋 | 배포 |
|---|---|---|---|
| 09-30 | **Wave 1** — 게스트 세션 조회 경로(1단계)·세션 소유자 배치 조회 `POST /api/partner/edit-sessions/owners`·산출물 사이트 귀속·기동 로그 플래그 스냅샷·요청 URL 값 가림·편집기 오류 수집 정리·X1 TrimBox 판형 판정 | `5e76d36`·`090f134`·`4d444fa`·`072cc09`·`747bc19`·`21e7384`·`dcb1a92`·`1c52c80`(FREEZE v1.6)·`4fcf0a9` | push 07:48:40Z → api·worker 07:54:05Z + nginx / 2차 push 07:54:42Z → editor `jhn8wxb8b` |
| 10-01 | **비회원 세션 정리 2단계** — 재오픈 토큰 `#guestToken=`·회원 경로 회원 식별·게스트 조회 분리 | `c89f6cb`·`d612ca6`·`361a9a4`(v1.7) | editor 06:30:03Z `3359fipmg` → api 06:34:06Z + nginx |
| 10-01 | **3단계 Wave A** — 작업 세션 연결 확인·목록·버전 회원 판정 통일·게스트 라우트 헤더 전용 | `7e252ba`·`558c293`·`4f28e52`(v1.8) | editor 09:47:22Z `6hv60qkny` → api 09:51Z + nginx |
| 10-01 | **같은 탭 비회원 초안 이어 열기 복구** | `e97c3f5` | push 10:12:08Z → editor `dnmu12g57` |
| 10-03 | **Wave 2** — 편집기 오류 code·문구·비회원 완료 안내, 합성·채움 내지 contentTrim, 운영자 감사 가드 단계 기록, `JOB_STALLED`, presigned complete 사이트 귀속(P4), files 관리자 판정 SUPER_ADMIN, 작업 사이트 결정 규칙 | `814d36e`·`73274ce`·`b0a04a9`·`a245b0f`·`03eca74`·`9e2a817`(v1.9) | push 04:51:41Z → editor `65j5xwzgg` → worker 04:55:41Z → api 04:58Z + nginx |
| 10-05 | **Wave 5** — `/embed` 호스트 `pageCountMin`·`pageCountMax` 가 제본 최소·최대 쪽수를 키별로 대신(CONTRACT_FREEZE v1.12 MODIFY-TARGET) · 편집기만 | `573e667`·`4ba841b`·`c397213`(v1.12)·`599f602` | 양사 사전 통지 ACK(bookmoa·printy 코드 변경 불필요 — 16~31쪽 무선은 양사 상품 정의상 판매·제작 범위) → push 07:01:38Z → editor `g0haka2nu` Ready 07:02:48Z → 스모크(편집기 /·/embed 200, 운영 번들 새 규칙 포함, api health 200) → 완료 통지 3사(07:0xZ = 적용 시점, 100p 영향 없음). 서버·DB 변경 없음. 검증: editor vitest 104/1489 · E2E 36/36 ×2 · 최종 리뷰 3렌즈 GO_WITH_RISKS. 롤백 Vercel `pwvgvgvhb` promote |
| 10-05 | **Wave 4** — 합성 입력 오류 즉시 실패·합성 실패 응답 errorCode·안내 문구(FREEZE v1.11) · 종결 후속 처리 결과 기록 조건부 갱신·도서 확정 조건부 전진 · 편집기 회원 세션 생성 실패 시 주문 세션 재조회 · compose api·worker env 매핑 보강 · /embed 쪽수 범위 Playwright 스펙 | `810214a`·`609290e`·`2dbad44`·`ffdf7f6`·`f20da08`·`38924fa`(v1.11)·`d3e3587` | 양사 사전 통지 ACK(bookmoa·printy 코드 변경 불필요 — 고객 화면 합성 errorMessage 미표시, errorCode 미사용) → 태그 `rollback-pre-wave4` → push 05:39:14Z → editor `pwvgvgvhb` Ready(admin Canceled 정상) → worker 05:44:29Z(**적용 시점**) → api 05:47:10Z + nginx([FLAGS] 배포 전과 동일, 신규 매핑 키 렌더링 = 코드 기본값) → 스모크 05:47Z(health 200, 무인증 401, 게스트 403, 오류·5xx 0, 큐 0) → 완료 통지 3사(100p 영향 없음). DB 마이그레이션 없음 |
| 10-04 | **Wave 3** — 작업 상태 전이 가드·합성 큐 재시도(attempts 3)·확인된 세션 연결 저장(`session.*` 미발신)·getState 페이지 필드·편집기 잔여 문구·admin TrimBox 경고 표시·컴포넌트 테스트 환경 | `c94cdbc`·`6fdbd32`·`06a44f3`·`a24cd38`·`f63c8ae`(v1.10) | push 00:34:35Z → admin `oylw176wy`·editor `qftv0kx8t` → worker 00:38Z → api 00:41Z + nginx |

- 기록 커밋: `305ff21`·`d09d1ff`·`e384d60`·`bbb9381`·`3ab801a`·`6d5b51d`·`af0db04`·`19333cb`·`4120bab`.
- 오케스트레이션 규모(참고): Wave 2 = 재점검 7 → 설계+비판 10 → 구현 5 레인·53 → 문서 12 → 최종 리뷰 10 / Wave 3 = 설계+비판 8 → 구현 4 레인·56 → 문서 9 → 최종 리뷰 14.

---

## 5. 대기·추적 / 오너 결정 대기 / 다음 후보

### 5.1 대기·추적 (실 e2e 재개 시 발생 — 양사 재개 시 사전 통지 약속)

> 마지막 실측: 10-01 10:13Z ~ 10-03 02:29Z UTC 신규 편집 세션 0·worker 작업 0·owners 호출 0·api 오류 0 / 10-03 06:38Z 작업↔세션 연결 행 0/345. 운영자 권한 발급·감사 0행.
> **10-05 03:12Z 재실측(읽기 전용)**: 10-03 02:29Z ~ 10-05 03:12Z UTC `edit_sessions`·`file_edit_sessions`·`files`·`worker_jobs`·`webhook_deliveries`·`public_api_audit_logs` 신규 0(마지막 worker 작업 09-30 02:28:51Z) · `partner_operator_grants`·`audit_logs` 0행 · 큐 pdf-validation·pdf-synthesis wait/active/delayed/failed 0 · api(기동 10-04 00:41:06Z)·worker(00:38:20Z) 오류 로그 0 · owners 로그 2건 = 라우트 매핑 + 배포 스모크 401(00:42Z) → 실호출 0. 같은 날 양사 ACK: 창구 유지, 실 e2e 보류 유지, 회신 미결 없음(bookmoa 최신 문서 커밋 `cb91431`, printy `f7a574d`).

| # | 항목 | 확인할 것 |
|---|---|---|
| 1 | owners API 첫 실호출(bookmoa·printy R-208) | 응답코드·지연을 운영 로그로 대조해 양사에 공유(양사 약속) |
| 2 | 첫 실합성(사이트 키 + editSessionId) | `job.siteId` 스탬프·작업 세션 연결 저장·contentTrim 산출 크기(예 216×303) 대조, **소요 시간 초 단위 공유(당사 약속)** |
| 3 | R-213 같은 탭 재오픈(bookmoa) | 실 e2e 재개 때 같은 탭 비회원 초안 이어 열기 1회 확인 |
| 4 | 실 e2e 재개 시점 | **bookmoa 10-05 재개 결정**(오픈 전 최소 묶음: 동화책 207c458f 셀프편집 1건·owners·결속, PDF 업로드 주문 등 — 실행 시각 추후 통지, Storige 는 그 시간대 로그 동시 관찰·UTC 회신). printy 미정 |
| 5 | 그 밖 첫 실사용(09-30 §4 계승) | R-206 운영자 대리 편집(grants·audit 행, 닫기 시 revoke) · 쪽수 파라미터 첫 실편집(`metadata.orderOptions`·재편집 보존·pageStep) · bookmoa 첫 실편집 2건(S4 스프링·flat-spine) · Storige 오너 관리자 화면 E2E 1회 · printy `paper_types` code 질의 예고 · bookmoa S10(WH-005 v2) 착수 통지 시 Storige 선행 |

### 5.2 오너 결정 대기

- **Wave 6(10-05)**: ① 양장 표지 기준 = 업로드 검증 싸바리 전개 — 편집기 싸바리 출력 모드·api 검증 연결 구현(**템플릿 데이터 조건부, 현재 운영 활성 0세트 → 코드 배포만으로 출력 불변**), 내지 PDF 판형 우선은 싸바리 모드 한정(오너 O-3). **배포 완료 10-05**: push 11:59:16Z → editor `16moj714s`·admin `cyho5uda8` Ready 12:00Z → api 12:02:48Z + nginx([FLAGS] 동일) → 스모크 정상 → 완료 통지 3사(파트너 출력 변화 없음). 롤백: Vercel promote(editor `g0haka2nu`·admin `oylw176wy`) → api `rollback-pre-wave6`. 동화책 새 템플릿셋 복제 **완료(10-05 14:58Z, 오너 승인)**: 세트 `9e768d01-f2f7-4a1e-a1f6-f1ff45cb2fcb`(비활성, 210×210·16~48·4·hardcover_wrap) + 표지 `55756514-1ab3-4623-a212-e99b560d01af`(면 218×218·책등 8mm 고정 — bookmoa 오너 확정) → 싸바리 모드 조건 충족, 표지 PDF 484×258(로컬 실브라우저 실측). 백업 `~/backup-storybook-wrap-pre-clone-20261005T145750Z.sql`. **bookmoa 매핑 전환 대기**(10-06): 오너 결정 FREEZE v1.13 = MODIFY-TARGET(표지 PDF 496×276 → 484×258·완료 검증 싸바리 전개 검사, coverOutput 키 ADDITIVE) · 문서·공지 `PARTNER_NOTICE_STORYBOOK_WRAP_2026-10-06.md` 커밋(`7b584f0`)·양사 발송 → **양사 ACK(10-06)**. printy: 매핑 207c458f 유지·전환은 printy 오너 결정 대기, 동화책 진입 `bindingType=perfect` → 그대로 전환하면 완료 표지 크기 검사 생략(현행은 펼침 검사). 재편집 경로 사실(양사 공유 코드): 장바구니·게스트 재개는 현재 매핑 id + sessionId 를 보냄 → 전환 시 옛 세션이 새 세트로 열림. bookmoa 수정안 'sessionId 있으면 templateSetId 생략'(Storige 코드상 세션 값으로 열림, 운영 bookmoa 세션 templateSetId NULL 0건) → **bookmoa 오너 결정: 전환 전에 적용**(editor.complete 에 templateSetId 없음 — 재편집 완료 때 저장값 덮어쓰기 금지 권고). printy 오너 결정(10-06): 동화책 207c458f 유지, 전환 안 함. **공유 연결 행 주의**: '하드커버210x210' 행은 site NULL 공유이고 by-product 는 sortcode 만 봄 → printy 도 같은 sortcode 로 관리자 「템플릿셋 조회」 사용(고객 경로 미사용). Storige 오너 결정(10-06): 합의 절차 유지 + printy 운영자 안내(동화책 상품 조회 후 저장 금지). 전환 시각이 정해지면 printy 에도 사전 고지. bookmoa 오너 결정: e2e ①~④(207c458f) 뒤, **인쇄팀이 484×258 싸바리 전개·책등 8 고정 산출물을 제작할 수 있는지 확인될 때까지 전환 보류**, 전환 시각은 bookmoa 통지. 인쇄팀 확인용 샘플(운영 세트 공개 조회 응답 그대로 로컬 편집완료 경로, 표지 484×258·내지 420×210 8쪽, 영역 표시·SAMPLE) 전달 `/tmp/storige-to-bookmoa/storybook-wrap-sample-2026-10-06/`. **전환 시각 DB 작업은 Storige 오너 사전 승인(10-06)** — bookmoa ACK·인쇄 확인·시각 통지 뒤에만: 백업 → `product_template_sets` '하드커버210x210' → 9e768d01 행 추가(is_default 1·display_order 0) → 9e768d01 `is_active` 1 → 207c458f 매핑 행(id 5136927e) `is_active` 0(bookmoa 선택) → 사후 검증·UTC 통지. 세트 207c458f 는 삭제·비활성 금지(장바구니 1·주문 1). printy 는 printy 결정 시 같은 절차. 전환 뒤 첫 새 세트 세션 관찰 회신(책등 8 고정 로그·coverOutput hardcover-wrap 484×258·표지 검증 잡 status/errors — 이 잡은 세션 workerStatus 를 바꾸지 않음). 후속: 기존 면≠판형 세트(동화책 낱장 7·A4 하드커버 2) 내지 크기는 저장 세션 실측 뒤 별건. ② 쪽 단위 = 일치 원칙: 207c458f 16~48·4 정리 완료(10-05 07:31:58Z, 백업 `~/backup-template_sets-207c458f-pre-pagestep4-20261005T073157Z.sql`), 불일치 콘솔 경고·admin 단위 표시 구현. ③ 책등 방식 = bookmoa 결정·Storige 그대로 등록(문서 반영). ④ 템플릿 제작 가이드 갱신(`6d15194`·`b987a81`, bookmoa 초안 v2 반영).
- **쪽 단위 일치 — 공유 템플릿셋 4개 정렬 완료(오너 결정, 10-05 14:14:32Z)**: f0335fda·83e6ec80 [16,300]·4, a2cc2939·e66588b2 [16,500]·2 (백업 `~/backup-template_sets-shared4-pre-pagestep-20261005T141432Z.sql`). 범위 없이 재진입하는 기존 세션은 16쪽 미만이면 16쪽 증설·쪽수 기록 없는 초안은 단위 배수까지 완료 차단(1회 추가로 해소)·재편집 pageCount 를 보내면 최대 100 제한 해제. bookmoa 에 영향 세션 11건 사후 통지 → **회신: 모두 실주문 아님, 원복 불필요**(10-05). printy 영향 없음.
- 템플릿 제작 가이드: Storige 소유. 10-05 오너 결정 기준으로 갱신 완료, bookmoa 초안이 오면 코드 대조 후 추가 반영.

- **제본 최소 쪽수 vs 호스트 쪽수 범위**(10-05 발견, 양사 공통): 양사는 신규 편집에 항상 `bindingType=perfect` 를 보내고(spinePolicy 미설정 — 10-05 발견 시점. 이후 bookmoa 동화책은 R-217 로 hardcover 전송, §3), 편집기는 무선제본 최소 32쪽을 삭제 하한·설정 패널 한도에 적용한다 → 범위 최소 16 인 상품(bookmoa·printy 편집기 상품 4종 모두)에서 쪽을 늘리면 범위 최소로 되돌릴 수 없다(완료는 막지 않음). 오너 결정(10-05): bookmoa 에 사실 공유·검토 요청 → **bookmoa 오너 결정 '둘 다'**: ① Storige 에 '호스트 pageCountMin·Max 가 있으면 제본 최소·최대 대신 범위 적용' 요청(**Storige 오너 결정 10-05: Wave 5 로 착수 — 설계안 오너 보고 후 구현, 배포 별도 승인**, printy 도 이 안이면 코드 변경 0) ② bookmoa 는 양장 선택·하드커버 상품에 hardcover 전송 검토 — Storige 사실 회신 발신(207c458f 표지 flat-spread 라 책등 무변, f0335fda 는 책등 자동 계산형이라 hardcover 면 책등 약 +1.5mm(운영 margin perfect 0.5·hardcover 2.0), hardcover 는 서버 표지 크기 검증 미적용).

- **Wave B 플래그 전환 — 결정·적용 완료(10-08)**: `JOB_LINK_STRICT=true`(14:37:16Z), `JOB_FILE_SITE_STRICT` 는 관측 연장. 근거·절차는 비공개 메모(`../_private_notes/wave2/`, `../_private_notes/wave8/NEXT_ISSUES_2026-10-08.md` §1).
- `SESSION_JOB_OUTPUT_LOOKUP`(기본 false) 전환: 전제·확인 절차는 비공개 메모(`../_private_notes/wave3/`).
- IIFE 번들 재빌드(VPS `build:embed:prod`, 파트너 미사용).
- Sentry 과거 이벤트 정리 · admin 편집기 호출 방식·admin Sentry 전처리(상세 비공개).
- files·D6: 백필 재실측(D6 선행 ③) · 게이트 거부 코드(`FILE_NOT_FOUND` 404 재사용 금지 원칙 유지) · 100p·MD2Books 조율.
- 09-30 §5.0 계승: 3-B(3) 자동 반영 · 결속 API O1~O5(+고아 정리 실가동·파기 계약) · 호스트 고정 책등 규칙 · branch protection · compose 기본값 · 8/24 통지 4종 · caseBind · `SPINE_PARAMS_UNRESOLVED` · 폰트 라이선스 · `PRINT_NORMALIZE` ON · 지종별 TAC · 에셋 소싱 · R6·R10 · 스프링 표지 펼침 1장·가로형 제본 변 · 표지 기본 디자인 · ShareSnap·북모아 메인·MD2Books 연락 채널.

### 5.2.1 다음 개발 이슈 정리 (2026-10-06, 오너 보고 — Wave 8 구성 결정 대기)

- 오너 지시(10-06): 인쇄팀 확인·양사 e2e 는 추후 일정. CTO 가 다음 개발 이슈를 정리·보고. 전수 목록(100건, 검증·근거·승인 포함) 정본은 비공개 메모 `../_private_notes/wave8/NEXT_ISSUES_2026-10-06.md`.
- **P0**: ① master CI 복구(`558c293` lint 회귀 2건 → skipped 단계 첫 실측) ② 의존성 보안 권고 패치(`pnpm audit --prod` 119건: critical 2·high 49 — 메이저 승격 제외) ③ Wave B 플래그 판단(10-08 09:51Z 이후, 오너 결정).
- **Wave 8 진행(10-06, 오너 승인: 안 2 · 1단계+2a 구현 · master 직접 push · 보안 패치 editor·canvas-core 분리 · 1단계+2a 연속 배포)**: 설계·결정 정본 비공개 `../_private_notes/wave8/DESIGN_W8.md`·`CTO_DECISIONS_W8.md`. **1단계 배포 완료**: push `776ac0e` 07:57:16Z → **master CI 10-01 이후 첫 green**(test 6m11s·embed-e2e 4m52s) · Vercel editor `n8zp637da`·admin `luw3mayxr` Ready → VPS 롤백 태그 `rollback-pre-wave8`(api fe75e1063d85·worker 3be1bd99732e) → worker 08:09:11Z(sharp 0.35.5/vips 8.18.7, mysql2 3.24.5) → api 08:12:05Z + nginx 08:12:41Z → 스모크 정상(health ok, 무인증 401 ×3, with-templates shape 불변, [FLAGS] 동일, 오류 로그 0, 큐 0). DB 변경 없음. 보안 권고 119 → 89(C1·H30 — editor·canvas-core 분리·multer ~2.3.0 고정·tar/http-cache-semantics/fabric 메이저 잔여). **2a 배포 완료**: push `c6c38ef` 08:14:05Z → CI green(test·embed-e2e — 싸바리 회귀 스펙 포함) · Vercel editor `gmboy5bm1`·admin `kolxzkmiv` → api 태그 `rollback-pre-wave8-2`(4c6b0af81ac2), 큐 0 → api 08:23:43Z + nginx 08:24:09Z(worker 변경 없음) → 스모크 정상(health 200, 무인증 401, with-templates shape 불변, 오류 0, '참조 템플릿 누락' warn 0). 효과: [표지 spread → 내지 spread] 결합 세트(운영 8 — 207c458f 포함) 세션의 내지 검증 기대 크기 = 펼침면(예 420×210) → SIZE_MISMATCH 오검증 해소(펼침 수 4의 배수가 아니면 PAGE_COUNT_INVALID 로 FIXABLE 잔존 — **N-API-3b 후속**). 양사 사전 고지·완료 통지(ACK 불요), bookmoa 영향 없음 회신. **N-API-3b 배포 완료(10-06, 오너 승인 — D1 데이터 정비·D2~D4 권고·구현부터 배포 연속, printy ACK 는 창구 미가동으로 오너 예외 승인·사후 통지)**: 편집 완료 내지 검증 잡에 편집기 쪽 단위(세션 호스트 `pageStep` → 템플릿셋 `page_step`)를 PDF 쪽 단위 `pageMultiple` 로 주입(펼침면 ÷2, 중철 lcm 4·상한 64/호스트 max, 단위 없는 낱장 세트는 종전) → 내지 펼침면 세트 20·28·36·44쪽·2쪽 단위 상품 18·22쪽 오검증 해소. 커밋 `61e7413`(api)·`5a8d433`(FREEZE v1.15·가이드 3종·템플릿 가이드 §7-3)·`1c9b120`. CI green → api 15:39:23Z + nginx 15:39:49Z, 스모크 정상([FLAGS] EDITOR_CONTENT_PAGE_RULES=true, 오류 0). bookmoa 사전 ACK(영향 없음)·완료 통지, printy 사후 통지 → **ACK(이의 없음·영향 0, 무선 2쪽 = bookmoa 와 동일, page_step 빈 세트 연결 상품 0)**(창구 「20261005 Printy 오픈준비 개발 계속」). D1 데이터 정비는 **보류**(감사: NULL 27 중 실효 대상 없음 — 상품 연결 때 page_step 등록, 동화책 13종 4/8 파트너 질의). 후속: 펼침면 세트 오류 문구를 쪽 기준으로(worker), fix-pagecount/attach 펼침면 단위, N-WK-1, R-195 env 스냅샷 등록.
**Wave 8 2b 배포 완료(10-07, 오너 승인 B′·D4 차단·권고안·구현부터 배포 연속)**: 재편집은 세션 세트 우선(세션 세트 404 + URL 세트 다를 때만 1회 폴백, 그 밖 fatal), editor.ready/storige:ready templateSetId = 실제로 연 세트 + `templateSetMismatch?`, editor.complete·storige:completed `templateSetId?`·`templateSetMismatch?`, Sentry `[template-set-mismatch]` 세션당 1회, AI 패널 세트 전환은 세션이 연결된 편집에서 차단·새로 편집 안내(운영 AI API 부재로 현재 실영향 0), SDK complete templateSetId·spineWidthMm·mismatch 판독. IIFE 번들 재빌드 없음(D7). 커밋 `c8d7df5`(코드·테스트·FREEZE v1.16·가이드·공지 `PARTNER_NOTICE_REEDIT_TEMPLATESET_2026-10-06.md` 단일 커밋) → CI green(37640477950) → editor `diqgayglo` Ready 14:53:59Z(번들 반영 확인). 양사 사전 ACK(코드 변경 없이 호환 — 재편집 URL templateSetId 0건, payload.templateSetId 1순위)·완료 통지. 롤백: Vercel `gmboy5bm1` promote. 후속: SDK `TemplateSetMismatch` 공개 export, isMounted·Sentry throw·reinit 단독 테스트, orderSeqno 세트·mode 필터, NULL 세트 세션 무이벤트 경로, handleLoadSession NULL, AI 세트 전환을 새 세션으로 처리(AI API 활성 시), GUIDE editor.ready orientationMismatch 표기.
**남은 Wave 8**: 없음(1단계·2a·2b·N-API-3b 완료). 이전 문구 — 2b 재편집 템플릿셋 가드(N-ED-1·editor.complete templateSetId·SDK spineWidthMm) — 오너 결정·운영 읽기·파트너 확인·양사 ACK 선행. 후속: N-API-3b, tar·http-cache-semantics·fabric 메이저, editor 경로 의존성(분리분), IIFE 재빌드.
- **추천 Wave 8 = 게이트 복구 + 동화책 전환 사전 정비**(2단계): 1단계 CI·보안 패치·/embed CI 편입·문서/주석 스테일 정정 → 2단계 결합 세트 내지 기대 크기(`resolveInnerSpreadContentSizeMm` 첫 spread 만 봄 → 표지 먼저인 동화책 세트는 판형 한 면 폴백)·템플릿셋 `copy()` 필드 유실·admin caseBind 잔류 가드·누락 템플릿 탐지·싸바리 회귀 E2E·운영 템플릿셋 정합 인벤토리·관찰 런북·재편집 templateSetId 가드(오너 설계 결정).
- 오너 결정 대기: Wave 8 안 선택, 플래그 전환, 재편집 가드 방식(ADDITIVE vs MODIFY-TARGET), 운영 DB 읽기(인벤토리·실측), branch ruleset, compose 기본값, fabric 7 승격 시점, Dependabot, 신규 파트너 연락 채널, 관리자 화면 E2E 시간.

### 5.2.2 다음 개발 이슈 정리 (2026-10-08, 오너 보고 — Wave B 판단·Wave 9 구성 결정 대기)

- 정본 비공개 `../_private_notes/wave8/NEXT_ISSUES_2026-10-08.md`(10-06 목록 110건 상태 대조 + 신규 27건, 4관점 수집·반박 검증, 코디네이터 실측 반영).
- 10-06 대비: done 15 · partial 10 · obsolete 1(N-TD-4 동화책 13세트 — 연결 계획 없음).
- **P0**: ① Wave B 플래그 판단(10-08 09:51Z 이후, 오너) — Loki 7일 실측 결과 관측 로그 0·worker-jobs/edit-sessions 요청 27건 전부 배포 스모크(실 호출 0). 권고 JOB_LINK_STRICT 켜기·JOB_FILE_SITE_STRICT 관측 연장 ② `EDITOR_CONTENT_PAGE_RULES` 가 docker-compose api environment 에 매핑돼 있지 않음 → env 킬스위치 롤백 불가(현재 롤백 = 이미지 태그 `rollback-pre-n-api-3b`) — compose 1줄 + api 재생성 ③ 운영 편집기 AI 탭이 빈 패널(`VITE_ENABLE_AI_PANEL` 미설정 → 탭 노출, `VITE_AI_ENABLED=false` → 패널 미포함, 운영 번들 확인) ④ CI `ubuntu-latest` 가 2026-10-19 부터 Ubuntu 26 → `ubuntu-24.04` 고정.
- 권고 Wave 9 = 안 1(운영 안전·CI 게이트·서버 보안 마이너: N-OPS-5·N-OPS-4·CI nest build/lint·N-NEW-1 서버 런타임 마이너·N-API-14a·N-OPS-10a·런북 갱신·동화책 전환 SQL 팩·FILE_SITE 계약 초안·DEPLOYMENT/RESUME 스테일). 안 2(편집기·임베드 후속 + editor 보안 마이너)는 bookmoa e2e 뒤.
- **오너 결정(10-08)**: Wave B = JOB_LINK 만 켜기 · P0 3건 진행 · **Wave 9 보류**. **배포 완료(10-08)**: 커밋 `5ef27c0`(compose 킬스위치 매핑·editor `VITE_ENABLE_AI_PANEL=false`·CI/gitleaks `runs-on: ubuntu-24.04`) push 14:17:41Z → CI 37791275517 green(test 1회 간헐 실패 `apps/worker/src/utils/synthesis-input.spec.ts:330` qpdf 1ms 시간 초과 경합 → 재실행 통과, 러너 이미지 ubuntu-24.04 동일) · Vercel editor `8taztq201` → VPS .env 백업·`rollback-pre-wave-b` 태그·pull `5ef27c0` → .env `JOB_LINK_STRICT=true` → api 재생성 14:37:16Z(재빌드 없음) + nginx 14:37:25Z → 스모크 정상([FLAGS] JOB_LINK_STRICT=true·JOB_FILE_SITE_STRICT=false·EDITOR_CONTENT_PAGE_RULES=true, health 200, 무인증 401, with-templates 3세트 200 구조 불변, 경고·오류 0, nginx 5xx 0). 3사 사전 안내·완료 통지(bookmoa 영향 없음 회신). 후속: qpdf 시간 초과 테스트 간헐 실패 안정화, Node 20 대상 액션 메이저 bump, ubuntu 26.04 사전 검증.

### 5.3 다음 후보 (착수 약속 없음 — 새 세션이 재점검 후 우선순위 제안)

| 후보 | 출처·메모 |
|---|---|
| ~~첫 종결 보고와 재수신 동시 실행 경합 정리~~ | Wave 4 에서 결과 기록 조건부 갱신·도서 확정 조건부 전진으로 반영(10-05 배포) |
| ~~합성 실패 응답 `errorDetail` 범위 축소~~ | Wave 4 반영(10-05 배포) |
| ~~F-4 입력 오류 타입화~~ | Wave 4 반영(10-05 배포) |
| 관리자 세션 범위 판정(staff-edit-data) 정합 | Wave 3 후속(상세 비공개) |
| ~~편집기 create POST 재시도~~ | Wave 4 반영(회원 create 재조회 후 1회 재전송, 10-05 배포). 서버 측 세션 생성 멱등은 후속 |
| 웹훅 v2 WH-005 와 `session.*` 발신 재개 | 양사 수신부·bookmoa S10 과 함께. 3-B(3) 자동 반영의 선행 |
| X1F-2a 표지 TrimBox · X1F-2c 첨부 원본 정리본 · 썸네일·조판 미리보기 | X1 알려진 한계 |
| ~~compose 매핑(`FILE_ORPHAN_*` 등)~~ | Wave 4 반영(10-05 배포, 기본값 무변). 코드 하한·compose·코드 정합 spec 은 후속 |
| 운영자 권한 리뷰 잔여(201 라우트 감사 status_code·인터셉터 부하) | 가드 단계 거부 감사 행은 `a245b0f` 에서 반영 — 잔여 2건은 코드로 재점검 |
| `/embed` 쪽수 로더 실브라우저 QA | Wave 4 로컬 Playwright 스펙(모킹, 운영 코드 HEAD 기준 27건 통과). CI 편입·실 API 왕복은 미검증 |
| 상품-템플릿셋 연결 사이트별 조회 | `findByProduct` 가 sortcode 만 봄(공유 행) — 파트너별로 다른 세트를 기본으로 둘 수 없음. API 키 사이트 필터 + 사이트 지정 행. 코드·계약 변경, 설계·오너 승인 필요 |
| 재편집 템플릿셋 복원 가드 | 재편집 URL `templateSetId` ≠ 세션 `templateSetId` 일 때(embed 는 URL 우선, 서버 완료 검증은 세션 값) — 동화책 매핑 전환 뒤 옛 장바구니 재편집 위험. bookmoa 는 자체 완화를 전환 뒤 후속 트랙으로 진행. 설계·오너 승인 필요 |
| ~~`editor-spread-validation-options.ts` 머리말 주석 정정~~ | Wave 8 1단계(N-QA-3)에서 정정(현재는 표지 검증 잡만 FAILED, 세션 불변 — 주석만, 다음 api 배포 동승) |
| 면≠판형 기존 양장 세트 내지 크기(H1 후속) | 저장 세션 실측 뒤 별건(동화책 낱장 7·A4 하드커버 2) |
| 로드맵: 임베드 D-4a/b/c · R3b 지종별 TAC · 에셋 A4/A5/A8·시드 · R6 CutContour · R10 · admin stage1b · `with-templates` 배치(S11) · 동화책 왕복 실기 · 폰트 시딩 | 09-30 §5.1 |

---

## 6. 상시 함정

- **파트너**
  - "0건·없음" 결론에는 집계 시각(UTC)을 붙인다(DB `created_at` 은 UTC).
  - 검증 판정 변경은 곧 파트너 `validation.*`·합성 결과 변화다. 판정을 바꾸기 전에 운영 실데이터로 기대식을 먼저 대조한다.
  - 양사 `orderSeqno` = 장바구니 초안 id → 통지·조회 식별자는 **sessionId**.
  - 파트너 세션이 실행 중이 아니면 ListAgents 에 안 보인다 → `list_sessions` 로 `local_` id 를 찾아 보낸다. 데스크톱 앱 재시작 뒤에는 채널을 다시 확인한다.
- **MariaDB**
  - `JSON_EXTRACT` 불리언은 문자열 'true' 를 돌려준다(`JSON_VALUE` 는 '1'). `JSON_TABLE` 조인은 collation 을 명시한다.
  - 세트-템플릿 연결은 `template_sets.templates` JSON 이다(레거시 `template_set_items` 아님). 세션 status 값은 'complete'.
- **스키마·메타데이터**
  - prod 는 `synchronize=false` — SQL 을 먼저 수동 적용한 뒤 API 를 배포한다(`apps/api/migrations/`).
  - 세션 `metadata` 업데이트는 얕은 병합이라 중첩 객체를 부분 전송하면 통째로 덮인다.
- **배포**
  - 순서 worker → api. api 를 재생성하면 nginx 재시작 필수(리터럴 `proxy_pass` 로 IP 고정). 직전 이미지 태그를 먼저 보존한다.
  - Vercel 대기 루프는 **새 배포 id** 를 매칭한다(이전 Ready 행을 잡아 조기 종료한 사고가 있었다). 문서만 바꾼 push 는 Canceled 가 정상.
- **의존성·lockfile**
  - `pnpm add` 는 공용 의존성(@babel/runtime 등)까지 dedupe 한다 → 되돌리고 lockfile 에는 해당 importer 항목만 넣은 뒤 `pnpm install --frozen-lockfile` 로 검증한다(다른 패키지 버전 불변 확인).
- **셸**
  - zsh 는 따옴표 없는 변수를 단어 분리하지 않는다 → 커밋 스크립트는 `/bin/bash` 배열(`files=(…); git add -- "${files[@]}"`)로 쓴다.
  - zsh 에서 `echo ===` 금지, `GID`·`UID` 변수명 금지, `PIPESTATUS` 대신 `pipestatus`. 사용자용 bash 블록에 자리표시자를 넣지 않는다.
- **리뷰**
  - 서브에이전트·워크플로 결과는 주장이다. 발견은 반박 검증을 거친 것만 반영하고, 반박된 것은 이유와 함께 비공개 메모에 남긴다.
  - 공개 저장소 문구(커밋 메시지·테스트 제목 포함)는 변경 후 동작만 쓴다. 최종 리뷰에서 테스트 제목 표현으로 NO_GO 가 난 적이 있다.
- **커뮤니케이션**: 사용자·파트너에게 보이는 모든 텍스트(진행 안내·도구 설명 포함)는 한국어로 쓴다.

## 7. 세션 종료 규칙

- 작업 묶음마다 이 문서(또는 새 날짜 RESUME)를 갱신하고, gitleaks 를 통과시킨 뒤 명시 경로로 커밋·푸시한다(문서 push 도 오너 승인 범위 안에서).
- 새 날짜 RESUME 를 만들면 옛 문서 머리말에 정본 이동 한 줄만 추가하고 나머지는 이력으로 보존한다.
- 종료 전에 완료·미완료·다음 행동을 남기고, 파트너에 세션 교대 예고(새 세션이 이름을 통지)를 보낸다.
- 비공개 결정·근거는 `../_private_notes/<wave>/` 에만 둔다.
- 세션 히스토리(`~/.claude/projects` 등)는 절대 삭제·이동하지 않는다.
