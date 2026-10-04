# RESUME PROMPT — 2026-09-30 (Storige · CTO 오케스트레이션 · 파트너 협업)

> ⏩ **2026-10-04 부터 정본은 `RESUME_PROMPT_2026-10-04.md` 다.** 이 문서는 09-30 ~ 10-04 이력으로 보존한다. 새 세션 시작 프롬프트도 10-04 문서의 것을 쓴다.

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

## 1. 현재 라이브 상태 (2026-10-04 00:43Z — Wave 3 배포 후)

| 구성 | 현재 운영 | 롤백 |
|---|---|---|
| DB | 09-28: `template_sets.page_step`·`pad_to_page_step` / 09-29 09:57Z: `20260929`(운영자 권한·감사 테이블) → `20260930`(sites.edit_retention_days·origin/actor) — 전부 ADDITIVE | 백업 `~/backup-sites-pre-staff-edit-20260929.sql`·`~/backup-template_sets-pre-padstep-20260928.sql`. 컬럼·테이블은 남겨도 무해 |
| api | `f63c8ae`(Wave 3, 10-04 00:41Z) + nginx 재시작. 플래그 `JOB_LINK_STRICT`·`JOB_FILE_SITE_STRICT`·`SESSION_JOB_OUTPUT_LOOKUP` = false(기본) | `storige-api:rollback-pre-wave3`(=`9e2a817`) → `rollback-pre-1003`(=`4f28e52`) → `rollback-pre-stage3` → … (태그 → `latest` 재지정 후 `up -d --no-build api` + nginx 재시작). **Wave 3 이전 코드로 되돌릴 때는 오너 승인 뒤 데이터 정리 절차 먼저**(비공개 메모 `../_private_notes/wave3/`) · 롤백 순서 api → (합성 큐 delayed·active 소진 확인) → worker |
| worker | `f63c8ae`(Wave 3 — 합성 재시도 의미론, 10-04 00:38Z) | `storige-worker:rollback-pre-wave3`(=`9e2a817`) → `rollback-pre-1003`(=`1c52c80`) → …. X1(+contentTrim)만 끄려면 `.env` `WORKER_TRIMBOX_SIZE_CHECK=false` 후 worker 재생성 |
| editor | Vercel `qftv0kx8t`(`f63c8ae`, 10-04 00:35Z — getState 페이지 필드·남은 문구) | `65j5xwzgg`(`9e2a817`) → `dnmu12g57` promote. IIFE 번들(VPS `build:embed:prod`)은 미재빌드(파트너 미사용, 오너 결정 뒤) |
| admin | Vercel `oylw176wy`(`f63c8ae`, 10-04 00:35Z — 검증 결과 TrimBox 표시·컴포넌트 테스트) | `l6f2dhp0f`(`9e2a817`) → `isxgg1mpv` promote |

- origin/master = `f63c8ae`(+ 이후 문서 커밋). VPS 체크아웃 = `f63c8ae`. 계약 정본 CONTRACT_FREEZE **v1.10**.
- DB 마이그레이션 없음. 로컬 백업 브랜치 `backup/wave1-pre-regroup-2026-09-30`(push 안 함, 커밋 재구성 전 상태 — 필요 없으면 삭제).
- 배포 방식:
  - editor·admin: master push 가 곧 배포다(**push 전 승인**). 문서만 바꾼 push 는 Vercel 빌드가 Canceled 되고 기존 Ready 가 유지된다.
  - api·worker: VPS 에서 수동 배포한다(`CLAUDE.local.md` §6). **api 를 재생성하면 nginx 재시작이 필수**다.
