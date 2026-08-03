# RESUME PROMPT — 2026-07-25 (세션 정본 · 클린 핸드오프)

> **이 문서가 최신 정본이다.** 직전 체인: RESUME_PROMPT_2026-07-23(R-44 책등) → 2026-07-24(트랙C 완결 + E2 C4~C9 LIVE) → **본 세션(E2 잔여 3트랙+강화 · 최종 무결성 감사 세대가드 · lint 정리 · editor 4버그 #1·#2 — 전량 LIVE)**.
> **본 세션 요약**: origin/master `e5db534` → **`2fa7f12`** (6배포, editor.papascompany.co.kr 전량 자동배포 READY). ① E2 오너결정 대기 조작마감(C5 다중선택 복제·C6-b 삭제확인모달·D-E2-1 분배단축키)+강화 → ② 최종 무결성 감사가 발굴한 C5/v1 비동기 clone 세대경합 봉합 → ③ pre-existing lint 정리 → ④ 오너 라이브 보고 editor 4버그 진단(#1 stale·#2 dpr·#3 플립북·#4 원칙정상) 중 #1·#2 수정·배포. 라이브 크롬 검증(C6-b 삭제모달·#2 정상dpr 정합).

---

## 0. 세션 시작 프로토콜 (순서 고정)
1. `storige/CLAUDE.local.md` 먼저(SSH/Vercel/키/레시피). SSH 필요 시 `ssh-add -l` → 비면 `ssh-add ~/.ssh/id_ed25519`.
2. 본 문서(§1 완료 · §2 예정 · §3 함정 · §4 워크트리).
3. **작업 워크트리** `../storige-fix-20260713`. `git fetch && git rev-parse origin/master`(현재 **`2fa7f12`**) 확인. **신규 작업은 origin/master 기준 새 브랜치**(현 브랜치 `fix/editor-stale-chunk-and-pointer-dpr`는 이미 master 병합).
4. `git worktree list` + `git status -sb` — 타 세션 미커밋 무접촉.

---

## 1. 완료 내역 — 전량 프로덕션 LIVE (`e5db534..2fa7f12`)

editor/admin = master push 자동배포(이번 세션 6회 전부 정상 발화, Vercel MCP `get_deployment` sha 대조로 READY 확정). api/worker = 이번 세션 무접촉(diff 0).

| 커밋 | 내용 | 검증 |
|---|---|---|
| `bdef580` | **E2 잔여 3트랙+강화**: C5 다중선택 alt+드래그 복제(parity)·C6-b 컨텍스트메뉴 삭제확인모달·D-E2-1 분배단축키(alt+shift+h/v) + C5 z-order 통합테스트 강화 | 병렬 구현+적대검증 PASS · canvas-core 500 · **라이브 C6-b 모달 실증** |
| `d38e259` | **C5/v1 alt-drag clone 재진입 세대가드**(altGeneration) — 최종 무결성 감사(4렌즈 14에이전트)가 발굴한 major CONFIRMED 봉합(v1 선재 버그 동시 해소) | 뮤테이션 sentinel(⑤-f 다중·⑦-c 단일)·적대검증 PASS·502 |
| `ba1df10` | canvas-core eslint globals `Buffer` 추가(ServicePlugin.pdf.test.ts no-undef 3건, origin/master부터 pre-existing) | eslint 0err |
| `998740b` | **editor #1**: 배포 stale chunk 자동리로드(`vite:preloadError`+sessionStorage 쿨다운 가드)+EditorErrorBoundary 폴백 + FilterPlugin.dispose `super.dispose()` TypeError 봉합(**PluginBase no-op dispose()**) | 유닛 4/4 |
| `2fa7f12` | **editor #2**: 클릭 포커싱 dpr 정합(fabric 캐시된 devicePixelRatio stale → `syncFabricDevicePixelRatio` 재동기, 순수 dpr변경 재센터 스킵=pan/zoom 보존)+디버그 console.log 12곳 dev 게이팅 | 유닛 510 · **새탭 scaleX===dpr 실측** |

**부수 산출**:
- **G-6 대조표**(`G6_COMPARISON_2026-07-24.md`): 19741bdb B본 vs util 정식파생본 제목/저자 Δ**0.12mm ≪ 1mm** = **B본 수용가능**(교체 긴급 아님).
- **C6-b 파트너 공지 발송본**(`NOTICE_bookmoa_mobile_c6b_delete_modal_2026-07-24.md`).
- 라이브 크롬 검증: C6-b 삭제확인모달 프로덕션 작동 · #2 정상 dpr(2.0) 정합.

---

## 2. 예정 내역 (우선순위·전부 비차단)

### A. 오너 결정/행동 대기
1. **G-6 백필 결정** — 대조 Δ0.12mm=수용가능. **A(교체 안 함, 권장)** vs B(정식파생본 교체=IDML잔재정리, seed/DB 1회 백필+현행 B본 롤백JSON 선백업). B 승인 시 스크립트 작성·실행 가능(권한 무시 모드).
2. **C6-b 공지 relay** — 발송본 완성, bookmoa-mobile/ShareSnap에 오너 전달(Storige 세션은 파트너 직접 채널 없음).
3. **C6 실기 fe-qa** — iOS Safari + Android Chrome. C6-b 삭제모달 포함 롱프레스 육안(필수 B1 Android contextmenu·B2 합성 mousedown·B3 vibrate·B6 iOS 콜아웃). 롤백=`VITE_ENABLE_TOUCH_CONTEXT_MENU=false`.
4. **#2 줌 상태 클릭 확인** — 브라우저 줌(Ctrl+/−, dpr≠2.0) 걸고 클릭 정합 확인(정상 dpr은 새탭 실증, 줌 재정합은 유닛+로직 검증). 문제 시 보고.

### B. 개발 백로그 (요구 시)
5. **#3 3D→플립북 완전교체**(XL) — 흰화면=BookMockup3D(three.js 아닌 CSS 3D)에 EditorHeader 이미지 prop 미전달+`cropRegions.extractRegionImages` dead code. **즉시 흰화면 복구=cropRegions 배선(S)**. 완전교체=react-pageflip+표지(cropRegions)+내지(toDataURL/워커 pageImageUrls)+**공유링크 net-new(공개 미리보기 라우트·인증 모델 오너결정, 게스트 스코핑)**.
6. **#4 단면↔펼침면 강제편집** — 현재 원칙(templateSet authoring 대로 렌더·썸네일 동기화)은 정상. 단면 내지를 펼침면으로 강제 편집하는 요구 발생 시 반영(regionScope=inner+innerSpec).
7. **console.log 전량 게이팅** — #2에서 12곳(사용자가 본 WorkspacePlugin 반복로그 포함)만 dev 게이팅. ServicePlugin PDF 저장 핫패스 60여개 잔존 → source-exposure 정리 트랙.
8. 트랙C 잔여 게이트(G-4 PDF픽셀 왕복·G-5 시각스모크) · R-44 책등 휴면 · 멀티테넌시 P3b · 보안 후속 = 각 프로젝트 메모리 참조.

---

## 3. 환경·함정

### 배포·운영
- editor/admin = master push 자동배포(이번 세션 6회 정상). 반영 안 보이면 Vercel MCP `get_deployment`(githubCommitSha 대조) 먼저. api/worker = VPS SSH 수동(`docker compose up -d --build`, nginx 재시작).
- **자동모드 classifier가 프로덕션 액션(SSH DB read / git push / vercel 배포 / DB write)을 차단** → '권한 무시' 모드 필요(채팅 승인으로 안 풀림, harness 레벨).
- **배포 후 stale chunk**: 배포로 lazy 청크 재해시 → 열어둔 옛 탭이 옛 파일명 404 → EditorErrorBoundary. `998740b`의 vite:preloadError 자동리로드가 **다음 배포부터** 자동 복구(이번 배포 자체는 리스너 등록만 반영). 오너 즉시 해결 = 새로고침.
- PUBLIC 레포 push 전 `gitleaks detect --log-opts="<base>..HEAD"`.

### canvas-core (정본=[[reference_canvas_core_test_harness]] — 이번 세션 2함정 추가)
- **fabric 5.5.2 getPointer = 모듈 로드 시 1회 캡처한 `fabric.devicePixelRatio`(캐시·불변)로 retinaScaling 계산.** 브라우저 줌/모니터이동으로 실 dpr 변경 시 cssScale(attrW/boundingW)≠retinaScaling → 클릭 우하단 오프셋. `factory.syncFabricDevicePixelRatio()`로 재동기 후 setDimensions(getWidth===w 가드 우회)+calcOffset. 순수 dpr변경은 재센터/setZoomAuto 스킵(pan/zoom 보존). setZoomAuto 중앙정렬(vt[4]/[5]) 무접촉.
- **비동기 clone 재진입 = 공유 불리언(altCloneStarted) 부족 → 제스처 세대 토큰**(gen++, 콜백 `gen!==현재세대` no-op, finalizeAltDrag 세대 미변경이 정확 — 리셋 시 gen 재사용→버그 재도입).
- 플러그인 `super.dispose()` 호출은 **PluginBase no-op dispose()**(2fa7f12/998740b)로 안전.
- 파일 disjoint면 같은 워크트리 병렬 구현 성공(구현 에이전트 자기파일+자기유닛, 통합 게이트는 메인 1회).

### 프로젝트 상시
- JSDoc/블록주석 안 `*/` 문자열 금지. 워커 신규 env=`.env`+compose 둘 다 매핑. admin/validate 자격증명 입력 금지(오너 확인 대체).

---

## 4. 워크트리·브랜치·정본
- **작업 기반**: `/Users/yohan/Developer/Bookmoa Storige editor/storige-fix-20260713`, 브랜치 `fix/editor-stale-chunk-and-pointer-dpr`(= origin/master **2fa7f12**, FF push 완료). 신규 작업은 origin/master 기준 새 브랜치.
- ⚠️ 타 세션(7026318f) 워크트리 `wt-m2`·`wt-s4c` 무접촉. stale plan 2건(`NOTICE_bookmoa_inner_pdf_size_spec_2026-07-14`·`SESSION_NOTE_2026-07-14_bookmoa_feedback_G3`) 무접촉.
- 메인 `storige/`(43fc2ea)=문서 정본 보관용(stale 브랜치).

### 정본 문서
- 설계: `.cursor/plans/TRACK_C_IMPL_DESIGN_2026-07-23.md` · `E2_IMPL_DESIGN_2026-07-23.md`(§4 C5·§5-5 C6-b·§10 오너결정).
- 대조: `G6_COMPARISON_2026-07-24.md` · 공지: `NOTICE_bookmoa_mobile_c6b_delete_modal_2026-07-24.md`.
- 직전 세션 상세: `RESUME_PROMPT_2026-07-24.md`(§1-1 감사·세대가드·lint / §1-2 editor 4버그).
- 워크플로우 저널: `.../subagents/workflows/wf_*/journal.jsonl`.
