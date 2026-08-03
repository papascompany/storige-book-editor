# RESUME PROMPT — 2026-07-24 (세션 정본 · E2 잔여 3트랙 + 강화 + G-6 완결)

> **이 문서가 최신 정본이다.** 직전 체인: RESUME_PROMPT_2026-07-23(R-44 책등 종결) → 07-24 세션1(트랙C 완결 + E2 C4~C9 LIVE) → **본 세션(E2 오너결정 대기 3트랙 + 적대검증 강화 + G-6 대조 완결)**.
> 본 세션 요약: E2 오너결정 대기 3트랙(**C5 다중선택 복제 · C6-b 삭제확인모달 · D-E2-1 분배단축키**)을 정본 권고 채택 → 4트랙 병렬 정찰 → 병렬 구현+적대검증(전량 PASS) → 통합 게이트 → **editor.papascompany.co.kr `bdef580` 자동배포 LIVE**. C5 z-order 통합테스트 강화(뮤테이션 변별력 실증). **G-6 대조표 산출**(Δ0.12mm ≪ 1mm = B본 수용 가능).

---

## 0. 세션 시작 프로토콜 (순서 고정)
1. `storige/CLAUDE.local.md` 먼저 읽기(SSH/Vercel/키/레시피). SSH 필요 시 `ssh-add -l` → 비면 `ssh-add ~/.ssh/id_ed25519`.
2. 본 문서(§1 현재상태 · §2 다음작업 · §3 함정).
3. **작업 기반 워크트리**: `../storige-fix-20260713`. `git fetch && git rev-parse origin/master`(현재 **bdef580**) 확인. 신규 작업은 **origin/master 기준 새 브랜치**.
4. `git worktree list` + `git status -sb` — 타 세션 미커밋 무접촉(§4).

---

## 1. 현재 상태 — E2 잔여 3트랙 + 강화 LIVE

전부 `editor.papascompany.co.kr` 프로덕션 배포·검증 완료. editor/admin = **master push 시 Vercel 자동배포**(이번 세션 웹훅 정상 발화, get_deployment sha 대조로 READY 확정 — 정본 §8-9 트랩 미발생). api/worker = 이번 무접촉(diff 0).

| 트랙 | 기능 | 커밋 | 롤백 |
|---|---|---|---|
| **C5** | **다중선택 alt+드래그 복제**(parity — Ctrl+D식 이중 clone→destroy() 실체화, 원본 직하 live indexOf, 원본 AS 계속 드래그) | `bbb2e9a` | `VITE_ENABLE_ALT_DRAG_CLONE=false` |
| **C6-b** | **컨텍스트 메뉴 삭제 → 확인 모달 정합**(onDeleteRequest 콜백층 가드+boolean 어댑터, 데스크탑 우클릭도 모달 경유) | `e2b8782` | 코드레벨(무플래그) |
| **D-E2-1** | **분배 단축키 alt+shift+h/v**(category:arrange, hideContext<3) | `93d2910` | 단축키만(무해) |
| **강화** | C5 WorkspacePlugin z-order 통합테스트(뮤테이션 실증) + C6-b 마운트 감시 주석 | `bdef580` | — |

- **핵심 결정**: 오너결정은 정본 §10/§7 권고 전량 채택 — D-E2-1 추가·D-E2-3 mousedown·D-E2-4 C6-b 포함·**C5 충실도=parity**(정본 §4-2 "기존 clone 규약 유지, 신규 직렬화 리스크 0" → extendFabricOption/frameRef remap 미수행, Ctrl+D 다중과 동일 한계=백로그).
- **게이트(그린)**: `@storige/types` build · canvas-core **500** · editor build · 노출검사 0(dist) · lint 내 7파일 clean · gitleaks clean(3커밋).

### 1-1. [2026-07-25 추가] lint 정리 + 최종 무결성 감사 → C5 세대가드 봉합 + 라이브 검증
- **lint 정리**(`ba1df10`, master LIVE): canvas-core `ServicePlugin.pdf.test.ts` Buffer no-undef 3건(origin/master부터 pre-existing) → `eslint.config.js` globals 에 `Buffer:'readonly'` 추가(기존 process 패턴). canvas-core `eslint src` 0 errors.
- **최종 통합 감사**(4렌즈 wf + completeness critic, e5db534..ba1df10): 차단성 회귀 0. **major CONFIRMED 1건 = alt-드래그 clone 재진입 세대 미구분 경합**(v1 단일 경로 선재, C5 다중이 async 창 확대). → 봉합(`d38e259`, master LIVE): `altGeneration` 세대 토큰, 콜백 가드 `!altCloneStarted || gen!==altGeneration`. 단일(⑦-c)·다중(⑤-f) sentinel **뮤테이션 실증**(가드 제거 시 유령 사본 삽입 fail). **적대검증 PASS**(봉합 완전·회귀 없음·finalizeAltDrag 가 gen 미변경=정확). canvas-core **502**.
- **라이브 크롬 검증**(editor.papascompany.co.kr): **C6-b 삭제확인모달 프로덕션 작동 실증**(제목 우클릭→'삭제'→"객체 삭제" 확인 모달→취소=무변경). editor 로드 정상, 콘솔 "에러"=크롬 확장 통신(앱 무관). C5 다중/D-E2-1 은 자동저장 세션 오염 우려로 라이브 생략(코드 감사+통합테스트 커버).

