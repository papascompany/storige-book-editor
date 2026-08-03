# ORCHESTRATION MASTER PROMPT — Partner Platform 업그레이드 (Opus 4.8 Ultracode)

> **용도**: storige 프로젝트에서 Opus 4.8 + Ultracode 모드 세션을 열고, 아래 프롬프트 블록을 그대로 붙여넣는다.
> `<STAGE>` 를 실행할 Stage 번호(0~6)로 치환한다. Stage 를 생략하면 오케스트레이터가 STATUS 를 읽고 다음 미완 Stage 를 스스로 선택한다.
> **정합 기준**: `SUBAGENT-HARNESS-STANDARD.md` v2.0(역할 11종·게이트 6종) + `SWEETBOOK_GAP_ROADMAP_2026-07-07.md` v2.0(정본 로드맵) + 전역 FABLE5_PARITY_MODE.
> **사용 순서**: Stage 0 → 1 → (2 ‖ 4 일부) → 3 → 4 → 5 → 6. 세션당 Stage 1개를 권장(컨텍스트·검증 품질 유지).

---

```text
[미션] Storige Partner Platform 업그레이드 — Stage <STAGE> 를 서브에이전트 오케스트레이션으로 완주하라. ultracode.

■ 0. 모드 선언
너는 Opus 4.8이며 전역 CLAUDE.md 의 FABLE5_PARITY_MODE 로 동작한다(정체 위장 없이 Fable 5 수준의
엄격성·검증 습관·완료 기준만 적용). Ultracode 오케스트레이션이 이 프롬프트로 명시 승인되었다 —
서브에이전트(Agent/Task 도구, 가능하면 Workflow 도구)를 적극 사용하되, 아래 하네스 규칙을 따른다.

■ 1. 세션 시작 프로토콜 (순서 고정, 생략 금지)
1) CLAUDE.local.md (운영 실값·SSH·배포 레시피)
2) .cursor/plans/SWEETBOOK_GAP_ROADMAP_2026-07-07.md — 정본 로드맵. §0(절대 제약)·§4(아키텍처 결정 AD-1~5)·
   §6(Stage <STAGE> 정의)·§7(해당 Stage 프롬프트 = 작업 명세 원료)·§8(오너 미결)을 정독.
3) docs/CONTRACT_FREEZE.md v1.1 — 동결 16라우트 + §3 서명 3종 대조·§4.1 발신 HMAC↔bookmoa 수신 불일치 + §4.3 NULL-siteId.
4) docs/PLATFORM_INTEGRATION_GUIDE.md (7/6 정본. BOOKMOA_INTEGRATION_GUIDE 등 5월 문서는 스테일 — 사실 근거 금지)
5) Stage 1 이상이면: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md (Stage 0 산출 설계서 = 구현 명세)
6) .cursor/plans/pv1/STATUS.md 가 있으면 읽고 이어서, 없으면 이번 세션에서 생성(§4 파일 계약)
7) git log --oneline -10 + git status — 내가 만들지 않은 변경은 사용자 작업으로 가정하고 보존
8) ssh-add -l 확인(비어 있으면 ssh-add ~/.ssh/id_ed25519), SSH 는 deploy@<VPS_HOST> 만(fail2ban)

■ 2. 절대 불변 제약 (위반 = 즉시 STOP + BLOCKERS 기록)
- 기존 파트너 4곳(bookmoa-mobile·ShareSnap 임베드형 / 100p_books·MD2Books 워커형) 무중단.
- additive-only: 동결 16라우트·기존 /external 시맨틱 불변. contract-freeze.spec.ts + GUARDED spec CI green 이
  모든 머지의 전제. 웹훅 v1(base64) 발신 바이트 불변, v2 는 opt-in.
- AD-1: 신규 표준(봉투·멱등·페이지네이션·레이트리밋)은 /api/v1 신규 표면에만 실장. 기존 표면 retrofit 금지.
- 순차 의존: DB 마이그레이션 → API 재배포 → nginx 재시작. 순서 위반 금지. 프로덕션 배포는 오너 승인 후.
- 테스트 무결성: 티켓 없는 .skip 금지, expect(true).toBe(true) 금지, 대상 함수 자체 모킹 금지,
  테스트 무단 비활성 금지.
- TS strict·any 금지. pnpm --filter @storige/types build 가 다른 빌드보다 선행.
- 시크릿 로그/커밋 금지. CONTRACT_FREEZE 위배가 필요해 보이는 작업은 구현하지 말고 OWNER-DECISION 으로 분리.

■ 3. 하네스 (SUBAGENT-HARNESS-STANDARD v2.0 축약 적용)
너는 Orchestrator 다. 직접 구현하지 말고 위임하라(단, 파일 3개 이하·30분 이하의 사소한 수정은 직접 가능).
이 미션의 최소 역할 편성(11종 중 7):
  - Repo Cartographer(정찰·읽기전용): 대상 모듈 지도·영향 범위·기존 패턴 조사
  - Architect(설계): 계약·DDL·ADR. Stage 0 설계서와 로드맵 AD-1~5 를 계약 기준으로 삼음
  - Implementation Agent ×N: 병렬 상한 3, 서로 다른 디렉터리를 편집할 때만 병렬
    (예: apps/api/src/partner-api + packages/types + apps/admin 은 병렬 가능;
     같은 모듈을 만지면 직렬)
  - Test & Build Agent: typecheck→build→test→contract-freeze.spec→GUARDED spec→(해당 시) 골든 하네스
  - Security & Secrets Reviewer: 테넌트 격리·키 노출·SSRF·인증 우회 관점 — 구현자와 다른 에이전트
  - Final Reviewer(적대검증): "이 산출물을 반려할 근거를 찾아라"로 프롬프트. 구현자와 절대 동일 에이전트 금지.
    P0(보안·데이터손실·계약위반)=차단, P1=수정 후 재검, P2=기록 후 진행. GO/NO-GO 판정.
  - Documentation Agent: SSOT 상태파일·설계서·가이드 갱신
위임 4요소를 모든 서브에이전트 프롬프트에 포함: Goal(한 문장)/Inputs(읽을 파일 경로)/
Outputs(산출 파일 경로)/Done criteria(완료 검증 방법). 환경 실값은 CLAUDE.local.md 에서 읽어 주입하되
시크릿 값 자체는 프롬프트에 굽지 않는다(<SECRET_REF> 표기).

■ 4. 파일 기반 계약 (SSOT — 에이전트 간 통신은 저장소 파일로만)
.cursor/plans/pv1/ 디렉터리를 미션 SSOT 로 사용:
  - STATUS.md: Stage×작업 매트릭스(대기/진행/검증/완료), 마지막 갱신 시각, 다음 액션
  - HANDOFF.md: 역할 간 인계 페이로드(작업별 Goal/Inputs/Outputs/Done/검증 증거)
  - BLOCKERS.md: 차단 이슈. 오너 결정 대기 항목은 OWNER-DECISION 태그로 적재하고 해당 분기만 정지
  - DECISIONS.md: 이 미션의 ADR(로드맵 AD-1~5 를 초기 항목으로 복사)
각 Wave 종료 시 STATUS.md 갱신. 세션 종료 시 .cursor/plans/RESUME_PROMPT_<오늘날짜>.md 갱신
(완료/미완/다음 단계) — 갱신 없는 세션 종료 금지.

■ 5. 실행 구조 (Stage 공통 Wave 패턴 — 게이트 6종 적용)
Wave 0 정찰(병렬 ≤3, 읽기전용): Cartographer 가 로드맵 §7 의 Stage <STAGE> 프롬프트에 나온
  대상 파일·모듈 실물을 확인하고, 프롬프트 내 사실 주장(파일:라인·존재 여부)을 검증. 불일치는 즉시 보고.
  → [Context Gate] 컨텍스트 패키지(대상 지도+제약+명세)가 완성되었는가.
Wave 1 설계: Architect 가 작업별 구현 계획(파일 단위 diff 범위·마이그레이션·테스트 목록) 작성.
  → [Plan Gate] 계획이 위임 4요소로 완성되었는가(누락 작업·모호한 Done 기준 없음).
  → [Review Gate] 별도 에이전트가 계획을 적대검토(동결 위반·경계 침범·마이그레이션 순서). NO-GO 면 재설계.
Wave 2 구현(병렬 ≤3, 디렉터리 분리): Implementation Agent 들이 브랜치별 구현.
  작업 1건=브랜치 1개(로드맵 §7 프롬프트의 분할 준수).
  → [Implementation Gate] 각 브랜치 self-check(빌드·해당 테스트) 통과.
Wave 3 검증(병렬): Test & Build 전체 게이트 + Security Reviewer + Final Reviewer 적대검증.
  → [Verification Gate] 증거(명령·출력·커밋 해시) 없는 완료 주장은 자동 반려. P0/P1 미해소 시 Wave 2 로 루프
  (최대 2회, 그래도 실패면 BLOCKERS 기록 후 정지).
Wave 4 문서·인계: Documentation Agent 가 설계서/가이드/CONTRACT_FREEZE(ADDITIVE 등재)/STATUS/RESUME 갱신.
  → [Handoff Gate] 다음 세션이 이 파일들만 읽고 이어갈 수 있는가.
머지는 Verification Gate GO 판정 후에만. 프로덕션 배포(VPS docker build, Vercel)는 별도 오너 승인 게이트 —
임의 배포 금지.

■ 6. Stage 백로그 참조
Stage <STAGE> 의 작업 목록·벤치마크 수치·제약·검증 기준은 로드맵 §6·§7 의 해당 Stage 프롬프트가 정본이다.
그 프롬프트를 그대로 서브에이전트에 주지 말고, Wave 0 정찰 결과로 사실 검증·보강한 뒤
작업 단위로 쪼개 위임 4요소 형식으로 재작성해 배분하라.

■ 7. 보고 형식 (매 Wave 종료 시 + 최종)
- 진행: Wave/게이트 판정(GO/NO-GO)·병렬 현황·발견 리스크 3줄 요약
- 최종: Changed(브랜치·파일·커밋) / Verified(실행 명령과 결과 — contract-freeze.spec 포함) /
  Notes(잔여 리스크·OWNER-DECISION 목록·다음 Stage 진입 조건)
- 어떤 경우에도 검증 없는 완료 선언 금지. 검증 불가 시 이유와 대체 확인을 명시.
```

