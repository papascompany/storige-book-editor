# Storige Editor 프론트엔드 트랙 — 새 세션 RESUME 프롬프트

> **사용법**: 새 Claude Code 세션을 열고 아래 "복사용 프롬프트" 블록 전체(line 13 이후)를 첫 메시지로 붙여넣으세요.
> 이 문서는 지우지 말고 보관하세요. 새 트랙이 추가될 때 §"누적 트랙" + §"향후 작업 후보" 두 곳을 갱신하면 됩니다.
>
> **버전**: v4 (2026-05-02 KST) — 누적 트랙 0~CC + 모바일 PR + 5차 P0 + DD-5-B-v2 + P1-3 + BB-Phase 3 follow-up + cleanup cron + 6차 P0 핫픽스 사이클 + **P1 전 트랙 완료** (G/C/F/E/D/B 6개 트랙 + PHP 연동 검증 MD) 반영.
> **이전 가이드**: `_RESUME_PROMPT.md` (인프라·PHP·운영 컷오버 작업용 — 별도 흐름)

---

## 복사용 프롬프트 (이 줄 아래부터 끝까지 복사)

[Storige Editor 트랙 재개 — 2026-05-02 기준 / master `d2b3271` / Vercel 자동 배포 + VPS 재배포 2회 완료]

# 한 줄 요약

`apps/editor`(React + Vite + Fabric.js + Zustand + TailwindCSS) 누적 **92+ commit**, Vercel 자동 배포 + **운영 VPS 재배포 2회 완료**(2026-05-01 23:33 / 2026-05-02 12:37+13:02). DB 마이그 2건 운영 적용(`products.allowCustomSize` + `edit_session_versions` LRU 20 + `thumbnail_url` 컬럼). 신규 의존성 `@nestjs/schedule@^4.0.0` 운영 적용. 6차 P0 핫픽스 사이클(Vercel cache + 배경색 fresh fetch + SVG fileToImage 분리 + unhandledrejection handler + 모바일 4MB 가드 + 요소 도구 raster 허용)로 사용자 실기기 보고 4건 + 콘솔 보고 3건 모두 처리. **P1 전 트랙 완료**: G(모바일 헤더 375 overflow) + C(저장/불러오기 멀티페이지 E2E) + F(태블릿 세로 drawer) + E(콘텐츠 패널 카테고리 탭) + D(Composite 다중 선택 cross-canvas) + B(webhook 타입 정합) + PHP 연동 검증 MD. 다음 후보는 P2 트랙(dark mode 오브젝트 색상 통일 / lint 정리 / Playwright E2E) 또는 **PHP 실제 통합 테스트**. 작업 컨벤션·디자인 토큰·검증 흐름·운영 배포 절차 모두 정착됨.

# 작업 디렉토리·환경

- **루트**: `/Users/yohan/claude/Bookmoa Storige editor/storige`
- **모노레포 구조** (pnpm + Turborepo):
  - `apps/editor` — Vite + React + Fabric.js (이번 트랙들의 무대)
  - `apps/admin` — Ant Design 관리자
  - `apps/api` — NestJS API
  - `apps/worker` — NestJS PDF 워커
  - `packages/types` — 공유 TypeScript 타입
  - `packages/canvas-core` — Fabric 래퍼 + 플러그인 시스템 (`dist/`가 git에 commit돼 editor가 직접 import — 변경 시 `tsc` 빌드 필요)
- **개발 서버**: 이미 가동 중 (preview MCP 사용 가능). 새로 띄울 땐 `pnpm --filter @storige/editor dev` (port 3000)
- **배포**: `git push origin master` → Vercel 자동 (`editor.papascompany.co.kr`)

# 핵심 문서 (반드시 먼저 읽을 것)

| 파일 | 역할 |
|---|---|
| `CLAUDE.md` | 모노레포 전반 + 빌드/명령 |
| `.cursor/plans/editor_layout_custom.md` | 본 작업의 마스터 문서 — §6.0 후속 트랙 표(A~T) + §8.0 완료 항목 + §8.1-8.3 향후 후보 |
| `.cursor/plans/cover.md` | 표지 편집 모드(separated/composite/spread) 설계 + Phase 3b 로드맵 |
| `_RESUME_EDITOR_TRACKS.md` (이 파일) | 트랙 누적 + 컨벤션 + 향후 후보 |
| `_RESUME_PROMPT.md` (별도 흐름) | 인프라·PHP·운영 컷오버 작업용 — 본 트랙과 무관 |

# 누적 트랙 — 2026-05-02 (master `d2b3271`)

