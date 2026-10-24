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
   - 상세 시작 절차(CTO·서브에이전트·워크플로, 첫 작업, 운영 규칙, 셸 함정)는 비공개 `../_private_notes/wave12/NEW_SESSION_PROMPT_2026-10-15.md` 가 정본(10-15 갱신 — 이전판 `wave10/NEW_SESSION_PROMPT_2026-10-14.md`)입니다. 이 블록보다 먼저 읽고 그 순서를 따릅니다(다음 이슈 정본 `NEXT_ISSUES_2026-10-14.md`).
   - git log --oneline -15 와 git status -sb 를 확인합니다. untracked 타 세션 파일(docs/SHOPIFY_*, docs/SITE_CATALOG_*, .tmp-verify-combos/ 등)은 건드리지 않고, git add 는 명시 경로 목록으로만 합니다.
   - SSH 가 필요하면 ssh-add -l 을 먼저 확인합니다(비어 있으면 ssh-add ~/.ssh/id_ed25519). 접속 대상은 CLAUDE.local.md §1.1 의 deploy@ 하나뿐이고, 다른 사용자명은 시도하지 않습니다.
   - 런타임: export PATH="/opt/homebrew/opt/node@24/bin:$PATH"

2) 파트너 채널 확인
   - ListAgents 로 찾습니다. 파트너 세션이 실행 중이 아니면 목록에 안 나옵니다. 그때는 mcp__ccd_session_mgmt__list_sessions 로 local_ id 를 찾아 SendMessage(to="local_…") 로 보냅니다.
   - 창구(세션 id·표시명·주소)의 정본은 비공개 메모 `../_private_notes/wave10/RESUME_OPS_PRIVATE.md` 「창구」 절입니다. 앱을 재시작하면 ListAgents ref 가 바뀌므로 보낼 때마다 다시 확인합니다.
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

## 2. 현재 라이브 상태 (2026-10-14 06:31Z — Wave 10 안 1 배포·파트너 잡 응답 키 전환 후)

> **10-24 13:20Z(22:20 KST) 갱신(캘린더 트랙):** W1 잔여(T3a·T3c)와 W2(T3b·T4·T6)를 p1-calendar 에 병합(일부 push, 나머지 로컬 — push 는 오너 승인). CONTRACT v1.26(연달력)·v1.27(잡절 표기). 운영 미반영. 계획 §0 행 참조. 오너 결정 대기: 스킨셋 설계 질문(W3 T7), 기념일 굵게의 PDF 미반영 처리, 날짜 데이터 갱신 담당·릴리스, W3 T4r·T5. 기존 템플릿 교체 결함은 별도 항목으로 등재됨.
>
> **10-24 07:50Z(16:50 KST) 갱신(캘린더 트랙):** T1b 전환 경로 실측 완료(계획 §8.2 — 세트 3종 × sheet-map·duplex-split 6행 통과, 원복 diff 0). W1 잔여 코드는 worktree 브랜치에만(push·병합 전): `worktree-t3a-year-calendar-2026-10-24`(연달력 코어 + CONTRACT v1.26 ADDITIVE 3) · `worktree-t3c-c1-split-2026-10-24`(낱장 검증 킬스위치 ↔ 프로파일 세트 분리, D10) — R 조건부 GO. 남은 게이트: T3c 로컬 리허설(오너 보류), T3a 연도 기간 규칙(Q1) 오너 확인, 병합 승인(master 순서는 본진과). D3 해소 — 벽걸이 1단은 단면 14쪽(T5), 2단은 현행. 상품별 재단·도련·템플릿 규격(B12)은 본진 설계·오너 결정 대기.
>
> **10-24 06:10Z(15:10 KST) 갱신(캘린더 트랙, docs 전용):** origin/master = `12de30af`(코드 불변) — CI `test` 잡 회귀 해소(run 40065286057 success, `200a2bd0`). `p1-calendar-2026-10-17` = `42861260`(origin/master 병합 머지 커밋, 코드 차이 0 → master 가 ff 로 받을 수 있음). **오너 결정 D1~D11 답변 완료(전부 CTO 권고안 — 계획 §5)**, T3c(C1 코드 분리) 행 신설(§3), 기준선 재실행 행 추가(§7: 실패 0, 로컬 Node 26 native ABI 불일치는 Node 24·22 재실행 규칙). 로컬 샘플 7종 등록 확인. 다음: W1 잔여 T3a ∥ T3c ∥ T1b(오너 wave 승인 후).
>
> **10-24 04:40Z(13:40 KST) 갱신:** master = `dbc2333f`(코드: editor `c040b68e`·api/worker `11383962`) — **10-23 D12 방어선 운영 적용**(MariaDB `max_allowed_packet` 256M: `SET GLOBAL` 즉시 + `docker compose restart api` 풀 갱신 + compose 영구값, 10:13~10:16 KST 무중단, VPS pull) · **캘린더 계획 HTML 시각화** `docs/CALENDAR_EDITOR_FEATURE_PLAN_2026-10-21.html`(브랜치 `p1-calendar-2026-10-17` `2d45fd54` push, master 미병합; 원문 대조 리뷰 314항목·디자인 QA 반영) · 10-24 계획 **v3**(§0 10-23 행·packet 해소) + 새 세션 시작 프롬프트 `.cursor/plans/CALENDAR_EDITOR_ORCHESTRATION_SESSION_START_PROMPT_2026-10-24.md`(서브에이전트 오케스트레이션으로 W1 잔여 T3a·W2·W3). 오너 결정 D1~D11 미답 → T3a·W2 보류. 주의: 이 Mac 일부 회선에서 github.com DNS 가로채기(우회 `git -c http.curloptResolve=github.com:443:<실IP>`)·아웃바운드 22 차단(VPS SSH 불가); master CI `test` 잡은 10-21 `11383962` 병합 이후 완료 7회 전부 실패 — 「문서 포털 공개 모드 빌드」 스텝, `apps/docs/src/render-openapi.mjs:144` `/api/v1/sessions/{id}/deliverables` 가 `apps/docs/site.config.mjs` groups 미등재(P2-b 런처 라우트가 유발한 **회귀**, 테스트 스텝은 전부 통과) — **10-24 05:11Z 다른 세션이 master `12de30af`(docs·포털 설정 5커밋, `200a2bd0` 가 이 회귀 수정) push** → p1-calendar(`41fbbb60` = 계획 v3·RESUME·새 프롬프트, push 됨)는 master 와 분기(5/2) — 병합(머지 커밋 권고) 방식은 오너 결정, 병합 전 미추적 `docs/SHOPIFY_ORCHESTRATION_DEVELOPMENT_GUIDE_2026-10-15.{md,html}`(커밋본과 SHA 동일) 정리 필요.
>
> **10-22 14:50Z(23:50 KST) 갱신:** master = `c040b68e` — **W1 T2 그리드·기념일 안전성 운영 반영**: worktree 브랜치 3커밋 R GO → 오너 승인 → `p1-calendar-2026-10-17` cherry-pick(`a087316c`·`680c8322`·`c040b68e`) → master ff → Vercel editor `dpl_HB9xHCKnVSJ5Aq18j5XRdymQjAa4` Ready(alias editor.papascompany.co.kr) → 운영 스모크 통과(calendar-grid 그룹: 그룹해제 버튼 0·hideContext true·unGroup no-op, 일반 그룹 회귀 정상). api/worker 무변경(VPS 체크아웃 `e9725838` 유지, 소스 동일). 다음: 오너 D1~D11 답변 → T3a(worktree)·T1b(W2).

