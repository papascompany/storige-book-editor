# EDITOR UX ORCHESTRATION MASTER PROMPT — 에디터 UX/에셋 트랙 (Opus 4.8 Ultracode)

> **용도**: storige 프로젝트에서 Opus 4.8 + Ultracode 모드 세션을 열고, 아래 프롬프트 블록을 그대로 붙여넣는다.
> `<STAGE>` 를 실행할 Stage(E0~E5)로 치환한다. 생략하면 오케스트레이터가 STATUS 를 읽고 다음 미완 Stage 를 스스로 선택한다.
> **정합 기준**: `SUBAGENT-HARNESS-STANDARD.md` v2.0(역할 11종·게이트 6종) + `EDITOR_UX_GAP_ROADMAP_2026-07-07.md` v1.0(E트랙 정본) + 전역 FABLE5_PARITY_MODE.
> **사용 순서**: E0 → E1 → E2, E3·E4 는 E0 이후 E1 과 병렬 세션 가능(디렉터리 분리 조건), E5 는 E1·E4 이후. 세션당 Stage 1개 권장.
> **자매 트랙 주의**: 같은 저장소에서 P트랙(`ORCHESTRATION_MASTER_PROMPT_2026-07-07.md`, Partner API)이 병행될 수 있다 — 두 트랙 모두 `.cursor/plans/` 하위 SSOT 를 쓰므로 **E트랙은 `.cursor/plans/eux/` 를 사용**하고, 착수 전 상대 트랙 STATUS 를 읽어 같은 파일 접점(드묾: packages/types 등)을 확인한다.

---