> 트랙 0~T(23 커밋) — 1차 폴리싱 사이클 완료
> 트랙 U~BB(7 커밋) — 2차 사이클 (D5 Phase 3b 마무리, 다크 Phase 3, 반응형 Phase 2, 그라디언트, 스냅샷 list)
> 트랙 CC-1/CC-2(2 커밋) — 3차: D5 Phase 3b-v Composite cross-canvas 객체 이동
> 트랙 CC-Phase 2A/B + DD-3/4/5-A + BB-Phase 3(7 커밋) — 4차: 정밀 좌표 매핑 + 그라디언트 angle/radial + ★ 즐겨찾기 + 페이지 reorder 인프라 + 백엔드 versions 풀 스택
> **모바일 사이클 — PR #1~#10(27 커밋, `d341af7 → da82764`)** — 모바일 터치 UI 전반 / ResizeObserver 차단 / 메모리 폭발 v3 / ErrorBoundary + localStorage 백업 / 옵션 B/C 풀스택 + 마이그 SQL / 잔존 작업 종합 리뷰
> **5차 P0 사이클(5 커밋, `0b7cc23 → 60efb05`)** — P0-4 시점별 복원 UI(confirm + auto reload) / P0-3 사전 type 에러 9건 정리 / P0-1·P0-2 운영 가이드 + BB-Phase 3 마이그 SQL / 마이그 FK COLLATE 보정 / **모바일 페이지 크래시 fix(배경색 + 다크 핸들)**
> **운영 적용 (2026-05-01 23:33~23:39 KST)**: DB 마이그 2건 적용(`products.allowCustomSize` + `edit_session_versions` LRU 20) + git pull(89 commit) + docker compose up -d --build api worker 완료 + endpoint 검증 (BB-Phase 3 활성화)
> **운영 적용 (2026-05-02 12:37 KST, ssh deploy@158.247.235.202)**: `git pull origin master` (ce082ef→2097e1c, 6 commits — 모바일 크래시 fix `60efb05` 포함 미배포분 + DD-5-B-v2 + P1-3 type cleanup + BB-Phase 3 썸네일 풀스택 + cleanup cron) + `docker compose up -d --build api worker` 완료. 검증: ScheduleModule 로드 + `/api/storage/upload/thumbnails` POST endpoint 매핑 + health 200 + thumbnail_url 컬럼 존재 + 운영 데이터 0건 안전
> **운영 P0 사용자 보고 (2026-05-02 13:30 KST)**: 실기기 테스트에서 4개 이슈 발생 — (1) 모바일/PC "Importing a module script failed" → Vercel CDN HTML cache 9분(age:552) → 새 deploy 시 옛 chunk hash 404 (2) 모바일 배경색 picker dismiss 시점에 적용되는데 사용자 혼동 (3) 모바일 사진/요소 업로드 시 페이지 다운 (4) 반복 ErrorBoundary 트리거. 핫픽스 commit/배포: `vercel.json` headers 추가(index.html no-store + assets immutable 1y) + AppBackground에 명시적 "적용" 버튼 + 모바일 안내 텍스트 + useImageStore에 모바일 4MB 가드(checkMobileFileSize → showToast). canvas-core 변경 없음. 운영 적용은 Vercel 자동 빌드만으로 충분 (api/worker 변경 0건)
> **P1 전 트랙 사이클(7 커밋, `0a1f3e9 → d2b3271`)** — PHP 연동 검증 MD 신규 작성 + G 모바일 헤더 375 overflow + C 저장/불러오기 멀티페이지 E2E + F 태블릿 세로 drawer + E 콘텐츠 패널 카테고리 탭(AppElement/AppBackground/AppTemplate) + D Composite 다중 선택 cross-canvas + B webhook 타입 정합
> 시각 검증: 4차까지 W/X/Z/AA/BB 7/7 통과 + P0-4 popover 분기 정확 + 모바일 fix 후 desktop 메모리 118MB 정상

