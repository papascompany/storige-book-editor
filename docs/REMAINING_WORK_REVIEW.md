# Storige 잔존 개발 작업 리뷰

> **기준일**: 2026-05-02 · **최종 갱신**: 2026-05-02 (P1 전 트랙 완료 — G/C/F/E/D/B 6개 트랙 반영)
> **반영 누적**: 92+ commit / 53 트랙 (4차 사이클 + 모바일 PR×10 + 5차 P0 + DD-5-B-v2 + P1-3 + BB-Phase 3 follow-up + cleanup cron + 6차 P0 핫픽스 사이클 + P1 전 트랙 + PHP 연동 검증 MD)
>
> **소스 트래커**: `.cursor/plans/_RESUME_EDITOR_TRACKS.md`, `.cursor/plans/cover.md`, `.cursor/plans/v2/NEW_DEV_GUIDE.html`, `docs/P0_OPERATIONS_CHECKLIST.md`, `docs/MOBILE_TOUCH_UI.md`, `docs/BOOKMOA_INTEGRATION_DIFF.md`

---

## A. 카테고리별 잔존 작업

### 1. 모바일 / 터치 UI/UX
| 항목 | 상태 | 우선순위 |
|---|---|---|
| 1차 터치 패치 (`touch-action`, viewport, hit-area) | ✅ PR #1 | — |
| ResizeObserver 무한 루프 차단 | ✅ PR #1 | — |
| 텍스트 선택 즉시 해제 / 메모리 폭발 | ✅ PR #2 | — |
| ControlBar collapsible + retina off | ✅ PR #3 | — |
| 썸네일 스킵 + 히스토리 축소 | ✅ PR #4 | — |
| ErrorBoundary + localStorage 백업 | ✅ PR #5 | — |
| iOS Safari 페이지 크래시 회피 (배경색 + 다크 핸들) | ✅ `60efb05` | — |
| 모바일 4MB 업로드 가드 + toast 안내 | ✅ `5228171` (6차 P0 #2) | — |
| **실기기 검증 (사용자 보고 4건 + 콘솔 보고 3건)** | ✅ **6차 P0 핫픽스 사이클로 모두 처리** | — |
| 모바일 헤더 X-3 (viewport 375 nav overflow) | ✅ `9a0aac7` | — |
| 핀치-투-줌 / 두 손가락 패닝 | ❌ | P3 |
| iText 인라인 편집 시 visualViewport 보정 | ❌ | P3 |
| 모바일용 long-press 컨텍스트 메뉴 | ❌ | P3 |

### 2. 표지 편집 (Cover Edit) — Phase 3b 로드맵 (`cover.md`)
| 단계 | 내용 | 상태 |
|---|---|---|
| 3b-i | useCoverRegion 훅 인프라 | ✅ |
| 3b-ii | 객체 추가 시 region 메타 자동 부여 | ✅ |
| 3b-iii | object:modified 시 region 메타 갱신 (히스테리시스) | ✅ |
| 3b-iv | 책등 가변 시 이탈 객체 toast | ✅ |
| 3b-v | Composite cross-canvas 이동 | ✅ (CC-1/CC-2) |
| 3b-v Ph2A | 정밀 좌표 매핑 (xNorm/yNorm) | ✅ |
| 3b-v Ph2B | atomic undo "방금 이동 되돌리기" | ✅ |
| **3b-v Ph3** | **다중 선택 cross-canvas 이동** | ✅ `3d05608` |

### 3. 다크 모드 / 반응형
| Phase | 내용 | 상태 |
|---|---|---|
| 다크 P1~P3 (chrome / tools / 룰러) | ✅ 트랙 D-1, D-2v1/v2, W | — |
| **fabric 객체 색상 통일** (모든 객체 hover/selection) | ⚠️ 부분 | P2 |
| 반응형 P1 (사이드바 슬라이드오버) | ✅ E-1 | — |
| 반응형 P2 (사이드바 hit-area, 페이지 네비) | ✅ X | — |
| **반응형 P3** (태블릿 세로 drawer) | ✅ `5339e9d` | — |

### 4. 도구 확장
| 항목 | 상태 |
|---|---|
| 색상 LRU + quick swatches + 그라디언트 (linear/angle/radial) | ✅ I/R/AA/DD-3 |
| Shift+화살표 nudge | ✅ Y |
| 정렬 6버튼 + 분포 | ✅ L/T |
| 자동 저장 + 버전 관리 풀 스택 | ✅ BB-Phase 3 |
| 시점별 복원 UI (confirm + auto reload) | ✅ `0b7cc23` (P0-4) |
| 시점 썸네일 풀 스택 (캡처/업로드/HistoryPanel mini + hover preview) | ✅ `4901af9` (BB-Phase 3 follow-up) |
| 시점 썸네일 cleanup cron (deletion-time + nightly KST 02:30) | ✅ `2097e1c` + `9d67d8c` |
| 페이지 drag-to-reorder UI (BookNavigation native HTML5 DnD) | ✅ `aff4396` (DD-5-B-v2) |
| 배경색/뚜껑색 명시적 "적용" 버튼 + fresh fetch | ✅ `5228171` + `0c0e8aa` |
| **다중 선택 floating action bar** | ❌ | P3 |

### 5. 카탈로그 / 콘텐츠 / AI
| 항목 | 상태 | 우선순위 |
|---|---|---|
| CommandPalette + ★ 즐겨찾기 | ✅ DD-4 | — |
| 페이지 순서 재배열 (store) | ✅ DD-5-A | — |
| 페이지 순서 재배열 UI (DD-5-B-v2) | ✅ `aff4396` | — |
| AI 패널 TemplateSetType 정합 (4 cascading 컴포넌트) | ✅ `d1d78fc` (P1-3) | — |
| **콘텐츠 패널 그리드 카탈로그** (카테고리 탭) | ✅ `d47a680` | — |
| **AI 패널 정합 / 추천** (UI 통합) | ❌ | P3 |

### 6. 북모아 PHP 통합 (옵션 B/C)
| 항목 | 상태 |
|---|---|
| 변경점 정리 MD + HTML 시각화 | ✅ PR #6 |
| 옵션 B (`size` sizeno) 가이드 보강 | ✅ PR #6 |
| 옵션 C (`width/height` URL + Admin 토글) 풀스택 | ✅ PR #6 |
| Migration SQL + 신규 init.sql | ✅ PR #7 |
| 운영 DB ALTER TABLE 적용 (옵션 C + edit_session_versions) | ✅ **2026-05-01 23:33 KST 적용 완료** |
| 운영 api/worker 재배포 (BB-Phase 3 + 썸네일 풀스택 + cleanup cron) | ✅ **2026-05-02 12:37 + 13:02 KST** |
| **PHP 측 코드 적용 검증** (양측 통합 테스트) | ⏳ **P1** |
| BB-Phase 3 follow-up (썸네일 / cleanup cron) | ✅ `4901af9` + `2097e1c` + `9d67d8c` |

### 7. PDF / 워커
| 항목 | 상태 | 우선순위 |
|---|---|---|
| PDF 검증 모듈 (워커 큐, 3 endpoints) | ✅ | — |
| **PDF Synthesis E2E 검증** (webhook 타입 정합) | ✅ `d2b3271` | — |
| **Before/After 미리보기** | ⏳ | P1 |
| 웹훅 콜백 처리 (`synthesis.completed/failed`) | ✅ Storige 측 / ⏳ PHP 측 | P0 |

### 8. 인프라 / 품질
| 항목 | 상태 | 우선순위 |
|---|---|---|
| 단위/통합/컴포넌트/플러그인 테스트 | ✅ 376 통과 | — |
| Playwright E2E | ⚠️ 설정만 | P2 |
| 사전 존재 type 에러 (9 + 12 = 21건) 정리 | ✅ `8820066` (P0-3, 9건) + `d1d78fc` (P1-3, 12 + cascading 4건). `pnpm tsc --noEmit` clean | — |
| Vercel CDN HTML cache fix (`Importing a module script failed` 방지) | ✅ `5228171` (vercel.json headers + ae59bf2 schema 거부 정정) | — |
| `unhandledrejection` global handler (React 트리 freeze 방지) | ✅ `0c0e8aa` (main.tsx) | — |
| 신규 의존성 `@nestjs/schedule@^4.0.0` 운영 적용 (cleanup cron 기반) | ✅ docker compose --build api 자동 처리 | — |
| **사전 존재 lint 에러 정리** (admin/process, canvas-core/getComputedStyle, ai/no-case-declarations, editor/no-empty, worker/no-useless-escape) | ⏳ | P2 |
| 번들 크기 최적화 (vendor-opencv 10MB, vendor-onnx 24MB) | ❌ | P2 |
| Sentry/Datadog 등 에러 추적 | ❌ | P2 |
| 폰트 fallback 로그 정리 (본고딕 미찾음 경고) | ❌ | P2 |
| WebAssembly multi-threading (`crossOriginIsolated`) | ❌ | P2 |

---

## B. 우선순위 분류

### 🔴 P0 (즉시 — 운영 blocker) — 2026-05-02 현황 (모두 종료)

| ID | 항목 | 상태 | 비고 |
|---|---|---|---|
| **P0-1** | 운영 DB 마이그레이션 (`edit_session_versions` + 옵션 C) | ✅ **완료** | 2026-05-01 23:33 KST. FK COLLATE fix `ce082ef` 포함 |
| **P0-2** | 모바일/PC 실기기 검증 | ✅ **완료** | 사용자 보고 4건 + 콘솔 보고 3건 → 6차 P0 핫픽스 사이클로 모두 처리 (`5228171` `819008d` `982f944` `0c0e8aa`) |
| **P0-3** | 사전 type 에러 9 + 12건 정리 | ✅ 완료 | `8820066` + `d1d78fc` (P1-3) — `pnpm tsc --noEmit` clean |
| **P0-4** | 시점별 복원 UI confirm + auto reload | ✅ 완료 | `0b7cc23` (HistoryPanel) |
| **부수 1** | 운영 api/worker 재배포 (1차) | ✅ 완료 | 2026-05-01 23:33 — git pull 89 commits + `docker compose up -d --build api worker` (4m28s) |
| **부수 2** | 운영 api/worker 재배포 (2차) | ✅ 완료 | 2026-05-02 12:37 — 6 commits 적용 (BB-Phase 3 풀스택 + cleanup cron 활성화 검증) |
| **부수 3** | 운영 api 재기동 (cron TZ fix) | ✅ 완료 | 2026-05-02 13:02 — `9d67d8c` UTC 17:30 = KST 02:30 |
| **부수 4** | iOS Safari 페이지 크래시 fix | ✅ 완료 | `60efb05` — `requestRenderAll` + TOUCH_ENV 가드 |
| **부수 5** | Vercel HTML cache fix | ✅ 완료 | `5228171` — `vercel.json` no-store headers + `/assets/*` immutable |
| **부수 6** | `unhandledrejection` handler | ✅ 완료 | `0c0e8aa` — React 트리 freeze 방지 |

### 🟡 P1 (단기 — 사용자 가치 큼)
1. ✅ **DD-5-B-v2 페이지 drag-to-reorder** — 완료 (`aff4396`)
2. ✅ **잔여 type 에러 정리** — 완료 (`d1d78fc`)
3. ✅ **BB-Phase 3 follow-up 썸네일 풀스택 + cleanup cron** — 완료 (`4901af9` + `2097e1c` + `9d67d8c`)
4. ✅ **Composite 모드 다중 선택 cross-canvas 이동** (3b-v Ph3) — 완료 (`3d05608`)
5. ✅ **PDF Synthesis E2E 검증** — 완료 (`d2b3271`, webhook 타입 정합)
6. **PHP 측 코드 적용 검증** — width/height + 웹훅 콜백 양측 통합 테스트
7. ✅ **반응형 Ph3** — 완료 (`5339e9d`, 태블릿 세로 drawer)
8. ✅ **콘텐츠 패널 그리드 카탈로그** — 완료 (`d47a680`, 카테고리 탭 추가)
9. ✅ **저장/불러오기 흐름 E2E 검증** — 완료 (`9e8f4e5`, 멀티페이지 canvasData 완전 보존)
10. ✅ **모바일 헤더 X-3** — 완료 (`9a0aac7`, 375px nav overflow 해소)

### 🟢 P2 (중기 — 폴리시 / 확장)
11. fabric 객체 색상 다크모드 통일
12. 정밀 좌표 매핑 향상 (multi-select cross-region)
13. AI 패널 정합
14. 번들 크기 최적화 (vendor-opencv lazy-load 강화)
15. Playwright E2E 시나리오 작성
16. Sentry/Datadog 에러 추적 연결
17. canvas-core `fileToImage` SVG 명시 차단 (현재 useImageStore 단에서 가드)
18. 폰트 fallback 로그 silent 처리
19. WebAssembly multi-threading 활성화 (`crossOriginIsolated`)
20. 사전 존재 lint 에러 정리

### 🟣 P3 (장기 / 선택)
17. 캔버스 핀치-투-줌 / 두 손가락 패닝
18. iText 인라인 편집 시 visualViewport 보정
19. 모바일 long-press 컨텍스트 메뉴
20. 멀티 선택 floating action bar

---

## C. 이번 세션 후속 권장 (구체 액션)

### 1. 북모아 옵션 C 운영 적용
```bash
# 1) production DB 에 컬럼 추가
mysql -h <DB_HOST> -P <DB_PORT> -u <DB_USER> -p storige \
  < apps/api/migrations/20260501_add_products_allowCustomSize.sql

# 2) 검증
mysql> SHOW COLUMNS FROM products LIKE 'allowCustomSize';

# 3) Admin → 상품 편집 → "외부 쇼핑몰 사이즈 override 허용" 활성화

# 4) PHP 측 URL 생성 코드에 ?width=<mm>&height=<mm> 추가
```

### 2. 모바일 실기기 체크리스트 (`docs/MOBILE_TOUCH_UI.md` §5 참조)
- [ ] 텍스트/이미지/요소 추가 → 사이드바 자동 닫기 → 즉시 선택
- [ ] 5회 이상 연속 탭 → 멈춤/크래시 없음
- [ ] 코너 핸들로 리사이즈 (touchCornerSize=36)
- [ ] localStorage 백업 (`storige.editor.backup.*`) 5초 주기 생성
- [ ] WebContent 강제 종료 후 reload → 작업 회복
- [ ] iOS Safari "이 사이트에서 문제가 반복적으로" 메시지 안 뜸

### 3. 사전 존재 type/lint 에러 정리 PR (별도 작업)
```
대상:
- apps/editor/src/test/setup.ts — vitest types
- packages/types — EditPage.name 추가
- packages/canvas-core — SpreadRegion / moveObjectToCanvas export
- apps/editor/src/embed.tsx — 중복 export
- apps/api/src/worker-jobs/worker-jobs.service.ts:826 — SynthesisWebhookPayload
- apps/admin/vite.config.ts — eslint-env node
- apps/worker — 정규식 escape 정리

검증: pnpm -r typecheck && pnpm -r lint && pnpm -r test
```

### 4. 시점별 복원 UI 추가
```
백엔드: edit-session-version.entity 와 GET/POST endpoints 이미 존재
프론트: HistoryPanel 에 "버전 목록" 탭 + 복원 버튼 + confirm 다이얼로그

작업량: 3~4시간
파일: apps/editor/src/components/editor/HistoryPanel.tsx
     apps/editor/src/api/sessions.ts (versions endpoints 호출 추가)
```

---

## D. 진척률 (2026-05-02 14:00 KST 갱신)

| 카테고리 | 완료 | 진행중/잔존 | 합계 |
|---|---|---|---|
| 모바일/터치 | 9 | 4 | 13 |
| 표지 편집 | 7 | 1 | 8 |
| 다크/반응형 | 6 | 2 | 8 |
| 도구 확장 | 11 | 1 | 12 |
| 카탈로그/AI | 4 | 2 | 6 |
| 통합 (북모아) | 7 | 1 | 8 |
| PDF/워커 | 2 | 3 | 5 |
| 인프라/품질 | 8 | 6 | 14 |
| **합계** | **54** | **20** | **74** |

**완료 비율: 약 73%** (실효 기능은 ~88% — 운영 적용 + 핫픽스 사이클 종료. P1 잔존은 다중 선택 cross-canvas / PDF Synthesis 검증 / PHP 통합 / 반응형 Ph3 / 콘텐츠 카탈로그 / 저장 E2E)

> **2026-05-02 14:00 KST 갱신 노트**: 6차 P0 핫픽스 사이클 + DD-5-B-v2 + P1-3 type cleanup + BB-Phase 3 follow-up + cleanup cron 모두 반영. 운영 재배포 2회 완료. 사용자 보고 4건 + 콘솔 보고 3건 모두 처리. 다음 사이클 진입 가능.

---

## E. 다음 1~2주 권장 sprint (2026-05-02 갱신)

| Day | 작업 | 상태 |
|---|---|---|
| ~~Day 1~~ | ~~P0-1: 운영 DB migration~~ | ✅ 2026-05-01 완료 |
| ~~Day 1~~ | ~~P0-3: type 에러 정리~~ | ✅ `8820066` + `d1d78fc` |
| ~~Day 2~~ | ~~P0-2: 모바일 실기기 검증~~ | ✅ 6차 P0 핫픽스 사이클 |
| ~~Day 3~~ | ~~P0-4: 시점별 복원 UI~~ | ✅ `0b7cc23` |
| **Day 1** | **P1: PHP 측 통합 테스트** (width/height + 웹훅) | ⏳ 사용자 영역 |
| **Day 2** | **P1: PDF Synthesis E2E** (`POST /synthesize/external`) | ⏳ |
| **Day 3** | **P1: 저장/불러오기 E2E** (sessionId 환경 라운드트립) | ⏳ |
| **Day 4~5** | **P1: Composite Ph3** (multi-select cross-canvas) | ⏳ |
| **Day 6~7** | **P1: 콘텐츠 그리드 카탈로그** | ⏳ |
| **Day 8~10** | **P1: 반응형 Ph3 + 모바일 X-3 + P2 폴리시** | ⏳ |

---

## F. 관련 문서

- [`.cursor/plans/_RESUME_EDITOR_TRACKS.md`](../.cursor/plans/_RESUME_EDITOR_TRACKS.md) — 트랙별 누적 정리
- [`.cursor/plans/cover.md`](../.cursor/plans/cover.md) — 표지 편집 Phase 로드맵
- [`docs/IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md) — 전체 구현 상태
- [`docs/PRD.md`](./PRD.md) — 제품 요구사항
- [`docs/MOBILE_TOUCH_UI.md`](./MOBILE_TOUCH_UI.md) — 모바일 UX 가이드 (본 세션)
- [`docs/EDITOR_OBJECT_EDITING_SPEC.md`](./EDITOR_OBJECT_EDITING_SPEC.md) — 객체 편집 명세 (본 세션)
- [`docs/BOOKMOA_INTEGRATION_DIFF.md`](./BOOKMOA_INTEGRATION_DIFF.md) — 북모아 PHP 연동 변경점 (본 세션)
- [`apps/api/migrations/README.md`](../apps/api/migrations/README.md) — DB 마이그레이션 가이드