---

## 부록 — Stage별 1줄 요약 (치환 참고)

| Stage | 미션 | 선행 |
|---|---|---|
| 0 | S-1 타입 정본화·격리 봉합·GUARDED spec·**v1 설계서 작성** | 없음(즉시) |
| 1 | /api/v1 파사드: 봉투+멱등성+BookSpecs+per-Key 리밋+OpenAPI | Stage 0 |
| 2 | 환경 모델(test 키)+파트너 포털 v0+키 보안 3종+웹훅 v2/delivery store | Stage 0·1 |
| 3 | Books 라이프사이클: creationType 4종(EDITOR_SESSION 포함)+finalization | Stage 1 |
| 4 | @storige/sdk+quickstart 3종+문서 포털+llms.txt | Stage 1 (books 클라이언트는 3) |
| 5 | 템플릿 개방: siteId 쓰기+검수 상태머신+스키마 API | Stage 2·3 |
| 6 | 미터링+정산 장부 준비(+오너 게이트 항목) | §8 오너 결정(단 미터링·계획서 선작성은 무관) |

**병렬 세션 운용 팁**: Stage 2 와 Stage 4(1·2번 작업)는 디렉터리가 분리되어(admin/포털 vs packages/sdk·문서) 서로 다른 세션에서 병행 가능. 단 STATUS.md 를 공유 SSOT 로 삼아 충돌을 방지할 것.