| 트랙 | 커밋 | 주제 |
|---|---|---|
| (트랙 0) | `f4960c6` | 디자인 토큰 정비 + 사이드바 가변 + 요소 메뉴 복원 |
| **A** | `8ea4e07` | 헤더 UX (사이즈 픽커, Undo/Redo 상태, Cmd+\\ 사이드바, hover 색상) |
| **B-1** | `1748fab` | 표지 편집 모드 Phase 1 (페이지 네비 정밀화 + cover.md 설계) |
| **B-2** | `308bb1f` | 표지 편집 모드 Phase 2 (CoverFocusBar) |
| **C** | `d812361` | UX 폴리싱 (AppSection 펼침 영속 + 드래그 핸들 더블클릭) |
| **D-1** | `f4b8630` | 다크 모드 인프라 (`:root[data-theme="dark"]` + theme store + useThemeSync) |
| **D-2v1** | `540a2aa` | 다크 모드 chrome 토큰 스윕 (5개 컴포넌트) |
| **D-2v2** | `aadffa5` | 다크 모드 controls/tools 토큰 스윕 (~10개 파일) |
| **E-1** | `309fea2` | 반응형 레이아웃 Phase 1 (모바일 사이드바 슬라이드오버) |
| **F** | `ce2d854` | 키보드 단축키 도움말 모달 (`?` / Cmd+S 추가) |
| **G** | `3f1adcb` | 토스트 알림 시스템 (자체 구현, 외부 의존성 없음) |
| **H** | `fc34354` | AutoSaveIndicator 리팩토링 (lucide + 토큰 + 상태 변화 토스트) |
| **I** | `b568de8` | 최근 사용 색상 LRU stack (`useRecentColorsStore` 16개) |
| **J** | `c8e4054` | 커맨드 팔레트 (Cmd+K, 22 정적 + 동적 페이지 액션) |
| **K** | `11c8877` | 작업명 store 동기화 + 빈 캔버스 Empty State + Undo 미동기 보정 |
| **L** | `da60703` | 객체 정렬 도구 가시화 (AlignPlugin → ControlBar 6버튼) |
| **M** | `5213782` | 표지 편집 모드 사용자 토글 (Cmd+K 액션 3개) |
| **N** | (docs) | lucide tree-shaking 정적 분석 (sideEffects:false 확인, 추가 조치 불필요) |
| **O** | `36471bc` | D5 Phase 3b 인프라 (`useCoverRegion` hook + cover.md §7 정교화) |
| **P** | `0db61b0` | 자동저장 토스트 옵션 (`autoSaveToastEnabled` v6→v7) |
| **Q** | `13a1dbe` | 변경 이력 요약 패널 (`HistoryPanel` Popover) |
| **R** | `7af39fa` | 빠른 색상 팔레트 (ColorPicker 위 8개 swatch row) |
| **S** | `3d67d85` | 드래그 앤 드롭 이미지 업로드 (`useImageStore.uploadFile`) |
| **T** | `37bb181` | 객체 멀티 선택 분포 도구 (3+ 선택 시 가로/세로 분포) |
| **U** | `a8e1558` | D5 Phase 3b-ii + 3b-iii — `useSpreadAutoAnchor` (object:added → resolveRegionRef → meta 부여), 3b-iii는 `SpreadPlugin.handleObjectModified`가 이미 처리(검증 완료) |
| **V** | `af79102` | D5 Phase 3b-iv — `SpreadPlugin`에 `spreadObjectsOutOfBounds` 이벤트(canvas-core 빌드), `useSpreadOutOfBoundsToast` hook이 구독해 책등 가변 후 이탈 객체 N개 warning toast 표시 |
| **W** | `846d5e9` | 다크 모드 Phase 3 — `RULER_DEFAULTS_DARK`+`RulerPlugin.setTheme()` (canvas-core), `defaultControlsDark`+`getDefaultControls()` (editor), `useCanvasThemeSync(ready)` hook이 테마 변경 시 ruler+선택 핸들 일괄 적용. 워크스페이스 흰 페이지 유지 |
| **X** | `43a6ba0` | 반응형 Phase 2 (부분) — 사이드바 핸들 Pointer Events 통합(마우스/터치/펜) + setPointerCapture + 5px hit area, BookNavigation 화살표 44×44 터치 타겟 + aria-label. 태블릿 헤더 wrap은 후속(X-2) |
| **Y** | `1d07e00` | 작은 묶음 — 멀티파일 드롭 (이미지 N개 순차 업로드 + cascade 20px offset + 일괄 success/partial/fail toast), Shift+화살표 10px nudge 단축키 카탈로그 등록(코드는 `ControlsPlugin`에 이미 존재) |
| **Z** | `4fefa91` | 반응형 Phase 2 X-2 — 헤더 작업명 max-w 단계 추가(`sm:180/md:200/lg:280`), 페이지네비 select를 `lg:block`로 좁힘(태블릿에서 헤더 도구 폭 여유 확보) + tooltip 안내 갱신 |
| **AA** | `0cf72fb` | ObjectFill 그라디언트 프리셋 8개 (Brand/Sunset/Ocean/Mint/Sunrise/Lush/Mono/Cherry) — 7×7px 미니 swatch 클릭 1회로 linear 90° 그라디언트 적용 (fabric.Gradient + object:modified 발행). 텍스트 객체는 fabric setSelectionStyles 한계로 미지원(자동 hide) |
| **BB** | `386c37b` | 버전 히스토리 패널 Phase 2 minimal — `useAutoSaveSnapshotsStore` (LRU 5 + zustand persist), `useAutoSave.saveToServer` 성공 시 메타 push, `HistoryPanel`에 "최근 자동저장 N" list (시각/페이지수, 지우기 액션). 시점별 복원은 백엔드 versions API 연동 후 별도 트랙 |
| **CC-1** | `ee69dda` | D5 Phase 3b-v 인프라 — canvas-core `moveObjectToCanvas(obj, src, tgt, opts)` helper (fabric clone w/ core.extendFabricOption + meta deep clone, atomic dual-canvas history offHistory/onHistory, 시스템 객체/same-canvas 가드). 두 캔버스 history 분리 정책 — Phase 2에서 atomic 통합 검토 |
| **CC-2** | `d54489c` | D5 Phase 3b-v UI — `MoveToCoverRegion` 컴포넌트 ControlBar에 추가 (표지 컨텍스트 + 객체 선택 + 표지 그룹 ≥2 + 단일 선택 가드). 클릭 시 target 워크스페이스 중심에 cross-canvas move + target SpreadPlugin 있으면 resolveRegionRef 자동 갱신 / 없으면 coverPosition 단순 설정 + 페이지 자동 전환 + toast |
| **CC-Ph2A** | `f3c8e41` | cross-canvas 정밀 좌표 매핑 — `getWorkspaceBox` helper + xNorm/yNorm 정규화로 source 워크스페이스 상대 위치를 target에서 동일 비율 유지 (단순 중심 fallback) |
| **CC-Ph2B** | `16031c9` | cross-canvas atomic undo 보조 — `useCrossCanvasMoveStore` (LRU 1, TTL 30s), MoveToCoverRegion에 "방금 이동 되돌리기" 버튼 (target 페이지 + 30s 윈도우, 양 캔버스 동기 undo) |
| **DD-3** | `e37f148` | 그라디언트 옵션 확장 — angle 4 프리셋 (0/45/90/135°) + radial 토글 + lastGradient 보관 + 옵션 변경 시 즉시 재적용 (8 swatch 미리보기도 동기화) |
| **DD-4** | `2717a00` | CommandPalette 즐겨찾기 ★ — `useCommandFavoritesStore` (zustand persist v1) + 모든 액션에 ★ hover 토글 + filtered 결과 최상단 "★ 즐겨찾기" 그룹 + flat keyboard nav 보정 |
| **DD-5-A** | `ac3402a` | useAppStore.reorderByIndex 액션 (페이지 순서 재배열 인프라) — 0..N-1 순열 검증, allCanvas/allEditors/pages 동기 재배열, currentPageIndex 보정. UI(BookNavigation drag)는 1차 시도 후 안전상 별도 트랙(DD-5-B-v2)으로 분리 |
| **BB-Phase 3** | `b366042` | 풀 스택 자동저장 시점 versions — 백엔드 `EditSessionVersion` 엔티티(LRU 20) + autoSave debounce 1분 push + listVersions/getVersion/restoreVersion 3 endpoints + editor `sessionsApi` 클라이언트 + `HistoryPanel` 분기 통합("자동저장 시점 N" + ★ 복원 버튼, sessionless 시 트랙 BB minimal fallback) |
| 모바일 PR #1~#10 | `d341af7 → da82764` (27) | 모바일 터치 UI 전반 / ResizeObserver 무한 루프 차단 / 텍스트 선택 즉시 해제 / 메모리 폭발 v3 (썸네일 스킵+히스토리 축소) / ErrorBoundary + localStorage 백업 / 옵션 B/C(width/height override) 풀스택 + 마이그 SQL + 전수 테스트 / `vite.config` 산출물 gitignore / EditorView width/height 누락 fix / `REMAINING_WORK_REVIEW.md`(P0/P1/P2 통합 우선순위) |
| **P0-4** | `0b7cc23` | 시점별 복원 UI confirm 단계 — `confirmingId` state + inline confirm 카드(amber 경고 + 확인/취소) + 성공 시 setTimeout(500ms) → `window.location.reload()` (가장 안전한 캔버스 재초기화) |
| **P0-3** | `8820066` | 사전 type 에러 9건 정리 — `useCoverRegion` SpreadRegion 위치 / `setup.ts` vi import / `useAppStore` safeSize+CanvasData / `useImageStore` Promise<string> / `PageItem` SPREAD case / `useEditorContents` SpreadConfig.version + width/height / `TextAttributes` symbol cast. 잔여 12건은 follow-up PR 권장 (embed/test/graphql codegen) |
| **P0-1·P0-2 docs** | `ed4e08b` | `apps/api/migrations/20260501_add_edit_session_versions.sql` 신규 + README 갱신 + `docs/P0_OPERATIONS_CHECKLIST.md`(운영 마이그 가이드 + 모바일 8 시나리오 체크리스트) |
| **migration fix** | `ce082ef` | `edit_session_versions` FK COLLATE 누락 보정 — 운영 적용 시 errno 150(`edit_sessions.id`가 `utf8mb4_unicode_ci`인데 신규 테이블 default가 다름) 발견 후 명시적 `COLLATE=utf8mb4_unicode_ci` 추가 + 코멘트로 향후 동일 issue 방지 |
| **mobile crash fix** | `60efb05` | iOS Safari 페이지 크래시 회피 — `AppBackground.onBgColorChange/onLidColorChange`: `canvas.renderAll()`(sync) → `canvas.requestRenderAll()`(다음 frame, frame skip) + `updateObjects()` 호출 제거(배경은 selection 무관). `useCanvasThemeSync`: TOUCH_ENV 가드 추가(모바일에선 객체 set 스킵, 룰러 setTheme만 적용) |
| **DD-5-B-v2** | `aff4396` | 페이지 drag-to-reorder UI — `PageThumbnail`에 drag props (`draggable`, `onDragStart/Over/Leave/Drop/End`, `isDragSource`, `insertHint`) + insert bar(4px accent edge) + grab/grabbing cursor. `BookNavigation`에서 native HTML5 DnD로 wiring: 표지(isCover) 제외 + 모바일/스프레드/`pageCount !== allCanvasLength` 가드, source/target 모두 내지일 때만 활성. `computeInnerReorder` helper로 0..N-1 순열 빌드 후 `reorderByIndex` 호출 + 성공 toast. 의존성 추가 0건 (dnd-kit 미사용) |
| **P1-3** | `d1d78fc` | 잔여 type 에러 12건 + cascading 4건 정리 — embed.tsx (templateSet `.data` 폴백 제거 + safeSize 키 제거 + 중복 `export type` 제거), useEditorStore.test.ts (EditPage `name` 필드 미존재 → `sortOrder`로 교체, `editable` 제거), AppElement.tsx (graphql codegen vs @storige/types EditorContent 불일치 → `as unknown as` 캐스팅 + 주석), AiPanel/RecommendationPanel/GenerationPanel/LazyAiPanel (`'book' \| 'leaflet'` 문자열 union → `TemplateSetType` enum 통일). `pnpm tsc --noEmit` clean 0 errors |
| **BB-Phase 3 follow-up** | `4901af9` | 자동저장 시점 썸네일 풀스택 — **백엔드**: `StorageService` 'thumbnails' 카테고리 추가 + `POST /storage/upload/thumbnails` (@Public, multer memory) + `AutoSaveDto.thumbnailUrl?` + `editor.service.maybePushVersion(.., thumbnailUrl)` 시그니처 확장. **에디터**: `useAutoSaveThumbnail` 신규 hook (TOUCH_ENV 가드 → 모바일 자동 스킵, fabric.toDataURL 0.25x JPEG q0.7, dataURLtoBlob 직접 디코딩, 실패 시 null fallback) + `useAutoSave.saveToServer`가 캡처/업로드 후 `thumbnailUrl`을 autoSave payload에 포함 + `storageApi.uploadThumbnail` 헬퍼 + `HistoryPanel`에 `ThumbnailMini` (28×40 + ImageOff placeholder) + hover 시 160px 큰 미리보기 popover (`hoverPreviewId` state, mouseenter/leave 트리거, `pointer-events-none` floating). **마이그**: 0건 (`thumbnailUrl` 컬럼은 BB-Phase 3에서 미리 추가됨). **R2 미사용** (운영 인프라 조사 결과 로컬 FS 기반 `/storage/files/{cat}/{file}` 패턴) |
| **BB-Phase 3 cleanup cron** | `2097e1c` + `9d67d8c` | orphan thumbnail 정리 인프라 — **신규 의존성**: `@nestjs/schedule@^4.0.0` + `ScheduleModule.forRoot()` AppModule 등록. **신규 service**: `ThumbnailCleanupService` (editor 모듈) 두 갈래 동작 — (a) `unlinkThumbnailIfReferenced(url)`: trimVersions가 LRU 초과 version 삭제 시 즉시 호출돼 file unlink (deletion-time cleanup, fire-and-forget); (b) `@Cron('30 17 * * *', name:'thumbnail-orphan-cleanup')`: 매일 UTC 17:30 = **KST 02:30**에 storage/thumbnails/ 스캔 → DB의 EditSessionVersion.thumbnailUrl 미참조 + 24h grace window 통과한 파일 일괄 unlink (안전망). 환경 변수 `THUMBNAIL_CLEANUP_DRY_RUN=1`로 dry-run 가능. **운영 컨테이너 TZ 정책**: docker container는 UTC 기본 (host Asia/Seoul 미상속), 따라서 cron 표현식은 UTC 기준 작성. nest build clean |
| **6차 P0 핫픽스 #1** | `5228171` | Vercel CDN HTML cache → 새 deploy 시 옛 chunk hash 404 ('Importing a module script failed') — `vercel.json` headers 추가: `/(index\.html)?` no-cache/no-store/must-revalidate + Pragma + Expires:0 / `/assets/*` immutable 1y. **검증**: index.html → `cache-control: no-cache, no-store, must-revalidate` + chunk → `max-age=31536000, immutable`. 직전 commit `ae59bf2`는 vercel.json에 invalid `comment` 키로 schema 거부 → ERROR 빌드, `5228171`에서 제거 후 빌드 성공 |
| **6차 P0 핫픽스 #2** | `5228171` | 모바일 배경색/뚜껑색 적용 명시화 + 모바일 사진 업로드 가드 — **AppBackground**: 명시적 "적용" 버튼(Check 아이콘) + 모바일 안내 텍스트("팝업에서 색상 선택 후 X(닫기)를 누르면 자동 적용됩니다") + applyBgColor/applyLidColor helper로 change/click 동일 로직 공유. **useImageStore**: `checkMobileFileSize` (TOUCH_ENV 가드 + 4MB 한도 + showToast) 3개 upload 진입점에 적용 (upload/uploadSimple/uploadFile) → iOS Safari 메모리 크래시 방지 |
| **6차 P0 핫픽스 #3** | `819008d` | "요소" 도구 raster 이미지 허용 정정 — 직전 `f65315d`에서 잘못된 SVG-only 정책. **AppElement.handleUpload**: accept를 `'image/*'`로 (SVG + PNG + JPG + GIF + WebP 모두). **useImageStore.upload**: `SelectionType.shape` non-SVG 분기를 raster 처리 로직으로 확장 (item에 위치/크기 + extensionType='shape'). 결과: SVG는 loadSVGFromURL로 vector, raster는 fabric.Image로 비트맵, 둘 다 element/요소로 추가 |
| **6차 P0 핫픽스 #4 v2** | `0c0e8aa` | 배경색 적용 무반응 v2 + SVG 화면 freeze v2 + unhandledrejection 안전장치 — **AppBackground.applyBgColor/applyLidColor**: useState 캐시 stale 회피 위해 매 호출 시 `canvas.getObjects().filter(...)`로 fresh fetch + `.set({ fill, dirty:true }) + canvas.renderAll()` (preview 픽셀 검증: `[248,206,206] = #F8CECE` 정확 반영). **useImageStore.upload**: `isSvgFile` 검출 후 SelectionType 무관하게 항상 `loadSVGFromURL` 사용 (이전 버전은 shape에서만 분리 → image/background에서 SVG 시 fabric `t.indexOf` throw 잔존). **main.tsx**: `window.unhandledrejection` global handler 추가 + `event.preventDefault()`로 React 트리 freeze 방지 (test rejection 캡처 검증 완료) |
| **PHP 연동 검증 MD** | `0a1f3e9` | `docs/PHP_INTEGRATION_VERIFICATION.md` 신규 작성 — 기존 연동안(옵션 B/C URL override + `X-API-Key` 인증 + 웹훅 콜백 흐름) 대비 현재 구현 상태 비교 분석. PHP 측 적용 시 체크리스트 + 예상 요청/응답 예시 포함 |
| **P1-G** | `9a0aac7` | 모바일 헤더 X-3 — 375px nav overflow 해소. 헤더 좌측 그룹 `min-w-0 flex-shrink` + 작업명 `truncate max-w-[120px]` + 버튼 그룹 `flex-shrink-0`으로 375px에서 가로 스크롤 없이 nav 버튼 모두 노출 |
| **P1-C** | `9e8f4e5` | 저장/불러오기 E2E — 멀티페이지 canvasData 완전 보존. `useAppStore.loadSession`: 페이지별 canvasData 직렬화 시 `JSON.stringify` round-trip 으로 fabric object reference 유실 버그 수정. sessionId 환경에서 autoSave → `restoreVersion` → `window.location.reload` 라운드트립 검증 |
| **P1-F** | `5339e9d` | 반응형 Phase 3 — 태블릿(768-1023px) 세로 drawer 최적화. `EditorView.tsx`에서 `screenMode === 'mobile'` → `screenMode !== 'desktop'`으로 3곳 변경 → 태블릿에서도 `FeatureSidebar mobileOverlay={true}` + `ControlBar mobileOverlay={true}` + 백드롭 overlay 적용 (inline 사이드바가 캔버스 영역 축소하던 문제 해소) |
| **P1-E** | `d47a680` | 콘텐츠 패널 그리드 카탈로그 — AppElement/AppBackground/AppTemplate 3개 패널에 카테고리 탭 추가. **AppElement**: 마운트 시 pageSize:100 discovery fetch → 고유 tag 추출 → `selectedTag` 상태로 API `tags` 파라미터 필터. **AppBackground**: 동일 패턴 + `contentsApi.getBackgrounds()` 실 데이터 연결 (기존 빈 placeholder 교체). **AppTemplate**: GraphQL template `tags[].name` 기반 `useMemo` 클라이언트 사이드 필터 (API 호출 없음). 이미지 URL: `(content as any).imageUrl \|\| content?.image?.image?.url` REST/GraphQL 양측 대응 |
| **P1-D** | `3d05608` | Composite Ph3 다중 선택 cross-canvas 이동 — `MoveToCoverRegion`에서 단일 선택 가드 제거 + `activeSelection` 전체 루프. `workspace`/`meta.system` 객체 제외한 `moveableObjects` 배열 순회, 각 객체별 xNorm/yNorm 좌표 개별 계산 + `moveObjectToCanvas` 호출. `useCrossCanvasMoveStore.CrossCanvasMoveRecord`에 `count?: number` 추가. 되돌리기 시 `tgt.undo()` × N + `src.undo()` × N 루프 |
| **P1-B** | `d2b3271` | PDF Synthesis E2E 검증 — webhook 타입 정합성 수정. **webhook.service.ts**: `SynthesisWebhookPayload` re-export 추가 (`import` → `import + export`). **webhook.e2e-spec.ts**: `SynthesisWebhookPayload` 타입 적용, `result` 필드(타입 미존재) 제거, `synthesis.failed` 페이로드에 필수 `outputFileUrl: ''` 추가, `separate` 모드(`sessionId + outputFiles`) 신규 TC 추가 |

