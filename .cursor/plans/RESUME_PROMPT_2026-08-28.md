# RESUME PROMPT — 2026-08-28

> **이 문서가 최신 날짜 정본이다.** 8/25~8/28 상세 이력(⑫~⑮ 테넌시 트랙 전개, ④~⑪ 편집기/플레이크)은 `RESUME_PROMPT_2026-08-25.md`(누적 갱신본) 참조.

## 0. 현재 라이브 상태 (2026-08-28 세션 종료 기준)

- **master = origin/master = 60f5e2d**, 워킹트리 클린(`.tmp-verify-combos/`·docs/SHOPIFY_*·docs/SITE_CATALOG_* untracked 는 타 세션 산출물 — 무접촉, `git add` 항상 명시 목록)
- 배포: editor/admin=Vercel master push 자동 / API·워커=VPS 수동(`CLAUDE.local.md` §6). ⚠️ api recreate 시 nginx 재시작, **nginx 볼륨 변경 시엔 restart 가 아니라 `up -d`(recreate)**

### 검증 기준선 (이보다 낮으면 회귀)

| 대상 | 기준 |
|---|---|
| api jest | **78스위트/1071 PASS** · contract-freeze 73 · lint 0err |
| editor vitest | **66파일/785 PASS** · tsc 0err · eslint 0err |
| canvas-core | 54파일/623 PASS(⚠️ 로컬은 Node 22/24 전용 — 26 은 프리플라이트가 하드 실패) · lint 0err |
| 플레이크 | **등재 0종** — "전체실행 무작위 실패"와 "partner-api-keys 타임아웃"은 supertest 주소 패밀리 버그로 근본 해소(0d65984). 재발 시 spec 아닌 로컬 포트 스쿼터부터 의심 |

## 1. 🔴 이번 세션 최우선 — 테넌시 S3·S4 cutover (D5 = 2026-09-04)

**트랙 상태: cutover 전 조건 전부 완결.** 양사 코드 전환 완료·D5 동의+도달 증빙 완결·유예 경로 의존 0 을 3중 확인(30일 소비 0 실측 + bookmoa 재실측 + printy 소스 전수 감사). 상세 = 08-25 정본 ⑫~⑮ + `TENANCY_S3_S4_DESIGN_2026-08-28.md`.

**9/4 도래 시 실행 절차(스크립트화):**
1. `docker/nginx/nginx.conf` 의 `/storage-signed/outputs/` 블록 **아래**에 신설:
   ```
   location /storage/outputs/ {
       return 410;
       add_header X-Storige-Notice "gone — use GET /api/worker-jobs/external/:id/output-url" always;
   }
   ```
   (최장 접두 매칭이라 `/storage/` 보다 우선. uploads·designs·thumbnails 무변경)