> **10-22 13:15Z(22:15 KST) 갱신:** master 코드 불변(`11383962`), docs 전용 — 캘린더 편집기 기능 계획 v2(`docs/CALENDAR_EDITOR_FEATURE_PLAN_2026-10-21.md`, 트랙 T1~T7·오너 결정 D1~D11) + **W1 T1a 캘린더 실측 완료**(§8.1: wall1_a3·wall2_a4 완료 14s·434KB, desk_large+사진 13장 31.4s·18.7MB·heap 487MB, 검증 모두 warnings []). 발견 C1: `EDITOR_SHEET_VALIDATION_RULES=off` 는 프로파일 세트 검증을 `PAGE_COUNT_INVALID` 로 깨뜨림 → DEPLOYMENT (가)·P1 롤백 절 경고(코드 분리는 D10). T2 그리드·기념일 안전성은 worktree 세션 진행 중(통합은 R 검토·오너 검토 뒤). 오너 대기: D1~D11 답변, 운영 샘플 등록, `max_allowed_packet` 상향.

> **10-21 07:00Z(16:00 KST) 갱신:** master = `e9725838`(코드 `11383962`) — P2-a·b·c·d + 2차 e2e·D11~D13 **운영 반영 완료**: ff 병합 `af900212`→`11383962`, VPS 체크아웃 `e9725838`, api `fcad1293f0e6`·worker `4f73a4c4efb4`, `[FLAGS-CHECK] api ok n=17`(`FLAGS_EXPECTED_API` 에 `PARTNER_SESSION_LAUNCH_ENABLED`·`SHEET_MAP_OUTPUT_ENABLED` 추가)·`worker ok n=9`, health 200·기동 후 오류 0, Vercel editor `p8y6krgna`·admin `fsssz1ktb` Ready, 롤백 태그 `rollback-pre-p2abcd-20261021`·`.env.bak-20261021-p2`(DEPLOYMENT 「P2-d」 절 끝 「반영 기록」). CONTRACT v1.23~v1.25 적용 시점 확정. **미실행(오너)**: 운영 사진인화 샘플 세트 등록, mariadb `--max-allowed-packet` 상향(D12 코드 수정 뒤 권장 방어선), P2-e 운영자 콘솔. **다음 트랙**: 캘린더 편집기 기능 확장 — `docs/CALENDAR_EDITOR_FEATURE_PLAN_2026-10-21.md`(병렬 트랙·오너 결정).

> **10-20 04:51Z(13:51 KST) 갱신(10-19 ~ 10-20):** **(10-20 05:55Z 커밋 `237e6b91` push 완료 — 81파일, 아래 '미커밋' 표기는 이 커밋으로 해소; master 미병합·운영 미반영)** 브랜치 `p1-calendar-2026-10-17` = `9be4c37c`(P2-c sheet-map 워커 모드 커밋·push, CONTRACT v1.24 — master 미병합·운영 미반영; 운영은 여전히 P1 캘린더 master `af900212`). 10-19 문서 5종 갱신(P1~P2-c 반영, 미커밋): `docs/EDITOR.md` §21 상품 프로파일 모드 · `docs/PLATFORM_INTEGRATION_GUIDE.md` 3.7 런처 절 · `docs/PLATFORM_WORKER_INTEGRATION_v1.md` §15 합성 mode 카탈로그 · `docs/PDF_VALIDATION_GUIDE.md` 낱장·프로파일 세트 검증 절 · `docs/INDEX.md` 상품별 편집 모드 트랙 배너. 그 위에 **P2-d 사진인화 미커밋(커밋 승인 대기)** — types `ProductKind 'photo-print'`·`PhotoPrintProfile`·`PhotoItem`·`readPhotoItems`(`packages/types/src/product-profile.ts`)·`EditorMenuKey 'PHOTO_PRINT'`; canvas-core `PhotoPrintPlugin`(`fitMode`·`frameInsetMm` 직렬화 등재, 유테 창 = 재단 상자 기준 `bleedPx`, Grayscale 필터 `effectType 'photo-print'` 태그, `date-overlay` 텍스트 = 촬영일 로컬 'YYYY.MM.DD'); 편집기 `PHOTO_PRINT` 메뉴(`VITE_ENABLE_PHOTO_PRINT`, 정확히 'false' 일 때만 off — `apps/editor/.env.example` 추가)·`PhotoPrintPanel`·`usePhotoPrintStore`·`metadata.items`·완료 payload `product.kind 'photo-print'`+`items`(회원 완료·레거시 `storige:completed` 포함, 게스트 미동봉)·페이지 추가/삭제 사진 단위·순서 변경 비활성·업로드 한도 `upload{maxPhotos,maxMb}`; api `edit-sessions/photo-items.ts`(sheet-map `files[].copies/label` 주입·deliverables `items`)·`metadata.productProfile` 서버 소유 키 전환·시트 맵 산출 실패 `metadata.production.sheetMap` + deliverables `status 'failed'`·검증 잡 `orderOptions.bleed` = `resolveDefaultBleedMm`(cropMark off 프로파일 세트 0); SDK `EditorCompleteItem`·`SessionDeliverablesItem`·README; admin 프리셋 4종 `photoPrintProfilePresets.ts`(photo_chem·photo_digital_items·photo_digital_fixedback·photo_digital_sheet — 전부 오너 확정 전 기본값)·`TemplateSetForm` 적용 버튼·`scripts/register-photo-print-samples.mjs`(`--dry-run`/`--with-site`). 마이그레이션·새 api/worker env·FLAGS 키 없음(apps/worker 변경 0). 로컬 e2e 1차(10-19, 인쇄 ① 세트 런처 세션 → 패널·채움·옵션 직렬화·페이지 추가 통과, chemical 완료 검증 오류 0·`metadata.items` 3건) 결함 D1~D9(재오픈 캔버스 유실·런처 items 탈락·유테 도련·cover 폭 기준·촬영일 UTC·undo 잔존·editMode 잠금·chemical BLEED_MISSING·SDK export) + 적대 리뷰 확정 36건(반박 2) **전부 수정** — 수정 레인 실행 중 세션 한도로 1회 중단, 중간 결과(`wf4-lanes-partial`)에서 재개·완료. 전체 테스트(10-20 13:51 KST): api jest 154 스위트/3470 · worker 36/1353 · editor vitest 133 파일/1810 · canvas-core 63/754(node 24) · admin 24/302 · sdk 13/416 · tsc 7패키지 ok · types/canvas-core build ok · 샘플 스크립트 `--dry-run` 4세트 — 기준선(`9be4c37c`) 대비 회귀 0. 수정 후 e2e 재실측(10-20 13:50~14:05 KST): 인쇄 ① 런처 세션으로 D1·D2·D3·D8 해소·검증 경고 0·`sheet-map-r1` copies/label·deliverables·synthesize r2 통과, 추가 결함 D10(증설 페이지 사진틀 바인딩) 즉시 수정(editor vitest 133/1810); ②·③ 완료 e2e·25캔버스 실측은 미실행. CONTRACT_FREEZE **v1.25**(§1-D ADDITIVE 4건: `editor.complete` `items`+`product.kind` · `metadata.items` · 런처 deliverables 보강 · 검증 bleed 0 — 보정 2건: `metadata.productProfile` 서버 소유, duplex-split 회차 키·웹훅 `revision` 자동 sheet-map 잡 포함) 반영 완료; P2-d 반영 문서(P2 계획·DEPLOYMENT·EDITOR·GUIDE·WORKER·PDF)는 10-20 같은 문서 워크플로에서 갱신 중(완료 여부는 `git diff -- docs/` 로 확인). 오너 결정 대기(프로파일 값·코드 무변경): 판형 4x6(102×152)·카드 90×54, chemical 도련 0 유지 여부, 유테 2mm, 업로드 200/400장·25MB, 촬영일 'YYYY.MM.DD', 뒷면 refs[1]=`backTemplateId` 규약, chemical copies 는 deliverables `items` 로만, brightnessFix 통과만. 운영 샘플 세트 등록·배포는 오너 승인 후(보류). 다음: 오너 커밋 승인 → master 병합·배포 승인(worker → api + nginx → editor/admin, `VITE_ENABLE_PHOTO_PRINT` 기본 on) → P2-e 운영자 콘솔·§8.3 어댑터(jumbocard 우선).