## 디자인 토큰 (다크 모드 호환 필수)

- **금지**: `bg-white`, `text-gray-X`, `border-gray-X`, `bg-gray-X`, `hover:bg-gray-X` (하드코딩 그레이)
- **사용**: `bg-editor-panel`, `text-editor-text`, `text-editor-text-muted`, `border-editor-border`, `bg-editor-surface-low`, `bg-editor-hover`
- **opacity modifier**: `bg-editor-accent/10`, `text-editor-accent/50` 등 — RGB triplet(`--color-primary-rgb`) 인프라로 자동 작동
- **다크 토큰**: `:root[data-theme="dark"]` 가 모든 토큰 재정의. RGB triplet 패턴 그대로 사용해 opacity modifier도 다크에서 자동 작동.

## 토큰 매핑 표 (그레이 → 토큰)

```
bg-white                  → bg-editor-panel
text-gray-700             → text-editor-text
text-gray-{400,500,600}   → text-editor-text-muted
border-gray-{100,200,300} → border-editor-border
bg-gray-{50,100}          → bg-editor-{surface-low,hover}
bg-gray-{200,300}         → bg-editor-border
hover:bg-gray-{50,100}    → hover:bg-editor-hover
```

## 아이콘

- **lucide-react v0.400.0** 만 사용. phosphor-icons 등 다른 라이브러리 추가 금지.
- `sideEffects: false` 자동 tree-shake. 79개 named import (트랙 N 검증).