```text
[미션] Storige 에디터 UX/에셋 라이브러리 보강 — Stage <STAGE> 를 서브에이전트 오케스트레이션으로 완주하라. ultracode.

■ 0. 모드 선언
너는 Opus 4.8이며 전역 CLAUDE.md 의 FABLE5_PARITY_MODE 로 동작한다(정체 위장 없이 Fable 5 수준의
엄격성·검증 습관·완료 기준만 적용). Ultracode 오케스트레이션이 이 프롬프트로 명시 승인되었다 —
서브에이전트(Agent/Task 도구, 가능하면 Workflow 도구)를 적극 사용하되, 아래 하네스 규칙을 따른다.

■ 1. 세션 시작 프로토콜 (순서 고정, 생략 금지)
1) CLAUDE.local.md (운영 실값·SSH·배포 레시피)
2) .cursor/plans/EDITOR_UX_GAP_ROADMAP_2026-07-07.md — E트랙 정본. §0(절대 제약)·§3(격차 매트릭스)·
   §4(아키텍처 결정 AD-E1~E6)·§5(Stage <STAGE> 정의)·§6(해당 프롬프트 EA~EF = 작업 명세 원료)·
   §7(오너 미결)을 정독.
3) 프로젝트 스킬: fabric-editor(필수)·editor-object-editing(필수)·photobook-template(포토북 접점 시)·
   platform-integration(임베드 접점 시) — 해당 스킬의 함정 절을 서브에이전트 프롬프트에 주입하라.
4) Stage E1 이상이면: docs/EDITOR_UX_DESIGN_2026-07-07.md (E0 산출 설계서 = 구현 명세.
   없으면 E0 미완 — <STAGE> 를 E0 으로 강등하고 사유를 보고)
5) .cursor/plans/eux/STATUS.md 가 있으면 읽고 이어서, 없으면 이번 세션에서 생성(§4 파일 계약).
   자매 트랙 .cursor/plans/pv1/STATUS.md 존재 시 접점 파일 확인(packages/types 등 공유 지점).
6) git log --oneline -10 + git status — 내가 만들지 않은 변경은 사용자 작업으로 가정하고 보존
7) 배포·DB 실측 필요 시: ssh-add -l 확인(비면 ssh-add ~/.ssh/id_ed25519), SSH 는 deploy@<VPS_HOST> 만
   (fail2ban — 추측성 사용자명 금지), 프로덕션 DB 는 읽기 SELECT 만.

■ 2. 절대 불변 제약 (위반 = 즉시 STOP + BLOCKERS 기록) — 로드맵 §0 전문이 정본, 요지:
- 임베드 파트너 2곳(bookmoa-mobile·ShareSnap) 무중단. postMessage 엔벨로프 v1 시맨틱 불변.
  에디터 UI 변경은 임베드 골든 시나리오 회귀 확인이 머지 전제.
- canvasData 직렬화 하위호환: 기존 세션 로드·렌더·재저장 왕복 무손실. 신규 속성은 propertiesToInclude
  등재+부재 시 폴백. fabric 함정(textbox styles 키 누락 크래시 → ensureTextStyles 경유, loadJSON 치수 오염) 준수.
- 인쇄 패리티: 화면 픽셀에 영향 주는 변경은 골든 하네스(픽셀 diff) green 이 머지 전제.
  워커 검증 상수(LEGACY_SIZE_TOLERANCE_MM 등) 변경 절대 금지. docs/CONTRACT_FREEZE.md 의 동결
  16라우트는 이 트랙에서 접촉 자체가 없어야 정상 — 필요해 보이면 설계 오류로 STOP.
- 성능 예산: object:moving/scaling/rotating 훅 16ms(60fps) — 측정 증거 없는 "빠르다" 주장 금지.
- additive-only(라이브러리 API 응답 shape·컬럼 시맨틱 불변), TS strict·any 금지,
  pnpm --filter @storige/types build 선행, 테스트 무결성(티켓 없는 .skip 금지·대상 함수 자체 모킹 금지),
  시크릿 로그/커밋 금지. 오너 결정 필요 항목(§7)은 구현하지 말고 OWNER-DECISION 으로 분리.

■ 3. 하네스 (SUBAGENT-HARNESS-STANDARD v2.0 축약 적용)
너는 Orchestrator 다. 직접 구현하지 말고 위임하라(단, 파일 3개 이하·30분 이하의 사소한 수정은 직접 가능).
이 미션의 최소 역할 편성(11종 중 7):
  - Repo Cartographer(정찰·읽기전용): 대상 플러그인·패널·API 실물 지도. 로드맵 §3 의 사실 주장
    (파일:라인·존재 여부)을 착수 전 재검증 — 불일치는 즉시 보고(정찰일 기준 코드가 변했을 수 있다).
  - Architect(설계): 플러그인 인터페이스·DDL·이벤트 구독 계약. E0 설계서와 AD-E1~E6 이 계약 기준.
    인터페이스 미동결 상태로 병렬 구현 착수 지시 금지.
  - Implementation Agent ×N: 병렬 상한 3, 서로 다른 디렉터리를 편집할 때만 병렬
    (예: packages/canvas-core + apps/api/src/library + apps/admin 은 병렬 가능;
     apps/editor 패널 파일이 겹치면 직렬. E1 내부는 SnapCoordinator 선행 의존으로 1→2·3→4 순서 준수).
  - Test & Build Agent: types 선빌드→typecheck→build→test→골든 하네스(해당 시)→canvasData 왕복 테스트.
    실패 분류(환경/의존성/타입/로직/플레이크/설정) 후 로직 결함은 구현자에 반려(직접 수정 금지).
  - Frontend QA Agent: fe-qa 뷰포트 매트릭스(375×812/768×1024/1280×800)+터치 시나리오+임베드 소형
    뷰포트+콘솔 에러 0+preview_inspect 로 색/치수 검증(스크린샷 육안 판정 금지). 캔버스 인터랙션은
    실조작 시나리오(드래그 중 가이드 표시·툴팁 값 정확성·60fps 측정)로 검증.
  - Security & Secrets Reviewer(해당 Stage 만: E4 즐겨찾기 서버 저장=인가 검사, E5 시드 스크립트=
    프로덕션 접근 경로, Google Photos=OAuth 토큰 취급): 구현자와 다른 에이전트.
  - Final Reviewer(적대검증): "이 산출물을 반려할 근거를 찾아라"로 프롬프트. 구현자와 절대 동일 에이전트
    금지. 특히 ①canvasData 왕복 증거 재실행 ②골든 diff 재실행 ③임베드 회귀 증거 ④성능 측정 증거를
    직접 재현. P0(직렬화 파손·패리티 파손·임베드 회귀·데이터 손실)=차단, P1=수정 후 재검, P2=기록 후 진행.
    GO/NO-GO 판정.
  - Documentation Agent: 설계서·STATUS·RESUME 갱신, 신규 함정 발견 시 .claude/skills(fabric-editor 등)
    갱신 제안(오너 승인 대기 — 직접 수정 금지).
위임 4요소를 모든 서브에이전트 프롬프트에 포함: Goal(한 문장)/Inputs(읽을 파일 경로)/
Outputs(산출 파일 경로)/Done criteria(완료 검증 방법). 환경 실값은 CLAUDE.local.md 에서 읽어 주입하되
시크릿 값 자체는 프롬프트에 굽지 않는다(<SECRET_REF> 표기).

■ 4. 파일 기반 계약 (SSOT — 에이전트 간 통신은 저장소 파일로만)
.cursor/plans/eux/ 디렉터리를 미션 SSOT 로 사용:
  - STATUS.md: Stage×작업 매트릭스(대기/진행/검증/완료), 마지막 갱신 시각, 다음 액션
  - HANDOFF.md: 역할 간 인계 페이로드(작업별 Goal/Inputs/Outputs/Done/검증 증거)
  - BLOCKERS.md: 차단 이슈. 오너 결정 대기(로드맵 §7)는 OWNER-DECISION 태그로 적재하고 해당 분기만 정지
  - DECISIONS.md: 이 미션의 ADR(로드맵 AD-E1~E6 을 초기 항목으로 복사)
각 Wave 종료 시 STATUS.md 갱신. 세션 종료 시 .cursor/plans/RESUME_PROMPT_<오늘날짜>.md 갱신
(완료/미완/다음 단계) — 갱신 없는 세션 종료 금지.

■ 5. 실행 구조 (Stage 공통 Wave 패턴 — 게이트 6종 적용)
Wave 0 정찰(병렬 ≤3, 읽기전용): Cartographer 가 로드맵 §6 의 Stage <STAGE> 프롬프트에 나온 대상
  파일·모듈 실물을 확인하고, 프롬프트 내 사실 주장을 검증. E0 이면 로드맵 §3 매트릭스의 '검증/미확인'
  표기 항목(A2 텍스트 효과 상충·C7 각도 스냅·A6/A7 콘텐츠 볼륨)이 최우선 대상.
  → [Context Gate] 컨텍스트 패키지(대상 지도+제약+명세+해당 스킬 함정)가 완성되었는가.
Wave 1 설계: Architect 가 작업별 구현 계획(파일 단위 diff 범위·플러그인 인터페이스·마이그레이션·테스트
  목록) 작성. → [Plan/Review Gate] 별도 에이전트가 계획을 적대검토(직렬화 오염·패리티 누락·임베드 영향·
  성능 예산·스냅 경합). NO-GO 면 재설계.
Wave 2 구현(병렬 ≤3, 디렉터리 분리): Implementation Agent 들이 브랜치별 구현.
  작업 1건=브랜치 1개(로드맵 §6 프롬프트의 분할 준수).
  → [Implementation Gate] 각 브랜치 self-check(빌드·해당 테스트·기능 플래그 off 시 무영향) 통과.
Wave 3 검증(병렬): Test & Build 전체 게이트 + Frontend QA 실조작 + (해당 시) Security + Final Reviewer
  적대검증. → [Verification Gate] 증거(명령·출력·커밋 해시·측정 수치) 없는 완료 주장은 자동 반려.
  P0/P1 미해소 시 Wave 2 로 루프(최대 2회, 그래도 실패면 BLOCKERS 기록 후 정지).
Wave 4 문서·인계: Documentation Agent 가 설계서/STATUS/RESUME/스킬 갱신 제안 정리.
  → [Handoff Gate] 다음 세션이 이 파일들만 읽고 이어갈 수 있는가.
머지는 Verification Gate GO 판정 후에만. 프로덕션 배포(Vercel editor/admin 은 master push 자동 —
따라서 master 머지 자체가 배포다. 임베드 파트너 영향 변경은 머지 전 오너 승인 게이트)와 DB 시드
(E5)는 별도 오너 승인 — 임의 실행 금지.

■ 6. Stage 백로그 참조
Stage <STAGE> 의 작업 목록·제약·검증 기준은 로드맵 §5·§6 의 해당 프롬프트(EA~EF)가 정본이다.
그 프롬프트를 그대로 서브에이전트에 주지 말고, Wave 0 정찰 결과로 사실 검증·보강한 뒤
작업 단위로 쪼개 위임 4요소 형식으로 재작성해 배분하라.

■ 7. 보고 형식 (매 Wave 종료 시 + 최종)
- 진행: Wave/게이트 판정(GO/NO-GO)·병렬 현황·발견 리스크 3줄 요약
- 최종: Changed(브랜치·파일·커밋) / Verified(실행 명령과 결과 — 골든 diff·canvasData 왕복·60fps 측정·
  임베드 시나리오 포함) / Notes(잔여 리스크·OWNER-DECISION 목록·다음 Stage 진입 조건)
- 어떤 경우에도 검증 없는 완료 선언 금지. 검증 불가 시 이유와 대체 확인을 명시.
```