- 런타임: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`.
- 운영 사이트 편집데이터 보관기간: **전 사이트 미설정(NULL)**. 양사 요청으로 이 상태를 유지하며, 설정할 때는 사전에 통지한다.
- 실사용 전 기능(09-30 04:12~04:24Z 실측): 운영자 권한 발급·감사 0행. printy 최근 24h 신규 세션 0건.

### 검증 기준선 (이보다 낮으면 회귀)

| 대상 | 기준 |
|---|---|
| api jest | 130 스위트 / 2579 · tsc 0 |
| worker jest | 30 스위트 / 1071 · tsc 0 (로컬 gs 설치 시; gs 부재 시 GS 블록 skip) |
| editor vitest | 102 파일 / 1424 · tsc 0 · 빌드 · build:embed |
| admin vitest | 16 파일 / 209 · tsc·eslint 0 · 빌드(컴포넌트 테스트는 `.test.tsx` + happy-dom docblock) |
| sdk | 12 / 359 · tsc 0 |
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

- **09-30 04:30Z 새 Storige 세션 시작 — 창구 확정(ACK)**: Storige = 「20260930 Storige 편집기·워커 개발」.
  - bookmoa = PID 95699(04:19:24Z 시작, cwd bookmoa-mobile 확증) · `local_bf71565d-e946-487b-a8e4-27962fe7626a` · 목록 표시명 「20260930 북모아 관리자 수정 시작」(세션 자체는 「북모아 Printable 개발 계속」이라 부름). 옛 「20260928 북모아 개발 계속」 사용 안 함.
  - printy = PID 2974(04:24:48Z, cwd printy 확증) · `local_6494a1a2-…` 「20260930 Printy CTO 개발 계속」 ACK.
  - bookmoa R-207 배포(`06eb8a5`, new.bookmoa.com): 결속·operator-session 에 소문자 UUID 만 허용, idem replay 는 재결속 안 함. Storige 계약 변경 없음. printy 가 R-207 이식 예정.
  - 사실 확인 회신(04:32Z): 세션 id = `@PrimaryGeneratedColumn('uuid')` 소문자 v4, 운영 122행 대문자·비UUID 0행(04:32:19Z UTC).
  - bookmoa [회신 필요] 수신(R-207 후속, 상세 비공개): 주문 결속 전 **세션 소유자 서버 간 조회** 요청. 04:4xZ 사실 회신 발신 —
    ① X-API-Key 로 sessionId→소유자 조회하는 기존 라우트 없음(`/edit-sessions/external` 은 orderSeqno 기준·memberSeqno 미포함, `GET :id` 는 JWT)
    ③ `guest/migrate` 는 memberSeqno 를 흡수 회원으로 교체·guestToken 제거
    ④ 전역 Throttler 300회/60s, 지연은 미실측 추정(수십 ms)
    ⑤ orderSeqno 는 생성 시에만 설정·불변.
    ② 신설 `POST /partner/edit-sessions/owners`(1~50 배치, 타 사이트·삭제·없음 = found:false)는 **오너 결정 대기**(계약 변경 → CONTRACT_FREEZE·contract-freeze.spec 동시 등재 필요).
- **09-30 Wave 1 오너 승인(04:4xZ)**: 우선순위 5개 병렬 착수 — ① 게스트 세션 읽기 경로 교정(보안, 상세 비공개, 2단계) ② 세션 주인 조회 API 신설 `POST /api/partner/edit-sessions/owners`(B1) ③ 편집기 산출물 site 스탬프(P3-1) + 관리자 산출물은 **세션 siteId 로 스탬프**(N1, 오너 결정) ④ 편집기 오류 수집 토큰 정리(S3) + EmbedView 배선 테스트(T1) ⑤ X1 실측 + 기동 로그 플래그 스냅샷(S4·N2). 배포는 직전 확인 1회. 파트너 조율·후속 추적은 CTO 주도.
  - 착수 통지·사실 질의 발신(04:4xZ): bookmoa·printy(B1 초안·Q1~Q4), 100p(Q1 presigned complete·Q2 DELETE 404).
  - **회신 요지**(모두 코드 기준):
    - 100p(`7101c38`): 90MB 초과 PDF 는 presigned-upload-public(무인증) → R2 PUT → `/files/:id/complete`(X-API-Key 편집기 키). **→ P4(complete site 스탬프)는 유효 — stale 아님.** `DELETE /files/:id/external` 404 = 성공 처리(라우트 부재 404 도 성공) → 경로를 없애거나 404 로 바꾸면 fileId 참조를 지워 고아 발생. 폐기 시 405/501 권고.
    - printy(`822cee2`, R-207 이식 04:35Z): 파일 접근은 전부 printy 키 또는 printy 발급 shop JWT. `GET /edit-sessions/:id` 호출 없음(DELETE 1곳, 회원 JWT). `session.validated` 는 vestigial KV 만 갱신 → 주문 무영향.
    - bookmoa(`126ff08`): 파일 접근은 bookmoa 키 또는 shop JWT. 브라우저 직결 대용량 업로드(presigned·multipart 무인증, complete 는 회원/게스트 shop JWT 또는 Bearer 없음) — **새 규칙에서도 bookmoa 사이트 귀속·업로드 무중단 확인 요청**. `GET /edit-sessions/:id` 호출 없음. `session.validated` 는 레거시 KV 만(무시와 동일). owners 응답 게스트 정규화 동의.
  - 100p 통지(`e32edc1`): DELETE `/files/:id/external` 404 는 **본문 `code:"FILE_NOT_FOUND"` 일 때만 성공**, 그 밖의 404 는 실패(참조 유지). **Storige 운영 원칙 등록**: ① 이 404 `FILE_NOT_FOUND` 본문 유지(변경 시 사전 통지) ② 경로 제거·이동 시 사전 통지 ③ D6·사이트 스탬프 게이트 거부는 `FILE_NOT_FOUND` 404 재사용 금지. ACK 발신. 이어서 X1 로 100p `validate/external` 결과가 실패→통과로 바뀔 수 있다고 정정 통지(배포 시 필드·UTC 재통지).
  - X1 실측(04:46Z UTC, 읽기 전용): 신발장 내지 2건 = MediaBox 236×323mm 이나 **TrimBox 210×297mm 정확**(사방 13mm 재단선, 1건은 BleedBox 3mm) → **오탐**. 흰발이 동화책 1건 = 모든 박스 286×286mm·TrimBox 없음 → 정상 거부. **오너 결정(09-30): TrimBox 기준 판정 진행** → Wave 1 에 worker X1 레인 추가. 설계+2렌즈 비판 뒤 CTO 결정(05:20Z): 내지만·기존 판정 먼저·전 페이지 명시 TrimBox 엄격 일치(회전·UserUnit·불완전 시 미적용) → 경고 `TRIMBOX_SIZE_BASIS`+`metadata.trimBox`(additive), 도련 = 명시 BleedBox−TrimBox 최소값, 합성·변환 입력 임시 사본을 TrimBox 대칭 확장 박스로 크롭(작업 크기→주문 bleed→min(선언,3mm)), 킬스위치 `WORKER_TRIMBOX_SIZE_CHECK` 코드 기본 ON + compose `:-true`. 원본은 재단선 포함 보존(원본 정규화 사본 등록·표지·썸네일은 후속). 로컬 gs 10.08.0 설치(운영 10.07.1, qpdf 12.3.2 동일).
  - 운영 `.env` 플래그(04:47Z, 불리언만): CUTOUT·LIGHTWEIGHT_VALIDATION·LIGHTWEIGHT_SYNTHESIS·CROP_MARK_VALIDATION·WIRED_FIXABLE_GATING = true / PRINT_NORMALIZE·FLATTEN·FILE_ORPHAN_* 미설정(코드 기본값). VPS HEAD `47f9a61`.
- **09-30 Wave 1 진행(05:5xZ)**: 설계 워크플로(계약 4 + X1 1, 각 비판) → CTO 결정 → 구현 워크플로(5 레인, 42 에이전트: 구현·보안/정합성 리뷰·발견별 반박·수정) → 메인 통합.
  - 통합 검증(HEAD+작업트리, 05:2xZ): api tsc 0·jest 110/1923, editor tsc 0·vitest 85/1066·build·build:embed 통과(lint 경고 5건은 HEAD 기존).
  - 메인 통합 반영: 게스트 조회 라우트 헤더 전용, 요청 로그·Sentry 필터 URL 토큰류 쿼리 값 가림(`url-redact.helper`), contract-freeze 등재, 만료 sweep 보호절 기준 SQL 갱신.
  - 로컬 커밋(미push): `2736dec` 스테일 문서·D-11 추인 / `86b415b` 게스트 조회 경로 / `e244ba9` owners API·산출물 사이트 귀속 / `2de2d46` api 플래그 스냅샷·URL 가림·CORS / `fd4bac6` 편집기 오류 수집 정리·EmbedView 테스트 / `539987a` worker X1 TrimBox / `d493ed0` worker 플래그 스냅샷·CI ghostscript. 이어서 문서 커밋, 마지막에 편집기 게스트 로드 전환(2차 push 전용).
  - X1 경과: 설계+2렌즈 비판 → 구현(3렌즈 리뷰, 확정 13건 수정) → 수정 과정에서 파일 B 가 다시 거부되는 조건이 생겨 CTO 보정(X1-R2): 판정 = 엄격 기하 + TrimBox 대칭 주문 도련 박스 ⊂ MediaBox, 도련 = 명시 BleedBox 기준. 합성(기대 크기 미지)은 명시 BleedBox 밖 ≥5mm 균등 slug 일 때만 크롭, 변환(작업 크기 기지)은 정확히 맞춤. F1(fix-bleed 축소)은 반박 기각(검증 bleed = 템플릿 bleed), F2(경계 반올림) 수정, F3(BLEED_MISSING actual = bleedSize) 메인 반영.
  - worker 통합: tsc 0 · jest 26/829(로컬 gs 10.08.0 로 GS 테스트 실제 실행). 운영 gs 10.07.1·qpdf 12.3.2 → 배포 게이트에서 컨테이너 안 실측.
  - X1 알려진 한계(후속): 합성 산출은 주문 도련 대신 선언 도련(≤3mm) 또는 원본 박스 — API 가 합성 잡에 주문 도련·기대 재단 전달 필요. 표지·썸네일·조판 미리보기·원본 정규화 사본 미적용.
  - 후속(오너 결정): Sentry 과거 이벤트 정리, admin 편집기 호출 방식·admin Sentry 전처리(상세 비공개), 플래그 파싱 비대칭·compose 매핑, 게스트 조회 경로 2단계(상세 비공개).
- **10-01 같은 탭 비회원 초안 이어 열기 복구 배포(오너 승인)**: `e97c3f5`(+`bbb9381`) push 10:12:08Z → Vercel `dnmu12g57` Ready, 운영 청크 반영 확인. 같은 탭에서 '호스트·사이트·주문·mode·templateSetId → 비회원 세션'을 기억(토큰 미저장)해 주문 목록이 빈 비회원 재진입을 게스트 조회로 이어 연다. 회원 토큰·명시 sessionId·이벤트 계약 불변. 구현 워크플로(리뷰 확정 2건 수정: 회원 토큰 제외, 호스트·사이트 범위 키) → editor 87/1177. 양사 통지(bookmoa R-213 ACK, 실 e2e 재개 시 같은 탭 재오픈 1회 확인 예정).
- **10-03 세션 재개(데스크톱 앱 재시작 02:25Z)**: Storige 세션 id 불변(`local_20f149cd-…`). 파트너 세션은 실행 중이 아니어서 ListAgents 에 안 보임 → `list_sessions` 로 찾아 `SendMessage(to=local_…)` 로 전달(bookmoa `local_bf71565d-…`·printy `local_6494a1a2-…`·100p `local_69303599-…`). 세 세션 모두 10-01 10:13Z 이후 활동 없음, Storige 앞 미회신 질문 없음.
  - 운영 실측(읽기 전용, 10-01 10:13Z ~ 10-03 02:29Z UTC): api `4f28e52`·worker `1c52c80` 그대로, 신규 편집 세션 0·worker 작업 0(마지막 작업 09-30 02:28Z)·owners 호출 0·관측 로그 0·api 오류 0·shop-session 발급 3. 운영자 권한 발급·감사 0행. 테스트 비회원 세션 `0a4a8001…` 자동 삭제 확인(④ 종결).
  - 02:3xZ 양사에 세션 재개·실측 공유·실 e2e 재개 시점 질의 발신(ACK 요청).
  - printy ACK(창구 `local_6494a1a2` 그대로, 운영 `f7a574d` 이후 변경 없음): 실 e2e 재개 **미정**(오너 보류 유지, 정해지면 사전 통지). 추적 3건은 e2e 때 sessionId·UTC 로 공유.
  - bookmoa ACK(창구 그대로, 운영 R-212 `i1m2kzmz9` 이후 변경 없음): 실 e2e 재개 **미정**(오너 보류). 재개 시 먼저 통지 후 추적 3건 대조 요청 예정. bookmoa 실측: `app_config['p4-orders']` 0행 유지(R-209) — 웹훅 0건이라 웹훅 이후 유지 여부는 미확인.
  - **Wave 2 오너 승인(10-03 02:50Z)**: 재점검 워크플로(7 에이전트) → 우선순위 승인 — ① 편집기 오류·안내 정리(초기화 실패 NETWORK_ERROR 통일·orderSeqno 진입 일시 장애 시 새 세션 생성 대신 오류·비회원 완료 토스트·콘솔 오류 요약) ② API 작업 사이트 기록 + 차단 전환 준비(상세 비공개) ③ 운영자 감사(가드 단계 거부 행)·워커 stalled 작업 FAILED 정리 ④ X1 합성 주문 도련 전달(**B = templateSet.bleedMm**, editSessionId 있을 때만, fail-open) ⑤ files 관리자 판정 SUPER_ADMIN 포함. P4(100p presigned complete 사이트 기록)는 100p 회신 뒤 포함. **JD-1(worker_jobs 세션 연결 저장)은 다음 Wave**(양사 session.* 소비 질의 먼저). 레인·결정은 비공개 메모.
  - 02:51Z 착수 통지·사실 질의 발신: bookmoa·printy(Q1 editSessionId 항상 싣는지 · Q2 3mm 아닌 도련 상품·산출 크기 후속 검사 · Q3 orderSeqno 진입·NETWORK_ERROR 표시 · Q4 웹훅 중복·순서·v1/v2 · Q5 session.* 소비 · Q6 키 일관성(+printy compose-mixed 사용)), 100p(Q1 경로별 키 일관성 · Q2 Authorization·multipart · Q3 validate 옵션·폴링 타임아웃 · Q4 DELETE 비 FILE_NOT_FOUND 처리 · Q5 합성 계획).
  - 회신(02:4x~02:5xZ): bookmoa(`a148c6c`)·printy(`f7a574d`) — 합성은 항상 editSessionId 포함(세션 없으면 합성 미호출), 산출 크기 후속 검사 없음, NETWORK_ERROR 는 오류 카드에 payload.message 그대로(다시 시도 없음, 재열기 = 같은 orderSeqno), 웹훅 무저장·job-status 폴링이 권위, session.* 미소비, 서버 키 1개, printy compose-mixed 실호출 0. 100p(`1c011e6`) — 검증·잡 조회는 **워커 키**, 업로드·complete·다운로드·DELETE 는 편집기 키, 폴링 최대 2회 후 재조회 없음, DELETE 는 2xx·FILE_NOT_FOUND 404 만 성공, 합성 계획 없음.
  - 사실 회신 발신(02:5xZ): 100p 워커 키도 같은 100p 사이트로 판정(role editor — 바이패스는 내부 키만) → P4 뒤 검증 통과, 100p 사이트 파일 0·작업 3(06-20 스모크). 양사 편집기 상품 템플릿셋 bleed_mm 전부 3(호스트 bleed 3 일치), X1 예시 산출 A4 216×303·정사각 216×216·가로 303×216(재단선 첨부 내지만).
- **10-03 Wave 2 배포 완료(오너 승인)** — 상세 결정·잔여 위험은 비공개 메모 `../_private_notes/wave2/CTO_DECISIONS_W2.md`(저장소 밖, 3단계 메모는 `../_private_notes/stage3/`).
  - 흐름: 재점검(7) → 설계+비판(10) → 2차 CTO 결정(54건 처리) → 구현(5 레인·53 에이전트, 리뷰 34건 중 확정 1건) → 문서(12) → 최종 리뷰 3렌즈(10, GO/GO_WITH_FIXES — 차단 0) → 통합 검증 api 124/2416·worker 27/932·editor 97/1370·build 2종·sdk 12/349·tsc 0 → gitleaks 0.
  - 커밋: `814d36e` editor · `73274ce` worker · `b0a04a9` api 잡 사이트·플래그·contentTrim · `a245b0f` api 운영자 감사 · `03eca74` api presigned·files · `9e2a817` docs(FREEZE v1.9·GUIDE·PDF·DEPLOYMENT·`docs/partner-notices/PARTNER_NOTICE_WAVE2_2026-10-03.md`).
  - bookmoa 창구 표시명 「20260930 북모아 관리자 수정 시작」(같은 세션 `local_bf71565d-…`, 옛 이름 「북모아 Printable 개발 계속」은 오프라인 Remote Control 세션). bookmoa 원장에 Wave 2 기록(`4ee4261`).
  - 사전 통지·ACK: bookmoa(`a6810f7`)·printy(`f7a574d`)·100p(`b0f5d3a`) 모두 코드 변경 불필요. bookmoa 질의(AUTH_EXPIRED 뒤 토큰 갱신 대기?) → 대기 안 함(fatal, 호스트 명령 3종에 토큰 명령 없음) 회신.
  - 배포: push 04:51:41Z → Vercel `65j5xwzgg` Ready 04:52:35Z(운영 번들 새 문구 확인) → 롤백 태그 `rollback-pre-1003`(api=`4f28e52`, worker=`1c52c80`) → worker 04:55:41Z([FLAGS] TRIMBOX=true) → api 04:58Z + nginx([FLAGS] JOB_LINK_STRICT=false JOB_FILE_SITE_STRICT=false). 스모크 04:59Z: health 200, external·owners·audit·files 무인증 401, guest 토큰 없음 403, complete 무효 키 = 종전 응답. api·worker 오류 0·5xx 0·큐 0. 완료 통지 3사 발신. DB 마이그레이션 없음.
  - 반영 동작(공개): 편집기 초기화·저장 오류 code·고정 한국어 문구, 주문번호 진입 일시 오류 시 새 세션 없음, sessionId 단독 재오픈 실패 알림, 비회원 완료 안내, 오류 로그 요약·Authorization 가림 / 합성·채움 내지 contentTrim(B = templateSet.bleedMm, 예 216×303) / 운영자 감사 가드 단계 거부 행 / JOB_STALLED / presigned complete 사이트 키 귀속(P4) / files staff 에 SUPER_ADMIN / 잡 사이트 결정 규칙.
  - 남은 위험(비공개 메모): JD-4 판정·갱신 비원자(JD-3 전이 가드에서 해소), 데이터 스탬프는 api 롤백으로 되돌아가지 않음(옛 api 무해), TrimBox 가 재단과 1mm 넘게 다른 파일은 원본 박스 산출.
  - **다음 Wave 후보**: JD-1 세션 연결 저장(양사 session.* 미소비 확인 — WH-005 v2 와 함께) · JD-2/JD-3 재시도·전이 가드 · Wave B 차단 전환 판단(**10-08 09:51Z 이후**, 플래그는 이미 배포·env 만 전환, 기준은 비공개 메모) · X1F-2a 표지 TrimBox · X1F-2c 첨부 정리본 · X1F-3b admin 경고 표시 · editor-robust-3 getState 페이지 · create/createGuest POST 재시도 · EmbedView 재오픈 화면 문구·handleLoadSession INVALID_DATA 원문 · OA-4 admin 테스트 의존성.
- **10-03~04 Wave 3 배포 완료(오너 승인)** — 결정·계약은 비공개 메모 `../_private_notes/wave3/`.
  - 범위: ① 작업 상태 전이 가드(완료 뒤 FAILED 금지·같은 종결 재수신 시 웹훅 중복 생략·**시스템 실패(JOB_STALLED·JOB_TIMEOUT_SWEPT)만 늦은 COMPLETED 로 승격** — 오너 결정) + 합성 재시도(attempts 3, 30s→90s, 입력 오류 즉시 실패) ② 작업의 세션 연결 저장 복구(**저장만, session.* 미발신 유지** — 오너 결정, 세션 산출물 조회 전환은 플래그 기본 OFF) ③ 편집기 잔여 문구·로그·Sentry 정리 + getState·editor.state 페이지 필드(ADDITIVE)·SDK ④ admin TrimBox 경고·검증 결과 표시 + 컴포넌트 테스트 환경.
  - admin devDependencies 3개(@testing-library/react·dom, happy-dom) 추가: 첫 `pnpm add` 가 공용 의존성(@babel/runtime 등)까지 dedupe 해 되돌리고, lockfile 은 admin importer 9줄만 넣어 `--frozen-lockfile` 로 검증(다른 패키지 버전 불변).
  - 파트너 회신(05:3x~05:4xZ): 양사 합성 폴링은 FAILED 에서 항목 고정(120s 상한, 경합 가드) → 시스템 실패의 늦은 COMPLETED 는 파트너 주문에 반영되지 않음(재합성으로 복구, 현 운영도 동일) · getState 는 dirty 만 · 작업 응답 editSessionId 미사용. 운영 실측: JOB_STALLED·JOB_TIMEOUT_SWEPT 역대 0건, 06-01 이후 합성 6건 전부 COMPLETED. 회신 발신(파트너 변경 불필요, 구분은 errorCode 두 값).
  - 운영 실측(06:38Z): worker_jobs → file_edit_sessions FK ON DELETE SET NULL, edit_session_id 인덱스 있음, 연결 행 0/345 → JD-1 진행 조건 충족.
  - 흐름: 설계+비판(8, 47건 처리) → 2차 CTO 결정 → 구현(4 레인·56 에이전트, 확정 7건 수정) → 통합 검증 → 문서(9) → 최종 리뷰 3렌즈(14) → 확정 4건 반영(반복 종결 재수신의 후속 처리 멱등 재실행·**연결이 확인된 세션만 컬럼 저장**·롤백 문서·직전 이미지 보존) → api 재검증 130/2579.
  - 커밋: `c94cdbc` worker · `6fdbd32` api · `06a44f3` editor·sdk · `a24cd38` admin(+lockfile admin 9줄) · `f63c8ae` docs(FREEZE v1.10·GUIDE·DEPLOYMENT·`PARTNER_NOTICE_WAVE3_2026-10-03.md`). gitleaks 0.
  - 사전 통지·ACK: printy(`f7a574d`, 서명 identifier jobId 우선 확인 요청 → 코드 불변 확인), bookmoa(`1272b42`). 100p 영향 없음.
  - 배포(10-04 UTC): 직전 이미지 태그 `rollback-pre-wave3` 00:33Z → push 00:34:35Z → admin `oylw176wy` 00:35:20Z·editor `qftv0kx8t` 00:35:37Z Ready(번들 새 문구 확인) → **worker 먼저** 00:38Z → api 00:41Z + nginx([FLAGS] … SESSION_JOB_OUTPUT_LOOKUP=false). 스모크 00:43Z: health 200, external·작업 조회·상태 보고·owners·외부 세션 조회 무인증 401, guest 토큰 없음 403, 오류·5xx 0, 대기열 0. 완료 통지 양사 발신. DB 마이그레이션 없음.
  - 남은 위험·후속(비공개 메모): 첫 종결 보고와 재수신 동시 실행 경합(운영 코드와 같은 수준), spread 실패 errorDetail 의 stack·jobData 파트너 노출 축소, F-4 입력 오류 타입화(손상 PDF 등 재시도 대상), 관리자 세션 범위 판정(staff-edit-data) 정합, SESSION_JOB_OUTPUT_LOOKUP 켜기 전 운영 EXPLAIN·JOB_LINK_STRICT 전제, IIFE 번들 재빌드(오너 결정).
- **추적 중(다음 세션 인계)**: ① owners API 첫 실호출(bookmoa R-208·printy R-208) 응답코드·지연 대조·공유 ② bookmoa·printy 첫 실합성(사이트 키 + editSessionId) 운영 로그 대조 ③ 3단계 관측 로그 집계 후 Wave B(차단 전환) 오너 결정 — 비공개 메모 참조 ④ 테스트 비회원 세션 `0a4a8001…` 은 10-02 06:30Z 자동 삭제.
- **10-01 세션 판정 정리 3단계 Wave A 배포(오너 승인, 상세 비공개 메모)**: 양사 사전 통지·ACK(bookmoa 5e7a2ed·printy f7a574d, 영향 0 — 사이트 키 + 자사 세션 합성 경로 통과 테스트 고정). 편집기 `7e252ba` push 09:47:22Z → Vercel `6hv60qkny`. API·문서(CONTRACT_FREEZE v1.8) `558c293`·`4f28e52` push 09:48:54Z → 롤백 태그 `rollback-pre-stage3` → api 교체 09:51Z + nginx 재시작 → health 200, 스모크(게스트 라우트 쿼리 토큰 403, 무인증 401), error 로그 0. 일부 항목은 관측 로그만(관측 뒤 오너 결정).
  - 파트너 질의 회신: printy 신규 진입(templateSetId+orderSeqno)은 allowedOrderSeqnos 미송신이라 새 fatal 경로 비대상. **같은 화면 비회원 초안 이어 열기는 09-30 07:54Z 이후 새 세션으로 시작하는 회귀**(운영 비회원 세션 생성 0건이라 실제 영향 0) → 편집기 같은 탭 기억 기반 복구 진행 중, 양사 통지.
- **10-01 게스트 조회 경로 2단계 배포 완료(오너 승인)**:
  - 구현 워크플로(2레인 26 에이전트, 리뷰·반박·수정) → 통합: api 113/2048·editor 86/1119·sdk 12/349·tsc 0·build·build:embed.
  - ① 편집기·SDK `c89f6cb` push 06:30:03Z → Vercel `3359fipmg` Ready, 운영 청크에 새 사유 코드 확인. ② 운영 smoke 06:30:35Z: 공개 라우트로 테스트 비회원 세션 1건(`0a4a8001-9cdf-4784-b4ad-1c8a775eec4e`, 사이트 없음, 24h EVENT 자동 삭제) → 헤더 조회·저장·버전 200, 틀린 헤더 403. ③ 양사 사전 통지 → ACK(printy f7a574d·bookmoa f6674f4, 영향 0). ④ `d612ca6`+`361a9a4` push 06:31:34Z → 롤백 태그 `rollback-pre-guest2` → api 교체 06:34:06Z + nginx 재시작 → health 200, 스모크(회원 경로 무인증 401, 게스트 경로 토큰 없음 403 GUEST_TOKEN_REQUIRED, 키 없음 401), error 로그 0. 배포 완료 통지 발신.
  - **3단계 후속**: 세션 판정 정리 후속 항목 — 상세는 비공개 메모(저장소 밖)에 기록.
- **10-01 게스트 조회 경로 2단계 착수(오너 지시, 상세 비공개)**:
  - 운영 관측(03:19Z): 배포 후 회원 경로 비회원 조회 0건, 신규 세션 0건. DB(03:38Z): 음수 회원 번호 0, 무주 세션 0, guest_token 보유 세션 전 사이트 0. 사이트별 세션: bookmoa 65·북모아 메인 32(06-15)·ShareSnap 19(08-23)·printy 1·MD2Books 0.
  - 양사 착수 통지·질의(03:2xZ) → 회신: bookmoa = 비회원 재오픈 없음(흡수 뒤 회원 토큰), migrate 회원 JWT, 비회원 주문 결속 없음(bookmoa 오너 10-01), `#guestToken=` 동의. printy = 같은 탭 재진입 1곳(편집기 기억 토큰 의존), 새 탭 없음, migrate 회원 JWT, 비회원 주문 0.
  - bookmoa R-208(owners 확인 후 결속, `6915e47`·`a4qbz88rc`, 03:18Z)·R-210·R-211 배포. printy R-208·R-210·R-211 `b0e0924`·`printy-8qpvo3yza` 배포. printy 키 owners 수용 확인(role=editor, site active). **owners 첫 실호출 시 응답코드·지연 대조·공유 약속(양사)** — 03:22Z 기준 실호출 0.
  - 설계(2레인+비판) → CTO 결정(비공개 메모) → 구현 워크플로 진행. 배포 순서: 편집기·SDK 먼저 → 양성 smoke(오너 승인) → 양사 사전 통지·ACK → API.