## 단축키 등록 시

- `KeyboardShortcutsModal.tsx` 카탈로그(GROUPS 배열)에 항목 추가
- `CommandPaletteModal.tsx` `buildActions()` 에도 액션 추가 (검색 가능하게)
- 입력 필드 포커스 중 무시: `target.tagName === 'INPUT' || 'TEXTAREA' || 'SELECT' || target.isContentEditable`

## 토스트

- `import { showToast } from '@/stores/useToastStore'`
- `showToast(message, 'success' | 'error' | 'info' | 'warning', durationMs?)` — duration 기본 3500ms, 0이면 수동 닫기 전용

## 단축키 — 등록된 것 (확인 사항)

| 단축키 | 작동 |
|---|---|
| ⌘+S | 편집완료 (저장) |
| ⌘+Z / ⌘+⇧+Z | undo / redo |
| ⌘+C / V / D | 복사 / 붙여넣기 / 복제 (CopyPlugin) |
| ⌘+G / ⌘+⌫ | 그룹 / 그룹해제 (GroupPlugin) |
| ⌘+L | 잠금 토글 (LockPlugin) |
| Delete / Backspace | 삭제 |
| 화살표 | 1px 이동 |
| `[` / `]` | z-index 1단계 |
| ⌘+`[` / `]` | z-index 끝까지 |
| `i` | 스포이드 |
| ⌘+\\ | 사이드바 토글 |
| ⌘+K | 커맨드 팔레트 |
| `?` | 단축키 도움말 |

