# Storige Editor 프론트엔드 트랙 — 새 세션 RESUME 프롬프트

> **사용법**: 새 Claude Code 세션을 열고 아래 "복사용 프롬프트" 블록 전체(line 13 이후)를 첫 메시지로 붙여넣으세요.
> 이 문서는 지우지 말고 보관하세요. 새 트랙이 추가될 때 §"누적 트랙" + §"향후 작업 후보" 두 곳을 갱신하면 됩니다.
>
> **버전**: v2 (2026-05-02) — 누적 트랙 0~CC + 모바일 PR + 5차 P0 사이클 완료 + 운영 적용까지 반영.
> **이전 가이드**: `_RESUME_PROMPT.md` (인프라·PHP·운영 컷오버 작업용 — 별도 흐름)

---

## 복사용 프롬프트 (이 줄 아래부터 끝까지 복사)

[Storige Editor 트랙 재개 — 2026-05-02 기준 / master `60efb05` / 운영 배포 완료]

# 한 줄 요약

`apps/editor`(React + Vite + Fabric.js + Zustand + TailwindCSS) 41 트랙 + 모바일 27 commit + P0 5 commit = **누적 73+ commit**, Vercel 자동 배포 + **운영 VPS 재배포 완료**(2026-05-01). DB 마이그 2건 운영 적용(`products.allowCustomSize` + `edit_session_versions` LRU 20). 다음 후보는 P0-2 모바일 실기기 검증(사용자 작업), P1 트랙(다중 cross-canvas 이동/PDF Synthesis 검증/콘텐츠 카탈로그/반응형 Phase 3) 또는 잔여 type 에러 follow-up PR. 작업 컨벤션·디자인 토큰·검증 흐름·운영 배포 절차 모두 정착됨.

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

# 누적 트랙 — 2026-05-02 (master `60efb05`, origin/master 반영 + 운영 배포 완료)

> 트랙 0~T(23 커밋) — 1차 폴리싱 사이클 완료
> 트랙 U~BB(7 커밋) — 2차 사이클 (D5 Phase 3b 마무리, 다크 Phase 3, 반응형 Phase 2, 그라디언트, 스냅샷 list)
> 트랙 CC-1/CC-2(2 커밋) — 3차: D5 Phase 3b-v Composite cross-canvas 객체 이동
> 트랙 CC-Phase 2A/B + DD-3/4/5-A + BB-Phase 3(7 커밋) — 4차: 정밀 좌표 매핑 + 그라디언트 angle/radial + ★ 즐겨찾기 + 페이지 reorder 인프라 + 백엔드 versions 풀 스택
> **모바일 사이클 — PR #1~#10(27 커밋, `d341af7 → da82764`)** — 모바일 터치 UI 전반 / ResizeObserver 차단 / 메모리 폭발 v3 / ErrorBoundary + localStorage 백업 / 옵션 B/C 풀스택 + 마이그 SQL / 잔존 작업 종합 리뷰
> **5차 P0 사이클(5 커밋, `0b7cc23 → 60efb05`)** — P0-4 시점별 복원 UI(confirm + auto reload) / P0-3 사전 type 에러 9건 정리 / P0-1·P0-2 운영 가이드 + BB-Phase 3 마이그 SQL / 마이그 FK COLLATE 보정 / **모바일 페이지 크래시 fix(배경색 + 다크 핸들)**
> **운영 적용 (2026-05-01 23:33~23:39 KST)**: DB 마이그 2건 적용(`products.allowCustomSize` + `edit_session_versions` LRU 20) + git pull(89 commit) + docker compose up -d --build api worker 완료 + endpoint 검증 (BB-Phase 3 활성화)
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
| **P1-3** | (이번 트랙) | 잔여 type 에러 12건 + cascading 4건 정리 — embed.tsx (templateSet `.data` 폴백 제거 + safeSize 키 제거 + 중복 `export type` 제거), useEditorStore.test.ts (EditPage `name` 필드 미존재 → `sortOrder`로 교체, `editable` 제거), AppElement.tsx (graphql codegen vs @storige/types EditorContent 불일치 → `as unknown as` 캐스팅 + 주석), AiPanel/RecommendationPanel/GenerationPanel/LazyAiPanel (`'book' \| 'leaflet'` 문자열 union → `TemplateSetType` enum 통일). `pnpm tsc --noEmit` clean 0 errors |

# 코드베이스 컨벤션 (트랙 진행하며 정착됨)

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
| 1 | 운영 DB 마이그레이션 | ✅ **2026-05-01 23:33 KST 적용 완료** (옵션 C + BB-Phase 3 마이그 2건, 23→24 테이블, 데이터 0건이라 매우 안전) |
| 2 | **모바일 실기기 검증** | ⏳ **사용자 실기기 필요** — `docs/P0_OPERATIONS_CHECKLIST.md` §P0-2 8 시나리오 체크리스트 + 새로 추가된 commit `60efb05`(iOS Safari 페이지 크래시 fix) 검증 우선 |
| 3 | 사전 type 에러 정리 | ✅ 9건 정리(commit `8820066`), 12건 follow-up PR 권장(embed/test/graphql codegen) |
| 4 | 시점별 복원 UI | ✅ commit `0b7cc23` (confirm + auto reload + 운영 배포) |

## 🟡 P1 (단기 — 사용자 가치 큼)

- **3b-v Phase 3 다중 선택 cross-canvas 이동** — 우리 `moveObjectToCanvas` helper + `MoveToCoverRegion` 패턴 확장. canvas-core 추가 변경
- **PDF Synthesis 본 워커 동작 검증** — `POST /synthesize/external` end-to-end. 운영 worker 이미 재배포됨, 실 PDF 흐름 검증 필요
- **PHP 측 코드 적용 검증** — 옵션 B/C URL override + 웹훅 콜백 양측 통합 테스트
- **반응형 Phase 3** — 태블릿 세로 모드 drawer 최적화
- **콘텐츠 패널 그리드 카탈로그** — 미리캔버스 풍 카테고리 탭 + 그리드
- **모바일 헤더 overflow X-3** — viewport 375에서 nav 가로 197px overflow (현 모바일 fix와 별개로 잔존, 우선순위 P1로 승격 검토)

## 🟢 P2 (중기 — 폴리시 / 확장)

- ~~**DD-5-B-v2**~~ ✅ 완료 — 페이지 drag-to-reorder UI (BookNavigation native HTML5 DnD + 표지/모바일/스프레드 가드)
- **fabric 객체 색상 다크모드 통일** — 현재 desktop 핸들만 적용, 모바일은 fabric default 유지 정책
- **CC-Phase 3** — multi-select cross-region 정밀 매핑
- **AI 패널 정합** (AI 도구 메뉴 + 패널 통합)
- **번들 크기 최적화** (vendor-opencv lazy-load 강화)
- **Playwright E2E 시나리오 작성**
- **Sentry/Datadog 에러 추적 연결**
- ~~**잔여 type 에러 12건 follow-up PR**~~ ✅ 완료 — embed/test/graphql + AiPanel cascading 정리 (tsc clean)
- **BB-Phase 3 follow-up** — 시점 썸네일 자동 생성(R2 업로드) + hover 미리보기

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
