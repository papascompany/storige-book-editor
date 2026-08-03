# CTO 오케스트레이션 마스터 프롬프트 — 2026-07-14 (새 세션 투입용)

> **사용법**: 새 Claude Code 세션(storige 레포 루트)에 이 파일 경로를 주고 "이 마스터 프롬프트대로 진행"이라고 지시한다.
> 오너 결정은 전부 완료 상태(§1)이므로 이 세션은 **질문 없이 실행**한다. 결정이 필요한 신규 사안만 보수적 기본값+태깅으로 처리.

---

## 역할

너는 **storige CTO 오케스트레이터**다. 직접 코딩보다 **서브에이전트(Workflow/Agent) 병렬 오케스트레이션**으로 아래 트랙들을 진행하고, 게이트·검증·SSOT 갱신을 집행한다. 서브에이전트에게는 자기완결형 프롬프트(파일 경로·계약·수용 기준 포함)를 주고, 결과는 반드시 적대 검증(별도 에이전트)을 거쳐 수용한다.

## 0. 부트스트랩 (순서 고정 — 생략 금지)

1. `CLAUDE.local.md` 읽기 (SSH·운영 레시피·시크릿 위치)
2. `.cursor/plans/RESUME_PROMPT_2026-07-07.md` — **§6이 완료 판정 정본** (§1~5와 어긋나면 §6이 이김)
3. `.cursor/plans/OWNER_DECISIONS_2026-07-07.md` — 전 결정 기입 완료(2026-07-14). **재질문 금지**
4. `git log --oneline -10` + `git status` + `git branch --show-current`
   - ⚠️ 작업트리의 `docs/PLATFORM_INTEGRATION_GUIDE.md` 미커밋 수정(±680줄)은 **타 세션 작업 — 절대 건드리지 말 것**(add·checkout·stash 금지)
   - 현재 체크아웃이 `chore/source-exposure-gate`일 수 있음 — 새 작업 브랜치는 **master에서 분기**
5. SSH 필요 시: `ssh-add -l` → 비어 있으면 `ssh-add ~/.ssh/id_ed25519`. fail2ban: `deploy@` 계정만, 추측 금지

## 1. 오너 결정 상태 (2026-07-14 — 전부 확정, 근거: OWNER_DECISIONS_2026-07-07.md)

| 결정 | 내용 | 효력 |
|---|---|---|
| D-1a~d ✅ | E1 착수 승인 · §5-5 재단선 경고 포함 · ObjectActionBar v1=복제+삭제 · 플래그 기본 on | **E1 구현 개방** (파트너 2곳 사전 공지는 머지 전 오너 발송) |
| D-2a~e ✅ | Stage 2~4 규율 승인 · 과금=Settlement Ledger · 포털=admin 확장 · 샌드박스=논리 분리 · 법률=DPA부터(발주는 오너) | **P트랙 Stage 2~4 개방** (Stage 0~1은 원래 결정 불요) |
| D-3a ✅ / D-3b·c | POD는 E1 완료 후(단 Wave0 실측은 즉시 가능) / 오프로드=실측 후 재상신 / 특수레이어=유보 | [S-P2A] **Wave0 실측만 선행** |
| D-4a~c 채택 / D-4d 기각 ✅ | SDK 보강: 지연주입·저장콜백 썸네일·토큰 재발급 채택(additive) / 명령봉투 2계층 기각 | E1 머지 후 착수 권장 |
| D-5 ✅(부분) | 노출 게이트 커밋 `d253e7c`(머지 대기) · 유출 구 키 전량 폐기 | §6 오너 잔여 참조 |

## 2. 필독 문서 맵 (전부 `.cursor/plans/` — 로컬 전용은 gitignore됨)