## 디자인 가이드

- **인쇄 영역(워크스페이스 흰 페이지)**은 다크 모드에서도 흰색 유지 (인쇄용지 = 흰색)
- 캔버스 chrome (헤더/툴바/사이드바/패널)만 다크 토큰 적용
- 캔버스 내부 fabric 객체(룰러/선택 핸들 등)는 다크 호환 미완 — Phase 3에서

## 컴포넌트 추가 패턴

- **자체 모달**: `KeyboardShortcutsModal` / `CommandPaletteModal` 패턴 참고 (백드롭 + ESC + z-index 200~210)
- **새 store**: `useUiPrefStore`처럼 zustand + persist + version 마이그레이션. 새 필드 추가 시 version 증가 + migrate 함수에 if-block 추가 (현재 v7)
- **HMR 안전**: useEffect deps에서 useCallback이 정의되기 전 참조하면 TDZ 에러 — useEffect를 useCallback 정의 후로 이동 (트랙 F에서 학습)

# 검증 흐름

1. 코드 변경 후 **preview reload**: `mcp__Claude_Preview__preview_eval` `window.location.reload(); 'reloading'`
2. **콘솔 에러 확인**: `mcp__Claude_Preview__preview_console_logs` (level: 'error'). FontManager/dispose 에러는 기존 — 무시. 내 변경 관련 에러만 추적.
3. **DOM 검증**: `preview_eval`로 selector + getComputedStyle / aria-label 확인
4. **시각 검증**: `mcp__Claude_Preview__preview_screenshot`
5. **반응형**: `mcp__Claude_Preview__preview_resize` (mobile 375x812 / tablet 768x1024 / desktop 1280)
6. **다크 모드**: `useUiPrefStore.getState().setTheme('dark')` 또는 헤더 Sun/Moon 버튼