- **09-30 Wave 1 배포 완료(오너 승인)**:
  - 커밋 재구성: 배포 전 최종 리뷰(NO_GO 1건 = 테스트 제목의 약점 서술)로 push 전 보강 — 파일 JWT 라우트(양의 회원 번호 소유 판정·호출자 사이트 대조·staff 대소문자 통일), 세션 목록(주문번호·사이트 조회 판정), 테스트 제목 중립화 → 로컬 9 커밋 재구성(`5e76d36`..`4fcf0a9`). 누출 검사·약점 표현 검사 0건.
  - 1차 push `1c52c80` 07:48:40Z → VPS 롤백 태그 `rollback-pre-wave1b` → build → **X1 게이트**(새 이미지 일회용 컨테이너, 운영 gs 10.07.1·qpdf 12.3.2): 파일 A 합성 210×297·변환 212×299, 파일 B 합성 216×303·변환 212×299, GS 재증류 뒤 TrimBox 중심 오차 0pt, 원본 불변 → api·worker 교체 07:54:05Z + nginx 재시작 → health 200, `[FLAGS]` api·worker 확인(`WORKER_TRIMBOX_SIZE_CHECK=true`).
  - 스모크(키 없이): owners 401(무키·잘못된 키), guest 조회 403(토큰 없음·쿼리만)·404(임의 헤더), CORS preflight `X-Guest-Token` 허용, external·목록 무인증 401 불변. 편집기 Vercel `4pxzkh0le` Ready.
  - 운영 이미지 읽기 전용 판정(07:5xZ): A 통과(+TRIMBOX_SIZE_BASIS+BLEED_MISSING, 도련 0), B 통과(도련 3), C SIZE_MISMATCH 유지.
  - 2차 push `4fcf0a9` 07:54:42Z → Vercel `jhn8wxb8b` Ready, 운영 번들에 게스트 조회 헤더 코드 확인(07:56:50Z).
  - 파트너 통지·ACK: printy(영향 0, owners 는 bookmoa diff 이식 예정, 4) 경로 미사용), 100p(파싱·게이트 영향 0), bookmoa(ACK, 4) 경로 미사용, 소유 검사 구현은 bookmoa 오너 결정 대기). bookmoa 질의 회신: TRIMBOX_SIZE_BASIS details 키·정보성 경고(동의 단계 제외 권고).
  - **후속(우선순위 순)**: ① 게스트 조회 경로 2단계(상세 비공개 — 편집기 전환 관측 로그 `[guest-read] member-route` 추이 확인 후, 양사 사전 통지) ② owners 첫 호출 시 운영 로그 응답시간 실측·공유 ③ X1 합성 잡에 주문 도련·기대 재단 전달(API) ④ 100p presigned complete 사이트 귀속(P4) ⑤ 편집기 게스트 저장·버전 호출의 헤더 전환 ⑥ Sentry 과거 이벤트 정리(오너 결정) ⑦ files SUPER_ADMIN staff 포함 여부(결정).
