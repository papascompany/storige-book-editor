# Storige 잔존 개발 작업 리뷰

> **기준일**: 2026-05-01
> **반영 누적**: 41 commit / 37 트랙 (4차 사이클까지) + 본 세션 PR #1~#9 (모바일 터치 UI + 북모아 PHP 옵션 B/C)
>
> **소스 트래커**: `.cursor/plans/_RESUME_EDITOR_TRACKS.md`, `.cursor/plans/cover.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/PRD.md`, `docs/PHASE*_COMPLETE.md`, 본 세션 산출물 `docs/MOBILE_TOUCH_UI.md` / `docs/BOOKMOA_INTEGRATION_DIFF.md`

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
| **실기기 전수 검증** | ⏳ 보류 | **P0** |
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
| **3b-v Ph3** | **다중 선택 cross-canvas 이동** | ⏳ **P1** |

### 3. 다크 모드 / 반응형
| Phase | 내용 | 상태 |
|---|---|---|
| 다크 P1~P3 (chrome / tools / 룰러) | ✅ 트랙 D-1, D-2v1/v2, W | — |
| **fabric 객체 색상 통일** (모든 객체 hover/selection) | ⚠️ 부분 | P2 |
| 반응형 P1 (사이드바 슬라이드오버) | ✅ E-1 | — |
| 반응형 P2 (사이드바 hit-area, 페이지 네비) | ✅ X | — |
| **반응형 P3** (태블릿 헤더 wrap, 세로 모드 drawer) | ⏳ | P2 |

### 4. 도구 확장
| 항목 | 상태 |
|---|---|
| 색상 LRU + quick swatches + 그라디언트 (linear/angle/radial) | ✅ I/R/AA/DD-3 |
| Shift+화살표 nudge | ✅ Y |
| 정렬 6버튼 + 분포 | ✅ L/T |
| 자동 저장 + 버전 관리 풀 스택 | ✅ BB-Phase 3 |
| **시점별 복원 UI** (백엔드 API ✅, 클릭→confirm→restore UI 만 남음) | ⏳ **P1** |
| **다중 선택 floating action bar** | ❌ | P3 |

### 5. 카탈로그 / 콘텐츠 / AI
| 항목 | 상태 | 우선순위 |
|---|---|---|
| CommandPalette + ★ 즐겨찾기 | ✅ DD-4 | — |
| 페이지 순서 재배열 (store) | ✅ DD-5-A | — |
| **DD-5-B-v2** (페이지 순서 UI 재구현) | ⏳ | P2 |
| **콘텐츠 패널 그리드 카탈로그** (카테고리 탭) | ❌ | P2 |
| **AI 패널 정합 / 추천** | ❌ | P3 |

### 6. 북모아 PHP 통합 (옵션 B/C)
| 항목 | 상태 |
|---|---|
| 변경점 정리 MD + HTML 시각화 | ✅ PR #6 |
| 옵션 B (`size` sizeno) 가이드 보강 | ✅ PR #6 |
| 옵션 C (`width/height` URL + Admin 토글) 풀스택 | ✅ PR #6 |
| Migration SQL + 신규 init.sql | ✅ PR #7 |
| **운영 DB ALTER TABLE 적용** | ⏳ **P0** (production synchronize=false) |
| **PHP 측 코드 적용 검증** (양측 통합 테스트) | ⏳ **P0** |
| BB-Phase 3 follow-up (썸네일 / 마이그레이션) | ⏳ | P2 |

### 7. PDF / 워커
| 항목 | 상태 | 우선순위 |
|---|---|---|
| PDF 검증 모듈 (워커 큐, 3 endpoints) | ✅ | — |
| **PDF Synthesis 본 작업** (`POST /synthesize/external`) | ⏳ | P1 |
| **Before/After 미리보기** | ⏳ | P1 |
| 웹훅 콜백 처리 (`synthesis.completed/failed`) | ✅ Storige 측 / ⏳ PHP 측 | P0 |