> **10-18 15:10Z(10-19 00:10 KST) 갱신:** 브랜치 `p1-calendar-2026-10-17` = `f43cb99e`(P2-a·P2-b 커밋·push 완료, master 미병합). 그 위에 **P2-c sheet-map 워커 모드 미커밋**(커밋 승인 대기): worker `mode:'sheet-map'`(per-sheet `set_<i>.pdf` / merged-duplex `sheets_duplex.pdf`, 회전 상대 +180, 빈 면 삽입, post-process 별도 파일, `result.sheetMap` echo, 골든 22 ON/OFF 동일), api 완료 시 프로파일 `output.mode==='sheet-map'` → `createSheetMapJob`(duplex-split 대신, 킬스위치 `SHEET_MAP_OUTPUT_ENABLED` = FLAGS 17키), 파트너 v1 synthesize 가 sheet-map 세트도 재합성·deliverables `sheets`/`files[].copies,label`, CONTRACT_FREEZE v1.24. 로컬 e2e: 완료 → 13시트 산출 → deliverables ready → synthesize r2 → merged-duplex r3 26쪽 합본 통과. 다음: 오너 커밋 승인 → master 병합·배포(worker 먼저, `FLAGS_EXPECTED_API` 에 `PARTNER_SESSION_LAUNCH_ENABLED=true SHEET_MAP_OUTPUT_ENABLED=true`) → P2-d 사진인화.

> **10-17 18:35Z(10-18 03:35 KST) 갱신:** P2 착수(오너: 런처 → sheet-map → 사진인화; backRotation 0; 연동 순서 jumbocard → insta_print → Frameshop → 100p). **미커밋 작업 트리(커밋 승인 대기)**: P2-a `buildSheetMap`·시트 타입·DTO(`output.mode 'sheet-map'`); P2-b 런처 — 파트너 v1 `POST /api/v1/sessions/launch`·`GET :id/deliverables`·`POST :id/synthesize`(`apps/api/src/partner-sessions/`, 킬스위치 `PARTNER_SESSION_LAUNCH_ENABLED` = FLAGS 16키), SDK `client.sessions`, CONTRACT_FREEZE v1.23, 편집기 신규 세션 `metadata.calendar` 복원; e2e 에서 드러난 기존 결함 2건 수정 — 자동 duplex-split requestId 86자>VARCHAR(36)(→ 고정 태그) · 워커 합성 메타 조회 JWT 전용 401(→ `GET /files/:id/external` + `api://` 다운로드; 운영 SYNTHESIZE 12건 전부 mode NULL 이라 미노출). 로컬 e2e: launch 201 → `/embed?sessionId&token&refreshToken` → 완료 → deliverables `ready`(single api-key + sheet 13 signed, revision 4) 통과. 계획 정본 `docs/P2_PRODUCT_MODE_PLAN_2026-10-18.md`, 런북 DEPLOYMENT 「P2-b 런처…배포 절차(준비)」(운영 `FLAGS_EXPECTED_API` 에 키 추가 필요). 다음: 오너 커밋 승인 → master 병합·배포 승인 → P2-c sheet-map 워커 모드.

> **10-17 15:48Z(10-18 00:48 KST) 갱신:** master = `af900212`(캘린더 P1 전체: `1a0d80e3`·`638b7288`·`0c670adc`·`52563190`·`af900212`). **운영 반영 완료** — 마이그레이션 `20261017_add_template_set_product_profile.sql` 적용(컬럼 생성, 비NULL 0), VPS 체크아웃 `af900212`, api `1f175ce9a99b`·worker `df1f28f153ac`, `[FLAGS-CHECK] api ok n=15`, health 200, editor Vercel `dpl_8gfs7QNF…` Ready·admin `dpl_59TBLsed…` Ready. 롤백 태그 `rollback-pre-calendar-20261018`(= 직전 `a2a83d46b891`/`4f294db9c738`). **미실행**: 운영 샘플 세트 7종 등록 — 운영 관리자 자격증명이 `.env` 에 없어 오너가 직접 실행(`docs/DEPLOYMENT.md` 「P1 캘린더 운영 반영 절차」의 두 명령: `--dry-run` → `--allow-remote`). 상세: DEPLOYMENT 같은 절, 노트 `../_private_notes/wave12/P1_CALENDAR_DECISIONS_2026-10-17.md`.

> **10-17 10:35Z 갱신:** 브랜치 `p1-calendar-2026-10-17` 에 후속 커밋 `0c670adc`(자동저장 toJSON 예외 시 캔버스 누락 수정)·`52563190`(dev api/worker 부팅: pino-pretty 폴백·worker env) push 됨. 그 위에 **미커밋 34파일**(오너 커밋 승인 대기): 캘린더 cover 잡 `orderOptions.coverSpine='none'`(프로파일 세트만, 워커 spine 게이트 우회→단일 판형 검사), 완료 PDF export 옵션 3종(미사용 폰트 생략·워크스페이스 제외·'transparent' 치환, 프로파일 세트만)·그리드 bounds `fill:''`, `show.temporaryHolidays`(임시공휴일·선거일 고객 선택, 기본 법정만 — 오너 결정), DEPLOYMENT(mariadb 명령 정리·P1 운영 반영 절차 준비 절)·CONTRACT_FREEZE(v1.21 사후 등재 + v1.22 보강 coverSpine)·dev-start.sh. 로컬 e2e(폰트 시딩 후): 26쪽 PDF 폰트 0·투명도 0, 워커 isValid, 경고 = `BLEED_MISSING` 1건만(SPINE·TRANSPARENCY·FONT 소멸). KASI 대조: 2028 전부 일치(2028-04-12 선거일은 결정상 미추가), 2029~2035 는 KASI 미공표. **도련 정책 결정 A(오너, 10:40Z)**: 판형은 재단 그대로, 캘린더 세트에 `cropMarkEnabled=true`·`bleedMm=3`(등록 스크립트·admin 프리셋·매뉴얼 부록 D 반영) → 재실측 완료 PDF 26쪽 271×196·TrimBox 3mm, 워커 isValid·**경고 0**, 임포지션 잡 미발행. 커밋 승인 대기(약 38파일). 상세: `../_private_notes/wave12/P1_CALENDAR_DECISIONS_2026-10-17.md` 「미진행 항목 마무리」.

