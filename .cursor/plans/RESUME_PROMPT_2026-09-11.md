# RESUME PROMPT — 2026-09-11

> **이 문서가 최신 날짜 정본이다.** 8/25~8/28 상세 이력(④~⑮)은 `RESUME_PROMPT_2026-08-25.md`, 8/28 세션 종료 상태는 `RESUME_PROMPT_2026-08-28.md`(이력 아카이브) 참조.

## 0. 현재 라이브 상태 (2026-09-11 기준)

- **master = origin/master = `9e085c4`**, VPS `~/storige` = 동일 커밋. 워킹트리 클린
  (untracked `.tmp-verify-combos/`·`docs/SHOPIFY_*`·`docs/SITE_CATALOG_*`·`docs/PLATFORM_INTEGRATION_GUIDE.backup-2026-07-09.md` 는 타 세션 산출물 — 무접촉, `git add` 항상 명시 목록)
- 배포: editor/admin=Vercel master push 자동 / API·워커=VPS 수동(`CLAUDE.local.md` §6)

### 🚨 nginx 배포 함정 (2026-09-11 실사고 — 08-28 정본의 절차가 틀렸다)

`docker-compose.yml` 은 `nginx.conf` 를 **파일 bind-mount** 한다. `git pull` 은 파일을 **새 inode 로 교체**하므로
컨테이너는 계속 구 inode 를 본다. **`up -d`·`restart`·`nginx -s reload` 모두 무효**였다(로그는 정상처럼 보인다).

```bash
docker compose up -d --force-recreate nginx   # ← 유일하게 유효
docker compose exec -T nginx sh -c 'nginx -T 2>/dev/null | grep -c "찾을 문자열"'  # 반드시 로드 확인
```

> 판별법: `nginx -t` 는 **디스크**를 읽어 통과해도, `nginx -T` 로 **로드된** 설정을 확인해야 한다.
> 08-28 정본의 "볼륨 변경 시 restart 아닌 up -d" 는 *볼륨 추가* 한정이며, *파일 내용 변경* 에는 recreate 가 답이다.

### 검증 기준선 (이보다 낮으면 회귀 — 2026-09-10 재실측)

| 대상 | 기준 | 재실측 |
|---|---|---|
| api jest | **78스위트/1071 PASS** · contract-freeze 73 · lint 0err(44 warn) | ✅ 3회 연속 동일 |
| editor vitest | **66파일/785 PASS** · tsc 0err · eslint 0err(78 warn) | ✅ 2회 연속 동일 |
| canvas-core | 54파일/623 PASS · lint 0err(48 warn) | ⚠️ **테스트 미실측** (아래 함정) |
| 플레이크 | **등재 0종** | ✅ 3연속 전체실행 재현 0건 |

> ⚠️ **런타임 함정**: 이 맥의 `/opt/homebrew/opt/node@24` 심볼릭 링크는 **Node 26 을 가리킨다**.
> canvas-core 는 반드시 `PATH="/opt/homebrew/opt/node@22/bin:$PATH"` 고정 후 `node -v`(v22.22.2) 확인하고 실행.
> 08-28 정본의 "Node 22/24 전용" 표기는 이 머신에서 사실상 **22 전용**이다.

## 1. ✅ D5 cutover 완료 (2026-09-11, 예정 9/4 대비 7일 지연 실행)

`4463a5f` — nginx `location /storage/outputs/` 신설(410 + `X-Storige-Notice` + `no-store`) + 문서 4곳 동기화.

실증(2026-09-11 라이브): 레거시 무인증 **410**(실제 산출물·없는 파일 동일) / 유효 서명 **200** / 변조 403 /
만료 410 / `/storage/uploads/`·`/storage/designs/` 404(무변경) / api·editor·admin 200.
사전 검증으로 `OUTPUT_SIGN_SECRET`(.env) ↔ `secure-link-secret.conf` **지문 일치** 확인 후 실행했다.

> 실행 전 프로브에서 **실제 산출물이 무인증 200 으로 받아졌다**(없는 파일명 프로브는 404 라 미노출로 오인하기 쉽다 — 판별에 실제 파일을 써라).

## 2. 🔴 이번 세션 최우선 — 미발신 통지 2건

**문서는 작성·커밋됐고 채널 발신만 남았다.** 08-28 정본 §3 이 "중요 통지는 레포 문서 병행이 정본 경로" 로 규정한 그 문서다.

1. `docs/partner-notices/PARTNER_NOTICE_OUTPUT_CUTOVER_DONE_2026-09-11.md` → **printy·bookmoa 양사**
   - 지연 사실(9/4→9/11) 명시본. 양사에 구 URL 410 **교차 실측 1회** 요청 포함(printy 가 8/28 예약해 둔 항목)
