# RESUME PROMPT — 2026-08-24

> ⚠️ **최신 정본은 `RESUME_PROMPT_2026-08-25.md` 다.** 이 문서의 §0 검증 기준선(canvas-core 실패 6파일·lint no-undef 베이스라인)은 8/25 세션에서 **오진으로 확정돼 폐기**됐다 — 08-25 §0 표를 쓸 것.

> **직전 스프린트 정본.** 직전 스프린트 상세는 `RESUME_PROMPT_2026-08-22.md`(P1-3/4/5 + P1-4 복원 UI 트랙 §1-A~E), 그 이전은 8/18·8/14 참조.

## 0. 현재 라이브 상태 (2026-08-24 세션 종료 기준)

- **master = origin/master = 55c4d1e**, 워킹트리 클린(`.tmp-verify-combos/`·docs/SHOPIFY_* 등 untracked 는 타 세션 산출물 — 무접촉, 커밋 시 항상 명시 add)
- 배포: editor/admin=Vercel master push 자동(docs-only 는 ignoreCommand Canceled=정상), API/워커=VPS 수동(`CLAUDE.local.md` §6, api recreate 시 **nginx 재시작 필수**)
- 검증 기준선: editor vitest 62파일/**735 PASS**·tsc 0err / api jest 75파일/**1038 PASS**(`partner-api-keys.v1.spec` 은 전체 병렬 실행 시 26s 타임아웃 **플레이크** — 단독 PASS) / canvas-core 기존 실패 6파일(ABI NODE_MODULE_VERSION)+lint no-undef 11+4건은 **베이스라인**(회귀 아님)
- 라이브 커밋 계보(전부 배포·실증): `0809064`(목록 테넌트 격리, VPS) ← `e119b10`(:id 테넌트 격리, VPS) ← `157ff6d`(SPREAD 분류=이동 라벨 버그) ← `a40ad66`(375px 헤더) ← `cca2d5d`(팝오버 z) ← `489ade6`(replace 게이팅 정합) ← `1030444`(P1-4 API 후속 3건, VPS) ← `c03b2c2`(P1-4 복원 UI) ← `c704e77`(P1-5 RAF) ← `a4887f1`(P1-4 API) ← `4733b3e`(P1-3 R5 정밀화)

## 1. 8/22~24 세션 완료 요약 (상세 = RESUME_PROMPT_2026-08-22.md §1-A~E)

1. **P1-4 세션 버전 이력 트랙 완전 종결**: 서버 스냅샷 API(a4887f1) → 복원 UI(c03b2c2: 변경 이력 팝오버+여기로 복원, 복원=in-place 재초기화 reinitNonce, 재초기화 중 saveToServer 거부=EDITOR_BUSY) → API 후속 3건(1030444: restore PDF_ATTACHED_EXCLUSIVE·versions siteId·restore 스냅샷 dedup) → **실기 왕복 PASS**(절단 9→5 재현→복원 2.2s→dedup 실증, 권한무시 모드 크롬 top-level /embed) → 실기 발견 2건 수정(팝오버 z-[150]·375px 헤더)
2. **테넌트 격리 전면 확장**(오너 결정): `assertTenantScope`/`isInTenantScope` 공용 — `:id` 계열(findOne/PATCH/complete/DELETE)=교차 site **404**(소유 판정보다 먼저·존재 은닉), 목록(`GET /edit-sessions` 전 분기·`/my` 기본/summary)=**조용한 제외**+`[tenant-scope]` warn. 라이브 교차 테넌트 프로브 전 라우트 PASS. **트레이드오프 수용**: 같은 회사 다중 site(bookmoa PHP↔mobile) 세션 공유 불가, 레거시 NULL siteId 통과
3. **"다른 영역으로 이동" 라벨 버그**(157ff6d): 펼침면 내지도 templateType=SPREAD → buildPageMeta 가 전부 표지로 분류하던 결함. 첫 SPREAD 만 표지(hasCoverSlot 고려), 이후는 `펼침면 n`. → 메모리 `reference-spread-inner-pagemeta-trap`
4. **파트너 문서**: PLATFORM_INTEGRATION_GUIDE(7351c51: §3.2 EDITOR_BUSY·§1.5 세션 API 테넌트 격리·§3.6 체크리스트 2항) + `docs/partner-notices/` 회신문 4종(d5de86d: 임베드형 bookmoa-mobile/ShareSnap=조치 안내, 워커형 100p/MD2Books=무영향 통지)
5. 함정 기록: 서브에이전트 diff 는 JSON 경유 시 손상 → **worktree 에서 직접 `git diff`** / 자동모드 분류기는 프로덕션 키 사용을 차단(실기·시크릿 작업은 권한무시 모드) / restore 하네스는 init 을 건너뛰므로 currentSession 의존 분기는 단위 테스트 불가

## 2. 잔여 작업 (우선순위)

**P0 — 오너 액션(코드 아님)**
1. **파트너 회신문 4종 발송** — `docs/partner-notices/PARTNER_NOTICE_*_2026-08-24.md` 를 각 사 보안 채널로(키 회전 때와 동일 경로)
2. 동화책 왕복 실기(8/22 이월): **새 세션으로** 편집완료(PDF 생성)→보관함 이어서편집→16p 추가→재진입 유지 확인 + content PDF VALIDATE 426×216 워커 로그(R7) + 복원 UI 실주문 iframe 1회 눈확인
3. bookmoa 장바구니 #1 "그림책·동화책 하드커버(A4)" 테스트 항목 삭제(8/21 부산물)

**P1 — 코드 후속(다음 세션 착수 순서)**
4. 부수효과 관찰 2건: photoPlacement dpi 72→150 경고 강화 / px 상품 추가페이지 pxToMm 분기 첫 활성 관찰
5. 재진입 시드 성능: addInnerPage ≈390ms/장(9캔버스≈3.5s) — 템플릿 로드·스크린샷 debounce 최적화 검토(계측은 `window.__storigeLoadProfile` 상시)
6. lint no-undef 베이스라인(editor 4·canvas-core 11) + canvas-core 테스트 ABI 실패 6파일 정리
7. (관찰) 재진입 직후 "마지막 자동저장: 없음" 표기(lastSavedAt 세션 내 한정 — 기존 동작, UX 판단)

**P2 — 기존 백로그(트랙별 정본 참조)**
8. 업계표준 R6·R10·R3b(RESUME 08-11) / R5 다크 ON=오너게이트
9. 파일 보존 P1(고아정리·per-product)·P2(스트리밍 검증) — 고아 파일 6건 실증분 존재
10. 멀티테넌시 P3b(SITE_ADMIN @Roles·TenantGuard·테넌트 스위처, 설계 06-17)
11. 포토북 S2 삭제모달 설계결정 / 사진인화 POD MVP(설계 06-17, 오너 게이트)
12. ⓑstage1b 프론트 쿠키 전환·Bull attempts·BQ-03·ⓒ게이트B 히스토리 정화 force-push(오너)

**오너 결정 대기**: 동화책 caseBind 미설정(D-4 상이)·cover VALIDATE 경고(SPINE_PARAMS_UNRESOLVED·base14 폰트)·G-6 백필·branch protection·R2 프로비저닝·폰트 시딩(0건!)

## 3. 새 세션 시작 체크리스트 (순서 고정)

1. `CLAUDE.local.md` 먼저(호스트·레시피 — 값 출력 금지)
2. 이 문서 + `git log --oneline -10` + `git status -sb` (타 세션 미커밋 보존, **`git add` 는 항상 명시 목록**·`-a`/`-A` 금지)
3. SSH 필요 시 `ssh-add -l` 확인, `deploy@` 대상만(fail2ban)
4. 함정 상기: vite.config.js shadow / 빌드게이트 5함정(배포는 state·번들 문자열·컨테이너 dist 로 실증) / fabric styles·loadJSON 치수 오염 / SPREAD=표지 아님(buildPageMeta hasCoverSlot) / isInitializedRef 창에 저장 입구 금지 / API 재배포 시 nginx 재시작 / 실기·프로덕션 키 작업은 권한무시 모드
5. 검증 기준선: editor 735·api 1038 PASS(§0), canvas-core 6파일·partner-api-keys 플레이크는 기존