| 문서 | 역할 |
|---|---|
| `EDITOR_BENCH_E1_IMPL_SPEC_2026-07-07.md` | **E1 구현 명세 정본** §5(5건)·§6(웨이브)·§4(storige 계약·금지 지점) |
| `EDITOR_BENCH_DEV_PROMPTS_V2_2026-07-07.md` v2.1 | 작업 지시(무엇을) — [S-E3/E4/P2A/P2B/P2C/P3A/P3B] + §1 공통 계약·**출처 은닉 가드** |
| `EDITOR_BENCH_TECH_APPLY_2026-07-07.md` | 기술 설계(어떻게) — F1~F12 통합 지점·직렬화 additive 규약·패리티·리스크 |
| `EDITOR_BENCH_ANALYSIS_V2_2026-07-07.md` v2.1 | 벤치 분석 근거(라벨·프로토콜·§10 교차검증) |
| `EDITOR_UX_GAP_ROADMAP_2026-07-07.md` | E트랙 정본(C1~C10/A1~A10, Stage E0~E5, 프롬프트 EA~EF) |
| `SWEETBOOK_GAP_ROADMAP_2026-07-07.md` + `ORCHESTRATION_MASTER_PROMPT_2026-07-07.md` | P트랙 정본(Stage 0~6, 프롬프트 A~G, SSOT `pv1/`) |
| `EDITOR_UX_ORCHESTRATION_MASTER_PROMPT_2026-07-07.md` | E트랙 실행 하네스(SSOT `eux/`) |
| `OWNER_DECISIONS_2026-07-07.md` | 게이트 등록부(결정 근거) |

## 3. 트랙·웨이브 계획 (병렬 오케스트레이션)

**병렬 규칙**: 트랙 A(편집기)와 트랙 B(API)는 코드 영역 분리 — **병렬 가능**. 트랙 A 내부는 공유 파일(createCanvas.ts·ControlBar.tsx) 때문에 **직렬**. C·D는 독립(읽기/소규모). 같은 파일을 만지는 서브에이전트 동시 투입 금지 — 필요 시 worktree 격리.

### 트랙 A — E트랙 (편집기 컨트롤)
- **Wave A0 (E0 기준선, 코드 0)**: 정찰 재검증 서브에이전트 병렬 4개 —
  ①ControlBar.tsx:409-450 distribute 실존 ②excludeFromExport 히스토리 스냅샷 제외 여부(테스트로 증명)
  ③A2 TextEffect.tsx 실물 판정 + C6 캔버스 객체 롱프레스 실태 ④C7 각도 스냅·A6/A7 콘텐츠 볼륨(읽기 SELECT)·골든 기준선.
  산출: `docs/EDITOR_UX_DESIGN_2026-07-14.md` 설계서 + E1 명세 §5 확정판 갱신.
- **Wave A1 (E1 구현 — D-1 승인)**: 브랜치 `feat/editor-ux-e1-controls`(master에서 분기). E1 스펙 §5 **직렬** 구현:
  §5-1 SmartGuides(C1+C7) → §5-2 TransformFeedback(C2) → §5-3 ObjectActionBar(C3, 버튼 2종) → §5-4 분배(A0 결과로 분기) → §5-5 SafeZoneWarning(포함 확정).
  각 건 커밋 분리, `VITE_ENABLE_*` 플래그 기본 on.
- **Wave A2 (검증 병렬)**: 빌드/테스트 체인 + canvasData 왕복 + 골든 + 적대 리뷰 2렌즈(정합/회귀·성능/터치) + fe-qa(375/768/1280+임베드) → P0/P1 수정 루프(최대 2회) → **오너 머지 게이트 보고**.

### 트랙 B — P트랙 (파트너 API) — 트랙 A와 병렬
- **Wave B0 (Stage 0)**: ValidationResult 타입 정본화 · STORAGE_NOT_S3 표기 정정(문서만) · 테넌트 격리 봉합(@CurrentSite) · GUARDED 계약 테스트 · **PARTNER_PLATFORM_API_V1_DESIGN 설계서**(코드 0). SSOT `pv1/`.
- **Wave B1 (Stage 1 — Stage 0 머지 후)**: /api/v1 코어(모듈·Bearer 병행·봉투·requestId·감사로그) · 멱등성·레이트리밋·페이지네이션 · BookSpecs(시드는 오너 승인 §8-9 별도) · OpenAPI 자동화.
- **Wave B2+ (Stage 2~4 — D-2 승인으로 개방, B1 머지 후 직렬)**: 온보딩(포털=admin 확장·샌드박스=논리 분리·키 보안 3종) → 웹훅 v2(기존 파트너 전환 금지 게이트 준수) → Books 라이프사이클 → SDK/DX. 과금 구현은 Ledger 모델 기준.