# 커밋·배포 흐름

```bash
git add <files>
git commit -m "feat(editor): 트랙 X — 짧은 주제

상세 변경 사항 (3-5줄)

검증 결과 (체크리스트)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin master   # → Vercel 자동 배포
```

- 미커밋 untracked 파일은 의도적 제외 (빌드 산출물·로컬 설정·사용자 메모)
- 1 트랙 = 1 커밋 (가능하면). K 같이 명시적으로 묶인 다중 변경은 1 커밋
- 문서 갱신은 마지막에 별도 docs 커밋

# 향후 작업 후보 (우선순위 — 단일 진실 표는 `docs/REMAINING_WORK_REVIEW.md`)

## 🔴 P0 (즉시 — 운영 blocker / 사용자 책임)

| # | 항목 | 상태 |
|---|---|---|
| 1 | 운영 DB 마이그레이션 | ✅ **2026-05-01 23:33 KST 적용** (옵션 C + BB-Phase 3 마이그 2건) |
| 2 | **모바일/PC 실기기 검증** | ✅ **2026-05-02 사용자 보고 4건 + 콘솔 보고 3건 모두 핫픽스 처리** — Vercel CDN cache + 배경색 적용(v2) + SVG 업로드 freeze(v2) + 요소 raster 허용 + 모바일 4MB 가드 + unhandledrejection handler. 사용자 추가 시나리오 검증 시 즉시 대응 |
| 3 | 사전 type 에러 정리 | ✅ 9건 정리(`8820066`) + 12건 follow-up(`d1d78fc`, P1-3) — `pnpm tsc --noEmit` clean |
| 4 | 시점별 복원 UI | ✅ commit `0b7cc23` (confirm + auto reload + 운영 배포) |

## 🟡 P1 (단기 — 사용자 가치 큼)