> **10-17 09:13Z 갱신:** 캘린더 P1 구현이 브랜치 `p1-calendar-2026-10-17` 커밋 `1a0d80e3`(73파일, master `a98d0219` 분기)로 origin 에 push 됨 — **master 미병합·운영 미반영**. 내용: 템플릿셋 `product_profile`(마이그레이션 `20261017_add_template_set_product_profile.sql`, NULL=기존 동작)·`CalendarPlugin`·달력 패널·검증 기대 쪽수(템플릿셋 프로파일 권위)·`editor.complete` `product` 키·날짜 데이터 `kr-2025-2035-v1`·샘플 7종 등록 스크립트·CONTRACT_FREEZE v1.22(ADDITIVE 3건, 적용 시점 미정). 로컬 e2e: 26캔버스 편집·저장·재오픈·26쪽 PDF(265×190, 약 11초)·워커 PASS. 전 패키지 테스트 통과(editor 118/1692, canvas-core 60/708, api 37스위트/1173@node22, admin 281, sdk 380). 상세·잔여 위험: `../_private_notes/wave12/P1_CALENDAR_DECISIONS_2026-10-17.md`. 다음: 오너 승인 뒤 master 병합 → 마이그레이션 → worker/api → nginx → editor/admin push, 운영 샘플 등록(`scripts/register-calendar-samples.mjs --dry-run` 먼저).
> **10-17 04:30Z 갱신:** master = `19f1ce7c`(낱장 N장 PDF·duplex-split 쪽수 원천·낱장 분류 검증 `productKind=sheet`·킬스위치 `EDITOR_SHEET_VALIDATION_RULES`, P0+(가)). **운영 반영 완료** — VPS 체크아웃·api(`a2a83d46b891`)·worker(`4f294db9c738`) = `19f1ce7c`, editor Vercel `6rjlodvpe` Ready, admin 생략. 이 배포로 §5.2.7 Wave 11(`ea4ae789`~`044a04ca`, 관찰 종료 뒤 별도 승인 예정이던 분)도 함께 운영에 들어갔다. 롤백 태그 `rollback-pre-sheet-20261017`(= `78b5c5a` 이미지), `.env` 백업 `.env.bak-20261017-sheet`, `FLAGS_EXPECTED_API` 15키. 상세: `docs/DEPLOYMENT.md` 「낱장 N장 PDF · duplex-split 쪽수 원천 · 낱장 분류 검증 배포 (2026-10-17)」, 노트 `../_private_notes/wave12/P0_SINGLE_MODE_DEFECTS_2026-10-16.md`. 다음: CONTRACT_FREEZE v1.21 등재·파트너 통지(초안은 노트), 낱장 cover 슬롯 판형·도련 검증 공백은 별도 결정.
> **10-15 08:27Z 갱신:** master = `ddd96482`(Wave 11 + 정리 4커밋 — 컨트롤러 주석을 동작 사실만으로 정리, fix-bleed·첨부 페이지 채움 응답 스키마 통일, 스키마 참조 범위 고정 테스트). 운영 반영 없음(아래 표 그대로). api 재빌드는 관찰 종료(~10-21) 뒤 별도 승인.
> **10-14 09:34Z 갱신:** master = `ea4ae789`(Wave 11 — 테스트·OpenAPI 스키마 코드·Loki 규칙 CI·문서 정정·업로드 상한 상수화, 동작 불변, §5.2.7). **운영 반영 없음** — 아래 표의 VPS 이미지·Vercel 배포는 그대로다(editor·admin 빌드 생략 판정). api 재빌드(OpenAPI 스키마 동승)는 잡 응답 키 전환 관찰 종료(~10-21) 뒤 별도 승인.

| 구성 | 현재 운영 | 롤백 |
|---|---|---|
| DB | 09-30 Wave 1 ~ 10-04 Wave 3 **마이그레이션 없음**. 마지막 스키마 변경은 09-29 `20260929`·`20260930`(ADDITIVE) | 백업 `~/backup-sites-pre-staff-edit-20260929.sql`·`~/backup-template_sets-pre-padstep-20260928.sql`. 추가 컬럼·테이블은 남겨도 무해 |
| api | `78b5c5a`(이미지 9f880c3ec267, 10-14 05:47:13Z — Wave 10: 파트너 잡 응답 키 한정(FREEZE v1.20, 06:30Z 설정 전환 후 재생성)·잡 상태 보고 라우트 내부 워커 전용·최종화 errorDetail.jobErrorCode(v1.19)·업로드 확정·잡 입력 확인 로그·bcrypt 6·AI 의존 제거·필터 설치 이미지(베이스 digest 고정·설치 스크립트 차단)) + nginx 05:47Z·06:30Z | 태그 `storige-api:rollback-pre-wave10`(= de68a7201718, `b76e927`) → `rollback-pre-wave9`(= e8f5bd686b27, = `rollback-pre-wave-b`) 만 보존(10-14 디스크 정리로 그 이전 태그 삭제). 롤백: `docker tag <태그> storige-api:latest && docker compose up -d --no-deps --no-build api && docker compose restart nginx`(기대값 프로필의 새 토큰도 같은 편집에서 정리 — DEPLOYMENT 플래그 표) · 잡 응답 키 한정만 되돌리기 = 설정 원복 후 api 재생성(이미지 그대로) · 킬스위치 = .env `EDITOR_CONTENT_PAGE_RULES=off` |
| worker | `78b5c5a`(이미지 67212683568c, 10-14 05:45:13Z — Wave 10: 플래그 판독 모듈화·검증 결과 코드 로그·필터 설치 이미지(베이스 digest 고정), PDF 도구 버전 불변(게이트 비교)) | `storige-worker:rollback-pre-wave10`(= 376052e8f43d, `b76e927`) → `rollback-pre-wave9`(= c73b2827a13e) 만 보존(10-14 정리) (큐 4종 0 확인 후 태그 원복 + `up -d --no-deps --no-build worker`) |
| editor | Vercel `nnvd2mwaw`(release `78b5c5a`, Ready 10-14 05:37Z — lockfile·frozen 설치·빌드 생략 판정 스크립트. 앱 번들 변화는 release 문자열뿐: release 없는 청크 이름이 직전 운영과 동일) | `50n1lwavx`(release `b76e927`) → `55d6gq227` → `8taztq201` → `diqgayglo` … promote |
| admin | Vercel `iuaj8g2oj`(release `78b5c5a`, Ready 10-14 05:37Z — 같은 이유, 앱 코드 변경 없음) | `4yuolx9r0`(release `b76e927`) → `naur32cp4` → `kolxzkmiv` → … promote |

- VPS 체크아웃 = `78b5c5a`(10-14). api·worker 이미지 = `78b5c5a`. SQL·마이그레이션 없음(Wave 1 이후). 계약 정본 **CONTRACT_FREEZE v1.20** — v1.18(SDK 알림 이벤트 payload 판독·소비처 원장 정정, P1) · v1.19(잡 상태 보고 라우트 내부 워커 전용·최종화 errorDetail.jobErrorCode — 적용 10-14 P2 완료 통지 시각) · v1.20(파트너 잡 응답 키 14개 — 적용 10-14 06:31Z 전환 완료 통지 시각, 7일 관찰 ~10-21).
- 플래그: 운영 값과 기대값 프로필은 비공개 메모 `../_private_notes/wave10/RESUME_OPS_PRIVATE.md` 「플래그」 절이 정본이다. 확인은 기동 로그 `[FLAGS]` 와 `[FLAGS-CHECK] <svc> ok n=…`(api 14·worker 9) 로 한다. 플래그를 바꿀 때는 운영 `.env` 의 기대값 프로필을 같은 편집에서 갱신한다(안 하면 mismatch 경고 — 동작에는 영향 없음). 킬스위치·비상 차단 절차는 `docs/DEPLOYMENT.md`.

- 그 밖의 worker `.env`(09-30 04:47Z, 불리언만): CUTOUT·LIGHTWEIGHT_VALIDATION·LIGHTWEIGHT_SYNTHESIS·CROP_MARK_VALIDATION·WIRED_FIXABLE_GATING = true / PRINT_NORMALIZE·FLATTEN·FILE_ORPHAN_* 미설정(코드 기본값).
- 운영 사이트 편집데이터 보관기간: **전 사이트 미설정(NULL)** — 양사 요청으로 유지, 설정할 때는 사전 통지.
- 로컬 백업 브랜치 `backup/*` 4개(`backup/wave1-pre-regroup-2026-09-30` 포함)는 10-14 오너 요청으로 삭제했다(bundle 보관 위치는 비공개 메모, 복원 절차 검증됨). 로컬 브랜치는 `master` 와 다른 세션 worktree 브랜치만 남는다.
- 개요 시각화: `docs/WAVE1_TRIMBOX_OVERVIEW_2026-09-30.html` — Wave 3 반영 갱신은 10-04 세션 정리 작업에서 진행했다(커밋 여부는 `git log -- docs/WAVE1_TRIMBOX_OVERVIEW_2026-09-30.html` 로 확인).

