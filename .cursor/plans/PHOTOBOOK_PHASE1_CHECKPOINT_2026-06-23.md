# 포토북 Phase 1 체크포인트 (2026-06-23)

> 다음 세션/재개용 상태 스냅샷. 정본 설계 = `PHOTOBOOK_TEMPLATE_DESIGN_2026-06-23.md`, 운영 가이드 = `.claude/skills/photobook-template/SKILL.md`.

## 0. 현재 git 상태
- master HEAD = `121804c` (Phase1-공유 S1 z-order 버튼).
- 직전 관련 커밋: `396ac7f`(스킬+설계서) · `18266fd`(부록 C 유형 인벤토리, 병렬 세션) · `121804c`(S1).
- ⚠️ **editor 는 master push 자동배포 안 됨**(웹훅 미발화→Vercel CLI 수동). 따라서 editor 커밋=**스테이징(prod 미반영)**. API/worker 도 VPS 수동.

## 1. 핵심 설계 원칙 (의도 정합성 감사 2026-06-23 반영)
- **공통 편집기 UX(에셋/사진/라이브러리/객체 컨트롤·레이어·그룹·삭제·모바일)=상품 비종속 플랫폼 공유 계층.** 코드 확인: 객체 컨트롤 레이어에 `TemplateSetType` 게이팅 **0건**(게이팅 축=per-set `enabledMenus`/`editMode`/env/role, 타입과 직교).
- 공유 컨트롤은 포토북에서 재정의/중복 구현 금지. 개선 시 **전 상품(BOOK/LEAFLET/카드) 회귀 전제 + 독립 PR**.
- 포토북 고유 5영역만 신규: ①펼침면 표지+싸바리 ②펼침면 2-up 내지 ③사진 자동배치+EXIF ④페이지 가변+장바구니 가격 ⑤펼침면 300dpi 래스터+72dpi 썸네일+뷰어.
- 적대검증 가드: ⓡ삭제경고는 editor 앱에만(canvas-core `del` 불변=외부 임베더 회귀 방지) · ⓡ레이어 목록 인덱스↔z-index 단일진실원 · ⓡz-order 버튼도 `enabledMenus`/`editMode` 존중 · ⓡ썸네일 jpg는 **추가 파라미터**(png 기본 비파괴).

## 2. Phase 1 진행 상태 (2트랙)

| 항목 | 트랙 | 상태 | 파일 |
|---|---|---|---|
| S1 z-order 4버튼 | 공유 | ✅ `121804c` (빌드OK·스테이징) | `ControlBar.tsx` |
| S2 삭제경고 모달 | 공유 | ⏳ 진행 | `ControlBar.tsx` + 신규 모달 |
| S3 레이어 패널 DnD | 공유 | ⏳ 진행 | `SidePanel.tsx`·`useAppStore.ts` |
| P1 PHOTOBOOK enum+폼 | 포토북 | ⏳ 진행 | `types/index.ts`·`template-set.entity.ts`·admin `TemplateSetForm.tsx` |
| P2 썸네일 jpg 파라미터 | 포토북 | ⏳ 진행 | `useAppStore.ts`(S3과 동일파일→동반) |
| P3 사진틀 드롭스왑+빈틀삭제 | 포토북 | ⏳ 진행 | `useImageStore.ts` |
| P4 싸바리 MVP | 포토북 | ⏳ 진행 | `template-sets.service.ts`·worker(거의 config) |

### 병렬 분할 (파일 디스조인트)
- A: P1 (types/entity/admin) · B: P4 (service/worker) · C: P3 (useImageStore) · D: S2 (ControlBar+모달) · E: **S3+P2**(SidePanel+useAppStore — 동일파일이라 한 에이전트가 동반).
- 5 에이전트 worktree 격리 병렬 → diff 통합(디스조인트라 클린) → 빌드·테스트 → 트랙별 커밋.

## 3. 공유 트랙 DoD (editor 수동 배포 전 필수)
- BOOK/LEAFLET/카드 편집 라운드트립 회귀(저장·복원·재편집).
- fillImage(사진틀 채움) 동반 z-order, lockLayerOrder 가드 동작.
- 모바일 DnD ↔ 터치 스크롤 충돌 없음.
- 기존 셋 도구 노출 정책(enabledMenus) 불변.

## 4. 오너 결정 대기 (Phase 2~3 산정 게이트)
- O-1 싸바리 정밀 geometry(MVP 우회 vs caseBind L) · O-2 펼침면 2-up 내지 범위 · O-3 가격 계산 주체(storige 메타만 vs 총가) · O-4 300dpi 래스터 필요성 · O-5 자동배치 실행위치 · O-6 EXIF GPS · O-7 페이지 swap/insert · O-8 잠금 default 파라미터 · O-9 저해상도 임계 · O-10(해소).

## 5. 이 세션의 다른 완료 작업 (참고)
- jspdf 4.x 골든파리티→promote→compress(ⓐ) LIVE · WH-001 prod silent no-op 적발·수정(ⓓ) · SEC-005 Sentry 알림(ⓕ) · 합성 멱등 가드(ⓔ) · AUTH-001 stage1 httpOnly(ⓑ) 배포·LIVE · ⓒ 시크릿 정화 PREP(게이트). 상세=메모리 `project_full_audit_2026-06-21`.