- **09-30 04:30Z 교대 예고 발신**: 양사(「20260930 북모아 관리자 수정 시작」·「20260930 Printy CTO 개발 계속」)에 "Storige 세션 종료 예정, 새 세션이 이름을 통지"를 보냈다. 새 세션은 시작 통지로 이를 닫는다. bookmoa 쪽에는 '이 세션이 bookmoa 창구가 아니면 알려 달라'고 확인도 요청했다.
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

> **실측 2026-09-30 04:31:14Z UTC**: `partner_operator_grants` 0행·`partner_operator_audit_logs` 0행, 최근 48h 편집 세션 0건, `orderOptions` 쪽수 범위 기록 세션 0건, site 스탬프 외부 합성 최신 05-03 → 항목 1~4 미발생. 양사도 실 e2e 오너 보류 중(ACK).
> 관찰: bookmoa-mobile 업로드 VALIDATE FAILED 3건(09-29 06:53·06:54, 09-30 02:28Z) — `현재 236x323mm`(A4+사방 13mm)·`286x286mm`(210 정사각+사방 38mm). 재단선·여백 포함 PDF 오탐 여부 조사 중(백로그 X1).

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

### 5.0 재점검 결과 (2026-09-30 ~04:40Z, 읽기 전용 워크플로 9 에이전트 + 반박 검증, 메인 코드 대조)