### 검증 기준선 (Wave 11 이후 — 이보다 낮으면 회귀)

| 대상 | 기준 |
|---|---|
| api jest | 138 스위트 / 3118(10-15) · lint 0 err(경고 44) · nest build · contract-freeze 94 |
| CI loki-rules | `.github/workflows/loki-rules.yml` — docker/loki·compose 변경 시 규칙 구조(그룹 2·규칙 6)·alertmanager_url 빈 값·Loki 3.2.1 실기동 로드 확인 |
| worker jest | 34 스위트 / 1294 · lint 0 err(경고 16) · nest build |
| editor vitest | 107 파일 / 1601(Node 24·26) · tsc · lint 0 err(경고 76) · build · build:embed |
| embed-e2e(Playwright `tests/embed-mode`) | 39 — CI 편입(번들 chromium) |
| sdk | 12 / 375 · tsc |
| admin vitest | 21 파일 / 261 · lint 0·0 · build |
| canvas-core | 57 / 658 |
| api test:e2e | 7 스위트 / 175 — CI 별도 잡 `api-e2e`(Wave 10 편입) |

- worker `crop-mark-validation.spec` 파리티 1건은 API 스위트와 동시에 돌릴 때만 간헐 실패한다(부하성). 단독 실행하면 통과한다.

### 배포 방식 메모

- editor·admin: master push 가 곧 배포다(**push 전 오너 승인**). Wave 10 부터 빌드 생략 판정은 `scripts/vercel-ignore-build.mjs` 다 — 직전 운영 배포 커밋이 얕은 clone 밖이면 공개 URL 로 받아 와 판정하므로 문서 전용 push 가 쌓여도 재배포되지 않는다(10-14 preview·운영 실측). 설치는 frozen-lockfile. 문서만 바꾼 push 는 Vercel 빌드가 Canceled 되고 기존 Ready 가 유지된다(정상). Vercel 대기 루프는 **새 배포 id** 를 매칭한다.
- api·worker: VPS 수동 배포(`CLAUDE.local.md` §6). 순서: 직전 이미지 태그 `rollback-pre-<이름>` 보존 → `git pull` → build → **worker 먼저** `up -d` → api `up -d` → **nginx 재시작** → 기동 로그 `[FLAGS]` 확인 → 스모크(health 200, 무인증 경로 401, guest 토큰 없음 403, api·worker 오류·5xx 0, 대기열 0).
- DB 변경이 있으면 prod 는 `synchronize=false` 이므로 `apps/api/migrations/` SQL 을 먼저 수동 적용하고 백업을 남긴다.

---

## 3. 파트너 채널·운영 사실

| 파트너 | 창구(시작 시 재확인) | cwd | 운영 상태(마지막 ACK) |
|---|---|---|---|
| bookmoa | 비공개 메모 「창구」(10-13: 미확보 — 오너가 세션 재개) | `~/Developer/claude/bookmoa-mobile` | 운영 R-234 `ah9w77nfs`(10-12 — R-225~R-234 관리자 수동 검토 메일·고객 화면·토스 결제 웹훅·승인 정합, Storige 계약·편집기·워커 영향 없음). Wave B 완료 통지(10-08) 원장 기록. Wave 8 1단계·2a·N-API-3b(v1.15)·2b(v1.16) 원장 기록·ACK 완료. 동화책 207c458f 유지(전환 = e2e + 인쇄팀 확인 뒤), 미연결 13세트 연결 계획 없음. e2e 최소 묶음 실행 시각 = bookmoa 오너 결정 대기(정해지면 통지) |
| printy | 비공개 메모 「창구」(10-13: 확인됨) | `~/Developer/claude/printy` | 운영 printy `f7a574d`(printy 저장소) 이후 변경 없음(10-03). 실 e2e 재개 **미정**(오너 보류) |
| 100p Books | 비공개 메모 「창구」(10-13: 확인됨) | `~/Developer/claude/100p_books` | 유형 1(upload·validate·download external). 편집 세션·합성 계획 없음 |
| ShareSnap·북모아 메인(PHP)·MD2Books | 연락 채널 없음(오너 확인 필요) | — | — |

- 현재 Storige 세션 이름·ref 도 비공개 메모 「창구」 절에 둔다(앱 재시작 시 ref 변경).
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

- **Wave B 플래그 판단 — 완료(10-08)**: 값과 절차는 비공개 메모. 근거·절차는 비공개 메모(`../_private_notes/wave2/`, `../_private_notes/wave8/NEXT_ISSUES_2026-10-08.md` §1).
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
- (10-06 당시) 오너 결정 대기: Wave 8 안 선택, 플래그 전환, 재편집 가드 방식(ADDITIVE vs MODIFY-TARGET), 운영 DB 읽기(인벤토리·실측), branch ruleset, compose 기본값, fabric 7 승격 시점, Dependabot, 신규 파트너 연락 채널, 관리자 화면 E2E 시간.

### 5.2.2 다음 개발 이슈 정리 (2026-10-08, 오너 보고 — Wave B 판단·Wave 9 구성 결정 대기)

- 정본 비공개 `../_private_notes/wave8/NEXT_ISSUES_2026-10-08.md`(10-06 목록 110건 상태 대조 + 신규 27건, 4관점 수집·반박 검증, 코디네이터 실측 반영).
- 10-06 대비: done 15 · partial 10 · obsolete 1(N-TD-4 동화책 13세트 — 연결 계획 없음).
- **P0**: ① Wave B 플래그 판단(10-08 09:51Z 이후, 오너) — Loki 7일 실측 결과 관측 로그 0·worker-jobs/edit-sessions 요청 27건 전부 배포 스모크(실 호출 0). 플래그별 권고(비공개 메모) ② `EDITOR_CONTENT_PAGE_RULES` 가 docker-compose api environment 에 매핑돼 있지 않음 → env 킬스위치 롤백 불가(현재 롤백 = 이미지 태그 `rollback-pre-n-api-3b`) — compose 1줄 + api 재생성 ③ 운영 편집기 AI 탭이 빈 패널(`VITE_ENABLE_AI_PANEL` 미설정 → 탭 노출, `VITE_AI_ENABLED=false` → 패널 미포함, 운영 번들 확인) ④ CI `ubuntu-latest` 가 2026-10-19 부터 Ubuntu 26 → `ubuntu-24.04` 고정.
- 권고 Wave 9 = 안 1(운영 안전·CI 게이트·서버 보안 마이너: N-OPS-5·N-OPS-4·CI nest build/lint·N-NEW-1 서버 런타임 마이너·N-API-14a·N-OPS-10a·런북 갱신·동화책 전환 SQL 팩·FILE_SITE 계약 초안·DEPLOYMENT/RESUME 스테일). 안 2(편집기·임베드 후속 + editor 보안 마이너)는 bookmoa e2e 뒤.
- **오너 결정(10-08)**: Wave B 플래그 판단(비공개 메모) · P0 3건 진행 · **Wave 9 보류**. **배포 완료(10-08)**: 커밋 `5ef27c0`(compose 킬스위치 매핑·editor `VITE_ENABLE_AI_PANEL=false`·CI/gitleaks `runs-on: ubuntu-24.04`) push 14:17:41Z → CI 37791275517 green(test 1회 간헐 실패 `apps/worker/src/utils/synthesis-input.spec.ts:330` qpdf 1ms 시간 초과 경합 → 재실행 통과, 러너 이미지 ubuntu-24.04 동일) · Vercel editor `8taztq201` → VPS .env 백업·`rollback-pre-wave-b` 태그·pull `5ef27c0` → .env 플래그 1줄 → api 재생성 14:37:16Z(재빌드 없음) + nginx 14:37:25Z → 스모크 정상([FLAGS] 기대값과 일치·EDITOR_CONTENT_PAGE_RULES=true, health 200, 무인증 401, with-templates 3세트 200 구조 불변, 경고·오류 0, nginx 5xx 0). 3사 사전 안내·완료 통지(bookmoa 영향 없음 회신). 후속: qpdf 시간 초과 테스트 간헐 실패 안정화, Node 20 대상 액션 메이저 bump, ubuntu 26.04 사전 검증.