2. `docs/partner-notices/PARTNER_NOTICE_BOOKMOA_JOB_OUTPUT_401_2026-09-11.md` → **bookmoa 단독** (D5 무관 별건)
   - bookmoa `api/storige/files/proxy-download.js:100` 이 `/worker-jobs/:id/output` 을 `X-API-Key` 로 호출
   - 이 라우트는 전역 `JwtAuthGuard`(`apps/api/src/auth/auth.module.ts:48`) 아래 `@Public`·`ApiKeyGuard` **둘 다 없음**(`worker-jobs.controller.ts:623`) → 유효 사이트 키로도 **401**. 라이브 실측 401 확인
   - 가이드 §3.4 가 2026-08-13 실측으로 이미 명시하던 사실. 8/28 원장 R-149 의 "코드 변경 불요" 는 라우팅 감사 근거였고 라이브 실측 미수행. printy 는 같은 지점을 8/28 에 실호출로 적발해 서명 URL 로 전환함
   - **고객 합성 PDF 다운로드가 이미 파손 상태일 개연성** — bookmoa 측 실측 1회로 baseline 확정 요청

## 3. 잔여 작업

**P0 — 오너 액션**
1. 위 §2 통지 2건 발신
2. 파트너 회신문 **미발송 5건**: ⓐ 8/24 통지 4종 + ⓑ 프린티 템플릿셋 스코프
   (~~ⓒ new.bookmoa.com~~ = 발송 완료·파트너 회신 수신 08-27·트랙 종결 / ~~ⓓ 프린티 업로드 테넌시~~ = 세션 채널 전달 완료 08-28, 보안 채널 공식 발송만 잔여 — **08-28 정본 §2 의 "4종" 은 과대 계상이었다**)
3. 동화책 왕복 실기 1회로 묶음 해소: 재진입 유지 확인 + `window.__storigeLoadProfile.laps` 의 `grow:*` 캡처(읽기 전용) + bookmoa 장바구니 #1 테스트 항목 삭제

**P1 — 코드**
4. **canvas-core 기준선 마감**: `PATH="/opt/homebrew/opt/node@22/bin:$PATH" pnpm --filter @storige/canvas-core test` (기대 54파일/623). 이 축은 과거 "커버리지 72건 조용히 증발" 전력이 있어 수집 수까지 대조할 것
5. **P1-5 잔여 1파일**: `apps/api/storage/test/*.ts` 가 여전히 린트·타입체크 밖(`generate-fixtures.ts` 는 지금 린트하면 파싱 에러). `tsconfig.eslint.json` include + `package.json` lint 글롭에 `storage/test` 추가. 08-28 정본의 "✅ 완료" 는 **부분 완료**였다
6. **`.env.example` 에 `OUTPUT_*` 3키 등재**(값 없이): `OUTPUT_SIGN_SECRET`(= `secure-link-secret.conf` 와 동일값 필수)·`OUTPUT_URL_TTL_SEC=300`·`OUTPUT_URL_NULL_JOB_SITE_ALLOWLIST`. 현재 0건이라 신규 환경은 발급 API 전건 503
7. **CONTRACT_FREEZE 에 S3 A안 등재**: `POST /files/multipart/complete`·`POST /files/:id/complete` 의 shop-session Bearer 옵션 스탬프(c050729, 배포·라이브 실증 완료)가 계약 문서에 없다(파일 전체 `Bearer` 0건). 등재 없으면 다음 작업자가 `firstFinalize` 게이트를 불필요한 복잡도로 오인해 제거 → **소급 하이재킹 벡터 재개방**. §4.3 의 "오너 결정 대기" 도 스테일(D1·D3·D4 는 8/28 승인됨)
8. FontPlugin A-1(동일 CSS 재기입 스킵, `packages/canvas-core/src/plugins/FontPlugin.ts:669`) — canvas-core 소유권 배정 필요. ⚠️ 착수 게이팅을 `grow:plugins` 수치로 하면 안 된다: `createFontCSS` 가 생성자에서 await 없이 호출돼 내부 rAF+300ms 가 그 lap 에 계상되지 않는다
9. (관찰) 시드 표기 잔여 — 레거시 `/` 경로·게스트 세션 미적용, updatedAt 의미 폭
10. (P2) `apps/editor`·`apps/admin` 의 `engines.node`(24.x)가 실검증 런타임(26)과 불일치 — 매 pnpm 실행마다 Unsupported engine 경고. CI Node 버전 확인 후 정합