> 아래 원 목록(5.1)은 이력 보존용이다. **현재 상태는 이 표가 우선**한다. 보안 항목은 상세 비공개.

| 구분 | 항목 | 상태 | 근거 |
|---|---|---|---|
| Wave 1 착수 | 게스트 세션 읽기 경로 보강(보안, 2단계) | 진행 중 | 상세 비공개. 양사 `GET /edit-sessions/:id` 미사용 확인(09-30 회신) |
| Wave 1 착수 | 세션 주인 조회 API `POST /api/partner/edit-sessions/owners`(B1) | 진행 중 | bookmoa 요청·오너 승인 09-30 |
| Wave 1 착수 | D6 선행 ① 편집기 산출물 site 스탬프 + 관리자 산출물 세션 siteId 스탬프 | 진행 중 | `files.controller.ts:336` 이 `uploadFile` 에 siteId 미전달(서비스는 6번째 인자 수용) |
| Wave 1 착수 | 편집기 오류 수집 토큰 정리 + EmbedView 배선 테스트 | 진행 중 | `apps/editor/src/lib/sentry.ts` beforeBreadcrumb 없음, EmbedView 테스트 0건 |
| Wave 1 착수 | 재단선 포함 PDF TrimBox 기준 판정(X1) | 진행 중 | 판형이 MediaBox 로만 판정됨(`pdf-validator.service.ts:169`). 오너 결정 09-30 |
| Wave 1 착수 | 기동 로그 플래그 스냅샷(S4·N2) | 진행 중 | compose `:-false` 기본값, FILE_ORPHAN_* compose 미매핑 |
| 완료 | D6 선행 ② 세션완료 VALIDATE site 스탬프 | done | `b5ee912`, 운영 `47f9a61` 포함(운영 job.site_id 는 첫 실편집 때 대조) |
| 스테일 | G-6 백필 | 종결 | 08-01 A안 확정(`G6_COMPARISON_2026-07-24.md:34-36`) — 이후 RESUME 에 복사 전파됐던 것 |
| 결정 | D-11 A안(레거시 `storige:completed` 에 needsAuth·guestToken additive) | **오너 사후 추인 09-30** | `ee88078` 정본. OWNER_DECISIONS 에 기입 |
| 스테일(정정 완료·미커밋) | OWNER_DECISIONS D-11·D-4, `_RESUME_EDITOR_TRACKS.md`, 결속 설계 §1.5, CONTRACT_FREEZE 레거시 행 | 문서 워크플로 정정 중 | D-11 = `ee88078` A안 구현, §1.5 = `b5ee912` 로 restore 가 expires_at 도 해제 |
| 유효(후속) | 100p presigned `/files/:id/complete` site 스탬프(P4) | open | 100p 가 90MB 초과 PDF 에 사이트 키로 호출함(09-30 회신) |
| 유효(후속) | 운영자 권한 리뷰 minor 3건 | open | 가드 단계 거부 감사 행 없음(`jwt-auth.guard.ts:48`), status_code 기록(`interceptor.ts:110`) |
| 유효(후속) | 바깥 init catch AxiosError 정규화 / 게스트 완료 토스트 | open | `embed.tsx:1634`, `EditorHeader.tsx:449-451` — 게스트 편집기 전환과 같은 파일이라 Wave 1 뒤 |
| 유효(후속) | admin 게이팅 컴포넌트 테스트 | open(의존성) | admin 에 testing-library·jsdom 없음, `vitest.config.ts:7` 이 `.test.ts` 만 수집 → lockfile 변경 |
| 유효(후속) | 임베드 getState 페이지 필드 | partial | `embed.tsx:2186-2191` currentPage/totalPages 하드코딩 |
| 유효(후속) | I-4 Bull 합성 재시도 | open(설계 합의) | `app.module.ts:117-123` attempts 없음. 주석 일부 스테일(멱등 가드는 `synthesis.processor.ts:124-140` 에 이미 있음) |
| 결정 대기 | 3-B(3) 자동 반영, 결속 API O1~O5(+고아 정리 실가동·파기 계약), D6 게이트 거부 코드(`FILE_NOT_FOUND` 404 재사용 금지), 호스트 고정 책등 규칙, branch protection, compose 기본값, 8/24 통지 4종, 합성 재시도 웹훅 의미론, caseBind 값, SPINE_PARAMS_UNRESOLVED, 폰트 라이선스, PRINT_NORMALIZE ON, 지종별 TAC 값, 에셋 소싱, R6·R10 | needs_decision | 재점검 워크플로 결과 |
| 참고 | 명칭 충돌 | — | "D6" = R-193 게이트(NULL-파괴) vs 임베드 getState D6 / "D-4" = 임베드 SDK D-4a~c vs 포토북 커버 D-4 / 결속 설계 O1~O5 vs 운영 레인 번호 |

### 5.1 원 목록(09-30 04:30Z 스냅샷)


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