### 5.2.3 Wave 9 안 1 (2026-10-12 설계·결정·구현·배포 완료)

- 정본 비공개 `../_private_notes/wave9/DESIGN_W9.md`(작업 단위 T9.1~T9.18 + 선택 T9.19~T9.22, 오너 결정 D1~D11), 결정 기록 `../_private_notes/wave9/CTO_DECISIONS_W9.md`.
- **문서 push 주의(10-12 확인 → 10-14 Wave 10 C14 로 해소, 5.2.5)**: Vercel ignoreCommand 는 직전 운영 배포 SHA 가 depth 10 clone 밖이면 무조건 빌드한다 → 문서 전용 커밋도 거리 10 이상이면 editor·admin 운영 재배포. push 전 `git rev-list --count <운영 release sha>..HEAD` 확인(운영 release 는 공개 번들의 `storige-editor@…`·`storige-admin@…` 문자열).

- **오너 결정(10-12)**: 범위 18건 + 선택 4건, D2 = B2 기대값 경고, D3 = 권고안 A(typeorm 0.3.31·express/body-parser 범위 override), D4~D7·D9~D11 권고안, push 마다 개별 승인.
- **배포 완료(10-12)**: P1 `6f4a32e..cfcab50`(CI 게이트·액션 v7/v5·qpdf spec·러너 probe·DEPLOYMENT Wave 8 절·예제) push 15:08:22Z → CI 38268035509 green, Vercel 빌드 skip. P2 `cfcab50..b76e927`(14커밋) push 15:25:37Z → CI 38270147876 green → VPS 태그 `rollback-pre-wave9`(실행 중 이미지 기준)·.env 백업·`FLAGS_EXPECTED_*` 2줄 → worker 빌드·sharp x64 OK·재생성 15:37:33Z(`[FLAGS-CHECK] worker ok n=9`) → api 빌드·sharp OK·재생성 15:39:57Z(`[FLAGS]` 토큰 1개 추가, `[FLAGS-CHECK] api ok n=13`) + nginx 15:40:06Z → Vercel editor `50n1lwavx`·admin `4yuolx9r0` Ready 15:41Z(push 후 약 15분 지연) → 스모크 정상(health 200, 무인증 401, with-templates 3세트 200, 잘못된 JSON 400 동일, Loki 오류·5xx·[env]·JOB_STALLED 0). 3사 사전 고지·완료 통지 15:43Z(= FREEZE v1.17 적용 시점), 100p 에는 FILE_SITE 중간 회신 동봉. **bookmoa 는 bridge 주소로 보냈으나 전달 미확인** — 새 bookmoa 창구 이름을 받으면 완료 통지 재발송.
- 검증 기준선(Wave 9 후): api 134 suites/2912 · worker 34/1268 · editor 107/1601(Node 24·26) · admin 21 files/261 · canvas-core 57/658 · sdk 369 · contract-freeze 94 · embed-e2e 39 · api e2e 기존 실패 5 suites/95(기준선과 동일 — 후속).
- 비공개 준비물: `../_private_notes/wave9/OBSERVATION_RUNBOOK_W9.md`(Loki 기준), `SB_TRANSITION_PACK.md`(+sb_00~05), `FILE_SITE_CONTRACT_DRAFT.md`(+fs_retro_r0_r3.sql).
- 후속: CI 액션 SHA 고정·persist-credentials·dependabot(오너 결정), RESUME 의 운영 플래그 값·창구 id 를 비공개로 옮길지(오너 확인), hostPageLimits.test 부하 시간 초과, 로컬 embed-e2e 종료 지연, ShareSnap compose-mixed 수동 본문 400, api e2e 기존 실패 원인, editor·canvas-core 보안 권고(안 2), 설치 시점 체인 권고(Wave 10).

### 5.2.4 다음 개발 이슈 정리 (2026-10-13, 오너 보고 — 결정 대기)

- 정본 비공개 `../_private_notes/wave9/NEXT_ISSUES_2026-10-13.md`(10-08 목록 122건 대조 + 신규 25건, 4관점 수집·반박 검증).
- **첫 실 파트너 흐름 관측(Loki)**: 10-10 12:52Z·10-12 06:32Z 에 업로드(presigned → complete) → 검증(validate/external) → 결과 조회 2회. 검증 결과 PASS 1·FAIL 1. 10-13 운영 읽기로 판정 완료(bookmoa PASS·경고 4, printy FAILED SPINE_SIZE_MISMATCH — 상세는 비공개 메모), printy 회신 발송, bookmoa 는 창구 확보 후.
- P0: 첫 실 흐름 판정·회신, bookmoa 창구 재확인(10-12 통지 전달 미확인), 운영 메모 보관처 정리, 이 문서의 시작 프롬프트·창구 정정. 권고 Wave 10 = 안 1(실 트래픽 대응·관측·서버 공급망).

### 5.2.5 Wave 10 안 1 (2026-10-13 설계·결정 → 10-14 구현·배포·파트너 잡 응답 키 전환 완료)

- 정본 비공개 `../_private_notes/wave10/DESIGN_W10.md`(작업 단위 28: 포함 21·선택 6·보류 1, 오너 결정 D1~D12), 결정·배포 기록 `../_private_notes/wave10/CTO_DECISIONS_W10.md`. 구현 = 3레인 병렬 → 통합 → 2관점 검토(GO_WITH_FIXES, major 4 반영) → 수정.
- **P1(10-14)**: `f1af9e6..bf5291a`(api e2e 복구·CI `api-e2e` 잡, SDK 알림 payload 판독, compose 정합 spec 소스 키 포함 검사, FREEZE v1.18 정정) push 03:54Z → CI 38508663086 green(api-e2e 7/175), Vercel 생략(거리 9).
- **Vercel preview 실측(10-14)**: 실측 브랜치 첫 push 빌드 → 빈 커밋 11 개 뒤 직전 배포 커밋 보충·생략 → editor 커밋에서 editor 빌드·admin 생략 → 실측 브랜치 삭제. 성공 → C14(빌드 생략 판정 스크립트·frozen 설치)를 P2 에 동승.
- **P2(10-14)**: `bf5291a..78b5c5a`(13커밋 — 의존성·이미지 필터 설치·digest·설치 스크립트 차단, worker 플래그 모듈, 관측 로그, env 매핑 정리, 파트너 잡 응답 키(설정 OFF 로 배포), books jobErrorCode, 잡 상태 보고 내부 전용, Loki 규칙, admin Dockerfile, FREEZE v1.19, Vercel C14) push 05:36:50Z(직전 2h 파트너 요청 0 확인 뒤) → Vercel editor `nnvd2mwaw`·admin `iuaj8g2oj` Ready → CI 38517575208 green → VPS 태그 `rollback-pre-wave10`·.env 백업 → worker 05:45:13Z(게이트 sharp·app.module·도구 버전 동일, `[FLAGS-CHECK] worker ok n=9`) → api 05:47:13Z(게이트 sharp·app.module·bcrypt, 기대값 프로필 토큰 1개 추가, `[FLAGS-CHECK] api ok n=14`) + nginx → 스모크 정상(공개 API 응답 배포 전과 동일, Loki 오류·5xx·[env]·JOB_STALLED 0) → loki 재생성 05:48:29Z(규칙 6개 health ok). 3사 사전 고지·완료 통지.
- **파트너 잡 응답 키 전환(10-14)**: 3사 서면 회신(10-13) → 사전 통지 06:0xZ(오너 결정으로 당일 전환, 이의 없음) → 06:30Z 설정 전환·api 재생성 → 응답 키 14·result.result 유지 확인, 스모크 정상 → 완료 통지 06:31Z(= FREEZE v1.20 적용). 7일 관찰(~10-21), 문제 시 설정 원복 후 통지·C15 되돌림.
- 후속: CI 에 Loki 규칙 검사, 실제 컨트롤러 HTTP 수준 spec(잡 응답 키·상태 보고 404), editor Dockerfile 빌드 실패 숨김 제거·editor·admin 베이스 digest, GUIDE 옛 'outputFileUrl 직접 GET' 서술 2곳·DEPLOYMENT 플래그 나열 보강, 배포 사후 자산 비교 방법 정정(운영 env 반영), ubuntu-26.04 probe 1회차(10-19~25).
- **정리(10-14)**: VPS storige-api·worker 옛 이미지 태그 45개·24h 넘은 빌드 캐시·md2books 옛 컨테이너 2·이미지 3 정리 → 디스크 85% → 24%(롤백 태그 wave10·wave9, md2books 실행·직전 이미지는 보존). 로컬 wave9·wave10 브랜치·worktree 정리(원격 브랜치는 이미 없음, 백업은 비공개 메모).

