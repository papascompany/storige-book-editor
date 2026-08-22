# RESUME PROMPT — 2026-08-22

> **이 문서가 최신 날짜 정본이다.** 직전 스프린트 상세는 `RESUME_PROMPT_2026-08-18.md`(동화책 결함 2트랙+8/21 라이브 재검증), 그 이전은 8/14·8/13 참조.

## 0. 현재 라이브 상태 (2026-08-22 기준)

- **master = origin/master = baaa795**, 워킹트리 클린(예외: 8/14 RESUME 문서 M — 타 세션 산출물 보존, `.tmp-verify-combos/` untracked 무시)
- 배포: editor/admin=Vercel master push 자동(단 **docs-only 커밋은 ignoreCommand로 Canceled 표시됨 — 정상**), API/워커=VPS 수동(`CLAUDE.local.md` §6). 프로덕션 editor alias=746d182 빌드 실측 확인(8/21)
- 최근 라이브 커밋: `746d182`(+페이지 추가 즉시표시) ← `ab4b794`(왕복 R1~R7) ← `c5c9525`(동화책 4결함) ← `f8d0684`(시드 n장·교체 풀·G9)
- 검증 기준선: editor vitest 57파일/700 전부 PASS·tsc 0err. canvas-core 기존 실패 6파일/8건(canvas.node ABI NODE_MODULE_VERSION 불일치 등)+lint no-undef 11+4건은 **베이스라인**(이번 트랙 무관, 별도 정리 후보)

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
1. 동화책 왕복 실기: **새 세션으로** 편집완료(PDF 생성)→보관함 이어서편집→16p 추가→재진입 페이지 유지·배지·배너 확인. 기존 세션 7032398026281은 8p 절단본으로 영구(복구 불가). content PDF VALIDATE가 이제 426×216으로 통과하는지 워커 로그 확인(R7 검증)
2. bookmoa 장바구니 #1 "그림책·동화책 하드커버(A4)" 테스트 항목 삭제(8/21 검증 부산물)

**P1 — 코드 후속**
3. R5 판별 정밀화: 완료 시 metadata에 editorOutputContentFileId 기록→차단을 그 값 일치로 좁힘 + 배지/resolveUnderlaySource 판별식 유틸 일원화(리뷰 minor 잔존)
4. 서버측 세션 버전 이력 부재(edit_session_versions/edit_histories 프로덕션 0행) — 절단·덮어쓰기 복구 불가의 구조 원인. 경량 버전 스냅샷 설계 후보
5. 재진입 로드 30s+ (내지 9캔버스 시드) 성능 프로파일
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
5. 검증 기준선: editor 700 PASS·canvas-core 베이스라인 실패 6파일은 기존 것(§0)