2. 커밋·푸시 → VPS `cd ~/storige && git pull && docker compose up -d nginx`
3. 실증 3단: 구 무인증 outputs URL → **410** / 서명 URL(재발급 API 경유) → **200** / `/storage/uploads/...` 아무 파일 → **200**
4. 양사 세션 채널로 실행 완료+실증 결과 재통지(§3 채널 가이드)
5. cutover 관측 후 **D6 착수**: NULL-파괴 게이트 + 이원 정책 allowlist 승격 + **백필 41건**(설계안 §2-B' — 세션 역참조, 백필 전 해당 파트너 타 키 사용 관측 선행)

관련 시크릿: 서명 시크릿은 VPS `~/storige/.env` 의 `OUTPUT_SIGN_SECRET` + `docker/nginx/secure-link-secret.conf`(gitignored, 동일값 필수). NULL 잡 조임은 env `OUTPUT_URL_NULL_JOB_SITE_ALLOWLIST`(현재 미설정 = 유효 키 전부).

## 2. 잔여 작업 (우선순위)

**P0 — 오너 액션**
1. 파트너 회신문 발송 잔여: ⓐ 8/24 통지 4종 ⓑ 프린티 템플릿셋 스코프 ⓒ new.bookmoa.com 3건 ⓓ 프린티 업로드 테넌시 (ⓔ 서명 URL 공지는 양사 세션 채널로 기전달 완료)
2. 동화책 왕복 실기(8/22 이월) + 재진입 시드 실측(`__storigeLoadProfile.laps` 의 `grow:*` — 읽기 전용으로)
3. bookmoa 장바구니 #1 테스트 항목 삭제(8/21 부산물)

**P1 — 코드 후속**
4. 재진입 시드 2차 최적화(실측 후 판단 — FontPlugin A-1 은 canvas-core 소유권 배정 필요)
5. api lint 범위 사각지대(scripts/·test/ — projectService 전환 또는 별도 config 블록)
6. (관찰) 시드 표기 잔여 — 레거시 `/` 경로·게스트 세션 미적용, updatedAt 의미 폭

**P2 — 기존 백로그**: bookmoa 구 프로젝트 폐기 시 allowlist 구 오리진 제거(파트너 요청 대기) / 업계표준 R6·R10·R3b / 파일 보존 P1·P2(고아 — D6 백필과 교차) / 멀티테넌시 P3b / 포토북 S2 / ⓑstage1b·Bull attempts·BQ-03·히스토리 정화 force-push

**오너 결정 대기**: 동화책 caseBind·cover VALIDATE 경고·G-6 백필·branch protection·폰트 시딩(0건!)·D6 착수 시점

## 3. 양사 세션 채널 가이드 (연속 작업용)

- **bookmoa**: `bookmoa-mobile-65` (bypass 모드, 즉시 양방향). 원장 트랙 R-149 완료·D5 접수 기록됨. cutover 완료 재통지 1건만 남음
- **printy**: `20260827 Printy 개발 계속` (오너가 bypass 전환 후 정상 소통). D5 동의+전수 감사 접수됨. cutover 완료 재통지 1건만 남음
- ⚠️ **세션 이름은 재시작 시 바뀔 수 있다** — `ListAgents` 로 재확인(printy=`~/Developer/claude/printy`, bookmoa=`~/Developer/claude/bookmoa-mobile` cwd 로 식별)
- ⚠️ **크로스세션 권한모드 함정**(메모리 `reference-cross-session-permission-mode`): 수신 세션이 bypass 가 아니면 피어 메시지가 승인 보류로 지연. 발신 성공(msg_id)≠도달. **중요 통지는 레포 문서(공지문·정본) 병행이 정본 경로**, 무응답이면 오너에게 모드 확인 요청
- 파트너 소통의 레포 정본: `docs/partner-notices/`(회신문·공지문 전부), `docs/PLATFORM_INTEGRATION_GUIDE.md`(§3.4·5.1·2.2 갱신됨), `docs/CONTRACT_FREEZE.md`

## 4. 새 세션 시작 체크리스트 (순서 고정)

1. `CLAUDE.local.md` 먼저(호스트·레시피·§5.5 Cloudflare — 값 출력 금지)
2. 이 문서 + `git log --oneline -10` + `git status -sb`(타 세션 미커밋 보존)
3. SSH 필요 시 `ssh-add -l`, `deploy@` 대상만(fail2ban)
4. 함정 상기: vite.config.js shadow / 빌드게이트 5함정(배포는 번들 문자열·컨테이너 dist 실증) / fabric styles·loadJSON / SPREAD≠표지 / isInitializedRef 저장 입구 금지 / **debounce 는 배칭 도구 아님**(반복>창이면 매회 만료 — 구간 게이트 사용) / **supertest 포트 패밀리**(불가능한 응답=남의 서버 의심) / canvas-core 는 Node 22/24 / 크로스세션 권한모드
5. 검증 기준선 = §0 표. 실기·프로덕션 키 작업은 권한무시 모드
6. 세션 종료 시 RESUME_PROMPT_<날짜>.md 갱신 없이 종료 금지