### 5.2.6 다음 개발 이슈 정리 (2026-10-14 — Wave 10 직후, 세션 교대)

- 정본 비공개 `../_private_notes/wave10/NEXT_ISSUES_2026-10-14.md`, 새 세션 시작 절차 `../_private_notes/wave10/NEW_SESSION_PROMPT_2026-10-14.md`.
- 진행 중: 파트너 잡 응답 키 전환 7일 관찰(~10-21, 일일 Loki 집계), CI 러너 probe 1회차(10-19~25), 운영 메모 보관처 이전(오너).
- (10-14 갱신) 아래 Wave 11 후보 중 Dockerfile 정비를 뺀 항목은 §5.2.7 에서 처리 — OpenAPI 는 코드만(배포 대기), audit 5건은 수용.
- Wave 11 후보(작음·검증 보강): 컨트롤러 HTTP 수준 테스트(잡 응답 키·상태 보고 404), CI 에 Loki 규칙 검사, GUIDE·DEPLOYMENT 옛 서술 정리, OpenAPI 잡 응답 스키마 게시, editor·admin Dockerfile 정비(빌드 실패 숨김 제거·베이스 digest), 배포 사후 자산 확인 방법 정정(운영 env 반영), 의존성 audit 잔여 5건, 미사용 테스트 유틸 삭제.
- 별도 트랙·오너 결정: 파일 사이트 귀속 엄격 전환, 세션 출력 조회 플래그(근거 대기), 고객 번들 변경 묶음·Playwright 승격(bookmoa e2e 뒤), 알림 수단 확장, CI 액션 고정.

### 5.2.7 Wave 11 (2026-10-14 재점검·설계·구현·push — 운영 반영은 관찰 종료 뒤)

- 정본 비공개 `../_private_notes/wave11/W11_SCOPE_DRAFT_2026-10-14.md`(재점검 판정·오너 결정 4건), 레인 계약 `contract-l1~l5.json`, 기록 `../_private_notes/wave10/CTO_DECISIONS_W10.md` 끝. 진행 = 재점검(5그룹 + 반박 검토) → 오너 결정 → 설계(레인 5 + 2관점 검토, 지적 18 반영) → 레인 병렬 구현 → 통합 → 2관점 검토 → 수정.
- 오너 결정: 범위 L1~L5(Docker 정비 제외) · OpenAPI 잡 응답 스키마 = 조회 + 공개 생성 6라우트, 관찰 종료 뒤 첫 api 재빌드에 동승 · storige-editor 컨테이너(소비자 0)는 이번엔 기록만 · 의존성 audit 잔여 5건은 도달 경로 없음 근거로 수용.
- **push(10-14): `21398b5..ea4ae789` 09:34:44Z(13커밋)** → CI ci·loki-rules·gitleaks green, Vercel editor·admin 생략(운영 유지). 내용: 실제 WorkerJobsController HTTP spec(상태 보고 두 경로·잡 응답 형태), 미사용 test-utils 삭제, `PartnerJobViewDto`·7라우트 응답 스키마(공개 `/api/docs` 는 api 재빌드 뒤 반영 — 파트너 포털 export 불변), Loki 규칙 CI, GUIDE compose-mixed 회수 안내를 output-url 재발급으로 정정·DEPLOYMENT 플래그 나열·빌드 생략 판정·업로드 상한 서술, 업로드 상한 경로별 상수(storage 50MB·files 100MB, env 읽기 제거 — 운영 env 에 키 없음 확인). 3사 GUIDE 정정 FYI(동작 변경 없음).
- 사실 정정: apps/docs 와 연결된 Vercel 프로젝트는 없다 — `docs/`·`apps/api/src` push 로 문서 포털이 배포되지 않는다.
- **정리 push(10-15): `ceaf97ef..ddd96482` 08:27Z(4커밋)** → CI ci·gitleaks green. 컨트롤러·서비스 주석에서 결정 경위·파트너명·내부 번호를 빼고 동작 사실만 남김(원문은 비공개 메모), fix-bleed·`fix-pagecount/attach` 201 스키마도 `PartnerJobViewDto`(공개 `/api/docs`·포털 export 불변), 스키마 참조 operation 9개 고정 spec. `CONTRACT_FREEZE.md` 본문은 오너 결정으로 그대로 둔다.
- **운영(10-15):** 운영 메모의 비밀값을 저장소 밖으로 이전 완료 — 에이전트도 메인 체크아웃에서 작업 가능(비밀값 보관 위치는 열지 않음). 알림은 오너 결정으로 '매일 아침 자동 점검(읽기 전용 Loki 집계 → 오너 휴대폰 알림)' — 서버 알림 장치(Alertmanager)는 분 단위 대응이 필요해질 때 재검토. 관리자 계정 비밀번호 교체는 서비스 오픈 전후로 연기.
- 관찰 1·2일차(10-14·10-15): 이상 없음, 전환 뒤 파트너 잡 조회 0건.
- 다음 이슈 정본(10-15): 비공개 `../_private_notes/wave12/NEXT_ISSUES_2026-10-15.md`, 새 세션 시작 절차 `../_private_notes/wave12/NEW_SESSION_PROMPT_2026-10-15.md`. 세션 교대(10-15): bookmoa·printy 에 교대 예고, 새 세션이 이름 통지(100p 포함).
- 다음: 관찰 종료 기록(~10-21) → api 재빌드(OpenAPI 스키마 동승 — 잡 응답 키 설정이 켜진 상태에서만, 되돌릴 때는 스키마 커밋도 함께 되돌림) → GUIDE changelog 에 `/api/docs` 스키마 추가 기록. 후속: 컨트롤러 옛 주석 정리, fix-bleed·첨부 페이지 채움 응답 스키마, storige-editor 컨테이너 제거 여부, CI 액션 SHA 고정, ubuntu-26.04 probe(10-19~25).

### 5.2.8 캘린더 편집 모드 트랙 (2026-10-16 설계 → 10-17 P0·(가) 배포 → 10-18 P1 운영 반영 → 10-21 P2-a~d 운영 반영)