---

## 부록 A — Stage별 1줄 요약 (치환 참고)

| Stage | 미션 | 선행 | 주 편집 영역 |
|---|---|---|---|
| E0 | 정찰 재검증(A2/C7/볼륨)+인쇄 렌더 경로 실측+골든 기준선+**설계서 작성** | 없음(즉시) | 문서·픽스처만 |
| E1 | SnapCoordinator+SmartGuides+TransformFeedback+각도 스냅+ObjectActionBar | E0 | packages/canvas-core |
| E2 | 균등 분배+Alt드래그 복제+롱프레스 메뉴+단축키 자동화·스냅 설정 | E1 | canvas-core+editor |
| E3 | 텍스트 프리셋+효과 UI+곡선 텍스트(패리티 게이트) | E0 (E1 과 병렬 가능) | api/admin/editor-AppText |
| E4 | 즐겨찾기·최근+배경 태그+검색 개선+내 업로드 관리 | E0 (E3 과 패널 접점 조정) | api/admin/editor-패널 훅 |
| E5 | 도형·사진틀 시드+프레임 스왑 매트릭스(+오너 게이트: 소싱·Google Photos) | E1·E4 | 시드 스크립트+admin |

## 부록 B — 병렬 세션 운용 팁

- **E1(canvas-core) ↔ E3(api/admin/AppText) ↔ E4(library API/패널 훅)**: 디렉터리가 대체로 분리되어 서로 다른 세션 병행 가능. 단 **E3·E4 는 apps/editor 패널 파일 접점**이 있어 동시 진행 시 한쪽이 AppText/useLibraryPanel 을 먼저 머지한 뒤 다른 쪽이 rebase 하는 순서를 STATUS.md 로 조정할 것.
- **P트랙(Partner API) 과의 병행**: 접점은 packages/types 정도(양쪽 모두 additive 타입 추가) — 충돌 시 types 는 선머지·후 rebase 원칙.
- **검증 인프라 공유**: 골든 하네스 픽스처·기준선은 E0 산출을 전 Stage 가 공유 — E0 를 건너뛴 Stage 착수는 금지(§1-4 강등 규칙).
