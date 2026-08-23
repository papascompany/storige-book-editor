# RESUME PROMPT — 2026-08-22

> **이 문서가 최신 날짜 정본이다.** 직전 스프린트 상세는 `RESUME_PROMPT_2026-08-18.md`(동화책 결함 2트랙+8/21 라이브 재검증), 그 이전은 8/14·8/13 참조.

## 0. 현재 라이브 상태 (2026-08-22 세션 종료 기준)

- **master = origin/master = 1030444+**(API 후속 3건 §1-C, VPS LIVE) ← c48af14 ← c03b2c2(P1-4 복원 UI, §1-B), 워킹트리 클린(`.tmp-verify-combos/`·docs/*.html untracked 무시). ⚠️ 8/14 RESUME 문서의 타 세션 미커밋 수정분(+35줄 docs-only)이 `git commit -am` 실수로 **5ed8082 에 함께 커밋·push 됨** — 내용 손실 없음(master 보존), 이력 재작성 안 함
- **이번 세션 LIVE**: API `1030444`(versions 후속 3건, VPS 재빌드+nginx 재시작, dist 실증)·editor `c03b2c2`(P1-4 복원 UI, Vercel izpr4d777 번들 실증)·`4733b3e`(R5 정밀화)·`c8aeac3`/`5ed8082`(로드 프로파일러)·`c704e77`(RAF 무한대기 수정) = Vercel 자동배포·번들 실증 / API `a4887f1`(P1-4 버전 스냅샷) = 마이그레이션 `20260822_add_file_edit_session_versions.sql` 적용 후 VPS 재빌드+nginx 재시작, health 200·신규 라우트 fail-closed 확인
- 배포: editor/admin=Vercel master push 자동(단 **docs-only 커밋은 ignoreCommand로 Canceled 표시됨 — 정상**), API/워커=VPS 수동(`CLAUDE.local.md` §6). 프로덕션 editor alias=746d182 빌드 실측 확인(8/21)
- 최근 라이브 커밋: `746d182`(+페이지 추가 즉시표시) ← `ab4b794`(왕복 R1~R7) ← `c5c9525`(동화책 4결함) ← `f8d0684`(시드 n장·교체 풀·G9)
- 검증 기준선: editor vitest 61파일/**731** 전부 PASS·tsc 0err. canvas-core 기존 실패 6파일/8건(canvas.node ABI NODE_MODULE_VERSION 불일치 등)+lint no-undef 11+4건은 **베이스라인**(이번 트랙 무관, 별도 정리 후보)

## 1-C. 8/23 — P1-4 API 후속 3건 `1030444` **VPS LIVE** + 편집기 게이팅 정합

- worktree 격리 3샤드 병렬 구현 → 샤드별 적대 검토 GO → master 통합(hunk 충돌 0). ⓐ `restoreVersion` 에 update() 와 동일한 **PDF_ATTACHED_EXCLUSIVE** 가드(contentPdfFileId && mode!=='underlay' → 400, 스냅샷·save 이전) ⓑ `assertOwnerOrStaff`(versions 3라우트): 비-staff 는 JWT siteId ≠ 세션 siteId 면 **404 SESSION_NOT_FOUND**(존재 오라클 차단, 둘 중 하나라도 없으면 통과·staff 예외). findOne/update 는 기존 기준선 유지 = 오너 결정 ⓒ `snapshotBeforeOverwrite(restore)`: 현재==복원대상(멱등 재호출) 또는 최신 스냅샷==현재 면 생략(재시도로 restore 스냅샷이 10건 캡을 밀어내던 문제). 스펙 3파일 +18
- 검증: api 1021/1022 PASS(`partner-api-keys.v1.spec` 1건은 전체 병렬 26s 타임아웃 **플레이크** — 단독·기준선 PASS)·tsc 0err. **배포 실증**: VPS `git pull`→`compose build api`→`up -d api`→`restart nginx` → health 200, `/edit-sessions/:id/versions` 무인증 401, guest 라우트 가짜 토큰 404, 컨테이너 dist 에 3지점 문자열(중복확인·PDF_ATTACHED_EXCLUSIVE×2·siteId 비교) 확인
- 편집기: 이력 패널 비노출 판정을 서버와 동일(`contentPdfFileId && (mode ?? 'replace') !== 'underlay'`)로 정합(종전 `mode==='replace'` 만 → null 모드 첨부 세션에서 패널이 떠 400 토스트)
- 잔여: ⓒ 는 최신 1건만 비교(A→B→A 복원 순서의 중복은 허용, 요구 범위 밖) / findOne·PATCH 의 siteId 격리 확장은 같은 회사 다중 site(bookmoa PHP↔mobile) 세션 공유 가능성 때문에 오너 결정

## 1-B. 8/22 야간 세션 — P1-4 복원 UI(이력 패널 + 여기로 복원) `c03b2c2` LIVE

- **UI 배치**: 별도 모달이 아니라 헤더 **기존 "변경 이력" 팝오버(HistoryPanel)** 에 임베드 세션 버전 소스(`sessionVersions` prop) 분기를 추가. 목록(최신순·사유 배지 `자동 저장`/`페이지 감소 직전`(경고톤)/`복원 직전`·장 수·"9장 → 이후 5장으로 줄어듦")·확인 단계→**여기로 복원**·로딩/빈/오류·서버 저장 중 비활성. 레거시 분기(/editor/sessions + persist `useEditorStore.sessionId`)는 임베드에서 `legacySessionVersions={false}` 로 **항상 차단**(타 세션 이력 노출·iframe 리로드 복원 방지). 모바일(<sm)은 워드마크를 숨기고 패널 노출(bookmoa-mobile 고객 진입점)
- **복원 = in-place 재초기화(설계 결정)**: 라이브 캔버스에 canvasData 를 직접 재하이드레이션하지 않고, 복원 응답 세션을 `reinitSessionRef` 로 주입한 뒤 메인 init effect 를 `reinitNonce` 로 재실행(cleanup=dispose+reset → 재진입과 100% 동일 경로: R2 시드·복원 루프·R3 가이드·앉히기·undo 스택 초기화). 게스트는 GET :id 403·orderSeqno 폴백 재생성 위험이 있어 세션 재조회/재생성을 건너뛴다. `editor.ready` 재발신·Sentry load-profile 억제, 캔버스 수 변경 시 `pricingChange` 1회, backGuard sentinel 은 최초 ready 이후 고정
- **핸들러 순서(데이터 유실 방지)**: dirty→`saveNow` 플러시(실패 시 중단) → `status==='saving'` 거부 → `isInitializedRef=false`+debounce 취소 → 서버 restore(회원 `POST :id/versions/:vid/restore` / 게스트 `?guestToken=` — CORS allowedHeaders 에 커스텀 헤더 없음) → `markClean`·`markServerSynced(복원 길이)` → 재초기화 완료(ready)까지 await(토스트 시점 정합). **로컬 백업은 보존**(서버 미반영 유일본일 수 있음; 다음 재진입 배너는 updatedAt 비교가 자연 억제). 네트워크/5xx 실패는 "서버에는 적용됐을 수 있음 — 새로고침" 안내
- **적대 리뷰(55 에이전트, 확정 25) 반영 핵심**: `useEmbedAutoSave.saveToServer` 가 `initializedRef=false` 창(재초기화 중)에 **PATCH 거부** — 호스트 역명령 `saveNow` 가 null/부분 배열로 복원본을 되덮는 경로 차단(major). 호스트 `editor.saved` 는 `ok:false, error:'EDITOR_BUSY'` 로 정직 응답. restore POST 는 `__noRetry`(비멱등, 5xx 재시도 시 restore 스냅샷이 10건 캡을 밀어냄). 복원 핸들러 identity 는 ref 기반(자동저장마다 목록 재요청 방지)
- 검증: editor vitest **731 PASS**(+20: 헬퍼 5·패널 7·embed 배선 7·saveToServer 가드 1)·tsc 0err·lint 0err(경고 기존)·로컬 prod build OK. **배포 실증**: Vercel `izpr4d777` Ready → 프로덕션 alias 청크에서 `여기로 복원`(searchParams 청크)·`REINITIALIZING`/`EDITOR_BUSY`(EmbedView 청크)·`listGuestVersions` 문자열 확인
- **미해소(후속)**: ⓐ API `restoreVersion` 이 `PDF_ATTACHED_EXCLUSIVE`(replace 모드) 가드를 거치지 않음 — UI 만 비노출 ⓑ `assertOwnerOrStaff` siteId 미비교(findOne/update 와 동일 기준선) ⓒ 서버 동일 (session,version) 연속 restore 스냅샷 dedup 없음 ⓓ 게스트 분기·replace 비노출·pricingChange 1회는 하네스 한계(currentSession 은 init 에서만 세팅)로 **코드 정독 근거**, 테스트 없음 ⓔ 재초기화 실패 시 "다시 시도"(reload)는 orderSeqno 폴백 게스트 세션에서 같은 세션에 못 돌아감(기존 동작) ⓕ **실세션 UI 왕복 실기 미확인** — 자동모드 분류기가 ShareSnap 키 기반 shop-session 토큰 발급을 차단(권한무시 모드 또는 오너 실기 필요). 실기 레시피: 세션 생성 → 편집·자동저장 2회(≥60s 간격) 또는 PATCH 로 canvasData 축소(shrink 스냅샷 즉시) → 헤더 🕘 변경 이력 → 시점 행 [복원] → [여기로 복원] → 로딩 후 캔버스 수 복귀·`복원 직전` 행 추가 확인. 모바일 360/375px 헤더 폭도 실기 스크린샷 1회 권장(워드마크 숨김으로 폭 상쇄, 미실측)

## 1-A. 이번 세션 완료 (8/22) — §3 P1-3·P1-4·P1-5 전부 LIVE

- **P1-3 R5 정밀화 `4733b3e`**: 완료 시 `metadata.editorOutputContentFileId` 기록(spread 2경로+단일 content). `isEditorOutputContentFile(session)` 단일 판별식(contentPdfGuide) — 마커 있으면 값 일치로만 차단(정당한 재첨부는 배지 복귀), 없으면 레거시(spreadContentPageCount/status) 유지. 배지·resolveUnderlaySource 공용. editor 707 PASS
- **P1-4 서버 버전 스냅샷 `a4887f1`**: 구조 원인 확정 — 버전 테이블은 레거시 `edit_sessions`에만 있고 프로덕션 `/embed` 모델 `file_edit_sessions.update()`는 canvasData 그대로 덮어씀. 신규 `file_edit_session_versions`: update() 에서 **이전 값** 보존(autosave 60s debounce / page_count 감소=shrink 즉시 / 동일 내용 스킵 / 세션당 10건·shrink 5건 보호 / 실패해도 저장 무중단). 라우트 `GET|POST /edit-sessions/:id/versions[/:vid][/restore]`(소유자·staff) + `guest/:id/versions[/:vid/restore]`(게스트 토큰 fail-closed 공용 헬퍼 `assertGuestOwnership`). restore 직전 상태는 reason=restore 보존. api 1004 PASS. **라이브 E2E**: 9→5 절단 PATCH→shrink 스냅샷 자동→restore→9장 복귀+restore 스냅샷 확인. UI(이력 패널/복원 버튼)는 미구현 — API 만
- **P1-5 재진입 성능 `c8aeac3`+`5ed8082`+`c704e77`**: `utils/loadProfiler` 단계 계측(ready 시 1회 콘솔+Sentry info, `window.__storigeLoadProfile` 노출 — 프로덕션 console pure-제거). **실측으로 원인 특정**: `useEditorContents` 시드 종료 뷰포트 재정렬(c5c9525 ④)이 `requestAnimationFrame` 만 대기 → 숨김 탭/오프스크린 cross-origin iframe 에서 RAF 정지 → **'콘텐츠를 불러오는 중' 무한 정지**(2분+ 재현). rAF∥setTimeout(200) race 로 수정(FontPlugin.loadFont·RenderOptimizer.waitForFontRendering 동일). 수정 후 숨김 탭 재진입 **4.0s**(시드 3.5s=9캔버스 ≈390ms/장, 복원 9p 148ms, 나머지 <0.4s). 잔여 최적화 대상은 addInnerPage 시드뿐
- 실측 방법(재사용): ShareSnap dev 키로 shop-session 토큰을 로컬 헬퍼 서버에서 발급→`/embed?...&token=` 302. 프로브 세션(order 990822)은 softDelete 정리. 관찰: 텍스트 패널 "다른 영역으로 이동" 목록이 내지 펼침면도 전부 "표지(펼침면)" 로 표기됨(라벨 버그 후보, 미수정)

## 1. 직전 완료 — 동화책 하드커버 세트 결함 트랙 (8/18~21, 전부 LIVE)

8/14 admin 등록 빈 무지 템플릿(동화책 14세트)이 드러낸 편집기 미방어 경로 일괄 수정. 데이터는 무결로 판정.

- **1차 c5c9525**: ① addPage/addInnerPage unitOptions 미주입→업로드 TypeError(가드+주입+fabric.d.ts optional) ② WorkspacePlugin.reset() 이중 workspace→표지 과확대(잔존 제거) ③ 모양컷 canvas.clear() 파괴→book/스프레드 3중 가드+메뉴 숨김(판별=spread 템플릿 존재, length>0 금지·hasCoverSlot 금지·enabledMenus 화이트리스트 우회) ④ 시드 썸네일 치수+뷰포트 재정렬
- **2차 ab4b794+746d182 (왕복 R1~R7)**: R1 initWorkspace stale closure(embed deps=[] null 캡처)→getState() 경화 — 표지 105×105 정사각의 진짜 원인. R2 재진입 캔버스수(16)를 물리페이지로 오전달→반감→절단→자동저장이 서버 영구 덮어씀(restoredInnerCanvasCount 분리·복원 루프 증설·다운그레이드 표면화·상한 200). R3 복원 후 restoreGuideElements. R4 편집완료 markClean+백업삭제+markServerSynced, restoreFromLocal 교정, 무편집 백업 억제, 시그니처 동일 offer 억제. R5 편집완료 산출물 contentFileId 첨부 오인 배지/underlay 재승격 차단(마커=metadata.spreadContentPageCount, W1 계약 무접촉). R6 글리프 검증 시스템객체 제외. R7 computeInnerContentSizeMm 게이트=innerSpec 존재(표지 패널 247.4×276 폴백 SIZE_MISMATCH 근본수정). +α addPage 직후 첫 표시 치수 동기
- **8/21 라이브 재검증(크롬 직접 제어, 실주문 경로)**: 셀프편집 진입→새 세션→표지 496×276 정상·모양컷 부재·재진입 복원 정상·복원배너 미노출·+추가 즉시표시·텍스트 추가 에러 0. 제약: cross-origin iframe 내부 클릭 불가 → **편집완료 PDF 생성·16p 추가 왕복은 실기 미확인**(코드+테스트 근거만)

## 2. 누적 개발 현황 요약 (편집기+워커, 상세는 각 날짜 RESUME/메모리)

**편집기(editor/canvas-core)**: /embed 정본화(sessionId 재편집+dual-emit)·POD 모듈화(초기번들 42%↓, 골든 byte-identical)·레이어 UX L1~L7·E2 로드맵 C4~C9+3트랙·사진틀 UX A/B+PNG 평탄화·컷아웃 서버 오프로드(u2net+pureContour)·판형 체계 통합(규격표 8종·프리셋·방향쌍)·spine v2 3자 정합(R-44)·포토북 TemplateSetType+펼침면 내지 개통·G8/G9 커버슬롯·시드 n장·템플릿 탭 교체 풀·W1 내지 PDF 앉히기 정본(contentPdfSeatLayout/Guide)·세션 저장/복원 왕복 정합(이번 트랙)·모양컷 book 가드

**워커/API**: PDF 검증 Tier0/1+임포지션+C+ 게이팅(G3 ON)·단일 2GB 상수메모리 완주(qpdf 머지=별색/오버프린트 무손실)·compose-mixed assembleFromSession(W3)·업계표준 R1~R5+R7~R9(ink_cov·ICC 등, R5 다크=오너게이트)·파일 보존 softDelete 48h(P0)·저장계층 R2 추상화(STORIGE_DRIVER, R2 프로비저닝 대기)·멀티테넌시 P1+P2a/b+P3a(user_site_roles CRUD)·전수감사 P0 6+P1 16+R4 7 배포·서명 3종 대조+동결 17라우트 contract test CI

**인프라/보안**: 시크릿 회전 완료(유출 구키 전량 폐기)·Redis SLAVEOF 사고 봉쇄·Node24 승격·admin httpOnly 쿠키 이원화(stage1)·소스맵 자기게이팅(SENTRY_* 등록 시 전환)·히스토리 IP 제거 force-push(옛 해시 무효 — 착수 전 ls-remote/merge-base 검증 필수)

## 3. 잔여 작업 (우선순위)

**P0 — 오너 실기 확인(다음 세션 첫 안건)**
0. **P1-4 복원 UI 실기 왕복**(§1-B ⓕ 레시피) — 헤더 🕘 변경 이력 → 시점 [복원] → [여기로 복원] → 캔버스 수 복귀·`복원 직전` 행 생성·모바일 375px 헤더 폭 확인
1. 동화책 왕복 실기: **새 세션으로** 편집완료(PDF 생성)→보관함 이어서편집→16p 추가→재진입 페이지 유지·배지·배너 확인. 기존 세션 7032398026281은 8p 절단본으로 영구(복구 불가). content PDF VALIDATE가 이제 426×216으로 통과하는지 워커 로그 확인(R7 검증)
2. bookmoa 장바구니 #1 "그림책·동화책 하드커버(A4)" 테스트 항목 삭제(8/21 검증 부산물)

**P1 — 코드 후속**
3. ~~R5 판별 정밀화~~ ✅ 8/22 LIVE(4733b3e)
4. ~~서버측 세션 버전 이력~~ ✅ API a4887f1 + 편집기 복원 UI c03b2c2(§1-B) + **API 후속 3건 1030444 VPS LIVE(§1-C)**. 후속: ⓕ 실기 왕복(오너/권한무시 모드)·admin 세션 상세의 이력 뷰·shrink 발생 시 Sentry/운영 알림·보관함 이어서편집 시 shrink 이력 있으면 배너
5. ~~재진입 30s+~~ ✅ 8/22 원인(RAF 무한대기) 수정 LIVE(c704e77), 프로파일러 상시. 후속: 오너 실기에서 `window.__storigeLoadProfile`/Sentry `[load-profile]` 확인, 시드 addInnerPage ≈390ms/장 최적화(템플릿 로드·스크린샷 debounce 검토), 텍스트 패널 영역 라벨 버그
6. 부수효과 관찰 2건: photoPlacement dpi 72→150 경고 강화 / px 상품 추가페이지 pxToMm 분기 첫 활성
7. lint no-undef 베이스라인(editor 4·canvas-core 11) + canvas-core 테스트 ABI 실패 6파일 정리

**P2 — 기존 백로그(트랙별 정본 참조)**
8. 업계표준 R6·R10·R3b (RESUME 08-11) / R5 다크 ON=오너게이트
9. 파일 보존 P1(고아정리·per-product)·P2(스트리밍 검증) — 이번 트랙에서 고아 파일 6건 실증(7032398026281 편집완료 3회분)
10. 멀티테넌시 P3b(SITE_ADMIN @Roles·TenantGuard·테넌트 스위처, 설계 06-17)
11. 포토북 Phase1 잔여 S2 삭제모달 설계결정 / 사진인화 POD MVP(설계 06-17, 오너 게이트)
12. ⓑstage1b 프론트 쿠키 전환·Bull attempts·BQ-03·ⓒ게이트B 히스토리 정화 force-push(오너)

**오너 결정 대기**: 동화책 등록 caseBind 미설정(D-4 계약과 상이 — 화면=편집사이즈 인코딩 수용 여부)·cover VALIDATE 경고(SPINE_PARAMS_UNRESOLVED·base14 폰트) 처리·G-6 백필·branch protection·R2 프로비저닝·폰트 시딩(0건!)

## 4. 새 세션 시작 체크리스트 (순서 고정)

1. `CLAUDE.local.md` 먼저(호스트·레시피 — 값 출력 금지)
2. 이 문서 + `git log --oneline -10` + `git status -sb` (타 세션 미커밋 보존, 8/14 RESUME M은 무접촉)
3. SSH 필요 시 `ssh-add -l` 확인, `deploy@` 대상만(fail2ban)
4. 함정 상기: vite.config.js shadow / 빌드게이트 5함정(로그 초록≠적용, 배포는 state·번들 문자열로 실증) / fabric styles·loadJSON 치수 오염 / iOS ResizeObserver 3중 가드 완화 금지 / canvas-core 테스트 하네스 함정 / API 재배포 시 nginx 재시작
5. 검증 기준선: editor **711** PASS(58파일)·api **1004** PASS(70)·canvas-core 베이스라인 실패 6파일은 기존 것(§0)
6. P1-4 API 변경은 **마이그레이션 선행**(적용 완료) — 롤백 시 `DROP TABLE file_edit_session_versions` + API 이전 이미지