- 목표: 상품별 편집 모드(캘린더 탁상·벽걸이, 사진인화, 낱장 분류)와 외부 연동(100p·JumboCard·insta_print·FrameShop·bookmoa). 정본 설계 `docs/PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md`(3안 경쟁·3인 심사 종합), 캘린더 세부 `docs/CALENDAR_EDIT_MODE_DESIGN_2026-10-16.md`.
- 완료(10-17, master `19f1ce7c` 운영 배포): P0 — 낱장 N장 PDF(`selectSingleModePdfCanvases`)·IIFE 배열 저장(`collectCanvasData`)·duplex-split 쪽수 원천(`resolveSessionPageCount`); (가) 낱장 분류 검증 — worker `productKind='sheet'` 정확 쪽수(+`pageStep`)·`postProcessColorRule`, api `deriveSheetValidationRules`(single 세트·spine/wing/spread 없음·표지 전용 제외), 킬스위치 `EDITOR_SHEET_VALIDATION_RULES`(15번째 FLAGS 키). 운영 실측: single 세트 세션 90일 0·duplex-split 0·post_process 0.
- P1 완료(10-17, 브랜치 `p1-calendar-2026-10-17` `1a0d80e3`, 미병합): 오너 결정 — 삼각대 비편집, 탁상 4종·벽걸이 1단·2단 2 전부 26캔버스(표지 1+12개월×2면+에필로그 1, 13장 양면), 26쪽 단일 PDF, 날짜 데이터 정적 v1 오너 승인 릴리스, 샘플 7종 세션 등록. 구현: `packages/types/src/product-profile.ts`, api `product_profile` 컬럼·DTO·검증 기대 쪽수(`sheet-validation-rules.ts` 템플릿셋 프로파일 권위), editor 고정 캔버스·라벨·달력 메뉴/패널·`metadata.calendar`·`product` 키·프로파일 세트 PDF 판형=템플릿셋, canvas-core `CalendarPlugin`·`calendar/core`·`kr-2025-2035-v1`(KASI 2025~2027 대조, 2026 개정 노동절·제헌절), admin 프로파일 JSON 섹션·7종 프리셋, `scripts/register-calendar-samples.mjs`, 매뉴얼 부록 D, CONTRACT_FREEZE v1.22. 잔여(10-17 11:30Z 기준): 도련 정책은 결정 A(세트 `cropMarkEnabled`+`bleedMm 3`, 판형=재단)로 종결 — 완료 PDF 경고 0 실측; 운영 폰트 라이브러리에 템플릿 폰트 필요(없으면 래스터 폴백→TRANSPARENCY); 2029~2035 KASI 공표 후 대조; 임시공휴일·선거일은 고객 선택(`show.temporaryHolidays`, 데이터 추가 없음). 해결됨(브랜치, 일부 미커밋): 자동저장 누락(`0c670adc`), dev 부팅(`52563190`), SPINE(`coverSpine`)·TRANSPARENCY·FONT 경고(export 옵션).
- 운영 반영(10-18 00:48 KST): master `af900212`, 마이그레이션·api·worker·nginx·Vercel editor/admin 완료(DEPLOYMENT 「P1 캘린더 운영 반영 절차」). 다음: 오너가 운영 샘플 7종 등록(`--dry-run` → `--allow-remote`), 운영 폰트 라이브러리 템플릿 폰트 확인, 첫 캘린더 완료 세션 워커 결과 관찰(경고 0 기대). 계획 `docs/CALENDAR_MODE_DEVELOPMENT_PLAN_2026-10-17.md` §11 P1 행 상태 갱신은 후속.
- P2(10-18 ~ 10-20): 정본 `docs/P2_PRODUCT_MODE_PLAN_2026-10-18.md`. P2-a buildSheetMap·P2-b 런처(파트너 v1 sessions 3라우트·SDK·CONTRACT v1.23) 구현·로컬 e2e 통과 → 커밋 `f43cb99e`(10-18). 기존 결함 2건(duplex-split requestId 길이·워커 파일 메타 401) 동시 수정. P2-c sheet-map 워커 모드 구현·로컬 e2e 통과(10-19) → 커밋 `9be4c37c`(CONTRACT v1.24). P2-d 사진인화(10-19 ~ 10-20, 커밋 `237e6b91`; 2차 e2e·D11~D13 `11383962`): types `'photo-print'`·`PhotoPrintProfile`·`PhotoItem`, canvas-core `PhotoPrintPlugin`, 편집기 `PHOTO_PRINT` 메뉴·패널·`metadata.items`·완료 `items`, api `photo-items.ts`(sheet-map copies/label 주입·deliverables `items`·`metadata.productProfile` 서버 소유·검증 bleed 0), SDK·admin 프리셋 4종·샘플 스크립트, CONTRACT v1.25 — 로컬 e2e 결함 9건·적대 리뷰 확정 36건 수정, 전체 테스트 회귀 0, 수정 후 e2e 재실측 통과·D10 추가 수정(상세 §2 10-20 04:51Z 줄). 브랜치 `p1-calendar-2026-10-17` 전체(P2-a~d)는 master 미병합·운영 미반영. 잔여: P2-e 운영자 콘솔, §8.3 어댑터(jumbocard 우선).
- 운영 반영(10-21 16:00 KST): master ff `af900212`→`11383962`(+ 기록 `e9725838`) — api `fcad1293f0e6`·worker `4f73a4c4efb4`, `[FLAGS-CHECK] api ok n=17`·`worker ok n=9`, Vercel editor/admin Ready(DEPLOYMENT 「P2-d」 절 끝 「반영 기록」). 2차 로컬 e2e(② 고정 뒷면·③ 카드형 완료, 26캔버스 PDF 9.9s, 킬스위치 리허설)와 결함 D11(초기 뒷면 잠금)·D12(틀 채움 storage 업로드 — base64 canvasData 가 MariaDB 16MB 패킷 초과하던 결함)·D13(sheet 분리본 미참조 XObject 정리) 수정은 P2 계획 §7.1. 다음: 캘린더 편집기 기능 확장 계획 `docs/CALENDAR_EDITOR_FEATURE_PLAN_2026-10-21.md`(병렬 트랙·오너 결정 대기 항목).
- W1 T1a 실측(10-22 22:05 KST, 코드 무변경): 캘린더 프리셋 3종 + 사진 13장 완료 PDF·킬스위치 리허설 2종 통과/실패 기록(`CALENDAR_EDITOR_FEATURE_PLAN_2026-10-21.md` §8.1). `VITE_ENABLE_CALENDAR=false` 통과, `EDITOR_SHEET_VALIDATION_RULES=off` 는 캘린더 검증 실패(C1 → DEPLOYMENT 경고, D10). 다음: 오너 D1~D11 답변 → T3a·T1b(W2); T2 worktree 결과 R 검토.
- W1 T2 운영 반영(10-22 23:48 KST, master `c040b68e`, editor·canvas-core 전용) · 10-23 D12 방어선(`dbc2333f`, packet 256M) · 10-23 HTML 시각화(`2d45fd54`, p1-calendar) · 10-24 계획 v3 + 새 세션 프롬프트(`.cursor/plans/CALENDAR_EDITOR_ORCHESTRATION_SESSION_START_PROMPT_2026-10-24.md`). 현재 게이트: 오너 D1~D11 미답(T3a 는 D2, T5 는 D3, T4 는 D4, T6 는 D5, T1b 범위는 D8). 다음 세션은 서브에이전트 오케스트레이션으로 W1 잔여(T3a, D10 승인 시 C1 코드 분리 동반) → W2(T1b → T3b ∥ T4 ∥ T6) → W3(T4r ∥ T5 ∥ T7a → T7b); 운영 프로파일 세트 0건(10-22)·샘플 등록·폰트 확인은 오너(B9·D7).
- 미반영 문서: CONTRACT_FREEZE v1.21(MODIFY-TARGET 2·ADDITIVE 1)·PLATFORM_INTEGRATION_GUIDE·PDF_VALIDATION_GUIDE — 초안은 `../_private_notes/wave12/P0_SINGLE_MODE_DEFECTS_2026-10-16.md`(docs dirty 해소 후 반영). 별도 결정: 낱장 cover 슬롯 판형·도련 검증 게이트 우회 여부.

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