**D6 (cutover 관측 후 착수)**: NULL-파괴 게이트 + 이원 정책 allowlist 승격 + 백필.
⚠️ 백필 41건/NULL 225건은 **2026-08-28 실측치** — 이후 재실측 없음. 집행 전 4수치 재실행 필수.
설계안 §2-B' 단서대로 "해당 파트너의 기존 회수가 자기 키로 이뤄지는지" 관측이 **백필보다 선행**.

**P2 백로그**: bookmoa 구 프로젝트 폐기 시 allowlist 구 오리진 제거 / 업계표준 R6·R10·R3b / 파일 보존 P1·P2(D6 백필과 교차) / 멀티테넌시 P3b(`.claude/worktrees/multitenancy-p3b`, `docs/p3b-handoff` 브랜치 — 클린, origin/master 대비 154 behind) / 포토북 S2 / ⓑstage1b·Bull attempts·BQ-03·히스토리 정화 force-push

**오너 결정 대기**: 동화책 caseBind · cover VALIDATE 경고 처리 정책(`SPINE_PARAMS_UNRESOLVED` 는 현재 비차단 로그 경로) · G-6 백필 · **branch protection(master 무보호 확정 — `gh api` 404)** · 폰트 시딩(0건) · D6 착수 시점

## 4. 문서 정합성 — 08-28 정본 대비 정정된 것

| 항목 | 08-28 정본 | 실제 |
|---|---|---|
| D5 | "9/4 실행만 남음" | **9/11 실행 완료**(7일 지연) |
| HEAD | `990b418` | 자기 자신 커밋 미반영 — 당시 실제는 `39b787c` |
| P0-1 미발송 | 4종 | **5건**(ⓐ4+ⓑ1), ⓒ·ⓓ 는 종결/부분종결 |
| P1-5 lint | ✅ 완료 | **부분 완료**(`storage/test` 잔여 1파일) |
| nginx 배포 | `up -d nginx` | **`up -d --force-recreate nginx`**(파일 bind-mount inode) |
| canvas-core 런타임 | "Node 22/24" | 이 맥에서 **22 전용**(node@24 링크가 26) |
| 채널 | `bookmoa-mobile-65` / `20260827 Printy 개발 계속` | 이름 이동 — **`ListAgents` 로 매번 재확인**(cwd 로 식별) |

또한 설계안 `TENANCY_S3_S4_DESIGN_2026-08-28.md` 는 두 곳이 실제 구현과 어긋난 채 남아 있다(정정 안 함, RESUME 쪽이 정본):
`:60` "`/storage/outputs/` 를 분리해 secure_link" → 실제는 **별도 프리픽스 `/storage-signed/outputs/` 신설** / `:72` 라우트명 → 실제는 `external/:id/output-url`.

## 5. 양사 세션 채널 가이드

- **bookmoa**: cwd `~/Developer/claude/bookmoa-mobile` / **printy**: cwd `~/Developer/claude/printy`
- ⚠️ **세션 이름은 재시작 시 바뀐다** — `ListAgents` 로 cwd 기준 재식별. 2026-09-11 시점엔 `bookmoa-mobile-2f`·`printy-bf` 가 interactive 였다
- ⚠️ **크로스세션 권한모드 함정**: 수신 세션이 bypass 가 아니면 피어 메시지가 승인 보류로 지연. **발신 성공(msg_id) ≠ 도달.** 무응답이면 오너에게 모드 확인 요청
- 레포 정본: `docs/partner-notices/` · `docs/PLATFORM_INTEGRATION_GUIDE.md` · `docs/CONTRACT_FREEZE.md`
- 8/28~9/11 파트너 측 변화 **0건**(양 레포 storige 연동 파일 무변경, 문의·불만 0건)

## 6. 새 세션 시작 체크리스트 (순서 고정)

1. `CLAUDE.local.md` 먼저(호스트·레시피·§5.5 Cloudflare — 값 출력 금지)
2. 이 문서 + `git log --oneline -10` + `git status -sb`(타 세션 미커밋 보존)
3. SSH 필요 시 `ssh-add -l` → 없으면 `ssh-add ~/.ssh/id_ed25519`. `deploy@` 대상만(fail2ban)
4. 함정 상기: **nginx 파일 bind-mount inode(§0)** / **node@24→Node26(§0)** / vite.config.js shadow / 빌드게이트 5함정 / fabric styles·loadJSON / SPREAD≠표지 / isInitializedRef 저장 입구 금지 / **debounce 는 배칭 도구 아님** / **supertest 포트 패밀리**(불가능한 응답=남의 서버 의심) / 크로스세션 권한모드
5. 검증 기준선 = §0 표. 실기·프로덕션 키 작업은 권한무시 모드
6. 세션 종료 시 `RESUME_PROMPT_<날짜>.md` 갱신 없이 종료 금지