### 1-2. [2026-07-25] editor 4버그 진단(오너 라이브 보고) → #1·#2 LIVE
Ultracode 4영역 병렬 정찰 → 근본 확정 → 오너 결정(#1·#2 수정 / #4 원칙확인 / #3 백로그):
- **#1 사이드메뉴 에러 = 배포 stale chunk**(브라우저 새 탭에서 정상 재현으로 확정) + FilterPlugin.dispose 가 없는 super.dispose() 호출 TypeError(6월 latent, caught). 봉합 `998740b`(master LIVE): main.tsx/embed.tsx 에 `vite:preloadError` 자동 1회 리로드(sessionStorage '__chunkReloadOnce' 10s 쿨다운 무한루프 가드) + EditorErrorBoundary stale 패턴 폴백 + **PluginBase no-op dispose()** 추가(super.dispose 근본 차단). 유닛 4/4.
- **#2 클릭 포커싱 우하단 = fabric 5.5.2 캐시된 devicePixelRatio stale**. getPointer 가 모듈 로드 1회 캡처한 fabric.devicePixelRatio 로 retinaScaling 계산 → 브라우저 줌(dpr 2.0→2.5) 후 cssScale≠retinaScaling → 클릭 배율 어긋남(**브라우저 측정 scaleX 2.0 vs dpr 2.5 실증**). 봉합 `2fa7f12`(master): `factory.syncFabricDevicePixelRatio()`(window.devicePixelRatio 로 fabric 캐시 재동기) + createFabricCanvas 직후 + useCanvasContainerSizeSync dpr변경 감지 시 setDimensions 재적용(getWidth===w 가드 우회)+calcOffset → cssScale===retinaScaling. **순수 dpr 변경(크기 불변)은 재센터 스킵**(pan/zoom 보존, 모니터이동/OS배율 회귀 방지 — 적대검증 지적 반영). 프로덕션 디버그 console.log 12곳 dev 게이팅. setZoomAuto 무접촉. 게이트: canvas-core 510·editor build·lint0·노출0·gitleaks. **라이브 검증 대기(줌 상태 클릭 정합 재측정)**.
- **#4 펼침면 세로 렌더 = 버그 아님**(오너 확인·정찰 확정). sample-8x8-book-24p 내지가 seed 에서 **단면(203×203, spread_config NULL) authoring** → 단면 렌더가 정상, 썸네일도 그 downstream. 펼침면 데이터(regionScope=inner+innerSpec)면 isPhotobookInner 2-up 경로로 정확 렌더. 오너 원칙="템플릿 authoring 대로 편집·썸네일 동기화"=이미 정확. **코드 수정 불요**. 백로그: 단면 내지를 펼침면으로 강제 편집(추후 요구 시).
- **#3 3D 미리보기→플립북 = 백로그**(XL). 흰화면=BookMockup3D(three.js 아님, CSS 3D)에 EditorHeader 가 이미지 prop 미전달+cropRegions(extractRegionImages) dead code. 완전교체=react-pageflip+표지(cropRegions 배선)+내지(toDataURL/워커 pageImageUrls)+**공유링크(net-new, 공개 미리보기 라우트·인증 오너결정)**. 즉시 흰화면만이면 cropRegions 배선(S).
- **파일 disjoint 병렬**: CopyPlugin(C5) / ObjectPlugin+createCanvas(C6-b) / AlignPlugin(D-E2-1) — 겹침 0.

---

## 2. 다음 세션 작업 (우선순위·전부 비차단)

1. **C6 실기 fe-qa** (유닛 불가·실기 전용): iOS Safari + Android Chrome. C6-b 삭제모달이 C6 롱프레스 위에 얹힘 → 롱프레스→'삭제'→**확인 모달 경유** 육안 확인. 필수 게이트=B1(Android 네이티브 contextmenu 700ms)·B2(합성 mousedown 400ms 재-arm)·B3(vibrate)·B6(iOS 콜아웃).
2. **G-6 백필 오너 결정**: 대조표 = `G6_COMPARISON_2026-07-24.md`. **Δ0.12mm(상한1mm 이내) → B본 수용 가능, 교체는 개선(IDML 잔재 정리)이지 긴급 아님(§7-4)**. 실행 시 = 1회 백필 스크립트(d765713a에 util 적용→19741bdb UPDATE) + 현행 B본 전체 롤백 JSON 선백업 + 오너 승인. TRACK_C 파생트랙 G-1 green 선결(충족).
3. **C6-b 파트너 통지 relay (오너)**: 발송본 완성 = `NOTICE_bookmoa_mobile_c6b_delete_modal_2026-07-24.md`(작업 워크트리 .cursor/plans/). 직전 c5c6c9 공지의 "C6-b 도입 시 별도 통지" 이행. bookmoa-mobile/ShareSnap.
4. **트랙C 잔여 게이트(비차단)**: G-4 골든 PDF 픽셀 왕복(픽스처 생성=에디터빌드+deriveOrientation DB쓰기+브라우저 필요) · G-5 파생표지 시각 스모크(/template·/embed 브라우저). 둘 다 자동화 불가, 오너/수동.
5. **pre-existing lint 3건**: `ServicePlugin.pdf.test.ts` Buffer no-undef(56/94/108) — origin/master부터 존재, 내 작업 무관. 배경 태스크로 플래그됨(eslint test env node 추가).
6. **frameRef remap 백로그**(C5 parity 유예) · R-44 책등 휴면 · 멀티테넌시 P3b 등 = 각 프로젝트 메모리 참조.

---

## 3. 환경·함정

### 배포·운영
- editor/admin = master push 자동배포. **이번 세션 웹훅 정상 발화**(BUILDING→READY 84초). 반영 안 보이면 Vercel MCP `get_deployment`(githubCommitSha 대조)로 확정. CLI 수동배포는 ERROR 고착 시 폴백.
- **자동모드 classifier가 프로덕션 액션(SSH DB / git push / vercel 배포)을 차단** → '권한 무시' 모드 필요(채팅 승인으로 안 풀림, harness 레벨).
- PUBLIC 레포 — push 전 `gitleaks detect --log-opts="<base>..HEAD"`.

### canvas-core (이번 세션 확정·정본=[[reference_canvas_core_test_harness]])
- 3트랙 파일 disjoint면 같은 워크트리 병렬 구현 가능(구현 에이전트는 자기 파일만+자기 유닛만, 통합 게이트는 메인이 1회).
- fabric 5.5.2 ActiveSelection.destroy()→_restoreObjectsState 가 그룹행렬을 멤버에 baking(절대좌표 실체화) — C5 다중복제 핵심. z-order 삽입은 매 반복 live `getObjects().indexOf(source)` 재조회(고정 스냅샷 금지).
- C6-b 재귀 함정: onDeleteRequest 가드는 삭제 hotkey **콜백층에만**(del() 코어 아님 — confirmDeleteSelection→del() 무한 모달 루프). requestDeleteSelection은 void → `()=>{...; return true}` boolean 어댑터.
- G-6 파생본 계산: api jest 임시 spec, 픽스처는 `fs.readFileSync`+JSON.parse(resolveJsonModule 미설정).

---

## 4. 워크트리·브랜치
- **작업 기반**: `../storige-fix-20260713`, 브랜치 `feat/e2-c5multi-c6b-distribute`(= origin/master **bdef580**, FF push 완료). 신규 작업은 origin/master 기준 새 브랜치.
- ⚠️ 타 세션(7026318f) 워크트리 `wt-m2`·`wt-s4c` 무접촉. stale plan 2건(`NOTICE_bookmoa_inner_pdf_size_spec_2026-07-14`·`SESSION_NOTE_2026-07-14_bookmoa_feedback_G3`, 07-14) 무접촉.
- 메인 `storige/`(43fc2ea, docs/d10a-shopify-guide-split)는 stale 브랜치 — 문서 정본(RESUME_PROMPT·NOTICE·G6_COMPARISON·TRACK_C/E2_IMPL_DESIGN) 보관용.

### 정본 문서
- 설계: `.cursor/plans/TRACK_C_IMPL_DESIGN_2026-07-23.md` · `E2_IMPL_DESIGN_2026-07-23.md`(§4 C5·§5 C6·§10 오너결정).
- 대조: `G6_COMPARISON_2026-07-24.md`. 공지: `NOTICE_bookmoa_mobile_c6b_delete_modal_2026-07-24.md`.
- 정찰/구현/강화 워크플로우 저널: `.../subagents/workflows/wf_*/journal.jsonl`.