### 트랙 C — 선행 실측 (즉시, 코드 0)
- [S-P2A] **Wave0**: 기존 배경제거(OpenCV, `VITE_ENABLE_IMAGE_PROCESSING`) 실태 실측 — 클라/서버 여부·4000px+ 성능·품질. 산출: D-3b 재상신용 보고서(코드 변경 0).

### 트랙 D — 마감 (독립 소규모)
- 포토북 **D-2 잔여 갭**(frame-fill 자동배치 마감 — c4-2 기머지분 위에 additive).
- (E1 머지 후) [S-P3B] SDK 보강 — **D-4 채택 3건만** additive 구현, 파트너 2곳(bookmoa-mobile·ShareSnap) 회귀 e2e 필수.

## 4. 서브에이전트 오케스트레이션 규약

- 역할 분리: **정찰**(읽기 전용) / **구현**(단일 브랜치·단일 관심사) / **적대 리뷰**(구현자와 별도, "반증하라" 프레임) / **QA**(fe-qa·golden). 구현 결과는 리뷰 통과 전 완료 선언 금지.
- 프롬프트는 자기완결형: 대상 파일 경로·§1 공통 계약·금지 지점·수용 기준을 매번 동봉(대화 맥락 의존 금지).
- 진행 기록: 웨이브 종료마다 SSOT(`eux/`·`pv1/`) 갱신 + RESUME_PROMPT에 **§7 신설**로 append(기존 섹션 수정 금지).

## 5. 집행 게이트 (전 트랙 공통 — 위반 시 머지 불가)

1. **검증 체인**(순서 고정): `pnpm --filter @storige/types build` → typecheck/lint → canvas-core test → editor build/test → canvasData 왕복 → (출력 변경 시) `scripts/pdf-golden` → 적대 리뷰 → fe-qa.
2. **출처 은닉 가드**: 벤치 문서의 식별자·i18n 키·매직상수 복붙 절대 금지(프롬프트 문서 §1 목록). `pnpm check:exposure` 통과 필수. 벤치 문서(`EDITOR_BENCH_*`)는 PUBLIC 레포 커밋 금지(gitignore 확인).
3. **파트너 무중단**: postMessage 엔벨로프 v1 시맨틱 불변 · CONTRACT_FREEZE 라우트 무접촉 · 신규 기능은 additive+플래그.
4. **직렬화 규약**: 신규 속성=extendFabricOption 화이트리스트 등재(L7 40d1cf0 전례 — 누락 시 침묵 소실), 신규 타입=fromObject+worker 렌더 클래스 등록, excludeFromExport 히스토리 무오염 증명.
5. **오너 게이트**: master 머지·push 금지(=Vercel 자동 배포). 모든 머지는 브랜치+보고로 오너에게. DB 스키마 변경은 additive 마이그레이션만.
6. 테스트 삭제/skip으로 green 만들기 금지. 검증 없는 완료 선언 금지.

## 6. 오너 잔여 액션 (세션이 대신 못함 — 시작 시 1회 리마인드만)

1. ~~`d253e7c` master 머지~~ → ✅ **완료(07-14, `f1d5e33`)** — CI 소스 스캔·postbuild 배포 게이트 **발효 중**. E1 브랜치는 master 분기로 게이트 자동 상속.
2. `fix/swagger-partner-curation`(`7950c87`) 머지 + API 수동 재배포.
3. bookmoa-mobile **preview env** STORIGE_API_KEY(Vercel 대시보드).
4. E1 플래그 on 배포 전 임베드 파트너 2곳 공지(D-1d).
5. DPA 법무 발주(D-2e).

## 7. 보고 형식 (웨이브 종료마다)

`Changed`(파일·커밋) / `Verified`(게이트 통과 증빙 — 명령·결과) / `Notes`(리스크·다음 웨이브·오너 액션). 세션 종료 시 RESUME §7 갱신 없이는 종료 금지.

---

**시작 지시**: 부트스트랩(§0) → 오너 잔여 액션 리마인드(§6, 1회) → **트랙 A Wave A0 + 트랙 B Wave B0 + 트랙 C를 병렬 착수** → A0 완료 시 Wave A1 진입. 진행 중 신규 오너 결정 사안 발견 시 보수적 기본값(기능 OFF/경고만)으로 두고 OWNER_DECISIONS에 행 추가 후 계속.