### 8. 인프라 / 품질
| 항목 | 상태 | 우선순위 |
|---|---|---|
| 단위/통합/컴포넌트/플러그인 테스트 | ✅ 376 통과 | — |
| Playwright E2E | ⚠️ 설정만 | P2 |
| **사전 존재 type 에러 정리** (lucide-react resolution, EditPage.name, TemplateType.SPREAD, embed.tsx 충돌, SpreadRegion/moveObjectToCanvas export 등) | ⏳ | **P0** |
| **사전 존재 lint 에러 정리** (admin/process, canvas-core/getComputedStyle, ai/no-case-declarations, editor/no-empty, worker/no-useless-escape, parserOptions) | ⏳ | **P0** |
| 번들 크기 최적화 (vendor-opencv 10MB, vendor-onnx 24MB) | ❌ | P2 |
| Sentry/Datadog 등 에러 추적 | ❌ | P2 |

---

## B. 우선순위 분류

### 🔴 P0 (즉시 — 운영 blocker)
1. **북모아 운영 DB migration 적용** — `apps/api/migrations/20260501_add_products_allowCustomSize.sql` 실행 후 `SHOW COLUMNS` 검증
2. **모바일 실기기 검증** — iPhone 14/15, Android 13+, iPad. 발견 시 추가 PR
3. **사전 존재 type/lint 에러 정리** — CI 정상화. 별도 PR (예: `chore: 타입체크 통과 정리`)
4. **시점별 복원 UI** (BB-Phase 3 follow-up) — 백엔드 API 있고 클릭→confirm→restore UI 만 추가

### 🟡 P1 (단기 — 사용자 가치 큼)
5. **Composite 모드 다중 선택 cross-canvas 이동** (3b-v Ph3) — 표지 편집 multi-select
6. **PDF Synthesis 본 워커 동작 검증** — `POST /synthesize/external` end-to-end
7. **PHP 측 코드 적용 검증** — width/height + 웹훅 콜백 양측 통합 테스트
8. **반응형 Ph3** — 태블릿 세로 모드 drawer 최적화
9. **콘텐츠 패널 그리드 카탈로그** — 카테고리 탭 + 그리드 뷰

### 🟢 P2 (중기 — 폴리시 / 확장)
10. DD-5-B-v2 — 페이지 순서 재배열 UI 재구현
11. fabric 객체 색상 다크모드 통일
12. 정밀 좌표 매핑 향상 (multi-select cross-region)
13. AI 패널 정합
14. 번들 크기 최적화 (vendor-opencv lazy-load 강화)
15. Playwright E2E 시나리오 작성
16. Sentry/Datadog 에러 추적 연결

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

## D. 진척률

| 카테고리 | 완료 | 진행중/잔존 | 합계 |
|---|---|---|---|
| 모바일/터치 | 6 | 4 | 10 |
| 표지 편집 | 7 | 1 | 8 |
| 다크/반응형 | 6 | 2 | 8 |
| 도구 확장 | 6 | 2 | 8 |
| 카탈로그/AI | 2 | 3 | 5 |
| 통합 (북모아) | 4 | 2 | 6 |
| PDF/워커 | 2 | 3 | 5 |
| 인프라/품질 | 4 | 4 | 8 |
| **합계** | **37** | **21** | **58** |

**완료 비율: 약 64%** (실제 기능 측면에서는 ~80%, 운영 적용·폴리시 단계 진입 필요)

---

## E. 다음 1~2주 권장 sprint

| Day | 작업 |
|---|---|
| Day 1 | P0-1: 운영 DB migration 적용 + production 검증 |
| Day 1 | P0-3: 사전 존재 type/lint 에러 정리 PR |
| Day 2 | P0-2: 모바일 실기기 검증 + 발견 이슈 대응 |
| Day 3 | P0-4: 시점별 복원 UI 완성 |
| Day 4 | P1-7: PHP 측 통합 테스트 (width/height + 웹훅) |
| Day 5 | P1-5: Composite Ph3 (multi-select cross-canvas) 시작 |
| Day 6~7 | P1-9: 콘텐츠 그리드 카탈로그 |
| Day 8~10 | P1-8: 반응형 Ph3 + P2 폴리시 항목 |

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