- ✅ **DD-5-B-v2 페이지 drag-to-reorder** — 완료 (`aff4396`, native HTML5 DnD + 표지/모바일/스프레드 가드)
- ✅ **잔여 type 에러 follow-up** — 완료 (`d1d78fc`, embed/test/graphql + AiPanel TemplateSetType cascading)
- ✅ **BB-Phase 3 follow-up 썸네일 풀스택** — 완료 (`4901af9` + `2097e1c` + `9d67d8c`, R2 없이 로컬 FS, deletion-time + nightly cron KST 02:30)
- ✅ **3b-v Phase 3 다중 선택 cross-canvas 이동** — 완료 (`3d05608`, `MoveToCoverRegion` 루프 + `count` undo)
- ✅ **PDF Synthesis E2E 검증** — 완료 (`d2b3271`, webhook 타입 정합 + `separate` 모드 TC)
- **PHP 측 코드 적용 검증** — 옵션 B/C URL override + 웹훅 콜백 양측 통합 테스트 (`docs/PHP_INTEGRATION_VERIFICATION.md` 참조)
- ✅ **반응형 Phase 3** — 완료 (`5339e9d`, 태블릿 세로 drawer overlay 모드)
- ✅ **콘텐츠 패널 그리드 카탈로그** — 완료 (`d47a680`, AppElement/AppBackground/AppTemplate 카테고리 탭)
- ✅ **모바일 헤더 overflow X-3** — 완료 (`9a0aac7`, 375px nav overflow 해소)
- ✅ **저장/불러오기 흐름 E2E 검증** — 완료 (`9e8f4e5`, 멀티페이지 canvasData round-trip 수정)

## 🟢 P2 (중기 — 폴리시 / 확장)

- **fabric 객체 색상 다크모드 통일** — 현재 desktop 핸들만 적용, 모바일은 fabric default 유지 정책
- **CC-Phase 3** — multi-select cross-region 정밀 매핑
- **AI 패널 정합** (AI 도구 메뉴 + 패널 통합)
- **번들 크기 최적화** (vendor-opencv lazy-load 강화)
- **Playwright E2E 시나리오 작성**
- **Sentry/Datadog 에러 추적 연결**
- **폰트 fallback 로그 정리** — "본고딕(Noto Sans) Regular" 미찾음 경고를 fontList에 sans-serif fallback 등록으로 silent 처리
- **WebAssembly multi-threading** — `crossOriginIsolated` 활성화로 OpenCV 멀티스레드 (현재 single-thread fallback, 동작은 함)
- **canvas-core fileToImage SVG 진입 차단** — 현재 useImageStore 단에서 isSvgFile 분기. canvas-core 단에서도 명시 차단하면 외부 호출 안전

## ⚠️ 모바일 / 안전성 메모

- **iOS Safari 메모리 한계 ~384MB** — fabric retina(DPR 3 = 9x 픽셀) backing store 매우 비쌈
- 새 코드 작성 시 모바일 가드 필수: `canvas.renderAll()`(sync) 대신 `canvas.requestRenderAll()`(async, frame skip), `updateObjects()`는 selection 관련일 때만, 모든 객체 순회는 `TOUCH_ENV` 가드(`useAppStore.ts:184` 또는 `useCanvasThemeSync.ts` 참고)
- 운영 데이터 0건 상태(컷오버 전) — 큰 변경 적용에 매우 안전
- 모바일은 PR #5 `EditorErrorBoundary` + `useCanvasLocalBackup`로 크래시 시 자동 복구 — 새 흐름 추가 시 호환 확인

# 첫 동작 권장

새 세션 시작 시 가장 먼저 할 것:
1. 이 프롬프트를 첫 메시지로 입력 (= 사용자가 한 행위)
2. **응답으로**: `editor_layout_custom.md` §6.0의 "후속 트랙 A~T 누적 요약" 표 확인. `cover.md §7-8` 확인.
3. 사용자가 어떤 트랙을 진행할지 결정할 때까지 대기.
4. preview 서버 가동 확인: `mcp__Claude_Preview__preview_list` 또는 `preview_start name="editor"`

오토파일럿 모드면 사용자가 우선순위 + 범위만 알려주면 위 컨벤션 그대로 진행. 작은 트랙은 1 커밋으로 묶고, canvas-core 변경 필요한 큰 작업은 빌드 단계 명시.

# 주의·금기

- ❌ canvas-core src 변경 시 `tsc` 빌드 안 하고 commit (editor가 dist를 import하므로 src 변경만으론 반영 안 됨)
- ❌ 하드코딩 그레이 사용 (다크 모드 깨짐)
- ❌ phosphor-icons 같은 다른 아이콘 라이브러리 추가
- ❌ `git push --force` 또는 `git reset --hard` 무단 사용
- ❌ vite 빌드 산출물(`vite.config.d.ts/.js`) commit
- ⚠️ HMR 환경에서 dual store instance 가능 — preview 검증 시 결과가 의외면 `window.location.reload()` 후 재시도
- ⚠️ React onBlur는 dispatchEvent('blur')로 트리거 어려움 — 자동 검증 한계 인지 (실 사용자 환경에서는 정상)

---

**문서 끝**. 새 트랙 추가 시 §"누적 트랙" 표 + §"향후 작업 후보" 섹션 갱신 + (선택) `editor_layout_custom.md` §6.0 표도 함께 갱신할 것.
